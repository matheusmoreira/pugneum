var {test} = require('node:test');
var lex = require('pugneum-lexer');
var parse = require('pugneum-parser');
var filter = require('../');

var filename = require('path').basename(__filename);

var customFilters = {
  first: {
    filter: function (str, options) {
      return options.wrap ? 'FIRST\n' + str + '\nEND FIRST' : str;
    },
  },
  second: {
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
    second: {wrap: true},
  };

  const output = filter(ast, customFilters, options);
  t.assert.snapshot(output);
});
