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
    function(node) {
      if (node.filename)
        node.filename = path.basename(node.filename);
      if (node.fullPath)
        node.fullPath = path.basename(node.fullPath);
    },
    {includeDependencies: true}
  );

  t.assert.snapshot(ast);
});

describe('option validation', () => {
  test('throws if options is not an object', () => {
    assert.throws(
      () => load({type: 'Block', nodes: []}, 'bad'),
      /options must be an object/
    );
  });

  test('throws if lex is not a function', () => {
    assert.throws(
      () => load({type: 'Block', nodes: []}, {lex: 'bad', parse}),
      /lex.*function/
    );
  });

  test('throws if parse is not a function', () => {
    assert.throws(
      () => load({type: 'Block', nodes: []}, {lex, parse: 42}),
      /parse.*function/
    );
  });
});

describe('path resolution', () => {
  test('throws for relative path without filename', () => {
    var ast = parse(lex('include foo.pg'), {});
    assert.throws(
      () => load(ast, {lex, parse}),
      /filename.*required/
    );
  });

  test('throws for absolute path without basedir', () => {
    var ast = parse(lex('include /foo.pg', {filename: 'test.pg'}), {filename: 'test.pg'});
    assert.throws(
      () => load(ast, {lex, parse}),
      /basedir.*required/
    );
  });

  test('throws for missing file', () => {
    var filename = __dirname + '/test.pg';
    var ast = parse(lex('include nonexistent.pg', {filename}), {filename});
    assert.throws(
      () => load(ast, {lex, parse}),
      /ENOENT/
    );
  });
});

describe('custom resolve and read', () => {
  test('accepts custom resolve function', () => {
    var filename = __dirname + '/test.pg';
    var ast = parse(lex('include foo.pg', {filename}), {filename});
    var customResolveCalled = false;
    var customResolve = function(file, source, opts) {
      customResolveCalled = true;
      return path.join(path.dirname(source), file);
    };
    // Will fail because foo.pg doesn't exist, but resolve should be called
    try {
      load(ast, {lex, parse, resolve: customResolve});
    } catch (e) {
      // Expected: file not found
    }
    assert.ok(customResolveCalled, 'custom resolve was called');
  });

  test('accepts custom read function', () => {
    var filename = __dirname + '/test.pg';
    var ast = parse(lex('include other.pg', {filename}), {filename});
    var readCalled = false;
    var customRead = function(file) {
      readCalled = true;
      return Buffer.from('p hello');
    };
    load(ast, {lex, parse, read: customRead});
    assert.ok(readCalled, 'custom read was called');
  });
});
