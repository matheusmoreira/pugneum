'use strict';

var fs = require('fs');
var {test, describe} = require('node:test');
var assert = require('node:assert/strict');
var lex = require('../');

var dir = __dirname + '/../../../test-cases/';
fs.readdirSync(dir).forEach(function (testCase) {
  if (/\.pg$/.test(testCase)) {
    test(testCase, (t) => {
      var result = lex(fs.readFileSync(dir + testCase, 'utf8'), {
        filename: testCase,
      });
      t.assert.snapshot(result);
    });
  }
});

var lexerDir = __dirname + '/cases/';
fs.readdirSync(lexerDir).forEach(function (testCase) {
  if (/\.pg$/.test(testCase)) {
    test(testCase, (t) => {
      var result = lex(fs.readFileSync(lexerDir + testCase, 'utf8'), {
        filename: testCase,
      });
      t.assert.snapshot(result);
    });
  }
});

var edir = __dirname + '/errors/';
fs.readdirSync(edir).forEach(function (testCase) {
  if (/\.pg$/.test(testCase)) {
    test(testCase, (t) => {
      var actual;
      try {
        lex(fs.readFileSync(edir + testCase, 'utf8'), {
          filename: testCase,
        });
        throw new Error('Expected ' + testCase + ' to throw an exception.');
      } catch (ex) {
        if (!ex || !ex.code || ex.code.indexOf('PUGNEUM:') !== 0) throw ex;
        actual = {
          msg: ex.msg,
          code: ex.code,
          line: ex.line,
          column: ex.column,
        };
      }
      t.assert.snapshot(actual);
    });
  }
});

test('many escaped shorthands in single text node', (t) => {
  const escapes = Array(100).fill('\\*(x)').join(' ');
  const input = 'p ' + escapes + ' end';
  const tokens = lex(input, {filename: 'stress.pg'});
  const textTokens = tokens.filter((tok) => tok.type === 'text');
  const joined = textTokens.map((tok) => tok.val).join('');
  t.assert.strictEqual((joined.match(/\*\(x\)/g) || []).length, 100);
  t.assert.ok(joined.endsWith('end'));
  t.assert.ok(!joined.includes('<strong>'));
});

describe('given keyword', () => {
  test('given produces token with block name', (t) => {
    const tokens = lex('given source\n  p text', {filename: 'test'});
    const givenTok = tokens.find((t) => t.type === 'given');
    assert.ok(givenTok);
    assert.strictEqual(givenTok.val, 'source');
  });

  test('escaped given is a tag', (t) => {
    const tokens = lex('\\given', {filename: 'test'});
    const tagTok = tokens.find((t) => t.type === 'tag');
    assert.ok(tagTok);
    assert.strictEqual(tagTok.val, 'given');
  });

  test('bare given throws MALFORMED_GIVEN', (t) => {
    assert.throws(
      () => lex('given', {filename: 'test'}),
      (err) => err.code === 'PUGNEUM:MALFORMED_GIVEN',
    );
  });

  test('given with comment strips name correctly', (t) => {
    const tokens = lex('given source // optional\n  p text', {
      filename: 'test',
    });
    const givenTok = tokens.find((t) => t.type === 'given');
    assert.ok(givenTok);
    assert.strictEqual(givenTok.val, 'source');
  });
});

