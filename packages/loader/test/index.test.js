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

function parseSource(source, filename) {
  const options = filename === undefined ? {source} : {filename, source};
  return parse(lex(source, options), options);
}

function findNode(ast, type) {
  let found;
  walk(
    ast,
    function (node, replace, control) {
      if (node.type === type) {
        found = node;
        control.stop();
      }
    },
    {includeDependencies: true},
  );
  return found;
}

test('pugneum-loader', (t) => {
  let filename = __dirname + '/foo.pg';
  let source = fs.readFileSync(filename, 'utf8');
  let ast = parseSource(source, filename);

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

  for (const invalid of [null, [], 42]) {
    test('rejects option container ' + JSON.stringify(invalid), () => {
      assert.throws(
        () => load({type: 'Block', nodes: []}, invalid),
        /options must be an object/,
      );
    });
  }

  for (const name of ['resolve', 'read', 'canonicalize']) {
    for (const invalid of [null, false, '', 0]) {
      test(`rejects ${name}=${JSON.stringify(
        invalid,
      )} before traversal`, () => {
        assert.throws(
          () =>
            load(
              {type: 'Block', nodes: []},
              Object.assign({lex, parse}, {[name]: invalid}),
            ),
          new RegExp(name + '.*function'),
        );
      });
    }
  }

  for (const invalid of [null, {}, [], new Set()]) {
    test(`rejects dependencyCache=${Object.prototype.toString.call(
      invalid,
    )}`, () => {
      assert.throws(
        () =>
          load(
            {type: 'Block', nodes: []},
            {lex, parse, dependencyCache: invalid},
          ),
        /dependencyCache must be a Map/,
      );
    });
  }

  for (const invalid of [null, 'def', {}, ['definition']]) {
    test(`rejects mixinContext=${JSON.stringify(invalid)}`, () => {
      assert.throws(
        () =>
          load({type: 'Block', nodes: []}, {lex, parse, mixinContext: invalid}),
        /mixinContext.*"def" or "call"/,
      );
    });
  }

  test('undefined optional hooks select their defaults', () => {
    const ast = parseSource('include bing.pg', __dirname + '/test.pg');
    const loaded = load(ast, {
      lex,
      parse,
      resolve: undefined,
      read: undefined,
      canonicalize: undefined,
    });
    assert.match(findNode(loaded, 'Include').file.fullPath, /bing\.pg$/);
  });

  for (const invalid of [NaN, Infinity, -1, 1.5, '2', 257]) {
    test('rejects maxLoadDepth=' + String(invalid), () => {
      assert.throws(
        () =>
          load({type: 'Block', nodes: []}, {lex, parse, maxLoadDepth: invalid}),
        /maxLoadDepth.*0 through 256/,
      );
    });
  }

  for (const name of ['basedir', 'filename', 'source']) {
    for (const invalid of [null, false, 42, {}]) {
      test(`rejects ${name}=${JSON.stringify(invalid)}`, () => {
        assert.throws(
          () =>
            load(
              {type: 'Block', nodes: []},
              Object.assign({lex, parse}, {[name]: invalid}),
            ),
          new RegExp(name + '.*string'),
        );
      });
    }
  }

  for (const [label, sources] of [
    ['null', null],
    ['array', []],
    ['non-extensible object', Object.preventExtensions({})],
  ]) {
    test(`rejects a ${label} sources registry`, () => {
      assert.throws(
        () => load({type: 'Block', nodes: []}, {lex, parse, sources}),
        /sources must be (?:a non-null, non-array object|extensible)/,
      );
    });
  }

  test('a frozen options bag works when its output map is supplied', () => {
    const sources = {};
    const options = Object.freeze({lex, parse, sources});
    load({type: 'Block', nodes: []}, options);
    assert.strictEqual(options.sources, sources);
  });
});

