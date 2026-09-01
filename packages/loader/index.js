'use strict';

const fs = require('fs');
const path = require('path');
const walk = require('pugneum-walker');
const makeError = require('pugneum-error');
const attributeInterpolationSource = Symbol.for(
  'pugneum.attributeInterpolationSource',
);

module.exports = load;
module.exports.resolve = resolve;
module.exports.loadOwned = loadOwned;

// Maximum include/extends recursion depth. Mirrors the parser's
// MAX_PARSE_DEPTH and the linker's DEFAULT_MAX_LINK_DEPTH so that a deep
// (non-cyclic) include chain aborts with a coded PUGNEUM error instead of
// overflowing the native call stack with an uncatchable RangeError.
const DEFAULT_MAX_LOAD_DEPTH = 256;
const loadState = Symbol('pugneumLoaderState');

// Resolve/resolveLibrary throw before they have access to the AST node, so
// they cannot supply a real source location. load()'s catch re-stamps the
// node's real line/column/filename/source onto these errors (see loadAST), so
// the placeholder location below is only ever seen by direct callers of the
// exported resolve() helper, which the README documents as taking no node.
function zeroLoc() {
  return {};
}

function locationFor(options, node) {
  return {
    line: node.line,
    column: node.column,
    filename: node.filename || options.filename,
    source: sourceFor(options, node),
  };
}

function attachCause(diagnostic, cause) {
  Object.defineProperty(diagnostic, 'cause', {
    configurable: true,
    value: cause,
  });
  return diagnostic;
}

function thrownProperty(thrown, key) {
  if (
    thrown == null ||
    (typeof thrown !== 'object' && typeof thrown !== 'function')
  ) {
    return undefined;
  }
  try {
    return thrown[key];
  } catch (_error) {
    return undefined;
  }
}

function thrownDetail(thrown) {
  const msg = thrownProperty(thrown, 'msg');
  if (msg !== undefined) return safeString(msg);
  const message = thrownProperty(thrown, 'message');
  if (message !== undefined) return safeString(message);
  return safeString(thrown);
}

function safeString(value) {
  try {
    return String(value);
  } catch (_error) {
    return '[unprintable thrown value]';
  }
}

function wrapLoadFailure(failure, options, node) {
  const failureCode = thrownProperty(failure, 'code');
  const code =
    typeof failureCode === 'string' && failureCode.startsWith('PUGNEUM:')
      ? failureCode.slice('PUGNEUM:'.length)
      : 'LOAD_ERROR';
  return attachCause(
    makeError(code, thrownDetail(failure), locationFor(options, node)),
    failure,
  );
}

function registerSource(sources, filename, source) {
  Object.defineProperty(sources, filename, {
    configurable: true,
    enumerable: true,
    value: source,
    writable: true,
  });
}

// structuredClone deliberately copies only enumerable string-keyed fields.
// Attribute interpolation provenance is private parser metadata, so restore
// that symbol on the cloned graph without exposing it in the public AST shape.
function transferAttributeInterpolationSources(source, target) {
  const pending = [[source, target]];
  const seen = new WeakSet();

  while (pending.length > 0) {
    const [current, copy] = pending.pop();
    if (current === null || typeof current !== 'object' || seen.has(current)) {
      continue;
    }
    seen.add(current);

    const descriptor = Object.getOwnPropertyDescriptor(
      current,
      attributeInterpolationSource,
    );
    if (descriptor) {
      Object.defineProperty(copy, attributeInterpolationSource, descriptor);
    }

    for (const key of Object.keys(current)) {
      const child = current[key];
      if (child !== null && typeof child === 'object') {
        pending.push([child, copy[key]]);
      }
    }
  }
}

function cloneAST(ast) {
  const copy = structuredClone(ast);
  transferAttributeInterpolationSources(ast, copy);
  return copy;
}

function load(ast, options) {
  return loadWithOwnership(ast, options, false);
}

function loadOwned(ast, options) {
  return loadWithOwnership(ast, options, true);
}

