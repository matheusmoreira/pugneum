const makeError = require('pugneum-error');
const walk = require('pugneum-walker');

function error(code, message, node, sources) {
  throw makeError(code, message, {
    line: node.line,
    column: node.column,
    filename: node.filename,
    source: (sources && sources[node.filename]) || '',
  });
}

function warn(code, message, node, sources, warnings) {
  warnings.push(
    makeError.warning(code, message, {
      line: node.line,
      column: node.column,
      filename: node.filename,
      source: (sources && sources[node.filename]) || '',
    }),
  );
}

// Whole-document lints. Run once by link() on the final, fully assembled tree.
function lintDocument(ast, sources, warnings) {
  const seenIds = Object.create(null);
  walk(ast, function (node) {
    if (node.type !== 'Tag') return;
    const attrs = node.attrs || [];
    for (const attr of attrs) {
      if (attr.name === 'id' && typeof attr.val === 'string') {
        const loc = attr.line != null ? attr : node;
        if (seenIds[attr.val]) {
          warn(
            'DUPLICATE_ID',
            "Duplicate id '" + attr.val + "' (ids must be unique)",
            loc,
            sources,
            warnings,
          );
        } else {
          seenIds[attr.val] = true;
        }
      }
    }
    if (node.name === 'img' && !attrs.some((a) => a.name === 'alt')) {
      warn(
        'IMG_WITHOUT_ALT',
        'img has no alt attribute (use alt="" for purely decorative images)',
        node,
        sources,
        warnings,
      );
    }
  });
}

const DEFAULT_MAX_LINK_DEPTH = 256;

module.exports = link;

// Public entry: link the tree, then run whole-document lints exactly once on
// the final result. linkInner recurses for template inheritance; keeping the
// lint pass out here means "run once on the assembled tree" no longer depends
// on the recursion depth counter.
function link(ast, options) {
  options = options || {};
  const result = linkInner(ast, options);
  lintDocument(result, options.sources, options.warnings || []);
  return result;
}

function linkInner(ast, options) {
  options = options || {};
  const sources = options.sources;
  const warnings = options.warnings || [];
  const maxDepth =
    options.maxLinkDepth != null
      ? options.maxLinkDepth
      : DEFAULT_MAX_LINK_DEPTH;
  const depth = options._linkDepth || 0;

  if (depth >= maxDepth) {
    error(
      'LINK_DEPTH_EXCEEDED',
      `Template inheritance/include chain exceeds maximum depth of ${maxDepth}`,
      ast,
      sources,
    );
  }

  if (ast.type !== 'Block') {
    error(
      'INVALID_AST',
      'The top level element should always be a block',
      ast,
      sources,
    );
  }
  let extendsNode = null;
  if (ast.nodes.length) {
    const hasExtends = ast.nodes[0].type === 'Extends';
    checkExtendPosition(ast, hasExtends, sources);
    if (hasExtends) {
      extendsNode = ast.nodes.shift();
    }
  }
  ast = applyIncludes(ast, options);
  ast = resolveReferences(ast, sources, warnings);
  ast = resolveToc(ast, sources, warnings);
  ast = resolveFootnotes(ast, sources, warnings);
  ast.declaredBlocks = findDeclaredBlocks(ast);
  if (extendsNode) {
    const mixins = [];
    const expectedBlocks = [];
    ast.nodes.forEach(function addNode(node) {
      if (node.type === 'NamedBlock') {
        expectedBlocks.push(node);
      } else if (node.type === 'Block') {
        node.nodes.forEach(addNode);
      } else if (node.type === 'Mixin' && node.call === false) {
        mixins.push(node);
      } else {
        error(
          'UNEXPECTED_NODES_IN_EXTENDING_ROOT',
          'Only named blocks and mixins can appear at the top level of an extending template',
          node,
          sources,
        );
      }
    });

    // Validate expected blocks BEFORE mutating parent via extend()
    const parent = linkInner(
      extendsNode.file.ast,
      Object.assign({}, options, {_linkDepth: depth + 1}),
    );
    const parentBlockNames = [];
    walk(parent, function (node) {
      if (node.type === 'NamedBlock') {
        parentBlockNames.push(node.name);
      }
    });
    for (const expectedBlock of expectedBlocks) {
      if (!parentBlockNames.includes(expectedBlock.name)) {
        error(
          'UNEXPECTED_BLOCK',
          'Unexpected block ' + expectedBlock.name,
          expectedBlock,
          sources,
        );
      }
    }

    extend(parent.declaredBlocks, ast, sources);
    Object.keys(ast.declaredBlocks).forEach(function (name) {
      parent.declaredBlocks[name] = ast.declaredBlocks[name];
    });
    parent.nodes = mixins.concat(parent.nodes);
    parent.hasExtends = true;
    return parent;
  }
  return ast;
}

