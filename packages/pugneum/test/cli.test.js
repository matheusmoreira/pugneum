const assert = require('node:assert/strict');
const {describe, test} = require('node:test');
const {execFileSync, spawnSync} = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CLI = path.join(__dirname, '..', 'cli.js');

function run(args, opts) {
  return execFileSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    cwd: opts && opts.cwd,
    env: Object.assign({}, process.env, {HOME: os.tmpdir()}),
    timeout: 10000,
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

  test('skips symlinks in input directory', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-cli-'));
    try {
      fs.mkdirSync(path.join(tmp, 'src'));
      fs.mkdirSync(path.join(tmp, 'out'));
      fs.writeFileSync(path.join(tmp, 'src', 'real.pg'), 'p ok');
      fs.symlinkSync(path.join(tmp, 'src'), path.join(tmp, 'src', 'loop'));
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

  test('builds when the input directory itself is a symlink', () => {
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
      fs.symlinkSync(path.join(tmp, 'realsrc'), path.join(tmp, 'src'));
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

  test('output-escape guard is not tripped by a normal symlinked input dir', () => {
    // The guard must distinguish a legitimate symlinked input root (builds) from
    // a genuinely escaping output path. This pairs with the symlinked-input
    // build test above: the guard stays silent for valid layouts.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-cli-'));
    try {
      fs.mkdirSync(path.join(tmp, 'realsrc'));
      fs.mkdirSync(path.join(tmp, 'out'));
      fs.writeFileSync(path.join(tmp, 'realsrc', 'ok.pg'), 'p ok');
      fs.symlinkSync(path.join(tmp, 'realsrc'), path.join(tmp, 'content'));
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

  test('refuses to write through a symlinked output subdirectory', () => {
    // A pre-existing symlink as an intermediate output component must not let a
    // lexically-valid write land outside the output tree (CWE-59). The realpath
    // re-check on the created parent dir catches it.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-cli-'));
    try {
      fs.mkdirSync(path.join(tmp, 'src', 'sub'), {recursive: true});
      fs.mkdirSync(path.join(tmp, 'out'));
      fs.mkdirSync(path.join(tmp, 'secret'));
      fs.writeFileSync(path.join(tmp, 'src', 'sub', 'evil.pg'), 'p pwned');
      fs.symlinkSync(path.join(tmp, 'secret'), path.join(tmp, 'out', 'sub'));
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

  test('refuses to clobber a file through a symlinked output filename', () => {
    // The output filename itself being a symlink would truncate the symlink's
    // target outside the tree; the lstat check on the final component refuses.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-cli-'));
    try {
      fs.mkdirSync(path.join(tmp, 'src'));
      fs.mkdirSync(path.join(tmp, 'out'));
      fs.writeFileSync(path.join(tmp, 'src', 'target.pg'), 'p overwrite');
      fs.writeFileSync(path.join(tmp, 'important.conf'), 'ORIGINAL SECRET');
      fs.symlinkSync(
        path.join(tmp, 'important.conf'),
        path.join(tmp, 'out', 'target.html'),
      );
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
