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

describe('RawInclude with filters', () => {
  test('RawInclude with filters is preserved for the filterer', () => {
    var dir = __dirname + '/cases';
    var source = 'include:markdown-it some.md';
    var options = {
      filename: dir + '/test.pg',
      source,
      lex,
      parse,
      basedir: dir,
    };
    var tokens = lex(source, options);
    var ast = parse(tokens, options);
    var loaded = load(ast, options);
    var linked = link(loaded);

    // The linker must NOT replace RawInclude nodes that have filters.
    // Those are left for the filterer to process.
    var rawInclude = linked.nodes[0];
    assert.strictEqual(rawInclude.type, 'RawInclude');
    assert.ok(rawInclude.filters.length > 0);
    assert.strictEqual(rawInclude.filters[0].name, 'markdown-it');
  });

  test('RawInclude without filters is replaced with Text', () => {
    var dir = __dirname + '/cases';
    var source = 'include some.md';
    var options = {
      filename: dir + '/test.pg',
      source,
      lex,
      parse,
      basedir: dir,
    };
    var tokens = lex(source, options);
    var ast = parse(tokens, options);
    var loaded = load(ast, options);
    var linked = link(loaded);

    // Without filters, the linker replaces RawInclude with a Text node
    var textNode = linked.nodes[0];
    assert.strictEqual(textNode.type, 'Text');
  });
});

describe('error handling', () => {
  test('top level must be a Block', () => {
    assert.throws(() => link({type: 'Tag', name: 'div'}), /top level.*block/i);
  });

  test('UNDEFINED_REFERENCE for unknown @[ref]', () => {
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

  test('EXTENDS_NOT_FIRST when extends is not the first statement', () => {
    var dir = __dirname + '/cases';
    var source = 'p hello\nextends auxiliary/layout.pg';
    var options = {
      filename: dir + '/test.pg',
      source,
      lex,
      parse,
      basedir: dir,
    };
    var tokens = lex(source, options);
    var ast = parse(tokens, options);
    var loaded = load(ast, options);
    assert.throws(
      () => link(loaded),
      (err) => err.code === 'PUGNEUM:EXTENDS_NOT_FIRST',
    );
  });

  test('UNEXPECTED_BLOCK for block not defined in parent', () => {
    var dir = __dirname + '/cases';
    var source = 'extends auxiliary/layout.pg\nblock nonexistent\n  p hello';
    var options = {
      filename: dir + '/test.pg',
      source,
      lex,
      parse,
      basedir: dir,
    };
    var tokens = lex(source, options);
    var ast = parse(tokens, options);
    var loaded = load(ast, options);
    assert.throws(
      () => link(loaded),
      (err) => err.code === 'PUGNEUM:UNEXPECTED_BLOCK',
    );
  });

  test('LINK_DEPTH_EXCEEDED when inheritance chain exceeds limit', () => {
    var dir = __dirname + '/cases';
    var source = 'extends auxiliary/layout.pg\nblock content\n  p hello';
    var options = {
      filename: dir + '/test.pg',
      source,
      lex,
      parse,
      basedir: dir,
      maxLinkDepth: 1,
    };
    var tokens = lex(source, options);
    var ast = parse(tokens, options);
    var loaded = load(ast, options);
    assert.throws(
      () => link(loaded, options),
      (err) => err.code === 'PUGNEUM:LINK_DEPTH_EXCEEDED',
    );
  });

  test('UNEXPECTED_NODES_IN_EXTENDING_ROOT for non-block content in extending template', () => {
    var dir = __dirname + '/cases';
    var source = 'extends auxiliary/layout.pg\np this is not allowed';
    var options = {
      filename: dir + '/test.pg',
      source,
      lex,
      parse,
      basedir: dir,
    };
    var tokens = lex(source, options);
    var ast = parse(tokens, options);
    var loaded = load(ast, options);
    assert.throws(
      () => link(loaded),
      (err) => err.code === 'PUGNEUM:UNEXPECTED_NODES_IN_EXTENDING_ROOT',
    );
  });

  test('error in included file shows correct source context', () => {
    var mainPath = path.join(
      __dirname,
      'fixtures',
      'multi-file-error',
      'main.pg',
    );
    var mainSource = fs.readFileSync(mainPath, 'utf8');
    var childPath = path.join(
      __dirname,
      'fixtures',
      'multi-file-error',
      'child.pg',
    );
    var childSource = fs.readFileSync(childPath, 'utf8');

    var options = {filename: mainPath, source: mainSource, lex, parse};
    var tokens = lex(mainSource, options);
    var ast = parse(tokens, options);
    var loaded = load(ast, options);

    assert.throws(
      () => link(loaded, options),
      (err) => {
        assert.strictEqual(err.code, 'PUGNEUM:UNDEFINED_REFERENCE');
        // The error context should show child file content, not main file content
        assert.ok(
          err.message.includes('nonexistent'),
          'Error context should show child file content containing "nonexistent", got: ' +
            err.message,
        );
        assert.ok(
          !err.message.includes('include child'),
          'Error context should NOT show main file content "include child", got: ' +
            err.message,
        );
        return true;
      },
    );
  });
});