function findDeclaredBlocks(ast) {
  const definitions = Object.create(null);
  walk(ast, function before(node) {
    if (node.type === 'NamedBlock' && node.mode === 'replace') {
      definitions[node.name] = definitions[node.name] || [];
      definitions[node.name].push(node);
    }
  });
  return definitions;
}

function flattenParentBlocks(parentBlocks, accumulator) {
  accumulator = accumulator || [];
  parentBlocks.forEach(function (parentBlock) {
    if (parentBlock.parents) {
      flattenParentBlocks(parentBlock.parents, accumulator);
    }
    accumulator.push(parentBlock);
  });
  return accumulator;
}

function extend(parentBlocks, ast, sources) {
  const stack = new Set();
  walk(
    ast,
    function before(node) {
      if (node.type === 'NamedBlock') {
        if (stack.has(node.name)) {
          return (node.ignore = true);
        }
        stack.add(node.name);
        const parentBlockList = parentBlocks[node.name]
          ? flattenParentBlocks(parentBlocks[node.name])
          : [];
        if (parentBlockList.length) {
          node.parents = parentBlockList;
          parentBlockList.forEach(function (parentBlock) {
            switch (node.mode) {
              case 'append':
                parentBlock.nodes = parentBlock.nodes.concat(node.nodes);
                break;
              case 'prepend':
                parentBlock.nodes = node.nodes.concat(parentBlock.nodes);
                break;
              case 'replace':
                parentBlock.nodes = node.nodes;
                break;
              default:
                error(
                  'UNKNOWN_BLOCK_MODE',
                  "Unknown block mode '" + node.mode + "'",
                  node,
                  sources,
                );
            }
          });
        }
      }
    },
    function after(node) {
      if (node.type === 'NamedBlock' && !node.ignore) {
        stack.delete(node.name);
      }
    },
  );
}

function applyIncludes(ast, options) {
  return walk(
    ast,
    function before(node, replace) {
      if (node.type === 'RawInclude' && node.filters.length === 0) {
        replace({
          type: 'Text',
          val: node.file.str.replace(/\r/g, ''),
          line: node.line,
          column: node.column,
          filename: node.filename,
        });
      }
    },
    function after(node, replace) {
      if (node.type === 'Include') {
        const depth = options._linkDepth || 0;
        // linkInner, not link: the included subtree is linted as part of the
        // final assembled tree by the top-level link() wrapper. Calling link()
        // here would lint it again, multiplying warnings by include depth.
        let childAST = linkInner(
          node.file.ast,
          Object.assign({}, options, {_linkDepth: depth + 1}),
        );
        if (childAST.hasExtends) {
          childAST = removeBlocks(childAST);
        }
        replace(applyYield(childAST, node.block, node, options));
      }
    },
  );
}

function removeBlocks(ast) {
  return walk(ast, function (node, replace) {
    if (node.type === 'NamedBlock') {
      replace({
        type: 'Block',
        nodes: node.nodes,
        line: node.line,
        column: node.column,
        filename: node.filename,
      });
    }
  });
}

function applyYield(ast, block, includeNode, options) {
  if (!block || !block.nodes.length) return ast;
  let replaced = false;
  ast = walk(ast, null, function (node, replace) {
    if (node.type === 'YieldBlock') {
      replaced = true;
      node.type = 'Block';
      node.nodes = [block];
    }
  });
  if (!replaced) {
    error(
      'MISSING_YIELD',
      'Included template has no yield block but the include passes a block into it',
      includeNode,
      options && options.sources,
    );
  }
  return ast;
}

