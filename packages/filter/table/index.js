const normalize = require('./lib/normalize');
const parse = require('./lib/parse');
const generate = require('./lib/generate');

exports.type = 'pugneum';

exports.filter = function pugneum_filter_table(text, attributes) {
  text = normalize(text);

  // Split into non-empty trimmed lines.
  const lines = text
    .split('\n')
    .map(function (line) {
      return line.trim();
    })
    .filter(function (line) {
      return line.length > 0;
    });

  if (lines.length === 0) {
    // The filterer wraps thrown messages as "Filter 'table' failed: <message>",
    // so a "Table filter:" prefix here would stutter; keep messages bare like
    // the ones thrown from lib/parse.js.
    throw new Error('empty table body');
  }

  const parsed = parse(lines);

  const hasRows = parsed.sections.some(function (s) {
    return s.rows.length > 0;
  });
  if (!hasRows) {
    throw new Error('no data rows found');
  }

  return generate(parsed, attributes);
};
