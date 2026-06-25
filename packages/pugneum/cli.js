#!/usr/bin/env node

/* pugneum - whole directory pugneum template renderer
 *
 * MIT License
 *
 * Copyright © 2023 Matheus Afonso Martins Moreira
 *
 * Permission is hereby granted, free of charge,
 * to any person obtaining a copy of this software
 * and associated documentation files (the "Software"),
 * to deal in the Software without restriction,
 * including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software,
 * and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice
 * shall be included in all copies or substantial portions
 * of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
 * OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 * IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
 * TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE
 * OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

const path = require('path');
const fs = require('fs');

const pkg = require('./package.json');

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`pugneum v${pkg.version} — ${pkg.description}

Usage: pugneum [options]

Reads pugneum.json in the current directory to compile .pg templates
from the configured input directory into HTML in the output directory.

Options:
  -h, --help     Show this help
  -v, --version  Show version number`);
  process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
  console.log(pkg.version);
  process.exit(0);
}

const EXIT_CODES = {
  INVALID_INPUT: 1,
  NOT_FOUND: 2,
  PERMISSION_DENIED: 3,
  NOT_DIRECTORY: 4,
  NOT_FILE: 5,
  TEMPLATE_ERROR: 6,
  FEED_ERROR: 7,
};

function readAndValidateInput(filename) {
  const input = fs.readFileSync(filename, 'utf8');
  let json;
  try {
    json = JSON.parse(input);
  } catch (e) {
    console.error(`Invalid JSON in ${filename}: ${e.message}`);
    process.exit(EXIT_CODES.INVALID_INPUT);
  }

  // Reject non-object JSON (null, arrays, numbers, strings, booleans) up front.
  // null in particular would throw a raw TypeError on the destructure below,
  // and non-string field values would later crash node:path with an uncaught
  // ERR_INVALID_ARG_TYPE instead of a clean INVALID_INPUT message.
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    console.error(`${filename} must contain a JSON object`);
    process.exit(EXIT_CODES.INVALID_INPUT);
  }

  const {inputDirectory, outputDirectory, baseDirectory} = json;

  if (!inputDirectory || !outputDirectory) {
    console.error('"inputDirectory" and "outputDirectory" are required');
    process.exit(EXIT_CODES.INVALID_INPUT);
  }

  if (
    typeof inputDirectory !== 'string' ||
    typeof outputDirectory !== 'string'
  ) {
    console.error('"inputDirectory" and "outputDirectory" must be strings');
    process.exit(EXIT_CODES.INVALID_INPUT);
  }

  if (baseDirectory != null && typeof baseDirectory !== 'string') {
    console.error('"baseDirectory" must be a string');
    process.exit(EXIT_CODES.INVALID_INPUT);
  }

  return {inputDirectory, outputDirectory, baseDirectory, feeds: json.feeds};
}

// Deferred past the --help/--version fast paths above so trivial flag
// invocations do not load the full compile pipeline (lexer/parser/loader/
// linker/filterer/renderer) that requiring 'pugneum' pulls in.
const pg = require('pugneum');
const pgExtension = /\.pg$/;

function isPugneum(file) {
  return pgExtension.test(file);
}

function processDirectory(directory, f, visited) {
  visited = visited || new Set();
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink()) return;
  // Inode (dev:ino) loop guard: defence-in-depth against directory cycles that
  // the per-entry symlink skip would not catch (e.g. hardlinked dirs / bind
  // mounts). On ordinary filesystems the symlink skips already prevent cycles.
  const inode = stat.dev + ':' + stat.ino;
  if (visited.has(inode)) return;
  visited.add(inode);

  // withFileTypes reads each entry's type from the same getdents the listing
  // already performs, so no extra per-entry stat is needed. Dirent type checks
  // use lstat semantics (a symlink reports isSymbolicLink, never the target's
  // type), matching the per-entry skip the old code did with fs.lstatSync.
  const entries = fs.readdirSync(directory, {withFileTypes: true});

  for (let i = 0; i < entries.length; ++i) {
    const entry = entries[i];

    if (entry.isSymbolicLink()) continue;

    if (entry.isDirectory()) {
      processDirectory(path.join(directory, entry.name), f, visited);
    } else {
      if (isPugneum(entry.name)) {
        f(path.join(directory, entry.name));
      }
    }
  }
}

function handleError(error) {
  switch (error.code) {
    case 'ENOENT':
      console.error(`Path not found: '${error.path}'`);
      process.exit(EXIT_CODES.NOT_FOUND);
      break;
    case 'ENOTDIR':
      console.error(`Expected directory: '${error.path}'`);
      process.exit(EXIT_CODES.NOT_DIRECTORY);
      break;
    case 'EISDIR':
      console.error(`Expected file: '${error.path}'`);
      process.exit(EXIT_CODES.NOT_FILE);
      break;
    case 'EACCES':
      console.error(`Permission denied: '${error.path}'`);
      process.exit(EXIT_CODES.PERMISSION_DENIED);
      break;
    default:
      if (typeof error.code === 'string' && error.code.startsWith('PUGNEUM:')) {
        console.error(error.message);
        process.exit(EXIT_CODES.TEMPLATE_ERROR);
      }
      throw error;
  }
}

// Declared outside the try so the catch can still surface diagnostics
// collected from earlier files before a later file's hard error aborts.
const pgOptions = {basedir: undefined, warnings: []};
let warningsEmitted = false;

function flushWarnings() {
  if (warningsEmitted) return;
  warningsEmitted = true;
  pg.emitWarnings(pgOptions.warnings);
}

try {
  const {baseDirectory, inputDirectory, outputDirectory, feeds} =
    readAndValidateInput('pugneum.json');
  pgOptions.basedir = baseDirectory;

  const resolvedInputDir = fs.realpathSync(inputDirectory);
  const resolvedOutputDir = path.resolve(outputDirectory);
  // Canonicalize the output root the same way the input root is canonicalized.
  // The lexical startsWith guard below cannot see symlinks, but mkdirSync and
  // writeFileSync follow them at write time, so we also re-check the realpath of
  // each created parent dir against this resolved root.
  fs.mkdirSync(resolvedOutputDir, {recursive: true});
  const realOutputDir = fs.realpathSync(resolvedOutputDir);
  // The CLI is the sole writer during a build, so remember which output dirs
  // were created (and verified) and skip the redundant work for sibling pages.
  const madeDirs = new Set();
  processDirectory(resolvedInputDir, function compilePugneumAndSave(input) {
    // Compute the relative path against the SAME base the walk uses
    // (resolvedInputDir, the realpath). Using the raw inputDirectory here would
    // diverge whenever the input dir is a symlink (or has a symlinked parent
    // component): path.relative resolves it lexically against cwd while every
    // walked input is symlink-resolved, yielding a spurious ../-laden path that
    // trips the output-escape guard below and aborts the whole build.
    const relative = path.relative(resolvedInputDir, input);
    const outputPath = path
      .join(outputDirectory, relative)
      .replace(pgExtension, '.html');
    const resolvedOutput = path.resolve(outputPath);
    if (!resolvedOutput.startsWith(resolvedOutputDir + path.sep)) {
      console.error(`Output path escapes output directory: ${relative}`);
      process.exit(EXIT_CODES.INVALID_INPUT);
    }
    const directory = path.dirname(outputPath);
    const output = pg.renderFile(input, pgOptions);
    if (!madeDirs.has(directory)) {
      fs.mkdirSync(directory, {recursive: true});
      // After creating the parent dir, confirm its realpath is still inside the
      // output tree: a pre-existing symlinked intermediate component would let
      // an otherwise-lexically-valid write land outside out/.
      const realDirectory = fs.realpathSync(directory);
      if (
        realDirectory !== realOutputDir &&
        !realDirectory.startsWith(realOutputDir + path.sep)
      ) {
        console.error(`Output path escapes output directory: ${relative}`);
        process.exit(EXIT_CODES.INVALID_INPUT);
      }
      madeDirs.add(directory);
    }
    // Refuse to write through a symlinked final component (it would clobber the
    // symlink's target, outside the tree). lstat does not follow the link.
    let existing;
    try {
      existing = fs.lstatSync(outputPath);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    if (existing && existing.isSymbolicLink()) {
      console.error(`Output path escapes output directory: ${relative}`);
      process.exit(EXIT_CODES.INVALID_INPUT);
    }
    fs.writeFileSync(outputPath, output, {encoding: 'utf8'});
  });

  // Surface non-fatal diagnostics collected across the whole build once.
  flushWarnings();

  if (feeds) {
    // pugneum-feed is an optional peer dependency. Detect its absence by
    // resolving the exact specifier in its own try: only a failure to resolve
    // 'pugneum-feed' itself means "not installed". A MODULE_NOT_FOUND raised by
    // a require *inside* a present-but-broken pugneum-feed must NOT be mistaken
    // for absence, so generateFeeds() is invoked OUTSIDE this guard where its
    // own failures propagate to handleError.
    let generateFeeds;
    try {
      require.resolve('pugneum-feed');
      generateFeeds = require('pugneum-feed');
    } catch (resolveError) {
      if (
        resolveError.code === 'MODULE_NOT_FOUND' &&
        /Cannot find module '(\.{0,2}\/)?pugneum-feed'/.test(
          resolveError.message,
        )
      ) {
        console.warn('pugneum-feed is not installed, skipping feed generation');
      } else {
        throw resolveError;
      }
    }

    if (generateFeeds) {
      try {
        generateFeeds({
          outputDirectory: outputDirectory,
          feeds: feeds,
        });
      } catch (feedError) {
        // A present feed generator's own failure: report it cleanly rather than
        // letting it escape handleError's default branch as a raw stack trace.
        if (
          typeof feedError.code === 'string' &&
          feedError.code.startsWith('PUGNEUM:')
        ) {
          console.error(feedError.message);
        } else {
          console.error(`Feed generation failed: ${feedError.message}`);
        }
        process.exit(EXIT_CODES.FEED_ERROR);
      }
    }
  }
} catch (error) {
  // Surface warnings collected from files that built before this error, so a
  // later hard failure does not discard earlier diagnostics. flushWarnings is
  // idempotent, so this is a no-op if the happy path already emitted.
  flushWarnings();
  handleError(error);
}