function resolveReferences(ast, sources, warnings) {
  const definitions = Object.create(null);
  const used = Object.create(null);
  walk(ast, function (node) {
    if (node.type === 'References') {
      for (const def of node.definitions) {
        if (def.name in definitions) {
          error(
            'DUPLICATE_REFERENCE',
            `Duplicate reference '${def.name}'`,
            def,
            sources,
          );
        }
        definitions[def.name] = {
          url: def.url,
          defaultText: def.defaultText,
          node: def,
        };
      }
    }
  });

  const result = walk(ast, function before(node, replace) {
    if (node.type === 'References') {
      replace([]);
      return false;
    }
    if (node.type === 'ReferenceLink' || node.type === 'ReferenceImage') {
      used[node.name] = true;
    }
    if (node.type === 'ReferenceLink') {
      const def = definitions[node.name];
      if (def === undefined) {
        error(
          'UNDEFINED_REFERENCE',
          "Undefined reference '" + node.name + "'",
          node,
          sources,
        );
      }
      const url = def.url;

      let block = node.block;
      if (!block || block.nodes.length === 0) {
        const fallbackText = def.defaultText || node.name;
        block = {
          type: 'Block',
          nodes: [
            {
              type: 'Text',
              val: fallbackText,
              line: node.line,
              column: node.column,
              filename: node.filename,
            },
          ],
          line: node.line,
          column: node.column,
          filename: node.filename,
        };
      }

      const attrs = [
        {
          name: 'href',
          val: url,
          line: node.line,
          column: node.column,
          filename: node.filename,
        },
      ];
      if (node.attrs) {
        attrs.push.apply(attrs, node.attrs);
      }

      replace({
        type: 'Tag',
        name: 'a',
        attrs: attrs,
        attributeBlocks: [],
        block: block,
        isInline: true,
        line: node.line,
        column: node.column,
        filename: node.filename,
      });
    }
    if (node.type === 'ReferenceImage') {
      const def = definitions[node.name];
      if (def === undefined) {
        error(
          'UNDEFINED_REFERENCE',
          "Undefined reference '" + node.name + "'",
          node,
          sources,
        );
      }
      const url = def.url;

      let altBlock = node.block;
      if (!altBlock || altBlock.nodes.length === 0) {
        const fallbackAlt = def.defaultText || '';
        altBlock = {
          type: 'Block',
          nodes: [
            {
              type: 'Text',
              val: fallbackAlt,
              line: node.line,
              column: node.column,
              filename: node.filename,
            },
          ],
          line: node.line,
          column: node.column,
          filename: node.filename,
        };
      }

      const altText = altBlock.nodes
        .filter((n) => n.type === 'Text')
        .map((n) => n.val)
        .join('');

      const attrs = [
        {
          name: 'src',
          val: url,
          line: node.line,
          column: node.column,
          filename: node.filename,
        },
        {
          name: 'alt',
          val: altText,
          line: node.line,
          column: node.column,
          filename: node.filename,
        },
      ];
      if (node.attrs) {
        attrs.push.apply(attrs, node.attrs);
      }

      replace({
        type: 'Tag',
        name: 'img',
        attrs: attrs,
        attributeBlocks: [],
        block: {
          type: 'Block',
          nodes: [],
          line: node.line,
          column: node.column,
          filename: node.filename,
        },
        isInline: true,
        selfClosing: true,
        line: node.line,
        column: node.column,
        filename: node.filename,
      });
    }
  });

  for (const name in definitions) {
    if (!used[name]) {
      warn(
        'UNUSED_REFERENCE',
        "Reference '" + name + "' is defined but never used",
        definitions[name].node,
        sources,
        warnings,
      );
    }
  }
  return result;
}

function toSuperscript(n) {
  const digits = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  return String(n)
    .split('')
    .map(function (d) {
      return digits[parseInt(d)];
    })
    .join('');
}

