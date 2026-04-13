const error = require('pugneum-error');
const walk = require('pugneum-walker');

module.exports = applyFilters;

const packagePrefix = 'pugneum-filter-';

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
        node.type = 'Text';
        node.val = filterText(node.name, text, attrs, filters, node);
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
  return resolved.filter(text, attrs);
}

function filterFile(name, file, attrs, filters, node) {
  const resolved = resolveFilter(name, filters, node);
  const input = resolved.binary ? file.raw : file.str;
  return resolved.filter(input, attrs);
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

function resolveFilter(name, filters, node) {
  if (filters && Object.prototype.hasOwnProperty.call(filters, name)) {
    return filters[name];
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
