const fs = require('fs');
const path = require('path');
const walk = require('pugneum-walker');
const assign = Object.assign;

module.exports = load;

function load(ast, options) {
  options = getOptions(options);
  // clone the ast
  ast = JSON.parse(JSON.stringify(ast));
  return walk(ast, function(node) {
    if (node.str === undefined) {
      if (
        node.type === 'Include' ||
        node.type === 'RawInclude' ||
        node.type === 'Extends'
      ) {
        var file = node.file;
        if (file.type !== 'FileReference') {
          throw new Error('Expected file.type to be "FileReference"');
        }
        var path, str, raw;
        try {
          path = options.resolve(file.path, file.filename, options);
          file.fullPath = path;
          raw = options.read(path, options);
          str = raw.toString('utf8');
        } catch (ex) {
          ex.message += '\n    at ' + node.filename + ' line ' + node.line;
          throw ex;
        }
        file.str = str;
        file.raw = raw;
        if (node.type === 'Extends' || node.type === 'Include') {
          let opts = assign({}, options, {filename: path, src: str});
          let tokens = options.lex(str, opts);
          let ast = options.parse(tokens, opts);
          file.ast = load(ast, opts);
        }
      }
    }
  });
}

function resolve(filename, source, options) {
  filename = filename.trim();
  if (filename[0] !== '/' && !source)
    throw new Error(
      'the "filename" option is required to use includes and extends with "relative" paths'
    );

  if (filename[0] === '/' && !options.basedir)
    throw new Error(
      'the "basedir" option is required to use includes and extends with "absolute" paths'
    );

  filename = path.join(
    filename[0] === '/' ? options.basedir : path.dirname(source.trim()),
    filename
  );

  return filename;
}

function read(filename, options) {
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
  return assign(
    {
      resolve: resolve,
      read: read,
    },
    options
  );
}