function resolveFootnotes(ast, sources, warnings) {
  const definitions = Object.create(null);
  let footnotesBlockCount = 0;

  // Pass 1: collect definitions, error on duplicates and multiple blocks
  walk(ast, function (node) {
    if (node.type === 'Footnotes') {
      footnotesBlockCount++;
      if (footnotesBlockCount > 1) {
        error(
          'DUPLICATE_FOOTNOTES_BLOCK',
          'Only one footnotes block is allowed per file',
          node,
          sources,
        );
      }
      for (const def of node.definitions) {
        if (!/^[a-zA-Z0-9_-]+$/.test(def.name)) {
          error(
            'INVALID_FOOTNOTE_NAME',
            "Footnote name '" +
              def.name +
              "' contains invalid characters (only a-z, A-Z, 0-9, -, _ allowed)",
            def,
            sources,
          );
        }
        if (def.name in definitions) {
          error(
            'DUPLICATE_FOOTNOTE',
            "Duplicate footnote '" + def.name + "'",
            def,
            sources,
          );
        }
        definitions[def.name] = def;
      }
    }
  });

  // Pass 2: resolve all FootnoteRef nodes (assign numbers, replace with sup>a)
  // This includes refs inside definition content blocks.
  const numberByName = Object.create(null);
  const refCountByName = Object.create(null);
  let nextNumber = 1;

  function resolveRef(node, replace) {
    const name = node.name;
    if (!(name in definitions)) {
      error(
        'UNDEFINED_FOOTNOTE',
        "Undefined footnote '" + name + "'",
        node,
        sources,
      );
    }

    if (!(name in numberByName)) {
      numberByName[name] = nextNumber++;
      refCountByName[name] = 0;
    }

    const num = numberByName[name];
    const refIndex = ++refCountByName[name];
    const refId =
      refIndex === 1
        ? 'footnote-reference-' + name
        : 'footnote-reference-' + name + '-' + refIndex;

    const anchorNode = {
      type: 'Tag',
      name: 'a',
      attrs: [
        {
          name: 'href',
          val: '#footnote-' + name,
          line: node.line,
          column: node.column,
          filename: node.filename,
        },
        {
          name: 'id',
          val: refId,
          line: node.line,
          column: node.column,
          filename: node.filename,
        },
        {
          name: 'role',
          val: 'doc-noteref',
          line: node.line,
          column: node.column,
          filename: node.filename,
        },
      ],
      attributeBlocks: [],
      isInline: true,
      block: {
        type: 'Block',
        nodes: [
          {
            type: 'Text',
            val: '[' + num + ']',
            line: node.line,
            column: node.column,
            filename: node.filename,
          },
        ],
        line: node.line,
        column: node.column,
        filename: node.filename,
      },
      line: node.line,
      column: node.column,
      filename: node.filename,
    };

    replace({
      type: 'Tag',
      name: 'sup',
      attrs: [],
      attributeBlocks: [],
      isInline: true,
      block: {
        type: 'Block',
        nodes: [anchorNode],
        line: node.line,
        column: node.column,
        filename: node.filename,
      },
      line: node.line,
      column: node.column,
      filename: node.filename,
    });
  }

  // Resolve refs in main document (skip into Footnotes definitions)
  ast = walk(ast, function before(node, replace) {
    if (node.type === 'FootnoteRef') {
      resolveRef(node, replace);
      return false;
    }
    if (node.type === 'Footnotes') {
      return false;
    }
  });

  // Resolve refs inside definition blocks, but only for footnotes
  // transitively reachable from body text. Fixpoint loop: process
  // newly-discovered footnotes until no new ones appear.
  const resolved = Object.create(null);
  let changed = true;
  while (changed) {
    changed = false;
    for (const name in numberByName) {
      if (name in resolved) continue;
      resolved[name] = true;
      const def = definitions[name];
      if (def && def.block) {
        const prevCount = nextNumber;
        def.block = walk(def.block, function (innerNode, innerReplace) {
          if (innerNode.type === 'FootnoteRef') {
            resolveRef(innerNode, innerReplace);
            return false;
          }
        });
        if (nextNumber > prevCount) changed = true;
      }
    }
  }

  for (const name in definitions) {
    if (!(name in numberByName)) {
      warn(
        'UNUSED_FOOTNOTE',
        "Footnote '" + name + "' is defined but never referenced",
        definitions[name],
        sources,
        warnings,
      );
    }
  }

  // Pass 3: replace Footnotes node with rendered section
  // All refs are now numbered so ordering is correct regardless of source position
  return walk(ast, function before(node, replace) {
    if (node.type === 'Footnotes') {
      const referenced = Object.keys(numberByName).sort(function (a, b) {
        return numberByName[a] - numberByName[b];
      });

      if (referenced.length === 0) {
        replace([]);
        return false;
      }

      const listItems = referenced.map(function (name) {
        const def = definitions[name];
        const totalRefs = refCountByName[name];

        const backLinkNodes = [];
        for (let i = 1; i <= totalRefs; i++) {
          const backId =
            i === 1
              ? 'footnote-reference-' + name
              : 'footnote-reference-' + name + '-' + i;
          const label = i === 1 ? '↩' : '↩' + toSuperscript(i);
          backLinkNodes.push({
            type: 'Tag',
            name: 'a',
            attrs: [
              {
                name: 'href',
                val: '#' + backId,
                line: def.line,
                column: def.column,
                filename: def.filename,
              },
              {
                name: 'role',
                val: 'doc-backlink',
                line: def.line,
                column: def.column,
                filename: def.filename,
              },
            ],
            attributeBlocks: [],
            isInline: true,
            block: {
              type: 'Block',
              nodes: [
                {
                  type: 'Text',
                  val: label,
                  line: def.line,
                  column: def.column,
                  filename: def.filename,
                },
              ],
              line: def.line,
              column: def.column,
              filename: def.filename,
            },
            line: def.line,
            column: def.column,
            filename: def.filename,
          });
        }

        const liContentNodes = def.block ? def.block.nodes.slice() : [];
        liContentNodes.push.apply(liContentNodes, backLinkNodes);

        return {
          type: 'Tag',
          name: 'li',
          attrs: [
            {
              name: 'id',
              val: 'footnote-' + name,
              line: def.line,
              column: def.column,
              filename: def.filename,
            },
            {
              name: 'role',
              val: 'doc-endnote',
              line: def.line,
              column: def.column,
              filename: def.filename,
            },
          ],
          attributeBlocks: [],
          isInline: false,
          block: {
            type: 'Block',
            nodes: liContentNodes,
            line: def.line,
            column: def.column,
            filename: def.filename,
          },
          line: def.line,
          column: def.column,
          filename: def.filename,
        };
      });

      const olNode = {
        type: 'Tag',
        name: 'ol',
        attrs: [],
        attributeBlocks: [],
        isInline: false,
        block: {
          type: 'Block',
          nodes: listItems,
          line: node.line,
          column: node.column,
          filename: node.filename,
        },
        line: node.line,
        column: node.column,
        filename: node.filename,
      };

      replace({
        type: 'Tag',
        name: 'section',
        attrs: [
          {
            name: 'role',
            val: 'doc-endnotes',
            line: node.line,
            column: node.column,
            filename: node.filename,
          },
        ],
        attributeBlocks: [],
        isInline: false,
        block: {
          type: 'Block',
          nodes: [olNode],
          line: node.line,
          column: node.column,
          filename: node.filename,
        },
        line: node.line,
        column: node.column,
        filename: node.filename,
      });
      return false;
    }
  });
}

