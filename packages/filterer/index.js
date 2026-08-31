const error = require('pugneum-error');
const walk = require('pugneum-walker');

module.exports = applyFilters;

const packagePrefix = 'pugneum-filter-';

const validFilterTypes = new Set(['text', 'html', 'pugneum', 'syntax']);

// These constructs require loading or template assembly, both of which run
// BEFORE the filterer. Generated output cannot introduce them resolvably at
// this stage. NamedBlock is handled contextually below because it is too late
// for a template override but still valid as a renderer-owned mixin slot.
//
// Reference/footnote/toc constructs a filter emits need NO special handling
// here: the document-level resolution pass (pugneum-linker's `resolve`) runs
// AFTER the filterer over the whole assembled tree (see packages/pugneum), so
// they resolve there alongside the rest of the document.
const earlierPhaseTypes = new Set([
  'Include',
  'Extends',
  'RawInclude',
  'FileReference',
  'IncludeFilter',
  'YieldBlock',
]);

// Return the first generated node that has no owner at the post-assembly filter
// stage. The walker exposes nearest-parent-first ancestry during `before`, so a
// NamedBlock remains legal only under a Mixin (definition or call), while
// Given/MixinBlock/Variable retain the parser's mixin-context restrictions.
function firstUnsupportedGeneratedNode(ast) {
  const root = generatedRoot(ast);
  const parents = [];
  let hit = null;
  walk(
    root,
    function (node, replace, control) {
      const mixinAncestors = parents.filter(
        (parent) => parent.type === 'Mixin',
      );
      const insideMixin = mixinAncestors.length > 0;
      const insideMixinDefinition = mixinAncestors.some(
        (mixin) => mixin.call === false,
      );
      const nearestMixin = mixinAncestors[0];

      if (
        earlierPhaseTypes.has(node.type) ||
        (node.type === 'NamedBlock' && !insideMixin) ||
        (node.type === 'Given' &&
          (!nearestMixin || nearestMixin.call !== false)) ||
        ((node.type === 'MixinBlock' || node.type === 'Variable') &&
          !insideMixinDefinition)
      ) {
        hit = node;
        control.stop();
      }
    },
    {parents},
  );
  return hit;
}

function generatedRoot(ast) {
  return Array.isArray(ast) ? {type: 'Block', nodes: ast} : ast;
}

function validateGeneratedAst(
  ast,
  name,
  type,
  invocation,
  options,
  context,
  invocationDepth,
) {
  const root = generatedRoot(ast);
  try {
    const remainingDepth = walk.MAX_AST_DEPTH - invocationDepth;
    if (remainingDepth < 0) {
      throw new Error(
        'structural depth exceeds maximum of ' + walk.MAX_AST_DEPTH,
      );
    }
    walk.validate(root, {
      allowAliases: false,
      forbiddenNodes: context.ownedNodes,
      maxDepth: remainingDepth,
    });
  } catch (validationError) {
    throw error(
      'INVALID_FILTER_OUTPUT',
      `Filter '${name}' (type ${type}) returned invalid AST: ${validationError.message}`,
      nodeLocation(invocation, options),
    );
  }

  const unsupported = firstUnsupportedGeneratedNode(root);
  if (unsupported) {
    throw error(
      'UNSUPPORTED_FILTER_CONSTRUCT',
      `Filter '${name}' (type ${type}) cannot emit ${unsupported.type}: ` +
        'file loading and template assembly run before filters',
      nodeLocation(invocation, options),
    );
  }
}

function stampGeneratedProvenance(ast, invocation, ownedNodes) {
  const root = generatedRoot(ast);
  walk(root, function (node) {
    if (node !== root) {
      stampLocation(node, invocation);
      ownedNodes.add(node);
    }
    for (const attr of node.attrs || []) {
      stampLocation(attr, invocation);
      ownedNodes.add(attr);
    }
    for (const definition of node.definitions || []) {
      stampLocation(definition, invocation);
      ownedNodes.add(definition);
    }
  });
}

function stampLocation(record, invocation) {
  if (record.filename == null || record.filename === '') {
    record.filename = invocation.filename;
  }
  if (record.line == null) record.line = invocation.line;
  if (record.column == null) record.column = invocation.column;
}

