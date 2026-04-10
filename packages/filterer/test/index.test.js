'use strict';

var fs = require('fs');
var path = require('path');
var assert = require('node:assert/strict');
var {test} = require('node:test');

var lex = require('pugneum-lexer');
var parse = require('pugneum-parser');
var filter = require('../');

var filename = path.basename(__filename);

var customFilters = {
  custom: {
    filter: function(str, options) {
      return 'BEGIN' + str + 'END';
    }
  },
  'custom-with-options': {
    filter: function(str, options) {
      assert.strictEqual(options.option, 'value');
      assert.strictEqual(options.number, '2'); // no automatic parsing of option values
      return 'BEGIN OPTIONS' + str + 'END OPTIONS';
    }
  }
};

test('filters can be used', (t) => {
  const source = `
p
  :custom
    Filters can be used.
`;

  const ast = parse(lex(source, {filename}), {filename, source});

  const output = filter(ast, customFilters);
  t.assert.snapshot(output);
});

test('filters can be used with options', (t) => {
  const source = `
p
  :custom-with-options(option=value number=2)
    Filters can be used with options.
    The values aren't parsed though.
    They're just strings.
`;

  const ast = parse(lex(source, {filename}), {filename, source});

  const output = filter(ast, customFilters);
  t.assert.snapshot(output);
});
process.chdir(__dirname + '/../');

var testCases;

testCases = fs.readdirSync(__dirname + '/cases').filter(function(name) {
  return /\.input\.json$/.test(name);
});

testCases.forEach(function(filename) {
  function read(path) {
    return fs.readFileSync(__dirname + '/cases/' + path, 'utf8');
  }

  test('cases/' + filename, function(t) {
    var actualAst = JSON.stringify(
      filter(JSON.parse(read(filename)), customFilters),
      null,
      '  '
    );
    t.assert.snapshot(actualAst);
  });
});

testCases.forEach(function(filename) {
  function read(path) {
    return fs.readFileSync(__dirname + '/errors/' + path, 'utf8');
  }

  test('errors/' + filename, function(t) {
    var actual;
    try {
      filter(JSON.parse(read(filename)), customFilters);
      throw new Error('Expected ' + filename + ' to throw an exception.');
    } catch (ex) {
      if (!ex || !ex.code || ex.code.indexOf('PUGNEUM:') !== 0) throw ex;
      actual = {
        msg: ex.msg,
        code: ex.code,
        line: ex.line,
      };
    }
    t.assert.snapshot(actual);
  });
});
