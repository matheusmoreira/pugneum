const error = require('pugneum-error');
const walk = require('pugneum-walker');

module.exports = applyFilters;

const packagePrefix = 'pugneum-filter-';

const validFilterTypes = new Set(['text', 'html', 'pugneum', 'syntax']);

// Loader constructs need the LOADER (disk file resolution), which runs BEFORE
// the filterer — so a pugneum-type filter cannot emit them resolvably: by filter
// time the target was never read, node.file.ast is unset, and they can never be
// resolved downstream. parsePugneum rejects them with a clean coded error.
//
// Reference/footnote/toc constructs a filter emits need NO special handling
// here: the document-level resolution pass (pugneum-linker's `resolve`) runs
// AFTER the filterer over the whole assembled tree (see packages/pugneum), so
// they resolve there alongside the rest of the document.
const loaderConstructTypes = new Set([
  'Include',
  'Extends',
  'RawInclude',
  'FileReference',
]);

// First node in `ast` whose type is in `types`, or null. Stops at the first hit.
function firstNodeOfType(ast, types) {
  let hit = null;
  walk(ast, function (node) {
    if (types.has(node.type)) {
      hit = node;
      return false; // first hit is enough; stop descending this branch
    }
  });
  return hit;
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

function applyFilterResult(node, type, result, name, options) {
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
      node.type = 'Block';
      node.nodes = ast.nodes;
      stripFilterFields(node);
      delete node.val;
      break;
    }
    case 'syntax': {
      validateArrayOutput(result, name, type, node, options);
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
// before the filterer, so the target was never read — and is rejected up front
// with a coded error reported against the filter invocation site, rather than
// reaching the renderer as an unresolved node.
function parsePugneum(result, node, options) {
  const lex = require('pugneum-lexer');
  const parse = require('pugneum-parser');
  const reopts = Object.assign({}, options, {
    filename: node.filename,
    source: result,
  });
  const tokens = lex(result, reopts);
  const ast = parse(tokens, reopts);
  const loaderNode = firstNodeOfType(ast, loaderConstructTypes);
  if (loaderNode) {
    throw error(
      'UNSUPPORTED_FILTER_CONSTRUCT',
      'A pugneum-type filter cannot emit an include/extends directive: file ' +
        'resolution runs before filters, so the referenced file is never ' +
        'loaded. Emit the content directly, or use an include:filter.',
      nodeLocation(node, options),
    );
  }
  return ast;
}

function applyFilters(ast, filters, options) {
  options = options || {};
  walk(
    ast,
    function (node) {
      if (node.type === 'Filter') {
        handleNestedFilters(node, filters, options);
        const text = getBodyAsText(node, options);
        const attrs = getAttributes(node, options);
        attrs.filename = node.filename;
        const resolved = resolveFilter(node.name, filters, node, options);
        validateFilterType(resolved, node.name, node, options);
        const result = runFilter(resolved, node.name, text, attrs, node);
        applyFilterResult(node, resolved.type, result, node.name, options);
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
    {includeDependencies: true},
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
function handleNestedFilters(node, filters, options) {
  if (
    node.block &&
    node.block.nodes[0] &&
    node.block.nodes[0].type === 'Filter'
  ) {
    applyFilters(node.block, filters, options);
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
