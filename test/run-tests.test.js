'use strict';

var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var {describe, test} = require('node:test');
var {
  assertNonzeroCounts,
  discoverTestFiles,
  runRepositoryTests,
} = require('../scripts/run-tests');

describe('repository test runner', () => {
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
});
