const error = require('pugneum-error');
const walk = require('pugneum-walker');

module.exports = applyFilters;

const packagePrefix = 'pugneum-filter-';

const validFilterTypes = new Set(['text', 'html', 'pugneum', 'syntax']);

function validateFilterType(resolved, name, node) {
  if (!resolved.type) {
    throw error(
      'MISSING_FILTER_TYPE',
      `Filter '${name}' must declare a type (text, html, pugneum, or syntax)`,
      {
        line: node ? node.line : 0,
        column: node ? node.column : 0,
        filename: node ? node.filename : '',
        source: '',
      },
    );
  }
  if (!validFilterTypes.has(resolved.type)) {
    throw error(
      'INVALID_FILTER_TYPE',
      `Filter '${name}' has unknown type '${resolved.type}' (must be text, html, pugneum, or syntax)`,
      {
        line: node ? node.line : 0,
        column: node ? node.column : 0,
        filename: node ? node.filename : '',
        source: '',
      },
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

function validateStringOutput(result, name, type, node) {
  if (typeof result !== 'string') {
    throw error(
      'INVALID_FILTER_OUTPUT',
      `Filter '${name}' (type ${type}) must return a string`,
      {
        line: node.line,
        column: node.column,
        filename: node.filename,
        source: '',
      },
    );
  }
}

function applyFilterResult(node, type, result, name) {
  switch (type) {
    case 'text':
      validateStringOutput(result, name, type, node);
      node.type = 'Text';
      node.val = escapeFilterText(result);
      delete node.block;
      delete node.attrs;
      delete node.attributeBlocks;
      break;
    case 'html':
      validateStringOutput(result, name, type, node);
      node.type = 'Text';
      node.val = result;
      delete node.block;
      delete node.attrs;
      delete node.attributeBlocks;
      break;
    case 'pugneum': {
      validateStringOutput(result, name, type, node);
      const lex = require('pugneum-lexer');
      const parse = require('pugneum-parser');
      const tokens = lex(result, {filename: node.filename});
      const ast = parse(tokens, {filename: node.filename, source: result});
      node.type = 'Block';
      node.nodes = ast.nodes;
      delete node.block;
      delete node.attrs;
      delete node.attributeBlocks;
      delete node.val;
      break;
    }
    case 'syntax': {
      if (!Array.isArray(result)) {
        throw error(
          'INVALID_FILTER_OUTPUT',
          `Filter '${name}' (type syntax) must return an array of AST nodes`,
          {
            line: node.line,
            column: node.column,
            filename: node.filename,
            source: '',
          },
        );
      }
      node.type = 'Block';
      node.nodes = result;
      delete node.block;
      delete node.attrs;
      delete node.attributeBlocks;
      delete node.val;
      break;
    }
  }
}

function applyFilters(ast, filters, options) {
  options = options || {};
  walk(
    ast,
    function (node) {
      if (node.type === 'Filter') {
        handleNestedFilters(node, filters, options);
        const text = getBodyAsText(node);
        const attrs = getAttributes(node, options);
        attrs.filename = node.filename;
        const resolved = resolveFilter(node.name, filters, node);
        validateFilterType(resolved, node.name, node);
        const result = runFilter(resolved, node.name, text, attrs, node);
        applyFilterResult(node, resolved.type, result, node.name);
      } else if (node.type === 'RawInclude' && node.filters.length) {
        const firstFilter = node.filters.pop();
        const attrs = getAttributes(firstFilter, options);
        const filename = (attrs.filename = node.file.fullPath);
        let resolved = resolveFilter(firstFilter.name, filters, node);
        validateIncludeFilterType(resolved, firstFilter.name, node);
        let result = runFilter(
          resolved,
          firstFilter.name,
          resolved.binary ? node.file.raw : node.file.str,
          attrs,
          node,
        );
        let lastType = resolved.type;
        node.filters
          .slice()
          .reverse()
          .forEach(function (f) {
            const filterAttrs = getAttributes(f, options);
            filterAttrs.filename = filename;
            resolved = resolveFilter(f.name, filters, node);
            validateIncludeFilterType(resolved, f.name, node);
            result = runFilter(resolved, f.name, result, filterAttrs, node);
            lastType = resolved.type;
          });
        validateStringOutput(result, firstFilter.name, lastType, node);
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

function handleNestedFilters(node, filters, options) {
  if (node.block.nodes[0] && node.block.nodes[0].type === 'Filter') {
    node.block.nodes[0] = applyFilters(node.block, filters, options).nodes[0];
  }
}

function validateIncludeFilterType(resolved, name, node) {
  validateFilterType(resolved, name, node);
  if (resolved.type !== 'text' && resolved.type !== 'html') {
    throw error(
      'INVALID_FILTER_TYPE',
      `Filter '${name}' has type '${resolved.type}' which cannot be used with include (only text and html are valid)`,
      {
        line: node ? node.line : 0,
        column: node ? node.column : 0,
        filename: node ? node.filename : '',
        source: '',
      },
    );
  }
}


function runFilter(resolved, name, input, attrs, node) {
  try {
    return resolved.filter(input, attrs);
  } catch (ex) {
    if (ex.code && ex.code.startsWith('PUGNEUM:')) throw ex;
    throw error('FILTER_ERROR', `Filter '${name}' failed: ${ex.message}`, {
      line: node ? node.line : 0,
      column: node ? node.column : 0,
      filename: node ? node.filename : '',
      source: '',
    });
  }
}

function getBodyAsText(node) {
  if (!node.block) return '';
  return node.block.nodes.map((n) => n.val || '').join('');
}

function getAttributes(node, options) {
  const attrs = Object.create(null);
  (node.attrs || []).forEach(function (attr) {
    attrs[attr.name] = attr.val === true ? true : attr.val;
  });
  const opts =
    options && Object.prototype.hasOwnProperty.call(options, node.name)
      ? options[node.name]
      : {};
  Object.assign(attrs, opts);
  return attrs;
}

const builtinFilters = Object.create(null);
builtinFilters.verbatim = {type: 'html', filter: (text) => text};

function resolveFilter(name, filters, node) {
  if (filters && Object.prototype.hasOwnProperty.call(filters, name)) {
    return filters[name];
  }
  if (name in builtinFilters) {
    return builtinFilters[name];
  }

  // Validate filter name before require() — only allow safe package name characters
  if (!/^[\w][\w\-.]*$/.test(name)) {
    throw error('INVALID_FILTER_NAME', `Invalid filter name '${name}'`, {
      line: node ? node.line : 0,
      column: node ? node.column : 0,
      filename: node ? node.filename : '',
      source: '',
    });
  }

  try {
    return require(packagePrefix + name);
  } catch (ex) {
    if (ex.code === 'MODULE_NOT_FOUND') {
      throw error('UNKNOWN_FILTER', `Unknown filter '${name}'`, {
        line: node ? node.line : 0,
        column: node ? node.column : 0,
        filename: node ? node.filename : '',
        source: '',
      });
    }
    throw ex;
  }
}