describe('typographic quote warnings in attributes', () => {
  const LSQUO = '‘';
  const RSQUO = '’';
  const LDQUO = '“';
  const RDQUO = '”';

  function attr(tokens, name) {
    return tokens.find((tok) => tok.type === 'attribute' && tok.name === name);
  }

  test('smart single quotes around a value warn and keep the value literal', () => {
    const warnings = [];
    const tokens = lex('a(href=' + LSQUO + '/x' + RSQUO + ')', {
      filename: 'smart.pg',
      warnings,
    });
    assert.strictEqual(attr(tokens, 'href').val, LSQUO + '/x' + RSQUO);
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].code, 'PUGNEUM:TYPOGRAPHIC_QUOTE_DELIMITER');
    assert.strictEqual(warnings[0].line, 1);
    assert.strictEqual(warnings[0].filename, 'smart.pg');
  });

  test('smart double quotes around a value warn and keep the value literal', () => {
    const warnings = [];
    const tokens = lex('a(href=' + LDQUO + '/x' + RDQUO + ')', {
      filename: 'smart.pg',
      warnings,
    });
    assert.strictEqual(attr(tokens, 'href').val, LDQUO + '/x' + RDQUO);
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].code, 'PUGNEUM:TYPOGRAPHIC_QUOTE_DELIMITER');
  });

  test('a lone right single quote on both sides still warns', () => {
    const warnings = [];
    lex('a(href=' + RSQUO + '/x' + RSQUO + ')', {
      filename: 'smart.pg',
      warnings,
    });
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].code, 'PUGNEUM:TYPOGRAPHIC_QUOTE_DELIMITER');
  });

  test('ASCII straight quotes produce no warning', () => {
    const warnings = [];
    lex('a(href=\'/x\' class="y")', {filename: 'ascii.pg', warnings});
    assert.strictEqual(warnings.length, 0);
  });

  test('a smart quote inside an ASCII-quoted value is content, not a delimiter, and does not warn', () => {
    const warnings = [];
    const tokens = lex('a(title="Baby' + RSQUO + 's GC")', {
      filename: 'content.pg',
      warnings,
    });
    assert.strictEqual(attr(tokens, 'title').val, 'Baby' + RSQUO + 's GC');
    assert.strictEqual(warnings.length, 0);
  });

  test('warnings collector is optional (no throw when omitted)', () => {
    assert.doesNotThrow(() =>
      lex('a(href=' + LSQUO + '/x' + RSQUO + ')', {filename: 'smart.pg'}),
    );
  });

  test('warnings from nested inline content propagate to the shared collector', () => {
    const warnings = [];
    lex('p text !(/img.png alt)(title=' + LSQUO + 'x' + RSQUO + ') more', {
      filename: 'inline.pg',
      warnings,
    });
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].code, 'PUGNEUM:TYPOGRAPHIC_QUOTE_DELIMITER');
  });

  test('smart quotes around an attribute name warn (the broken name is otherwise silent)', () => {
    const warnings = [];
    const tokens = lex('a(' + LSQUO + 'data-x' + RSQUO + '=y)', {
      filename: 'key.pg',
      warnings,
    });
    // The smart quotes survive as part of the (broken) attribute name.
    assert.ok(attr(tokens, LSQUO + 'data-x' + RSQUO));
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].code, 'PUGNEUM:TYPOGRAPHIC_QUOTE_DELIMITER');
  });
});

describe('non-ASCII whitespace in indentation', () => {
  const NBSP = ' ';

  test('NBSP used as indentation throws a clear NON_ASCII_WHITESPACE error', () => {
    assert.throws(
      () => lex('ul\n' + NBSP + NBSP + 'li x', {filename: 't.pg'}),
      (err) => err.code === 'PUGNEUM:NON_ASCII_WHITESPACE',
    );
  });

  test('NBSP after a leading space also throws NON_ASCII_WHITESPACE', () => {
    assert.throws(
      () => lex('ul\n ' + NBSP + 'li x', {filename: 't.pg'}),
      (err) => err.code === 'PUGNEUM:NON_ASCII_WHITESPACE',
    );
  });

  test('the error message names the offending codepoint', () => {
    assert.throws(
      () => lex('ul\n' + NBSP + 'li x', {filename: 't.pg'}),
      (err) => /U\+00A0/.test(err.msg),
    );
  });

  test('NBSP inside text content is left alone (no error)', () => {
    assert.doesNotThrow(() =>
      lex('p hello' + NBSP + 'world', {filename: 't.pg'}),
    );
  });
});
