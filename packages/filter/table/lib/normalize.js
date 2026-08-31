const classifySeparatorLine = require('./parse').classifySeparatorLine;

const BOX_GLYPHS = new Set('│║─═├┤┼╠╣╬┌┐└┘┬┴╔╗╚╝╦╩');

const VERTICAL = {
  '│': '|',
  '║': '||',
};

const DOUBLE_VERTICAL = {
  '║': '||',
};

const SEPARATOR = {
  ...VERTICAL,
  '─': '-',
  '═': '=',
  '├': '|',
  '┤': '|',
  '┼': '|',
  '╠': '||',
  '╣': '||',
  '╬': '||',
};

const BOX_ROW_SEPARATOR = {...VERTICAL, '─': '-', '═': '='};
const ASCII_ROW_SEPARATOR = {...DOUBLE_VERTICAL, '─': '-', '═': '='};

// Top and bottom borders carry no table data. Keep the accepted forms exact so
// a decorative glyph embedded in ordinary text cannot make that text vanish.
const OUTER_BORDER =
  /^(?:┌─+(?:┬─+)*┐|└─+(?:┴─+)*┘|╔═+(?:╦═+)*╗|╚═+(?:╩═+)*╝)$/;

function rewriteGlyphs(line, replacements) {
  let result = '';
  let i = 0;

  while (i < line.length) {
    if (line[i] === '\\') {
      const start = i;
      while (line[i] === '\\') i++;
      const count = i - start;
      const glyph = line[i];

      if (BOX_GLYPHS.has(glyph) && count % 2 === 1) {
        result += '\\'.repeat(count - 1) + glyph;
        i++;
        continue;
      }

      result += '\\'.repeat(count);
      continue;
    }

    result += replacements[line[i]] || line[i];
    i++;
  }

  return result;
}

function isBoxRow(trimmed) {
  return (
    trimmed.length >= 2 &&
    (trimmed[0] === '│' || trimmed[0] === '║') &&
    (trimmed[trimmed.length - 1] === '│' || trimmed[trimmed.length - 1] === '║')
  );
}

function isBoxSeparatorBorder(trimmed) {
  return (
    trimmed.length >= 2 &&
    (trimmed[0] === '├' || trimmed[0] === '╠') &&
    (trimmed[trimmed.length - 1] === '┤' || trimmed[trimmed.length - 1] === '╣')
  );
}

function normalizeLine(line) {
  const trimmed = line.trim();
  if (OUTER_BORDER.test(trimmed)) return '';

  if (isBoxSeparatorBorder(trimmed)) {
    const candidate = rewriteGlyphs(line, SEPARATOR);
    if (classifySeparatorLine(candidate)) return candidate;
    return line;
  }

  const boxRow = isBoxRow(trimmed);
  if (!boxRow && !line.includes('|')) return line;

  // Horizontal glyphs are structural only when the complete row is a valid
  // separator. In data rows they remain ordinary payload. A single-line
  // vertical is structural only for a box-framed row; the double vertical keeps
  // its historical colgroup-boundary role in mixed ASCII/box rows.
  const rowReplacements = boxRow ? VERTICAL : DOUBLE_VERTICAL;
  const separatorCandidate = rewriteGlyphs(
    line,
    boxRow ? BOX_ROW_SEPARATOR : ASCII_ROW_SEPARATOR,
  );
  if (classifySeparatorLine(separatorCandidate)) return separatorCandidate;

  return rewriteGlyphs(line, rowReplacements);
}

module.exports = function normalize(text) {
  return text.split('\n').map(normalizeLine).join('\n');
};