function loadWithOwnership(ast, options, ownsAst) {
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
  if (options.sources === undefined) {
    options.sources = Object.create(null);
  }
  if (options.filename !== undefined && options.source !== undefined) {
    registerSource(options.sources, options.filename, options.source);
  }
  options = getOptions(options);
  // Clone the caller's AST once: walk() mutates nodes in place, and the input
  // tree belongs to the caller. Recursive loads work on freshly-parsed,
  // single-owner ASTs and are not cloned again (see loadAST).
  if (!ownsAst) ast = cloneAST(ast);
  const state = options[loadState];
  const entryFilename = options.filename || ast.filename;
  if (entryFilename) {
    try {
      state.visiting.add(canonicalIdentity(entryFilename, options));
    } catch (failure) {
      throw wrapLoadFailure(failure, options, ast);
    }
  }
  try {
    return loadAST(ast, options, 0);
  } catch (failure) {
    if (thrownProperty(failure, 'code') !== 'INVALID_AST') throw failure;
    const failureNode = thrownProperty(failure, 'node') || ast;
    throw attachCause(
      makeError('INVALID_AST', thrownDetail(failure), {
        line: thrownProperty(failure, 'line'),
        column: thrownProperty(failure, 'column'),
        filename: thrownProperty(failure, 'filename') || options.filename,
        source: sourceFor(options, failureNode),
      }),
      failure,
    );
  }
}

function loadAST(ast, options, depth) {
  return walk(ast, function (node) {
    if (!node.filename && options.filename) node.filename = options.filename;
    if (
      node.type === 'Include' ||
      node.type === 'RawInclude' ||
      node.type === 'Extends'
    ) {
      const file = node.file;
      if (
        file == null ||
        typeof file !== 'object' ||
        Array.isArray(file) ||
        file.type !== 'FileReference'
      ) {
        throw makeError(
          'INVALID_AST',
          'Expected file.type to be "FileReference"',
          locationFor(options, node),
        );
      }
      const structured = node.type === 'Extends' || node.type === 'Include';
      const maxDepth = options.maxLoadDepth;
      if (structured && depth >= maxDepth) {
        throw makeError(
          'LOAD_DEPTH_EXCEEDED',
          'Include/extends chain exceeds maximum depth of ' + maxDepth,
          locationFor(options, node),
        );
      }

      const fromFilename = file.filename || node.filename || options.filename;
      if (!file.filename && fromFilename) file.filename = fromFilename;
      let filePath;
      let canonical;
      try {
        filePath = validateResolvedPath(
          options.resolve(file.path, fromFilename, options),
        );
        // `basedir` remains the filesystem boundary even when a caller
        // supplies a custom resolver. Library references deliberately select
        // an installed package outside that project boundary and are checked
        // against their package root by the default resolver instead.
        if (
          options.resolve !== resolve &&
          options.basedir &&
          file.path[0] !== '@'
        ) {
          filePath = assertWithin(
            filePath,
            options.basedir,
            'Include path escapes project root: ' + filePath,
            options,
          );
        }
        if (structured || options.dependencyCache) {
          canonical = canonicalIdentity(filePath, options);
        }
      } catch (ex) {
        throw wrapLoadFailure(ex, options, node);
      }

      const visiting = options[loadState].visiting;
      if (structured && visiting.has(canonical)) {
        throw makeError(
          'CIRCULAR_DEPENDENCY',
          'Circular dependency detected: ' +
            canonical +
            ' is already being loaded',
          locationFor(options, node),
        );
      }

      if (structured) visiting.add(canonical);
      try {
        let raw;
        let cacheEntry;
        const cache = options.dependencyCache;
        if (cache && cache.has(canonical)) {
          cacheEntry = cache.get(canonical);
          if (
            cacheEntry === null ||
            typeof cacheEntry !== 'object' ||
            !Buffer.isBuffer(cacheEntry.raw)
          ) {
            throw new TypeError(
              'options.dependencyCache contains an invalid loader entry',
            );
          }
          raw = Buffer.from(cacheEntry.raw);
        } else {
          try {
            raw = normalizeReadResult(options.read(filePath, options));
          } catch (ex) {
            throw wrapLoadFailure(ex, options, node);
          }
          if (cache) {
            cacheEntry = {raw: Buffer.from(raw)};
            cache.set(canonical, cacheEntry);
          }
        }
        file.fullPath = filePath;
        if (node.type === 'RawInclude' && node.filters.length > 0) {
          attachLazyText(file, filePath, options.sources, cacheEntry);
          file.raw = raw;
        } else {
          const str =
            cacheEntry &&
            Object.prototype.hasOwnProperty.call(cacheEntry, 'str')
              ? cacheEntry.str
              : raw.toString('utf8');
          if (cacheEntry) cacheEntry.str = str;
          file.str = str;
          file.raw = raw;
          registerSource(options.sources, filePath, str);
        }

        if (structured) {
          const str = file.str;
          const opts = Object.assign({}, options, {
            filename: filePath,
            source: str,
          });
          Object.defineProperty(opts, loadState, {
            value: options[loadState],
          });
          let fileAst;
          if (
            cacheEntry &&
            Object.prototype.hasOwnProperty.call(cacheEntry, 'ast')
          ) {
            fileAst = cloneAST(cacheEntry.ast);
            if (Array.isArray(options.warnings) && cacheEntry.warnings) {
              for (const warning of cacheEntry.warnings) {
                options.warnings.push(Object.assign({}, warning));
              }
            }
          } else {
            const warningStart = Array.isArray(options.warnings)
              ? options.warnings.length
              : 0;
            const tokens = options.lex(str, opts);
            fileAst = options.parse(tokens, opts);
            if (cacheEntry) {
              cacheEntry.ast = cloneAST(fileAst);
              if (Array.isArray(options.warnings)) {
                cacheEntry.warnings = options.warnings
                  .slice(warningStart)
                  .map((warning) => Object.assign({}, warning));
              }
            }
          }
          file.ast = loadAST(fileAst, opts, depth + 1);
        }
      } finally {
        if (structured) visiting.delete(canonical);
      }
    }
  });
}

