const path = require('path');
const filename = path.basename(__filename);

const lex = require('pugneum-lexer');
const parse = require('pugneum-parser');
const filter = require('../');

test('installed filter packages can be used implicitly', () => {

  const source = `
pre
  code
    :'highlight.js'(language=ruby)
      puts 'This should be', :syntax_highlighted
`;

  const tokens = lex(source, {filename});
  const ast = parse(tokens, {filename, source});
  const filtered = filter(ast);

  expect(filtered).toMatchSnapshot();
});
