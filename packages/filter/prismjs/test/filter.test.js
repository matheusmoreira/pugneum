'use strict';

var assert = require('node:assert/strict');
var {test, describe} = require('node:test');

var prism = require('../');
var lex = require('pugneum-lexer');
var parse = require('pugneum-parser');
var filter = require('pugneum-filterer');

describe('prismjs filter', () => {
  test('exports type html', () => {
    assert.strictEqual(prism.type, 'html');
  });

  test('no language: HTML-escapes <, &, > and " (consistent with the language path)', () => {
    var out = prism.filter('<script>a()</script> & "x" > y', {});
    // The old no-language path left > and " raw; they must now be escaped too.
    assert.strictEqual(
      out,
      '&lt;script&gt;a()&lt;/script&gt; &amp; &quot;x&quot; &gt; y',
    );
    assert.doesNotMatch(out, /<script>/);
  });

  test('unknown language throws', () => {
    assert.throws(
      () => prism.filter('code', {language: 'definitelynotalang'}),
      /Unknown language/,
    );
  });

  test('language=__proto__ is rejected, not silently highlighted against Object.prototype', () => {
    assert.throws(
      () => prism.filter('code', {language: '__proto__'}),
      /Unknown language/,
    );
  });

  test('known language highlights (token spans emitted)', () => {
    var out = prism.filter('var x = 1;', {language: 'javascript'});
    assert.match(out, /class="token/);
  });

  // The documented invocation name is :prismjs (auto-resolves to
  // pugneum-filter-prismjs). Drive the real pipeline under that name so the
  // documented name is actually exercised (the snapshot case uses `highlight`).
  test('the documented :prismjs filter name works through the pipeline', () => {
    var source =
      'pre\n  code\n    :prismjs(language=javascript)\n      var x = 1;';
    var options = {filename: 'inline.pg'};
    var ast = parse(lex(source, options), options);
    var filtered = filter(ast, {prismjs: prism});
    assert.strictEqual(filtered.type, 'Block');
  });
});
