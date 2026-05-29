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
});
