// https://github.com/highlightjs/highlight.js/blob/main/src/highlight.js

hljs = require('highlight.js');

exports.filter = function pugneum_filter_highlightjs(text, attributes) {
  const { language, languageSubset, ignoreIllegals } = attributes;

  if (language) {
    const options = {language};

    if (ignoreIllegals) {
      options.ignoreIllegals = ignoreIllegals;
    }

    return hljs.highlight(text, options).value;

  } else {
    const args = [];

    if (languageSubset) {
      args.push(languageSubset.split(/, */));
    }

    return hljs.highlightAuto(text, ...args).value;
  }
}
