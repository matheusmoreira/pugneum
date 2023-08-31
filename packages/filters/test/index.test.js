'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const lex = require('pugneum-lexer');
const parse = require('pugneum-parser');
const filter = require('../');

const filename = path.basename(__filename);

var customFilters = {
  custom: function(str, options) {
    return 'BEGIN' + str + 'END';
  },
  'custom-with-options': function(str, options) {
    expect(options.option).toBe('value');
    expect(options.number).toBe('2'); // no automatic parsing of option values
    return 'BEGIN OPTIONS' + str + 'END OPTIONS';
  }
};

test('filters can be used', () => {
  const source = `
p
  :custom
    Filters can be used.
`;

  const ast = parse(lex(source, {filename}), {
    filename,
    src: source,
  });

  const output = filter(ast, customFilters);
  expect(output).toMatchSnapshot();
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

  test('cases/' + filename, function() {
    var actualAst = JSON.stringify(
      filter(JSON.parse(read(filename)), customFilters),
      null,
      '  '
    );
    expect(actualAst).toMatchSnapshot();
  });
});

testCases.forEach(function(filename) {
  function read(path) {
    return fs.readFileSync(__dirname + '/errors/' + path, 'utf8');
  }

  test('errors/' + filename, function() {
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
    expect(actual).toMatchSnapshot();
  });
});
