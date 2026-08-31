'use strict';

var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var {spawnSync} = require('node:child_process');
var {describe, test} = require('node:test');
var {
  DEFAULT_TEST_TIMEOUT_MS,
  assertNonzeroCounts,
  discoverTestFiles,
  runRepositoryTests,
} = require('../scripts/run-tests');

describe('repository test runner', () => {
  test('uses a finite repository-owned per-test timeout', () => {
    assert.strictEqual(DEFAULT_TEST_TIMEOUT_MS, 60_000);
  });

  test('discovers test files recursively in stable order', (t) => {
    var root = fs.mkdtempSync(path.join(os.tmpdir(), 'pugneum-test-runner-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));

    fs.mkdirSync(path.join(root, 'z', 'test'), {recursive: true});
    fs.mkdirSync(path.join(root, 'a', 'test'), {recursive: true});
    fs.writeFileSync(path.join(root, 'z', 'test', 'z.test.js'), '');
    fs.writeFileSync(path.join(root, 'a', 'test', 'a.test.js'), '');
    fs.writeFileSync(path.join(root, 'a', 'test', 'ignored.js'), '');

    assert.deepStrictEqual(discoverTestFiles([root]), [
      path.join(root, 'a', 'test', 'a.test.js'),
      path.join(root, 'z', 'test', 'z.test.js'),
    ]);
  });

  test('rejects empty discovery and zero-count executions', (t) => {
    var root = fs.mkdtempSync(path.join(os.tmpdir(), 'pugneum-empty-runner-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));

    assert.throws(
      () => runRepositoryTests([root]),
      /discovery found no .test.js files/,
    );
    assert.throws(
      () => assertNonzeroCounts({tests: 0, suites: 1}),
      /without running any tests/,
    );
    assert.throws(
      () => assertNonzeroCounts({tests: 1, suites: 0}),
      /without running any suites/,
    );
    assert.doesNotThrow(() => assertNonzeroCounts({tests: 1, suites: 1}));
  });

  test('a timed-out test fails and still runs its cleanup hook', (t) => {
    var root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'pugneum-timeout-runner-'),
    );
    var marker = path.join(root, 'temporary-artifact');
    var fixture = path.join(root, 'timeout.test.js');
    var launcher = path.join(root, 'run.js');
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));

    fs.writeFileSync(
      fixture,
      "'use strict';\n" +
        "var fs = require('node:fs');\n" +
        "var {describe, test} = require('node:test');\n" +
        'var marker = ' +
        JSON.stringify(marker) +
        ';\n' +
        "describe('timeout fixture', () => {\n" +
        "  test('does not finish', async (t) => {\n" +
        "    fs.writeFileSync(marker, 'created');\n" +
        '    t.after(() => fs.rmSync(marker, {force: true}));\n' +
        '    await new Promise(() => {});\n' +
        '  });\n' +
        '});\n',
    );

    var runner = path.resolve(__dirname, '../scripts/run-tests.js');
    var program =
      'require(' +
      JSON.stringify(runner) +
      ').runRepositoryTests([' +
      JSON.stringify(root) +
      '], 25);';
    fs.writeFileSync(launcher, program);
    var childEnvironment = {...process.env};
    delete childEnvironment.NODE_TEST_CONTEXT;
    var result = spawnSync(process.execPath, [launcher], {
      encoding: 'utf8',
      env: childEnvironment,
      timeout: 5_000,
    });

    assert.strictEqual(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /timed out after 25ms/i);
    assert.strictEqual(fs.existsSync(marker), false);
  });
});
