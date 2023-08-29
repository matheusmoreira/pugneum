'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const walk = require('pugneum-walk');
const lex = require('pugneum-lexer');
const parse = require('pugneum-parser');
const load = require('../');

test('pugneum-loader', () => {
  let filename = __dirname + '/foo.pg';
  let source = fs.readFileSync(filename, 'utf8');
console.log(source);
  let tokens = lex(source, {filename});
  let ast = parse(tokens, {filename});

  ast = load(ast, {lex, parse});

  ast = walk(
    ast,
    function(node) {
      if (node.filename)
        node.filename = path.basename(node.filename);
      if (node.fullPath)
        node.fullPath = path.basename(node.fullPath);
    },
    {includeDependencies: true}
  );

  expect(ast).toMatchSnapshot();
});
