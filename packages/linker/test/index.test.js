var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');
var {describe, test} = require('node:test');
var lex = require('pugneum-lexer');
var parse = require('pugneum-parser');
var load = require('pugneum-loader');
var link = require('../');

var basedir = __dirname + '/cases';

function linkFile(filename) {
  let source = fs.readFileSync(filename, 'utf8');
  let options = {filename, source, lex, parse, basedir};
  let tokens = lex(source, options);
  let ast = parse(tokens, options);
  let loaded = load(ast, options);
  let linked = link(loaded);
  return JSON.parse(
    JSON.stringify(linked, function (key, value) {
      if (
        (key === 'filename' || key === 'fullPath') &&
        typeof value === 'string'
      ) {
        return path.basename(value);
      }
      return value;
    }),
  );
}

function testDir(dir) {
  fs.readdirSync(dir).forEach(function (name) {
    if (!/\.pg$/.test(name)) return;
    test(name, function (t) {
      t.assert.snapshot(linkFile(dir + '/' + name));
    });
  });
}

describe('cases from pugneum sources', function () {
  testDir(__dirname + '/cases');
});

describe('duplicate reference definitions', () => {
  test('throws DUPLICATE_REFERENCE error', (t) => {
    var source = [
      'references',
      '  ex https://first.com',
      '  ex https://second.com',
      '',
      'p @[ex]',
    ].join('\n');
    var options = {filename: 'test.pg', source, lex, parse, basedir};
    var tokens = lex(source, options);
    var ast = parse(tokens, options);
    var loaded = load(ast, options);

    assert.throws(
      () => link(loaded),
      (err) => {
        assert.strictEqual(err.code, 'PUGNEUM:DUPLICATE_REFERENCE');
        assert.match(err.message, /Duplicate reference 'ex'/);
        return true;
      },
    );
  });
});

describe('error handling', () => {
  test('top level must be a Block', () => {
    assert.throws(() => link({type: 'Tag', name: 'div'}), /top level.*block/i);
  });

  test('UNDEFINED_REFERENCE for unknown @[ref]', () => {
    var filename = basedir + '/auxiliary/layout-append.pg';
    // Build a minimal AST with an undefined reference
    var source = 'p @[missing]';
    var options = {filename: 'test.pg', source, lex, parse, basedir};
    var tokens = lex(source, options);
    var ast = parse(tokens, options);
    var loaded = load(ast, options);
    assert.throws(
      () => link(loaded),
      (err) => err.code === 'PUGNEUM:UNDEFINED_REFERENCE',
    );
  });

  test('MISSING_YIELD when include passes block but template has no yield', () => {
    var dir = __dirname + '/cases';
    var includer = 'include auxiliary/pet.pg\n  p Extra content';
    var options = {
      filename: dir + '/test.pg',
      source: includer,
      lex,
      parse,
      basedir: dir,
    };
    var tokens = lex(includer, options);
    var ast = parse(tokens, options);
    var loaded = load(ast, options);
    assert.throws(
      () => link(loaded),
      (err) => err.code === 'PUGNEUM:MISSING_YIELD',
    );
  });
});
