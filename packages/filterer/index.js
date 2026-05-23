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

function applyFilterResult(node, type, result, name) {
  switch (type) {
    case 'text':
      node.type = 'Text';
      node.val = escapeFilterText(result);
      break;
    case 'html':
      node.type = 'Text';
      node.val = result;
      break;
    case 'pugneum': {
      if (typeof result !== 'string') {
        throw error(
          'INVALID_FILTER_OUTPUT',
          `Filter '${name}' (type pugneum) must return a string`,
          {
            line: node.line,
            column: node.column,
            filename: node.filename,
            source: '',
          },
        );
      }
      const lex = require('pugneum-lexer');
      const parse = require('pugneum-parser');
      const tokens = lex(result, {filename: node.filename});
      const ast = parse(tokens, {filename: node.filename, source: result});
      node.type = 'Block';
      node.nodes = ast.nodes;
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
        node.type = 'Text';
        node.val = filterFile(
          firstFilter.name,
          node.file,
          attrs,
          filters,
          node,
        );
        node.filters
          .slice()
          .reverse()
          .forEach(function (filter) {
            const filterAttrs = getAttributes(filter, options);
            filterAttrs.filename = filename;
            node.val = filterText(
              filter.name,
              node.val,
              filterAttrs,
              filters,
              node,
            );
          });
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

function filterText(name, text, attrs, filters, node) {
  const resolved = resolveFilter(name, filters, node);
  validateFilterType(resolved, name, node);
  return runFilter(resolved, name, text, attrs, node);
}

function filterFile(name, file, attrs, filters, node) {
  const resolved = resolveFilter(name, filters, node);
  validateFilterType(resolved, name, node);
  const input = resolved.binary ? file.raw : file.str;
  return runFilter(resolved, name, input, attrs, node);
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
builtinFilters.verbatim = {type: 'text', filter: (text) => text};

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
