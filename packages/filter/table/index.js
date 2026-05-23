'use strict';

exports.type = 'pugneum';

// Parse a pipe-delimited row into an array of trimmed cell strings.
// Returns null if the line has no pipe delimiters.
function parseRow(line) {
  if (!line.includes('|')) return null;
  var parts = line.split('|');
  // Trim leading and trailing empty segments (from leading/trailing pipes)
  var start = parts[0].trim() === '' ? 1 : 0;
  var end =
    parts[parts.length - 1].trim() === '' ? parts.length - 1 : parts.length;
  return parts.slice(start, end).map(function (cell) {
    return cell.trim();
  });
}

// A separator row has all cells matching /^-+$/ (only dashes after trim).
function isSeparatorRow(cells) {
  return (
    cells.length > 0 &&
    cells.every(function (cell) {
      return /^-+$/.test(cell);
    })
  );
}

// Format filter attributes (excluding filename) as a Pugneum attribute string.
// Returns '' if no relevant attrs, or '(key="value" ...)' otherwise.
function formatAttrs(attrs) {
  var pairs = [];
  Object.keys(attrs).forEach(function (key) {
    if (key === 'filename') return;
    var val = attrs[key];
    if (val === true) {
      pairs.push(key);
    } else {
      pairs.push(key + '="' + String(val) + '"');
    }
  });
  if (pairs.length === 0) return '';
  return '(' + pairs.join(' ') + ')';
}

// Generate indented Pugneum lines for a section (thead or tbody),
// with the given cell tag (th or td).
function renderSection(sectionTag, rows, cellTag, indent) {
  var lines = [];
  lines.push(indent + sectionTag);
  rows.forEach(function (cells) {
    lines.push(indent + '  tr');
    cells.forEach(function (cell) {
      lines.push(indent + '    ' + cellTag + ' ' + cell);
    });
  });
  return lines;
}

exports.filter = function pugneum_filter_table(text, attrs) {
  // Split into non-empty lines and parse each as a row.
  var rows = text
    .split('\n')
    .map(function (line) {
      return line.trim();
    })
    .filter(function (line) {
      return line.length > 0;
    })
    .map(parseRow)
    .filter(function (row) {
      return row !== null;
    });

  // Find first separator row index.
  var sepIndex = -1;
  for (var i = 0; i < rows.length; i++) {
    if (isSeparatorRow(rows[i])) {
      sepIndex = i;
      break;
    }
  }

  var attrStr = formatAttrs(attrs);
  var lines = [];
  lines.push('table' + attrStr);

  if (sepIndex === -1) {
    // No separator: all rows go in tbody with td.
    var bodyRows = rows;
    renderSection('tbody', bodyRows, 'td', '  ').forEach(function (l) {
      lines.push(l);
    });
  } else {
    // Separator found: rows before it are thead (th), rows after are tbody (td).
    var headRows = rows.slice(0, sepIndex);
    var tailRows = rows.slice(sepIndex + 1);

    // Determine column count from separator row.
    var colCount = rows[sepIndex].length;

    // Emit colgroup.
    lines.push('  colgroup');
    for (var c = 0; c < colCount; c++) {
      lines.push('    col');
    }

    // Emit thead if there are header rows.
    if (headRows.length > 0) {
      renderSection('thead', headRows, 'th', '  ').forEach(function (l) {
        lines.push(l);
      });
    }

    // Emit tbody if there are body rows.
    if (tailRows.length > 0) {
      renderSection('tbody', tailRows, 'td', '  ').forEach(function (l) {
        lines.push(l);
      });
    }
  }

  return lines.join('\n');
};
