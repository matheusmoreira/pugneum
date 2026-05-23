'use strict';

var assert = require('node:assert/strict');
var {test, describe} = require('node:test');

var tableFilter = require('../');

describe('table filter', () => {
  test('exports type pugneum', () => {
    assert.strictEqual(tableFilter.type, 'pugneum');
  });

  test('bare rows without separator produce tbody only', () => {
    var input = '| Name | Count |\n| Alice | 42 |';
    var result = tableFilter.filter(input, {});
    assert.strictEqual(
      result,
      'table\n  tbody\n    tr\n      td Name\n      td Count\n    tr\n      td Alice\n      td 42',
    );
  });

  test('basic header-separator-body table', () => {
    var input = '| Name | Count |\n| --- | --- |\n| Alice | 42 |';
    var result = tableFilter.filter(input, {});
    assert.strictEqual(
      result,
      'table\n' +
        '  colgroup\n    col\n    col\n' +
        '  thead\n    tr\n      th Name\n      th Count\n' +
        '  tbody\n    tr\n      td Alice\n      td 42',
    );
  });

  test('filter attrs become table attrs', () => {
    var input = '| a |\n| --- |\n| b |';
    var result = tableFilter.filter(input, {class: 'data'});
    assert.match(result, /^table\(class="data"\)/);
  });
});

describe('tagged cells', () => {
  test('th with attrs', () => {
    var input = '| th(scope="col") Name | th Count |\n| --- | --- |\n| a | 1 |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /th\(scope="col"\) Name/);
  });

  test('td with attrs', () => {
    var input = '| a |\n| --- |\n| td(class="mono") value |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /td\(class="mono"\) value/);
  });

  test('td with colspan', () => {
    var input = '| a | b |\n| --- | --- |\n| td(colspan="2") merged |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /td\(colspan="2"\) merged/);
  });

  test('escaped \\th produces literal text', () => {
    var input = '| --- |\n| \\th is not a tag |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /td th is not a tag/);
  });

  test('escaped \\td produces literal text', () => {
    var input = '| --- |\n| \\td also literal |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /td td also literal/);
  });
});

describe('row attrs', () => {
  test('tr(attrs) before first pipe', () => {
    var input = '| a |\n| --- |\ntr(class="highlight") | value |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /tr\(class="highlight"\)/);
  });
});

describe('caption', () => {
  test('plain caption', () => {
    var input = 'caption System calls\n| Name |\n| --- |\n| read |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /caption System calls/);
  });

  test('caption with attrs', () => {
    var input =
      'caption(class="sr-only") System call reference\n| Name |\n| --- |\n| read |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /caption\(class="sr-only"\) System call reference/);
  });
});
