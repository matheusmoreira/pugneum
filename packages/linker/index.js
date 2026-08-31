const makeError = require('pugneum-error');
const walk = require('pugneum-walker');

function diagnosticSources(options) {
  return {
    byFilename: options && options.sources,
    entryFilename: options && options.filename,
    entrySource: options && options.source,
  };
}

// Build the {line, column, filename, source} context both error() and warn()
// attach to a diagnostic. The source line is looked up per-filename so an error
// in an included/generated file shows that source. A filename-less entry still
// uses the scalar source supplied by the programmatic facade.
function locContext(node, sources) {
  const filename = node && node.filename;
  const byFilename = sources && sources.byFilename;
  let source = (byFilename && byFilename[filename]) || '';
  if (
    !source &&
    sources &&
    (!filename || filename === sources.entryFilename) &&
    typeof sources.entrySource === 'string'
  ) {
    source = sources.entrySource;
  }
  return {
    line: node && node.line,
    column: node && node.column,
    filename,
    source,
  };
}

function error(code, message, node, sources) {
  throw makeError(code, message, locContext(node, sources));
}

function warn(code, message, node, sources, warnings) {
  warnings.push(makeError.warning(code, message, locContext(node, sources)));
}

function asciiLowerCase(value) {
  return value.replace(/[A-Z]/g, function (character) {
    return String.fromCharCode(character.charCodeAt(0) + 32);
  });
}

function appendItems(target, items) {
  for (let index = 0; index < items.length; index++) {
    target.push(items[index]);
  }
}

function appendReferenceAttributes(target, attrs, reserved, sources) {
  if (!attrs) return;
  for (const attr of attrs) {
    const name = asciiLowerCase(attr.name);
    if (reserved.has(name)) {
      error(
        'DUPLICATE_ATTRIBUTE',
        'Duplicate attribute "' + name + '" is not allowed.',
        attr,
        sources,
      );
    }
    target.push(attr);
  }
}

const LINK_RESERVED_ATTRIBUTES = new Set(['href']);
const IMAGE_RESERVED_ATTRIBUTES = new Set(['src', 'alt']);

function normalizeTextNewlines(value) {
  return value.replace(/\r\n|\r/g, '\n');
}

