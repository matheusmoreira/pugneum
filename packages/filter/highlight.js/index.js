exports.type = 'html';

// https://github.com/highlightjs/highlight.js/blob/main/src/highlight.js

const hljs = require('highlight.js');
const error = require('pugneum-error');

const optionNames = new Set([
  'filename',
  'language',
  'languageSubset',
  'ignoreIllegals',
]);
const MAX_SUBSET_LENGTH = 1024;
const MAX_SUBSET_LANGUAGES = 32;
const DEFAULT_LANGUAGE_SUBSET = Object.freeze([
  'bash',
  'c',
  'cpp',
  'css',
  'go',
  'java',
  'javascript',
  'json',
  'markdown',
  'python',
  'ruby',
  'rust',
  'sql',
  'typescript',
  'xml',
  'yaml',
]);

function optionError(message, context) {
  return error(
    'INVALID_HIGHLIGHT_OPTION',
    message,
    context && context.invocation,
  );
}

function normalizeAttributes(attributes, context) {
  if (attributes === undefined) return Object.create(null);
  if (
    attributes === null ||
    typeof attributes !== 'object' ||
    Array.isArray(attributes)
  ) {
    throw optionError('highlight attributes must be an object', context);
  }
  const normalized = Object.create(null);
  for (const name of Object.keys(attributes)) {
    if (!optionNames.has(name)) {
      throw optionError('unknown highlight option: ' + name, context);
    }
    normalized[name] = attributes[name];
  }
  return normalized;
}

// Filter attribute values arrive as strings, or the boolean `true` for a bare
// valueless attribute (e.g. `:highlight(ignoreIllegals)`). Normalize the four
// documented boolean representations and reject everything else.
// Without this, `ignoreIllegals=false` arrives as the string "false", which is
// truthy and would enable permissive ignore-illegals mode (disabling strict
// behavior) — the opposite of the author's intent.
function normalizeBoolean(value, name, context) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw optionError(name + ' must be true or false', context);
}

// Require a string for an attribute that names a language / subset. A bare flag
// (boolean true) or other non-string would otherwise reach hljs as a non-string
// and throw an opaque library TypeError; fail with a clear message instead.
function requireString(value, name, context) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw optionError(name + ' must be a nonempty string', context);
  }
  return value;
}

function normalizeLanguage(value, name, context) {
  const language = requireString(value, name, context).trim().toLowerCase();
  if (!hljs.getLanguage(language)) {
    throw optionError(
      'Unknown language in ' + name + ': "' + language + '"',
      context,
    );
  }
  return language;
}

function normalizeSubset(value, context) {
  const source = requireString(value, 'languageSubset', context);
  if (source.length > MAX_SUBSET_LENGTH) {
    throw optionError(
      'languageSubset exceeds the maximum length of ' + MAX_SUBSET_LENGTH,
      context,
    );
  }

  const languages = [];
  const grammars = new Set();
  for (const token of source.split(',')) {
    const name = token.trim().toLowerCase();
    if (name === '') {
      throw optionError('languageSubset cannot contain empty entries', context);
    }
    const grammar = hljs.getLanguage(name);
    if (!grammar) {
      throw optionError(
        'Unknown language in languageSubset: "' + name + '"',
        context,
      );
    }
    if (grammars.has(grammar)) continue;
    grammars.add(grammar);
    languages.push(name);
    if (languages.length > MAX_SUBSET_LANGUAGES) {
      throw optionError(
        'languageSubset cannot contain more than ' +
          MAX_SUBSET_LANGUAGES +
          ' languages',
        context,
      );
    }
  }
  return languages;
}

exports.filter = function pugneum_filter_highlightjs(
  text,
  attributes,
  context,
) {
  attributes = normalizeAttributes(attributes, context);
  const {language, languageSubset, ignoreIllegals} = attributes;
  const hasLanguage = language !== undefined;
  const hasSubset = languageSubset !== undefined;
  const hasIgnoreIllegals = ignoreIllegals !== undefined;

  if (hasLanguage) {
    if (hasSubset) {
      throw optionError(
        'languageSubset cannot be used with an explicit language',
        context,
      );
    }
    const options = {
      language: normalizeLanguage(language, 'language', context),
      ignoreIllegals: hasIgnoreIllegals
        ? normalizeBoolean(ignoreIllegals, 'ignoreIllegals', context)
        : false,
    };
    return hljs.highlight(text, options).value;
  }

  if (hasIgnoreIllegals) {
    throw optionError('ignoreIllegals requires an explicit language', context);
  }
  const subset = hasSubset
    ? normalizeSubset(languageSubset, context)
    : DEFAULT_LANGUAGE_SUBSET;
  return hljs.highlightAuto(text, subset).value;
};
