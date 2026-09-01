const walk = require('pugneum-walker');
const assemble = require('./assembly');
const diagnostics = require('./diagnostics');
const expandMixinInstances = require('./mixins');
const nodes = require('./nodes');
const resolveRetainedInterpolation =
  expandMixinInstances.resolveRetainedInterpolation;
const mixinEnvironment = Symbol.for('pugneum.mixinEnvironment');

const diagnosticSources = diagnostics.sources;
const error = diagnostics.error;
const warn = diagnostics.warn;

function asciiLowerCase(value) {
  return value.replace(/[A-Z]/g, function (character) {
    return String.fromCharCode(character.charCodeAt(0) + 32);
  });
}

function resolvedReferenceUrl(definition, use, sources) {
  const environment = use[mixinEnvironment];
  return resolveRetainedInterpolation(
    String(definition.url),
    definition,
    function (name) {
      if (!environment) {
        error(
          'VARIABLE_OUTSIDE_MIXIN',
          `Variable '${name}' used outside mixin`,
          use,
          sources,
        );
      }
      const value = environment[name];
      if (value === undefined) {
        error(
          'UNDEFINED_VARIABLE',
          `Variable '${name}' is undefined`,
          use,
          sources,
        );
      }
      return value;
    },
  );
}

function appendItems(target, items) {
  for (let index = 0; index < items.length; index++) {
    target.push(items[index]);
  }
}

function commentText(node, value) {
  return nodes.text(node, value);
}

function commentBlock(node, fallback) {
  if (node.block && node.block.nodes.length > 0) {
    return isolateCommentBlock(node.block);
  }
  return nodes.block(
    node,
    fallback === '' ? [] : [commentText(node, fallback)],
  );
}

// A buffered comment's body is rendered locally into one HTML comment string,
// not into the document DOM. Remove document-global constructs while retaining
// their authored local label/text so the renderer never needs unresolved nodes
// and the hidden subtree cannot create visible TOC/endnote/navigation output.
function isolateCommentBlock(block) {
  return walk(block, function (node, replace) {
    if (node.type === 'BlockComment') {
      node.block = isolateCommentBlock(node.block);
      return false;
    }
    if (node.type === 'ReferenceLink') {
      replace.final(commentBlock(node, node.name));
    }
    if (node.type === 'ReferenceImage') {
      replace.final(commentBlock(node, ''));
    }
    if (node.type === 'FootnoteRef') {
      replace.final(commentText(node, '^[' + node.name + ']'));
    }
    if (
      node.type === 'References' ||
      node.type === 'Footnotes' ||
      node.type === 'Toc'
    ) {
      replace.final(commentBlock(node, ''));
    }
  });
}

