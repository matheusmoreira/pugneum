module.exports = makeError;

function makeError(code, message, options) {
  const line = options.line;
  const column = options.column;
  const filename = options.filename;
  const src = options.source;
  let fullMessage;
  const location = line + (column ? ':' + column : '');
  if (src && line >= 1 && line <= src.split('\n').length) {
    const lines = src.split('\n');
    const start = Math.max(line - 3, 0);
    const end = Math.min(lines.length, line + 3);
    // Error context
    const context = lines
      .slice(start, end)
      .map(function (text, i) {
        const curr = i + start + 1;
        const preamble = (curr == line ? '  > ' : '    ') + curr + '| ';
        let out = preamble + text;
        if (curr === line && column > 0) {
          out += '\n';
          out += Array(preamble.length + column).join('-') + '^';
        }
        return out;
      })
      .join('\n');
    fullMessage =
      (filename ? filename + ':' : '') +
      location +
      '\n' +
      context +
      '\n\n' +
      message;
  } else {
    fullMessage =
      (filename ? filename + ':' : '') + location + '\n\n' + message;
  }
  const err = new Error(fullMessage);
  err.code = 'PUGNEUM:' + code;
  err.msg = message;
  err.line = line;
  err.column = column;
  err.filename = filename;
  err.source = src;
  err.toJSON = function () {
    return {
      code: this.code,
      msg: this.msg,
      line: this.line,
      column: this.column,
      filename: this.filename,
    };
  };
  return err;
}