// Build the location/source context object shared by every error() call in
// this file. Threading options through lets filterer diagnostics render the
// same ±3-line code frame the lexer/parser/linker produce: pugneum-error only
// emits the frame when `source` is a non-empty string containing the line
// (see packages/error/index.js). `options.sources` is the loader-populated
// filename→source map; `options.source` is the entry-file source.
function nodeLocation(node, options) {
  const sources = options && options.sources;
  const filename = node ? node.filename : '';
  const source =
    (sources && filename && sources[filename]) ||
    (options && options.source) ||
    '';
  return {
    line: node ? node.line : 0,
    column: node ? node.column : 0,
    filename: filename || '',
    source,
  };
}

function validateFilterType(resolved, name, node, options) {
  if (!resolved.type) {
    throw error(
      'MISSING_FILTER_TYPE',
      `Filter '${name}' must declare a type (text, html, pugneum, or syntax)`,
      nodeLocation(node, options),
    );
  }
  if (!validFilterTypes.has(resolved.type)) {
    throw error(
      'INVALID_FILTER_TYPE',
      `Filter '${name}' has unknown type '${resolved.type}' (must be text, html, pugneum, or syntax)`,
      nodeLocation(node, options),
    );
  }
}

function escapeFilterText(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function validateStringOutput(result, name, type, node, options) {
  if (typeof result !== 'string') {
    throw error(
      'INVALID_FILTER_OUTPUT',
      `Filter '${name}' (type ${type}) must return a string`,
      nodeLocation(node, options),
    );
  }
}

function validateArrayOutput(result, name, type, node, options) {
  if (!Array.isArray(result)) {
    throw error(
      'INVALID_FILTER_OUTPUT',
      `Filter '${name}' (type ${type}) must return an array of AST nodes`,
      nodeLocation(node, options),
    );
  }
}

// Strip the properties that make a node a Filter so it can be re-typed as a
// Text or Block node. Keeping this in one place means a new Filter-only
// property only has to be remembered here. `name` is removed too so the
// rewritten node carries no stale filter name.
function stripFilterFields(node) {
  delete node.block;
  delete node.attrs;
  delete node.attributeBlocks;
  delete node.name;
}

function applyFilterResult(
  node,
  type,
  result,
  name,
  options,
  context,
  nodeDepth,
) {
  switch (type) {
    case 'text':
      validateStringOutput(result, name, type, node, options);
      node.type = 'Text';
      node.val = escapeFilterText(result);
      stripFilterFields(node);
      break;
    case 'html':
      validateStringOutput(result, name, type, node, options);
      node.type = 'Text';
      node.val = result;
      stripFilterFields(node);
      break;
    case 'pugneum': {
      validateStringOutput(result, name, type, node, options);
      const ast = parsePugneum(result, node, options);
      validateGeneratedAst(ast, name, type, node, options, context, nodeDepth);
      stampGeneratedProvenance(ast, node, context.ownedNodes);
      node.type = 'Block';
      node.nodes = ast.nodes;
      stripFilterFields(node);
      delete node.val;
      break;
    }
    case 'syntax': {
      validateArrayOutput(result, name, type, node, options);
      validateGeneratedAst(
        result,
        name,
        type,
        node,
        options,
        context,
        nodeDepth,
      );
      stampGeneratedProvenance(result, node, context.ownedNodes);
      node.type = 'Block';
      node.nodes = result;
      stripFilterFields(node);
      delete node.val;
      break;
    }
    default:
      // validateFilterType runs before every applyFilterResult call, so this
      // is unreachable in normal flow; guard it so the dispatcher is
      // self-defending if a new call path forgets that ordering.
      throw error(
        'INVALID_FILTER_TYPE',
        `Filter '${name}' has unknown type '${type}' (must be text, html, pugneum, or syntax)`,
        nodeLocation(node, options),
      );
  }
}

// Re-lex/re-parse a pugneum-type filter's output into AST nodes. The whole
// options object is threaded through (overriding only the per-source bits) so
// that lexer/parser options such as `warnings` reach this re-lex the same way
// they reach the loader's re-lex of included files. lexer/parser are required
// lazily so a build using no pugneum/syntax filters never loads them.
//
// Reference/footnote/toc constructs in the output need nothing here: the
// document-level resolution pass runs AFTER the filterer (see packages/pugneum),
// so they resolve over the whole assembled tree. A loader construct
// (include/extends/raw-include) CANNOT be resolved downstream — the loader ran
// before the filterer, so the target was never read. Both this parsed tree and
// direct syntax output pass through validateGeneratedAst before insertion.
function parsePugneum(result, node, options) {
  const lex = require('pugneum-lexer');
  const parse = require('pugneum-parser');
  const reopts = Object.assign({}, options, {
    filename: node.filename,
    source: result,
  });
  const tokens = lex(result, reopts);
  return parse(tokens, reopts);
}

// Snapshot structural ownership before filters run so a plugin cannot insert
// an existing surrounding/sibling node or reuse one result object at multiple
// invocations. This collector is deliberately tolerant rather than a second
// input validator: direct filterer callers historically pass post-loader
// RawInclude.file records without a `type`, and the RawInclude handler consumes
// those records before the walker would descend into them. Generated output is
// still subjected to the strict shared schema below.
function collectOwnedNodes(ast, ownedNodes) {
  const pending = Array.isArray(ast) ? ast.slice() : [ast];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node == null || typeof node !== 'object' || ownedNodes.has(node)) {
      continue;
    }
    ownedNodes.add(node);

    switch (node.type) {
      case 'Block':
      case 'NamedBlock':
        pushAll(node.nodes);
        break;
      case 'Filter':
      case 'Mixin':
      case 'Tag':
      case 'InterpolatedTag':
      case 'BlockComment':
      case 'ReferenceLink':
      case 'ReferenceImage':
      case 'FootnoteRef':
      case 'Given':
        push(node.block);
        break;
      case 'Include':
        push(node.block);
        push(node.file);
        break;
      case 'Extends':
        push(node.file);
        break;
      case 'RawInclude':
        pushAll(node.filters);
        push(node.file);
        break;
      case 'Footnotes':
        for (const definition of node.definitions || []) {
          push(definition);
          push(definition && definition.block);
        }
        break;
      case 'References':
        pushAll(node.definitions);
        break;
      case 'FileReference':
        push(node.ast);
        break;
    }
    pushAll(node.attrs);
  }

  function push(value) {
    if (value != null && typeof value === 'object') pending.push(value);
  }

  function pushAll(values) {
    if (!Array.isArray(values)) return;
    for (const value of values) push(value);
  }
}