function walkDocumentContent(ast, before) {
  return walk(ast, function (node, replace, control) {
    if (node.type === 'BlockComment') return false;
    return before(node, replace, control);
  });
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

function isIdAttribute(attribute) {
  return asciiLowerCase(attribute.name) === 'id';
}

function isStringIdAttribute(attribute) {
  return isIdAttribute(attribute) && typeof attribute.val === 'string';
}

function isUsableIdAttribute(attribute) {
  return (
    isStringIdAttribute(attribute) &&
    attribute.val !== '' &&
    !/[\t\n\f\r ]/.test(attribute.val)
  );
}

function lintNode(node, sources, warnings, seenIds) {
  if (node.type !== 'Tag') return;
  const attrs = node.attrs || [];
  for (const attr of attrs) {
    if (isStringIdAttribute(attr)) {
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
}

// Whole-document lints. Run once by link() on the final, fully assembled tree.
function lintDocument(ast, sources, warnings) {
  const seenIds = Object.create(null);
  walkDocumentContent(ast, function (node) {
    lintNode(node, sources, warnings, seenIds);
  });
}

// Isolate comment-local syntax, discover optional document features, and
// tentatively lint the untransformed tree in one pass. When no resolver can
// rewrite the document, these lint results are already final; otherwise they
// are discarded and lintDocument runs over the transformed tree so warning
// order and visibility retain their established contract.
function censusDocumentSemantics(ast, sources) {
  const features = {
    references: false,
    footnotes: false,
    footnoteDefinitions: false,
    toc: false,
  };
  const lintWarnings = [];
  const seenIds = Object.create(null);

  ast = walk(ast, function (node) {
    if (node.type === 'BlockComment') {
      node.block = isolateCommentBlock(node.block);
      return false;
    }

    switch (node.type) {
      case 'References':
      case 'ReferenceLink':
      case 'ReferenceImage':
        features.references = true;
        break;
      case 'Footnotes':
        features.footnotes = true;
        features.footnoteDefinitions = true;
        break;
      case 'FootnoteRef':
        features.footnotes = true;
        break;
      case 'Toc':
        features.toc = true;
        break;
    }

    lintNode(node, sources, lintWarnings, seenIds);
  });

  return {ast, features, lintWarnings};
}

const DEFAULT_MAX_LINK_DEPTH = assemble.DEFAULT_MAX_DEPTH;

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
  return resolveDocument(assemble(ast, options), options);
}

// Assembly only: template inheritance (extends/blocks) + includes. No reference/
// footnote/toc resolution and no whole-document lint — those run later, in
// resolve(), over the fully assembled + filtered tree.
link.assemble = function (ast, options) {
  options = prepareLink(ast, options);
  return assemble(ast, options);
};

// Document-level resolution over the final assembled + filtered tree: references,
// then TOC, then footnotes, then the whole-document lint. resolveToc must run
// before resolveFootnotes (heading text is captured before footnote [n] markers
// exist, so a heading like `h2#sec Title^[n]` does not pull a resolved "[1]" into
// its TOC entry). lintDocument runs last so it sees resolution-generated ids
// (footnote ids, etc.).
function resolveDocument(ast, options) {
  const expansion = expandMixinInstances(ast, options, isolateCommentBlock);
  ast = expansion.ast;
  const sources = diagnosticSources(options);
  const warnings = options.warnings;
  const census = censusDocumentSemantics(ast, sources);
  const features = census.features;
  ast = census.ast;

  if (features.references) {
    const reachableFootnotes = features.footnoteDefinitions
      ? findReachableFootnoteDefinitions(ast)
      : [];
    ast = resolveReferences(ast, sources, warnings, reachableFootnotes);
  }
  if (features.toc) ast = resolveToc(ast, sources, warnings);
  if (features.footnotes) ast = resolveFootnotes(ast, sources, warnings);

  if (features.references || features.toc || features.footnotes) {
    lintDocument(ast, sources, warnings);
  } else {
    appendItems(warnings, census.lintWarnings);
  }
  expansion.finish();
  return ast;
}
link.resolve = function (ast, options) {
  options = prepareLink(ast, options);
  return resolveDocument(assemble.cloneAst(ast), options);
};

function prepareLink(ast, options) {
  options = validateOptions(options);
  assemble.validateRoot(ast, diagnosticSources(options));
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

// Return definition records reachable from FootnoteRef nodes outside the
// Footnotes container, then transitively through reached definition bodies.
// This is deliberately a non-validating index: resolveFootnotes retains the
// established diagnostic ordering for duplicate/invalid/undefined footnotes.
function findReachableFootnoteDefinitions(ast) {
  const definitions = Object.create(null);
  const names = [];
  const enqueued = Object.create(null);
  function enqueue(node) {
    if (node.type === 'FootnoteRef' && !(node.name in enqueued)) {
      enqueued[node.name] = true;
      names.push(node.name);
    }
  }

  walkDocumentContent(ast, function (node) {
    if (node.type === 'Footnotes') {
      for (const definition of node.definitions) {
        if (!(definition.name in definitions)) {
          definitions[definition.name] = definition;
        }
      }
      return false;
    }
    enqueue(node);
  });

  const reachable = [];
  for (let index = 0; index < names.length; index++) {
    const definition = definitions[names[index]];
    if (!definition || !definition.block) continue;
    reachable.push(definition);
    walkDocumentContent(definition.block, function (node) {
      if (node.type === 'Footnotes') return false;
      enqueue(node);
    });
  }
  return reachable;
}

// Walk the rendered document while pruning the Footnotes container, then walk
// only definition bodies that the footnote reachability queue selected. This
// keeps reference collection, resolution, and unused diagnostics on the same
// content graph without requiring reference and footnote syntax to be coupled.
function walkReferenceContent(ast, reachableFootnotes, before) {
  function visit(node, replace, control) {
    if (node.type === 'Footnotes' || node.type === 'BlockComment') return false;
    return before(node, replace, control);
  }

  ast = walk(ast, visit);
  for (const definition of reachableFootnotes) {
    definition.block = walk(definition.block, visit);
  }
  return ast;
}

function resolveReferences(ast, sources, warnings, reachableFootnotes) {
  const definitions = Object.create(null);
  const used = Object.create(null);
  walkReferenceContent(ast, reachableFootnotes, function (node) {
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

  function resolveReferenceNode(node, replace) {
    if (node.type === 'References') {
      replace.final([]);
    }
    if (node.type === 'ReferenceLink' || node.type === 'ReferenceImage') {
      used[node.name] = true;
    }
    if (node.type === 'ReferenceLink') {
      const def = resolveDefOrThrow(node, definitions, sources);
      const url = resolvedReferenceUrl(def.node, node, sources);

      let block = node.block;
      if (!block || block.nodes.length === 0) {
        const fallbackText = def.defaultText || node.name;
        block = nodes.block(node, [nodes.text(node, fallbackText)]);
      }

      const attrs = [];
      if (url !== null) {
        attrs.push(nodes.resolvedAttribute(node, 'href', url));
      }
      appendReferenceAttributes(
        attrs,
        node.attrs,
        LINK_RESERVED_ATTRIBUTES,
        sources,
      );

      replace.revisit(
        nodes.tag(node, {
          name: 'a',
          attrs,
          block,
          isInline: true,
        }),
      );
    }
    if (node.type === 'ReferenceImage') {
      const def = resolveDefOrThrow(node, definitions, sources);
      const url = resolvedReferenceUrl(def.node, node, sources);

      let altBlock = node.block;
      if (!altBlock || altBlock.nodes.length === 0) {
        const fallbackAlt = def.defaultText || '';
        altBlock = nodes.block(node, [nodes.text(node, fallbackAlt)]);
      }

      // Flatten the alt block to text via the same recursive helper TOC uses,
      // so structured alt content (if it ever reaches here) is not silently
      // dropped the way a top-level-Text-only filter would drop it.
      const altText = extractText(altBlock.nodes);

      const attrs = [];
      if (url !== null) {
        attrs.push(nodes.resolvedAttribute(node, 'src', url));
      }
      attrs.push(nodes.resolvedAttribute(node, 'alt', altText));
      appendReferenceAttributes(
        attrs,
        node.attrs,
        IMAGE_RESERVED_ATTRIBUTES,
        sources,
      );

      replace.revisit(
        nodes.tag(node, {
          name: 'img',
          attrs,
          isInline: true,
          selfClosing: true,
        }),
      );
    }
  }

  const result = walkReferenceContent(
    ast,
    reachableFootnotes,
    resolveReferenceNode,
  );

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

// Preferred footnote anchor ids retain the established readable output. Actual
// ids are allocated once from the document-wide namespace below, because these
// candidates are not injective for adversarial names (`x` reference 2 versus
// `x-2` reference 1, or definition `reference-x` versus reference `x`) and can
// also collide with author-provided ids.
function footnoteDefId(name) {
  return 'footnote-' + name;
}

function footnoteRefId(name, index) {
  return index === 1
    ? 'footnote-reference-' + name
    : 'footnote-reference-' + name + '-' + index;
}

function allocateDocumentId(preferred, allocatedIds) {
  let id = preferred;
  let suffix = 2;
  while (allocatedIds.has(id)) {
    id = preferred + '-' + suffix++;
  }
  allocatedIds.add(id);
  return id;
}

function resolveFootnotes(ast, sources, warnings) {
  const definitions = Object.create(null);
  const allocatedIds = new Set();
  let footnotesBlockCount = 0;

  // Pass 1: reserve every existing document id, collect definitions, and error
  // on duplicates and multiple blocks. Reserving in this existing walk keeps
  // generated footnote anchors from colliding with authored or earlier-pass
  // ids without adding another whole-document traversal.
  walkDocumentContent(ast, function (node) {
    if (node.type === 'Tag') {
      for (const attr of node.attrs || []) {
        if (isStringIdAttribute(attr)) {
          allocatedIds.add(attr.val);
        }
      }
    }
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
  const defIdByName = Object.create(null);
  const refIdsByName = Object.create(null);
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
      defIdByName[name] = allocateDocumentId(footnoteDefId(name), allocatedIds);
      refIdsByName[name] = [];
      numberedNames.push(name);
    }

    const num = numberByName[name];
    const refIndex = ++refCountByName[name];
    const refId = allocateDocumentId(
      footnoteRefId(name, refIndex),
      allocatedIds,
    );
    refIdsByName[name].push(refId);

    const anchorNode = nodes.tag(node, {
      name: 'a',
      attrs: [
        nodes.attribute(node, 'href', '#' + defIdByName[name]),
        nodes.attribute(node, 'id', refId),
        nodes.attribute(node, 'role', 'doc-noteref'),
      ],
      isInline: true,
      nodes: [nodes.text(node, '[' + num + ']')],
    });

    replace.final(
      nodes.tag(node, {
        name: 'sup',
        isInline: true,
        nodes: [anchorNode],
      }),
    );
  }

  // Resolve refs in main document (skip into Footnotes definitions)
  ast = walkDocumentContent(ast, function before(node, replace) {
    if (node.type === 'FootnoteRef') {
      resolveRef(node, replace);
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
      def.block = walkDocumentContent(
        def.block,
        function (innerNode, innerReplace) {
          if (innerNode.type === 'FootnoteRef') {
            resolveRef(innerNode, innerReplace);
          }
        },
      );
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
  return walkDocumentContent(ast, function before(node, replace) {
    if (node.type === 'Footnotes') {
      const referenced = numberedNames;

      if (referenced.length === 0) {
        replace.final([]);
        return;
      }

      const listItems = referenced.map(function (name) {
        const def = definitions[name];
        const totalRefs = refCountByName[name];

        const backLinkNodes = [];
        for (let i = 1; i <= totalRefs; i++) {
          const backId = refIdsByName[name][i - 1];
          const label = i === 1 ? '↩' : '↩' + toSuperscript(i);
          backLinkNodes.push(
            nodes.tag(def, {
              name: 'a',
              attrs: [
                nodes.attribute(def, 'href', '#' + backId),
                nodes.attribute(def, 'role', 'doc-backlink'),
              ],
              isInline: true,
              nodes: [nodes.text(def, label)],
            }),
          );
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

        return nodes.tag(def, {
          name: 'li',
          attrs: [
            nodes.attribute(def, 'id', defIdByName[name]),
            nodes.attribute(def, 'role', 'doc-endnote'),
          ],
          nodes: liContentNodes,
        });
      });

      const olNode = nodes.tag(node, {
        name: 'ol',
        nodes: listItems,
      });

      replace.final(
        nodes.tag(node, {
          name: 'section',
          attrs: [nodes.attribute(node, 'role', 'doc-endnotes')],
          nodes: [olNode],
        }),
      );
    }
  });
}

function resolveToc(ast, sources, warnings) {
  const headings = [];

  // Pass 1: collect headings with IDs
  walkDocumentContent(ast, function (node) {
    if (node.type === 'Tag') {
      const headingName = asciiLowerCase(node.name);
      if (!/^h[1-6]$/.test(headingName)) return;
      const idAttr = node.attrs && node.attrs.find(isIdAttribute);
      // Duplicate-id linting sees every string id, while TOC links need a
      // nonempty fragment without ASCII whitespace.
      if (!idAttr || !isUsableIdAttribute(idAttr)) return;

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
    return walkDocumentContent(ast, function (node, replace) {
      if (node.type === 'Toc') {
        warn(
          'EMPTY_TOC',
          'toc has no entries: no headings with an explicit id were found',
          node,
          sources,
          warnings,
        );
        replace.final([]);
      }
    });
  }

  // Pass 2: replace Toc nodes with nav structure
  return walkDocumentContent(ast, function before(node, replace) {
    if (node.type === 'Toc') {
      replace.final(buildTocNav(headings, node));
    }
  });
}

function extractText(nodes) {
  let text = '';
  const pending = nodes.slice().reverse();
  while (pending.length > 0) {
    const node = pending.pop();
    if (node.type === 'BlockComment') continue;
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

function buildTocNav(headings, tocNode) {
  const items = buildTocItems(headings, 0, headings.length, tocNode);

  const ol = nodes.tag(tocNode, {
    name: 'ol',
    nodes: items,
  });

  return nodes.tag(tocNode, {
    name: 'nav',
    attrs: [
      nodes.attribute(tocNode, 'role', 'doc-toc'),
      nodes.attribute(tocNode, 'aria-label', 'Table of contents'),
    ],
    nodes: [ol],
  });
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
    const link = nodes.tag(tocNode, {
      name: 'a',
      attrs: [nodes.resolvedAttribute(tocNode, 'href', '#' + heading.id)],
      isInline: true,
      nodes: [nodes.text(tocNode, heading.text)],
    });

    // Build children (sub-headings)
    const liContent = [link];
    if (j > i + 1) {
      const childItems = buildTocItems(headings, i + 1, j, tocNode);
      if (childItems.length > 0) {
        liContent.push(
          nodes.tag(tocNode, {
            name: 'ol',
            nodes: childItems,
          }),
        );
      }
    }

    items.push(nodes.tag(tocNode, {name: 'li', nodes: liContent}));

    i = j;
  }

  return items;
}
