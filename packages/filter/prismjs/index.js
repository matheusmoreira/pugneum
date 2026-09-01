exports.type = 'html';

// https://www.npmjs.com/package/prism-minmaxed
// https://github.com/matheusmoreira/prism-minmaxed
//
// Prism Minmaxed is the server-only, all-language Prism bundle maintained for
// Pugneum. Revisit the bundle when Prism v2 is released.
//
// Upstream references:
// https://prismjs.com/docs/
// https://github.com/PrismJS/prism
// https://github.com/PrismJS/prism/blob/master/prism.js

const error = require('pugneum-error');
const escapeHtml = require('pugneum-filterer/escape-text');

const optionNames = new Set(['filename', 'language']);
let Prism;

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

function loadLanguage(language, context) {
  if (Prism === undefined) Prism = require('prism-minmaxed');
  // Use an own-property lookup: a bare `Prism.languages[language]` would
  // resolve inherited keys such as `__proto__` and silently highlight against
  // Object.prototype instead of reporting an unknown language.
  const grammar = Object.prototype.hasOwnProperty.call(
    Prism.languages,
    language,
  )
    ? Prism.languages[language]
    : undefined;
  if (!grammar || typeof grammar !== 'object') {
    throw optionError(`Unknown language: "${language}"`, context);
  }
  return grammar;
}

exports.filter = function pugneum_filter_prismjs(text, attributes, context) {
  attributes = normalizeAttributes(attributes, context);
  const {language} = attributes;
  if (language === undefined) {
    return escapeHtml(text);
  }
  if (typeof language !== 'string' || language.trim() === '') {
    throw optionError('language must be a nonempty string', context);
  }
  const normalizedLanguage = language.trim().toLowerCase();
  const grammar = loadLanguage(normalizedLanguage, context);
  return Prism.highlight(text, grammar, normalizedLanguage);
};