function applyFilters(ast, filters, options, context) {
  options = options || {};
  if (!context) {
    const ownedNodes = new WeakSet();
    collectOwnedNodes(ast, ownedNodes);
    context = {baseDepth: 0, ownedNodes};
  }
  const parents = [];
  walk(
    ast,
    function (node) {
      const nodeDepth = context.baseDepth + parents.length;
      if (node.type === 'Filter') {
        handleNestedFilters(node, filters, options, context, nodeDepth);
        const text = getBodyAsText(node, options);
        const attrs = getAttributes(node, options);
        attrs.filename = node.filename;
        const resolved = resolveFilter(node.name, filters, node, options);
        validateFilterType(resolved, node.name, node, options);
        const result = runFilter(resolved, node.name, text, attrs, node);
        applyFilterResult(
          node,
          resolved.type,
          result,
          node.name,
          options,
          context,
          nodeDepth,
        );
      } else if (node.type === 'RawInclude' && node.filters.length) {
        // Source order [a, b, c] applies right-to-left: c (innermost) wraps the
        // file content, then b, then a (outermost), matching nested `:` order.
        const chain = node.filters.slice().reverse();
        // The innermost filter reads the file; its `binary` flag chooses raw
        // bytes vs decoded text. Each later filter consumes the previous result.
        const innermost = resolveFilter(chain[0].name, filters, node, options);
        let result = innermost.binary ? node.file.raw : node.file.str;
        let lastName;
        let lastType;
        chain.forEach(function (f) {
          const filterAttrs = getAttributes(f, options);
          filterAttrs.filename = node.file.fullPath;
          const resolved = resolveFilter(f.name, filters, node, options);
          validateIncludeFilterType(resolved, f.name, node, options);
          result = runFilter(resolved, f.name, result, filterAttrs, node);
          // Validate every stage's output, not just the final one, so a
          // misbehaving intermediate filter yields a clear INVALID_FILTER_OUTPUT
          // naming the stage that failed rather than silent garbage downstream.
          validateStringOutput(result, f.name, resolved.type, node, options);
          lastName = f.name;
          lastType = resolved.type;
        });
        node.type = 'Text';
        node.val = lastType === 'text' ? escapeFilterText(result) : result;
        delete node.filters;
        delete node.file;
      }
    },
    {includeDependencies: true, parents},
  );
  return ast;
}

