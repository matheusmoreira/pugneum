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