function resolveToc(ast, sources, warnings) {
  const headings = [];

  // Pass 1: collect headings with IDs
  walk(ast, function (node) {
    if (node.type === 'Tag' && /^h[1-6]$/.test(node.name)) {
      const idAttr =
        node.attrs &&
        node.attrs.find(function (a) {
          return a.name === 'id';
        });
      if (!idAttr) return;

      let text = '';
      if (node.block && node.block.nodes) {
        text = extractText(node.block.nodes);
      }

      headings.push({
        level: parseInt(node.name[1]),
        id: idAttr.val,
        text: text || idAttr.val,
      });
    }
  });

  if (headings.length === 0) {
    // No headings with IDs — remove Toc node (and warn that it produced nothing)
    return walk(ast, function (node, replace) {
      if (node.type === 'Toc') {
        warn(
          'EMPTY_TOC',
          'toc has no entries: no headings with an explicit id were found',
          node,
          sources,
          warnings,
        );
        replace([]);
        return false;
      }
    });
  }

  // Pass 2: replace Toc nodes with nav structure
  return walk(ast, function before(node, replace) {
    if (node.type === 'Toc') {
      replace(buildTocNav(headings, node));
      return false;
    }
  });
}

function extractText(nodes) {
  let text = '';
  for (const node of nodes) {
    if (node.type === 'Text') {
      text += node.val;
    } else if (node.block && node.block.nodes) {
      text += extractText(node.block.nodes);
    }
  }
  return text;
}

