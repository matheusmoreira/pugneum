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

const EXIT_CODES = {
  INVALID_INPUT: 1,
  NOT_FOUND: 2,
  PERMISSION_DENIED: 3,
  NOT_DIRECTORY: 4,
  NOT_FILE: 5,
  TEMPLATE_ERROR: 6,
  FEED_ERROR: 7,
};

const args = process.argv.slice(2);

if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
  console.log(`pugneum v${pkg.version} — ${pkg.description}

Usage: pugneum [options]

Reads pugneum.json in the current directory to compile .pg templates
from the configured input directory into HTML in the output directory.

Options:
  -h, --help     Show this help
  -v, --version  Show version number`);
  process.exit(0);
}

if (args.length === 1 && (args[0] === '--version' || args[0] === '-v')) {
  console.log(pkg.version);
  process.exit(0);
}

if (args.length > 0) {
  console.error(
    `Unknown argument${args.length === 1 ? '' : 's'}: ${args.join(' ')}`,
  );
  process.exit(EXIT_CODES.INVALID_INPUT);
}

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

  return {
    inputDirectory,
    outputDirectory,
    baseDirectory,
    compilationLimits: json.compilationLimits,
    feeds: json.feeds,
  };
}

// Deferred past the --help/--version fast paths above so trivial flag
// invocations do not load the full compile pipeline (lexer/parser/loader/
// linker/filterer/renderer) that requiring 'pugneum' pulls in.
const pg = require('pugneum');
const decodeSource = require('pugneum-loader').decodeSource;
const createRootedFilesystem = require('pugneum-filesystem');
const filesystemErrors = createRootedFilesystem.ERROR_CODES;
const pgExtension = /\.pg$/;
const CLI_INPUT_ERROR = 'PUGNEUM:CLI_INPUT_ERROR';
const CLI_OUTPUT_ERROR = 'PUGNEUM:CLI_OUTPUT_ERROR';

function isPugneum(file) {
  return pgExtension.test(file);
}

function processDirectory(directory, f, activeDirectories, excludedDirectory) {
  if (directory === excludedDirectory) return;

  activeDirectories = activeDirectories || new Set();
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink()) return;
  // Inode (dev:ino) loop guard: defence-in-depth against directory cycles that
  // the per-entry symlink skip would not catch (e.g. hardlinked dirs / bind
  // mounts). On ordinary filesystems the symlink skips already prevent cycles.
  const inode = stat.dev + ':' + stat.ino;
  if (activeDirectories.has(inode)) return;
  activeDirectories.add(inode);

  try {
    // withFileTypes reads each entry's type from the same getdents the listing
    // already performs, so no extra per-entry stat is needed. Dirent type
    // checks use lstat semantics (a symlink reports isSymbolicLink, never the
    // target's type), matching the per-entry skip the old code did with
    // fs.lstatSync. Sort by code unit so failure and output order do not depend
    // on the filesystem's directory enumeration order or process locale.
    const entries = fs
      .readdirSync(directory, {withFileTypes: true})
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (let i = 0; i < entries.length; ++i) {
      const entry = entries[i];

      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        processDirectory(
          path.join(directory, entry.name),
          f,
          activeDirectories,
          excludedDirectory,
        );
      } else {
        if (isPugneum(entry.name)) {
          f(path.join(directory, entry.name));
        }
      }
    }
  } finally {
    // The inode is a recursion-stack guard, not a global de-duplication key:
    // separate directory entries can legitimately expose the same identity.
    activeDirectories.delete(inode);
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
    case CLI_INPUT_ERROR:
    case CLI_OUTPUT_ERROR:
      console.error(error.message);
      process.exit(EXIT_CODES.INVALID_INPUT);
      break;
    default:
      if (typeof error.code === 'string' && error.code.startsWith('PUGNEUM:')) {
        console.error(error.message);
        process.exit(EXIT_CODES.TEMPLATE_ERROR);
      }
      throw error;
  }
}

function rethrowOutputBoundary(error, relative) {
  if (
    error.code === filesystemErrors.PATH_ESCAPE ||
    error.code === filesystemErrors.NOT_REGULAR_FILE ||
    error.code === filesystemErrors.NOT_DIRECTORY
  ) {
    const outputError = new Error(
      `Output path escapes output directory: ${relative}`,
      {cause: error},
    );
    outputError.code = CLI_OUTPUT_ERROR;
    throw outputError;
  }
  throw error;
}

function rethrowInputBoundary(error, relative) {
  if (
    error.code === filesystemErrors.PATH_ESCAPE ||
    error.code === filesystemErrors.NOT_REGULAR_FILE ||
    error.code === filesystemErrors.NOT_DIRECTORY
  ) {
    const inputError = new Error(
      `Input path escapes input directory or is not a regular file: ${relative}`,
      {cause: error},
    );
    inputError.code = CLI_INPUT_ERROR;
    throw inputError;
  }
  throw error;
}

