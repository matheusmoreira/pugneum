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

  test('DUPLICATE_ATTRIBUTE when same attribute appears twice', () => {
    assert.throws(
      () => parseSource('div(id="a" id="b")'),
      (err) => err.code === 'PUGNEUM:DUPLICATE_ATTRIBUTE',
    );
  });

  test('INVALID_TOKEN for unexpected token in expression position', () => {
    var tokens = lex('div', {filename: 'test.pg'});
    tokens.splice(1, 0, {type: 'bogus', loc: {start: {line: 1, column: 4}}});
    assert.throws(
      () => parse(tokens, {filename: 'test.pg'}),
      (err) => err.code === 'PUGNEUM:INVALID_TOKEN',
    );
  });

  test('MIXIN_WITHOUT_BODY for mixin with no indented block', () => {
    assert.throws(
      () => parseSource('mixin foo'),
      (err) => err.code === 'PUGNEUM:MIXIN_WITHOUT_BODY',
    );
  });

  test('RAW_INCLUDE_BLOCK for raw include with block content', () => {
    assert.throws(
      () => parseSource('include:verbatim file.txt\n  p not allowed'),
      (err) => err.code === 'PUGNEUM:RAW_INCLUDE_BLOCK',
    );
  });

  test('NESTING_TOO_DEEP when recursion limit exceeded', () => {
    var deep = Array(300).fill('div:').join(' ') + ' p end';
    assert.throws(
      () => parseSource(deep),
      (err) => err.code === 'PUGNEUM:NESTING_TOO_DEEP',
    );
  });

  test('mixin with both unnamed and named blocks sets both flags', (t) => {
    const source = 'mixin both\n  block name\n  block';
    const tokens = lex(source, {filename: 'test'});
    const ast = parse(tokens, {filename: 'test', source});
    const mixin = ast.nodes[0];
    assert.strictEqual(mixin.usesNamedBlocks, true);
    assert.strictEqual(mixin.usesUnnamedBlock, true);
  });

  test('mixin with only unnamed block sets usesUnnamedBlock only', (t) => {
    const source = 'mixin simple\n  div\n    block';
    const tokens = lex(source, {filename: 'test'});
    const ast = parse(tokens, {filename: 'test', source});
    const mixin = ast.nodes[0];
    assert.strictEqual(mixin.usesNamedBlocks, false);
    assert.strictEqual(mixin.usesUnnamedBlock, true);
  });

  test('mixin with only named blocks sets usesNamedBlocks only', (t) => {
    const source = 'mixin named\n  block header\n  block body';
    const tokens = lex(source, {filename: 'test'});
    const ast = parse(tokens, {filename: 'test', source});
    const mixin = ast.nodes[0];
    assert.strictEqual(mixin.usesNamedBlocks, true);
    assert.strictEqual(mixin.usesUnnamedBlock, false);
  });

  test('unnamed block mixin with nested named-block call does not set usesNamedBlocks', (t) => {
    const source =
      'mixin outer\n  block\n  +inner\n    block slot\n      | content';
    const tokens = lex(source, {filename: 'test'});
    const ast = parse(tokens, {filename: 'test', source});
    const mixin = ast.nodes[0];
    assert.strictEqual(mixin.usesNamedBlocks, false);
    assert.strictEqual(mixin.usesUnnamedBlock, true);
  });
});

describe('given keyword', () => {
  test('given produces Given node with name and block', (t) => {
    const source = 'mixin card\n  given header\n    h1 Title';
    const tokens = lex(source, {filename: 'test'});
    const ast = parse(tokens, {filename: 'test', source});
    const mixin = ast.nodes[0];
    const givenNode = mixin.block.nodes[0];
    assert.strictEqual(givenNode.type, 'Given');
    assert.strictEqual(givenNode.name, 'header');
    assert.ok(givenNode.block);
    assert.strictEqual(givenNode.block.nodes[0].type, 'Tag');
    assert.strictEqual(givenNode.block.nodes[0].name, 'h1');
  });

  test('given outside mixin throws GIVEN_OUTSIDE_MIXIN', (t) => {
    const source = 'given header\n  h1 Title';
    const tokens = lex(source, {filename: 'test'});
    assert.throws(
      () => parse(tokens, {filename: 'test', source}),
      (err) => err.code === 'PUGNEUM:GIVEN_OUTSIDE_MIXIN',
    );
  });

  test('given sets usesNamedBlocks on containing mixin', (t) => {
    const source = 'mixin card\n  block\n  given footer\n    p foot';
    const tokens = lex(source, {filename: 'test'});
    const ast = parse(tokens, {filename: 'test', source});
    const mixin = ast.nodes[0];
    assert.strictEqual(mixin.usesNamedBlocks, true);
    assert.strictEqual(mixin.usesUnnamedBlock, true);
  });

  test('given inside mixin call block throws GIVEN_OUTSIDE_MIXIN', (t) => {
    const source = 'mixin outer\n  +inner\n    given slot\n      p hi';
    const tokens = lex(source, {filename: 'test'});
    assert.throws(
      () => parse(tokens, {filename: 'test', source}),
      (err) => err.code === 'PUGNEUM:GIVEN_OUTSIDE_MIXIN',
    );
  });
});
