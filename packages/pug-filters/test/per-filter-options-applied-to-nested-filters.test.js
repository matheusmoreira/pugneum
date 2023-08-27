const lex = require('pugneum-lexer');
const parse = require('pugneum-parser');
const handleFilters = require('../').handleFilters;

const customFilters = {};
const filename = require('path').basename(__filename);

test('per filter options are applied, even to nested filters', () => {
  const source = `
script
  :cdata:uglify-js
    function myFunc(foo) {
      return foo;
    }
  `;

  const ast = parse(lex(source, {filename}), {
    filename,
    src: source,
  });

  const options = {
    'uglify-js': {output: {beautify: true}},
  };

  const output = handleFilters(ast, customFilters, options);
  expect(output).toMatchSnapshot();

  // TODO: render with `options.filterOptions['uglify-js']`
});