function validateResolvedPath(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new TypeError('resolve must return a non-empty string');
  }
  return filePath;
}

function normalizeReadResult(raw) {
  if (Buffer.isBuffer(raw)) return raw;
  if (typeof raw === 'string' || raw instanceof Uint8Array) {
    return Buffer.from(raw);
  }
  throw new TypeError('read must return a Buffer, Uint8Array, or string');
}

function attachLazyText(file, filePath, sources, cacheEntry) {
  Object.defineProperty(file, 'str', {
    configurable: true,
    enumerable: true,
    get() {
      const str =
        cacheEntry && Object.prototype.hasOwnProperty.call(cacheEntry, 'str')
          ? cacheEntry.str
          : this.raw.toString('utf8');
      if (cacheEntry) cacheEntry.str = str;
      Object.defineProperty(this, 'str', {
        configurable: true,
        enumerable: true,
        value: str,
        writable: true,
      });
      registerSource(sources, filePath, str);
      return str;
    },
  });
}

// Resolve the source text for a node's error context, preferring the
// per-file `sources` map (keyed on the node's own filename, as the linker and
// renderer do) and falling back to the scalar current source.
function sourceFor(options, node) {
  const sources = options && options.sources;
  const filename = node.filename || options.filename;
  if (
    sources &&
    filename &&
    Object.prototype.hasOwnProperty.call(sources, filename)
  ) {
    return sources[filename];
  }
  return options.source;
}

// Is `resolved` contained within `base` (equal to it or a descendant)?
function isWithin(resolved, base) {
  const relative = path.relative(base, resolved);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith('..' + path.sep) &&
      !path.isAbsolute(relative))
  );
}

