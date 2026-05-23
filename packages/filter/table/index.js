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
function isDashSepSegment(cell) {
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

// An equals separator segment is only equals signs (at least one).
function isEqualsSepSegment(cell) {
  return /^=+$/.test(cell);
}

// Classify a pipe-delimited row by its separator type:
// Returns 'dash' if all cells are dash-separator segments,
// 'equals' if all cells are equals-separator segments,
// 'mixed' if some are dash and some are equals,
// or null if it is not a separator row at all.
function classifySeparatorRow(row) {
  if (row.cells.length === 0) return null;
  var hasDash = row.cells.some(isDashSepSegment);
  var hasEquals = row.cells.some(isEqualsSepSegment);
  // A cell that is neither type means this is not a separator row
  var allKnown = row.cells.every(function (cell) {
    return isDashSepSegment(cell) || isEqualsSepSegment(cell);
  });
  if (!allKnown) return null;
  if (hasDash && hasEquals) return 'mixed';
  if (hasDash) return 'dash';
  if (hasEquals) return 'equals';
  return null;
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

// Generate indented Pugneum lines for a section (thead, tbody, or tfoot),
// with the given default cell tag (th or td).
// rows is an array of {trAttrs, cells} objects.
// sectionAttrs is an optional attribute string like '(class="x")' or ''.
function renderSection(sectionTag, rows, defaultCellTag, indent, sectionAttrs) {
  var lines = [];
  lines.push(indent + sectionTag + (sectionAttrs || ''));
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

// Try to parse a section marker line: thead, tbody, or tfoot, optionally with attrs.
// Returns {tag: 'thead'|'tbody'|'tfoot', attrStr: string} or null.
function parseSectionMarker(line) {
  var m = line.match(/^(thead|tbody|tfoot)(\([^)]*\))?\s*$/);
  if (!m) return null;
  return {tag: m[1], attrStr: m[2] || ''};
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

  // Parse each data line as: section marker, pipe row, or ignored non-pipe line.
  // Build a sequence of events: 'marker', 'row', 'dash-sep', 'equals-sep'.
  // Each event carries its payload.
  var events = [];
  for (var li = 0; li < dataLines.length; li++) {
    var line = dataLines[li];

    // Check for section marker (thead/tbody/tfoot on its own line)
    var marker = parseSectionMarker(line);
    if (marker) {
      events.push({type: 'marker', tag: marker.tag, attrStr: marker.attrStr});
      continue;
    }

    // Check for pipe row
    var row = parseRow(line);
    if (row === null) continue; // non-pipe, non-marker line: skip

    // Classify the row
    var sepType = classifySeparatorRow(row);
    if (sepType === 'mixed') {
      throw new Error('Mixed separator: a row cannot mix --- and === segments');
    } else if (sepType === 'dash') {
      // Capture colgroup info from the raw separator line
      var sepParsed = parseTrPrefix(line.trim());
      var colgroups = parseSeparatorLine(sepParsed.rest);
      events.push({type: 'dash-sep', colgroups: colgroups});
    } else if (sepType === 'equals') {
      events.push({type: 'equals-sep'});
    } else {
      events.push({type: 'row', row: row});
    }
  }

  // Now build sections from the event stream.
  // A section is: {tag: 'thead'|'tbody'|'tfoot', attrStr: string, rows: [...]}
  // Rules:
  //   - If no separators/markers appear, all rows go into a single tbody.
  //   - The first dash-sep: rows before it become thead, rows after start a new tbody.
  //     The colgroup info from the first dash-sep is used for colgroups.
  //   - Subsequent dash-seps: rows since the last section boundary start a new tbody.
  //   - equals-sep: rows since the last section boundary start tfoot. Only once.
  //   - Section markers: explicitly declare the section tag/attrs for rows that follow.
  //     They override the implicit logic for the following rows.

  var sections = []; // [{tag, attrStr, rows}]
  var colgroups = null; // set from the first dash-sep
  var currentRows = [];
  var currentTag = null; // null = implicit, 'thead'/'tbody'/'tfoot' = explicit via marker
  var currentAttrs = '';
  var seenFirstDashSep = false;
  var seenEqualsSep = false;
  var hasSeparatorOrMarker = false;

  function flushCurrentRows(newTag, newAttrs) {
    if (currentRows.length > 0) {
      var tag = currentTag !== null ? currentTag : newTag;
      var attrStr = currentTag !== null ? currentAttrs : newAttrs || '';
      sections.push({tag: tag, attrStr: attrStr, rows: currentRows.slice()});
      currentRows = [];
    }
    currentTag = null;
    currentAttrs = '';
  }

  for (var ei = 0; ei < events.length; ei++) {
    var ev = events[ei];

    if (ev.type === 'marker') {
      hasSeparatorOrMarker = true;
      // Flush accumulated rows with their implicit tag, then set the new tag.
      // If there are no rows yet, just update currentTag.
      if (currentRows.length > 0) {
        // Flush rows with current tag (or implicit default)
        var implicitTag = seenFirstDashSep ? 'tbody' : 'thead';
        flushCurrentRows(implicitTag);
      }
      currentTag = ev.tag;
      currentAttrs = ev.attrStr;
    } else if (ev.type === 'dash-sep') {
      hasSeparatorOrMarker = true;
      if (!seenFirstDashSep) {
        // First dash-sep: flush current rows as thead
        colgroups = ev.colgroups;
        flushCurrentRows('thead');
        seenFirstDashSep = true;
      } else {
        // Subsequent dash-seps: flush current rows as tbody
        flushCurrentRows('tbody');
      }
    } else if (ev.type === 'equals-sep') {
      hasSeparatorOrMarker = true;
      if (seenEqualsSep) {
        throw new Error('=== separator can only appear once in a table');
      }
      seenEqualsSep = true;
      // Flush current rows as tbody (or thead if no dash-sep seen)
      var preFootTag = seenFirstDashSep ? 'tbody' : 'thead';
      flushCurrentRows(preFootTag);
      // Next rows will go into tfoot (set currentTag to 'tfoot')
      currentTag = 'tfoot';
      currentAttrs = '';
    } else if (ev.type === 'row') {
      currentRows.push(ev.row);
    }
  }

  // Flush remaining rows
  if (currentRows.length > 0) {
    var finalTag;
    if (currentTag !== null) {
      finalTag = currentTag;
    } else if (seenEqualsSep) {
      finalTag = 'tfoot';
    } else if (seenFirstDashSep) {
      finalTag = 'tbody';
    } else {
      finalTag = 'tbody';
    }
    sections.push({
      tag: finalTag,
      attrStr: currentAttrs,
      rows: currentRows.slice(),
    });
  }

  // Build output Pugneum lines.
  var attrStr = formatAttrs(attrs);
  var lines = [];
  lines.push('table' + attrStr);

  // Emit caption if present.
  if (captionLine !== null) {
    lines.push('  ' + captionLine);
  }

  if (!hasSeparatorOrMarker) {
    // No separators or markers: all rows go in tbody with td.
    // sections[0] has the rows (flushed in the post-loop block above).
    var allRows = sections.length > 0 ? sections[0].rows : [];
    renderSection('tbody', allRows, 'td', '  ', '').forEach(function (l) {
      lines.push(l);
    });
  } else {
    // Emit colgroups (from first dash-sep, if any).
    if (colgroups !== null) {
      colgroups.forEach(function (cg) {
        lines.push('  colgroup');
        cg.segs.forEach(function (seg) {
          lines.push(renderCol(seg, '    '));
        });
      });
    }

    // Emit each section.
    sections.forEach(function (section) {
      if (section.rows.length === 0) return;
      var defaultCellTag = section.tag === 'thead' ? 'th' : 'td';
      renderSection(
        section.tag,
        section.rows,
        defaultCellTag,
        '  ',
        section.attrStr,
      ).forEach(function (l) {
        lines.push(l);
      });
    });
  }

  return lines.join('\n');
};
