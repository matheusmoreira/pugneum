'use strict';

var path = require('path');
var assert = require('node:assert/strict');
var {test} = require('node:test');

var lex = require('pugneum-lexer');
var parse = require('pugneum-parser');
var filter = require('../');

var filename = path.basename(__filename);

var customFilters = {
  custom: {
    filter: function (str, options) {
      return 'BEGIN' + str + 'END';
    },
  },
  'custom-with-options': {
    filter: function (str, options) {
      return (
        'option=' + options.option + ' number=' + options.number + ' ' + str
      );
    },
  },
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

test('__proto__ attribute does not pollute Object.prototype', () => {
  const inspecting = {
    filter: function (str, options) {
      // The __proto__ attr should be a regular property on the null-prototype
      // attrs object, not trigger prototype pollution
      assert.strictEqual(options.__proto__, 'malicious');
      // Object.prototype must remain unpolluted
      assert.strictEqual({}.malicious, undefined);
      return str;
    },
  };

  const source = `
p
  :inspecting(__proto__=malicious)
    test
`;

  const ast = parse(lex(source, {filename}), {filename, source});
  filter(ast, {inspecting});
});

test('invalid filter name throws INVALID_FILTER_NAME', () => {
  const source = `
p
  :'../../../etc/malicious'
    test
`;

  const ast = parse(lex(source, {filename}), {filename, source});
  assert.throws(
    () => filter(ast),
    (err) =>
      err.code === 'PUGNEUM:INVALID_FILTER_NAME' &&
      /Invalid filter name/.test(err.message),
  );
});

test('filters can be used with options', () => {
  const source = `
p
  :custom-with-options(option=value number=2)
    Filters can be used with options.
    The values aren't parsed though.
    They're just strings.
`;

  const ast = parse(lex(source, {filename}), {filename, source});

  const output = filter(ast, customFilters);

  // find the filtered text node
  const textNode = output.nodes[0].block.nodes[0];
  assert.strictEqual(
    textNode.val,
    "option=value number=2 Filters can be used with options.\nThe values aren't parsed though.\nThey're just strings.",
  );
});
