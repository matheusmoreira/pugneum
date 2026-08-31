const assert = require('node:assert/strict');
const {describe, test} = require('node:test');
const {execFileSync, spawnSync} = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const htmlparser2 = require('htmlparser2');

const DomUtils = htmlparser2.DomUtils;

const CLI = path.join(__dirname, '..', 'cli.js');
const NO_FEEDS = Symbol('no feeds configuration');

function childEnvironment(overrides) {
  return Object.assign({}, process.env, {HOME: os.tmpdir()}, overrides || {});
}

function run(args, opts) {
  return execFileSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    cwd: opts && opts.cwd,
    env: childEnvironment(opts && opts.env),
    timeout: 10000,
  });
}

function spawnCli(args, opts) {
  const nodeArgs = [];
  if (opts && opts.preload) {
    nodeArgs.push('--require', opts.preload);
  }
  nodeArgs.push(CLI, ...args);
  return spawnSync(process.execPath, nodeArgs, {
    encoding: 'utf8',
    cwd: opts && opts.cwd,
    env: childEnvironment(opts && opts.env),
    timeout: (opts && opts.timeout) || 10000,
  });
}

function runExpectFail(args, opts) {
  try {
    run(args, opts);
    throw new Error('Expected CLI to exit non-zero');
  } catch (err) {
    if (err.status == null) throw err;
    return {status: err.status, stderr: err.stderr, stdout: err.stdout};
  }
}

function makeTemporaryDirectory(t, prefix = 'pg-cli-') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  return directory;
}

function writeConfiguration(directory, overrides) {
  const config = Object.assign(
    {inputDirectory: 'src', outputDirectory: 'out'},
    overrides,
  );
  fs.writeFileSync(
    path.join(directory, 'pugneum.json'),
    JSON.stringify(config),
  );
}

function makeSymlinkOrSkip(t, target, link, type) {
  try {
    const platformType =
      process.platform === 'win32' && type === 'dir' ? 'junction' : type;
    fs.symlinkSync(target, link, platformType);
    return true;
  } catch (error) {
    if (['EACCES', 'ENOTSUP', 'EPERM'].includes(error.code)) {
      t.skip(`symlinks are unavailable on this runner (${error.code})`);
      return false;
    }
    throw error;
  }
}

function makeHardLinkOrSkip(t, target, link) {
  try {
    fs.linkSync(target, link);
    return true;
  } catch (error) {
    if (['EACCES', 'ENOTSUP', 'EPERM'].includes(error.code)) {
      t.skip(`hard links are unavailable on this runner (${error.code})`);
      return false;
    }
    throw error;
  }
}

function makeFeedProject(t, feeds = NO_FEEDS, options = {}) {
  const tmp = makeTemporaryDirectory(t, 'pg-cli-feed-');
  const sourceDirectory = path.join(tmp, 'src');
  const outputDirectory = path.join(tmp, 'out');
  fs.mkdirSync(path.join(sourceDirectory, 'articles'), {recursive: true});
  fs.mkdirSync(outputDirectory);

  fs.writeFileSync(
    path.join(sourceDirectory, 'index.pg'),
    [
      'doctype html',
      'html(lang="en")',
      '  head',
      '    base(href="https://example.test/")',
      '    title Example Journal',
      '    meta(name="description" content="Example description")',
      '    meta(name="author" content="Example Author")',
      '  body',
      '    main',
      '      article(data-published-at="2026-01-02")',
      '        a(href="articles/post.html") First Post',
    ].join('\n'),
  );

  const article = [
    'doctype html',
    'html(lang="en")',
    '  head',
    '    title First Post',
    '    meta(name="description" content="Post summary")',
    '    meta(name="author" content="Example Author")',
    '  body',
    '    article',
    '      p Feed body',
  ];
  if (options.warning) {
    article.push('      a(href=‘/warning’) warning link');
  }
  fs.writeFileSync(
    path.join(sourceDirectory, 'articles', 'post.pg'),
    article.join('\n'),
  );

  const config = {};
  if (feeds !== NO_FEEDS) {
    config.feeds = feeds;
  }
  writeConfiguration(tmp, config);

  return {tmp, outputDirectory};
}

function writeFeedResolutionBlocker(directory) {
  const preload = path.join(directory, 'block-pugneum-feed.cjs');
  fs.writeFileSync(
    preload,
    [
      "const Module = require('node:module');",
      'const originalResolveFilename = Module._resolveFilename;',
      'Module._resolveFilename = function (request) {',
      "  if (request === 'pugneum-feed') {",
      '    const error = new Error("Cannot find module \'pugneum-feed\'");',
      "    error.code = 'MODULE_NOT_FOUND';",
      '    throw error;',
      '  }',
      '  return Reflect.apply(originalResolveFilename, this, arguments);',
      '};',
    ].join('\n'),
  );
  return preload;
}

