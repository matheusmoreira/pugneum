const path = require('path');
const fs = require('fs');

const lex = require('pugneum-lexer');
const parse = require('pugneum-parser');
const filter = require('pugneum-filterer');

const prism = require('../');
const customFilters = { 'highlight': prism };

const casesDirectory = path.join(__dirname, 'cases');
const cases = fs.readdirSync(casesDirectory);

function readCase(name) {
  return fs.readFileSync(path.join(casesDirectory, name), 'utf8');
}

cases.forEach((filename) => {
  test(filename, () => {
    const options = { filename };
    const source = readCase(filename);
    const tokens = lex(source, options);
    const ast = parse(tokens, options);
    const filtered = filter(ast, customFilters);

    expect(filtered).toMatchSnapshot();
  });
});
