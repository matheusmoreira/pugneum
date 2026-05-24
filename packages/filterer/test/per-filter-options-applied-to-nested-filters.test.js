var {test} = require('node:test');
var lex = require('pugneum-lexer');
var parse = require('pugneum-parser');
var filter = require('../');

var filename = require('path').basename(__filename);

var customFilters = {
  first: {
    type: 'html',
    filter: function (str, options) {
      return options.wrap ? 'FIRST\n' + str + '\nEND FIRST' : str;
    },
  },
  second: {
    type: 'html',
    filter: function (str, options) {
      return options.wrap ? 'SECOND\n' + str + '\nEND SECOND' : str;
    },
  },
};

test('per filter options are applied, even to nested filters', (t) => {
  const source = `
p
  :first:second
    Will be wrapped in second.
`;

  const ast = parse(lex(source, {filename}), {filename, source});

  const options = {
    filterOptions: {second: {wrap: true}},
  };

  const output = filter(ast, customFilters, options);
  t.assert.snapshot(output);
});

test('pipeline options do not leak into filter attributes', (t) => {
  const applyFilters = require('../');
  const receivedAttrs = {};
  const filters = {
    testfilter: {
      type: 'text',
      filter: (text, attrs) => {
        Object.assign(receivedAttrs, attrs);
        return text;
      },
    },
  };
  const ast = {
    type: 'Block',
    nodes: [
      {
        type: 'Filter',
        name: 'testfilter',
        block: {type: 'Block', nodes: [{type: 'Text', val: 'hello'}]},
        attrs: [],
        line: 1,
        column: 1,
        filename: 'test.pg',
      },
    ],
    line: 1,
    column: 1,
    filename: 'test.pg',
  };
  applyFilters(ast, filters, {
    filename: 'should-not-leak.pg',
    source: 'should not leak',
    testfilter: {customOpt: 'old-style'},
  });
  t.assert.strictEqual(receivedAttrs.source, undefined);
  t.assert.strictEqual(receivedAttrs.customOpt, undefined);
});