function writeFeedLoadFailure(directory) {
  const preload = path.join(directory, 'break-pugneum-feed.cjs');
  fs.writeFileSync(
    preload,
    [
      "const Module = require('node:module');",
      'const originalLoad = Module._load;',
      'Module._load = function (request) {',
      "  if (request === 'pugneum-feed') {",
      '    const error = new Error("Cannot find module \'feed-transitive-dependency\'");',
      "    error.code = 'MODULE_NOT_FOUND';",
      '    throw error;',
      '  }',
      '  return Reflect.apply(originalLoad, this, arguments);',
      '};',
    ].join('\n'),
  );
  return preload;
}

function writeDescendingDirectoryOrder(directory) {
  const preload = path.join(directory, 'reverse-directory-order.cjs');
  fs.writeFileSync(
    preload,
    [
      "const fs = require('node:fs');",
      'const originalReadDirectory = fs.readdirSync;',
      'fs.readdirSync = function (directory, options) {',
      '  const entries = Reflect.apply(originalReadDirectory, this, arguments);',
      '  if (options && options.withFileTypes && /[/\\\\]src$/.test(directory)) {',
      '    entries.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));',
      '  }',
      '  return entries;',
      '};',
    ].join('\n'),
  );
  return preload;
}

function writeAscendingDirectoryOrder(directory) {
  const preload = path.join(directory, 'ascending-directory-order.cjs');
  fs.writeFileSync(
    preload,
    [
      "const fs = require('node:fs');",
      'const originalReadDirectory = fs.readdirSync;',
      'fs.readdirSync = function (directory, options) {',
      '  const entries = Reflect.apply(originalReadDirectory, this, arguments);',
      '  if (options && options.withFileTypes && /[/\\\\]src$/.test(directory)) {',
      '    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));',
      '  }',
      '  return entries;',
      '};',
    ].join('\n'),
  );
  return preload;
}

function writeAliasedDirectoryIdentity(directory) {
  const preload = path.join(directory, 'alias-directory-identity.cjs');
  fs.writeFileSync(
    preload,
    [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      'const originalLstat = fs.lstatSync;',
      'fs.lstatSync = function (filename) {',
      '  const stat = Reflect.apply(originalLstat, this, arguments);',
      '  const parent = path.basename(path.dirname(filename));',
      '  const name = path.basename(filename);',
      "  if (parent === 'src' && (name === 'a' || name === 'b')) {",
      '    return new Proxy(stat, {',
      '      get(target, property) {',
      "        if (property === 'dev') return 12345;",
      "        if (property === 'ino') return 67890;",
      '        const value = Reflect.get(target, property, target);',
      "        return typeof value === 'function' ? value.bind(target) : value;",
      '      },',
      '    });',
      '  }',
      '  return stat;',
      '};',
    ].join('\n'),
  );
  return preload;
}

function parseXmlFile(filename, expectedRoot) {
  const source = fs.readFileSync(filename, 'utf8');
  const document = htmlparser2.parseDocument(source, {xmlMode: true});
  const roots = document.children.filter((node) => node.type === 'tag');
  assert.strictEqual(roots.length, 1);
  assert.strictEqual(roots[0].name, expectedRoot);
  return {document, source};
}

function selfLink(document, elementName) {
  const links = DomUtils.getElementsByTagName(elementName, document);
  return links.find((element) => element.attribs.rel === 'self');
}