describe('source registry and input ownership', () => {
  test('keeps public input ownership while allowing an owned fast path', () => {
    const publicInput = parseSource('p public', 'public.pg');
    const publicLoaded = load(publicInput, {lex, parse});
    assert.notStrictEqual(publicLoaded, publicInput);

    const ownedInput = parseSource('p owned', 'owned.pg');
    const ownedLoaded = load.loadOwned(ownedInput, {lex, parse});
    assert.strictEqual(ownedLoaded, ownedInput);
  });

  test('preserves a supplied map while refreshing root and dependency text', () => {
    const filename = path.join(__dirname, 'entry.pg');
    const source = 'include bing.pg';
    const ast = parseSource(source, filename);
    const original = structuredClone(ast);
    const sources = Object.assign(Object.create(null), {
      kept: 'caller-owned',
      [filename]: 'stale entry text',
    });
    const options = {lex, parse, filename, source, sources};

    const loaded = load(ast, options);
    const include = findNode(loaded, 'Include');

    assert.strictEqual(options.sources, sources);
    assert.equal(sources.kept, 'caller-owned');
    assert.equal(sources[filename], source);
    assert.equal(
      sources[include.file.fullPath],
      fs.readFileSync(include.file.fullPath, 'utf8'),
    );
    assert.deepEqual(ast, original, 'the caller-owned AST remains unchanged');
  });

  test('refreshed root text supplies the diagnostic frame', () => {
    const filename = path.join(__dirname, 'entry.pg');
    const source = 'include definitely-missing.pg';
    const sources = {[filename]: 'p stale'};

    assert.throws(
      () =>
        load(parseSource(source, filename), {
          lex,
          parse,
          filename,
          source,
          sources,
        }),
      (err) =>
        err.code === 'PUGNEUM:LOAD_ERROR' &&
        err.source === source &&
        /include definitely-missing\.pg/.test(err.message) &&
        !/p stale/.test(err.message),
    );
  });
});

describe('AST boundary', () => {
  const dependencyKinds = [
    ['Include', 'include child.pg'],
    ['RawInclude', 'include child.txt'],
    ['Extends', 'extends child.pg'],
  ];
  const malformedFiles = [
    ['missing', (node) => delete node.file],
    ['null', (node) => (node.file = null)],
    ['scalar', (node) => (node.file = 42)],
    ['wrong node type', (node) => (node.file = {type: 'Text', val: ''})],
  ];

  for (const [type, source] of dependencyKinds) {
    for (const [shape, mutate] of malformedFiles) {
      test(`${type} with ${shape} file is a located INVALID_AST`, () => {
        const filename = path.join(__dirname, 'malformed.pg');
        const ast = parseSource(source, filename);
        mutate(findNode(ast, type));

        assert.throws(
          () => load(ast, {lex, parse, filename, source}),
          (err) => {
            assert.equal(err.code, 'PUGNEUM:INVALID_AST');
            assert.equal(err.filename, filename);
            assert.equal(err.line, 1);
            assert.equal(err.source, source);
            assert.match(err.msg, /file/);
            assert.match(err.message, new RegExp(source.replace('.', '\\.')));
            assert.ok(Object.hasOwn(err, 'cause'));
            return true;
          },
        );
      });
    }
  }
});