// Whole-document lints. Run once by link() on the final, fully assembled tree.
function lintDocument(ast, sources, warnings) {
  const seenIds = Object.create(null);
  walk(ast, function (node) {
    if (node.type !== 'Tag') return;
    const attrs = node.attrs || [];
    for (const attr of attrs) {
      if (asciiLowerCase(attr.name) === 'id' && typeof attr.val === 'string') {
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
    if (
      asciiLowerCase(node.name) === 'img' &&
      !attrs.some((a) => asciiLowerCase(a.name) === 'alt')
    ) {
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

// Public entry. `link` assembles the tree (template inheritance + includes) and
// then resolves document-level constructs (references/footnotes/toc) + lints —
// the full single-call behaviour most callers want. The pipeline (packages/
// pugneum) instead calls `link.assemble` and, AFTER the filterer has run,
// `link.resolve`, so the constructs a pugneum-type filter emits (@[ref]/^[fn]/toc
// inside e.g. a table cell) participate in the same resolution as the rest of
// the tree instead of reaching the renderer unresolved. Splitting the passes is
// also why resolution is now document-global — one pass over the assembled tree
// rather than per-include-level, so references/footnotes/toc cross include/extends.
function link(ast, options) {
  options = prepareLink(ast, options);
  return resolveDocument(
    linkInner(ast, options, createLinkState(options), 0),
    options,
  );
}

// Assembly only: template inheritance (extends/blocks) + includes. No reference/
// footnote/toc resolution and no whole-document lint — those run later, in
// resolve(), over the fully assembled + filtered tree.
link.assemble = function (ast, options) {
  options = prepareLink(ast, options);
  return linkInner(ast, options, createLinkState(options), 0);
};

// Document-level resolution over the final assembled + filtered tree: references,
// then TOC, then footnotes, then the whole-document lint. resolveToc must run
// before resolveFootnotes (heading text is captured before footnote [n] markers
// exist, so a heading like `h2#sec Title^[n]` does not pull a resolved "[1]" into
// its TOC entry). lintDocument runs last so it sees resolution-generated ids
// (footnote ids, etc.).
function resolveDocument(ast, options) {
  const sources = diagnosticSources(options);
  const warnings = options.warnings;
  ast = resolveReferences(ast, sources, warnings);
  ast = resolveToc(ast, sources, warnings);
  ast = resolveFootnotes(ast, sources, warnings);
  lintDocument(ast, sources, warnings);
  return ast;
}
link.resolve = function (ast, options) {
  options = prepareLink(ast, options);
  return resolveDocument(cloneAst(ast), options);
};

function prepareLink(ast, options) {
  options = validateOptions(options);
  validateRoot(ast, diagnosticSources(options));
  if (options.warnings === undefined) options.warnings = [];
  return options;
}

function validateOptions(options) {
  if (options === undefined) options = {};
  if (
    options === null ||
    typeof options !== 'object' ||
    Array.isArray(options)
  ) {
    throw new TypeError('options must be an object (non-null and non-array)');
  }
  if (
    options.maxLinkDepth !== undefined &&
    (!Number.isSafeInteger(options.maxLinkDepth) ||
      options.maxLinkDepth < 0 ||
      options.maxLinkDepth > DEFAULT_MAX_LINK_DEPTH)
  ) {
    throw new TypeError(
      'options.maxLinkDepth must be an integer from 0 through ' +
        DEFAULT_MAX_LINK_DEPTH,
    );
  }
  if (
    options.sources !== undefined &&
    (options.sources === null ||
      typeof options.sources !== 'object' ||
      Array.isArray(options.sources))
  ) {
    throw new TypeError('options.sources must be a non-null, non-array object');
  }
  for (const name of ['filename', 'source']) {
    if (options[name] !== undefined && typeof options[name] !== 'string') {
      throw new TypeError('options.' + name + ' must be a string');
    }
  }
  if (options.warnings !== undefined) {
    if (
      !Array.isArray(options.warnings) ||
      !Object.isExtensible(options.warnings) ||
      !Object.getOwnPropertyDescriptor(options.warnings, 'length').writable
    ) {
      throw new TypeError('options.warnings must be an extensible array');
    }
  } else if (!Object.isExtensible(options)) {
    throw new TypeError(
      'options must permit the warnings output property or supply a warnings array',
    );
  }
  return options;
}

function validateRoot(ast, sources) {
  if (
    ast === null ||
    typeof ast !== 'object' ||
    Array.isArray(ast) ||
    ast.type !== 'Block'
  ) {
    error(
      'INVALID_AST',
      'The top level element should always be a block',
      ast,
      sources,
    );
  }
  if (!Array.isArray(ast.nodes)) {
    error(
      'INVALID_AST',
      'The top level block should always contain a nodes array',
      ast,
      sources,
    );
  }
}

// Inheritance bookkeeping is needed only while one tree is being assembled.
// Keep it off public AST nodes so the linked result remains a serializable tree
// instead of exposing a repeated ancestry graph through enumerable metadata.
function createLinkState(options) {
  return {
    declaredBlocks: new WeakMap(),
    maxDepth:
      options.maxLinkDepth === undefined
        ? DEFAULT_MAX_LINK_DEPTH
        : options.maxLinkDepth,
  };
}

function linkInner(ast, options, state, depth) {
  const sources = diagnosticSources(options);
  validateRoot(ast, sources);
  // Each physical AST is copied at its ownership boundary. FileReference.ast
  // values stay deferred until their own linkInner call, so the same child AST
  // can safely be used at multiple include/extends sites without preserving an
  // alias between rendered occurrences.
  ast = cloneOwnedAst(ast);
  let extendsNode = null;
  if (ast.nodes.length) {
    const hasExtends = ast.nodes[0].type === 'Extends';
    checkExtendPosition(ast, hasExtends, sources);
    if (hasExtends) {
      extendsNode = ast.nodes[0];
      assertLinkEdge(depth, state.maxDepth, extendsNode, sources);
      ast.nodes.shift();
    }
  }
  ast = applyIncludes(ast, options, state, depth);
  const declaredBlocks = findDeclaredBlocks(ast);
  state.declaredBlocks.set(ast, declaredBlocks);
  if (extendsNode) {
    const declarations = [];
    const expectedBlocks = [];
    ast.nodes.forEach(function addNode(node) {
      if (node.type === 'NamedBlock') {
        expectedBlocks.push(node);
      } else if (node.type === 'Block') {
        node.nodes.forEach(addNode);
      } else if (node.type === 'Mixin' && node.call === false) {
        declarations.push(node);
      } else if (node.type === 'References') {
        declarations.push(node);
      } else {
        error(
          'UNEXPECTED_NODES_IN_EXTENDING_ROOT',
          'Only named blocks, mixins, and references can appear at the top level of an extending template',
          node,
          sources,
        );
      }
    });

    // Validate expected blocks BEFORE mutating parent via extend()
    const parent = linkInner(extendsNode.file.ast, options, state, depth + 1);
    const parentDeclaredBlocks = state.declaredBlocks.get(parent);
    for (const expectedBlock of expectedBlocks) {
      if (
        !Object.prototype.hasOwnProperty.call(
          parentDeclaredBlocks,
          expectedBlock.name,
        )
      ) {
        error(
          'UNEXPECTED_BLOCK',
          'Unexpected block ' + expectedBlock.name,
          expectedBlock,
          sources,
        );
      }
    }

    extend(parentDeclaredBlocks, ast, sources);
    parent.nodes = declarations.concat(parent.nodes);
    // Composition cloned payloads into the actual parent slots. Recompute the
    // authoritative map from that output tree so a later inheritance level
    // targets rendered occurrences, including newly introduced nested slots,
    // rather than detached override nodes or ancestry aliases.
    state.declaredBlocks.set(parent, findDeclaredBlocks(parent));
    parent.hasExtends = true;
    return parent;
  }
  return ast;
}

function findDeclaredBlocks(ast) {
  const definitions = Object.create(null);
  forEachInheritanceBlock(ast, function (node) {
    if (node.mode === 'replace') {
      definitions[node.name] = definitions[node.name] || [];
      definitions[node.name].push(node);
    }
  });
  return definitions;
}

// NamedBlock is shared by template inheritance and mixin slots. Only blocks in
// document structure belong to inheritance: a Mixin owns its entire subtree.
// Within document structure, a same-named nested block is content of the outer
// override rather than another target. Discovery and merging both route through
// this helper so validation cannot accept a slot that composition will ignore.
function forEachInheritanceBlock(ast, visit) {
  const activeNames = new Set();
  const enteredNames = new WeakMap();
  walk(
    ast,
    function before(node) {
      if (node.type === 'Mixin') return false;
      if (node.type !== 'NamedBlock') return;
      if (activeNames.has(node.name)) return false;
      activeNames.add(node.name);
      enteredNames.set(node, node.name);
      visit(node);
    },
    function after(node) {
      const name = enteredNames.get(node);
      if (name !== undefined) activeNames.delete(name);
    },
  );
}

// Merge the child template's effective inheritance overrides into the parent's
// slots. `parentBlocks` maps each name directly to the current rendered block
// occurrences. forEachInheritanceBlock applies the same mixin-scope and
// nested-name rules used to construct that map.
function extend(parentBlocks, ast, sources) {
  forEachInheritanceBlock(ast, function (node) {
    const parentBlockList = parentBlocks[node.name] || [];
    if (!parentBlockList.length) return;
    parentBlockList.forEach(function (parentBlock) {
      // Every effective slot owns its occurrence. Later filters and document
      // resolution mutate subtrees, so sharing node.nodes here would process
      // one occurrence and merely alias the already-resolved result elsewhere.
      const nodes = cloneAst(node.nodes);
      switch (node.mode) {
        case 'append':
          parentBlock.nodes = parentBlock.nodes.concat(nodes);
          break;
        case 'prepend':
          parentBlock.nodes = nodes.concat(parentBlock.nodes);
          break;
        case 'replace':
          parentBlock.nodes = nodes;
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
  });
}

function assertLinkEdge(depth, maxDepth, node, sources) {
  if (depth >= maxDepth) {
    error(
      'LINK_DEPTH_EXCEEDED',
      `Template inheritance/include chain exceeds maximum depth of ${maxDepth}`,
      node,
      sources,
    );
  }
}

function applyIncludes(ast, options, state, depth) {
  // RawInclude is handled in `before` (its content is a leaf string, nothing
  // below it to descend into). Include is handled in `after` so the includer's
  // passed-in `node.block` is fully walked before being yielded into the linked
  // child subtree.
  return walk(
    ast,
    function before(node, replace) {
      if (node.type === 'RawInclude' && node.filters.length === 0) {
        replace({
          type: 'Text',
          val: normalizeTextNewlines(node.file.str),
          line: node.line,
          column: node.column,
          filename: node.filename,
        });
      }
    },
    function after(node, replace) {
      if (node.type === 'Include') {
        assertLinkEdge(depth, state.maxDepth, node, diagnosticSources(options));
        // linkInner, not link: the included subtree is linted as part of the
        // final assembled tree by the top-level link() wrapper. Calling link()
        // here would lint it again, multiplying warnings by include depth.
        let childAST = linkInner(node.file.ast, options, state, depth + 1);
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
    // Mixin declarations/calls own their NamedBlock slots. Only flatten the
    // inheritance wrappers of the included, already-extended document.
    if (node.type === 'Mixin') return false;
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

// ASTs are arrays/plain records plus Buffer payloads attached to RawInclude
// nodes. structuredClone preserves the graph, but converts those Buffers to
// Uint8Arrays. Clone the AST graph explicitly so binary filters keep receiving
// the loader's Buffer contract while aliases within one copy stay aliases.
function cloneAst(value, copies, deferDependencies) {
  if (value === null || typeof value !== 'object') return value;
  copies = copies || new Map();
  if (copies.has(value)) return copies.get(value);

  if (Buffer.isBuffer(value)) {
    const copy = Buffer.from(value);
    copies.set(value, copy);
    return copy;
  }

  const copy = Array.isArray(value)
    ? []
    : Object.create(Object.getPrototypeOf(value));
  copies.set(value, copy);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      descriptor.value =
        deferDependencies && value.type === 'FileReference' && key === 'ast'
          ? descriptor.value
          : cloneAst(descriptor.value, copies, deferDependencies);
    }
    Object.defineProperty(copy, key, descriptor);
  }
  return copy;
}

// Clone one physical syntax tree while retaining dependency ASTs as deferred
// inputs. Each dependency is copied independently when its include/extends edge
// is followed, which gives every rendered occurrence single ownership even if
// a direct API caller reuses the same FileReference.ast object.
function cloneOwnedAst(value) {
  return cloneAst(value, undefined, true);
}

function applyYield(ast, block, includeNode, options) {
  if (!block || !block.nodes.length) return ast;
  let replaced = false;
  ast = walk(ast, null, function (node, replace) {
    if (node.type === 'YieldBlock') {
      // Clone per yield site: an included template may contain more than one
      // `yield`, and a shared mutable subtree would (a) duplicate any id-bearing
      // node, tripping DUPLICATE_ID, and (b) be miscounted by later passes
      // (e.g. a footnote ref in yielded content would render twice but get a
      // single backlink). Each yield position gets an independent copy.
      replaced = true;
      node.type = 'Block';
      node.nodes = [cloneAst(block)];
    }
  });
  if (!replaced) {
    error(
      'MISSING_YIELD',
      'Included template has no yield block but the include passes a block into it',
      includeNode,
      diagnosticSources(options),
    );
  }
  return ast;
}

// Look up a reference definition by name, throwing the shared UNDEFINED_REFERENCE
// error if it is missing. Used by both the ReferenceLink and ReferenceImage
// branches so the error message and code stay in one place.
function resolveDefOrThrow(node, definitions, sources) {
  const def = definitions[node.name];
  if (def === undefined) {
    error(
      'UNDEFINED_REFERENCE',
      "Undefined reference '" + node.name + "'",
      node,
      sources,
    );
  }
  return def;
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
      const def = resolveDefOrThrow(node, definitions, sources);
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
      appendReferenceAttributes(
        attrs,
        node.attrs,
        LINK_RESERVED_ATTRIBUTES,
        sources,
      );

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
      const def = resolveDefOrThrow(node, definitions, sources);
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

      // Flatten the alt block to text via the same recursive helper TOC uses,
      // so structured alt content (if it ever reaches here) is not silently
      // dropped the way a top-level-Text-only filter would drop it.
      const altText = extractText(altBlock.nodes);

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
      appendReferenceAttributes(
        attrs,
        node.attrs,
        IMAGE_RESERVED_ATTRIBUTES,
        sources,
      );

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
      return digits[Number(d)];
    })
    .join('');
}

// Footnote anchor id scheme. The forward reference (`<sup><a id=…>`) and the
// matching backlink (`<a href="#…">` in the rendered list item) MUST produce
// identical strings for the same (name, index) or the bidirectional navigation
// breaks silently. Keep both behind these helpers so the scheme can only be
// changed in one place. NOTE: this encoding is not injective across the two id
// families for adversarial footnote names (e.g. `x` referenced twice collides
// with `x-2`, and a footnote named `reference-x` collides with `x`'s ref
// anchor); making the families provably disjoint is tracked separately because
// it also changes the shared /test-cases oracles.
function footnoteDefId(name) {
  return 'footnote-' + name;
}

function footnoteRefId(name, index) {
  return index === 1
    ? 'footnote-reference-' + name
    : 'footnote-reference-' + name + '-' + index;
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
          'Only one footnotes block is allowed per document',
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
  const numberedNames = [];
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
      numberedNames.push(name);
    }

    const num = numberByName[name];
    const refIndex = ++refCountByName[name];
    const refId = footnoteRefId(name, refIndex);

    const anchorNode = {
      type: 'Tag',
      name: 'a',
      attrs: [
        {
          name: 'href',
          val: '#' + footnoteDefId(name),
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

  // Resolve definition bodies in the exact order their names first receive a
  // number. Newly reached definitions append to the same queue, so every
  // reachable body is processed once and numeric-looking names cannot be
  // reordered by Object key enumeration.
  for (let index = 0; index < numberedNames.length; index++) {
    const name = numberedNames[index];
    const def = definitions[name];
    if (def && def.block) {
      def.block = walk(def.block, function (innerNode, innerReplace) {
        if (innerNode.type === 'FootnoteRef') {
          resolveRef(innerNode, innerReplace);
          return false;
        }
      });
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
      const referenced = numberedNames;

      if (referenced.length === 0) {
        replace([]);
        return false;
      }

      const listItems = referenced.map(function (name) {
        const def = definitions[name];
        const totalRefs = refCountByName[name];

        const backLinkNodes = [];
        for (let i = 1; i <= totalRefs; i++) {
          const backId = footnoteRefId(name, i);
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

        // Parser-produced footnote bodies carry deferred line separators that
        // the renderer resolves after optional mixin variables are bound. Keep
        // that Block intact so its boundary remains scoped to source content
        // and cannot attach to a generated backlink. Continue accepting the
        // legacy flat shape for callers that construct linker ASTs directly.
        const liContentNodes = def.block
          ? def.block.isFootnoteBody
            ? [def.block]
            : def.block.nodes.slice()
          : [];
        appendItems(liContentNodes, backLinkNodes);

        return {
          type: 'Tag',
          name: 'li',
          attrs: [
            {
              name: 'id',
              val: footnoteDefId(name),
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
    if (node.type === 'Tag') {
      const headingName = asciiLowerCase(node.name);
      if (!/^h[1-6]$/.test(headingName)) return;
      const idAttr =
        node.attrs &&
        node.attrs.find(function (a) {
          return asciiLowerCase(a.name) === 'id';
        });
      // Match lintDocument's id contract: a valueless/boolean id (val === true)
      // is not a usable anchor target, so skip it rather than emit href="#true".
      if (!idAttr || !isUsableId(idAttr.val)) return;

      let text = '';
      if (node.block && node.block.nodes) {
        text = extractText(node.block.nodes);
      }

      headings.push({
        level: parseInt(headingName[1], 10),
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
  const pending = nodes.slice().reverse();
  while (pending.length > 0) {
    const node = pending.pop();
    if (node.type === 'Text') {
      text += node.val;
      continue;
    }
    if (node.type === 'Tag' && asciiLowerCase(node.name) === 'img') {
      const alt = node.attrs.find(function (attr) {
        return asciiLowerCase(attr.name) === 'alt';
      });
      if (alt && typeof alt.val === 'string') text += alt.val;
      continue;
    }
    const children = Array.isArray(node.nodes)
      ? node.nodes
      : node.block && Array.isArray(node.block.nodes)
      ? node.block.nodes
      : null;
    if (children) {
      for (let index = children.length - 1; index >= 0; index--) {
        pending.push(children[index]);
      }
    }
  }
  return text;
}

function isUsableId(value) {
  return (
    typeof value === 'string' && value !== '' && !/[\t\n\f\r ]/.test(value)
  );
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
  let i = start;

  while (i < end) {
    const heading = headings[i];
    // Find the range of children (deeper headings until next same-or-higher level)
    let j = i + 1;
    while (j < end && headings[j].level > heading.level) {
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
