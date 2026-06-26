const fs = require('fs');
const path = require('path');
const walk = require('pugneum-walker');
const makeError = require('pugneum-error');

module.exports = load;
module.exports.resolve = resolve;

// Maximum include/extends recursion depth. Mirrors the parser's
// MAX_PARSE_DEPTH and the linker's DEFAULT_MAX_LINK_DEPTH so that a deep
// (non-cyclic) include chain aborts with a coded PUGNEUM error instead of
// overflowing the native call stack with an uncatchable RangeError.
const DEFAULT_MAX_LOAD_DEPTH = 256;

// Resolve/resolveLibrary throw before they have access to the AST node, so
// they cannot supply a real source location. load()'s catch re-stamps the
// node's real line/column/filename/source onto these errors (see loadAST), so
// the placeholder location below is only ever seen by direct callers of the
// exported resolve() helper, which the README documents as taking no node.
function zeroLoc() {
  return {line: 0, column: 0, filename: ''};
}

function load(ast, options) {
  // Validate before mutating anything: load() is otherwise free to be called
  // with a non-object options bag, and writing options.sources onto it first
  // would mask the intended "options must be an object" error with a raw
  // TypeError under strict mode.
  validateOptions(options);
  // The `sources` map (resolved path -> source text) is an output side-channel:
  // the linker and renderer read options.sources[node.filename] to attach
  // source context to their own diagnostics. It is attached to the caller's
  // object on purpose so the orchestrator can thread one options bag through
  // load -> link -> render. getOptions() then layers the resolve/read defaults
  // onto a copy that shares this same sources reference.
  if (!options.sources) {
    options.sources = Object.create(null);
    if (options.filename && options.source) {
      options.sources[options.filename] = options.source;
    }
  }
  options = getOptions(options);
  // Clone the caller's AST once: walk() mutates nodes in place, and the input
  // tree belongs to the caller. Recursive loads work on freshly-parsed,
  // single-owner ASTs and are not cloned again (see loadAST).
  ast = structuredClone(ast);
  return loadAST(ast, options, new Set(), 0);
}

function loadAST(ast, options, visiting, depth) {
  return walk(ast, function (node) {
    if (
      node.type === 'Include' ||
      node.type === 'RawInclude' ||
      node.type === 'Extends'
    ) {
      const file = node.file;
      if (file.type !== 'FileReference') {
        throw makeError(
          'INVALID_AST',
          'Expected file.type to be "FileReference"',
          {
            line: node.line,
            column: node.column,
            filename: node.filename,
            source: sourceFor(options, node),
          },
        );
      }
      let filePath, str, raw;
      try {
        filePath = options.resolve(file.path, file.filename, options);
        file.fullPath = filePath;
        raw = options.read(filePath, options);
        // Normalize to a Buffer so file.raw is always genuine bytes (the
        // filterer hands file.raw to binary filters) and so str decodes
        // correctly even when a custom read returns a string or when a prior
        // structuredClone downgraded a Buffer to a Uint8Array.
        if (!Buffer.isBuffer(raw)) {
          raw = Buffer.from(raw);
        }
        str = raw.toString('utf8');
      } catch (ex) {
        const code =
          typeof ex.code === 'string' && ex.code.startsWith('PUGNEUM:')
            ? ex.code.slice('PUGNEUM:'.length)
            : 'LOAD_ERROR';
        throw makeError(code, ex.msg || ex.message, {
          line: node.line,
          column: node.column,
          filename: node.filename,
          source: sourceFor(options, node),
        });
      }
      file.str = str;
      file.raw = raw;
      options.sources[filePath] = str;
      if (node.type === 'Extends' || node.type === 'Include') {
        // Canonicalize via realpath so the same physical file reached through
        // different spellings (including symlinks) is recognized as a cycle.
        // Fall back to lexical resolution when realpath fails (e.g. a custom
        // read serving a virtual path that does not exist on disk).
        let canonical;
        try {
          canonical = fs.realpathSync(filePath);
        } catch (e) {
          canonical = path.resolve(filePath);
        }
        if (visiting.has(canonical)) {
          throw makeError(
            'CIRCULAR_DEPENDENCY',
            'Circular dependency detected: ' +
              canonical +
              ' is already being loaded',
            {
              line: node.line,
              column: node.column,
              filename: node.filename,
              source: sourceFor(options, node),
            },
          );
        }
        const maxDepth =
          options.maxLoadDepth != null
            ? options.maxLoadDepth
            : DEFAULT_MAX_LOAD_DEPTH;
        if (depth >= maxDepth) {
          throw makeError(
            'LOAD_DEPTH_EXCEEDED',
            'Include/extends chain exceeds maximum depth of ' + maxDepth,
            {
              line: node.line,
              column: node.column,
              filename: node.filename,
              source: sourceFor(options, node),
            },
          );
        }
        visiting.add(canonical);
        try {
          const opts = Object.assign({}, options, {
            filename: filePath,
            source: str,
          });
          const tokens = options.lex(str, opts);
          const fileAst = options.parse(tokens, opts);
          file.ast = loadAST(fileAst, opts, visiting, depth + 1);
        } finally {
          visiting.delete(canonical);
        }
      }
    }
  });
}

// Resolve the source text for a node's error context, preferring the
// per-file `sources` map (keyed on the node's own filename, as the linker and
// renderer do) and falling back to the scalar current source.
function sourceFor(options, node) {
  if (options.sources && node.filename && options.sources[node.filename]) {
    return options.sources[node.filename];
  }
  return options.source;
}

