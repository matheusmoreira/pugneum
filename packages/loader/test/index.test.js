'use strict';

var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');
var {test, describe} = require('node:test');

var walk = require('pugneum-walker');
var lex = require('pugneum-lexer');
var parse = require('pugneum-parser');
var load = require('../');

test('pugneum-loader', (t) => {
  let filename = __dirname + '/foo.pg';
  let source = fs.readFileSync(filename, 'utf8');
  let tokens = lex(source, {filename});
  let ast = parse(tokens, {filename});

  ast = load(ast, {lex, parse});

  ast = walk(
    ast,
    function (node) {
      if (node.filename) node.filename = path.basename(node.filename);
      if (node.fullPath) node.fullPath = path.basename(node.fullPath);
      if (node.attrs) {
        node.attrs.forEach(function (attr) {
          if (attr.filename) attr.filename = path.basename(attr.filename);
        });
      }
    },
    {includeDependencies: true},
  );

  t.assert.snapshot(ast);
});

describe('option validation', () => {
  test('throws if options is not an object', () => {
    assert.throws(
      () => load({type: 'Block', nodes: []}, 'bad'),
      /options must be an object/,
    );
  });

  test('throws if lex is not a function', () => {
    assert.throws(
      () => load({type: 'Block', nodes: []}, {lex: 'bad', parse}),
      /lex.*function/,
    );
  });

  test('throws if parse is not a function', () => {
    assert.throws(
      () => load({type: 'Block', nodes: []}, {lex, parse: 42}),
      /parse.*function/,
    );
  });
});

describe('path resolution', () => {
  test('throws FILENAME_REQUIRED for relative path without filename', () => {
    var ast = parse(lex('include foo.pg'), {});
    assert.throws(
      () => load(ast, {lex, parse}),
      (err) =>
        err.code === 'PUGNEUM:FILENAME_REQUIRED' &&
        /filename.*required/.test(err.message),
    );
  });

  test('throws BASEDIR_REQUIRED for absolute path without basedir', () => {
    var ast = parse(lex('include /foo.pg', {filename: 'test.pg'}), {
      filename: 'test.pg',
    });
    assert.throws(
      () => load(ast, {lex, parse}),
      (err) =>
        err.code === 'PUGNEUM:BASEDIR_REQUIRED' &&
        /basedir.*required/.test(err.message),
    );
  });

  test('throws LOAD_ERROR for missing file', () => {
    var filename = __dirname + '/test.pg';
    var ast = parse(lex('include nonexistent.pg', {filename}), {filename});
    assert.throws(
      () => load(ast, {lex, parse}),
      (err) => err.code === 'PUGNEUM:LOAD_ERROR' && /ENOENT/.test(err.message),
    );
  });

  test('throws PATH_TRAVERSAL for absolute path escaping basedir', () => {
    var filename = __dirname + '/test.pg';
    var basedir = __dirname;
    var ast = parse(lex('include /../../etc/passwd', {filename}), {filename});
    assert.throws(
      () => load(ast, {lex, parse, basedir}),
      (err) =>
        err.code === 'PUGNEUM:PATH_TRAVERSAL' &&
        /escapes base directory/.test(err.message),
    );
  });

  test('absolute path within basedir resolves normally', () => {
    var filename = __dirname + '/test.pg';
    var basedir = __dirname;
    var ast = parse(lex('include /nonexistent-file.pg', {filename}), {
      filename,
    });
    // Should not throw PATH_TRAVERSAL — throws LOAD_ERROR because the
    // file doesn't exist, but the path itself is valid
    assert.throws(
      () => load(ast, {lex, parse, basedir}),
      (err) => err.code === 'PUGNEUM:LOAD_ERROR',
    );
  });
});

