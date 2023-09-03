const fs = require('fs');
const path = require('path');
const resolve = path.resolve;

const lex = require('pugneum-lexer');
const parse = require('pugneum-parser');
const load = require('pugneum-loader');
const link = require('pugneum-linker');
const render = require('pugneum-renderer');
const filter = require('pugneum-filterer');

function renderPugneum(string, options) {
  options ||= {};
  options.src = string;
  options.lex = lex;
  options.parse = parse;

  let tokens = lex(string, options);
  let ast = parse(tokens, options);
  let loaded = load(ast, options);
  let linked = link(loaded, options);
  let rendered = render(linked, options);

  return rendered;
};

function renderPugneumFile(path, options) {
  path = resolve(path);
  let src = fs.readFileSync(path, 'utf8');
  options ||= {};
  options.filename = path;
  return renderPugneum(src, options);
};

exports.render = renderPugneum;
exports.renderFile = renderPugneumFile;
