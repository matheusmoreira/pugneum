var assert = require('node:assert/strict');
var {describe, test} = require('node:test');
var error = require('../');

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
    assert.strictEqual(err.code, 'PUGNEUM:MY_CODE');
    assert.strictEqual(err.msg, 'My message');
    assert.strictEqual(err.line, 3);
    assert.strictEqual(err.filename, 'myfile');
    assert.strictEqual(err.source, 'foo\nbar\nbaz\nbash\nbing');
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
    assert.strictEqual(err.code, 'PUGNEUM:MY_CODE');
    assert.strictEqual(err.msg, 'My message');
    assert.strictEqual(err.line, 3);
    assert.strictEqual(err.filename, undefined);
    assert.strictEqual(err.source, 'foo\nbar\nbaz\nbash\nbing');
  });
});

describe('without source', function () {
  test('and with a filename', function () {
    var err = error('MY_CODE', 'My message', {line: 3, filename: 'myfile'});
    assert.strictEqual(err.message, 'myfile:3\n\nMy message');
    assert.strictEqual(err.code, 'PUGNEUM:MY_CODE');
    assert.strictEqual(err.msg, 'My message');
    assert.strictEqual(err.line, 3);
    assert.strictEqual(err.filename, 'myfile');
    assert.strictEqual(err.source, undefined);
  });
  test('and with no filename', function () {
    var err = error('MY_CODE', 'My message', {line: 3});
    assert.strictEqual(err.message, '3\n\nMy message');
    assert.strictEqual(err.code, 'PUGNEUM:MY_CODE');
    assert.strictEqual(err.msg, 'My message');
    assert.strictEqual(err.line, 3);
    assert.strictEqual(err.filename, undefined);
    assert.strictEqual(err.source, undefined);
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
    assert.strictEqual(err.code, 'PUGNEUM:MY_CODE');
    assert.strictEqual(err.msg, 'My message');
    assert.strictEqual(err.line, 3);
    assert.strictEqual(err.filename, 'myfile');
    assert.strictEqual(err.source, 'foo\nbar\nbaz\nbash\nbing');
  });
  test('and with no filename', function () {
    var err = error('MY_CODE', 'My message', {line: 3, column: 1});
    assert.strictEqual(err.message, '3:1\n\nMy message');
    assert.strictEqual(err.code, 'PUGNEUM:MY_CODE');
    assert.strictEqual(err.msg, 'My message');
    assert.strictEqual(err.line, 3);
    assert.strictEqual(err.filename, undefined);
    assert.strictEqual(err.source, undefined);
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
    assert.strictEqual(err.code, 'PUGNEUM:MY_CODE');
    assert.strictEqual(err.msg, 'My message');
    assert.strictEqual(err.line, 3);
    assert.strictEqual(err.filename, undefined);
    assert.strictEqual(err.source, 'foo\nbar\nbaz\nbash\nbing');
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
      assert.strictEqual(err.code, 'PUGNEUM:MY_CODE');
      assert.strictEqual(err.msg, 'My message');
      assert.strictEqual(err.line, line);
      assert.strictEqual(err.filename, undefined);
      assert.strictEqual(err.source, 'foo\nbar\nbaz\nbash\nbing');
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
    assert.strictEqual(warn.code, 'PUGNEUM:TYPOGRAPHIC_QUOTE_DELIMITER');
    assert.strictEqual(warn.msg, 'My message');
    assert.strictEqual(warn.line, 3);
    assert.strictEqual(warn.column, 2);
    assert.strictEqual(warn.filename, 'myfile');
    assert.ok(
      !(warn instanceof Error),
      'warning must not be an Error instance',
    );
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
