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
