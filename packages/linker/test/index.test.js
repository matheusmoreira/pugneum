const assert = require('assert');
const fs = require('fs');
const lex = require('pugneum-lexer');
const parse = require('pugneum-parser');
const load = require('pugneum-loader');
const link = require('../');

const basedir = __dirname + '/cases';

function testDir(dir) {
  fs.readdirSync(dir).forEach(function(name) {
    if (!/\.pg$/.test(name)) return;
    test(name, function() {
      let filename = dir + '/' + name;
      let source = fs.readFileSync(filename, 'utf8');
      let options = {filename, source, lex, parse, basedir};
      let tokens = lex(source, options);
      let ast = parse(tokens, options);
      let loaded = load(ast, options);
      var actual = link(loaded);

      expect(actual).toMatchSnapshot();
    });
  });
}

function testDirError(dir) {
  fs.readdirSync(dir).forEach(function(name) {
    if (!/\.input\.json$/.test(name)) return;
    test(name, function() {
      var input = JSON.parse(fs.readFileSync(dir + '/' + name, 'utf8'));
      var err;
      try {
        link(input);
      } catch (ex) {
        err = {
          msg: ex.msg,
          code: ex.code,
          line: ex.line,
        };
      }
      if (!err) throw new Error('Expected error');
      expect(err).toMatchSnapshot();
    });
  });
}

describe('cases from pugneum sources', function() {
  testDir(__dirname + '/cases');
});
