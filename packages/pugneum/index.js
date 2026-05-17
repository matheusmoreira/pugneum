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
  options = Object.assign({}, options, {
    source: string,
    lex: lex,
    parse: parse,
  });

  let tokens = lex(string, options);
  let ast = parse(tokens, options);
  let loaded = load(ast, options);
  let linked = link(loaded, options);
  let filtered = filter(linked, options.filters, options);
  let rendered = render(filtered, options);

  return rendered;
}

function renderPugneumFile(filename, options) {
  filename = resolve(filename);
  const source = fs.readFileSync(filename, 'utf8');
  options = Object.assign({}, options, {filename: filename});
  return renderPugneum(source, options);
}

exports.render = renderPugneum;
exports.renderFile = renderPugneumFile;
