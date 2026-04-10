var assert = require('node:assert/strict');
var fs = require('fs');
var {describe, test} = require('node:test');
var lex = require('pugneum-lexer');
var parse = require('pugneum-parser');
var load = require('pugneum-loader');
var link = require('../');

var basedir = __dirname + '/cases';

function testDir(dir) {
  fs.readdirSync(dir).forEach(function(name) {
    if (!/\.pg$/.test(name)) return;
    test(name, function(t) {
      let filename = dir + '/' + name;
      let source = fs.readFileSync(filename, 'utf8');
      let options = {filename, source, lex, parse, basedir};
      let tokens = lex(source, options);
      let ast = parse(tokens, options);
      let loaded = load(ast, options);
      var actual = link(loaded);

      t.assert.snapshot(actual);
    });
  });
}

function testDirError(dir) {
  fs.readdirSync(dir).forEach(function(name) {
    if (!/\.input\.json$/.test(name)) return;
    test(name, function(t) {
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
      t.assert.snapshot(err);
    });
  });
}

describe('cases from pugneum sources', function() {
  testDir(__dirname + '/cases');
});
