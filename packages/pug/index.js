'use strict';

const fs = require('fs');
const path = require('path');

const lex = require('pugneum-lexer');
const parse = require('pugneum-parser');
const loader = require('pugneum-loader');
const link = require('pugneum-linker');
const render = require('pugneum-renderer');
const filters = require('pugneum-filters');

function renderPugneum(string, options) {
  options ||= {};
  options.src = string;
  options.lex = lex;
  options.parse = parse;

  let tokens = lex(string, options);
  let ast = parse(tokens, options);
  let loaded = loader.load(ast, options);
  let linked = link(loaded, options);
  let rendered = render(linked, options);

  return rendered;
};

function renderPugneumFile(path, options) {
  path = path.resolve(path);
  let src = fs.readFileSync(path, 'utf8');
  options ||= {};
  options.filename = path;
  return renderPugneum(src, options);
};

exports.render = renderPugneum;
exports.renderFile = renderPugneumFile;
