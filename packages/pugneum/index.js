const fs = require('fs');
const path = require('path');
const resolve = path.resolve;

const lex = require('pugneum-lexer');
const parse = require('pugneum-parser');
const load = require('pugneum-loader');
const link = require('pugneum-linker');
const filter = require('pugneum-filterer');
const render = require('pugneum-renderer');
const error = require('pugneum-error');

function isMutableArray(value) {
  return (
    Array.isArray(value) &&
    Object.isExtensible(value) &&
    Object.getOwnPropertyDescriptor(value, 'length').writable
  );
}

function normalizeOptions(options, overrides) {
  if (options == null) options = {};
  if (
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.prototype.toString.call(options) !== '[object Object]'
  ) {
    throw new TypeError('Expected "options" to be an object-like option bag');
  }

  const hasWarnings = Object.prototype.hasOwnProperty.call(options, 'warnings');
  const warnings = hasWarnings ? options.warnings : undefined;
  if (hasWarnings && !isMutableArray(warnings)) {
    throw new TypeError('Expected "options.warnings" to be a mutable array');
  }

  const normalized = {};
  for (const key of Reflect.ownKeys(options)) {
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (descriptor && descriptor.enumerable && key !== 'warnings') {
      normalized[key] = options[key];
    }
  }
  Object.assign(normalized, overrides);
  // Object.assign intentionally ignores non-enumerable properties. Warning
  // ownership, however, is defined by an own property, so preserve that sink
  // explicitly while ignoring a collector inherited from a prototype.
  if (hasWarnings) normalized.warnings = warnings;

  return {options: normalized, ownsWarnings: !hasWarnings};
}

function renderPugneum(string, options) {
  // If the caller supplies a warnings array we collect into it and let them
  // surface the diagnostics; otherwise we own them and emit them ourselves so
  // nothing fails silently.
  const normalized = normalizeOptions(options, {
    source: string,
    lex: lex,
    parse: parse,
  });
  const ownsWarnings = normalized.ownsWarnings;
  options = normalized.options;
  if (ownsWarnings) options.warnings = [];

  try {
    let tokens = lex(string, options);
    let ast = parse(tokens, options);
    let loaded = load(ast, options);
    // Assemble (inheritance/includes) BEFORE filtering, then resolve
    // references/footnotes/toc AFTER, so constructs a pugneum-type filter emits
    // (e.g. @[ref]/^[fn]/toc in a table cell) join the document-level resolution.
    let assembled = link.assemble(loaded, options);
    let filtered = filter(assembled, options.filters, options);
    let resolved = link.resolve(filtered, options);
    let rendered = render(resolved, options);
    return rendered;
  } finally {
    try {
      // Emit even on the error path: warnings collected from earlier stages
      // must not be discarded just because a later stage threw. (When the
      // caller owns the array they handle emission and we stay silent.)
      if (ownsWarnings) emitWarnings(options.warnings);
    } finally {
      // Source indexes are useful while one synchronous compilation produces
      // several diagnostics, but completed calls must not retain their source
      // text through module-global formatter state.
      error.clearSourceCache();
    }
  }
}

function warningKey(warning) {
  // Join on NUL: the only separator that cannot appear in a code, filename, or
  // message, so distinct diagnostics never collide. The message is part of the
  // identity of "the same warning" — two warnings sharing a code+location but
  // differing in detail must not collapse into one.
  return [
    warning.code,
    warning.filename,
    warning.line,
    warning.column,
    warning.message,
  ].join('\0');
}

function validateWarnings(warnings) {
  if (!Array.isArray(warnings)) {
    throw new TypeError('Expected "warnings" to be an array');
  }

  const validated = new Array(warnings.length);
  for (let i = 0; i < warnings.length; i++) {
    const warning = warnings[i];
    if (!warning || typeof warning !== 'object' || Array.isArray(warning)) {
      throw new TypeError(`Expected warning at index ${i} to be an object`);
    }

    const code = warning.code;
    const message = warning.message;
    const filename = warning.filename;
    const line = warning.line;
    const column = warning.column;
    if (typeof code !== 'string' || code.length === 0) {
      throw new TypeError(
        `Expected warning at index ${i} to have a non-empty string code`,
      );
    }
    if (typeof message !== 'string') {
      throw new TypeError(
        `Expected warning at index ${i} to have a string message`,
      );
    }
    if (filename !== undefined && typeof filename !== 'string') {
      throw new TypeError(
        `Expected warning at index ${i} to have a string filename`,
      );
    }
    if (line !== undefined && (!Number.isSafeInteger(line) || line < 1)) {
      throw new TypeError(
        `Expected warning at index ${i} to have a positive integer line`,
      );
    }
    if (column !== undefined && (!Number.isSafeInteger(column) || column < 1)) {
      throw new TypeError(
        `Expected warning at index ${i} to have a positive integer column`,
      );
    }

    validated[i] = {code, message, filename, line, column};
  }
  return validated;
}

// Print each distinct diagnostic once. Dedup is an emission concern: one
// shared array is threaded through every file in a build, so a layout included
// by many pages collects the same warning once per page. Deduping here, rather
// than after every render, keeps collection linear over the whole build.
function emitWarnings(warnings) {
  warnings = validateWarnings(warnings);
  const seen = new Set();
  for (let i = 0; i < warnings.length; i++) {
    const key = warningKey(warnings[i]);
    if (seen.has(key)) continue;
    seen.add(key);
    // The PUGNEUM: namespace is an internal routing token (the error path never
    // shows it to users); strip it from the displayed warning header to match.
    const code = warnings[i].code.replace(/^PUGNEUM:/, '');
    process.stderr.write('warning ' + code + '\n');
    process.stderr.write(warnings[i].message + '\n\n');
  }
}

function renderPugneumFile(filename, options) {
  options = normalizeOptions(options).options;
  filename = resolve(filename);
  const source = fs.readFileSync(filename, 'utf8');
  options.filename = filename;
  return renderPugneum(source, options);
}

exports.render = renderPugneum;
exports.renderFile = renderPugneumFile;
exports.emitWarnings = emitWarnings;
