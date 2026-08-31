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
    var core = require.resolve('prismjs');
    var components = require.resolve('prismjs/components/');
    var registry = require.resolve('prismjs/components.json');
    assert.strictEqual(require.cache[core], undefined);
    assert.strictEqual(require.cache[components], undefined);
    assert.strictEqual(require.cache[registry], undefined);
    assert.strictEqual(prism.filter('<code>', {}), '&lt;code&gt;');
    assert.strictEqual(require.cache[core], undefined);
    assert.strictEqual(require.cache[components], undefined);
    assert.strictEqual(require.cache[registry], undefined);
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
    var core = require.resolve('prismjs');
    assert.throws(
      () => prism.filter('code', {language: 'definitelynotalang'}),
      /Unknown language/,
    );
    assert.strictEqual(require.cache[core], undefined);
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

  test('registry aliases and component dependencies load on demand', () => {
    assert.match(
      prism.filter('const value: string = "ok";', {language: 'TS'}),
      /token builtin/,
    );
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
