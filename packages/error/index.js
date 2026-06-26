module.exports = makeError;
module.exports.warning = makeWarning;

function formatMessage(message, options) {
  // Normalize line/column to numbers for all internal comparisons and
  // arithmetic; the raw values are still copied onto the result object so the
  // public shape is unchanged. NaN (missing/non-numeric) is falsy and never
  // satisfies the `>= 1`/`> 0` guards, so it degrades cleanly.
  const line = Number(options.line);
  const column = Number(options.column);
  const filename = options.filename;
  const src = options.source;
  // Build the `filename:line:column` header from present parts so a missing
  // line never renders the literal string "undefined" and an absent filename
  // never leaves a dangling colon.
  const parts = [];
  if (filename) parts.push(filename);
  if (Number.isFinite(line)) {
    parts.push(line + (column ? ':' + column : ''));
  }
  const header = parts.join(':');
  const lines = typeof src === 'string' ? src.split('\n') : null;
  if (lines && line >= 1 && line <= lines.length) {
    const start = Math.max(line - 4, 0);
    const end = Math.min(lines.length, line + 3);
    // Source context
    const context = lines
      .slice(start, end)
      .map(function (text, i) {
        const curr = i + start + 1;
        const preamble = (curr === line ? '  > ' : '    ') + curr + '| ';
        let out = preamble + text;
        if (curr === line && column > 0) {
          const dashes = Math.max(0, Math.floor(preamble.length + column) - 1);
          out += '\n';
          out += '-'.repeat(dashes) + '^';
        }
        return out;
      })
      .join('\n');
    return header + '\n' + context + '\n\n' + message;
  }
  return header ? header + '\n\n' + message : message;
}

function toJSON() {
  // source and the formatted message are intentionally excluded: source would
  // dump whole files into serialized logs, and message is reconstructible from
  // msg/line/column.
  return {
    code: this.code,
    msg: this.msg,
    line: this.line,
    column: this.column,
    filename: this.filename,
  };
}

// Common fields shared by both factories so a future field never has to be
// mirrored in two places (and the two shapes cannot drift apart).
function fields(code, message, options) {
  return {
    code: 'PUGNEUM:' + code,
    msg: message,
    line: options.line,
    column: options.column,
    filename: options.filename,
    source: options.source,
    toJSON: toJSON,
  };
}

function makeError(code, message, options) {
  options = options || {};
  const err = new Error(formatMessage(message, options));
  return Object.assign(err, fields(code, message, options));
}

function makeWarning(code, message, options) {
  options = options || {};
  return Object.assign(fields(code, message, options), {
    message: formatMessage(message, options),
  });
}
