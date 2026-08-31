'use strict';

var fs = require('node:fs');
var path = require('node:path');

var repositoryRoot = path.resolve(__dirname, '..');
var sourcePath = path.join(repositoryRoot, 'packages', 'pugneum', 'README.md');
var targetPath = path.join(repositoryRoot, 'README.md');

function checkRootReadme() {
  var target = fs.lstatSync(targetPath);
  if (!target.isFile() || target.isSymbolicLink()) {
    throw new Error(
      'README.md must be a regular synchronized copy; run npm run docs:sync',
    );
  }

  var source = fs.readFileSync(sourcePath);
  var copy = fs.readFileSync(targetPath);
  if (!source.equals(copy)) {
    throw new Error(
      'README.md differs from packages/pugneum/README.md; run npm run docs:sync',
    );
  }
}

function syncRootReadme() {
  var target;
  try {
    target = fs.lstatSync(targetPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (target && target.isSymbolicLink()) fs.unlinkSync(targetPath);
  fs.copyFileSync(sourcePath, targetPath);
  checkRootReadme();
}

if (require.main === module) {
  var command = process.argv[2];
  if (command === '--write') syncRootReadme();
  else if (command === undefined || command === '--check') checkRootReadme();
  else
    throw new Error(
      'usage: node scripts/sync-root-readme.js [--check|--write]',
    );
}

module.exports = {checkRootReadme, syncRootReadme};
