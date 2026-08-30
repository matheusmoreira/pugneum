'use strict';

var fs = require('node:fs');
var path = require('node:path');
var {run} = require('node:test');
var {spec} = require('node:test/reporters');

var repositoryRoot = path.resolve(__dirname, '..');

function discoverTestFiles(roots) {
  var files = [];

  function visit(entryPath) {
    var entries = fs.readdirSync(entryPath, {withFileTypes: true});
    entries.sort((left, right) => left.name.localeCompare(right.name));

    entries.forEach((entry) => {
      var fullPath = path.join(entryPath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') visit(fullPath);
        return;
      }
      if (entry.isFile() && entry.name.endsWith('.test.js')) {
        files.push(fullPath);
      }
    });
  }

  roots.forEach((root) => {
    if (fs.existsSync(root)) visit(root);
  });

  return files.sort((left, right) => left.localeCompare(right));
}

function assertNonzeroCounts(counts) {
  if (counts.tests === 0) {
    throw new Error('Test execution completed without running any tests.');
  }
  if (counts.suites === 0) {
    throw new Error('Test execution completed without running any suites.');
  }
}

function runRepositoryTests(roots) {
  var files = discoverTestFiles(
    roots || [
      path.join(repositoryRoot, 'packages'),
      path.join(repositoryRoot, 'test'),
    ],
  );

  if (files.length === 0) {
    throw new Error('Test discovery found no .test.js files.');
  }

  var counts = {tests: 0, suites: 0};
  var stream = run({files, concurrency: true});

  function record(data) {
    if (data.details && data.details.type === 'suite') counts.suites += 1;
    else counts.tests += 1;
  }

  stream.on('test:pass', record);
  stream.on('test:fail', (data) => {
    record(data);
    process.exitCode = 1;
  });
  stream.on('end', () => {
    try {
      assertNonzeroCounts(counts);
      process.stderr.write(
        `[test-runner] verified ${counts.tests} tests in ${counts.suites} suites across ${files.length} files\n`,
      );
    } catch (error) {
      process.stderr.write(`[test-runner] ${error.message}\n`);
      process.exitCode = 1;
    }
  });

  stream.compose(spec).pipe(process.stdout);
}

if (require.main === module) runRepositoryTests();

module.exports = {
  assertNonzeroCounts,
  discoverTestFiles,
  runRepositoryTests,
};
