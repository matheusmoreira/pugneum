var path = require('node:path');
var {runFilterCases} = require('../../../../test/helpers/filter-plugin-case');

var casesDirectory = path.join(__dirname, 'cases');
runFilterCases(casesDirectory, {
  'syntax-highlighting-works.pg': {
    fragment: [/token keyword/, /token function/],
    document: [
      /<pre class="language-javascript"><code class="language-javascript">/,
    ],
  },
});
