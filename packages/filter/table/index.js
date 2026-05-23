'use strict';

var normalize = require('./lib/normalize');
var parse = require('./lib/parse');
var generate = require('./lib/generate');

exports.type = 'pugneum';

exports.filter = function pugneum_filter_table(text, attrs) {
  text = normalize(text);

  // Split into non-empty trimmed lines.
  var lines = text
    .split('\n')
    .map(function (line) {
      return line.trim();
    })
    .filter(function (line) {
      return line.length > 0;
    });

  if (lines.length === 0) {
    throw new Error('Table filter: empty table body');
  }

  var parsed = parse(lines);

  var hasRows = parsed.sections.some(function (s) {
    return s.rows.length > 0;
  });
  if (!hasRows) {
    throw new Error('Table filter: no data rows found');
  }

  return generate(parsed, attrs);
};
