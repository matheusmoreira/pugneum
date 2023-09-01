const lex = require('pugneum-lexer');
const parse = require('pugneum-parser');
const filter = require('../');

const filename = require('path').basename(__filename);

const customFilters = {
  first: {
    filter: function(str, options) {
      return options.wrap? 'FIRST\n' + str + '\nEND FIRST' : str;
    }
  },
  second: {
    filter: function(str, options) {
      return options.wrap? 'SECOND\n' + str + '\nEND SECOND' : str;
    }
  }
};

test('per filter options are applied, even to nested filters', () => {
  const source = `
p
  :first:second
    Will be wrapped in second.
`;

  const ast = parse(lex(source, {filename}), {
    filename,
    src: source,
  });

  const options = {
      second: {wrap: true},
  };

  const output = filter(ast, customFilters, options);
  expect(output).toMatchSnapshot();
});
