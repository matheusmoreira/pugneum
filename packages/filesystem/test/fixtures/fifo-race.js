'use strict';

const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const createRootedFilesystem = require('../..');
const root = process.argv[2];
const target = path.join(root, 'page.html');
fs.writeFileSync(target, 'regular');

const originalOpenSync = fs.openSync;
let swapped = false;
fs.openSync = function (filename) {
  if (!swapped && path.basename(filename) === 'page.html') {
    swapped = true;
    fs.unlinkSync(target);
    execFileSync('mkfifo', [target]);
  }
  return Reflect.apply(originalOpenSync, this, arguments);
};

try {
  const files = createRootedFilesystem(root);
  files.readFile('page.html');
  process.exitCode = 2;
} catch (error) {
  if (error.code !== createRootedFilesystem.ERROR_CODES.NOT_REGULAR_FILE) {
    throw error;
  }
}