// Is `resolved` contained within `base` (equal to it or a descendant)?
function isWithin(resolved, base) {
  return resolved === base || resolved.startsWith(base + path.sep);
}

// Canonicalize a candidate path for containment checking. The target may not
// exist yet (e.g. an include of a not-yet-created file), so realpath the
// longest existing prefix and re-append the missing tail. This resolves any
// symlink inside the boundary — a symlink within the root that points outside
// it can no longer escape the containment check.
function realpathBoundary(candidate) {
  let current = path.resolve(candidate);
  const tail = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...tail.reverse());
    } catch (e) {
      const parent = path.dirname(current);
      if (parent === current) {
        // Reached the filesystem root without finding an existing prefix;
        // fall back to the lexically-resolved path.
        return path.resolve(candidate);
      }
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

// Throw PUGNEUM:PATH_ESCAPE if `candidate` resolves outside `baseDir`.
// Containment is checked against real (symlink-resolved) paths so a symlink
// inside the boundary cannot be used to escape it.
function assertWithin(candidate, baseDir, message) {
  const resolved = realpathBoundary(candidate);
  const base = realpathBoundary(baseDir);
  if (!isWithin(resolved, base)) {
    throw makeError('PATH_ESCAPE', message, zeroLoc());
  }
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
      zeroLoc(),
    );

  if (filename[0] === '/' && !options.basedir)
    throw makeError(
      'BASEDIR_REQUIRED',
      'the "basedir" option is required to use includes and extends with "absolute" paths',
      zeroLoc(),
    );

  const isAbsolute = filename[0] === '/';
  const baseDir = isAbsolute ? options.basedir : path.dirname(source.trim());
  filename = path.join(baseDir, filename);

  // Default-deny containment: include/extends must stay within basedir (the
  // project root — baseDirectory in the CLI config, which defaults to
  // inputDirectory). Absolute paths already require basedir; relative paths
  // must not climb out of it either. The only sanctioned way to reach content
  // outside the project is an npm-installed package via an @-prefixed library
  // include (resolveLibrary). When no basedir is configured (a programmatic
  // render with no build root), there is nothing to contain against, so the
  // relative include simply resolves against the including file's directory.
  if (options.basedir) {
    assertWithin(
      filename,
      options.basedir,
      'Include path escapes project root: ' + filename,
    );
  }

  return filename;
}

function resolveLibrary(filename) {
  // Leading @ is the library-mode trigger; the rest is the npm path verbatim.
  // Unscoped: @pkg/file.pg        → pkg/file.pg
  // Scoped:   @@scope/pkg/file.pg  → @scope/pkg/file.pg
  const rest = filename.slice(1);

  if (!rest) {
    throw makeError(
      'INVALID_LIBRARY_PATH',
      'Library include is missing a package name: ' + filename,
      zeroLoc(),
    );
  }

  let pkgEnd;
  if (rest[0] === '@') {
    const firstSlash = rest.indexOf('/');
    pkgEnd = firstSlash === -1 ? -1 : rest.indexOf('/', firstSlash + 1);
  } else {
    pkgEnd = rest.indexOf('/');
  }

  let pkg = pkgEnd === -1 ? rest : rest.slice(0, pkgEnd);
  const subpath = pkgEnd === -1 ? '' : rest.slice(pkgEnd + 1);

  // Reject degenerate package names (empty, a bare scope like "@scope/", or a
  // "/"-led path) so they surface as INVALID_LIBRARY_PATH instead of being fed
  // to require.resolve and emerging as a blank-named PACKAGE_NOT_FOUND.
  const scopedPkg = /^@[^/]+\/[^/]+$/.test(pkg);
  const unscopedPkg = pkg !== '' && pkg[0] !== '@' && pkg.indexOf('/') === -1;
  if (!scopedPkg && !unscopedPkg) {
    // Build a clean suggestion with the trailing slash (if any) stripped.
    const suggestion = pkg.replace(/\/+$/, '');
    throw makeError(
      'INVALID_LIBRARY_PATH',
      'Library include has an invalid package name: ' +
        filename +
        (suggestion ? '\n    Use: @' + suggestion + '/file.pg' : ''),
      zeroLoc(),
    );
  }

  if (!subpath) {
    throw makeError(
      'INVALID_LIBRARY_PATH',
      'Library include is missing a file path: ' +
        filename +
        '\n    Use: @' +
        pkg +
        '/file.pg',
      zeroLoc(),
    );
  }

  let pkgJson;
  try {
    pkgJson = require.resolve(pkg + '/package.json');
  } catch (e) {
    throw makeError(
      'PACKAGE_NOT_FOUND',
      'Package not found: ' + pkg + '\n    Install it with: npm install ' + pkg,
      zeroLoc(),
    );
  }

  const pkgDir = path.dirname(pkgJson);
  assertWithin(
    path.join(pkgDir, subpath),
    pkgDir,
    'Library path escapes package directory: ' + filename,
  );

  return path.join(pkgDir, subpath);
}

function read(filename) {
  // No encoding: return a Buffer so file.raw is genuine bytes (binary
  // include-filters depend on this). The loader derives the decoded string via
  // raw.toString('utf8').
  return fs.readFileSync(filename);
}

function validateOptions(options) {
  if (typeof options !== 'object') {
    throw new TypeError('options must be an object');
  }
  if (typeof options.lex !== 'function') {
    throw new TypeError('options.lex must be a function');
  }
  if (typeof options.parse !== 'function') {
    throw new TypeError('options.parse must be a function');
  }
  if (options.resolve && typeof options.resolve !== 'function') {
    throw new TypeError('options.resolve must be a function');
  }
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
