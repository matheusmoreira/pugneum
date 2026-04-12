var path = require('path');
var fs = require('fs');
var {test} = require('node:test');

var lex = require('pugneum-lexer');
var parse = require('pugneum-parser');
var filter = require('pugneum-filterer');

var prism = require('../');
var customFilters = {highlight: prism};

var casesDirectory = path.join(__dirname, 'cases');
var cases = fs.readdirSync(casesDirectory);

function readCase(name) {
  return fs.readFileSync(path.join(casesDirectory, name), 'utf8');
}

cases.forEach((filename) => {
  test(filename, (t) => {
    var options = {filename};
    var source = readCase(filename);
    var tokens = lex(source, options);
    var ast = parse(tokens, options);
    var filtered = filter(ast, customFilters);

    t.assert.snapshot(filtered);
  });
});
