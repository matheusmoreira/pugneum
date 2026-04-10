'use strict';

var fs = require('fs');
var {test} = require('node:test');
var parse = require('../');
var lex = require('pugneum-lexer');

var testCases = fs.readdirSync(__dirname + '/../../../test-cases/').filter(function(name) {
  return /\.pg$/.test(name);
});

function read(path) {
  return fs.readFileSync(__dirname + '/../../../test-cases/' + path, 'utf8');
}

testCases.forEach(function(filename) {
  test(filename, (t) => {
    let input = read(filename),
        tokens = lex(input, {filename: filename}),
        ast = parse(tokens, {filename: filename});

    t.assert.snapshot(ast);
  });
});
