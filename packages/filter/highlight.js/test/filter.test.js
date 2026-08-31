'use strict';

var assert = require('node:assert/strict');
var {test, describe} = require('node:test');

var hljs = require('../');
var highlightJs = require('highlight.js');

describe('highlight.js filter', () => {
  test('exports type html', () => {
    assert.strictEqual(hljs.type, 'html');
  });

  test('known language highlights', () => {
    var out = hljs.filter('var x = 1;', {language: 'javascript'});
    assert.match(out, /class="hljs/);
  });

  // ignoreIllegals arrives as a string from the lexer. The string "false" is
  // truthy, so the old branch enabled permissive highlighting — the opposite
  // of intent. `=false` must preserve strict highlighting.
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
      assert.strictEqual(strict, illegal);
      assert.match(permissive, /class="hljs-punctuation"/);
    });

    test('omission is strict and boolean false matches string false', () => {
      assert.strictEqual(
        hljs.filter(illegal, {language: 'json'}),
        hljs.filter(illegal, {
          language: 'json',
          ignoreIllegals: 'false',
        }),
      );
      assert.strictEqual(
        hljs.filter(illegal, {
          language: 'json',
          ignoreIllegals: false,
        }),
        illegal,
      );
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
        /language must be a nonempty string/,
      );
    });

    test('boolean languageSubset throws a clear message', () => {
      assert.throws(
        () => hljs.filter('code', {languageSubset: true}),
        /languageSubset must be a nonempty string/,
      );
    });

    test('all supplied invalid language values use a stable code', () => {
      [null, false, 0, 0n, NaN, '', [], {}, function () {}].forEach((value) => {
        assert.throws(
          () => hljs.filter('code', {language: value}),
          (err) => {
            assert.strictEqual(err.code, 'PUGNEUM:INVALID_HIGHLIGHT_OPTION');
            assert.match(err.msg, /language.*nonempty string/i);
            return true;
          },
        );
      });
    });

    test('all supplied invalid subset values use the same stable code', () => {
      [null, false, 0, 0n, NaN, '', [], {}, function () {}].forEach((value) => {
        assert.throws(
          () => hljs.filter('code', {languageSubset: value}),
          (err) => {
            assert.strictEqual(err.code, 'PUGNEUM:INVALID_HIGHLIGHT_OPTION');
            assert.match(err.msg, /languageSubset.*nonempty string/i);
            return true;
          },
        );
      });
    });
  });

  describe('language subset normalization', () => {
    test('default autodetection uses the documented bounded grammar set', () => {
      var original = highlightJs.highlightAuto;
      var received;
      highlightJs.highlightAuto = function (text, subset) {
        received = subset;
        return {value: 'stubbed'};
      };
      try {
        assert.strictEqual(hljs.filter('code', {}), 'stubbed');
      } finally {
        highlightJs.highlightAuto = original;
      }
      assert.deepStrictEqual(received, [
        'bash',
        'c',
        'cpp',
        'css',
        'go',
        'java',
        'javascript',
        'json',
        'markdown',
        'python',
        'ruby',
        'rust',
        'sql',
        'typescript',
        'xml',
        'yaml',
      ]);
      assert.ok(received.length < highlightJs.listLanguages().length);
    });

    test('trims names and deduplicates case variants and aliases by grammar', () => {
      var original = highlightJs.highlightAuto;
      var received;
      highlightJs.highlightAuto = function (text, subset) {
        received = subset;
        return {value: 'stubbed'};
      };
      try {
        assert.strictEqual(
          hljs.filter('code', {
            languageSubset: ' javascript, JS, json, JSON ',
          }),
          'stubbed',
        );
      } finally {
        highlightJs.highlightAuto = original;
      }
      assert.deepStrictEqual(received, ['javascript', 'json']);
    });

    test('rejects empty tokens, unknown names, oversized lists, and long input', () => {
      var cases = [
        'javascript,,json',
        'definitely-not-a-language',
        highlightJs.listLanguages().slice(0, 33).join(','),
        'javascript,'.repeat(100) + 'javascript',
      ];
      cases.forEach((languageSubset) => {
        assert.throws(
          () => hljs.filter('code', {languageSubset}),
          (err) => {
            assert.strictEqual(err.code, 'PUGNEUM:INVALID_HIGHLIGHT_OPTION');
            return true;
          },
        );
      });
    });

    test('a plaintext subset observably constrains autodetection', () => {
      var source = 'const answer = 42;';
      assert.match(hljs.filter(source, {}), /class="hljs-/);
      assert.strictEqual(
        hljs.filter(source, {languageSubset: 'plaintext'}),
        source,
      );
    });
  });

  test('rejects ignoreIllegals without an explicit language', () => {
    ['true', 'false', true, false].forEach((ignoreIllegals) => {
      assert.throws(
        () =>
          hljs.filter('this is not json {{{', {
            languageSubset: 'json',
            ignoreIllegals,
          }),
        (err) => {
          assert.strictEqual(err.code, 'PUGNEUM:INVALID_HIGHLIGHT_OPTION');
          assert.match(err.msg, /ignoreIllegals.*explicit language/i);
          return true;
        },
      );
    });
  });

  test('rejects language and languageSubset together', () => {
    assert.throws(
      () =>
        hljs.filter('code', {
          language: 'javascript',
          languageSubset: 'javascript',
        }),
      (err) =>
        err.code === 'PUGNEUM:INVALID_HIGHLIGHT_OPTION' &&
        /languageSubset.*explicit language/i.test(err.msg),
    );
  });

  test('rejects malformed attribute containers and ignores inherited options', () => {
    [null, false, 0, '', []].forEach((attributes) => {
      assert.throws(
        () => hljs.filter('code', attributes),
        (err) => err.code === 'PUGNEUM:INVALID_HIGHLIGHT_OPTION',
      );
    });

    var inherited = Object.create({language: 'definitely-not-a-language'});
    assert.doesNotThrow(() => hljs.filter('plain words', inherited));
  });

  test('rejects malformed boolean values and unknown option names', () => {
    ['yes', 1, null, {}].forEach((ignoreIllegals) => {
      assert.throws(
        () => hljs.filter('code', {language: 'javascript', ignoreIllegals}),
        (err) => err.code === 'PUGNEUM:INVALID_HIGHLIGHT_OPTION',
      );
    });
    assert.throws(
      () => hljs.filter('code', {langauge: 'javascript'}),
      (err) =>
        err.code === 'PUGNEUM:INVALID_HIGHLIGHT_OPTION' &&
        /unknown.*langauge/i.test(err.msg),
    );
  });
});
