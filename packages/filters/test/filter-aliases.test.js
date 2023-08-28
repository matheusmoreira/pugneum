const lex = require('pugneum-lexer');
const parse = require('pugneum-parser');
const apply = require('../').apply;

const filename = require('path').basename(__filename);

const customFilters = {
  alias: function(str, options) {
    return 'BEGIN ALIASED\n' + str + '\nEND ALIASED';
  },
  'check-options': function(str, options) {
    return options.wrap? 'CHECKED\n' + str + '\nEND CHECKED' : str;
  }
};

test('filters can be aliased', () => {
  const source = `
p
  :aliased
    Filters can be aliased.
`;

  const ast = parse(lex(source, {filename}), {
    filename,
    src: source,
  });

  const options = {};
  const aliases = {
    aliased: 'alias',
  };

  const output = apply(ast, customFilters, options, aliases);
  expect(output).toMatchSnapshot();
});

test('we do not support chains of aliases', () => {
  const source = `
p
  :aliased-again
    Alias chains are not supported.
  `;

  const ast = parse(lex(source, {filename}), {
    filename,
    src: source,
  });

  const options = {};
  const aliases = {
    aliased: 'alias',
    'aliased-again': 'aliased',
  };

  try {
    const output = apply(ast, customFilters, options, aliases);
  } catch (ex) {
    expect({
      code: ex.code,
      message: ex.message,
    }).toMatchSnapshot();
    return;
  }
  throw new Error('Expected an exception');
});

test('options are applied before aliases', () => {
  const source = `
script
  :check-options
    Will be wrapped.
  :aliased
    Will not be wrapped.
`;

  const ast = parse(lex(source, {filename}), {
    filename,
    src: source,
  });

  const options = {
    'check-options': {wrap: true}
  };
  const aliases = {
    aliased: 'check-options',
  };

  const output = apply(ast, customFilters, options, aliases);
  expect(output).toMatchSnapshot();
});
