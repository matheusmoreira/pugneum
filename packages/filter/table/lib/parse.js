// Parse an optional tr(attrs) prefix before the first | on a line.
// Returns {trAttrs: string|null, rest: string}.
function parseTrPrefix(line) {
  // Match tr(...) or bare tr before first pipe
  let m = line.match(/^(tr(?:\([^)]*\))?)\s*(\|.*)$/);
  if (!m) return {trAttrs: null, rest: line};
  let trToken = m[1]; // e.g. "tr" or "tr(class="x")"
  let trAttrs = '';
  let attrMatch = trToken.match(/^tr(\(.*\))$/);
  if (attrMatch) {
    trAttrs = attrMatch[1]; // includes parens
  }
  return {trAttrs: trAttrs, rest: m[2]};
}

// Parse a pipe-delimited row into an array of trimmed cell strings.
// Returns null if the line has no pipe delimiters.
// Also extracts optional tr(attrs) prefix.
// Returns {trAttrs: string|null, cells: string[]} or null.
// In data rows, || is treated as | (normalized before splitting).
function parseRow(line) {
  let parsed = parseTrPrefix(line.trim());
  let rowLine = parsed.rest;
  if (!rowLine.includes('|')) return null;
  // Normalize || to | for data rows (separator rows handle || separately)
  let normalizedLine = rowLine.replace(/\|\|/g, '|');
  let parts = normalizedLine.split('|');
  // Trim leading and trailing empty segments (from leading/trailing pipes)
  let start = parts[0].trim() === '' ? 1 : 0;
  let end =
    parts[parts.length - 1].trim() === '' ? parts.length - 1 : parts.length;
  let cells = parts.slice(start, end).map(function (cell) {
    return cell.trim();
  });
  if (cells.length === 0) return null;
  return {trAttrs: parsed.trAttrs, cells: cells};
}

