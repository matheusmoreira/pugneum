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

describe('bare # / . error contract', () => {
  // Regression: a bare '#' at end of line/input used to throw an uncaught
  // V8 TypeError (null[0]) instead of a PUGNEUM-coded error, breaking the
  // error contract the pipeline and the error-test harness rely on.
  test('bare # at end of input throws PUGNEUM:INVALID_ID, not a TypeError', () => {
    assert.throws(
      () => lex('#', {filename: 't.pg'}),
      (err) => err.code === 'PUGNEUM:INVALID_ID',
    );
  });

  test('tag followed by empty id (div#) throws PUGNEUM:INVALID_ID', () => {
    assert.throws(
      () => lex('div#', {filename: 't.pg'}),
      (err) => err.code === 'PUGNEUM:INVALID_ID',
    );
  });

  test('# then newline throws PUGNEUM:INVALID_ID', () => {
    assert.throws(
      () => lex('#\np x', {filename: 't.pg'}),
      (err) => err.code === 'PUGNEUM:INVALID_ID',
    );
  });
});

describe('addText escaped-run performance', () => {
  // Regression: N adjacent escaped sequences on one line scanned O(N^2) bytes
  // because findEarliestCandidate ran a separate full-tail indexOf per
  // construct and was re-invoked once per escape. ~40 KB of '\\' previously
  // took tens of seconds; the single-pass scanner must make it near-instant.
  test('a long run of escaped backslashes lexes in linear time', () => {
    const input = 'p ' + '\\\\'.repeat(40000);
    const start = process.hrtime.bigint();
    const tokens = lex(input, {filename: 'stress.pg'});
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    // Generous budget: the quadratic version blew past this by orders of
    // magnitude (>>1s at this size), while the linear version is a few ms.
    assert.ok(ms < 2000, 'lexing 40k escapes took ' + ms.toFixed(0) + 'ms');
    const text = tokens
      .filter((t) => t.type === 'text')
      .map((t) => t.val)
      .join('');
    // 40000 literal backslashes survive (no doubling, no shorthand firing).
    assert.strictEqual((text.match(/\\/g) || []).length, 40000);
  });
});

describe('footnote reference bracket parsing', () => {
  // Regression: interpolationsAreClosed treated a bare '[' inside an open ^[
  // as a nested bracket (needing a second ']'), while parseBracketContent (the
  // real parser) closes ^[...] at the first ']'. That made a footnote with bare
  // brackets merge the following pipeless line, diverging from the inline form.
  test('inline ^[ with a bare bracket closes at the first ]', () => {
    const tokens = lex('p ^[note [x] tail]', {filename: 't.pg'});
    const ref = tokens.find((t) => t.type === 'start-footnote-ref');
    assert.ok(ref);
    assert.strictEqual(ref.val, 'note [x');
  });

  test('pipeless ^[ with a bare bracket does NOT swallow the next line', () => {
    // Line 1 contains a ']' that closes the footnote at the first bracket.
    // With the old merge detector the bare '[' bumped a nested-bracket counter,
    // so the ']' only balanced that counter and the footnote looked unclosed,
    // wrongly merging line 2 (and its newline) into the footnote line.
    const src = 'div.\n  pre ^[note [x] more\n  next line';
    const tokens = lex(src, {filename: 't.pg'});
    const ref = tokens.find((t) => t.type === 'start-footnote-ref');
    assert.ok(ref);
    // Same footnote name as the inline form (closes at the first ']').
    assert.strictEqual(ref.val, 'note [x');
    // The two pipeless lines stay separate: a newline token sits between them
    // and the second line survives as its own text token. (Under the bug the
    // lines were merged, so there was no separating newline.)
    const texts = tokens.filter((t) => t.type === 'text').map((t) => t.val);
    assert.ok(texts.includes('next line'));
    const newlines = tokens.filter((t) => t.type === 'newline');
    assert.strictEqual(newlines.length, 1);
  });
});

describe('footnote definition source locations', () => {
  // Regression: footnotesBlock emitted def tokens lazily after incrementLine
  // had already advanced, tagging every footnote-def-start/text with the
  // FOLLOWING line and column 1. They must carry the line/column they
  // physically occupy (same discipline as referencesBlock).
  test('footnote-def tokens carry their physical line and column', () => {
    const src = 'footnotes\n  fn1 first\n  fn2 second';
    const tokens = lex(src, {filename: 't.pg'});
    const defs = tokens.filter((t) => t.type === 'footnote-def-start');
    assert.strictEqual(defs.length, 2);
    // 'fn1' is on source line 2, starting at column 3 (after two-space indent).
    assert.strictEqual(defs[0].val, 'fn1');
    assert.strictEqual(defs[0].loc.start.line, 2);
    assert.strictEqual(defs[0].loc.start.column, 3);
    // 'fn2' is on source line 3, column 3.
    assert.strictEqual(defs[1].val, 'fn2');
    assert.strictEqual(defs[1].loc.start.line, 3);
    assert.strictEqual(defs[1].loc.start.column, 3);
  });
});

describe('given keyword column accounting', () => {
  // Regression: given() hard-coded len = 'given '.length + name.length, so
  // extra spaces between the keyword and the name gave a short loc.end.column.
  test('extra spaces before the name yield an accurate end column', () => {
    const tokens = lex('given   source\n  p text', {filename: 't.pg'});
    const givenTok = tokens.find((t) => t.type === 'given');
    assert.ok(givenTok);
    // 'given' (5) + 3 spaces + 'source' (6): name ends one past col 14 => 15.
    assert.strictEqual(givenTok.loc.end.column, 15);
  });

  test('single space still ends right after the name', () => {
    const tokens = lex('given source\n  p text', {filename: 't.pg'});
    const givenTok = tokens.find((t) => t.type === 'given');
    assert.strictEqual(givenTok.loc.end.column, 13);
  });
});
