// https://www.npmjs.com/package/prismjs
// https://prismjs.com/docs/
// https://github.com/PrismJS/prism
// https://github.com/PrismJS/prism/blob/master/prism.js

// Hopefully I'll be able to replace this with v2 when it's released.
// https://github.com/matheusmoreira/prism-minmaxed

const Prism = require('prism-minmaxed');

exports.filter = function pugneum_filter_prismjs(text, attributes) {
  const { language } = attributes;
  const grammar = Prism.languages[language];
  return Prism.highlight(text, grammar, language);
}
