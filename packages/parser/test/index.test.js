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

  // given validity must be decided by the innermost enclosing mixin construct,
  // not by comparing the cumulative inMixin/inMixinCall counters (which cannot
  // express "innermost" and mis-decide both directions).
  test('given inside a mixin DEFINITION nested in a call block is accepted', (t) => {
    // inMixin == 1, inMixinCall == 1 here, so the old `inMixin <= inMixinCall`
    // check wrongly rejected this valid definition-scoped given.
    const source =
      'mixin host\n  block\n+host\n  mixin nested\n    given slot\n      p y';
    const tokens = lex(source, {filename: 'test'});
    const ast = parse(tokens, {filename: 'test', source});
    const call = ast.nodes.find((n) => n.type === 'Mixin' && n.call);
    const nested = call.block.nodes.find((n) => n.type === 'Mixin');
    const given = nested.block.nodes.find((n) => n.type === 'Given');
    assert.ok(given, 'given inside the nested definition should be parsed');
    assert.strictEqual(given.name, 'slot');
  });

  test('given lexically inside a call block (with more defs than calls stacked) throws', (t) => {
    // inMixin == 2, inMixinCall == 1 here, so the old `inMixin <= inMixinCall`
    // check (2 <= 1 === false) wrongly accepted this call-scoped given.
    const source = 'mixin a\n  mixin b\n    +c\n      given slot\n        p hi';
    const tokens = lex(source, {filename: 'test'});
    assert.throws(
      () => parse(tokens, {filename: 'test', source}),
      (err) => err.code === 'PUGNEUM:GIVEN_OUTSIDE_MIXIN',
    );
  });
});

describe('blind sweep fixes', () => {
  test('continued text-block line beginning with #{var} keeps the line separator', (t) => {
    // collectInlineContent must emit the joining '\n' whenever more inline
    // content follows, not only when the next token is literal text. Gating on
    // 'text' alone dropped the separator before an interpolation, gluing the
    // two lines' words together (e.g. <p>alphaVALUE beta</p>).
    const source = 'mixin m(x)\n  p\n    | alpha\n    | #{x} beta';
    const tokens = lex(source, {filename: 'test'});
    const ast = parse(tokens, {filename: 'test', source});
    const p = ast.nodes[0].block.nodes.find(
      (n) => n.type === 'Tag' && n.name === 'p',
    );
    const kinds = p.block.nodes.map((n) =>
      n.type === 'Text' ? JSON.stringify(n.val) : n.type,
    );
    assert.deepStrictEqual(kinds, ['"alpha"', '"\\n"', 'Variable', '" beta"']);
  });

  test('a trailing newline before the end of a text block is not turned into a separator', (t) => {
    // The new gate must still suppress the separator when nothing inline
    // follows the newline (outdent/eos), so no spurious trailing '\n' appears.
    const source = 'mixin m(x)\n  p\n    | alpha\n    | beta\n  div';
    const tokens = lex(source, {filename: 'test'});
    const ast = parse(tokens, {filename: 'test', source});
    const p = ast.nodes[0].block.nodes.find(
      (n) => n.type === 'Tag' && n.name === 'p',
    );
    const vals = p.block.nodes
      .filter((n) => n.type === 'Text')
      .map((n) => n.val);
    assert.deepStrictEqual(vals, ['alpha', '\n', 'beta']);
  });

  test('a single long inline-shorthand line parses without a raw RangeError', (t) => {
    // tag() must flush collected inline nodes with an in-place push loop, not
    // push.apply(...spread): a line with more inline nodes than V8's apply
    // argument-spread limit threw a raw RangeError (no PUGNEUM code) instead of
    // parsing. A synthetic token stream of many text tokens on one logical line
    // reproduces the exact flush at the crash site.
    const N = 150000;
    const loc = {start: {line: 1, column: 1}, end: {line: 1, column: 1}};
    const tokens = [{type: 'tag', val: 'p', loc}];
    for (let i = 0; i < N; ++i) tokens.push({type: 'text', val: 'a', loc});
    tokens.push({type: 'eos', loc});
    const ast = parse(tokens, {filename: 'test'});
    assert.strictEqual(ast.nodes[0].block.nodes.length, N);
  });

  test('a block with many text children under one indent parses linearly to the right node count', (t) => {
    // block() must accumulate Block-typed children with in-place push rather
    // than reallocating via Array.concat (O(n^2)). This is a regression guard
    // on the node count for the path that produced the quadratic blow-up:
    // alternating a tag with a multi-inline piped line inside a mixin body.
    const N = 400;
    const lines = ['mixin m(v)'];
    for (let i = 0; i < N; ++i) {
      lines.push('  div');
      lines.push('  | a #{v} b');
    }
    const source = lines.join('\n');
    const tokens = lex(source, {filename: 'test'});
    const ast = parse(tokens, {filename: 'test', source});
    // N `div` tags + N piped-text Blocks (each contributing 3 nodes) = 4N nodes.
    assert.strictEqual(ast.nodes[0].block.nodes.length, 4 * N);
  });
});
