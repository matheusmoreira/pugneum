const fs = require('fs');
const path = require('path');
const walk = require('pugneum-walker');
const makeError = require('pugneum-error');

module.exports = load;
module.exports.resolve = resolve;

function load(ast, options, visiting) {
  options = getOptions(options);
  visiting = visiting || new Set();
  // clone the ast
  ast = structuredClone(ast);
  return walk(ast, function (node) {
    if (node.str === undefined) {
      if (
        node.type === 'Include' ||
        node.type === 'RawInclude' ||
        node.type === 'Extends'
      ) {
        const file = node.file;
        if (file.type !== 'FileReference') {
          throw new Error('Expected file.type to be "FileReference"');
        }
        let filePath, str, raw;
        try {
          filePath = options.resolve(file.path, file.filename, options);
          file.fullPath = filePath;
          raw = options.read(filePath, options);
          str = raw.toString('utf8');
        } catch (ex) {
          const code =
            ex.code && ex.code.startsWith('PUGNEUM:')
              ? ex.code.slice('PUGNEUM:'.length)
              : 'LOAD_ERROR';
          throw makeError(code, ex.msg || ex.message, {
            line: node.line,
            column: node.column,
            filename: node.filename,
            source: options.source,
          });
        }
        file.str = str;
        file.raw = raw;
        if (node.type === 'Extends' || node.type === 'Include') {
          const canonical = path.resolve(filePath);
          if (visiting.has(canonical)) {
            throw makeError(
              'CIRCULAR_DEPENDENCY',
              'Circular dependency detected: ' +
                filePath +
                ' is already being loaded',
              {line: node.line, column: node.column, filename: node.filename},
            );
          }
          visiting.add(canonical);
          const opts = Object.assign({}, options, {
            filename: filePath,
            source: str,
          });
          const tokens = options.lex(str, opts);
          const fileAst = options.parse(tokens, opts);
          file.ast = load(fileAst, opts, visiting);
          visiting.delete(canonical);
        }
      }
    }
  });
}

function resolve(filename, source, options) {
  filename = filename.trim();

  if (filename[0] === '@') {
    return resolveLibrary(filename);
  }

  if (filename[0] !== '/' && !source)
    throw makeError(
      'FILENAME_REQUIRED',
      'the "filename" option is required to use includes and extends with "relative" paths',
      {line: 0, column: 0, filename: ''},
    );

  if (filename[0] === '/' && !options.basedir)
    throw makeError(
      'BASEDIR_REQUIRED',
      'the "basedir" option is required to use includes and extends with "absolute" paths',
      {line: 0, column: 0, filename: ''},
    );

  const isAbsolute = filename[0] === '/';
  const baseDir = isAbsolute ? options.basedir : path.dirname(source.trim());
  filename = path.join(baseDir, filename);

  // Prevent path traversal: absolute paths resolve against basedir, so
  // verify the result stays within it.  Relative paths resolve against
  // the including file's directory and may legitimately reference sibling
  // directories, so they are not constrained here.
  if (isAbsolute) {
    const resolved = path.resolve(filename);
    const resolvedBase = path.resolve(options.basedir);
    if (
      resolved !== resolvedBase &&
      !resolved.startsWith(resolvedBase + path.sep)
    ) {
      throw makeError(
        'PATH_TRAVERSAL',
        'Include path escapes base directory: ' + filename,
        {line: 0, column: 0, filename: ''},
      );
    }
  }

  return filename;
}

function resolveLibrary(filename) {
  // Split @scope/package/sub/path.pg into package name and subpath
  var parts = filename.split('/');
  var pkg = parts.slice(0, 2).join('/');
  var subpath = parts.slice(2).join('/');

  try {
    var pkgJson = require.resolve(pkg + '/package.json');
  } catch (e) {
    throw makeError(
      'PACKAGE_NOT_FOUND',
      'Package not found: ' + pkg + '\n    Install it with: npm install ' + pkg,
      {line: 0, column: 0, filename: ''},
    );
  }

  var pkgDir = path.dirname(pkgJson);
  var resolved = path.resolve(path.join(pkgDir, subpath));
  var resolvedPkgDir = path.resolve(pkgDir);
  if (
    resolved !== resolvedPkgDir &&
    !resolved.startsWith(resolvedPkgDir + path.sep)
  ) {
    throw makeError(
      'PATH_TRAVERSAL',
      'Library path escapes package directory: ' + filename,
      {line: 0, column: 0, filename: ''},
    );
  }

  return path.join(pkgDir, subpath);
}

function read(filename) {
  return fs.readFileSync(filename, 'utf8');
}

function validateOptions(options) {
  /* istanbul ignore if */
  if (typeof options !== 'object') {
    throw new TypeError('options must be an object');
  }
  /* istanbul ignore if */
  if (typeof options.lex !== 'function') {
    throw new TypeError('options.lex must be a function');
  }
  /* istanbul ignore if */
  if (typeof options.parse !== 'function') {
    throw new TypeError('options.parse must be a function');
  }
  /* istanbul ignore if */
  if (options.resolve && typeof options.resolve !== 'function') {
    throw new TypeError('options.resolve must be a function');
  }
  /* istanbul ignore if */
  if (options.read && typeof options.read !== 'function') {
    throw new TypeError('options.read must be a function');
  }
}

function getOptions(options) {
  validateOptions(options);
  return Object.assign(
    {
      resolve: resolve,
      read: read,
    },
    options,
  );
}