function prepareOutputDirectory(directory) {
  try {
    fs.mkdirSync(directory, {recursive: true});
    return fs.realpathSync(directory);
  } catch (error) {
    if (error && ['EEXIST', 'ELOOP', 'ENOTDIR'].includes(error.code)) {
      const directoryError = new Error(`Expected directory: '${directory}'`, {
        cause: error,
      });
      directoryError.code = 'ENOTDIR';
      directoryError.path = directory;
      throw directoryError;
    }
    throw error;
  }
}

function errorMessage(error) {
  if (error && typeof error.message === 'string') return error.message;
  try {
    return String(error);
  } catch (_) {
    return 'Unknown error';
  }
}

function exitWithFeedError(error) {
  if (
    error &&
    typeof error.code === 'string' &&
    error.code.startsWith('PUGNEUM:')
  ) {
    console.error(errorMessage(error));
  } else {
    console.error(`Feed generation failed: ${errorMessage(error)}`);
  }
  process.exit(EXIT_CODES.FEED_ERROR);
}

// Declared outside the try so the catch can still surface diagnostics
// collected from earlier files before a later file's hard error aborts.
const pgOptions = {
  basedir: undefined,
  dependencyCache: new Map(),
  warnings: pg.createWarningCollector(),
};
let warningsEmitted = false;

function flushWarnings() {
  if (warningsEmitted) return;
  warningsEmitted = true;
  pg.emitWarnings(pgOptions.warnings);
}

try {
  const {
    baseDirectory,
    inputDirectory,
    outputDirectory,
    compilationLimits,
    feeds,
  } = readAndValidateInput('pugneum.json');
  try {
    pgOptions.compilationContext =
      pg.createCompilationContext(compilationLimits);
  } catch (error) {
    const inputError = new Error(errorMessage(error), {cause: error});
    inputError.code = CLI_INPUT_ERROR;
    throw inputError;
  }
  // baseDirectory is the include-containment root; default it to the input
  // tree so default-deny is always on even when the config omits it.
  pgOptions.basedir = baseDirectory || inputDirectory;

  const resolvedInputDir = fs.realpathSync(inputDirectory);
  const inputFiles = createRootedFilesystem(resolvedInputDir);
  const resolvedOutputDir = path.resolve(outputDirectory);
  const realOutputDir = prepareOutputDirectory(resolvedOutputDir);
  const outputFiles = createRootedFilesystem(resolvedOutputDir);
  const outputRelativeToInput = path.relative(resolvedInputDir, realOutputDir);
  const nestedOutputDir =
    outputRelativeToInput &&
    !path.isAbsolute(outputRelativeToInput) &&
    outputRelativeToInput !== '..' &&
    !outputRelativeToInput.startsWith('..' + path.sep)
      ? realOutputDir
      : undefined;
  processDirectory(
    resolvedInputDir,
    function compilePugneumAndSave(input) {
      // Compute the relative path against the SAME base the walk uses
      // (resolvedInputDir, the realpath). Using the raw inputDirectory here would
      // diverge whenever the input dir is a symlink (or has a symlinked parent
      // component): path.relative resolves it lexically against cwd while every
      // walked input is symlink-resolved, yielding a spurious ../-laden path that
      // trips the output-escape guard below and aborts the whole build.
      const relative = path.relative(resolvedInputDir, input);
      const outputPath = relative.replace(pgExtension, '.html');
      let source;
      try {
        source = decodeSource(inputFiles.readFile(relative), input);
      } catch (error) {
        rethrowInputBoundary(error, relative);
      }
      const output = pg.render(
        source,
        Object.assign({}, pgOptions, {filename: input}),
      );
      try {
        outputFiles.ensureDirectory(path.dirname(outputPath));
        outputFiles.writeFileAtomic(outputPath, output, {encoding: 'utf8'});
      } catch (error) {
        rethrowOutputBoundary(error, relative);
      }
    },
    undefined,
    nestedOutputDir,
  );

  // Surface non-fatal diagnostics collected across the whole build once.
  flushWarnings();

  if (feeds && feeds.enabled !== false) {
    // pugneum-feed is an optional peer dependency. Detect its absence with an
    // isolated resolution probe: only failure here means "not installed". A
    // MODULE_NOT_FOUND raised while loading a present package can instead name
    // one of its transitive dependencies and is handled as a feed failure.
    let feedAvailable = true;
    try {
      require.resolve('pugneum-feed');
    } catch (resolveError) {
      if (resolveError && resolveError.code === 'MODULE_NOT_FOUND') {
        feedAvailable = false;
        console.warn('pugneum-feed is not installed, skipping feed generation');
      } else {
        throw resolveError;
      }
    }

    if (feedAvailable) {
      try {
        const generateFeeds = require('pugneum-feed');
        generateFeeds({
          compilationContext: pgOptions.compilationContext,
          outputDirectory: outputDirectory,
          feeds: feeds,
        });
      } catch (feedError) {
        // Loading a present package can fail on initialization or a transitive
        // dependency just as invocation can. Both are feed failures, while
        // only the resolution probe above represents an absent optional peer.
        exitWithFeedError(feedError);
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
