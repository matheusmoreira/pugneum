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

function makeFeedProject(feeds = NO_FEEDS, options = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-cli-feed-'));
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

  const config = {inputDirectory: 'src', outputDirectory: 'out'};
  if (feeds !== NO_FEEDS) {
    config.feeds = feeds;
  }
  fs.writeFileSync(path.join(tmp, 'pugneum.json'), JSON.stringify(config));

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

  test('exits with error when pugneum.json is missing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-cli-'));
    try {
      const result = runExpectFail([], {cwd: tmp});
      assert.strictEqual(result.status, 2);
    } finally {
      fs.rmSync(tmp, {recursive: true});
    }
  });

  test('exits with error for invalid JSON', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-cli-'));
    try {
      fs.writeFileSync(path.join(tmp, 'pugneum.json'), '{bad json');
      const result = runExpectFail([], {cwd: tmp});
      assert.strictEqual(result.status, 1);
      assert.match(result.stderr, /Invalid JSON/);
    } finally {
      fs.rmSync(tmp, {recursive: true});
    }
  });

  test('exits with error for missing required fields', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-cli-'));
    try {
      fs.writeFileSync(path.join(tmp, 'pugneum.json'), '{}');
      const result = runExpectFail([], {cwd: tmp});
      assert.strictEqual(result.status, 1);
      assert.match(result.stderr, /inputDirectory.*outputDirectory/);
    } finally {
      fs.rmSync(tmp, {recursive: true});
    }
  });

  test('compiles .pg templates to HTML', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-cli-'));
    try {
      fs.mkdirSync(path.join(tmp, 'src'));
      fs.mkdirSync(path.join(tmp, 'out'));
      fs.writeFileSync(path.join(tmp, 'src', 'page.pg'), 'p hello');
      fs.writeFileSync(
        path.join(tmp, 'pugneum.json'),
        JSON.stringify({inputDirectory: 'src', outputDirectory: 'out'}),
      );
      run([], {cwd: tmp});
      const html = fs.readFileSync(path.join(tmp, 'out', 'page.html'), 'utf8');
      assert.strictEqual(html, '<p>hello</p>');
    } finally {
      fs.rmSync(tmp, {recursive: true});
    }
  });

  test('template errors exit with code 6', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-cli-'));
    try {
      fs.mkdirSync(path.join(tmp, 'src'));
      fs.mkdirSync(path.join(tmp, 'out'));
      fs.writeFileSync(path.join(tmp, 'src', 'bad.pg'), 'div(>="x")');
      fs.writeFileSync(
        path.join(tmp, 'pugneum.json'),
        JSON.stringify({inputDirectory: 'src', outputDirectory: 'out'}),
      );
      const result = runExpectFail([], {cwd: tmp});
      assert.strictEqual(result.status, 6);
    } finally {
      fs.rmSync(tmp, {recursive: true});
    }
  });

  test('basedir defaults to inputDirectory: a relative include escaping it is denied (decision #1)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-cli-'));
    try {
      fs.mkdirSync(path.join(tmp, 'src'));
      fs.mkdirSync(path.join(tmp, 'out'));
      fs.writeFileSync(path.join(tmp, 'secret.pg'), 'p secret');
      fs.writeFileSync(
        path.join(tmp, 'src', 'page.pg'),
        'include ../secret.pg',
      );
      // No baseDirectory in config: the CLI defaults basedir to inputDirectory
      // (src), so `../secret.pg` escapes the build root and default-deny rejects
      // it (a template error, exit 6).
      fs.writeFileSync(
        path.join(tmp, 'pugneum.json'),
        JSON.stringify({inputDirectory: 'src', outputDirectory: 'out'}),
      );
      const result = runExpectFail([], {cwd: tmp});
      assert.strictEqual(result.status, 6);
      assert.match(result.stderr, /escapes project root|PATH_ESCAPE/);
    } finally {
      fs.rmSync(tmp, {recursive: true});
    }
  });

  test('skips symlinks in input directory', (t) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-cli-'));
    try {
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
      fs.writeFileSync(
        path.join(tmp, 'pugneum.json'),
        JSON.stringify({inputDirectory: 'src', outputDirectory: 'out'}),
      );
      run([], {cwd: tmp});
      const html = fs.readFileSync(path.join(tmp, 'out', 'real.html'), 'utf8');
      assert.strictEqual(html, '<p>ok</p>');
      assert.ok(!fs.existsSync(path.join(tmp, 'out', 'loop')));
    } finally {
      fs.rmSync(tmp, {recursive: true});
    }
  });

  test('rejects a FIFO page input without blocking', (t) => {
    if (process.platform === 'win32') {
      t.skip('Windows named pipes are not filesystem FIFO entries');
      return;
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-cli-'));
    try {
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
      fs.writeFileSync(
        path.join(tmp, 'pugneum.json'),
        JSON.stringify({inputDirectory: 'src', outputDirectory: 'out'}),
      );

      const result = spawnCli([], {cwd: tmp, timeout: 2000});

      assert.ifError(result.error);
      assert.strictEqual(result.status, 1);
      assert.match(
        result.stderr,
        /Input path escapes input directory or is not a regular file/,
      );
      assert.ok(!fs.existsSync(path.join(tmp, 'out', 'special.html')));
    } finally {
      fs.rmSync(tmp, {recursive: true});
    }
  });

  test('builds when the input directory itself is a symlink', (t) => {
    // Regression: the walk uses realpathSync(inputDirectory) while the per-file
    // relative path must use the same resolved base. Computing it against the
    // raw symlink name yields a ../-laden path that trips the output-escape
    // guard and aborts the whole build (exit 1, zero output).
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-cli-'));
    try {
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
      fs.writeFileSync(
        path.join(tmp, 'pugneum.json'),
        JSON.stringify({inputDirectory: 'src', outputDirectory: 'out'}),
      );
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
    } finally {
      fs.rmSync(tmp, {recursive: true});
    }
  });

  test('rejects pugneum.json that is JSON null', () => {
    // null parses as valid JSON; destructuring it used to throw an uncaught
    // TypeError (raw stack trace) instead of a clean INVALID_INPUT.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-cli-'));
    try {
      fs.writeFileSync(path.join(tmp, 'pugneum.json'), 'null');
      const result = runExpectFail([], {cwd: tmp});
      assert.strictEqual(result.status, 1);
      assert.match(result.stderr, /must contain a JSON object/);
      assert.doesNotMatch(result.stderr, /TypeError/);
    } finally {
      fs.rmSync(tmp, {recursive: true});
    }
  });

  test('rejects non-string inputDirectory/outputDirectory', () => {
    // A non-string truthy value used to reach node:path and crash with an
    // uncaught ERR_INVALID_ARG_TYPE; now it is a clean INVALID_INPUT.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-cli-'));
    try {
      fs.mkdirSync(path.join(tmp, 'src'));
      fs.writeFileSync(
        path.join(tmp, 'pugneum.json'),
        JSON.stringify({inputDirectory: 'src', outputDirectory: ['out']}),
      );
      const result = runExpectFail([], {cwd: tmp});
      assert.strictEqual(result.status, 1);
      assert.match(result.stderr, /must be strings/);
      assert.doesNotMatch(result.stderr, /TypeError/);
    } finally {
      fs.rmSync(tmp, {recursive: true});
    }
  });

  test('output-escape guard is not tripped by a normal symlinked input dir', (t) => {
    // The guard must distinguish a legitimate symlinked input root (builds) from
    // a genuinely escaping output path. This pairs with the symlinked-input
    // build test above: the guard stays silent for valid layouts.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-cli-'));
    try {
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
      fs.writeFileSync(
        path.join(tmp, 'pugneum.json'),
        JSON.stringify({inputDirectory: 'content', outputDirectory: 'out'}),
      );
      const result = spawnSync(process.execPath, [CLI], {
        encoding: 'utf8',
        cwd: tmp,
        env: Object.assign({}, process.env, {HOME: os.tmpdir()}),
        timeout: 10000,
      });
      assert.strictEqual(result.status, 0);
      assert.doesNotMatch(result.stderr, /escapes output directory/);
      assert.ok(fs.existsSync(path.join(tmp, 'out', 'ok.html')));
    } finally {
      fs.rmSync(tmp, {recursive: true});
    }
  });

  test('refuses to write through a symlinked output subdirectory', (t) => {
    // A pre-existing symlink as an intermediate output component must not let a
    // lexically-valid write land outside the output tree (CWE-59). The realpath
    // re-check on the created parent dir catches it.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-cli-'));
    try {
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
      fs.writeFileSync(
        path.join(tmp, 'pugneum.json'),
        JSON.stringify({inputDirectory: 'src', outputDirectory: 'out'}),
      );
      const result = runExpectFail([], {cwd: tmp});
      assert.strictEqual(result.status, 1);
      assert.match(result.stderr, /escapes output directory/);
      // Nothing was written through the symlink.
      assert.ok(!fs.existsSync(path.join(tmp, 'secret', 'evil.html')));
    } finally {
      fs.rmSync(tmp, {recursive: true});
    }
  });

  test('refuses to clobber a file through a symlinked output filename', (t) => {
    // The output filename itself being a symlink would truncate the symlink's
    // target outside the tree; the lstat check on the final component refuses.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-cli-'));
    try {
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
      fs.writeFileSync(
        path.join(tmp, 'pugneum.json'),
        JSON.stringify({inputDirectory: 'src', outputDirectory: 'out'}),
      );
      const result = runExpectFail([], {cwd: tmp});
      assert.strictEqual(result.status, 1);
      assert.match(result.stderr, /escapes output directory/);
      // The target file outside the tree was not clobbered.
      assert.strictEqual(
        fs.readFileSync(path.join(tmp, 'important.conf'), 'utf8'),
        'ORIGINAL SECRET',
      );
    } finally {
      fs.rmSync(tmp, {recursive: true});
    }
  });

  test('atomically replaces a hard-linked output name without mutating its other name', (t) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-cli-'));
    try {
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
      fs.writeFileSync(
        path.join(tmp, 'pugneum.json'),
        JSON.stringify({inputDirectory: 'src', outputDirectory: 'out'}),
      );

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
    } finally {
      fs.rmSync(tmp, {recursive: true});
    }
  });

  test('a feed-generation error exits cleanly with the feed exit code', () => {
    // With feeds configured and pugneum-feed present, a genuine feed failure
    // (here: index page has no base URL) must surface as a clean, coded message
    // with a dedicated exit code, not a raw rethrow. Before the fix the error
    // was rethrown into the generic handler.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-cli-'));
    try {
      fs.mkdirSync(path.join(tmp, 'src'));
      fs.mkdirSync(path.join(tmp, 'out'));
      // index.pg renders an index.html with NO <base href>, so the feed
      // generator cannot determine a site URL and throws FEED_MISSING_URL.
      fs.writeFileSync(path.join(tmp, 'src', 'index.pg'), 'p home');
      fs.writeFileSync(
        path.join(tmp, 'pugneum.json'),
        JSON.stringify({
          inputDirectory: 'src',
          outputDirectory: 'out',
          feeds: {},
        }),
      );
      const result = runExpectFail([], {cwd: tmp});
      // Dedicated feed exit code (7), not the generic template-error code (6).
      assert.strictEqual(result.status, 7);
      assert.doesNotMatch(result.stderr, /at Object\.<anonymous>/);
      assert.doesNotMatch(result.stderr, /\n\s+at /);
    } finally {
      fs.rmSync(tmp, {recursive: true});
    }
  });

  test('builds HTML without resolving the optional feed package when feeds are absent', () => {
    const project = makeFeedProject();
    try {
      const result = spawnCli([], {cwd: project.tmp});
      assert.strictEqual(result.status, 0);
      assert.strictEqual(result.stderr, '');
      assert.ok(
        fs.existsSync(path.join(project.outputDirectory, 'index.html')),
      );
      assert.ok(
        fs.existsSync(
          path.join(project.outputDirectory, 'articles', 'post.html'),
        ),
      );
      assert.ok(!fs.existsSync(path.join(project.outputDirectory, 'atom.xml')));
      assert.ok(!fs.existsSync(path.join(project.outputDirectory, 'rss.xml')));
    } finally {
      fs.rmSync(project.tmp, {recursive: true});
    }
  });

  test('feeds.enabled=false short-circuits optional package resolution', () => {
    const project = makeFeedProject({enabled: false});
    try {
      const preload = writeFeedResolutionBlocker(project.tmp);
      const result = spawnCli([], {cwd: project.tmp, preload});
      assert.strictEqual(result.status, 0);
      assert.strictEqual(result.stderr, '');
      assert.ok(
        fs.existsSync(path.join(project.outputDirectory, 'index.html')),
      );
      assert.ok(!fs.existsSync(path.join(project.outputDirectory, 'atom.xml')));
      assert.ok(!fs.existsSync(path.join(project.outputDirectory, 'rss.xml')));
    } finally {
      fs.rmSync(project.tmp, {recursive: true});
    }
  });

  test('warns and preserves HTML when enabled feeds lack the optional package', () => {
    const project = makeFeedProject({url: 'https://example.test/'});
    try {
      const preload = writeFeedResolutionBlocker(project.tmp);
      const result = spawnCli([], {cwd: project.tmp, preload});
      assert.strictEqual(result.status, 0);
      assert.match(result.stderr, /pugneum-feed is not installed/);
      assert.strictEqual(
        (result.stderr.match(/pugneum-feed is not installed/g) || []).length,
        1,
      );
      assert.ok(
        fs.existsSync(path.join(project.outputDirectory, 'index.html')),
      );
      assert.ok(
        fs.existsSync(
          path.join(project.outputDirectory, 'articles', 'post.html'),
        ),
      );
      assert.ok(!fs.existsSync(path.join(project.outputDirectory, 'atom.xml')));
      assert.ok(!fs.existsSync(path.join(project.outputDirectory, 'rss.xml')));
    } finally {
      fs.rmSync(project.tmp, {recursive: true});
    }
  });

  test('generates complete Atom and RSS feeds with default filenames', () => {
    const project = makeFeedProject({url: 'https://example.test/'});
    try {
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
      assert.match(
        atom.source,
        /https:\/\/example\.test\/articles\/post\.html/,
      );
      assert.match(rss.source, /https:\/\/example\.test\/articles\/post\.html/);
    } finally {
      fs.rmSync(project.tmp, {recursive: true});
    }
  });

  test('uses custom feed filenames in output paths and self links', () => {
    const project = makeFeedProject({
      url: 'https://example.test/',
      atom: 'news.atom',
      rss: 'news.rss',
    });
    try {
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
    } finally {
      fs.rmSync(project.tmp, {recursive: true});
    }
  });

  test('non-fatal template warnings do not prevent feed generation', () => {
    const project = makeFeedProject(
      {url: 'https://example.test/'},
      {warning: true},
    );
    try {
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
    } finally {
      fs.rmSync(project.tmp, {recursive: true});
    }
  });

  test('warns once for a typographic quote in a shared layout but still builds', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-cli-'));
    try {
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
      fs.writeFileSync(
        path.join(tmp, 'pugneum.json'),
        JSON.stringify({
          inputDirectory: 'src/pages',
          outputDirectory: 'out',
          baseDirectory: 'src',
        }),
      );
      const result = spawnSync(process.execPath, [CLI], {
        encoding: 'utf8',
        cwd: tmp,
        env: Object.assign({}, process.env, {HOME: os.tmpdir()}),
        timeout: 10000,
      });
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
    } finally {
      fs.rmSync(tmp, {recursive: true});
    }
  });

  test('clean templates produce no warning output', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-cli-'));
    try {
      fs.mkdirSync(path.join(tmp, 'src'));
      fs.mkdirSync(path.join(tmp, 'out'));
      fs.writeFileSync(path.join(tmp, 'src', 'page.pg'), 'a(href="/x") link');
      fs.writeFileSync(
        path.join(tmp, 'pugneum.json'),
        JSON.stringify({inputDirectory: 'src', outputDirectory: 'out'}),
      );
      const result = spawnSync(process.execPath, [CLI], {
        encoding: 'utf8',
        cwd: tmp,
        env: Object.assign({}, process.env, {HOME: os.tmpdir()}),
        timeout: 10000,
      });
      assert.strictEqual(result.status, 0);
      assert.doesNotMatch(result.stderr, /warning/);
    } finally {
      fs.rmSync(tmp, {recursive: true});
    }
  });

  test('does not warn about unused mixins defined in included library files', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-cli-'));
    try {
      fs.mkdirSync(path.join(tmp, 'src'));
      fs.mkdirSync(path.join(tmp, 'src', 'pages'));
      fs.mkdirSync(path.join(tmp, 'out'));
      // Library mixin lives outside the input dir; the page includes it but
      // does not call it. That must not be flagged as unused.
      fs.writeFileSync(
        path.join(tmp, 'src', 'lib.pg'),
        'mixin helper()\n  p x',
      );
      fs.writeFileSync(
        path.join(tmp, 'src', 'pages', 'page.pg'),
        'include /lib.pg\np hello',
      );
      fs.writeFileSync(
        path.join(tmp, 'pugneum.json'),
        JSON.stringify({
          inputDirectory: 'src/pages',
          outputDirectory: 'out',
          baseDirectory: 'src',
        }),
      );
      const result = spawnSync(process.execPath, [CLI], {
        encoding: 'utf8',
        cwd: tmp,
        env: Object.assign({}, process.env, {HOME: os.tmpdir()}),
        timeout: 10000,
      });
      assert.strictEqual(result.status, 0);
      assert.doesNotMatch(result.stderr, /UNUSED_MIXIN/);
    } finally {
      fs.rmSync(tmp, {recursive: true});
    }
  });
});