describe('library includes', () => {
  test('resolves @-prefixed include from node_modules', () => {
    var filename = __dirname + '/test.pg';
    var source = 'include @pugneum/mock-lib/greeting.pg';
    var tokens = lex(source, {filename});
    var ast = parse(tokens, {filename});

    ast = load(ast, {lex, parse});

    // The file should have been loaded — walk to find the included AST
    var included = false;
    walk(
      ast,
      function (node) {
        if (node.type === 'Include' && node.file && node.file.ast) {
          included = true;
        }
      },
      {includeDependencies: true},
    );

    assert.ok(included, 'library include was resolved and loaded');
  });

  test('missing @-prefixed package produces PACKAGE_NOT_FOUND error', () => {
    var filename = __dirname + '/test.pg';
    var source = 'include @pugneum/nonexistent/file.pg';
    var tokens = lex(source, {filename});
    var ast = parse(tokens, {filename});

    assert.throws(
      () => load(ast, {lex, parse}),
      (err) =>
        err.code === 'PUGNEUM:PACKAGE_NOT_FOUND' &&
        /Package not found.*@pugneum\/nonexistent/.test(err.message),
    );
  });

  test('@-prefixed resolution works with extends', () => {
    var filename = __dirname + '/test.pg';
    var source = 'extends @pugneum/mock-lib/greeting.pg';
    var tokens = lex(source, {filename});
    var ast = parse(tokens, {filename});

    ast = load(ast, {lex, parse});

    var extended = false;
    walk(
      ast,
      function (node) {
        if (node.type === 'Extends' && node.file && node.file.ast) {
          extended = true;
        }
      },
      {includeDependencies: true},
    );

    assert.ok(extended, 'library extends was resolved and loaded');
  });

  test('throws PATH_TRAVERSAL for @-prefixed path escaping package directory', () => {
    var filename = __dirname + '/test.pg';
    var source = 'include @pugneum/mock-lib/../../etc/passwd';
    var tokens = lex(source, {filename});
    var ast = parse(tokens, {filename});

    assert.throws(
      () => load(ast, {lex, parse}),
      (err) =>
        err.code === 'PUGNEUM:PATH_TRAVERSAL' &&
        /escapes package directory/.test(err.message),
    );
  });
});

describe('circular dependency detection', () => {
  test('circular include throws CIRCULAR_DEPENDENCY', () => {
    var filename = __dirname + '/cycle-a.pg';
    var source = fs.readFileSync(filename, 'utf8');
    var tokens = lex(source, {filename});
    var ast = parse(tokens, {filename});
    assert.throws(
      () => load(ast, {lex, parse}),
      (err) =>
        err.code === 'PUGNEUM:CIRCULAR_DEPENDENCY' &&
        /cycle-a\.pg/.test(err.message),
    );
  });

  test('circular extends throws CIRCULAR_DEPENDENCY', () => {
    var filename = __dirname + '/extends-cycle-a.pg';
    var source = fs.readFileSync(filename, 'utf8');
    var tokens = lex(source, {filename});
    var ast = parse(tokens, {filename});
    assert.throws(
      () => load(ast, {lex, parse}),
      (err) =>
        err.code === 'PUGNEUM:CIRCULAR_DEPENDENCY' &&
        /extends-cycle-a\.pg/.test(err.message),
    );
  });

  test('diamond dependency: same file included via two branches does not throw', () => {
    // diamond-parent includes diamond-a and diamond-b, both of which include
    // diamond-shared. diamond-shared should load fine from both branches.
    var filename = __dirname + '/diamond-parent.pg';
    var source = fs.readFileSync(filename, 'utf8');
    var tokens = lex(source, {filename});
    var ast = parse(tokens, {filename});
    // Should not throw — the same file reached via independent branches is valid
    load(ast, {lex, parse});
  });
});

describe('custom resolve and read', () => {
  test('accepts custom resolve function', () => {
    var filename = __dirname + '/test.pg';
    var ast = parse(lex('include bar.pg', {filename}), {filename});
    var customResolveCalled = false;
    var customResolve = function (file, source, opts) {
      customResolveCalled = true;
      return path.join(path.dirname(source), file);
    };
    load(ast, {lex, parse, resolve: customResolve});
    assert.ok(customResolveCalled, 'custom resolve was called');
  });

  test('accepts custom read function', () => {
    var filename = __dirname + '/test.pg';
    var ast = parse(lex('include other.pg', {filename}), {filename});
    var readCalled = false;
    var customRead = function (file) {
      readCalled = true;
      return Buffer.from('p hello');
    };
    load(ast, {lex, parse, read: customRead});
    assert.ok(readCalled, 'custom read was called');
  });
});
