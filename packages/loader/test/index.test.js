'use strict';

var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
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

  test('throws PATH_ESCAPE for absolute path escaping basedir', () => {
    var filename = __dirname + '/test.pg';
    var basedir = __dirname;
    var ast = parse(lex('include /../../etc/passwd', {filename}), {filename});
    assert.throws(
      () => load(ast, {lex, parse, basedir}),
      (err) =>
        err.code === 'PUGNEUM:PATH_ESCAPE' &&
        /escapes project root/.test(err.message),
    );
  });

  test('absolute path within basedir resolves normally', () => {
    var filename = __dirname + '/test.pg';
    var basedir = __dirname;
    var ast = parse(lex('include /nonexistent-file.pg', {filename}), {
      filename,
    });
    // Should not throw PATH_ESCAPE — throws LOAD_ERROR because the
    // file doesn't exist, but the path itself is valid
    assert.throws(
      () => load(ast, {lex, parse, basedir}),
      (err) => err.code === 'PUGNEUM:LOAD_ERROR',
    );
  });

  test('throws PATH_ESCAPE for relative path escaping basedir (default-deny)', () => {
    // Default-deny containment: a relative include must not climb out of the
    // project root. ../../etc/passwd from a file in basedir escapes and must
    // be rejected, not silently read.
    var filename = __dirname + '/test.pg';
    var basedir = __dirname;
    var ast = parse(lex('include ../../../../etc/passwd', {filename}), {
      filename,
    });
    assert.throws(
      () => load(ast, {lex, parse, basedir}),
      (err) =>
        err.code === 'PUGNEUM:PATH_ESCAPE' &&
        /escapes project root/.test(err.message),
    );
  });

  test('relative path within basedir resolves normally', () => {
    // A relative include that stays inside basedir is allowed (then fails with
    // LOAD_ERROR only because the target does not exist).
    var filename = __dirname + '/test.pg';
    var basedir = __dirname;
    var ast = parse(lex('include sub/nonexistent.pg', {filename}), {filename});
    assert.throws(
      () => load(ast, {lex, parse, basedir}),
      (err) => err.code === 'PUGNEUM:LOAD_ERROR',
    );
  });

  test('throws PATH_ESCAPE for sibling-prefix absolute path', () => {
    // basedir /x must not be escaped by /../x-evil — the containment check
    // requires a path separator after the base, so a sibling whose name shares
    // the base prefix is rejected.
    var base = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-base-'));
    var evil = base + '-evil';
    fs.mkdirSync(evil, {recursive: true});
    fs.writeFileSync(evil + '/secret.pg', 'p secret');
    try {
      var filename = base + '/test.pg';
      var ast = parse(
        lex('include /../' + path.basename(evil) + '/secret.pg', {filename}),
        {
          filename,
        },
      );
      assert.throws(
        () => load(ast, {lex, parse, basedir: base}),
        (err) => err.code === 'PUGNEUM:PATH_ESCAPE',
      );
    } finally {
      fs.rmSync(base, {recursive: true, force: true});
      fs.rmSync(evil, {recursive: true, force: true});
    }
  });

  test('throws PATH_ESCAPE when a symlink inside basedir points outside it', () => {
    // The containment check uses realpath, so a symlink that lives inside
    // basedir but resolves outside it cannot be used to escape the sandbox.
    var base = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-sym-'));
    var outside = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-out-'));
    fs.writeFileSync(outside + '/secret.pg', 'p secret');
    fs.symlinkSync(outside, base + '/escape');
    try {
      var filename = base + '/test.pg';
      var ast = parse(lex('include /escape/secret.pg', {filename}), {filename});
      assert.throws(
        () => load(ast, {lex, parse, basedir: base}),
        (err) => err.code === 'PUGNEUM:PATH_ESCAPE',
      );
    } finally {
      fs.rmSync(base, {recursive: true, force: true});
      fs.rmSync(outside, {recursive: true, force: true});
    }
  });
});

