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
    throw new Error('Table filter: empty table body');
  }

  const parsed = parse(lines);

  const hasRows = parsed.sections.some(function (s) {
    return s.rows.length > 0;
  });
  if (!hasRows) {
    throw new Error('Table filter: no data rows found');
  }

  return generate(parsed, attributes);
};