// Parse a separator line (the raw line after tr-prefix extraction) into
// an array of colgroup descriptors: [{segs: [{align, attrs}, ...]}, ...].
// || marks colgroup boundaries; | separates cols within a colgroup.
function parseSeparatorLine(rowLine) {
  // Split on || first to get colgroup chunks
  let cgChunks = rowLine.split('||');
  return cgChunks
    .map(function (chunk) {
      // Each chunk is a pipe-delimited list of separator segments
      let parts = chunk.split('|');
      let start = parts[0].trim() === '' ? 1 : 0;
      let end =
        parts[parts.length - 1].trim() === '' ? parts.length - 1 : parts.length;
      let segs = parts.slice(start, end).map(function (seg) {
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
  let s = cell;
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
  let hasDash = row.cells.some(isDashSepSegment);
  let hasEquals = row.cells.some(isEqualsSepSegment);
  // A cell that is neither type means this is not a separator row
  let allKnown = row.cells.every(function (cell) {
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
  let left = seg[0] === ':';
  let right = seg[seg.length - 1] === ':';
  let attrsMatch = seg.match(/\(([^)]*)\)/);
  let attrs = attrsMatch ? attrsMatch[1] : '';
  let align = left && right ? 'center' : left ? 'left' : right ? 'right' : '';
  return {align: align, attrs: attrs};
}

// Classify a cell as tagged, escaped, or bare.
// Tagged cells start with th or td followed by space or (
// and are emitted verbatim — the real lexer handles attrs.
// Returns {verbatim: string} or {tag: string, text: string}.
function classifyCell(cell, defaultTag) {
  // Escaped \th or \td — strip backslash, use default tag
  if (/^\\t[hd]/.test(cell)) {
    return {tag: defaultTag, text: cell.slice(1)};
  }
  // Tagged cell: th or td followed by space, (, or end of string
  if (/^t[hd](?:\s|\(|$)/.test(cell)) {
    return {verbatim: cell};
  }
  // Bare cell
  return {tag: defaultTag, text: cell};
}

// Parse optional caption from the first non-empty line.
// Returns {captionLine: string|null, rest: string[]} where
// captionLine is the Pugneum caption line (e.g. "caption text" or
// "caption(attrs) text") and rest is the remaining trimmed non-empty lines.
function parseCaption(lines) {
  if (lines.length === 0) return {captionLine: null, rest: lines};
  let first = lines[0];
  // Match: caption(attrs) text  OR  caption text
  let m = first.match(/^caption(\([^)]*\))?\s+(.*)/);
  if (!m) return {captionLine: null, rest: lines};
  let attrStr = m[1] || '';
  let text = m[2];
  let captionLine = 'caption' + attrStr + ' ' + text;
  return {captionLine: captionLine, rest: lines.slice(1)};
}

// Try to parse a section marker line: thead, tbody, or tfoot, optionally with attrs.
// Returns {tag: 'thead'|'tbody'|'tfoot', attrStr: string} or null.
function parseSectionMarker(line) {
  let m = line.match(/^(thead|tbody|tfoot)(\([^)]*\))?\s*$/);
  if (!m) return null;
  return {tag: m[1], attrStr: m[2] || ''};
}

// Parse an array of trimmed non-empty lines into a table structure.
// Returns {captionLine, sections, colgroups, hasSeparatorOrMarker}.
//   captionLine: string|null
//   sections: [{tag, attrStr, rows}]
//   colgroups: array of colgroup descriptors from the first dash-sep, or null
//   hasSeparatorOrMarker: boolean
function parse(lines) {
  // Check for caption on the first non-empty line.
  let captionResult = parseCaption(lines);
  let captionLine = captionResult.captionLine;
  let dataLines = captionResult.rest;

  // Parse each data line as: section marker, pipe row, or ignored non-pipe line.
  // Build a sequence of events: 'marker', 'row', 'dash-sep', 'equals-sep'.
  // Each event carries its payload.
  let events = [];
  for (let li = 0; li < dataLines.length; li++) {
    let line = dataLines[li];

    // Check for section marker (thead/tbody/tfoot on its own line)
    let marker = parseSectionMarker(line);
    if (marker) {
      events.push({type: 'marker', tag: marker.tag, attrStr: marker.attrStr});
      continue;
    }

    // Check for pipe row
    let row = parseRow(line);
    if (row === null) continue; // non-pipe, non-marker line: skip

    // Classify the row
    let sepType = classifySeparatorRow(row);
    if (sepType === 'mixed') {
      throw new Error('Mixed separator: a row cannot mix --- and === segments');
    } else if (sepType === 'dash') {
      // Capture colgroup info from the raw separator line
      let sepParsed = parseTrPrefix(line.trim());
      let colgroups = parseSeparatorLine(sepParsed.rest);
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

  let sections = []; // [{tag, attrStr, rows}]
  let colgroups = null; // set from the first dash-sep
  let currentRows = [];
  let currentTag = null; // null = implicit, 'thead'/'tbody'/'tfoot' = explicit via marker
  let currentAttrs = '';
  let seenFirstDashSep = false;
  let seenEqualsSep = false;
  let seenTfoot = false;
  let hasSeparatorOrMarker = false;

  function flushCurrentRows(newTag, newAttrs) {
    if (currentRows.length > 0) {
      let tag = currentTag !== null ? currentTag : newTag;
      let attrStr = currentTag !== null ? currentAttrs : newAttrs || '';
      sections.push({tag: tag, attrStr: attrStr, rows: currentRows.slice()});
      currentRows = [];
      currentTag = null;
      currentAttrs = '';
    }
  }

  for (let ei = 0; ei < events.length; ei++) {
    let ev = events[ei];

    if (ev.type === 'marker') {
      hasSeparatorOrMarker = true;
      // Flush accumulated rows with their implicit tag, then set the new tag.
      // If there are no rows yet, just update currentTag.
      if (currentRows.length > 0) {
        // Flush rows with current tag (or implicit default)
        let implicitTag = 'tbody';
        flushCurrentRows(implicitTag);
      }
      currentTag = ev.tag;
      currentAttrs = ev.attrStr;
      if (ev.tag === 'tfoot') seenTfoot = true;
    } else if (ev.type === 'dash-sep') {
      hasSeparatorOrMarker = true;
      if (seenEqualsSep) {
        throw new Error('--- separator cannot appear after ===');
      }
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
      if (seenEqualsSep || seenTfoot) {
        throw new Error('=== separator can only appear once in a table');
      }
      seenEqualsSep = true;
      seenTfoot = true;
      // Flush current rows as tbody (or thead if no dash-sep seen)
      let preFootTag = 'tbody';
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
    let finalTag;
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

  return {
    captionLine: captionLine,
    sections: sections,
    colgroups: colgroups,
    hasSeparatorOrMarker: hasSeparatorOrMarker,
  };
}

module.exports = parse;
module.exports.classifyCell = classifyCell;
