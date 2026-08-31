var path = require('node:path');
var {runFilterCases} = require('../../../../test/helpers/filter-plugin-case');

var casesDirectory = path.join(__dirname, 'cases');
runFilterCases(casesDirectory, {
  'language-argument.pg': {
    fragment: [/hljs-built_in/, /hljs-number/],
    document: [/<code class="hljs language-scheme">/],
  },
  'language-subset-argument.pg': {
    fragment: [/hljs-meta/, /hljs-string/],
    document: [/<code class="hljs">/],
  },
  'syntax-highlighting-works.pg': {
    fragment: [/hljs-keyword/, /hljs-attr/],
    document: [/<code class="hljs">/],
  },
});
