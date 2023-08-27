'use strict';

var dirname = require('path').dirname;
var walk = require('pugneum-walk');
var error = require('pugneum-error');
var jstransformer = require('jstransformer');
var resolve = require('resolve');

function handleFilters(ast, filters, options, filterAliases) {
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
        node.val = filterWithFallback(node, text, attrs);
      } else if (node.type === 'RawInclude' && node.filters.length) {
        var firstFilter = node.filters.pop();
        var attrs = getAttributes(firstFilter, options);
        var filename = (attrs.filename = node.file.fullPath);
        node.type = 'Text';
        node.val = filterFileWithFallback(
          firstFilter,
          filename,
          node.file,
          attrs
        );
        node.filters
          .slice()
          .reverse()
          .forEach(function(filter) {
            var attrs = getAttributes(filter, options);
            attrs.filename = filename;
            node.val = filterWithFallback(filter, node.val, attrs);
          });
        node.filters = undefined;
        node.file = undefined;
      }

      function filterWithFallback(filter, text, attrs, funcName) {
        try {
          var filterName = getFilterName(filter);
          if (filters && filters[filterName]) {
            return filters[filterName](text, attrs);
          } else {
            return runFilter(filterName, text, attrs, dir, funcName);
          }
        } catch (ex) {
          if (ex.code === 'UNKNOWN_FILTER') {
            throw error(ex.code, ex.message, filter);
          }
          throw ex;
        }
      }

      function filterFileWithFallback(filter, filename, file, attrs) {
        var filterName = getFilterName(filter);
        if (filters && filters[filterName]) {
          if (filters[filterName].renderBuffer) {
            return filters[filterName].renderBuffer(file.raw, attrs);
          } else {
            return filters[filterName](file.str, attrs);
          }
        } else {
          return filterWithFallback(filter, filename, attrs, 'renderFile');
        }
      }
    },
    {includeDependencies: true}
  );
  function getFilterName(filter) {
    var filterName = filter.name;
    if (filterAliases && filterAliases[filterName]) {
      filterName = filterAliases[filterName];
      if (filterAliases[filterName]) {
        throw error(
          'FILTER_ALIAS_CHAIN',
          'The filter "' +
            filter.name +
            '" is an alias for "' +
            filterName +
            '", which is an alias for "' +
            filterAliases[filterName] +
            '".  pugneum does not support chains of filter aliases.',
          filter
        );
      }
    }
    return filterName;
  }
  return ast;
}

function handleNestedFilters(node, filters, options, filterAliases) {
  if (node.block.nodes[0] && node.block.nodes[0].type === 'Filter') {
    node.block.nodes[0] = handleFilters(
      node.block,
      filters,
      options,
      filterAliases
    ).nodes[0];
  }
}

function getBodyAsText(node) {
  return node.block.nodes
    .map(function(node) {
      return node.val;
    })
    .join('');
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

function getMinifyTransformerName(outputFormat) {
  switch (outputFormat) {
    case 'js':
      return 'uglify-js';
    case 'css':
      return 'clean-css';
  }
}

function runFilter(name, str, options, currentDirectory, funcName) {
  funcName = funcName || 'render';
  var trPath;
  try {
    try {
      trPath = resolve.sync('jstransformer-' + name, {
        basedir: currentDirectory || process.cwd(),
      });
    } catch (ex) {
      trPath = require.resolve('jstransformer-' + name);
    }
  } catch (ex) {
    var err = new Error('unknown filter ":' + name + '"');
    err.code = 'UNKNOWN_FILTER';
    throw err;
  }
  var tr = jstransformer(require(trPath));
  // TODO: we may want to add a way for people to separately specify "locals"
  var result = tr[funcName](str, options, options).body;
  if (options && options.minify) {
    var minifyTranformer = getMinifyTransformerName(tr.outputFormat);
    if (minifyTranformer) {
      try {
        result = filter(minifyTranformer, result, null, currentDirectory);
      } catch (ex) {
        // better to fail to minify than output nothing
      }
    }
  }
  return result;
}

exports.runFilter = runFilter;
exports.handleFilters = handleFilters;
