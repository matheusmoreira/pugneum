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
// Returns {trAttrs: string|null, cells: string[], colgroups: number[]|null} or null.
// colgroups (only set on separator rows) is an array of col-counts per colgroup.
// In data rows, || is treated as | (normalized before splitting).
function parseRow(line) {
  var parsed = parseTrPrefix(line.trim());
  var rowLine = parsed.rest;
  if (!rowLine.includes('|')) return null;
  // Normalize || to | for data rows (separator rows handle || separately)
  var normalizedLine = rowLine.replace(/\|\|/g, '|');
  var parts = normalizedLine.split('|');
  // Trim leading and trailing empty segments (from leading/trailing pipes)
  var start = parts[0].trim() === '' ? 1 : 0;
  var end =
    parts[parts.length - 1].trim() === '' ? parts.length - 1 : parts.length;
  var cells = parts.slice(start, end).map(function (cell) {
    return cell.trim();
  });
  return {trAttrs: parsed.trAttrs, cells: cells};
}

// Parse a separator line (the raw line after tr-prefix extraction) into
// an array of colgroup descriptors: [{segs: [{align, attrs}, ...]}, ...].
// || marks colgroup boundaries; | separates cols within a colgroup.
function parseSeparatorLine(rowLine) {
  // Split on || first to get colgroup chunks
  var cgChunks = rowLine.split('||');
  return cgChunks
    .map(function (chunk) {
      // Each chunk is a pipe-delimited list of separator segments
      var parts = chunk.split('|');
      var start = parts[0].trim() === '' ? 1 : 0;
      var end =
        parts[parts.length - 1].trim() === '' ? parts.length - 1 : parts.length;
      var segs = parts.slice(start, end).map(function (seg) {
        return parseSepSegment(seg.trim());
      });
      return {segs: segs};
    })
    .filter(function (cg) {
      return cg.segs.length > 0;
    });
}

// A separator segment is dashes with optional leading/trailing colons
// and an optional (attrs) group between dashes.
// Examples: ---, :---, ---:, :---:, ---(class="x")---, :---(class="x")---:
function isSepSegment(cell) {
  // Strip leading colon
  var s = cell;
  if (s[0] === ':') s = s.slice(1);
  // Strip trailing colon
  if (s[s.length - 1] === ':') s = s.slice(0, -1);
  // Remove optional (attrs) group
  s = s.replace(/\([^)]*\)/, '');
  // Remaining must be only dashes (at least one)
  return /^-+$/.test(s);
}

// A separator row has all cells matching the separator segment pattern.
function isSeparatorRow(row) {
  return (
    row.cells.length > 0 &&
    row.cells.every(function (cell) {
      return isSepSegment(cell);
    })
  );
}

// Parse a separator segment into {align, attrs}.
// align is '' | 'left' | 'right' | 'center'
// attrs is the raw content inside parens, or ''
function parseSepSegment(seg) {
  seg = seg.trim();
  var left = seg[0] === ':';
  var right = seg[seg.length - 1] === ':';
  var attrsMatch = seg.match(/\(([^)]*)\)/);
  var attrs = attrsMatch ? attrsMatch[1] : '';
  var align = left && right ? 'center' : left ? 'left' : right ? 'right' : '';
  return {align: align, attrs: attrs};
}

// Render a col element line given {align, attrs} and an indent string.
function renderCol(seg, indent) {
  var parts = [];
  if (seg.align) {
    parts.push('style="text-align:' + seg.align + '"');
  }
  if (seg.attrs) {
    parts.push(seg.attrs);
  }
  if (parts.length === 0) {
    return indent + 'col';
  }
  return indent + 'col(' + parts.join(' ') + ')';
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

    // Parse the separator line to extract colgroup/alignment/attrs info.
    // We need the raw separator line; re-derive it from dataLines at sepIndex.
    // (rows[sepIndex] has already been parsed; we parse the separator specially.)
    // Find the original separator line among dataLines.
    var sepLineRaw = null;
    var rowCount = 0;
    for (var li = 0; li < dataLines.length; li++) {
      var parsedLine = parseRow(dataLines[li]);
      if (parsedLine !== null) {
        if (rowCount === sepIndex) {
          sepLineRaw = dataLines[li];
          break;
        }
        rowCount++;
      }
    }

    // Parse colgroups from separator line.
    var colgroups;
    if (sepLineRaw !== null) {
      var sepParsed = parseTrPrefix(sepLineRaw.trim());
      colgroups = parseSeparatorLine(sepParsed.rest);
    } else {
      // Fallback: single colgroup, no alignment
      var colCount = rows[sepIndex].cells.length;
      var segs = [];
      for (var c = 0; c < colCount; c++) {
        segs.push({align: '', attrs: ''});
      }
      colgroups = [{segs: segs}];
    }

    // Emit colgroups.
    colgroups.forEach(function (cg) {
      lines.push('  colgroup');
      cg.segs.forEach(function (seg) {
        lines.push(renderCol(seg, '    '));
      });
    });

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
