var {test} = require('node:test');
var lex = require('pugneum-lexer');
var parse = require('pugneum-parser');
var filter = require('../');

var filename = require('path').basename(__filename);

test('per filter options are applied, even to nested filters', (t) => {
  const received = {first: [], second: []};
  const customFilters = {
    first: {
      type: 'html',
      filter: function (str, options) {
        received.first.push({str, options});
        return options.wrap ? 'FIRST\n' + str + '\nEND FIRST' : str;
      },
    },
    second: {
      type: 'html',
      filter: function (str, options) {
        received.second.push({str, options});
        return options.wrap ? 'SECOND\n' + str + '\nEND SECOND' : str;
      },
    },
  };
  const source = `
p
  :first:second
    Will be wrapped in second.
  :first
    Neighbor stays unwrapped.
`;

  const ast = parse(lex(source, {filename}), {filename, source});

  const options = {
    filterOptions: {
      first: {firstOnly: 'first'},
      second: {wrap: true, secondOnly: 'second'},
    },
  };

  const output = filter(ast, customFilters, options);
  t.assert.strictEqual(received.first.length, 2);
  t.assert.strictEqual(received.second.length, 1);
  t.assert.deepStrictEqual(
    received.first.map((entry) => entry.str),
    [
      'SECOND\nWill be wrapped in second.\nEND SECOND',
      'Neighbor stays unwrapped.',
    ],
  );
  t.assert.strictEqual(received.second[0].str, 'Will be wrapped in second.');

  received.first.forEach(({options: attrs}) => {
    t.assert.strictEqual(Object.getPrototypeOf(attrs), null);
    t.assert.deepStrictEqual(Object.keys(attrs), ['firstOnly', 'filename']);
    t.assert.strictEqual(attrs.firstOnly, 'first');
    t.assert.strictEqual(attrs.secondOnly, undefined);
    t.assert.strictEqual(attrs.wrap, undefined);
    t.assert.strictEqual(attrs.filename, filename);
  });
  const secondAttrs = received.second[0].options;
  t.assert.strictEqual(Object.getPrototypeOf(secondAttrs), null);
  t.assert.deepStrictEqual(Object.keys(secondAttrs), [
    'wrap',
    'secondOnly',
    'filename',
  ]);
  t.assert.strictEqual(secondAttrs.firstOnly, undefined);
  t.assert.strictEqual(secondAttrs.wrap, true);
  t.assert.strictEqual(secondAttrs.secondOnly, 'second');
  t.assert.strictEqual(secondAttrs.filename, filename);
  t.assert.notStrictEqual(received.first[0].options, received.first[1].options);
  t.assert.notStrictEqual(received.first[0].options, secondAttrs);
  t.assert.snapshot(output);
});

test('pipeline options do not leak into filter attributes', (t) => {
  const applyFilters = require('../');
  let calls = 0;
  let receivedAttrs;
  const filters = {
    testfilter: {
      type: 'text',
      filter: (text, attrs) => {
        calls += 1;
        receivedAttrs = attrs;
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
  t.assert.strictEqual(calls, 1);
  t.assert.strictEqual(Object.getPrototypeOf(receivedAttrs), null);
  t.assert.deepStrictEqual(Object.keys(receivedAttrs), ['filename']);
  t.assert.strictEqual(receivedAttrs.filename, 'test.pg');
  t.assert.strictEqual(receivedAttrs.source, undefined);
  t.assert.strictEqual(receivedAttrs.customOpt, undefined);
});
