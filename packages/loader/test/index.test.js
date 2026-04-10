'use strict';

var fs = require('fs');
var path = require('path');
var {test} = require('node:test');

var walk = require('pugneum-walker');
var lex = require('pugneum-lexer');
var parse = require('pugneum-parser');
var load = require('../');

test('pugneum-loader', (t) => {
  let filename = __dirname + '/foo.pg';
  let source = fs.readFileSync(filename, 'utf8');
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

  t.assert.snapshot(ast);
});
