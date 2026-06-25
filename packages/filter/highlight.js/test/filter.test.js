'use strict';

var assert = require('node:assert/strict');
var {test, describe} = require('node:test');

var hljs = require('../');

describe('highlight.js filter', () => {
  test('exports type html', () => {
    assert.strictEqual(hljs.type, 'html');
  });

  test('known language highlights', () => {
    var out = hljs.filter('var x = 1;', {language: 'javascript'});
    assert.match(out, /class="hljs/);
  });

  // ignoreIllegals arrives as a string from the lexer. The string "false" is
  // truthy, so the old `if (ignoreIllegals)` ENABLED strict-mode suppression —
  // the opposite of intent. `=false` must now actually disable it.
  describe('ignoreIllegals coercion', () => {
    // json grammar still honors `illegal`, so strict vs permissive is visible.
    var illegal = 'this is not json {{{';

    test('ignoreIllegals=false yields strict highlighting (returns raw text)', () => {
      var strict = hljs.filter(illegal, {
        language: 'json',
        ignoreIllegals: 'false',
      });
      var permissive = hljs.filter(illegal, {
        language: 'json',
        ignoreIllegals: 'true',
      });
      // Under strict mode hljs aborts and returns the (escaped) raw text, so the
      // strict and permissive outputs must differ. Before the fix they were
      // identical because "false" was treated as truthy.
      assert.notStrictEqual(strict, permissive);
    });

    test('ignoreIllegals=true matches a bare ignoreIllegals flag', () => {
      var asString = hljs.filter(illegal, {
        language: 'json',
        ignoreIllegals: 'true',
      });
      var asFlag = hljs.filter(illegal, {
        language: 'json',
        ignoreIllegals: true,
      });
      assert.strictEqual(asString, asFlag);
    });
  });

  // A bare valueless attribute arrives as boolean true; non-strings must give a
  // clear error rather than an opaque hljs TypeError.
  describe('non-string attribute validation', () => {
    test('boolean language throws a clear message', () => {
      assert.throws(
        () => hljs.filter('code', {language: true}),
        /language must be a string/,
      );
    });

    test('boolean languageSubset throws a clear message', () => {
      assert.throws(
        () => hljs.filter('code', {languageSubset: true}),
        /languageSubset must be a string/,
      );
    });
  });
});
