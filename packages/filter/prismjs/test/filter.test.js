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

  test('entry loading and escape-only filtering do not initialize Prism', () => {
    var bundle = require.resolve('prism-minmaxed');
    assert.strictEqual(require.cache[bundle], undefined);
    assert.strictEqual(prism.filter('<code>', {}), '&lt;code&gt;');
    assert.strictEqual(require.cache[bundle], undefined);
  });

  test('no language uses Pugneum full HTML escaping', () => {
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

  test('supplied language values must be nonempty strings', () => {
    var coercible = {toString: () => 'javascript'};
    [null, false, 0, 0n, NaN, '', [], ['javascript'], {}, coercible].forEach(
      (language) => {
        assert.throws(
          () => prism.filter('code', {language}),
          (err) => {
            assert.strictEqual(err.code, 'PUGNEUM:INVALID_HIGHLIGHT_OPTION');
            assert.match(err.msg, /language.*nonempty string/i);
            return true;
          },
        );
      },
    );
  });

  test('unknown option names use the shared highlight option code', () => {
    assert.throws(
      () => prism.filter('code', {langauge: 'javascript'}),
      (err) =>
        err.code === 'PUGNEUM:INVALID_HIGHLIGHT_OPTION' &&
        /unknown.*langauge/i.test(err.msg),
    );
  });

  test('rejects malformed attribute containers and ignores inherited options', () => {
    [null, false, 0, '', []].forEach((attributes) => {
      assert.throws(
        () => prism.filter('code', attributes),
        (err) => err.code === 'PUGNEUM:INVALID_HIGHLIGHT_OPTION',
      );
    });

    var inherited = Object.create({language: 'javascript'});
    assert.strictEqual(prism.filter('<code>', inherited), '&lt;code&gt;');
  });

  test('language=__proto__ is rejected, not silently highlighted against Object.prototype', () => {
    assert.throws(
      () => prism.filter('code', {language: '__proto__'}),
      /Unknown language/,
    );
  });

  test('own Prism helper functions are not accepted as grammars', () => {
    ['extend', 'insertBefore', 'DFS'].forEach((language) => {
      assert.throws(() => prism.filter('code', {language}), /Unknown language/);
    });
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
    assert.match(filtered.nodes[0].block.nodes[0].block.nodes[0].val, /token/);
  });

  test('coded option errors retain the filter invocation location', () => {
    var source = 'pre\n  :prismjs(language)\n    code';
    var options = {filename: 'located.pg', source};
    var ast = parse(lex(source, options), options);
    assert.throws(
      () => filter(ast, {prismjs: prism}, options),
      (err) => {
        assert.strictEqual(err.code, 'PUGNEUM:INVALID_HIGHLIGHT_OPTION');
        assert.strictEqual(err.filename, 'located.pg');
        assert.strictEqual(err.line, 2);
        assert.strictEqual(err.column, 3);
        assert.match(err.message, /2\|   :prismjs\(language\)/);
        return true;
      },
    );
  });
});
