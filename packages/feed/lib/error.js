const makeError = require('pugneum-error');

// Feed errors describe configuration, metadata, or filesystem failures rather
// than source-template locations. Omitting the location keeps pugneum-error
// from rendering a misleading filename/line/column header.
function feedError(code, message) {
  return makeError(code, message, {});
}

module.exports = feedError;
