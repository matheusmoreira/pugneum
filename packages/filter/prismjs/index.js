exports.type = 'html';

// https://www.npmjs.com/package/prismjs
// https://prismjs.com/docs/
// https://github.com/PrismJS/prism
// https://github.com/PrismJS/prism/blob/master/prism.js

// Hopefully I'll be able to replace this with v2 when it's released.
// https://github.com/matheusmoreira/prism-minmaxed

const error = require('pugneum-error');

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

function loadPrism() {
  if (Prism === undefined) Prism = require('prism-minmaxed');
  return Prism;
}

// Full HTML escaping for the no-language passthrough. This branch does not run
// Prism's tokenizer/encoder, so it follows Pugneum's four-character raw-HTML
// text policy directly; a language branch delegates token serialization to
// Prism and may use equivalent literal `>` / `"` bytes in element text.
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
  const prism = loadPrism();
  // Use an own-property lookup: a bare `Prism.languages[language]` would resolve
  // inherited keys such as `__proto__` (=> Object.prototype, a truthy object)
  // and pass the guard, silently highlighting against an empty grammar instead
  // of reporting the unknown language.
  const grammar = Object.prototype.hasOwnProperty.call(
    prism.languages,
    normalizedLanguage,
  )
    ? prism.languages[normalizedLanguage]
    : undefined;
  if (!grammar || typeof grammar !== 'object') {
    throw optionError(`Unknown language: "${normalizedLanguage}"`, context);
  }
  return prism.highlight(text, grammar, normalizedLanguage);
};
