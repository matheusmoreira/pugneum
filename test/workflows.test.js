'use strict';

var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var {describe, test} = require('node:test');

var repositoryRoot = path.resolve(__dirname, '..');
var workflowPaths = [
  path.join(repositoryRoot, '.github', 'workflows', 'test.yml'),
  path.join(repositoryRoot, '.github', 'workflows', 'codeql.yml'),
];

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

describe('GitHub workflow policy', () => {
  test('every third-party action is pinned to a reviewed commit', () => {
    var actionLines = workflowPaths.flatMap((file) =>
      read(file)
        .split('\n')
        .filter((line) => /^\s*uses:/.test(line)),
    );

    assert.ok(actionLines.length > 0);
    actionLines.forEach((line) => {
      assert.match(
        line,
        /^\s*uses: [^\s@]+@[0-9a-f]{40} # v\d+(?:\.\d+){1,2}\s*$/,
      );
    });

    var dependabot = read(
      path.join(repositoryRoot, '.github', 'dependabot.yml'),
    );
    assert.match(dependabot, /package-ecosystem: github-actions/);
  });

  test('workflows declare least privilege, cancellation, and job deadlines', () => {
    workflowPaths.forEach((file) => {
      var source = read(file);
      assert.match(source, /^permissions:\n  contents: read$/m);
      assert.match(
        source,
        /^concurrency:\n(?:  .+\n)+  cancel-in-progress: true$/m,
      );

      var jobs = source.match(/^    runs-on:/gm) || [];
      var deadlines =
        source.match(/^    timeout-minutes: [1-9][0-9]*$/gm) || [];
      assert.ok(jobs.length > 0);
      assert.strictEqual(deadlines.length, jobs.length);
    });
  });

  test('formatting runs once outside the runtime matrix', () => {
    var source = read(workflowPaths[0]);
    assert.strictEqual(
      (source.match(/run: .*prettier:check/g) || []).length,
      1,
    );
    assert.match(source, /^  format:\n(?:.|\n)*?^  test:/m);
    assert.match(source, /os: \[ubuntu-latest, windows-latest\]/);
    assert.match(source, /node-version: \['22\.5\.0', '24', '26'\]/);
  });
});