function buildTocNav(headings, tocNode) {
  const items = buildTocItems(headings, 0, headings.length, tocNode);

  const ol = {
    type: 'Tag',
    name: 'ol',
    attrs: [],
    attributeBlocks: [],
    isInline: false,
    block: {
      type: 'Block',
      nodes: items,
      line: tocNode.line,
      column: tocNode.column,
      filename: tocNode.filename,
    },
    line: tocNode.line,
    column: tocNode.column,
    filename: tocNode.filename,
  };

  return {
    type: 'Tag',
    name: 'nav',
    attrs: [
      {
        name: 'role',
        val: 'doc-toc',
        line: tocNode.line,
        column: tocNode.column,
        filename: tocNode.filename,
      },
      {
        name: 'aria-label',
        val: 'Table of contents',
        line: tocNode.line,
        column: tocNode.column,
        filename: tocNode.filename,
      },
    ],
    attributeBlocks: [],
    isInline: false,
    block: {
      type: 'Block',
      nodes: [ol],
      line: tocNode.line,
      column: tocNode.column,
      filename: tocNode.filename,
    },
    line: tocNode.line,
    column: tocNode.column,
    filename: tocNode.filename,
  };
}

function buildTocItems(headings, start, end, tocNode) {
  if (start >= end) return [];

  const items = [];
  const topLevel = headings[start].level;
  let i = start;

  while (i < end) {
    const heading = headings[i];
    // Find the range of children (deeper headings until next same-or-higher level)
    let j = i + 1;
    while (j < end && headings[j].level > topLevel) {
      j++;
    }

    // Build the <a> link
    const link = {
      type: 'Tag',
      name: 'a',
      attrs: [
        {
          name: 'href',
          val: '#' + heading.id,
          line: tocNode.line,
          column: tocNode.column,
          filename: tocNode.filename,
        },
      ],
      attributeBlocks: [],
      isInline: true,
      block: {
        type: 'Block',
        nodes: [
          {
            type: 'Text',
            val: heading.text,
            line: tocNode.line,
            column: tocNode.column,
            filename: tocNode.filename,
          },
        ],
        line: tocNode.line,
        column: tocNode.column,
        filename: tocNode.filename,
      },
      line: tocNode.line,
      column: tocNode.column,
      filename: tocNode.filename,
    };

    // Build children (sub-headings)
    const liContent = [link];
    if (j > i + 1) {
      const childItems = buildTocItems(headings, i + 1, j, tocNode);
      if (childItems.length > 0) {
        liContent.push({
          type: 'Tag',
          name: 'ol',
          attrs: [],
          attributeBlocks: [],
          isInline: false,
          block: {
            type: 'Block',
            nodes: childItems,
            line: tocNode.line,
            column: tocNode.column,
            filename: tocNode.filename,
          },
          line: tocNode.line,
          column: tocNode.column,
          filename: tocNode.filename,
        });
      }
    }

    items.push({
      type: 'Tag',
      name: 'li',
      attrs: [],
      attributeBlocks: [],
      isInline: false,
      block: {
        type: 'Block',
        nodes: liContent,
        line: tocNode.line,
        column: tocNode.column,
        filename: tocNode.filename,
      },
      line: tocNode.line,
      column: tocNode.column,
      filename: tocNode.filename,
    });

    i = j;
  }

  return items;
}

function checkExtendPosition(ast, hasExtends, sources) {
  let legitExtendsReached = false;
  walk(ast, function (node) {
    if (node.type === 'Extends') {
      if (hasExtends && !legitExtendsReached) {
        legitExtendsReached = true;
      } else {
        error(
          'EXTENDS_NOT_FIRST',
          'Declaration of template inheritance ("extends") should be the first thing in the file. There can only be one extends statement per file.',
          node,
          sources,
        );
      }
    }
  });
}
