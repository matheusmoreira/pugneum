var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var util = require('node:util');
var {describe, test} = require('node:test');
var error = require('../');
var packageRoot = path.resolve(__dirname, '..');
var readme = fs.readFileSync(path.join(packageRoot, 'README.md'), 'utf8');
var manifest = require('../package.json');

function assertDiagnosticFields(actual, expected) {
  assert.deepStrictEqual(
    {
      code: actual.code,
      msg: actual.msg,
      line: actual.line,
      column: actual.column,
      filename: actual.filename,
      source: actual.source,
    },
    expected,
  );
}

describe('public documentation', function () {
  test('documents both factories and caller-owned warning collection', function () {
    assert.match(readme, /### `error\(code, message, options\)`/);
    assert.match(readme, /### `error\.warning\(code, message, options\)`/);
    assert.match(readme, /plain\s+object, not an `Error` instance/);
    assert.match(readme, /factory neither\s+throws nor logs it/);
    assert.match(readme, /warnings\.push\(/);
  });

  test('documents normalized and bounded display inputs', function () {
    assert.match(readme, /Each option is read once/);
    assert.match(readme, /one-based safe integers/);
    assert.match(readme, /safely representable BigInts/);
    assert.match(readme, /LF, CRLF, and CR source/);
    assert.match(readme, /terminal display-cell widths/);
    assert.match(readme, /Terminal controls[\s\S]*visible escapes/);
    assert.match(readme, /bounded 120-cell excerpt/);
    assert.match(readme, /full normalized `msg`, `filename`, and\s+`source`/);
  });

  test('documents the versioned JSON and trusted-source boundary', function () {
    assert.match(readme, /`schemaVersion: 1`/);
    assert.match(readme, /`severity`.*`error`.*`warning`/s);
    assert.match(readme, /`message`.*short, unformatted/s);
    assert.match(
      readme,
      /displayMessage: diagnostic\.message, \/\/ formatted display text/,
    );
    assert.match(
      readme,
      /location: \{\s+filename:.*\s+line:.*\s+column:.*\s+byteOffset:/s,
    );
    assert.match(readme, /`source`.*non-enumerable/s);
    assert.match(readme, /toJSON\(\{includeSource: true\}\)/);
    assert.match(readme, /trusted/);
  });

  test('documents the cumulative compilation budget contract', function () {
    assert.match(readme, /### `error\.createCompilationContext\(limits\?\)`/);
    assert.match(readme, /`error\.DEFAULT_COMPILATION_LIMITS`/);
    assert.match(readme, /`sourceBytes`/);
    assert.match(readme, /`materializedNodes`/);
    assert.match(readme, /`outputBytes`/);
    assert.match(readme, /`PUGNEUM:COMPILATION_LIMIT_EXCEEDED`/);
    assert.match(readme, /### `error\.getCompilationContext\(options\?\)`/);
  });

  test('package metadata and prose name both diagnostic kinds', function () {
    assert.strictEqual(
      manifest.description,
      'Pugneum error and warning diagnostic factories',
    );
    assert.ok(manifest.keywords.includes('error'));
    assert.ok(manifest.keywords.includes('warning'));
    assert.ok(manifest.keywords.includes('diagnostic'));
    assert.doesNotMatch(readme, /\buseby\b/i);
  });
});

describe('compilation context', function () {
  test('publishes frozen defaults and validates exact overrides', function () {
    assert.ok(Object.isFrozen(error.DEFAULT_COMPILATION_LIMITS));
    assert.ok(error.DEFAULT_COMPILATION_LIMITS.astNodes > 0);

    var context = error.createCompilationContext({astNodes: 3});
    assert.strictEqual(context.limit('astNodes'), 3);
    assert.strictEqual(
      context.limit('sourceBytes'),
      error.DEFAULT_COMPILATION_LIMITS.sourceBytes,
    );
    assert.throws(function () {
      error.createCompilationContext({unknown: 1});
    }, /Unknown compilation limit: unknown/);
    for (var value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1']) {
      assert.throws(function () {
        error.createCompilationContext({astNodes: value});
      }, /non-negative safe integer/);
    }
  });

  test('charges cumulatively and fails with stable structured fields', function () {
    var context = error.createCompilationContext({astNodes: 2});
    assert.strictEqual(context.charge('astNodes', 1), 1);
    assert.strictEqual(context.assertWithin('astNodes', 2), 2);
    assert.strictEqual(context.remaining('astNodes'), 1);
    assert.strictEqual(context.charge('astNodes', 1), 2);

    assert.throws(
      function () {
        context.charge(
          'astNodes',
          1,
          {filename: 'wide.pg', line: 4, column: 2},
          'testing a wide tree',
        );
      },
      function (failure) {
        assert.strictEqual(failure.code, 'PUGNEUM:COMPILATION_LIMIT_EXCEEDED');
        assert.strictEqual(failure.resource, 'astNodes');
        assert.strictEqual(failure.attempted, 3);
        assert.strictEqual(failure.limit, 2);
        assert.strictEqual(failure.filename, 'wide.pg');
        assert.strictEqual(failure.line, 4);
        assert.strictEqual(failure.column, 2);
        assert.match(failure.message, /testing a wide tree/);
        return true;
      },
    );

    var snapshot = context.snapshot();
    assert.ok(Object.isFrozen(snapshot));
    assert.ok(Object.isFrozen(snapshot.limits));
    assert.ok(Object.isFrozen(snapshot.used));
    assert.strictEqual(snapshot.used.astNodes, 2);
  });

  test('bounds caller-owned and hardened warning collectors', function () {
    var context = error.createCompilationContext({diagnostics: 1});
    var warnings = [];
    var seen = new Set();
    Object.defineProperty(warnings, 'push', {
      value: function (warning) {
        if (!seen.has(warning.code)) {
          seen.add(warning.code);
          Array.prototype.push.call(warnings, warning);
        }
        return warnings.length;
      },
    });
    var wrapped = context.wrapWarnings(warnings);
    assert.ok(Array.isArray(wrapped));
    wrapped.push(error.warning('FIRST', 'first'));
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(wrapped.length, 1);
    assert.throws(
      function () {
        wrapped.push(error.warning('SECOND', 'second'));
      },
      function (failure) {
        return (
          failure.code === 'PUGNEUM:COMPILATION_LIMIT_EXCEEDED' &&
          failure.resource === 'diagnostics'
        );
      },
    );
    assert.strictEqual(warnings.length, 1);

    // Reusing the caller's sink for a separate compilation is legal; only a
    // wrapper already carrying another active context is rejected.
    var next = error.createCompilationContext({diagnostics: 1});
    assert.notStrictEqual(next.wrapWarnings(warnings), wrapped);
    assert.throws(function () {
      next.wrapWarnings(wrapped);
    }, /already bound to another compilation context/);
  });
});

describe('with a source', function () {
  test('and a filename', function () {
    var err = error('MY_CODE', 'My message', {
      line: 3,
      filename: 'myfile',
      source: 'foo\nbar\nbaz\nbash\nbing',
    });
    assert.strictEqual(
      err.message,
      'myfile:3\n    1| foo\n    2| bar\n  > 3| baz\n    4| bash\n    5| bing\n\nMy message',
    );
    assertDiagnosticFields(err, {
      code: 'PUGNEUM:MY_CODE',
      msg: 'My message',
      line: 3,
      column: undefined,
      filename: 'myfile',
      source: 'foo\nbar\nbaz\nbash\nbing',
    });
  });
  test('and no filename', function () {
    var err = error('MY_CODE', 'My message', {
      line: 3,
      source: 'foo\nbar\nbaz\nbash\nbing',
    });
    assert.strictEqual(
      err.message,
      '3\n    1| foo\n    2| bar\n  > 3| baz\n    4| bash\n    5| bing\n\nMy message',
    );
    assertDiagnosticFields(err, {
      code: 'PUGNEUM:MY_CODE',
      msg: 'My message',
      line: 3,
      column: undefined,
      filename: undefined,
      source: 'foo\nbar\nbaz\nbash\nbing',
    });
  });
});

test('error() returns a native Error with a useful caller stack', function () {
  var err = error('STACK_TEST', 'Stack message', {
    filename: 'stack.pg',
    line: 2,
  });

  assert.ok(err instanceof Error);
  assert.strictEqual(Object.getPrototypeOf(err), Error.prototype);
  assert.strictEqual(typeof err.stack, 'string');
  assert.match(err.stack, /^Error: stack\.pg:2\n\nStack message\n/);
  assert.match(err.stack, /packages\/error\/test\/index\.test\.js/);
});

describe('without source', function () {
  test('and with a filename', function () {
    var err = error('MY_CODE', 'My message', {line: 3, filename: 'myfile'});
    assert.strictEqual(err.message, 'myfile:3\n\nMy message');
    assertDiagnosticFields(err, {
      code: 'PUGNEUM:MY_CODE',
      msg: 'My message',
      line: 3,
      column: undefined,
      filename: 'myfile',
      source: undefined,
    });
  });
  test('and with no filename', function () {
    var err = error('MY_CODE', 'My message', {line: 3});
    assert.strictEqual(err.message, '3\n\nMy message');
    assertDiagnosticFields(err, {
      code: 'PUGNEUM:MY_CODE',
      msg: 'My message',
      line: 3,
      column: undefined,
      filename: undefined,
      source: undefined,
    });
  });
});

describe('with column', function () {
  test('and with a filename', function () {
    var err = error('MY_CODE', 'My message', {
      line: 3,
      column: 2,
      filename: 'myfile',
      source: 'foo\nbar\nbaz\nbash\nbing',
    });
    assert.strictEqual(
      err.message,
      'myfile:3:2\n    1| foo\n    2| bar\n  > 3| baz\n--------^\n    4| bash\n    5| bing\n\nMy message',
    );
    assertDiagnosticFields(err, {
      code: 'PUGNEUM:MY_CODE',
      msg: 'My message',
      line: 3,
      column: 2,
      filename: 'myfile',
      source: 'foo\nbar\nbaz\nbash\nbing',
    });
  });
  test('and with no filename', function () {
    var err = error('MY_CODE', 'My message', {line: 3, column: 1});
    assert.strictEqual(err.message, '3:1\n\nMy message');
    assertDiagnosticFields(err, {
      code: 'PUGNEUM:MY_CODE',
      msg: 'My message',
      line: 3,
      column: 1,
      filename: undefined,
      source: undefined,
    });
  });
});

describe('invalid information', function () {
  test('an invalid column is omitted instead of drawing a misleading caret', function () {
    var err = error('MY_CODE', 'My message', {
      line: 3,
      column: -1,
      source: 'foo\nbar\nbaz\nbash\nbing',
    });
    assert.strictEqual(
      err.message,
      '3\n    1| foo\n    2| bar\n  > 3| baz\n    4| bash\n    5| bing\n\nMy message',
    );
    assertDiagnosticFields(err, {
      code: 'PUGNEUM:MY_CODE',
      msg: 'My message',
      line: 3,
      column: undefined,
      filename: undefined,
      source: 'foo\nbar\nbaz\nbash\nbing',
    });
  });
  test('zero is absent while a positive out-of-range line keeps its header', function () {
    var zero = error('MY_CODE', 'My message', {
      line: 0,
      source: 'foo\nbar\nbaz\nbash\nbing',
    });
    assert.strictEqual(zero.message, 'My message');
    assert.strictEqual(zero.line, undefined);

    var beyond = error('MY_CODE', 'My message', {
      line: 6,
      source: 'foo\nbar\nbaz\nbash\nbing',
    });
    assert.strictEqual(beyond.message, '6\n\nMy message');
    assert.strictEqual(beyond.line, 6);
  });
});

describe('warning', function () {
  test('formats like an error but is a plain, non-throwing object', function () {
    var warn = error.warning('TYPOGRAPHIC_QUOTE_DELIMITER', 'My message', {
      line: 3,
      column: 2,
      filename: 'myfile',
      source: 'foo\nbar\nbaz\nbash\nbing',
    });
    assert.strictEqual(
      warn.message,
      'myfile:3:2\n    1| foo\n    2| bar\n  > 3| baz\n--------^\n    4| bash\n    5| bing\n\nMy message',
    );
    assertDiagnosticFields(warn, {
      code: 'PUGNEUM:TYPOGRAPHIC_QUOTE_DELIMITER',
      msg: 'My message',
      line: 3,
      column: 2,
      filename: 'myfile',
      source: 'foo\nbar\nbaz\nbash\nbing',
    });
    assert.ok(
      !(warn instanceof Error),
      'warning must not be an Error instance',
    );
    assert.strictEqual(Object.getPrototypeOf(warn), Object.prototype);
    assert.strictEqual(warn.stack, undefined);
  });

  test('shares an identical message format with error()', function () {
    var opts = {
      line: 3,
      column: 2,
      filename: 'myfile',
      source: 'foo\nbar\nbaz\nbash\nbing',
    };
    var err = error('SAME', 'Same message', opts);
    var warn = error.warning('SAME', 'Same message', opts);
    assert.strictEqual(warn.message, err.message);
  });

  test('error and warning use one versioned JSON schema with severity', function () {
    for (const factory of [error, error.warning]) {
      var diagnostic = factory('CODE', 'msg', {
        line: 1n,
        column: 4n,
        filename: 'f',
        source: 'abcd',
      });
      var expected = {
        schemaVersion: 1,
        code: 'PUGNEUM:CODE',
        severity: factory === error ? 'error' : 'warning',
        message: 'msg',
        displayMessage: 'f:1:4\n  > 1| abcd\n----------^\n\nmsg',
        location: {filename: 'f', line: 1, column: 4},
      };
      assert.strictEqual(error.DIAGNOSTIC_JSON_VERSION, 1);
      assert.strictEqual(diagnostic.severity, expected.severity);
      assert.deepStrictEqual(diagnostic.toJSON(), expected);
      assert.deepStrictEqual(JSON.parse(JSON.stringify(diagnostic)), expected);
      assert.ok(!('source' in diagnostic.toJSON()));
      assert.ok(!('stack' in diagnostic.toJSON()));
    }
  });

  test('raw source is live but absent from spread and default inspection', function () {
    var source =
      'shown\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nRAW_SECRET';
    for (const factory of [error, error.warning]) {
      var diagnostic = factory('PRIVATE', 'message', {
        filename: 'private.pg',
        line: 1,
        source,
      });
      assert.strictEqual(diagnostic.source, source);
      assert.strictEqual(
        Object.prototype.propertyIsEnumerable.call(diagnostic, 'source'),
        false,
      );
      assert.ok(!Object.hasOwn({...diagnostic}, 'source'));
      assert.doesNotMatch(util.inspect(diagnostic), /RAW_SECRET/);
      assert.doesNotMatch(JSON.stringify(diagnostic), /RAW_SECRET/);

      var trusted = diagnostic.toJSON({includeSource: true});
      assert.strictEqual(trusted.source, source);
      assert.deepStrictEqual(
        JSON.parse(JSON.stringify(trusted)).source,
        source,
      );
    }
  });
});

describe('source newline model', function () {
  for (const entry of [
    ['LF', '\n'],
    ['CRLF', '\r\n'],
    ['CR', '\r'],
  ]) {
    test(entry[0] + ' renders the same logical frame', function () {
      var source = ['one', 'two', 'three'].join(entry[1]);
      var diagnostic = error('NEWLINE', 'message', {
        filename: 'file.pg',
        line: 2,
        column: 2,
        source: source,
      });
      assert.strictEqual(
        diagnostic.message,
        'file.pg:2:2\n    1| one\n  > 2| two\n--------^\n    3| three\n\nmessage',
      );
      assert.doesNotMatch(diagnostic.message, /\r/);
      assert.strictEqual(diagnostic.source, source);
    });
  }
});

describe('source-context window', function () {
  // A >=9-line source with an interior line is the only shape that exposes the
  // window's symmetry; every other test clamps at the source edges.
  var src = 'L1\nL2\nL3\nL4\nL5\nL6\nL7\nL8\nL9';

  test('shows a symmetric +/-3 lines around an interior offending line', function () {
    var err = error('MY_CODE', 'My message', {line: 5, source: src});
    assert.strictEqual(
      err.message,
      '5\n' +
        '    2| L2\n' +
        '    3| L3\n' +
        '    4| L4\n' +
        '  > 5| L5\n' +
        '    6| L6\n' +
        '    7| L7\n' +
        '    8| L8\n' +
        '\nMy message',
    );
  });
});

describe('robust against odd inputs', function () {
  var src = 'foo\nbar\nbaz\nbash\nbing';

  test('a fractional column is normalized to absence', function () {
    var err = error('MY_CODE', 'My message', {
      line: 3,
      column: 0.5,
      source: src,
    });
    assert.strictEqual(
      err.message,
      '3\n    1| foo\n    2| bar\n  > 3| baz\n    4| bash\n    5| bing\n\nMy message',
    );
    assert.strictEqual(err.column, undefined);
  });

  test('a string column underlines the same position as a numeric one', function () {
    var numeric = error('MY_CODE', 'My message', {
      line: 3,
      column: 2,
      source: src,
    }).message;
    var string = error('MY_CODE', 'My message', {
      line: 3,
      column: '2',
      source: src,
    }).message;
    assert.strictEqual(string, numeric);
    // and the caret is the aligned dashes, never the garbage "72^"
    assert.match(string, /\n--------\^\n/);
  });

  test('a non-string source degrades to the no-context branch instead of throwing', function () {
    var numberSource = error('MY_CODE', 'My message', {
      line: 1,
      column: 1,
      source: 12345,
    });
    assert.strictEqual(numberSource.message, '1:1\n\nMy message');
    assert.strictEqual(numberSource.source, undefined);

    var bufferSource = error('MY_CODE', 'My message', {
      line: 1,
      source: Buffer.from('a\nb\nc'),
    });
    assert.strictEqual(bufferSource.message, '1\n\nMy message');
    assert.strictEqual(bufferSource.source, undefined);
  });

  test('a string line still highlights the offending line', function () {
    var err = error('MY_CODE', 'My message', {line: '3', source: src});
    assert.strictEqual(
      err.message,
      '3\n    1| foo\n    2| bar\n  > 3| baz\n    4| bash\n    5| bing\n\nMy message',
    );
  });

  test('a missing or non-numeric line never renders the literal "undefined"', function () {
    assert.strictEqual(error('MY_CODE', 'My message').message, 'My message');
    assert.strictEqual(
      error('MY_CODE', 'My message', {source: src}).message,
      'My message',
    );
    assert.strictEqual(
      error('MY_CODE', 'My message', {line: {}, source: src}).message,
      'My message',
    );
    // a present filename is still shown, with no dangling colon
    assert.strictEqual(
      error('MY_CODE', 'My message', {filename: 'f'}).message,
      'f\n\nMy message',
    );
  });

  test('an explicit null options object is treated like a missing one', function () {
    var err = error('MY_CODE', 'My message', null);
    assert.strictEqual(err.message, 'My message');
    assert.strictEqual(err.code, 'PUGNEUM:MY_CODE');
    assert.strictEqual(err.msg, 'My message');
    var warn = error.warning('MY_CODE', 'My message', null);
    assert.strictEqual(warn.message, 'My message');
    assert.strictEqual(warn.code, 'PUGNEUM:MY_CODE');
  });

  test('both factories normalize malformed coordinates without secondary exceptions', function () {
    var invalid = [
      undefined,
      null,
      '',
      false,
      Symbol('coordinate'),
      NaN,
      Infinity,
      -Infinity,
      -1,
      0,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      9007199254740993n,
      {},
    ];

    for (const factory of [error, error.warning]) {
      for (const value of invalid) {
        var invalidLine = factory('COORDINATE', 'message', {
          line: value,
          column: 1,
          source: 'only',
        });
        assert.strictEqual(invalidLine.line, undefined);
        assert.strictEqual(invalidLine.column, undefined);
        assert.strictEqual(invalidLine.message, 'message');

        var invalidColumn = factory('COORDINATE', 'message', {
          line: 1,
          column: value,
          source: 'only',
        });
        assert.strictEqual(invalidColumn.line, 1);
        assert.strictEqual(invalidColumn.column, undefined);
        assert.strictEqual(invalidColumn.message, '1\n  > 1| only\n\nmessage');
      }
    }
  });

  test('byte offsets are zero-based, normalized, and serialized in location', function () {
    for (const factory of [error, error.warning]) {
      var diagnostic = factory('BYTE', 'message', {byteOffset: 0n});
      assert.strictEqual(diagnostic.byteOffset, 0);
      assert.strictEqual(diagnostic.toJSON().location.byteOffset, 0);

      for (const invalid of [-1, 1.5, Infinity, '', Symbol('offset')]) {
        diagnostic = factory('BYTE', 'message', {byteOffset: invalid});
        assert.strictEqual(diagnostic.byteOffset, undefined);
        assert.ok(!('byteOffset' in diagnostic.toJSON().location));
      }
    }
  });

  test('safe BigInt and numeric-string coordinates become JSON numbers', function () {
    for (const factory of [error, error.warning]) {
      var diagnostic = factory('COORDINATE', 'message', {
        line: 1n,
        column: '2',
        source: 'abc',
      });
      assert.strictEqual(diagnostic.line, 1);
      assert.strictEqual(diagnostic.column, 2);
      assert.strictEqual(typeof diagnostic.toJSON().location.line, 'number');
      assert.strictEqual(typeof diagnostic.toJSON().location.column, 'number');
      assert.doesNotThrow(function () {
        JSON.stringify(diagnostic);
      });
    }
  });

  test('a non-string filename is unavailable instead of being coerced unsafely', function () {
    for (const factory of [error, error.warning]) {
      var diagnostic = factory('FILENAME', 'message', {
        filename: Symbol('filename'),
        line: 1,
      });
      assert.strictEqual(diagnostic.filename, undefined);
      assert.strictEqual(diagnostic.message, '1\n\nmessage');
    }
  });

  test('an enormous safe column stays bounded and visibly clamps to the line', function () {
    for (const factory of [error, error.warning]) {
      var diagnostic = factory('COORDINATE', 'message', {
        line: 1,
        column: Number.MAX_SAFE_INTEGER,
        source: 'short',
      });
      assert.strictEqual(diagnostic.column, Number.MAX_SAFE_INTEGER);
      assert.ok(diagnostic.message.length < 512, diagnostic.message.length);
      assert.match(diagnostic.message, /short…\n-+\^/);
    }
  });

  test('each option is read exactly once into a shared factory snapshot', function () {
    for (const factory of [error, error.warning]) {
      var reads = {
        line: 0,
        column: 0,
        filename: 0,
        source: 0,
        byteOffset: 0,
      };
      var options = {
        get line() {
          reads.line++;
          return reads.line;
        },
        get column() {
          reads.column++;
          return reads.column;
        },
        get filename() {
          reads.filename++;
          return 'file.pg';
        },
        get source() {
          reads.source++;
          return 'first\nsecond';
        },
        get byteOffset() {
          reads.byteOffset++;
          return 0;
        },
      };
      var diagnostic = factory('SNAPSHOT', 'message', options);
      assert.deepStrictEqual(reads, {
        line: 1,
        column: 1,
        filename: 1,
        source: 1,
        byteOffset: 1,
      });
      assert.strictEqual(diagnostic.line, 1);
      assert.strictEqual(diagnostic.column, 1);
      assert.strictEqual(diagnostic.byteOffset, 0);
      assert.match(diagnostic.message, /^file\.pg:1:1\n  > 1\| first/);
    }
  });

  test('error and warning coerce every message through one safe string path', function () {
    var cases = [
      [undefined, ''],
      [null, 'null'],
      ['', ''],
      [0, '0'],
      [false, 'false'],
      [Symbol('m'), 'Symbol(m)'],
      [
        {
          toString: function () {
            return 'object message';
          },
        },
        'object message',
      ],
      [
        {
          toString: function () {
            throw new Error('conversion failed');
          },
        },
        '[unprintable diagnostic message]',
      ],
    ];

    for (const entry of cases) {
      var err = error('MESSAGE', entry[0]);
      var warn = error.warning('MESSAGE', entry[0]);
      assert.strictEqual(err.msg, entry[1]);
      assert.strictEqual(err.message, entry[1]);
      assert.strictEqual(warn.msg, entry[1]);
      assert.strictEqual(warn.message, entry[1]);
    }
  });

  test('an empty source is unavailable context for both factories', function () {
    for (const factory of [error, error.warning]) {
      var diagnostic = factory('EMPTY_SOURCE', 'message', {
        line: 1,
        column: 1,
        source: '',
      });
      assert.strictEqual(diagnostic.message, '1:1\n\nmessage');
      assert.strictEqual(diagnostic.source, '');
    }
  });
});

describe('terminal-safe bounded source frames', function () {
  function caretColumn(message) {
    var lines = message.split('\n');
    var caret = lines.find(function (line) {
      return line.endsWith('^');
    });
    assert.ok(caret, message);
    return caret.indexOf('^');
  }

  test('tabs, wide characters, emoji, and combining marks use display cells', function () {
    var cases = [
      ['p \t@(', 4, 'p       @(', 15],
      ['p 中@(', 4, 'p 中@(', 11],
      ['p 😀@(', 5, 'p 😀@(', 11],
      ['p e\u0301@(', 5, 'p e\u0301@(', 10],
    ];

    for (const entry of cases) {
      var diagnostic = error('DISPLAY_COLUMN', 'message', {
        line: 1,
        column: entry[1],
        source: entry[0],
      });
      assert.ok(diagnostic.message.includes('> 1| ' + entry[2]));
      assert.strictEqual(caretColumn(diagnostic.message), entry[3]);
    }
  });

  test('the gutter has one stable width across a decimal boundary', function () {
    var source = Array.from({length: 13}, function (_, index) {
      return 'L' + (index + 1);
    }).join('\n');
    var diagnostic = error('GUTTER', 'message', {
      line: 10,
      column: 1,
      source: source,
    });
    var frame = diagnostic.message.split('\n').slice(1, 9);
    var bars = frame
      .filter(function (line) {
        return line.includes('|');
      })
      .map(function (line) {
        return line.indexOf('|');
      });
    assert.deepStrictEqual(bars, [6, 6, 6, 6, 6, 6, 6]);
    assert.match(diagnostic.message, /\n     7\| L7\n/);
    assert.match(diagnostic.message, /\n  > 10\| L10\n--------\^\n/);
  });

  test('filename, source, and message controls render as inert visible escapes', function () {
    var rawMessage = 'bad\r\n\u001b]0;title\u0007\u202e';
    var diagnostic = error('CONTROLS', rawMessage, {
      filename: 'evil\u001b[31m.pg',
      line: 1,
      column: 2,
      source: 'a\u0000b\u0085c\u202ed',
    });
    assert.strictEqual(diagnostic.msg, rawMessage);
    assert.match(diagnostic.message, /^evil\\x1B\[31m\.pg:1:2\n/);
    assert.match(diagnostic.message, /> 1\| a\\x00b\\x85c\\u202Ed/);
    assert.match(diagnostic.message, /bad\\r\\n\\x1B\]0;title\\x07\\u202E$/);
    assert.doesNotMatch(
      diagnostic.message,
      /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202e]/,
    );
  });

  test('long lines and far-off columns have a fixed presentation bound', function () {
    var source = 'left-' + 'x'.repeat(1_000_000) + '-right';
    var diagnostics = [
      error('BOUND', 'message', {
        line: 1,
        column: 999_999,
        source: source,
      }),
      error.warning('BOUND', 'message', {
        line: 1,
        column: Number.MAX_SAFE_INTEGER,
        source: source,
      }),
    ];
    for (const diagnostic of diagnostics) {
      assert.ok(diagnostic.message.length < 512, diagnostic.message.length);
      assert.match(diagnostic.message, /…/);
      assert.match(diagnostic.message, /\n-+\^\n/);
    }
  });

  test('filename and display-message amplification is bounded without losing raw msg', function () {
    var raw = 'm'.repeat(100_000);
    var diagnostic = error('BOUND', raw, {
      filename: 'f'.repeat(100_000),
      line: 1,
    });
    assert.strictEqual(diagnostic.msg, raw);
    assert.ok(diagnostic.message.length < 3_000, diagnostic.message.length);
    assert.match(diagnostic.message, /…/);
  });
});

describe('bounded source indexing', function () {
  var src = 'L1\nL2\nL3\nL4\nL5\nL6\nL7\nL8\nL9';

  test('clearSourceCache releases every prepared source index', function () {
    var source = 'clear-1\nclear-2\nclear-3';
    error('CACHE', 'message', {line: 2, source: source});

    error.clearSourceCache();

    var originalCharCodeAt = String.prototype.charCodeAt;
    var scans = 0;
    String.prototype.charCodeAt = function (index) {
      if (String(this) === source) scans++;
      return originalCharCodeAt.call(this, index);
    };
    try {
      error('CACHE', 'message', {line: 2, source: source});
    } finally {
      String.prototype.charCodeAt = originalCharCodeAt;
    }
    assert.ok(scans > 0);
  });

  test('repeated same-source calls produce byte-identical output', function () {
    var expected = error('MY_CODE', 'My message', {
      line: 5,
      column: 2,
      source: src,
    }).message;
    for (var i = 0; i < 50; i++) {
      assert.strictEqual(
        error('MY_CODE', 'My message', {line: 5, column: 2, source: src})
          .message,
        expected,
      );
    }
    // warnings share the same formatter, so the path is identical for them too
    assert.strictEqual(
      error.warning('MY_CODE', 'My message', {line: 5, column: 2, source: src})
        .message,
      expected,
    );
  });

  test('two interleaved sources are prepared once each without a public test hook', function () {
    var a = Array.from({length: 200}, function (_, index) {
      return 'cache-a-' + index;
    }).join('\n');
    var b = Array.from({length: 200}, function (_, index) {
      return 'cache-b-' + index;
    }).join('\n');
    var originalCharCodeAt = String.prototype.charCodeAt;
    var scanned = 0;
    String.prototype.charCodeAt = function (index) {
      var value = String(this);
      if (value === a || value === b) scanned++;
      return originalCharCodeAt.call(value, index);
    };
    try {
      var firstA = error('CACHE', 'message', {line: 100, source: a}).message;
      var firstB = error('CACHE', 'message', {line: 100, source: b}).message;
      var preparedScans = scanned;
      assert.ok(preparedScans > 0);
      for (var i = 0; i < 100; i++) {
        assert.strictEqual(
          error('CACHE', 'message', {line: 100, source: a}).message,
          firstA,
        );
        assert.strictEqual(
          error.warning('CACHE', 'message', {line: 100, source: b}).message,
          firstB,
        );
      }
      assert.strictEqual(scanned, preparedScans);
    } finally {
      String.prototype.charCodeAt = originalCharCodeAt;
    }
    assert.strictEqual(error._splitLinesMemo, undefined);
  });

  test('invalid locations do not inspect even a large source', function () {
    var source = 'never-read\n'.repeat(100_000);
    var originalCharCodeAt = String.prototype.charCodeAt;
    String.prototype.charCodeAt = function () {
      if (String(this) === source) throw new Error('source was inspected');
      return originalCharCodeAt.apply(this, arguments);
    };
    try {
      assert.strictEqual(
        error('CACHE', 'message', {source: source}).message,
        'message',
      );
      assert.strictEqual(
        error.warning('CACHE', 'message', {line: 0, source: source}).message,
        'message',
      );
    } finally {
      String.prototype.charCodeAt = originalCharCodeAt;
    }
  });

  test('an out-of-range source scan is not retained as a cache entry', function () {
    var source = 'out-of-range-one\nout-of-range-two';
    var originalCharCodeAt = String.prototype.charCodeAt;
    var scanned = 0;
    String.prototype.charCodeAt = function (index) {
      var value = String(this);
      if (value === source) scanned++;
      return originalCharCodeAt.call(value, index);
    };
    try {
      assert.strictEqual(
        error('CACHE', 'message', {line: 3, source: source}).message,
        '3\n\nmessage',
      );
      var firstScan = scanned;
      assert.ok(firstScan > 0);
      assert.strictEqual(
        error.warning('CACHE', 'message', {line: 3, source: source}).message,
        '3\n\nmessage',
      );
      assert.ok(scanned > firstScan);
    } finally {
      String.prototype.charCodeAt = originalCharCodeAt;
    }
  });

  test('a line-dense source index over the byte budget is not retained', function () {
    var source = Array.from({length: 70_000}, function (_, index) {
      return index % 2 ? 'b' : 'a';
    }).join('\n');
    var originalCharCodeAt = String.prototype.charCodeAt;
    var scanned = 0;
    String.prototype.charCodeAt = function (index) {
      var value = String(this);
      if (value === source) scanned++;
      return originalCharCodeAt.call(value, index);
    };
    try {
      error('CACHE', 'message', {line: 35_000, source: source});
      var firstScan = scanned;
      assert.ok(firstScan > 0);
      error.warning('CACHE', 'message', {line: 35_000, source: source});
      assert.ok(scanned > firstScan);
    } finally {
      String.prototype.charCodeAt = originalCharCodeAt;
    }
  });

  test('a failed source scan cannot pair a new key with stale context', function () {
    var oldSource = 'atomic-old';
    var newSource = 'atomic-new';
    assert.match(
      error('CACHE', 'message', {line: 1, source: oldSource}).message,
      /atomic-old/,
    );

    var originalCharCodeAt = String.prototype.charCodeAt;
    var failed = false;
    String.prototype.charCodeAt = function (index) {
      var value = String(this);
      if (!failed && value === newSource) {
        failed = true;
        throw new Error('injected scan failure');
      }
      return originalCharCodeAt.call(value, index);
    };
    try {
      assert.throws(function () {
        error('CACHE', 'message', {line: 1, source: newSource});
      }, /injected scan failure/);
    } finally {
      String.prototype.charCodeAt = originalCharCodeAt;
    }

    var retry = error('CACHE', 'message', {
      line: 1,
      source: newSource,
    }).message;
    assert.match(retry, /atomic-new/);
    assert.doesNotMatch(retry, /atomic-old/);
  });
});