// Canonicalize a candidate path for containment checking. The target may not
// exist yet (e.g. an include of a not-yet-created file), so realpath the
// longest existing prefix and re-append the missing tail. This resolves any
// symlink inside the boundary — a symlink within the root that points outside
// it can no longer escape the containment check.
function realpathBoundary(candidate, options) {
  const cache = options && options[loadState] && options[loadState].realpaths;
  const cacheKey = path.resolve(candidate);
  if (cache && cache.has(cacheKey)) return cache.get(cacheKey);

  let current = path.resolve(candidate);
  const tail = [];
  for (;;) {
    try {
      const resolved = path.join(fs.realpathSync(current), ...tail.reverse());
      if (cache) {
        cache.set(cacheKey, resolved);
        // Default resolution returns the checked canonical path. Cache that
        // spelling too so cycle identity does not immediately realpath the
        // same target a second time.
        cache.set(resolved, resolved);
      }
      return resolved;
    } catch (e) {
      const parent = path.dirname(current);
      if (parent === current) {
        // Reached the filesystem root without finding an existing prefix;
        // fall back to the lexically-resolved path.
        const resolved = path.resolve(candidate);
        if (cache) cache.set(cacheKey, resolved);
        return resolved;
      }
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

// Throw PUGNEUM:PATH_ESCAPE if `candidate` resolves outside `baseDir`.
// Containment is checked against real (symlink-resolved) paths so a symlink
// inside the boundary cannot be used to escape it.
function assertWithin(candidate, baseDir, message, options) {
  const resolved = realpathBoundary(candidate, options);
  const base = realpathBoundary(baseDir, options);
  if (!isWithin(resolved, base)) {
    throw makeError('PATH_ESCAPE', message, zeroLoc());
  }
  return resolved;
}

function resolve(filename, source, options) {
  if (typeof filename !== 'string') {
    throw new TypeError('filename must be a string');
  }
  options = options || {};
  filename = filename.trim();

  if (filename[0] === '@') {
    return resolveLibrary(filename, source, options);
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
  const baseDir = isAbsolute
    ? path.resolve(options.basedir)
    : path.dirname(path.resolve(source.trim()));
  const resolved = isAbsolute
    ? path.resolve(baseDir, '.' + filename)
    : path.resolve(baseDir, filename);

  // Default-deny containment: include/extends must stay within basedir (the
  // project root — baseDirectory in the CLI config, which defaults to
  // inputDirectory). Absolute paths already require basedir; relative paths
  // must not climb out of it either. The only sanctioned way to reach content
  // outside the project is an npm-installed package via an @-prefixed library
  // include (resolveLibrary). When no basedir is configured (a programmatic
  // render with no build root), there is nothing to contain against, so the
  // relative include simply resolves against the including file's directory.
  if (options.basedir) {
    return assertWithin(
      resolved,
      options.basedir,
      'Include path escapes project root: ' + resolved,
      options,
    );
  }

  return resolved;
}

function resolveLibrary(filename, source, options) {
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

  const parts = rest.split('/');
  const scoped = rest[0] === '@';
  const pkg = scoped ? parts.slice(0, 2).join('/') : parts[0];
  const subpath = parts.slice(scoped ? 2 : 1).join('/');

  if (!validPackageName(pkg)) {
    const bareScope = scoped && validPackagePart(parts[0].slice(1));
    const suggestion = bareScope
      ? filename.replace(/\/+$/, '') + '/pkg/file.pg'
      : '';
    throw makeError(
      'INVALID_LIBRARY_PATH',
      'Library include has an invalid package name: ' +
        filename +
        (suggestion ? '\n    Use: ' + suggestion : ''),
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

  const normalizedSubpath = path.normalize(subpath);
  if (
    normalizedSubpath === '..' ||
    normalizedSubpath.startsWith('..' + path.sep) ||
    path.isAbsolute(normalizedSubpath)
  ) {
    throw makeError(
      'PATH_ESCAPE',
      'Library path escapes package directory: ' + filename,
      zeroLoc(),
    );
  }

  const lookupRoots = libraryLookupRoots(source, options);
  const request = pkg + '/' + subpath;
  let target;
  try {
    target = require.resolve(request, {paths: lookupRoots});
  } catch (failure) {
    const installedRoot = findInstalledPackageRoot(pkg, lookupRoots);
    if (installedRoot) {
      throw attachCause(
        makeError(
          'LIBRARY_PATH_UNAVAILABLE',
          'Could not resolve library path ' +
            request +
            ': ' +
            thrownDetail(failure),
          zeroLoc(),
        ),
        failure,
      );
    }
    throw attachCause(
      makeError(
        'PACKAGE_NOT_FOUND',
        'Package not found: ' +
          pkg +
          '\n    Install it with: npm install ' +
          pkg,
        zeroLoc(),
      ),
      failure,
    );
  }

  const pkgDir =
    findOwningPackageRoot(target, pkg) ||
    findInstalledPackageRoot(pkg, lookupRoots);
  if (!pkgDir) {
    throw makeError(
      'LIBRARY_PATH_UNAVAILABLE',
      'Could not establish package boundary for: ' + request,
      zeroLoc(),
    );
  }
  return assertWithin(
    target,
    pkgDir,
    'Library path escapes package directory: ' + filename,
    options,
  );
}

function validPackagePart(part) {
  return (
    typeof part === 'string' &&
    part.length > 0 &&
    part.length <= 214 &&
    !part.startsWith('.') &&
    !part.startsWith('_') &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part)
  );
}

function validPackageName(pkg) {
  if (pkg.length > 214) return false;
  if (pkg[0] !== '@') return validPackagePart(pkg);
  const parts = pkg.slice(1).split('/');
  return parts.length === 2 && parts.every(validPackagePart);
}

function libraryLookupRoots(source, options) {
  const roots = [];
  if (typeof source === 'string' && source.trim()) {
    roots.push(path.dirname(path.resolve(source.trim())));
  }
  if (typeof options.basedir === 'string' && options.basedir) {
    roots.push(path.resolve(options.basedir));
  }
  roots.push(process.cwd(), __dirname);
  return [...new Set(roots)];
}

function readPackageName(directory) {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(directory, 'package.json'), 'utf8'),
    );
    return manifest && manifest.name;
  } catch (_error) {
    return undefined;
  }
}

function findOwningPackageRoot(target, pkg) {
  let current = path.dirname(target);
  for (;;) {
    if (readPackageName(current) === pkg) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function findInstalledPackageRoot(pkg, roots) {
  const packageSegments = pkg.split('/');
  const checked = new Set();
  for (const root of roots) {
    let current = path.resolve(root);
    for (;;) {
      const candidate = path.join(current, 'node_modules', ...packageSegments);
      if (!checked.has(candidate)) {
        checked.add(candidate);
        try {
          const real = fs.realpathSync(candidate);
          if (
            fs.statSync(real).isDirectory() &&
            readPackageName(real) === pkg
          ) {
            return real;
          }
        } catch (_error) {
          // Keep searching the caller-rooted module path.
        }
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return undefined;
}

function read(filename) {
  // No encoding: return a Buffer so file.raw is genuine bytes (binary
  // include-filters depend on this). The loader derives the decoded string via
  // raw.toString('utf8').
  return fs.readFileSync(filename);
}

function canonicalizeFilesystem(filename, options) {
  return realpathBoundary(filename, options);
}

function canonicalizeOpaque(filename) {
  return filename;
}

function canonicalIdentity(filename, options) {
  const identity = options.canonicalize(filename, options);
  if (typeof identity !== 'string' || identity.length === 0) {
    throw new TypeError('canonicalize must return a non-empty string');
  }
  return identity;
}

function validateOptions(options) {
  if (
    options === null ||
    typeof options !== 'object' ||
    Array.isArray(options)
  ) {
    throw new TypeError('options must be an object (non-null and non-array)');
  }
  if (typeof options.lex !== 'function') {
    throw new TypeError('options.lex must be a function');
  }
  if (typeof options.parse !== 'function') {
    throw new TypeError('options.parse must be a function');
  }
  if (options.resolve !== undefined && typeof options.resolve !== 'function') {
    throw new TypeError('options.resolve must be a function');
  }
  if (options.read !== undefined && typeof options.read !== 'function') {
    throw new TypeError('options.read must be a function');
  }
  if (
    options.dependencyCache !== undefined &&
    !(options.dependencyCache instanceof Map)
  ) {
    throw new TypeError('options.dependencyCache must be a Map');
  }
  if (
    options.canonicalize !== undefined &&
    typeof options.canonicalize !== 'function'
  ) {
    throw new TypeError('options.canonicalize must be a function');
  }
  if (
    options.maxLoadDepth !== undefined &&
    (!Number.isSafeInteger(options.maxLoadDepth) ||
      options.maxLoadDepth < 0 ||
      options.maxLoadDepth > DEFAULT_MAX_LOAD_DEPTH)
  ) {
    throw new TypeError(
      'options.maxLoadDepth must be an integer from 0 through ' +
        DEFAULT_MAX_LOAD_DEPTH,
    );
  }
  for (const name of ['basedir', 'filename', 'source']) {
    if (options[name] !== undefined && typeof options[name] !== 'string') {
      throw new TypeError('options.' + name + ' must be a string');
    }
  }
  if (
    options.sources !== undefined &&
    (options.sources === null ||
      typeof options.sources !== 'object' ||
      Array.isArray(options.sources))
  ) {
    throw new TypeError('options.sources must be a non-null, non-array object');
  }
  if (options.sources !== undefined && !Object.isExtensible(options.sources)) {
    throw new TypeError('options.sources must be extensible');
  }
  if (options.sources === undefined && !Object.isExtensible(options)) {
    throw new TypeError('options must permit the sources output property');
  }
}

function getOptions(options) {
  const normalized = Object.assign({}, options);
  if (normalized.resolve === undefined) normalized.resolve = resolve;
  if (normalized.read === undefined) normalized.read = read;
  if (normalized.maxLoadDepth === undefined) {
    normalized.maxLoadDepth = DEFAULT_MAX_LOAD_DEPTH;
  }
  if (normalized.canonicalize === undefined) {
    normalized.canonicalize =
      normalized.resolve === resolve || normalized.basedir
        ? canonicalizeFilesystem
        : canonicalizeOpaque;
  }
  Object.defineProperty(normalized, loadState, {
    value: {realpaths: new Map(), visiting: new Set()},
  });
  return normalized;
}