describe('library includes', () => {
  test('resolves @-prefixed include from node_modules', () => {
    var filename = __dirname + '/test.pg';
    var source = 'include @@pugneum/mock-lib/greeting.pg';
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
    var source = 'include @@pugneum/nonexistent/file.pg';
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
    var source = 'extends @@pugneum/mock-lib/greeting.pg';
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

  test('throws PATH_ESCAPE for @-prefixed path escaping package directory', () => {
    var filename = __dirname + '/test.pg';
    var source = 'include @@pugneum/mock-lib/../../etc/passwd';
    var tokens = lex(source, {filename});
    var ast = parse(tokens, {filename});

    assert.throws(
      () => load(ast, {lex, parse}),
      (err) =>
        err.code === 'PUGNEUM:PATH_ESCAPE' &&
        /escapes package directory/.test(err.message),
    );
  });

  test('resolves unscoped package', () => {
    var filename = __dirname + '/test.pg';
    var source = 'include @unscoped-mock-lib/greeting.pg';
    var tokens = lex(source, {filename});
    var ast = parse(tokens, {filename});

    ast = load(ast, {lex, parse});

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

    assert.ok(included, 'unscoped library include was resolved and loaded');
  });

  test('throws INVALID_LIBRARY_PATH for bare @', () => {
    var filename = __dirname + '/test.pg';
    var source = 'include @';
    var tokens = lex(source, {filename});
    var ast = parse(tokens, {filename});

    assert.throws(
      () => load(ast, {lex, parse}),
      (err) => err.code === 'PUGNEUM:INVALID_LIBRARY_PATH',
    );
  });

  test('throws INVALID_LIBRARY_PATH for @ without file path', () => {
    var filename = __dirname + '/test.pg';
    var source = 'include @@pugneum/mock-lib';
    var tokens = lex(source, {filename});
    var ast = parse(tokens, {filename});

    assert.throws(
      () => load(ast, {lex, parse}),
      (err) =>
        err.code === 'PUGNEUM:INVALID_LIBRARY_PATH' &&
        /Use: @@pugneum\/mock-lib\/file\.pg/.test(err.message),
    );
  });

  test('error suggestion for trailing slash has no double slash', () => {
    var filename = __dirname + '/test.pg';
    var source = 'include @some-pkg/';
    var tokens = lex(source, {filename});
    var ast = parse(tokens, {filename});

    assert.throws(
      () => load(ast, {lex, parse}),
      (err) =>
        err.code === 'PUGNEUM:INVALID_LIBRARY_PATH' &&
        /Use: @some-pkg\/file\.pg/.test(err.message) &&
        !/\/\//.test(err.message),
    );
  });

  test('library include resolves to the expected package-relative path', () => {
    // Pin the scoped @@-> @ de-doubling and the subpath join, not just that
    // "something" loaded.
    var filename = __dirname + '/test.pg';
    var source = 'include @@pugneum/mock-lib/greeting.pg';
    var tokens = lex(source, {filename});
    var ast = parse(tokens, {filename});

    var loaded = load(ast, {lex, parse});

    var fullPath;
    walk(
      loaded,
      function (node) {
        if (node.type === 'Include' && node.file && node.file.fullPath) {
          fullPath = node.file.fullPath;
        }
      },
      {includeDependencies: true},
    );
    assert.ok(
      /mock-lib[\\/]greeting\.pg$/.test(fullPath),
      'resolved to the mock-lib greeting file: ' + fullPath,
    );
  });

  test('throws INVALID_LIBRARY_PATH for empty package name (@/file.pg)', () => {
    // Leading slash after @ yields an empty package name; it must be rejected
    // as an invalid library path, not fed to require.resolve as "/package.json"
    // and surfaced as a blank-named PACKAGE_NOT_FOUND.
    var filename = __dirname + '/test.pg';
    var source = 'include @/file.pg';
    var tokens = lex(source, {filename});
    var ast = parse(tokens, {filename});

    assert.throws(
      () => load(ast, {lex, parse}),
      (err) => err.code === 'PUGNEUM:INVALID_LIBRARY_PATH',
    );
  });

  test('throws INVALID_LIBRARY_PATH for empty scope (@@/pkg/file.pg)', () => {
    var filename = __dirname + '/test.pg';
    var source = 'include @@/pkg/file.pg';
    var tokens = lex(source, {filename});
    var ast = parse(tokens, {filename});

    assert.throws(
      () => load(ast, {lex, parse}),
      (err) => err.code === 'PUGNEUM:INVALID_LIBRARY_PATH',
    );
  });

  test('scoped trailing-slash suggestion has no double slash', () => {
    var filename = __dirname + '/test.pg';
    var source = 'include @@scope/';
    var tokens = lex(source, {filename});
    var ast = parse(tokens, {filename});

    assert.throws(
      () => load(ast, {lex, parse}),
      (err) =>
        err.code === 'PUGNEUM:INVALID_LIBRARY_PATH' &&
        !/\/\//.test(err.message),
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
        // The source-context header names the file containing the offending
        // include (cycle-a)...
        /cycle-a\.pg/.test(err.message) &&
        // ...and the detector clause names the file being re-entered (cycle-b).
        /Circular dependency detected:.*cycle-b\.pg is already being loaded/.test(
          err.message,
        ),
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
        /extends-cycle-a\.pg/.test(err.message) &&
        /Circular dependency detected:.*extends-cycle-b\.pg is already being loaded/.test(
          err.message,
        ),
    );
  });

  test('diamond dependency: same file loaded via both branches', () => {
    // diamond-parent includes diamond-a and diamond-b, both of which include
    // diamond-shared. diamond-shared should load fine from both branches and
    // carry a populated file.ast on each (de-dup is NOT applied to a diamond).
    var filename = __dirname + '/diamond-parent.pg';
    var source = fs.readFileSync(filename, 'utf8');
    var tokens = lex(source, {filename});
    var ast = parse(tokens, {filename});
    // Should not throw — the same file reached via independent branches is valid
    var loaded = load(ast, {lex, parse});

    var sharedLoaded = 0;
    walk(
      loaded,
      function (node) {
        if (
          node.type === 'Include' &&
          node.file &&
          /diamond-shared\.pg$/.test(node.file.path) &&
          node.file.ast
        ) {
          sharedLoaded++;
        }
      },
      {includeDependencies: true},
    );
    assert.equal(
      sharedLoaded,
      2,
      'diamond-shared.pg is loaded on both branches',
    );
  });
});

describe('custom resolve and read', () => {
  test('custom resolve return value drives resolution', () => {
    // Point the include at a name that does not exist on disk and have the
    // custom resolver redirect it to a real file, proving the loader uses the
    // resolver's return value (not a default fallback).
    var filename = __dirname + '/test.pg';
    var ast = parse(lex('include does-not-exist.pg', {filename}), {filename});
    var customResolveCalled = false;
    var customResolve = function (file, source, opts) {
      customResolveCalled = true;
      return path.join(__dirname, 'bing.pg');
    };
    var loaded = load(ast, {lex, parse, resolve: customResolve});
    assert.ok(customResolveCalled, 'custom resolve was called');

    var resolvedPath;
    walk(
      loaded,
      function (node) {
        if (node.type === 'Include' && node.file && node.file.fullPath) {
          resolvedPath = node.file.fullPath;
        }
      },
      {includeDependencies: true},
    );
    assert.ok(
      /bing\.pg$/.test(resolvedPath),
      'loader used the custom resolver return value: ' + resolvedPath,
    );
  });

  test('custom read return value flows into the loaded AST', () => {
    var filename = __dirname + '/test.pg';
    var ast = parse(lex('include other.pg', {filename}), {filename});
    var readCalled = false;
    var customRead = function (file) {
      readCalled = true;
      return Buffer.from('p hello-from-custom-read');
    };
    var loaded = load(ast, {lex, parse, read: customRead});
    assert.ok(readCalled, 'custom read was called');

    // The buffer content must flow through raw.toString('utf8') into lex/parse,
    // producing a `p` tag with the custom text.
    var foundText;
    walk(
      loaded,
      function (node) {
        if (node.type === 'Text') foundText = node.val;
      },
      {includeDependencies: true},
    );
    assert.equal(foundText, 'hello-from-custom-read');
  });
});

describe('binary contract and idempotency', () => {
  test('default read populates file.raw as a Buffer of the file bytes', () => {
    // The filterer hands file.raw to binary filters, so it must be genuine
    // bytes, not a UTF-8-decoded string.
    var filename = __dirname + '/test.pg';
    var ast = parse(lex('include bing.pg', {filename}), {filename});
    var loaded = load(ast, {lex, parse});

    var raw;
    walk(
      loaded,
      function (node) {
        if (
          node.type === 'Include' &&
          node.file &&
          /bing\.pg$/.test(node.file.path)
        ) {
          raw = node.file.raw;
        }
      },
      {includeDependencies: true},
    );
    assert.ok(Buffer.isBuffer(raw), 'file.raw is a Buffer');
    assert.equal(
      raw.toString('utf8'),
      fs.readFileSync(__dirname + '/bing.pg', 'utf8'),
    );
  });

  test('non-UTF-8 bytes survive a binary read without corruption', () => {
    // A custom Buffer-returning read carrying non-UTF-8 bytes must reach
    // file.raw byte-for-byte (it is not lossily decoded through UTF-8).
    var filename = __dirname + '/test.pg';
    var bytes = Buffer.from([0xff, 0xfe, 0x00, 0x41]);
    // Use a RawInclude (non-.pg) so the bytes are not re-lexed as pugneum.
    var ast = parse(lex('include blob.bin', {filename}), {filename});
    var loaded = load(ast, {lex, parse, read: () => bytes});

    var raw;
    walk(
      loaded,
      function (node) {
        if (node.type === 'RawInclude' && node.file) raw = node.file.raw;
      },
      {includeDependencies: true},
    );
    assert.ok(Buffer.isBuffer(raw), 'file.raw is a Buffer');
    assert.deepEqual([...raw], [0xff, 0xfe, 0x00, 0x41]);
  });

  test('re-loading an already-loaded AST preserves Buffer file.raw', () => {
    // load() clones its input; a previously-loaded Buffer must not survive the
    // clone as a Uint8Array (which would break .toString('utf8')). The loader
    // re-normalizes raw to a Buffer, so a double-load round-trips cleanly.
    var filename = __dirname + '/test.pg';
    var ast = parse(lex('include bing.pg', {filename}), {filename});
    var once = load(ast, {lex, parse});
    var twice = load(once, {lex, parse});

    var raw;
    walk(
      twice,
      function (node) {
        if (
          node.type === 'Include' &&
          node.file &&
          /bing\.pg$/.test(node.file.path)
        ) {
          raw = node.file.raw;
        }
      },
      {includeDependencies: true},
    );
    assert.ok(Buffer.isBuffer(raw), 'file.raw is still a Buffer after re-load');
    assert.equal(
      raw.toString('utf8'),
      fs.readFileSync(__dirname + '/bing.pg', 'utf8'),
    );
  });
});

describe('recursion depth limit', () => {
  test('deep non-cyclic include chain throws coded LOAD_DEPTH_EXCEEDED', () => {
    // A long but non-cyclic include chain must abort with a coded PUGNEUM
    // error (well below the native stack ceiling), not an uncatchable
    // RangeError. A custom resolve/read synthesizes the chain in memory.
    var filename = __dirname + '/test.pg';
    var ast = parse(lex('include step-0.pg', {filename}), {filename});
    var resolve = (file) => '/virtual/' + file;
    var read = (full) => {
      var m = /step-(\d+)\.pg$/.exec(full);
      var n = m ? parseInt(m[1], 10) : 0;
      return Buffer.from('p step ' + n + '\ninclude step-' + (n + 1) + '.pg');
    };
    assert.throws(
      () => load(ast, {lex, parse, resolve, read, maxLoadDepth: 16}),
      (err) => err.code === 'PUGNEUM:LOAD_DEPTH_EXCEEDED',
    );
  });
});
