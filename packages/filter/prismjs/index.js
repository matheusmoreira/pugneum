exports.type = 'html';

// https://www.npmjs.com/package/prismjs
// https://prismjs.com/docs/
// https://github.com/PrismJS/prism
// https://github.com/PrismJS/prism/blob/master/prism.js

// Hopefully I'll be able to replace this with v2 when it's released.
// https://github.com/matheusmoreira/prism-minmaxed

const Prism = require('prism-minmaxed');

// Full HTML escaping for the no-language passthrough. Prism's own text encoder
// escapes only `&` and `<`, leaving `>` and `"` raw — inconsistent with both the
// with-language path and the highlight.js filter, which escape all four. This is
// type:'html' output (inserted raw by the filterer), so escape completely.
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

exports.filter = function pugneum_filter_prismjs(text, attributes) {
  const {language} = attributes;
  if (!language) {
    return escapeHtml(text);
  }
  // Use an own-property lookup: a bare `Prism.languages[language]` would resolve
  // inherited keys such as `__proto__` (=> Object.prototype, a truthy object)
  // and pass the guard, silently highlighting against an empty grammar instead
  // of reporting the unknown language.
  const grammar = Object.prototype.hasOwnProperty.call(
    Prism.languages,
    language,
  )
    ? Prism.languages[language]
    : undefined;
  if (!grammar || typeof grammar !== 'object') {
    throw new Error(`Unknown language: "${language}"`);
  }
  return Prism.highlight(text, grammar, language);
};
