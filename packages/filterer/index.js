var dirname = require('path').dirname;

const error = require('pugneum-error');
const walk = require('pugneum-walker');

function applyFilters(ast, filters, options, filterAliases) {
  options = options || {};
  walk(
    ast,
    function(node) {
      var dir = node.filename ? dirname(node.filename) : null;
      if (node.type === 'Filter') {
        handleNestedFilters(node, filters, options, filterAliases);
        var text = getBodyAsText(node);
        var attrs = getAttributes(node, options);
        attrs.filename = node.filename;
        node.type = 'Text';
        node.val = filterText(node.name, text, attrs, filters, filterAliases);
      } else if (node.type === 'RawInclude' && node.filters.length) {
        var firstFilter = node.filters.pop();
        var attrs = getAttributes(firstFilter, options);
        var filename = (attrs.filename = node.file.fullPath);
        node.type = 'Text';
        node.val = filterFile(
          firstFilter.name,
          filename,
          node.file,
          attrs,
          filters,
          filterAliases
        );
        node.filters
          .slice()
          .reverse()
          .forEach(function(filter) {
            var attrs = getAttributes(filter, options);
            attrs.filename = filename;
            node.val = filterText(filter.name, node.val, attrs);
          });
        node.filters = undefined;
        node.file = undefined;
      }
    },
    {includeDependencies: true}
  );
  return ast;
}

function handleNestedFilters(node, filters, options, filterAliases) {
  if (node.block.nodes[0] && node.block.nodes[0].type === 'Filter') {
    node.block.nodes[0] = applyFilters(
      node.block,
      filters,
      options,
      filterAliases
    ).nodes[0];
  }
}

function filterText(filter, text, attrs, filters, aliases) {
  const resolved = resolveFilter(filter, filters, aliases);
  return resolved.filter(text, attrs);
}

function filterFile(filter, filename, file, attrs, filters, aliases) {
  const resolved = resolveFilter(filter, filters, aliases);
  const input = resolved.binary? file.raw : file.str;
  return resolved.filter(input, attrs);
}

function getBodyAsText(node) {
  return node.block.nodes.map((node) => node.val).join('');
}

function getAttributes(node, options) {
  var attrs = {};
  node.attrs.forEach(function(attr) {
      attrs[attr.name] =
        attr.val === true ? true : attr.val;
  });
  var opts = options[node.name] || {};
  Object.keys(opts).forEach(function(opt) {
    if (!attrs.hasOwnProperty(opt)) {
      attrs[opt] = opts[opt];
    }
  });
  return attrs;
}

function resolveFilter(filter, filters, aliases) {
  if (filters && filters[filter]) {
    return filters[filter];
  } else {
    throw error('UNKNOWN_FILTER', `Unknown filter '${filter}'`, filter);
  }
}

module.exports = applyFilters;
