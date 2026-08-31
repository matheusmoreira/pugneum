const error = require('pugneum-error');
const walk = require('pugneum-walker');

module.exports = applyFilters;

const packagePrefix = 'pugneum-filter-';
const generatedSourceOrigins = Symbol.for('pugneum.generatedSourceOrigins');

const validFilterTypes = new Set(['text', 'html', 'pugneum', 'syntax']);

// These constructs require loading or template assembly, both of which run
// BEFORE the filterer. Generated output cannot introduce them resolvably at
// this stage. NamedBlock is handled contextually below because it is too late
// for a template override but still valid as a renderer-owned mixin slot.
//
// Reference/footnote/toc constructs in a structured result remain available to
// the later document-level resolve pass when that result stays structured.
// getBodyAsText documents the earlier serialization boundary for a structured
// inner filter nested under a string-consuming outer filter.
const earlierPhaseTypes = new Set([
  'Include',
  'Extends',
  'RawInclude',
  'FileReference',
  'IncludeFilter',
  'YieldBlock',
]);

// Inspect a validated generated tree once for post-assembly ownership and
// collect the records that need invocation provenance. The walker exposes
// nearest-parent-first ancestry during `before`, so a NamedBlock remains legal
// only under a Mixin (definition or call), while Given/MixinBlock/Variable
// retain the parser's mixin-context restrictions.
function inspectGeneratedAst(ast) {
  const root = generatedRoot(ast);
  const parents = [];
  const records = [];
  let unsupported = null;
  walk(
    root,
    function (node, replace, control) {
      let nearestMixin;
      let insideMixinDefinition = false;
      for (const parent of parents) {
        if (parent.type !== 'Mixin') continue;
        if (!nearestMixin) nearestMixin = parent;
        if (parent.call === false) insideMixinDefinition = true;
      }
      const insideMixin = nearestMixin !== undefined;

      if (
        earlierPhaseTypes.has(node.type) ||
        (node.type === 'NamedBlock' && !insideMixin) ||
        (node.type === 'Given' &&
          (!nearestMixin || nearestMixin.call !== false)) ||
        ((node.type === 'MixinBlock' || node.type === 'Variable') &&
          !insideMixinDefinition)
      ) {
        unsupported = node;
        control.stop();
        return;
      }

      if (node !== root) records.push(node);
      for (const attr of node.attrs || []) records.push(attr);
      for (const definition of node.definitions || []) {
        records.push(definition);
      }
    },
    {parents},
  );
  return {records, unsupported};
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

  const inspection = inspectGeneratedAst(root);
  if (inspection.unsupported) {
    throw error(
      'UNSUPPORTED_FILTER_CONSTRUCT',
      `Filter '${name}' (type ${type}) cannot emit ${inspection.unsupported.type}: ` +
        'file loading and template assembly run before filters',
      nodeLocation(invocation, options),
    );
  }
  return inspection.records;
}

function stampGeneratedProvenance(records, invocation, ownedNodes) {
  for (const record of records) {
    stampLocation(record, invocation);
    ownedNodes.add(record);
  }
}

function stampLocation(record, invocation) {
  if (record.filename == null || record.filename === '') {
    record.filename = invocation.filename;
  }
  if (record.line == null) record.line = invocation.line;
  if (record.column == null) record.column = invocation.column;
}

function createSourceState(options) {
  return {
    next: 1,
    options,
    optionsSourcesDescriptor: Object.getOwnPropertyDescriptor(
      options,
      'sources',
    ),
    entries: [],
    originDescriptors: [],
  };
}

function restoreSourceState(state) {
  for (let index = state.entries.length - 1; index >= 0; index--) {
    const entry = state.entries[index];
    Reflect.deleteProperty(entry.sources, entry.identity);
    Reflect.deleteProperty(entry.origins, entry.identity);
  }
  for (let index = state.originDescriptors.length - 1; index >= 0; index--) {
    const record = state.originDescriptors[index];
    if (record.descriptor) {
      Object.defineProperty(
        record.sources,
        generatedSourceOrigins,
        record.descriptor,
      );
    } else {
      Reflect.deleteProperty(record.sources, generatedSourceOrigins);
    }
  }

  Reflect.deleteProperty(state.options, 'sources');
  if (state.optionsSourcesDescriptor) {
    Object.defineProperty(
      state.options,
      'sources',
      state.optionsSourcesDescriptor,
    );
  }
}

function rememberNode(node, context) {
  const rollback = context.rollback;
  if (rollback.seen.has(node)) return;
  rollback.seen.add(node);
  rollback.nodes.push({
    node,
    descriptors: Object.getOwnPropertyDescriptors(node),
  });
}

