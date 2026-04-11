const fs = require('fs');
const path = require('path');
const walk = require('pugneum-walker');

module.exports = load;
module.exports.resolve = resolve;

function load(ast, options) {
  options = getOptions(options);
  // clone the ast
  ast = structuredClone(ast);
  return walk(ast, function(node) {
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
          ex.message += '\n    at ' + node.filename + ' line ' + node.line;
          throw ex;
        }
        file.str = str;
        file.raw = raw;
        if (node.type === 'Extends' || node.type === 'Include') {
          const opts = Object.assign({}, options, {filename: filePath, source: str});
          const tokens = options.lex(str, opts);
          const fileAst = options.parse(tokens, opts);
          file.ast = load(fileAst, opts);
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
    throw new Error(
      'the "filename" option is required to use includes and extends with "relative" paths',
    );

  if (filename[0] === '/' && !options.basedir)
    throw new Error(
      'the "basedir" option is required to use includes and extends with "absolute" paths',
    );

  filename = path.join(
    filename[0] === '/' ? options.basedir : path.dirname(source.trim()),
    filename,
  );

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
    throw new Error(
      'Package not found: ' + pkg + '\n    Install it with: npm install ' + pkg,
    );
  }

  return path.join(path.dirname(pkgJson), subpath);
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
    options
  );
}
