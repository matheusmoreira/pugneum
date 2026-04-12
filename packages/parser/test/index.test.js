'use strict';

var assert = require('node:assert/strict');
var fs = require('fs');
var {test, describe} = require('node:test');
var parse = require('../');
var lex = require('pugneum-lexer');

var testCases = fs
  .readdirSync(__dirname + '/../../../test-cases/')
  .filter(function (name) {
    return /\.pg$/.test(name);
  });

function read(path) {
  return fs.readFileSync(__dirname + '/../../../test-cases/' + path, 'utf8');
}

testCases.forEach(function (filename) {
  test(filename, (t) => {
    let input = read(filename),
      tokens = lex(input, {filename: filename}),
      ast = parse(tokens, {filename: filename});

    t.assert.snapshot(ast);
  });
});

describe('error paths', () => {
  function parseSource(src) {
    var tokens = lex(src, {filename: 'test.pg'});
    return parse(tokens, {filename: 'test.pg'});
  }

  test('BLOCK_OUTSIDE_MIXIN when block keyword used outside mixin', () => {
    assert.throws(
      () => parseSource('p hello\nblock'),
      (err) => err.code === 'PUGNEUM:BLOCK_OUTSIDE_MIXIN',
    );
  });

  test('VARIABLE_OUTSIDE_MIXIN when #{var} used in text outside mixin', () => {
    assert.throws(
      () => parseSource('p #{name}'),
      (err) => err.code === 'PUGNEUM:VARIABLE_OUTSIDE_MIXIN',
    );
  });

  test('MULTIPLE_ATTRIBUTES when tag has two attribute blocks', () => {
    assert.throws(
      () => parseSource('div(a="1")(b="2")'),
      (err) => err.code === 'PUGNEUM:MULTIPLE_ATTRIBUTES',
    );
  });

  test('DUPLICATE_ID when tag has two id shorthands', () => {
    assert.throws(
      () => parseSource('#a#b'),
      (err) => err.code === 'PUGNEUM:DUPLICATE_ID',
    );
  });
});