describe('CLI', () => {
  test('--help prints usage', () => {
    const out = run(['--help']);
    assert.match(out, /Usage: pugneum/);
  });

  test('--version prints version', () => {
    const pkg = require('../package.json');
    const out = run(['--version']);
    assert.strictEqual(out.trim(), pkg.version);
  });

  for (const arguments_ of [['--typo'], ['page.pg'], ['--help', '--typo']]) {
    test('rejects unsupported arguments ' + arguments_.join(' '), (t) => {
      const tmp = makeTemporaryDirectory(t);
      const result = runExpectFail(arguments_, {cwd: tmp});
      assert.strictEqual(result.status, 1);
      assert.match(result.stderr, /Unknown argument/);
      assert.ok(!fs.existsSync(path.join(tmp, 'out')));
    });
  }

  test('exits with error when pugneum.json is missing', (t) => {
    const tmp = makeTemporaryDirectory(t);
    const result = runExpectFail([], {cwd: tmp});
    assert.strictEqual(result.status, 2);
  });

  test('exits with error for invalid JSON', (t) => {
    const tmp = makeTemporaryDirectory(t);
    fs.writeFileSync(path.join(tmp, 'pugneum.json'), '{bad json');
    const result = runExpectFail([], {cwd: tmp});
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /Invalid JSON/);
  });

  test('exits with error for missing required fields', (t) => {
    const tmp = makeTemporaryDirectory(t);
    fs.writeFileSync(path.join(tmp, 'pugneum.json'), '{}');
    const result = runExpectFail([], {cwd: tmp});
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /inputDirectory.*outputDirectory/);
  });

  test('compiles .pg templates to HTML', (t) => {
    const tmp = makeTemporaryDirectory(t);
    fs.mkdirSync(path.join(tmp, 'src'));
    fs.mkdirSync(path.join(tmp, 'out'));
    fs.writeFileSync(path.join(tmp, 'src', 'page.pg'), 'p hello');
    writeConfiguration(tmp);
    run([], {cwd: tmp});
    const html = fs.readFileSync(path.join(tmp, 'out', 'page.html'), 'utf8');
    assert.strictEqual(html, '<p>hello</p>');
  });

  test('template errors exit with code 6', (t) => {
    const tmp = makeTemporaryDirectory(t);
    fs.mkdirSync(path.join(tmp, 'src'));
    fs.mkdirSync(path.join(tmp, 'out'));
    fs.writeFileSync(path.join(tmp, 'src', 'bad.pg'), 'div(>="x")');
    writeConfiguration(tmp);
    const result = runExpectFail([], {cwd: tmp});
    assert.strictEqual(result.status, 6);
  });

  test('defaults the include boundary to inputDirectory', (t) => {
    const tmp = makeTemporaryDirectory(t);
    fs.mkdirSync(path.join(tmp, 'src'));
    fs.mkdirSync(path.join(tmp, 'out'));
    fs.writeFileSync(path.join(tmp, 'secret.pg'), 'p secret');
    fs.writeFileSync(path.join(tmp, 'src', 'page.pg'), 'include ../secret.pg');
    // An omitted baseDirectory confines the build to inputDirectory. This keeps
    // a relative include from silently reading a sibling file outside the input
    // tree and reports the violation as a template error.
    writeConfiguration(tmp);
    const result = runExpectFail([], {cwd: tmp});
    assert.strictEqual(result.status, 6);
    assert.match(result.stderr, /escapes project root|PATH_ESCAPE/);
  });

  test('skips symlinks in input directory', (t) => {
    const tmp = makeTemporaryDirectory(t);
    fs.mkdirSync(path.join(tmp, 'src'));
    fs.mkdirSync(path.join(tmp, 'out'));
    fs.writeFileSync(path.join(tmp, 'src', 'real.pg'), 'p ok');
    if (
      !makeSymlinkOrSkip(
        t,
        path.join(tmp, 'src'),
        path.join(tmp, 'src', 'loop'),
        'dir',
      )
    ) {
      return;
    }
    writeConfiguration(tmp);
    run([], {cwd: tmp});
    const html = fs.readFileSync(path.join(tmp, 'out', 'real.html'), 'utf8');
    assert.strictEqual(html, '<p>ok</p>');
    assert.ok(!fs.existsSync(path.join(tmp, 'out', 'loop')));
  });

  test('processes templates in stable name order', (t) => {
    const tmp = makeTemporaryDirectory(t);
    fs.mkdirSync(path.join(tmp, 'src'));
    fs.mkdirSync(path.join(tmp, 'out'));
    fs.writeFileSync(path.join(tmp, 'src', 'a.pg'), 'div(>="x")');
    fs.writeFileSync(path.join(tmp, 'src', 'z.pg'), 'p rendered too early');
    writeConfiguration(tmp);
    const preload = writeDescendingDirectoryOrder(tmp);

    const result = spawnCli([], {cwd: tmp, preload});

    assert.strictEqual(result.status, 6);
    assert.match(result.stderr, /a\.pg/);
    assert.ok(!fs.existsSync(path.join(tmp, 'out', 'z.html')));
  });

  test('does not traverse a nested output directory as source', (t) => {
    const tmp = makeTemporaryDirectory(t);
    fs.mkdirSync(path.join(tmp, 'src', 'out'), {recursive: true});
    fs.writeFileSync(path.join(tmp, 'src', 'page.pg'), 'p page');
    fs.writeFileSync(path.join(tmp, 'src', 'out', 'stale.pg'), 'p stale');
    writeConfiguration(tmp, {outputDirectory: 'src/out'});

    run([], {cwd: tmp});

    assert.strictEqual(
      fs.readFileSync(path.join(tmp, 'src', 'out', 'page.html'), 'utf8'),
      '<p>page</p>',
    );
    assert.ok(!fs.existsSync(path.join(tmp, 'src', 'out', 'out')));
  });

  test('directory identity suppresses only active recursion cycles', (t) => {
    const tmp = makeTemporaryDirectory(t);
    fs.mkdirSync(path.join(tmp, 'src', 'a'), {recursive: true});
    fs.mkdirSync(path.join(tmp, 'src', 'b'));
    fs.mkdirSync(path.join(tmp, 'out'));
    fs.writeFileSync(path.join(tmp, 'src', 'a', 'one.pg'), 'p one');
    fs.writeFileSync(path.join(tmp, 'src', 'b', 'two.pg'), 'p two');
    writeConfiguration(tmp);
    const preload = writeAliasedDirectoryIdentity(tmp);

    run([], {cwd: tmp, preload});

    assert.strictEqual(
      fs.readFileSync(path.join(tmp, 'out', 'a', 'one.html'), 'utf8'),
      '<p>one</p>',
    );
    assert.strictEqual(
      fs.readFileSync(path.join(tmp, 'out', 'b', 'two.html'), 'utf8'),
      '<p>two</p>',
    );
  });

  test('rejects a FIFO page input without blocking', (t) => {
    if (process.platform === 'win32') {
      t.skip('Windows named pipes are not filesystem FIFO entries');
      return;
    }

    const tmp = makeTemporaryDirectory(t);
    fs.mkdirSync(path.join(tmp, 'src'));
    fs.mkdirSync(path.join(tmp, 'out'));
    const fifo = path.join(tmp, 'src', 'special.pg');
    const mkfifo = spawnSync('mkfifo', [fifo], {encoding: 'utf8'});
    if (mkfifo.error && mkfifo.error.code === 'ENOENT') {
      t.skip('mkfifo is unavailable on this runner');
      return;
    }
    assert.ifError(mkfifo.error);
    assert.strictEqual(mkfifo.status, 0, mkfifo.stderr);
    writeConfiguration(tmp);

    const result = spawnCli([], {cwd: tmp, timeout: 2000});

    assert.ifError(result.error);
    assert.strictEqual(result.status, 1);
    assert.match(
      result.stderr,
      /Input path escapes input directory or is not a regular file/,
    );
    assert.ok(!fs.existsSync(path.join(tmp, 'out', 'special.html')));
  });

  test('builds when the input directory itself is a symlink', (t) => {
    // Regression: the walk uses realpathSync(inputDirectory) while the per-file
    // relative path must use the same resolved base. Computing it against the
    // raw symlink name yields a ../-laden path that trips the output-escape
    // guard and aborts the whole build (exit 1, zero output).
    const tmp = makeTemporaryDirectory(t);
    fs.mkdirSync(path.join(tmp, 'realsrc'));
    fs.mkdirSync(path.join(tmp, 'realsrc', 'sub'));
    fs.mkdirSync(path.join(tmp, 'out'));
    fs.writeFileSync(path.join(tmp, 'realsrc', 'page.pg'), 'p hi');
    fs.writeFileSync(path.join(tmp, 'realsrc', 'sub', 'deep.pg'), 'p deep');
    // inputDirectory "src" is a symlink to the real content directory.
    if (
      !makeSymlinkOrSkip(
        t,
        path.join(tmp, 'realsrc'),
        path.join(tmp, 'src'),
        'dir',
      )
    ) {
      return;
    }
    writeConfiguration(tmp);
    run([], {cwd: tmp});
    assert.strictEqual(
      fs.readFileSync(path.join(tmp, 'out', 'page.html'), 'utf8'),
      '<p>hi</p>',
    );
    // Subdirectory structure is preserved under the resolved base, not
    // climbed out of the output tree.
    assert.strictEqual(
      fs.readFileSync(path.join(tmp, 'out', 'sub', 'deep.html'), 'utf8'),
      '<p>deep</p>',
    );
  });

  test('rejects pugneum.json that is JSON null', (t) => {
    // null parses as valid JSON; destructuring it used to throw an uncaught
    // TypeError (raw stack trace) instead of a clean INVALID_INPUT.
    const tmp = makeTemporaryDirectory(t);
    fs.writeFileSync(path.join(tmp, 'pugneum.json'), 'null');
    const result = runExpectFail([], {cwd: tmp});
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /must contain a JSON object/);
    assert.doesNotMatch(result.stderr, /TypeError/);
  });

  test('rejects non-string inputDirectory/outputDirectory', (t) => {
    // A non-string truthy value used to reach node:path and crash with an
    // uncaught ERR_INVALID_ARG_TYPE; now it is a clean INVALID_INPUT.
    const tmp = makeTemporaryDirectory(t);
    fs.mkdirSync(path.join(tmp, 'src'));
    fs.writeFileSync(
      path.join(tmp, 'pugneum.json'),
      JSON.stringify({inputDirectory: 'src', outputDirectory: ['out']}),
    );
    const result = runExpectFail([], {cwd: tmp});
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /must be strings/);
    assert.doesNotMatch(result.stderr, /TypeError/);
  });

  test('reports an existing file used as the output directory cleanly', (t) => {
    const tmp = makeTemporaryDirectory(t);
    fs.mkdirSync(path.join(tmp, 'src'));
    fs.writeFileSync(path.join(tmp, 'src', 'page.pg'), 'p page');
    fs.writeFileSync(path.join(tmp, 'out'), 'keep me');
    writeConfiguration(tmp);

    const result = runExpectFail([], {cwd: tmp});

    assert.strictEqual(result.status, 4);
    assert.match(result.stderr, /Expected directory/);
    assert.doesNotMatch(result.stderr, /\n\s+at /);
    assert.strictEqual(
      fs.readFileSync(path.join(tmp, 'out'), 'utf8'),
      'keep me',
    );
  });

  test('reports a circular output-directory symlink cleanly', (t) => {
    if (process.platform === 'win32') {
      t.skip('self-referential symlinks are not portable to Windows');
      return;
    }

    const tmp = makeTemporaryDirectory(t);
    fs.mkdirSync(path.join(tmp, 'src'));
    fs.writeFileSync(path.join(tmp, 'src', 'page.pg'), 'p page');
    if (!makeSymlinkOrSkip(t, 'loop', path.join(tmp, 'loop'), 'file')) {
      return;
    }
    writeConfiguration(tmp, {outputDirectory: 'loop'});

    const result = runExpectFail([], {cwd: tmp});

    assert.strictEqual(result.status, 4);
    assert.match(result.stderr, /Expected directory/);
    assert.doesNotMatch(result.stderr, /\n\s+at /);
  });

  test('output-escape guard is not tripped by a normal symlinked input dir', (t) => {
    // The guard must distinguish a legitimate symlinked input root (builds) from
    // a genuinely escaping output path. This pairs with the symlinked-input
    // build test above: the guard stays silent for valid layouts.
    const tmp = makeTemporaryDirectory(t);
    fs.mkdirSync(path.join(tmp, 'realsrc'));
    fs.mkdirSync(path.join(tmp, 'out'));
    fs.writeFileSync(path.join(tmp, 'realsrc', 'ok.pg'), 'p ok');
    if (
      !makeSymlinkOrSkip(
        t,
        path.join(tmp, 'realsrc'),
        path.join(tmp, 'content'),
        'dir',
      )
    ) {
      return;
    }
    writeConfiguration(tmp, {inputDirectory: 'content'});
    const result = spawnCli([], {cwd: tmp});
    assert.strictEqual(result.status, 0);
    assert.doesNotMatch(result.stderr, /escapes output directory/);
    assert.ok(fs.existsSync(path.join(tmp, 'out', 'ok.html')));
  });

  test('refuses to write through a symlinked output subdirectory', (t) => {
    // A pre-existing symlink as an intermediate output component must not let a
    // lexically-valid write land outside the output tree (CWE-59). The realpath
    // re-check on the created parent dir catches it.
    const tmp = makeTemporaryDirectory(t);
    fs.mkdirSync(path.join(tmp, 'src', 'sub'), {recursive: true});
    fs.mkdirSync(path.join(tmp, 'out'));
    fs.mkdirSync(path.join(tmp, 'secret'));
    fs.writeFileSync(path.join(tmp, 'src', 'sub', 'evil.pg'), 'p pwned');
    if (
      !makeSymlinkOrSkip(
        t,
        path.join(tmp, 'secret'),
        path.join(tmp, 'out', 'sub'),
        'dir',
      )
    ) {
      return;
    }
    writeConfiguration(tmp);
    const result = runExpectFail([], {cwd: tmp});
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /escapes output directory/);
    // Nothing was written through the symlink.
    assert.ok(!fs.existsSync(path.join(tmp, 'secret', 'evil.html')));
  });

  test('refuses to clobber a file through a symlinked output filename', (t) => {
    // The output filename itself being a symlink would truncate the symlink's
    // target outside the tree; the lstat check on the final component refuses.
    const tmp = makeTemporaryDirectory(t);
    fs.mkdirSync(path.join(tmp, 'src'));
    fs.mkdirSync(path.join(tmp, 'out'));
    fs.writeFileSync(path.join(tmp, 'src', 'target.pg'), 'p overwrite');
    fs.writeFileSync(path.join(tmp, 'important.conf'), 'ORIGINAL SECRET');
    if (
      !makeSymlinkOrSkip(
        t,
        path.join(tmp, 'important.conf'),
        path.join(tmp, 'out', 'target.html'),
        'file',
      )
    ) {
      return;
    }
    writeConfiguration(tmp);
    const result = runExpectFail([], {cwd: tmp});
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /escapes output directory/);
    // The target file outside the tree was not clobbered.
    assert.strictEqual(
      fs.readFileSync(path.join(tmp, 'important.conf'), 'utf8'),
      'ORIGINAL SECRET',
    );
  });

  test('atomically replaces a hard-linked output name without mutating its other name', (t) => {
    const tmp = makeTemporaryDirectory(t);
    fs.mkdirSync(path.join(tmp, 'src'));
    fs.mkdirSync(path.join(tmp, 'out'));
    fs.writeFileSync(path.join(tmp, 'src', 'target.pg'), 'p replacement');
    fs.writeFileSync(path.join(tmp, 'important.conf'), 'ORIGINAL SECRET');
    if (
      !makeHardLinkOrSkip(
        t,
        path.join(tmp, 'important.conf'),
        path.join(tmp, 'out', 'target.html'),
      )
    ) {
      return;
    }
    writeConfiguration(tmp);

    run([], {cwd: tmp});

    assert.strictEqual(
      fs.readFileSync(path.join(tmp, 'important.conf'), 'utf8'),
      'ORIGINAL SECRET',
    );
    assert.strictEqual(
      fs.readFileSync(path.join(tmp, 'out', 'target.html'), 'utf8'),
      '<p>replacement</p>',
    );
    assert.notStrictEqual(
      fs.statSync(path.join(tmp, 'important.conf')).ino,
      fs.statSync(path.join(tmp, 'out', 'target.html')).ino,
    );
  });

  test('rejects a FIFO output without blocking', (t) => {
    if (process.platform === 'win32') {
      t.skip('Windows named pipes are not filesystem FIFO entries');
      return;
    }

    const tmp = makeTemporaryDirectory(t);
    fs.mkdirSync(path.join(tmp, 'src'));
    fs.mkdirSync(path.join(tmp, 'out'));
    fs.writeFileSync(path.join(tmp, 'src', 'special.pg'), 'p replacement');
    const fifo = path.join(tmp, 'out', 'special.html');
    const mkfifo = spawnSync('mkfifo', [fifo], {encoding: 'utf8'});
    if (mkfifo.error && mkfifo.error.code === 'ENOENT') {
      t.skip('mkfifo is unavailable on this runner');
      return;
    }
    assert.ifError(mkfifo.error);
    assert.strictEqual(mkfifo.status, 0, mkfifo.stderr);
    writeConfiguration(tmp);

    const result = spawnCli([], {cwd: tmp, timeout: 2000});

    assert.ifError(result.error);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /Output path escapes output directory/);
    assert.ok(fs.lstatSync(fifo).isFIFO());
  });

  test('a feed-generation error exits cleanly with the feed exit code', (t) => {
    // With feeds configured and pugneum-feed present, a genuine feed failure
    // (here: index page has no base URL) must surface as a clean, coded message
    // with a dedicated exit code, not a raw rethrow. Before the fix the error
    // was rethrown into the generic handler.
    const tmp = makeTemporaryDirectory(t);
    fs.mkdirSync(path.join(tmp, 'src'));
    fs.mkdirSync(path.join(tmp, 'out'));
    // index.pg renders an index.html with NO <base href>, so the feed
    // generator cannot determine a site URL and throws FEED_MISSING_URL.
    fs.writeFileSync(path.join(tmp, 'src', 'index.pg'), 'p home');
    writeConfiguration(tmp, {feeds: {}});
    const result = runExpectFail([], {cwd: tmp});
    // Dedicated feed exit code (7), not the generic template-error code (6).
    assert.strictEqual(result.status, 7);
    assert.doesNotMatch(result.stderr, /at Object\.<anonymous>/);
    assert.doesNotMatch(result.stderr, /\n\s+at /);
  });

  test('builds HTML without resolving the optional feed package when feeds are absent', (t) => {
    const project = makeFeedProject(t);
    const result = spawnCli([], {cwd: project.tmp});
    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, '');
    assert.ok(fs.existsSync(path.join(project.outputDirectory, 'index.html')));
    assert.ok(
      fs.existsSync(
        path.join(project.outputDirectory, 'articles', 'post.html'),
      ),
    );
    assert.ok(!fs.existsSync(path.join(project.outputDirectory, 'atom.xml')));
    assert.ok(!fs.existsSync(path.join(project.outputDirectory, 'rss.xml')));
  });

  test('feeds.enabled=false short-circuits optional package resolution', (t) => {
    const project = makeFeedProject(t, {enabled: false});
    const preload = writeFeedResolutionBlocker(project.tmp);
    const result = spawnCli([], {cwd: project.tmp, preload});
    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, '');
    assert.ok(fs.existsSync(path.join(project.outputDirectory, 'index.html')));
    assert.ok(!fs.existsSync(path.join(project.outputDirectory, 'atom.xml')));
    assert.ok(!fs.existsSync(path.join(project.outputDirectory, 'rss.xml')));
  });

  test('warns and preserves HTML when enabled feeds lack the optional package', (t) => {
    const project = makeFeedProject(t, {url: 'https://example.test/'});
    const preload = writeFeedResolutionBlocker(project.tmp);
    const result = spawnCli([], {cwd: project.tmp, preload});
    assert.strictEqual(result.status, 0);
    assert.match(result.stderr, /pugneum-feed is not installed/);
    assert.strictEqual(
      (result.stderr.match(/pugneum-feed is not installed/g) || []).length,
      1,
    );
    assert.ok(fs.existsSync(path.join(project.outputDirectory, 'index.html')));
    assert.ok(
      fs.existsSync(
        path.join(project.outputDirectory, 'articles', 'post.html'),
      ),
    );
    assert.ok(!fs.existsSync(path.join(project.outputDirectory, 'atom.xml')));
    assert.ok(!fs.existsSync(path.join(project.outputDirectory, 'rss.xml')));
  });

  test('reports an installed feed package load failure as a feed error', (t) => {
    const project = makeFeedProject(t, {url: 'https://example.test/'});
    const preload = writeFeedLoadFailure(project.tmp);
    const result = spawnCli([], {cwd: project.tmp, preload});

    assert.strictEqual(result.status, 7);
    assert.match(
      result.stderr,
      /Feed generation failed: Cannot find module 'feed-transitive-dependency'/,
    );
    assert.doesNotMatch(result.stderr, /pugneum-feed is not installed/);
    assert.doesNotMatch(result.stderr, /\n\s+at /);
  });

  test('generates complete Atom and RSS feeds with default filenames', (t) => {
    const project = makeFeedProject(t, {url: 'https://example.test/'});
    const result = spawnCli([], {cwd: project.tmp});
    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, '');

    const atom = parseXmlFile(
      path.join(project.outputDirectory, 'atom.xml'),
      'feed',
    );
    const rss = parseXmlFile(
      path.join(project.outputDirectory, 'rss.xml'),
      'rss',
    );
    assert.strictEqual(
      selfLink(atom.document, 'link').attribs.href,
      'https://example.test/atom.xml',
    );
    assert.strictEqual(
      selfLink(rss.document, 'atom:link').attribs.href,
      'https://example.test/rss.xml',
    );
    assert.strictEqual(
      DomUtils.textContent(
        DomUtils.getElementsByTagName('content', atom.document)[0],
      ),
      '<p>Feed body</p>',
    );
    assert.strictEqual(
      DomUtils.textContent(
        DomUtils.getElementsByTagName('content:encoded', rss.document)[0],
      ),
      '<p>Feed body</p>',
    );
    assert.match(atom.source, /https:\/\/example\.test\/articles\/post\.html/);
    assert.match(rss.source, /https:\/\/example\.test\/articles\/post\.html/);
  });

  test('uses custom feed filenames in output paths and self links', (t) => {
    const project = makeFeedProject(t, {
      url: 'https://example.test/',
      atom: 'news.atom',
      rss: 'news.rss',
    });
    const result = spawnCli([], {cwd: project.tmp});
    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, '');

    const atom = parseXmlFile(
      path.join(project.outputDirectory, 'news.atom'),
      'feed',
    );
    const rss = parseXmlFile(
      path.join(project.outputDirectory, 'news.rss'),
      'rss',
    );
    assert.strictEqual(
      selfLink(atom.document, 'link').attribs.href,
      'https://example.test/news.atom',
    );
    assert.strictEqual(
      selfLink(rss.document, 'atom:link').attribs.href,
      'https://example.test/news.rss',
    );
    assert.ok(!fs.existsSync(path.join(project.outputDirectory, 'atom.xml')));
    assert.ok(!fs.existsSync(path.join(project.outputDirectory, 'rss.xml')));
  });

  test('non-fatal template warnings do not prevent feed generation', (t) => {
    const project = makeFeedProject(
      t,
      {url: 'https://example.test/'},
      {warning: true},
    );
    const result = spawnCli([], {cwd: project.tmp});
    assert.strictEqual(result.status, 0);
    assert.match(result.stderr, /TYPOGRAPHIC_QUOTE_DELIMITER/);
    assert.strictEqual(
      (result.stderr.match(/TYPOGRAPHIC_QUOTE_DELIMITER/g) || []).length,
      1,
    );
    parseXmlFile(path.join(project.outputDirectory, 'atom.xml'), 'feed');
    parseXmlFile(path.join(project.outputDirectory, 'rss.xml'), 'rss');
    assert.ok(
      fs.existsSync(
        path.join(project.outputDirectory, 'articles', 'post.html'),
      ),
    );
  });

  test('warns once for a typographic quote in a shared layout but still builds', (t) => {
    const tmp = makeTemporaryDirectory(t);
    fs.mkdirSync(path.join(tmp, 'src'));
    fs.mkdirSync(path.join(tmp, 'src', 'pages'));
    fs.mkdirSync(path.join(tmp, 'out'));
    // Shared partial with a smart-quoted attribute, included by two pages.
    fs.writeFileSync(path.join(tmp, 'src', 'nav.pg'), 'a(href=‘/x’) link');
    fs.writeFileSync(
      path.join(tmp, 'src', 'pages', 'one.pg'),
      'include /nav.pg',
    );
    fs.writeFileSync(
      path.join(tmp, 'src', 'pages', 'two.pg'),
      'include /nav.pg',
    );
    writeConfiguration(tmp, {
      inputDirectory: 'src/pages',
      baseDirectory: 'src',
    });
    const result = spawnCli([], {cwd: tmp});
    // Warnings are non-fatal: the build succeeds.
    assert.strictEqual(result.status, 0);
    // Both pages built.
    assert.ok(fs.existsSync(path.join(tmp, 'out', 'one.html')));
    assert.ok(fs.existsSync(path.join(tmp, 'out', 'two.html')));
    // The warning is surfaced on stderr...
    assert.match(result.stderr, /TYPOGRAPHIC_QUOTE_DELIMITER/);
    // ...exactly once, despite two pages including the same partial.
    const count = (result.stderr.match(/TYPOGRAPHIC_QUOTE_DELIMITER/g) || [])
      .length;
    assert.strictEqual(count, 1);
  });

  test('emits earlier warnings when a later output boundary fails', (t) => {
    if (process.platform === 'win32') {
      t.skip('Windows named pipes are not filesystem FIFO entries');
      return;
    }

    const tmp = makeTemporaryDirectory(t);
    fs.mkdirSync(path.join(tmp, 'src'));
    fs.mkdirSync(path.join(tmp, 'out'));
    fs.writeFileSync(
      path.join(tmp, 'src', 'a.pg'),
      'a(href=‘/warning’) warning link',
    );
    fs.writeFileSync(path.join(tmp, 'src', 'z.pg'), 'p blocked');
    const fifo = path.join(tmp, 'out', 'z.html');
    const mkfifo = spawnSync('mkfifo', [fifo], {encoding: 'utf8'});
    if (mkfifo.error && mkfifo.error.code === 'ENOENT') {
      t.skip('mkfifo is unavailable on this runner');
      return;
    }
    assert.ifError(mkfifo.error);
    assert.strictEqual(mkfifo.status, 0, mkfifo.stderr);
    writeConfiguration(tmp);
    const preload = writeAscendingDirectoryOrder(tmp);

    const result = spawnCli([], {cwd: tmp, preload});

    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /TYPOGRAPHIC_QUOTE_DELIMITER/);
    assert.match(result.stderr, /Output path escapes output directory/);
    assert.doesNotMatch(result.stderr, /\n\s+at /);
  });

  test('clean templates produce no warning output', (t) => {
    const tmp = makeTemporaryDirectory(t);
    fs.mkdirSync(path.join(tmp, 'src'));
    fs.mkdirSync(path.join(tmp, 'out'));
    fs.writeFileSync(path.join(tmp, 'src', 'page.pg'), 'a(href="/x") link');
    writeConfiguration(tmp);
    const result = spawnCli([], {cwd: tmp});
    assert.strictEqual(result.status, 0);
    assert.doesNotMatch(result.stderr, /warning/);
  });

  test('does not warn about unused mixins defined in included library files', (t) => {
    const tmp = makeTemporaryDirectory(t);
    fs.mkdirSync(path.join(tmp, 'src'));
    fs.mkdirSync(path.join(tmp, 'src', 'pages'));
    fs.mkdirSync(path.join(tmp, 'out'));
    // Library mixin lives outside the input dir; the page includes it but
    // does not call it. That must not be flagged as unused.
    fs.writeFileSync(path.join(tmp, 'src', 'lib.pg'), 'mixin helper()\n  p x');
    fs.writeFileSync(
      path.join(tmp, 'src', 'pages', 'page.pg'),
      'include /lib.pg\np hello',
    );
    writeConfiguration(tmp, {
      inputDirectory: 'src/pages',
      baseDirectory: 'src',
    });
    const result = spawnCli([], {cwd: tmp});
    assert.strictEqual(result.status, 0);
    assert.doesNotMatch(result.stderr, /UNUSED_MIXIN/);
  });
});
