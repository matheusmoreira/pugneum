'use strict';

var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');
var {test, describe} = require('node:test');
var parse = require('../');
var lex = require('pugneum-lexer');

var testCasesDir = path.resolve(__dirname, '../../../test-cases');
var fixtureManifest = require('../../../test-cases/manifest.json');
var testCases = fixtureManifest.render
  .map((name) => name + '.pg')
  .concat(
    fixtureManifest.syntax,
    fixtureManifest.dependencies.filter((name) => name.endsWith('.pg')),
  )
  .sort();

function read(filename) {
  return fs.readFileSync(path.join(testCasesDir, filename), 'utf8');
}

testCases.forEach(function (filename) {
  test(filename, (t) => {
    let input = read(filename),
      tokens = lex(input, {filename: filename}),
      ast = parse(tokens, {filename: filename});

    t.assert.snapshot(ast);
  });
});

test('shared nested empty source parses as an empty root block', () => {
  var filename = 'fixtures/empty.pg';
  var ast = parse(lex(read(filename), {filename}), {filename});
  assert.strictEqual(ast.type, 'Block');
  assert.deepStrictEqual(ast.nodes, []);
  assert.strictEqual(ast.filename, filename);
});

test('shared nested doctype parses as canonical leading text', () => {
  var filename = 'auxiliary/blocks-in-blocks-layout.pg';
  var ast = parse(lex(read(filename), {filename}), {filename});
  assert.deepStrictEqual(ast.nodes[0], {
    type: 'Text',
    line: 1,
    column: 1,
    filename,
    val: '<!DOCTYPE html>',
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

  test('INVALID_TOKEN for unexpected token in tag-content position', () => {
    var tokens = lex('div', {filename: 'test.pg'});
    tokens.splice(1, 0, {type: 'bogus', loc: {start: {line: 1, column: 4}}});
    assert.throws(
      () => parse(tokens, {filename: 'test.pg'}),
      (err) =>
        err.code === 'PUGNEUM:INVALID_TOKEN' &&
        err.msg === 'Unexpected token `bogus` while parsing tag content',
    );
  });

  test('INVALID_TOKEN from the _parseExpr default fires on a bogus leading token', () => {
    // Splicing the bogus token after `div` enters tag()'s tag-position default
    // (message "Unexpected token `...`"). A bogus token in expression position
    // (index 0) instead hits the _parseExpr dispatch default, whose distinct
    // message is "unexpected token \"...\"". Pin that branch by its message so
    // a regression collapsing it into another arm cannot pass silently.
    const loc = {start: {line: 1, column: 1}};
    const tokens = [
      {type: 'bogus', loc},
      {type: 'eos', loc},
    ];
    assert.throws(
      () => parse(tokens, {filename: 'test.pg'}),
      (err) =>
        err.code === 'PUGNEUM:INVALID_TOKEN' &&
        /unexpected token "bogus"/.test(err.msg),
    );
  });

  test('INVALID_TOKEN messages distinguish the ref-link/ref-image/footnote scan loops', () => {
    // parseRefLinkContent, parseRefImageContent and the parseFootnotes inner
    // loop each have their own INVALID_TOKEN default with a distinct noun.
    // These reach() through a hand-built token stream only; assert the message
    // so each branch is individually pinned (they were previously untested).
    const loc = {start: {line: 1, column: 1}};
    const expectMsg = (tokens, re) =>
      assert.throws(
        () => parse(tokens, {filename: 'test.pg'}),
        (err) => err.code === 'PUGNEUM:INVALID_TOKEN' && re.test(err.msg),
      );

    expectMsg(
      [
        {type: 'start-ref-link', val: 'x', loc},
        {type: 'footnotes', loc},
        {type: 'end-ref-link', loc},
        {type: 'eos', loc},
      ],
      /Unexpected token in reference link: footnotes/,
    );
    expectMsg(
      [
        {type: 'start-ref-image', val: 'x', loc},
        {type: 'footnotes', loc},
        {type: 'end-ref-image', loc},
        {type: 'eos', loc},
      ],
      /Unexpected token in reference image: footnotes/,
    );
    expectMsg(
      [
        {type: 'footnotes', loc},
        {type: 'footnote-def-start', val: 'n', loc},
        {type: 'toc', loc},
        {type: 'footnote-def-end', loc},
        {type: 'eos', loc},
      ],
      /Unexpected token in footnote definition: toc/,
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

  test('a multi-line footnote body does not gain a spurious leading space', (t) => {
    // parseFootnotes joins multi-line footnote bodies with a single space, but
    // the space is a separator: it must appear BETWEEN content, never lead it.
    // When the body starts on the line after the name, the lexer emits a
    // leading newline token; converting it unconditionally to a space
    // prepended a stray U+0020 (rendered footnote " first line second line").
    const source = [
      'p ^[n] z',
      '',
      'footnotes',
      '  n',
      '    one',
      '    two',
    ].join('\n');
    const tokens = lex(source, {filename: 'test'});
    const ast = parse(tokens, {filename: 'test', source});
    const def = ast.nodes.find((n) => n.type === 'Footnotes').definitions[0];
    const vals = def.block.nodes
      .filter((n) => n.type === 'Text')
      .map((n) => n.val);
    // No leading separator; the interior newline still joins the two lines.
    assert.deepStrictEqual(vals, ['one', ' ', 'two']);
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
