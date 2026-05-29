const fs = require('fs');
const path = require('path');
const resolve = path.resolve;

const lex = require('pugneum-lexer');
const parse = require('pugneum-parser');
const load = require('pugneum-loader');
const link = require('pugneum-linker');
const filter = require('pugneum-filterer');
const render = require('pugneum-renderer');

function renderPugneum(string, options) {
  // If the caller supplies a warnings array we collect into it and let them
  // surface the diagnostics; otherwise we own them and emit them ourselves so
  // nothing fails silently.
  const ownsWarnings = !Array.isArray(options && options.warnings);
  options = Object.assign({}, options, {
    source: string,
    lex: lex,
    parse: parse,
  });
  if (ownsWarnings) options.warnings = [];

  let tokens = lex(string, options);
  let ast = parse(tokens, options);
  let loaded = load(ast, options);
  let linked = link(loaded, options);
  let filtered = filter(linked, options.filters, options);
  let rendered = render(filtered, options);

  dedupeWarnings(options.warnings);
  if (ownsWarnings) emitWarnings(options.warnings);

  return rendered;
}

function warningKey(warning) {
  return [warning.code, warning.filename, warning.line, warning.column].join(
    ':',
  );
}

// Collapse identical diagnostics in place. The same shared array is threaded
// through every file in a build, so a layout included by many pages would
// otherwise report the same warning once per page.
function dedupeWarnings(warnings) {
  const seen = new Set();
  let kept = 0;
  for (let i = 0; i < warnings.length; i++) {
    const key = warningKey(warnings[i]);
    if (seen.has(key)) continue;
    seen.add(key);
    warnings[kept++] = warnings[i];
  }
  warnings.length = kept;
}

function emitWarnings(warnings) {
  for (let i = 0; i < warnings.length; i++) {
    process.stderr.write('warning ' + warnings[i].code + '\n');
    process.stderr.write(warnings[i].message + '\n\n');
  }
}

function renderPugneumFile(filename, options) {
  filename = resolve(filename);
  const source = fs.readFileSync(filename, 'utf8');
  options = Object.assign({}, options, {filename: filename});
  return renderPugneum(source, options);
}

exports.render = renderPugneum;
exports.renderFile = renderPugneumFile;
exports.emitWarnings = emitWarnings;
