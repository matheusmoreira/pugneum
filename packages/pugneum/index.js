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
  options ||= {};
  options.source = string;
  options.lex = lex;
  options.parse = parse;

  let tokens = lex(string, options);
  let ast = parse(tokens, options);
  let loaded = load(ast, options);
  let linked = link(loaded, options);
  let filtered = filter(linked, options);
  let rendered = render(filtered, options);

  return rendered;
};

function renderPugneumFile(path, options) {
  path = resolve(path);
  let source = fs.readFileSync(path, 'utf8');
  options ||= {};
  options.filename = path;
  return renderPugneum(source, options);
};

exports.render = renderPugneum;
exports.renderFile = renderPugneumFile;
