'use strict';

exports.type = 'pugneum';

// Parse an optional tr(attrs) prefix before the first | on a line.
// Returns {trAttrs: string|null, rest: string}.
function parseTrPrefix(line) {
  // Match tr(...) or bare tr before first pipe
  var m = line.match(/^(tr(?:\([^)]*\))?)\s*(\|.*)$/);
  if (!m) return {trAttrs: null, rest: line};
  var trToken = m[1]; // e.g. "tr" or "tr(class="x")"
  var trAttrs = '';
  var attrMatch = trToken.match(/^tr(\(.*\))$/);
  if (attrMatch) {
    trAttrs = attrMatch[1]; // includes parens
  }
  return {trAttrs: trAttrs, rest: m[2]};
}

// Parse a pipe-delimited row into an array of trimmed cell strings.
// Returns null if the line has no pipe delimiters.
// Also extracts optional tr(attrs) prefix.
// Returns {trAttrs: string|null, cells: string[]} or null.
function parseRow(line) {
  var parsed = parseTrPrefix(line.trim());
  var rowLine = parsed.rest;
  if (!rowLine.includes('|')) return null;
  var parts = rowLine.split('|');
  // Trim leading and trailing empty segments (from leading/trailing pipes)
  var start = parts[0].trim() === '' ? 1 : 0;
  var end =
    parts[parts.length - 1].trim() === '' ? parts.length - 1 : parts.length;
  var cells = parts.slice(start, end).map(function (cell) {
    return cell.trim();
  });
  return {trAttrs: parsed.trAttrs, cells: cells};
}

// A separator row has all cells matching /^-+$/ (only dashes after trim).
function isSeparatorRow(row) {
  return (
    row.cells.length > 0 &&
    row.cells.every(function (cell) {
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

// Parse a cell string into {tag, attrStr, text}.
// defaultTag is 'th' or 'td'.
// Handles:
//   th(attrs) text   → tag=th, attrStr=(attrs), text=text
//   th text          → tag=th, attrStr='', text=text
//   td(attrs) text   → tag=td, attrStr=(attrs), text=text
//   td text          → tag=td, attrStr='', text=text
//   \th text         → tag=defaultTag, attrStr='', text='th text'
//   \td text         → tag=defaultTag, attrStr='', text='td text'
//   anything else    → tag=defaultTag, attrStr='', text=cell
function parseCell(cell, defaultTag) {
  // Escaped \th or \td — strip backslash, use default tag
  if (/^\\t[hd]/.test(cell)) {
    return {tag: defaultTag, attrStr: '', text: cell.slice(1)};
  }
  // Tagged cell with attrs: th(attrs) text or td(attrs) text
  var withAttrs = cell.match(/^(t[hd])(\([^)]*\))\s*(.*)/);
  if (withAttrs) {
    return {tag: withAttrs[1], attrStr: withAttrs[2], text: withAttrs[3]};
  }
  // Tagged cell without attrs: th text or td text (must be followed by space)
  var noAttrs = cell.match(/^(t[hd])\s+(.*)/);
  if (noAttrs) {
    return {tag: noAttrs[1], attrStr: '', text: noAttrs[2]};
  }
  // Bare cell
  return {tag: defaultTag, attrStr: '', text: cell};
}

// Generate indented Pugneum lines for a section (thead or tbody),
// with the given default cell tag (th or td).
// rows is an array of {trAttrs, cells} objects.
function renderSection(sectionTag, rows, defaultCellTag, indent) {
  var lines = [];
  lines.push(indent + sectionTag);
  rows.forEach(function (row) {
    var trLine = indent + '  tr';
    if (row.trAttrs !== null && row.trAttrs !== '') {
      trLine = indent + '  tr' + row.trAttrs;
    }
    lines.push(trLine);
    row.cells.forEach(function (cell) {
      var parsed = parseCell(cell, defaultCellTag);
      lines.push(
        indent + '    ' + parsed.tag + parsed.attrStr + ' ' + parsed.text,
      );
    });
  });
  return lines;
}

// Parse optional caption from the first non-empty line.
// Returns {captionLine: string|null, rest: string[]} where
// captionLine is the Pugneum caption line (e.g. "caption text" or
// "caption(attrs) text") and rest is the remaining trimmed non-empty lines.
function parseCaption(lines) {
  if (lines.length === 0) return {captionLine: null, rest: lines};
  var first = lines[0];
  // Match: caption(attrs) text  OR  caption text
  var m = first.match(/^caption(\([^)]*\))?\s+(.*)/);
  if (!m) return {captionLine: null, rest: lines};
  var attrStr = m[1] || '';
  var text = m[2];
  var captionLine = 'caption' + attrStr + ' ' + text;
  return {captionLine: captionLine, rest: lines.slice(1)};
}

exports.filter = function pugneum_filter_table(text, attrs) {
  // Split into non-empty trimmed lines.
  var trimmedLines = text
    .split('\n')
    .map(function (line) {
      return line.trim();
    })
    .filter(function (line) {
      return line.length > 0;
    });

  // Check for caption on the first non-empty line.
  var captionResult = parseCaption(trimmedLines);
  var captionLine = captionResult.captionLine;
  var dataLines = captionResult.rest;

  // Parse data lines as rows (skip non-pipe lines).
  var rows = dataLines.map(parseRow).filter(function (row) {
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

  // Emit caption if present.
  if (captionLine !== null) {
    lines.push('  ' + captionLine);
  }

  if (sepIndex === -1) {
    // No separator: all rows go in tbody with td.
    renderSection('tbody', rows, 'td', '  ').forEach(function (l) {
      lines.push(l);
    });
  } else {
    // Separator found: rows before it are thead (th), rows after are tbody (td).
    var headRows = rows.slice(0, sepIndex);
    var tailRows = rows.slice(sepIndex + 1);

    // Determine column count from separator row.
    var colCount = rows[sepIndex].cells.length;

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
