var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
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

  test('documents the exact lossy JSON boundary', function () {
    for (const key of ['code', 'msg', 'line', 'column', 'filename']) {
      assert.match(readme, new RegExp('  ' + key + ': diagnostic\\.' + key));
    }
    for (const omission of [
      '`source`',
      'formatted `message`',
      'error `stack`',
      'error-versus-warning',
    ]) {
      assert.match(readme, new RegExp(omission));
    }
    assert.match(readme, /cannot reproduce the display message byte for byte/);
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
  test('negative column', function () {
    var err = error('MY_CODE', 'My message', {
      line: 3,
      column: -1,
      source: 'foo\nbar\nbaz\nbash\nbing',
    });
    assert.strictEqual(
      err.message,
      '3:-1\n    1| foo\n    2| bar\n  > 3| baz\n    4| bash\n    5| bing\n\nMy message',
    );
    assertDiagnosticFields(err, {
      code: 'PUGNEUM:MY_CODE',
      msg: 'My message',
      line: 3,
      column: -1,
      filename: undefined,
      source: 'foo\nbar\nbaz\nbash\nbing',
    });
  });
  test('out of range line', function () {
    check(0);
    check(6);

    function check(line) {
      var err = error('MY_CODE', 'My message', {
        line: line,
        source: 'foo\nbar\nbaz\nbash\nbing',
      });
      assert.strictEqual(err.message, line + '\n\nMy message');
      assertDiagnosticFields(err, {
        code: 'PUGNEUM:MY_CODE',
        msg: 'My message',
        line: line,
        column: undefined,
        filename: undefined,
        source: 'foo\nbar\nbaz\nbash\nbing',
      });
    }
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

  test('toJSON omits source like error()', function () {
    var warn = error.warning('CODE', 'msg', {
      line: 1,
      column: 4,
      filename: 'f',
      source: 'x',
    });
    assert.deepStrictEqual(warn.toJSON(), {
      code: 'PUGNEUM:CODE',
      msg: 'msg',
      line: 1,
      column: 4,
      filename: 'f',
    });
  });
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

  test('a fractional column does not throw from the builder', function () {
    var err = error('MY_CODE', 'My message', {
      line: 3,
      column: 0.5,
      source: src,
    });
    // floor(preamble.length + 0.5) - 1 = floor(7.5) - 1 = 6 dashes
    assert.strictEqual(
      err.message,
      '3:0.5\n    1| foo\n    2| bar\n  > 3| baz\n------^\n    4| bash\n    5| bing\n\nMy message',
    );
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
    assert.strictEqual(
      error('MY_CODE', 'My message', {line: 1, column: 1, source: 12345})
        .message,
      '1:1\n\nMy message',
    );
    assert.strictEqual(
      error('MY_CODE', 'My message', {
        line: 1,
        source: Buffer.from('a\nb\nc'),
      }).message,
      '1\n\nMy message',
    );
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
});

describe('source line-split memoization', function () {
  // A document that emits many located diagnostics on the same source (e.g. N
  // DUPLICATE_ID warnings from the linker) must not re-split the whole source
  // once per diagnostic — that is O(N * lines). formatMessage memoizes the split
  // for the most-recent source string, so N same-source calls split exactly once.
  var src = 'L1\nL2\nL3\nL4\nL5\nL6\nL7\nL8\nL9';

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

  test('the source is split only once across many same-source diagnostics', function () {
    error._splitLinesMemo.reset();
    var N = 200;
    for (var i = 0; i < N; i++) {
      // vary line/column so each diagnostic is distinct but the source is shared
      error('DUPLICATE_ID', 'dup #' + i, {
        line: (i % 9) + 1,
        column: 1,
        source: src,
      });
    }
    // Without the memo this would be N splits; with it, exactly one.
    assert.strictEqual(error._splitLinesMemo.misses, 1);
  });

  test('a changed source re-splits, and switching back re-splits again', function () {
    error._splitLinesMemo.reset();
    var a = 'a1\na2\na3';
    var b = 'b1\nb2\nb3';
    error('C', 'm', {line: 1, source: a}); // miss 1 (a)
    error('C', 'm', {line: 1, source: a}); // hit
    error('C', 'm', {line: 1, source: b}); // miss 2 (b evicts a)
    error('C', 'm', {line: 1, source: b}); // hit
    error('C', 'm', {line: 1, source: a}); // miss 3 (a again, was evicted)
    assert.strictEqual(error._splitLinesMemo.misses, 3);
    // output for the re-split source is still correct
    assert.strictEqual(
      error('C', 'My message', {line: 2, source: a}).message,
      '2\n    1| a1\n  > 2| a2\n    3| a3\n\nMy message',
    );
  });

  test('a non-string source never populates the memo (no false cache hit)', function () {
    error._splitLinesMemo.reset();
    // non-string sources take the no-context branch and must not be split/cached
    error('C', 'm', {line: 1, source: 12345});
    error('C', 'm', {line: 1, source: Buffer.from('x\ny')});
    assert.strictEqual(error._splitLinesMemo.misses, 0);
    // a following string source still works and is the first real split
    assert.strictEqual(
      error('C', 'My message', {line: 1, source: 'only'}).message,
      '1\n  > 1| only\n\nMy message',
    );
    assert.strictEqual(error._splitLinesMemo.misses, 1);
  });
});