function rollbackFilterPass(context) {
  for (let index = context.rollback.nodes.length - 1; index >= 0; index--) {
    const record = context.rollback.nodes[index];
    for (const key of Reflect.ownKeys(record.node)) {
      if (!Object.prototype.hasOwnProperty.call(record.descriptors, key)) {
        Reflect.deleteProperty(record.node, key);
      }
    }
    Object.defineProperties(record.node, record.descriptors);
  }
  restoreSourceState(context.sourceState);
}

function registerGeneratedSource(result, name, invocation, options, state) {
  let sources = options.sources;
  let origins;
  if (
    sources == null ||
    (typeof sources !== 'object' && typeof sources !== 'function')
  ) {
    sources = Object.create(null);
    options.sources = sources;
  } else if (!Object.isExtensible(sources)) {
    origins = sources[generatedSourceOrigins];
    sources = Object.assign(Object.create(null), sources);
    options.sources = sources;
  }

  origins = origins || sources[generatedSourceOrigins];
  if (origins == null || !Object.isExtensible(origins)) {
    origins = Object.assign(Object.create(null), origins || null);
    state.originDescriptors.push({
      sources,
      descriptor: Object.getOwnPropertyDescriptor(
        sources,
        generatedSourceOrigins,
      ),
    });
    Object.defineProperty(sources, generatedSourceOrigins, {
      configurable: true,
      value: origins,
    });
  }

  const origin = invocation.filename || '<anonymous>';
  const line = invocation.line == null ? '?' : invocation.line;
  const column = invocation.column == null ? '?' : invocation.column;
  let identity;
  do {
    identity = `<filter ${name} output #${state.next++} from ${origin}:${line}:${column}>`;
  } while (
    Object.prototype.hasOwnProperty.call(sources, identity) ||
    Object.prototype.hasOwnProperty.call(origins, identity)
  );
  state.entries.push({sources, origins, identity});
  sources[identity] = result;
  origins[identity] = invocation.filename;
  return identity;
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

function thrownCode(value) {
  try {
    return value && typeof value.code === 'string' ? value.code : undefined;
  } catch (_) {
    return undefined;
  }
}

function thrownDetail(value) {
  try {
    if (value && typeof value.message === 'string') return value.message;
  } catch (_) {
    // Fall through to the general coercion path.
  }
  try {
    return String(value);
  } catch (_) {
    return '[unprintable thrown value]';
  }
}

function attachCause(diagnostic, cause) {
  Object.defineProperty(diagnostic, 'cause', {
    configurable: true,
    value: cause,
    writable: true,
  });
  return diagnostic;
}

function descriptorError(name, message, node, options, cause) {
  const diagnostic = error(
    'INVALID_FILTER_DESCRIPTOR',
    `Filter '${name}' ${message}`,
    nodeLocation(node, options),
  );
  return cause === undefined ? diagnostic : attachCause(diagnostic, cause);
}

function normalizeFilterDescriptor(candidate, name, node, options) {
  let objectLike;
  try {
    objectLike =
      candidate !== null &&
      typeof candidate === 'object' &&
      !Array.isArray(candidate) &&
      Object.prototype.toString.call(candidate) === '[object Object]';
  } catch (cause) {
    throw descriptorError(
      name,
      `descriptor could not be inspected: ${thrownDetail(cause)}`,
      node,
      options,
      cause,
    );
  }
  if (!objectLike) {
    throw descriptorError(
      name,
      'must resolve to an object-like descriptor',
      node,
      options,
    );
  }

  let type;
  let filter;
  let binary;
  try {
    type = candidate.type;
    filter = candidate.filter;
    binary = candidate.binary;
  } catch (cause) {
    throw descriptorError(
      name,
      `descriptor could not be read: ${thrownDetail(cause)}`,
      node,
      options,
      cause,
    );
  }
  if (typeof filter !== 'function') {
    throw descriptorError(
      name,
      'must provide a callable filter function',
      node,
      options,
    );
  }
  if (binary !== undefined && typeof binary !== 'boolean') {
    throw descriptorError(
      name,
      'must declare binary as a boolean when provided',
      node,
      options,
    );
  }

  return {type, filter, binary, receiver: candidate};
}

function validateFilterType(resolved, name, node, options) {
  if (
    resolved.type === undefined ||
    resolved.type === null ||
    resolved.type === ''
  ) {
    throw error(
      'MISSING_FILTER_TYPE',
      `Filter '${name}' must declare a type (text, html, pugneum, or syntax)`,
      nodeLocation(node, options),
    );
  }
  if (
    typeof resolved.type !== 'string' ||
    !validFilterTypes.has(resolved.type)
  ) {
    throw error(
      'INVALID_FILTER_TYPE',
      `Filter '${name}' has unknown type '${thrownDetail(
        resolved.type,
      )}' (must be text, html, pugneum, or syntax)`,
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

function normalizeTextNewlines(value) {
  return value.replace(/\r\n|\r/g, '\n');
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
      rememberNode(node, context);
      node.type = 'Text';
      node.val = escapeFilterText(result);
      stripFilterFields(node);
      break;
    case 'html':
      validateStringOutput(result, name, type, node, options);
      rememberNode(node, context);
      node.type = 'Text';
      node.val = result;
      stripFilterFields(node);
      break;
    case 'pugneum': {
      validateStringOutput(result, name, type, node, options);
      const generated = parsePugneum(
        result,
        name,
        node,
        options,
        context.sourceState,
      );
      const ast = generated.ast;
      const generatedRecords = validateGeneratedAst(
        ast,
        name,
        type,
        node,
        options,
        context,
        nodeDepth,
      );
      const generatedLocation = {
        filename: generated.filename,
        line: 1,
        column: 1,
      };
      stampGeneratedProvenance(
        generatedRecords,
        generatedLocation,
        context.ownedNodes,
      );
      rememberNode(node, context);
      node.type = 'Block';
      node.nodes = ast.nodes;
      node.filename = generated.filename;
      node.line = 1;
      node.column = 1;
      stripFilterFields(node);
      delete node.val;
      break;
    }
    case 'syntax': {
      validateArrayOutput(result, name, type, node, options);
      const generatedRecords = validateGeneratedAst(
        result,
        name,
        type,
        node,
        options,
        context,
        nodeDepth,
      );
      stampGeneratedProvenance(generatedRecords, node, context.ownedNodes);
      rememberNode(node, context);
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
// When this structured result remains in the AST, reference/footnote/toc nodes
// reach the document-level resolve pass that runs after filtering. A structured
// inner result nested under a text/html outer filter is instead serialized by
// getBodyAsText before that pass and cannot depend on document-global
// resolution. A loader construct (include/extends/raw-include) cannot be
// resolved downstream because loading already ran. Both this parsed tree and
// direct syntax output pass through validateGeneratedAst before insertion.
function parsePugneum(result, name, node, options, sourceState) {
  const lex = require('pugneum-lexer');
  const parse = require('pugneum-parser');
  const filename = registerGeneratedSource(
    result,
    name,
    node,
    options,
    sourceState,
  );
  const reopts = Object.assign({}, options, {
    filename,
    source: result,
  });
  const tokens = lex(result, reopts);
  return {ast: parse(tokens, reopts), filename};
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
  const rootCall = !context;
  if (!context) {
    const ownedNodes = new WeakSet();
    collectOwnedNodes(ast, ownedNodes);
    context = {
      baseDepth: 0,
      ownedNodes,
      sourceState: createSourceState(options),
      rollback: {nodes: [], seen: new WeakSet()},
    };
  }
  const parents = [];
  try {
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
          const result = runFilter(
            resolved,
            node.name,
            text,
            attrs,
            node,
            options,
          );
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
          const innermostIndex = node.filters.length - 1;
          const descriptors = new Array(node.filters.length);
          for (let index = innermostIndex; index >= 0; index--) {
            const invocation = node.filters[index];
            descriptors[index] = resolveFilter(
              invocation.name,
              filters,
              node,
              options,
            );
          }
          // The innermost filter reads the file; its `binary` flag chooses raw
          // bytes vs decoded text. Each later filter consumes the previous result.
          const innermost = descriptors[innermostIndex];
          let result = innermost.binary
            ? node.file.raw
            : normalizeTextNewlines(node.file.str);
          let lastType;
          for (let index = innermostIndex; index >= 0; index--) {
            const f = node.filters[index];
            const resolved = descriptors[index];
            const filterAttrs = getAttributes(f, options);
            filterAttrs.filename = node.file.fullPath;
            validateIncludeFilterType(resolved, f.name, node, options);
            result = runFilter(
              resolved,
              f.name,
              result,
              filterAttrs,
              node,
              options,
            );
            // Validate every stage's output, not just the final one, so a
            // misbehaving intermediate filter yields a clear INVALID_FILTER_OUTPUT
            // naming the stage that failed rather than silent garbage downstream.
            validateStringOutput(result, f.name, resolved.type, node, options);
            lastType = resolved.type;
          }
          rememberNode(node, context);
          node.type = 'Text';
          node.val = lastType === 'text' ? escapeFilterText(result) : result;
          delete node.filters;
          delete node.file;
        }
      },
      {includeDependencies: true, parents},
    );
    return ast;
  } catch (failure) {
    if (rootCall) rollbackFilterPass(context);
    throw failure;
  }
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
      sourceState: context.sourceState,
      rollback: context.rollback,
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

function runFilter(resolved, name, input, attrs, node, options) {
  try {
    return resolved.filter.call(resolved.receiver, input, attrs);
  } catch (ex) {
    // A PUGNEUM:-coded diagnostic thrown directly by plugin code already has
    // its intended identity; re-throw it unchanged rather than double-wrapping.
    // Guard ex defensively: a filter may `throw null`/`throw 42`, which has no
    // `.code`/`.message`.
    if ((thrownCode(ex) || '').startsWith('PUGNEUM:')) throw ex;
    throw attachCause(
      error(
        'FILTER_ERROR',
        `Filter '${name}' failed: ${thrownDetail(ex)}`,
        nodeLocation(node, options),
      ),
      ex,
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
    filename: node.filename,
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
  if (filterOptions === undefined) return attrs;

  let mapIsObject;
  try {
    mapIsObject =
      filterOptions !== null &&
      typeof filterOptions === 'object' &&
      !Array.isArray(filterOptions) &&
      Object.prototype.toString.call(filterOptions) === '[object Object]';
  } catch (cause) {
    throw invalidFilterOptions(
      node,
      options,
      `could not inspect filterOptions: ${thrownDetail(cause)}`,
      cause,
    );
  }
  if (!mapIsObject) {
    throw invalidFilterOptions(
      node,
      options,
      'filterOptions must be an object-like map',
    );
  }

  let hasOptions;
  let selected;
  try {
    hasOptions = Object.prototype.hasOwnProperty.call(filterOptions, node.name);
    if (hasOptions) selected = filterOptions[node.name];
  } catch (cause) {
    throw invalidFilterOptions(
      node,
      options,
      `could not read options for '${node.name}': ${thrownDetail(cause)}`,
      cause,
    );
  }
  if (!hasOptions) return attrs;

  let optionsAreObject;
  try {
    optionsAreObject =
      selected !== null &&
      typeof selected === 'object' &&
      !Array.isArray(selected) &&
      Object.prototype.toString.call(selected) === '[object Object]';
  } catch (cause) {
    throw invalidFilterOptions(
      node,
      options,
      `could not inspect options for '${node.name}': ${thrownDetail(cause)}`,
      cause,
    );
  }
  if (!optionsAreObject) {
    throw invalidFilterOptions(
      node,
      options,
      `options for '${node.name}' must be an object-like option bag`,
    );
  }

  try {
    Object.assign(attrs, selected);
  } catch (cause) {
    throw invalidFilterOptions(
      node,
      options,
      `could not copy options for '${node.name}': ${thrownDetail(cause)}`,
      cause,
    );
  }
  return attrs;
}

function invalidFilterOptions(node, options, message, cause) {
  const diagnostic = error(
    'INVALID_FILTER_OPTIONS',
    message,
    nodeLocation(node, options),
  );
  return cause === undefined ? diagnostic : attachCause(diagnostic, cause);
}

const builtinFilters = Object.create(null);
builtinFilters.verbatim = {type: 'html', filter: (text) => text};

function resolveFilter(name, filters, node, options) {
  let candidate;
  if (filters && Object.prototype.hasOwnProperty.call(filters, name)) {
    candidate = filters[name];
  } else if (name in builtinFilters) {
    candidate = builtinFilters[name];
  } else {
    // Validate filter name before require() — only allow safe package name
    // characters.
    if (!/^[\w][\w\-.]*$/.test(name)) {
      throw error(
        'INVALID_FILTER_NAME',
        `Invalid filter name '${name}'`,
        nodeLocation(node, options),
      );
    }

    const specifier = packagePrefix + name;
    let resolvedFilename;
    try {
      // Keep the optional-package absence probe separate from module loading.
      // A MODULE_NOT_FOUND raised after this point belongs to a present
      // package (usually one of its transitive dependencies) and must retain
      // its identity rather than becoming UNKNOWN_FILTER.
      resolvedFilename = require.resolve(specifier);
    } catch (ex) {
      if (thrownCode(ex) === 'MODULE_NOT_FOUND') {
        throw error(
          'UNKNOWN_FILTER',
          `Unknown filter '${name}'`,
          nodeLocation(node, options),
        );
      }
      if (ex instanceof Error) throw ex;
      throw attachCause(
        error(
          'FILTER_LOAD_ERROR',
          `Filter '${name}' failed to resolve: ${thrownDetail(ex)}`,
          nodeLocation(node, options),
        ),
        ex,
      );
    }

    try {
      candidate = require(resolvedFilename);
    } catch (ex) {
      if (ex instanceof Error) throw ex;
      throw attachCause(
        error(
          'FILTER_LOAD_ERROR',
          `Filter '${name}' failed to load: ${thrownDetail(ex)}`,
          nodeLocation(node, options),
        ),
        ex,
      );
    }
  }

  return normalizeFilterDescriptor(candidate, name, node, options);
}
