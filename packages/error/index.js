module.exports = makeError;
module.exports.warning = makeWarning;

function formatMessage(message, options) {
  const line = options.line;
  const column = options.column;
  const filename = options.filename;
  const src = options.source;
  const location = line + (column ? ':' + column : '');
  if (src && line >= 1 && line <= src.split('\n').length) {
    const lines = src.split('\n');
    const start = Math.max(line - 3, 0);
    const end = Math.min(lines.length, line + 3);
    // Source context
    const context = lines
      .slice(start, end)
      .map(function (text, i) {
        const curr = i + start + 1;
        const preamble = (curr === line ? '  > ' : '    ') + curr + '| ';
        let out = preamble + text;
        if (curr === line && column > 0) {
          out += '\n';
          out += Array(preamble.length + column).join('-') + '^';
        }
        return out;
      })
      .join('\n');
    return (
      (filename ? filename + ':' : '') +
      location +
      '\n' +
      context +
      '\n\n' +
      message
    );
  }
  return (filename ? filename + ':' : '') + location + '\n\n' + message;
}

function toJSON() {
  return {
    code: this.code,
    msg: this.msg,
    line: this.line,
    column: this.column,
    filename: this.filename,
  };
}

function makeError(code, message, options = {}) {
  const err = new Error(formatMessage(message, options));
  err.code = 'PUGNEUM:' + code;
  err.msg = message;
  err.line = options.line;
  err.column = options.column;
  err.filename = options.filename;
  err.source = options.source;
  err.toJSON = toJSON;
  return err;
}

function makeWarning(code, message, options = {}) {
  return {
    code: 'PUGNEUM:' + code,
    msg: message,
    message: formatMessage(message, options),
    line: options.line,
    column: options.column,
    filename: options.filename,
    source: options.source,
    toJSON: toJSON,
  };
}
