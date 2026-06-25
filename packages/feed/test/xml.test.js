var assert = require('node:assert/strict');
var {describe, test} = require('node:test');
var {escapeXml, escapeCdata} = require('../lib/xml');

describe('escapeXml', () => {
  test('escapes the five XML metacharacters', () => {
    assert.strictEqual(
      escapeXml('a & b < c > d " e \' f'),
      'a &amp; b &lt; c &gt; d &quot; e &apos; f',
    );
  });

  test('escapes & before the other entities (no double-escaping)', () => {
    assert.strictEqual(escapeXml('&amp;'), '&amp;amp;');
  });

  test('null and undefined become empty string', () => {
    assert.strictEqual(escapeXml(null), '');
    assert.strictEqual(escapeXml(undefined), '');
  });

  test('non-string values are coerced', () => {
    assert.strictEqual(escapeXml(42), '42');
  });

  test('strips C0 control characters except tab/LF/CR', () => {
    assert.strictEqual(escapeXml('a\x00\x08\x0B\x0C\x1Fb'), 'ab');
    // tab, newline, carriage return are legal and preserved
    assert.strictEqual(escapeXml('a\tb\nc\rd'), 'a\tb\nc\rd');
  });

  test('strips the BMP noncharacters U+FFFE and U+FFFF', () => {
    assert.strictEqual(escapeXml('a￾￿b'), 'ab');
  });

  test('strips lone high and low surrogates', () => {
    assert.strictEqual(escapeXml('a\uD800b'), 'ab');
    assert.strictEqual(escapeXml('a\uDC00b'), 'ab');
  });

  test('preserves valid surrogate pairs (astral characters)', () => {
    // U+1F600 GRINNING FACE is a valid pair; it must survive intact.
    assert.strictEqual(escapeXml('x\u{1F600}y'), 'x\u{1F600}y');
  });
});

describe('escapeCdata', () => {
  test('splits the ]]> terminator so it cannot break out of CDATA', () => {
    assert.strictEqual(escapeCdata('a]]>b'), 'a]]]]><![CDATA[>b');
  });

  test('leaves & < > literal inside CDATA', () => {
    assert.strictEqual(escapeCdata('a & b < c > d'), 'a & b < c > d');
  });

  test('strips illegal control characters and lone surrogates', () => {
    assert.strictEqual(escapeCdata('a\x00\uD800b'), 'ab');
  });
});
