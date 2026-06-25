exports.type = 'html';

// https://github.com/highlightjs/highlight.js/blob/main/src/highlight.js

const hljs = require('highlight.js');

// Filter attribute values arrive as strings, or the boolean `true` for a bare
// valueless attribute (e.g. `:highlight(ignoreIllegals)`). Coerce a boolean-ish
// attribute: bare `true` and the string `"true"` mean on; anything else is off.
// Without this, `ignoreIllegals=false` arrives as the string "false", which is
// truthy, so strict mode would be ENABLED — the opposite of the author's intent.
function isEnabled(value) {
  return value === true || value === 'true';
}

// Require a string for an attribute that names a language / subset. A bare flag
// (boolean true) or other non-string would otherwise reach hljs as a non-string
// and throw an opaque library TypeError; fail with a clear message instead.
function requireString(value, name) {
  if (typeof value !== 'string') {
    throw new Error(name + ' must be a string');
  }
  return value;
}

exports.filter = function pugneum_filter_highlightjs(text, attributes) {
  const {language, languageSubset, ignoreIllegals} = attributes;

  // A non-empty `language` selects explicit highlighting; an empty/absent one
  // falls back to auto-detection (optionally narrowed by `languageSubset`).
  // When `language` IS given, `languageSubset` does not apply — hljs.highlight
  // takes a single language — so it is intentionally ignored on this branch.
  if (language) {
    const options = {language: requireString(language, 'language')};
    // Always set ignoreIllegals so `=false` truly disables it (hljs treats any
    // truthy value, including the string "false", as enabled).
    options.ignoreIllegals = isEnabled(ignoreIllegals);
    return hljs.highlight(text, options).value;
  } else {
    const args = [];
    if (languageSubset) {
      args.push(requireString(languageSubset, 'languageSubset').split(/, */));
    }
    return hljs.highlightAuto(text, ...args).value;
  }
};
