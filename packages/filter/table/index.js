const normalize = require('./lib/normalize');
const parse = require('./lib/parse');
const generate = require('./lib/generate');
const error = require('pugneum-error');

exports.type = 'pugneum';

function snapshotLocation(value, fallback) {
  value = value && typeof value === 'object' ? value : {};
  return {
    filename:
      typeof value.filename === 'string' ? value.filename : fallback.filename,
    line: Number.isSafeInteger(value.line) ? value.line : fallback.line,
    column: Number.isSafeInteger(value.column) ? value.column : fallback.column,
    source: typeof value.source === 'string' ? value.source : fallback.source,
  };
}

function lineRecords(text, normalized, bodyOrigin) {
  const originalLines = text.split('\n');
  return normalized
    .split('\n')
    .map(function (line, index) {
      const firstContent = originalLines[index].search(/\S/);
      return {
        text: line.trim(),
        location: {
          filename: bodyOrigin.filename,
          line: bodyOrigin.line + index,
          column: bodyOrigin.column + Math.max(0, firstContent),
          source: bodyOrigin.source,
        },
      };
    })
    .filter(function (record) {
      return record.text.length > 0;
    });
}

exports.filter = function pugneum_filter_table(text, attributes, context) {
  if (typeof text !== 'string') {
    throw error(
      'INVALID_TABLE_INPUT',
      'table body must be a string',
      context && context.invocation,
    );
  }
  if (attributes === undefined) attributes = Object.create(null);
  if (
    attributes === null ||
    typeof attributes !== 'object' ||
    Array.isArray(attributes)
  ) {
    throw error(
      'INVALID_TABLE_ATTRIBUTES',
      'table attributes must be an object when provided',
      context && context.invocation,
    );
  }

  const directLocation = {
    filename:
      typeof attributes.filename === 'string' ? attributes.filename : undefined,
    line: 1,
    column: 1,
    source: text,
  };
  const invocationLocation = snapshotLocation(
    context && context.invocation,
    directLocation,
  );
  const bodyOrigin = snapshotLocation(
    context && context.body,
    invocationLocation,
  );
  const lines = lineRecords(text, normalize(text), bodyOrigin);

  if (lines.length === 0) {
    // Keep the explanation concise: the stable code already identifies the
    // table boundary, and filterer preserves coded plugin diagnostics intact.
    throw error('EMPTY_TABLE', 'empty table body', invocationLocation);
  }

  const parsed = parse(lines);

  const hasRows = parsed.sections.some(function (s) {
    return s.rows.length > 0;
  });
  if (!hasRows) {
    throw error(
      'TABLE_WITHOUT_ROWS',
      'no data rows found',
      parsed.lastLocation || bodyOrigin,
    );
  }

  return generate(parsed, attributes, invocationLocation);
};
