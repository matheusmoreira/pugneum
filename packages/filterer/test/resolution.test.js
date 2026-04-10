var path = require('path');
var {test} = require('node:test');
var filename = path.basename(__filename);

var lex = require('pugneum-lexer');
var parse = require('pugneum-parser');
var filter = require('../');

test('installed filter packages can be used implicitly', (t) => {

  const source = `
pre
  code
    :'highlight.js'(language=ruby)
      puts 'This should be', :syntax_highlighted
`;

  const tokens = lex(source, {filename});
  const ast = parse(tokens, {filename, source});
  const filtered = filter(ast);

  t.assert.snapshot(filtered);
});
