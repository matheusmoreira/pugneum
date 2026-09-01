const makeError = require('pugneum-error');

function sources(options) {
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
function context(node, sourceSet) {
  const filename = node && node.filename;
  const byFilename = sourceSet && sourceSet.byFilename;
  let source = (byFilename && byFilename[filename]) || '';
  if (
    !source &&
    sourceSet &&
    (!filename || filename === sourceSet.entryFilename) &&
    typeof sourceSet.entrySource === 'string'
  ) {
    source = sourceSet.entrySource;
  }
  return {
    line: node && node.line,
    column: node && node.column,
    filename,
    source,
  };
}

function error(code, message, node, sourceSet) {
  throw makeError(code, message, context(node, sourceSet));
}

function warn(code, message, node, sourceSet, warnings) {
  warnings.push(makeError.warning(code, message, context(node, sourceSet)));
}

module.exports = {context, error, sources, warn};