describe('path resolution', () => {
  test('throws FILENAME_REQUIRED for relative path without filename', () => {
    var ast = parseSource('include foo.pg');
    assert.throws(
      () => load(ast, {lex, parse}),
      (err) =>
        err.code === 'PUGNEUM:FILENAME_REQUIRED' &&
        /filename.*required/.test(err.message),
    );
  });

  test('throws BASEDIR_REQUIRED for absolute path without basedir', () => {
    var ast = parseSource('include /foo.pg', 'test.pg');
    assert.throws(
      () => load(ast, {lex, parse}),
      (err) =>
        err.code === 'PUGNEUM:BASEDIR_REQUIRED' &&
        /basedir.*required/.test(err.message),
    );
  });

  test('throws LOAD_ERROR for missing file', () => {
    var filename = __dirname + '/test.pg';
    var ast = parseSource('include nonexistent.pg', filename);
    assert.throws(
      () => load(ast, {lex, parse}),
      (err) => err.code === 'PUGNEUM:LOAD_ERROR' && /ENOENT/.test(err.message),
    );
  });

  test('throws PATH_ESCAPE for absolute path escaping basedir', () => {
    var filename = __dirname + '/test.pg';
    var basedir = __dirname;
    var ast = parseSource('include /../../etc/passwd', filename);
    assert.throws(
      () => load(ast, {lex, parse, basedir}),
      (err) =>
        err.code === 'PUGNEUM:PATH_ESCAPE' &&
        /escapes project root/.test(err.message),
    );
  });

  test('absolute path within basedir loads successfully', () => {
    var filename = __dirname + '/test.pg';
    var basedir = __dirname;
    var loaded = load(parseSource('include /bing.pg', filename), {
      lex,
      parse,
      basedir,
    });
    assert.equal(
      findNode(loaded, 'Include').file.fullPath,
      fs.realpathSync(path.join(basedir, 'bing.pg')),
    );
  });

  test('throws PATH_ESCAPE for relative path escaping basedir (default-deny)', () => {
    // Default-deny containment: a relative include must not climb out of the
    // project root. ../../etc/passwd from a file in basedir escapes and must
    // be rejected, not silently read.
    var filename = __dirname + '/test.pg';
    var basedir = __dirname;
    var ast = parseSource('include ../../../../etc/passwd', filename);
    assert.throws(
      () => load(ast, {lex, parse, basedir}),
      (err) =>
        err.code === 'PUGNEUM:PATH_ESCAPE' &&
        /escapes project root/.test(err.message),
    );
  });

  test('relative path within basedir loads successfully', () => {
    var filename = __dirname + '/test.pg';
    var basedir = __dirname;
    var loaded = load(parseSource('include bing.pg', filename), {
      lex,
      parse,
      basedir,
    });
    assert.equal(
      findNode(loaded, 'Include').file.fullPath,
      fs.realpathSync(path.join(basedir, 'bing.pg')),
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
      var ast = parseSource(
        'include /../' + path.basename(evil) + '/secret.pg',
        filename,
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
      var ast = parseSource('include /escape/secret.pg', filename);
      assert.throws(
        () => load(ast, {lex, parse, basedir: base}),
        (err) => err.code === 'PUGNEUM:PATH_ESCAPE',
      );
    } finally {
      fs.rmSync(base, {recursive: true, force: true});
      fs.rmSync(outside, {recursive: true, force: true});
    }
  });

  test('a filesystem root contains its ordinary descendants', () => {
    const root = path.parse(__filename).root;
    assert.equal(
      load.resolve(__filename, __filename, {basedir: root}),
      fs.realpathSync(__filename),
    );
  });

  test('relative entry filenames still produce absolute full paths', () => {
    const entry = path.relative(process.cwd(), path.join(__dirname, 'test.pg'));
    const resolved = load.resolve('bing.pg', entry, {});
    assert.equal(resolved, path.join(__dirname, 'bing.pg'));
    assert.ok(path.isAbsolute(resolved));
  });

  test('load filename resolves an otherwise unstamped entry AST', () => {
    const source = 'include bing.pg';
    const ast = parseSource(source);
    const filename = path.join(__dirname, 'entry.pg');
    const loaded = load(ast, {lex, parse, filename, source});
    const include = findNode(loaded, 'Include');
    assert.equal(include.filename, filename);
    assert.equal(include.file.filename, filename);
    assert.equal(include.file.fullPath, path.join(__dirname, 'bing.pg'));
  });

  test('basedir contains a custom resolver result before read', () => {
    const basedir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-custom-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-outside-'));
    let reads = 0;
    try {
      const filename = path.join(basedir, 'page.pg');
      const source = 'include child.pg';
      const ast = parseSource(source, filename);
      assert.throws(
        () =>
          load(ast, {
            lex,
            parse,
            basedir,
            filename,
            source,
            resolve: () => path.join(outside, 'child.pg'),
            read() {
              reads++;
              return Buffer.from('p should-not-run');
            },
          }),
        (err) => err.code === 'PUGNEUM:PATH_ESCAPE',
      );
      assert.equal(reads, 0);
    } finally {
      fs.rmSync(basedir, {recursive: true, force: true});
      fs.rmSync(outside, {recursive: true, force: true});
    }
  });

  test('default resolution reads the checked target after a symlink swap', () => {
    const basedir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-swap-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-swap-out-'));
    const insideFile = path.join(basedir, 'inside.pg');
    const outsideFile = path.join(outside, 'outside.pg');
    const alias = path.join(basedir, 'alias.pg');
    fs.writeFileSync(insideFile, 'p inside');
    fs.writeFileSync(outsideFile, 'p outside');
    fs.symlinkSync(insideFile, alias);
    try {
      const filename = path.join(basedir, 'page.pg');
      const source = 'include /alias.pg';
      const ast = parseSource(source, filename);
      const loaded = load(ast, {
        lex,
        parse,
        basedir,
        filename,
        source,
        read(resolved) {
          fs.unlinkSync(alias);
          fs.symlinkSync(outsideFile, alias);
          return fs.readFileSync(resolved);
        },
      });
      const include = findNode(loaded, 'Include');
      assert.equal(include.file.fullPath, fs.realpathSync(insideFile));
      assert.equal(findNode(include.file.ast, 'Text').val, 'inside');
    } finally {
      fs.rmSync(basedir, {recursive: true, force: true});
      fs.rmSync(outside, {recursive: true, force: true});
    }
  });

  test('direct resolver errors do not fabricate a zero location', () => {
    assert.throws(
      () => load.resolve('child.pg', '', {}),
      (err) =>
        err.code === 'PUGNEUM:FILENAME_REQUIRED' &&
        !/^0(?:\n|:)/.test(err.message),
    );
  });
});

describe('library includes', () => {
  test('resolves @-prefixed include from node_modules', () => {
    assert.throws(
      () => require.resolve('@pugneum/mock-lib/package.json'),
      (err) => err.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED',
    );
    var filename = __dirname + '/test.pg';
    var source = 'include @@pugneum/mock-lib/greeting.pg';
    var ast = load(parseSource(source, filename), {lex, parse});

    assert.ok(
      findNode(ast, 'Include').file.ast,
      'library include was resolved and loaded',
    );
  });

  test('missing @-prefixed package produces PACKAGE_NOT_FOUND error', () => {
    var filename = __dirname + '/test.pg';
    var source = 'include @@pugneum/nonexistent/file.pg';
    var ast = parseSource(source, filename);

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
    var ast = load(parseSource(source, filename), {lex, parse});

    assert.ok(
      findNode(ast, 'Extends').file.ast,
      'library extends was resolved and loaded',
    );
  });

  test('throws PATH_ESCAPE for @-prefixed path escaping package directory', () => {
    var filename = __dirname + '/test.pg';
    var source = 'include @@pugneum/mock-lib/../../etc/passwd';
    var ast = parseSource(source, filename);

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
    var ast = load(parseSource(source, filename), {lex, parse});

    assert.ok(
      findNode(ast, 'Include').file.ast,
      'unscoped library include was resolved and loaded',
    );
  });

  test('throws INVALID_LIBRARY_PATH for bare @', () => {
    var filename = __dirname + '/test.pg';
    var source = 'include @';
    var ast = parseSource(source, filename);

    assert.throws(
      () => load(ast, {lex, parse}),
      (err) => err.code === 'PUGNEUM:INVALID_LIBRARY_PATH',
    );
  });

  test('throws INVALID_LIBRARY_PATH for @ without file path', () => {
    var filename = __dirname + '/test.pg';
    var source = 'include @@pugneum/mock-lib';
    var ast = parseSource(source, filename);

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
    var ast = parseSource(source, filename);

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
    var loaded = load(parseSource(source, filename), {lex, parse});
    var fullPath = findNode(loaded, 'Include').file.fullPath;
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
    var ast = parseSource(source, filename);

    assert.throws(
      () => load(ast, {lex, parse}),
      (err) => err.code === 'PUGNEUM:INVALID_LIBRARY_PATH',
    );
  });

  test('throws INVALID_LIBRARY_PATH for empty scope (@@/pkg/file.pg)', () => {
    var filename = __dirname + '/test.pg';
    var source = 'include @@/pkg/file.pg';
    var ast = parseSource(source, filename);

    assert.throws(
      () => load(ast, {lex, parse}),
      (err) => err.code === 'PUGNEUM:INVALID_LIBRARY_PATH',
    );
  });

  test('scoped trailing-slash suggestion has no double slash', () => {
    var filename = __dirname + '/test.pg';
    var source = 'include @@scope/';
    var ast = parseSource(source, filename);

    assert.throws(
      () => load(ast, {lex, parse}),
      (err) =>
        err.code === 'PUGNEUM:INVALID_LIBRARY_PATH' &&
        /Use: @@scope\/pkg\/file\.pg/.test(err.message) &&
        !/\/\//.test(err.message),
    );
  });

  for (const specifier of [
    '@./README.md',
    '@../README.md',
    '@_private/file.pg',
    '@pkg\\child/file.pg',
    '@pkg name/file.pg',
    '@' + 'a'.repeat(215) + '/file.pg',
    '@@scope/_private/file.pg',
  ]) {
    test('rejects path-like package name ' + JSON.stringify(specifier), () => {
      assert.throws(
        () => load.resolve(specifier, __filename, {}),
        (err) => err.code === 'PUGNEUM:INVALID_LIBRARY_PATH',
      );
    });
  }

  test('an installed package with an unavailable subpath is not called absent', () => {
    assert.throws(
      () => load.resolve('@@pugneum/mock-lib/not-exported.pg', __filename, {}),
      (err) =>
        err.code === 'PUGNEUM:LIBRARY_PATH_UNAVAILABLE' &&
        !/Install it/.test(err.message),
    );
  });

  test('library lookup prefers the version beside the including project', () => {
    const site = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-site-'));
    const packageName = '@pugneum/mock-lib';
    const packageRoot = path.join(site, 'node_modules', '@pugneum', 'mock-lib');
    fs.mkdirSync(packageRoot, {recursive: true});
    fs.writeFileSync(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({
        name: packageName,
        version: '1.0.0',
        exports: {'./greeting.pg': './greeting.pg'},
      }),
    );
    fs.writeFileSync(path.join(packageRoot, 'greeting.pg'), 'p local');
    try {
      const page = path.join(site, 'page.pg');
      assert.equal(
        load.resolve('@' + packageName + '/greeting.pg', page, {
          basedir: site,
        }),
        fs.realpathSync(path.join(packageRoot, 'greeting.pg')),
      );
    } finally {
      fs.rmSync(site, {recursive: true, force: true});
    }
  });
});

describe('circular dependency detection', () => {
  test('circular include throws CIRCULAR_DEPENDENCY', () => {
    var filename = __dirname + '/cycle-a.pg';
    var source = fs.readFileSync(filename, 'utf8');
    var ast = parseSource(source, filename);
    var reads = [];
    assert.throws(
      () =>
        load(ast, {
          lex,
          parse,
          read(file) {
            reads.push(path.basename(file));
            return fs.readFileSync(file);
          },
        }),
      (err) =>
        err.code === 'PUGNEUM:CIRCULAR_DEPENDENCY' &&
        // The source-context header names the file containing the offending
        // include (cycle-b)...
        /cycle-b\.pg/.test(err.message) &&
        // ...and the detector clause names the entry being re-entered (cycle-a).
        /Circular dependency detected:.*cycle-a\.pg is already being loaded/.test(
          err.message,
        ),
    );
    assert.deepEqual(reads, ['cycle-b.pg']);
  });

  test('circular extends throws CIRCULAR_DEPENDENCY', () => {
    var filename = __dirname + '/extends-cycle-a.pg';
    var source = fs.readFileSync(filename, 'utf8');
    var ast = parseSource(source, filename);
    var reads = [];
    assert.throws(
      () =>
        load(ast, {
          lex,
          parse,
          read(file) {
            reads.push(path.basename(file));
            return fs.readFileSync(file);
          },
        }),
      (err) =>
        err.code === 'PUGNEUM:CIRCULAR_DEPENDENCY' &&
        /extends-cycle-b\.pg/.test(err.message) &&
        /Circular dependency detected:.*extends-cycle-a\.pg is already being loaded/.test(
          err.message,
        ),
    );
    assert.deepEqual(reads, ['extends-cycle-b.pg']);
  });

  test('a symlink alias back to the entry is rejected before read', () => {
    const basedir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-cycle-'));
    const filename = path.join(basedir, 'entry.pg');
    const alias = path.join(basedir, 'entry-alias.pg');
    const source = 'include entry-alias.pg';
    fs.writeFileSync(filename, source);
    fs.symlinkSync(filename, alias, 'file');
    let reads = 0;

    try {
      assert.throws(
        () =>
          load(parseSource(source, filename), {
            lex,
            parse,
            basedir,
            filename,
            source,
            read(file) {
              reads++;
              return fs.readFileSync(file);
            },
          }),
        (err) =>
          err.code === 'PUGNEUM:CIRCULAR_DEPENDENCY' &&
          /entry\.pg is already being loaded/.test(err.msg),
      );
      assert.equal(reads, 0);
    } finally {
      fs.rmSync(basedir, {recursive: true, force: true});
    }
  });

  test('basedir gives custom filesystem resolvers canonical cycle identity', () => {
    const basedir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'loader-custom-cycle-'),
    );
    const filename = path.join(basedir, 'entry.pg');
    const entryAlias = path.join(basedir, 'entry-alias.pg');
    const source = 'include entry.pg';
    fs.writeFileSync(filename, source);
    fs.symlinkSync(filename, entryAlias, 'file');
    let reads = 0;

    try {
      assert.throws(
        () =>
          load(parseSource(source, entryAlias), {
            lex,
            parse,
            basedir,
            resolve: () => filename,
            read(file) {
              reads++;
              return fs.readFileSync(file);
            },
          }),
        (err) => err.code === 'PUGNEUM:CIRCULAR_DEPENDENCY',
      );
      assert.equal(reads, 0);
    } finally {
      fs.rmSync(basedir, {recursive: true, force: true});
    }
  });

  test('diamond dependency: same file loaded via both branches', () => {
    // diamond-parent includes diamond-a and diamond-b, both of which include
    // diamond-shared. diamond-shared should load fine from both branches and
    // carry a populated file.ast on each (de-dup is NOT applied to a diamond).
    var filename = __dirname + '/diamond-parent.pg';
    var source = fs.readFileSync(filename, 'utf8');
    var ast = parseSource(source, filename);
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
  test('a build cache reads and parses a shared dependency once', () => {
    const dependencyCache = new Map();
    const sharedPath = '/virtual/shared.pg';
    let reads = 0;
    let lexes = 0;
    let parses = 0;
    const firstWarnings = [];
    const secondWarnings = [];
    const dependencyWarning = {
      code: 'PUGNEUM:CACHED_DEPENDENCY_WARNING',
      message: '/virtual/shared.pg:1:1\n\nshared warning',
      filename: sharedPath,
      line: 1,
      column: 1,
    };
    const options = {
      dependencyCache,
      resolve() {
        return sharedPath;
      },
      canonicalize(filename) {
        return filename;
      },
      read() {
        reads++;
        return Buffer.from('p shared');
      },
      lex(source, nestedOptions) {
        lexes++;
        nestedOptions.warnings.push(dependencyWarning);
        return lex(source, nestedOptions);
      },
      parse(tokens, nestedOptions) {
        parses++;
        return parse(tokens, nestedOptions);
      },
    };

    const first = load.loadOwned(
      parseSource('include shared.pg', '/virtual/one.pg'),
      Object.assign({}, options, {warnings: firstWarnings}),
    );
    const second = load.loadOwned(
      parseSource('include shared.pg', '/virtual/two.pg'),
      Object.assign({}, options, {warnings: secondWarnings}),
    );
    const firstFile = findNode(first, 'Include').file;
    const secondFile = findNode(second, 'Include').file;

    assert.strictEqual(reads, 1);
    assert.strictEqual(lexes, 1);
    assert.strictEqual(parses, 1);
    assert.deepStrictEqual(firstWarnings, [dependencyWarning]);
    assert.deepStrictEqual(secondWarnings, [dependencyWarning]);
    assert.notStrictEqual(firstWarnings[0], secondWarnings[0]);
    assert.notStrictEqual(firstFile.raw, secondFile.raw);
    assert.notStrictEqual(firstFile.ast, secondFile.ast);
    findNode(firstFile.ast, 'Text').val = 'changed';
    assert.strictEqual(findNode(secondFile.ast, 'Text').val, 'shared');
  });

  test('a build cache keeps parses from different mixin contexts separate', () => {
    const dependencyCache = new Map();
    const sharedPath = '/virtual/shared.pg';
    const contexts = [];
    let reads = 0;
    let lexes = 0;
    let parses = 0;
    const source = [
      'include shared.pg',
      'mixin wrapper()',
      '  include shared.pg',
    ].join('\n');

    load.loadOwned(parseSource(source, '/virtual/entry.pg'), {
      dependencyCache,
      warnings: [],
      resolve() {
        return sharedPath;
      },
      canonicalize(filename) {
        return filename;
      },
      read() {
        reads++;
        return Buffer.from('p shared');
      },
      lex(nestedSource, nestedOptions) {
        lexes++;
        return lex(nestedSource, nestedOptions);
      },
      parse(tokens, nestedOptions) {
        parses++;
        contexts.push(nestedOptions.mixinContext.slice());
        return parse(tokens, nestedOptions);
      },
    });

    assert.strictEqual(reads, 1, 'raw bytes are canonical-path cached');
    assert.strictEqual(lexes, 2, 'each lexical context is parsed once');
    assert.strictEqual(parses, 2, 'each lexical context is parsed once');
    assert.deepStrictEqual(contexts, [[], ['def']]);
  });

  test('custom resolve return value drives resolution', () => {
    // Point the include at a name that does not exist on disk and have the
    // custom resolver redirect it to a real file, proving the loader uses the
    // resolver's return value (not a default fallback).
    var filename = __dirname + '/test.pg';
    var ast = parseSource('include does-not-exist.pg', filename);
    var customResolveCalled = false;
    var customResolve = function (file, source, opts) {
      customResolveCalled = true;
      assert.equal(file, 'does-not-exist.pg');
      assert.equal(source, filename);
      assert.equal(opts.lex, lex);
      assert.equal(opts.parse, parse);
      return path.join(__dirname, 'bing.pg');
    };
    var loaded = load(ast, {lex, parse, resolve: customResolve});
    assert.ok(customResolveCalled, 'custom resolve was called');

    var resolvedPath = findNode(loaded, 'Include').file.fullPath;
    assert.ok(
      /bing\.pg$/.test(resolvedPath),
      'loader used the custom resolver return value: ' + resolvedPath,
    );
  });

  test('custom read return value flows into the loaded AST', () => {
    var filename = __dirname + '/test.pg';
    var ast = parseSource('include other.pg', filename);
    var readCalled = false;
    var customRead = function (file, opts) {
      readCalled = true;
      assert.equal(file, path.join(__dirname, 'other.pg'));
      assert.equal(opts.lex, lex);
      assert.equal(opts.parse, parse);
      return Buffer.from('p hello-from-custom-read');
    };
    var loaded = load(ast, {lex, parse, read: customRead});
    assert.ok(readCalled, 'custom read was called');

    // The buffer content must flow through raw.toString('utf8') into lex/parse,
    // producing a `p` tag with the custom text.
    assert.equal(findNode(loaded, 'Text').val, 'hello-from-custom-read');
  });

  for (const [label, thrown] of [
    ['null', null],
    ['undefined', undefined],
    ['number', 42],
    ['string', 'resolver stopped'],
    ['symbol', Symbol('resolver stopped')],
  ]) {
    for (const hook of ['resolve', 'read']) {
      test(`${hook} normalizes a thrown ${label}`, () => {
        const filename = path.join(__dirname, 'hook-error.pg');
        const source = 'include child.pg';
        const options = {
          lex,
          parse,
          filename,
          source,
          read: () => Buffer.from('p child'),
        };
        options[hook] = () => {
          throw thrown;
        };

        assert.throws(
          () => load(parseSource(source, filename), options),
          (err) => {
            assert.equal(err.code, 'PUGNEUM:LOAD_ERROR');
            assert.equal(err.filename, filename);
            assert.equal(err.line, 1);
            assert.match(
              err.msg,
              new RegExp(String(thrown).replace(/[()]/g, '\\$&')),
            );
            assert.ok(Object.hasOwn(err, 'cause'));
            assert.strictEqual(err.cause, thrown);
            return true;
          },
        );
      });
    }
  }

  test('preserves a custom PUGNEUM code and original cause', () => {
    const filename = path.join(__dirname, 'hook-error.pg');
    const source = 'include child.pg';
    const cause = Object.assign(new Error('generic message'), {
      code: 'PUGNEUM:CUSTOM_RESOLVE_FAILURE',
      msg: 'specific resolver detail',
    });

    assert.throws(
      () =>
        load(parseSource(source, filename), {
          lex,
          parse,
          filename,
          source,
          resolve() {
            throw cause;
          },
        }),
      (err) => {
        assert.equal(err.code, 'PUGNEUM:CUSTOM_RESOLVE_FAILURE');
        assert.equal(err.msg, 'specific resolver detail');
        assert.strictEqual(err.cause, cause);
        return true;
      },
    );
  });

  test('rejects invalid resolver and reader results at the hook boundary', () => {
    const filename = path.join(__dirname, 'hook-result.pg');
    const source = 'include child.pg';
    const ast = parseSource(source, filename);

    assert.throws(
      () => load(ast, {lex, parse, resolve: () => null}),
      (err) =>
        err.code === 'PUGNEUM:LOAD_ERROR' &&
        /resolve must return a non-empty string/.test(err.msg),
    );
    assert.throws(
      () => load(ast, {lex, parse, read: () => ({text: 'p child'})}),
      (err) =>
        err.code === 'PUGNEUM:LOAD_ERROR' &&
        /read must return a Buffer, Uint8Array, or string/.test(err.msg),
    );
  });
});

describe('binary contract and idempotency', () => {
  test('default read populates file.raw as a Buffer of the file bytes', () => {
    // The filterer hands file.raw to binary filters, so it must be genuine
    // bytes, not a UTF-8-decoded string.
    var filename = __dirname + '/test.pg';
    var ast = parseSource('include bing.pg', filename);
    var loaded = load(ast, {lex, parse});
    var raw = findNode(loaded, 'Include').file.raw;
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
    var ast = parseSource('include blob.bin', filename);
    var loaded = load(ast, {lex, parse, read: () => bytes});
    var raw = findNode(loaded, 'RawInclude').file.raw;
    assert.ok(Buffer.isBuffer(raw), 'file.raw is a Buffer');
    assert.deepEqual([...raw], [0xff, 0xfe, 0x00, 0x41]);
  });

  for (const [kind, input] of [
    ['string', 'snowman: ☃'],
    ['Uint8Array', new Uint8Array(Buffer.from('snowman: ☃'))],
  ]) {
    test(`normalizes a ${kind} read result to exact bytes and text`, () => {
      const filename = path.join(__dirname, 'entry.pg');
      const loaded = load(parseSource('include value.txt', filename), {
        lex,
        parse,
        read: () => input,
      });
      const file = findNode(loaded, 'RawInclude').file;

      assert.ok(Buffer.isBuffer(file.raw));
      assert.equal(file.raw.toString('utf8'), 'snowman: ☃');
      assert.equal(file.str, 'snowman: ☃');
    });
  }

  test('a filtered raw include decodes only when its text view is read', () => {
    const filename = path.join(__dirname, 'entry.pg');
    const source = 'include:binary blob.bin';
    const sources = Object.create(null);
    const bytes = Buffer.from('binary payload');
    let decodes = 0;
    Object.defineProperty(bytes, 'toString', {
      value(encoding) {
        decodes++;
        return Buffer.prototype.toString.call(this, encoding);
      },
    });

    const loaded = load(parseSource(source, filename), {
      lex,
      parse,
      filename,
      source,
      sources,
      read: () => bytes,
    });
    const file = findNode(loaded, 'RawInclude').file;

    assert.strictEqual(file.raw, bytes);
    assert.equal(decodes, 0);
    assert.equal(Object.hasOwn(sources, file.fullPath), false);
    assert.equal(
      typeof Object.getOwnPropertyDescriptor(file, 'str').get,
      'function',
    );

    assert.equal(file.str, 'binary payload');
    assert.equal(decodes, 1);
    assert.equal(sources[file.fullPath], 'binary payload');
    assert.equal(
      Object.getOwnPropertyDescriptor(file, 'str').value,
      'binary payload',
    );
  });

  test('re-loading an already-loaded AST preserves Buffer file.raw', () => {
    // load() clones its input; a previously-loaded Buffer must not survive the
    // clone as a Uint8Array (which would break .toString('utf8')). The loader
    // re-normalizes raw to a Buffer, so a double-load round-trips cleanly.
    var filename = __dirname + '/test.pg';
    var ast = parseSource('include bing.pg', filename);
    var once = load(ast, {lex, parse});
    var twice = load(once, {lex, parse});
    var raw = findNode(twice, 'Include').file.raw;
    assert.ok(Buffer.isBuffer(raw), 'file.raw is still a Buffer after re-load');
    assert.equal(
      raw.toString('utf8'),
      fs.readFileSync(__dirname + '/bing.pg', 'utf8'),
    );
  });
});

describe('recursion depth limit', () => {
  test('depth zero rejects the first structured edge before hooks or sources', () => {
    const filename = path.join(__dirname, 'entry.pg');
    const source = 'include child.pg';
    const sources = Object.create(null);
    let resolves = 0;
    let reads = 0;

    assert.throws(
      () =>
        load(parseSource(source, filename), {
          lex,
          parse,
          filename,
          source,
          sources,
          maxLoadDepth: 0,
          resolve() {
            resolves++;
            return '/virtual/child.pg';
          },
          read() {
            reads++;
            return Buffer.from('p child');
          },
        }),
      (err) =>
        err.code === 'PUGNEUM:LOAD_DEPTH_EXCEEDED' &&
        /maximum depth of 0/.test(err.msg),
    );
    assert.equal(resolves, 0);
    assert.equal(reads, 0);
    assert.deepEqual(Object.keys(sources), [filename]);
  });

  test('deep non-cyclic include chain throws coded LOAD_DEPTH_EXCEEDED', () => {
    // A long but non-cyclic include chain must abort with a coded PUGNEUM
    // error (well below the native stack ceiling), not an uncatchable
    // RangeError. A custom resolve/read synthesizes the chain in memory.
    var filename = __dirname + '/test.pg';
    var ast = parseSource('include step-0.pg', filename);
    var resolves = 0;
    var reads = 0;
    var resolve = (file) => {
      resolves++;
      return '/virtual/' + file;
    };
    var read = (full) => {
      reads++;
      var m = /step-(\d+)\.pg$/.exec(full);
      var n = m ? parseInt(m[1], 10) : 0;
      return Buffer.from('p step ' + n + '\ninclude step-' + (n + 1) + '.pg');
    };
    assert.throws(
      () => load(ast, {lex, parse, resolve, read, maxLoadDepth: 16}),
      (err) =>
        err.code === 'PUGNEUM:LOAD_DEPTH_EXCEEDED' &&
        /maximum depth of 16/.test(err.msg),
    );
    assert.equal(resolves, 16);
    assert.equal(reads, 16);
  });
});

describe('canonical identity work', () => {
  test('virtual custom resolvers do not probe the filesystem', () => {
    const originalRealpath = fs.realpathSync;
    fs.realpathSync = () => {
      throw new Error('unexpected realpath');
    };
    try {
      const filename = '/virtual/entry.pg';
      const source = 'include child.pg';
      const loaded = load(parseSource(source, filename), {
        lex,
        parse,
        resolve: (file) => '/virtual/' + file,
        read: () => Buffer.from('p virtual'),
      });
      assert.equal(findNode(loaded, 'Text').val, 'virtual');
    } finally {
      fs.realpathSync = originalRealpath;
    }
  });

  test('default resolution caches entry, root, and repeated target realpaths', () => {
    const originalRealpath = fs.realpathSync;
    let realpaths = 0;
    fs.realpathSync = function (...args) {
      realpaths++;
      return originalRealpath.apply(this, args);
    };
    try {
      const filename = path.join(__dirname, 'foo.pg');
      const source = 'include bing.pg\ninclude bing.pg';
      load(parseSource(source, filename), {
        lex,
        parse,
        basedir: __dirname,
      });
      assert.equal(realpaths, 3);
    } finally {
      fs.realpathSync = originalRealpath;
    }
  });

  test('a custom canonicalizer can identify virtual aliases', () => {
    const filename = '/virtual/entry.pg';
    const source = 'include alias.pg';
    let reads = 0;

    assert.throws(
      () =>
        load(parseSource(source, filename), {
          lex,
          parse,
          resolve: () => '/virtual/alias.pg',
          canonicalize: () => '/virtual/document.pg',
          read() {
            reads++;
            return Buffer.from('p unreachable');
          },
        }),
      (err) => err.code === 'PUGNEUM:CIRCULAR_DEPENDENCY',
    );
    assert.equal(reads, 0);
  });
});