// Resolve a nested inner filter in place. Nested filters (`:outer:inner`) parse
// to a Filter node whose sole child at nodes[0] is the next Filter; recursing
// through the walker resolves the whole chain inner-first. applyFilters mutates
// the block in place, so calling it for its side effect is sufficient — no
// reassignment needed. The block guard mirrors getBodyAsText so a blockless
// Filter node (only reachable from a syntax filter emitting one) does not crash
// with a raw TypeError.
function handleNestedFilters(node, filters, options, context, nodeDepth) {
  if (
    node.block &&
    node.block.nodes[0] &&
    node.block.nodes[0].type === 'Filter'
  ) {
    applyFilters(node.block, filters, options, {
      baseDepth: nodeDepth + 1,
      ownedNodes: context.ownedNodes,
    });
  }
}

function validateIncludeFilterType(resolved, name, node, options) {
  validateFilterType(resolved, name, node, options);
  if (resolved.type !== 'text' && resolved.type !== 'html') {
    throw error(
      'INVALID_FILTER_TYPE',
      `Filter '${name}' has type '${resolved.type}' which cannot be used with include (only text and html are valid)`,
      nodeLocation(node, options),
    );
  }
}

function runFilter(resolved, name, input, attrs, node) {
  try {
    return resolved.filter(input, attrs);
  } catch (ex) {
    // A PUGNEUM:-coded error from a pugneum-type re-lex/parse is already a
    // proper diagnostic; re-throw it unchanged rather than double-wrapping.
    // Guard ex defensively: a filter may `throw null`/`throw 42`, which has no
    // `.code`/`.message`.
    if (ex && ex.code && ex.code.startsWith('PUGNEUM:')) throw ex;
    const detail = ex && ex.message ? ex.message : String(ex);
    throw error(
      'FILTER_ERROR',
      `Filter '${name}' failed: ${detail}`,
      nodeLocation(node),
    );
  }
}

// Flatten a filter body to text for a string-consuming (text/html) outer
// filter. Plain pipeless text bodies are Text nodes carrying `.val`. A nested
// pugneum/syntax inner filter, however, is rewritten by applyFilterResult into
// a Block node (no `.val`); rendering that Block to HTML lets the outer filter
// consume the inner filter's structured result instead of silently dropping it.
function getBodyAsText(node, options) {
  if (!node.block) return '';
  return node.block.nodes.map((n) => bodyNodeToText(n, options)).join('');
}

function bodyNodeToText(node, options) {
  if (node.type === 'Text') return node.val || '';
  // Any non-Text node (a Block produced by a nested pugneum/syntax filter, or
  // any other structured node) is rendered to its HTML serialization so a
  // string-consuming outer filter receives the inner output as HTML.
  const render = require('pugneum-renderer');
  return render(node, {
    warnings: options && options.warnings,
    source: options && options.source,
    sources: options && options.sources,
  });
}

function getAttributes(node, options) {
  const attrs = Object.create(null);
  (node.attrs || []).forEach(function (attr) {
    attrs[attr.name] = attr.val;
  });
  const filterOptions = options && options.filterOptions;
  const opts =
    filterOptions &&
    Object.prototype.hasOwnProperty.call(filterOptions, node.name)
      ? filterOptions[node.name]
      : {};
  Object.assign(attrs, opts);
  return attrs;
}

const builtinFilters = Object.create(null);
builtinFilters.verbatim = {type: 'html', filter: (text) => text};

function resolveFilter(name, filters, node, options) {
  if (filters && Object.prototype.hasOwnProperty.call(filters, name)) {
    return filters[name];
  }
  if (name in builtinFilters) {
    return builtinFilters[name];
  }

  // Validate filter name before require() — only allow safe package name characters
  if (!/^[\w][\w\-.]*$/.test(name)) {
    throw error(
      'INVALID_FILTER_NAME',
      `Invalid filter name '${name}'`,
      nodeLocation(node, options),
    );
  }

  try {
    return require(packagePrefix + name);
  } catch (ex) {
    if (ex.code === 'MODULE_NOT_FOUND') {
      throw error(
        'UNKNOWN_FILTER',
        `Unknown filter '${name}'`,
        nodeLocation(node, options),
      );
    }
    throw ex;
  }
}
