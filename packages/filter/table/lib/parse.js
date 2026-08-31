const error = require('pugneum-error');
const scanParenGroup = require('pugneum-lexer').scanExpressionGroup;

// Match an optional balanced (attrs) group at the start of `s`.
// Returns {attrs: string, rest: string} where attrs includes the surrounding
// parens (or '' when there is no group) and rest is everything after it.
// A '(' that is never balanced yields no group (attrs: '', rest: s) so callers
// degrade to "no attrs" rather than misparsing on an interior ')'.
function matchAttrGroup(s) {
  if (s[0] !== '(') return {attrs: '', rest: s};
  const close = scanParenGroup(s, 0);
  if (close === -1) return {attrs: '', rest: s};
  return {attrs: s.slice(0, close), rest: s.slice(close)};
}

// Split a pipe-delimited fragment into its inner cells, dropping the empty
// leading/trailing segments produced by surrounding pipes, and trimming each.
// Centralizes the edge-cell rule shared by data rows and separator rows so the
// two cannot drift (the rule is subtle: a lone `|` -> ['', ''] -> []).
function splitPipeCells(fragment) {
  const parts = fragment.split('|');
  const start = parts[0].trim() === '' ? 1 : 0;
  const end =
    parts[parts.length - 1].trim() === '' ? parts.length - 1 : parts.length;
  return parts.slice(start, end).map(function (s) {
    return s.trim();
  });
}

// Parse an optional tr(attrs) prefix before the first | on a line.
// Returns {trAttrs: string|null, rest: string}.
function parseTrPrefix(line) {
  // A tr prefix is the literal `tr` followed by a balanced (attrs) group, then
  // optional whitespace and a pipe-delimited row. Requiring the group keeps a
  // bare first cell such as `tr | value |` unambiguous data.
  if (line.slice(0, 2) !== 'tr') return {trAttrs: null, rest: line};
  const after = line.slice(2);
  if (after[0] !== '(') return {trAttrs: null, rest: line};
  const group = matchAttrGroup(after);
  const rest = group.rest.replace(/^\s*/, '');
  if (rest[0] !== '|') return {trAttrs: null, rest: line};
  return {trAttrs: group.attrs, rest: rest};
}

// Parse a pipe-delimited row into an array of trimmed cell strings.
// Returns null if the line has no pipe delimiters.
// Also extracts optional tr(attrs) prefix.
// Returns {trAttrs: string|null, cells: string[]} or null.
// In data rows, || is treated as | (normalized before splitting).
function parseRow(line) {
  const parsed = parseTrPrefix(line.trim());
  const rowLine = parsed.rest;
  if (!rowLine.includes('|')) return null;
  // Normalize || to | for data rows (separator rows handle || separately)
  const normalizedLine = rowLine.replace(/\|\|/g, '|');
  const cells = splitPipeCells(normalizedLine);
  if (cells.length === 0) return null;
  // Surface the post-prefix line so the dash-sep branch can reuse it without
  // re-running parseTrPrefix (one decomposition, one source of truth).
  return {trAttrs: parsed.trAttrs, cells: cells, rest: rowLine};
}

// A separator segment is dashes with optional leading/trailing colons
// and an optional (attrs) group between dashes.
// Examples: ---, :---, ---:, :---:, ---(class="x")---, :---(class="x")---:
// Returns its typed {align, attrs} descriptor, or null when the cell is not a
// dash separator. Validation and extraction deliberately happen together so a
// separator cannot be accepted by one grammar pass and interpreted by another.
function parseDashSeparatorSegment(cell) {
  let s = cell;
  const left = s[0] === ':';
  const right = s[s.length - 1] === ':';
  if (left) s = s.slice(1);
  if (right) s = s.slice(0, -1);

  // Remove an optional balanced (attrs) group wherever it sits between dashes.
  // Quote-aware scanning (not `[^)]*`) so a ')' inside calc(...)/url(...) does
  // not end the group early — and a long run of unbalanced '(' cannot trigger
  // quadratic backtracking.
  let attrs = '';
  const open = s.indexOf('(');
  if (open !== -1) {
    const close = scanParenGroup(s, open);
    if (close === -1) return null;
    attrs = s.slice(open + 1, close - 1);
    s = s.slice(0, open) + s.slice(close);
  }

  // Remaining must be the documented separator width: at least three dashes.
  if (!/^-{3,}$/.test(s)) return null;
  const align = left && right ? 'center' : left ? 'left' : right ? 'right' : '';
  return {align: align, attrs: attrs};
}

// An equals separator segment is at least three equals signs.
function isEqualsSepSegment(cell) {
  return /^={3,}$/.test(cell);
}

// Parse a pipe-delimited row into one typed separator descriptor:
// {type: 'dash'|'equals'|'mixed', colgroups}. `||` marks colgroup boundaries;
// `|` separates columns within a group. Returns null for an ordinary data row.
// An empty cell (e.g. a blank middle column, or a `||` colgroup edge) is a
// no-alignment column: it neither disqualifies the row nor decides its type, so
// `| --- |  | --- |` is still a separator rather than silently demoting to data.
// Each segment is validated and converted to its final descriptor in one pass.
function describeSeparatorRow(row) {
  const colgroups = [];
  let hasDash = false;
  let hasEquals = false;

  for (const chunk of row.rest.split('||')) {
    const cells = splitPipeCells(chunk);
    if (cells.length === 0) continue;

    const segs = [];
    for (const cell of cells) {
      if (cell === '') {
        segs.push({align: '', attrs: ''});
        continue;
      }

      const dash = parseDashSeparatorSegment(cell);
      if (dash !== null) {
        hasDash = true;
        segs.push(dash);
      } else if (isEqualsSepSegment(cell)) {
        hasEquals = true;
        segs.push({align: '', attrs: ''});
      } else {
        return null;
      }
    }
    colgroups.push({segs: segs});
  }

  if (hasDash && hasEquals) return {type: 'mixed', colgroups};
  if (hasDash) return {type: 'dash', colgroups};
  if (hasEquals) return {type: 'equals', colgroups};
  return null; // all cells empty: not a separator
}

function classifySeparatorLine(line) {
  const row = parseRow(line);
  if (row === null) return null;
  const descriptor = describeSeparatorRow(row);
  return descriptor === null ? null : descriptor.type;
}

// Decide whether `cell` is an explicit tagged cell (th/td emitted verbatim so
// the real lexer parses its attrs). A tagged cell is `th`/`td`, then an optional
// BALANCED (attrs) group, then either end-of-string or whitespace (the cell
// text). Returning -1 for an unbalanced `(` is the key safety property:
// `th(scope value` (no closing paren) must NOT be passed verbatim — re-lexing it
// would throw NO_END_BRACKET; it is treated as plain data instead.
// Returns the matched head length, or -1 if the cell is not a tagged cell.
// (Tag `.class`/`#id` shorthands are intentionally NOT recognized here — a cell
// like `td.5` is data, not a tag with an invalid class; see README. Use an
// explicit `(attrs)` group for tagged cells.)
function taggedCellHeadLength(cell) {
  if (cell[0] !== 't' || (cell[1] !== 'h' && cell[1] !== 'd')) return -1;
  let i = 2;
  // Optional balanced attribute group.
  if (cell[i] === '(') {
    const close = scanParenGroup(cell, i);
    if (close === -1) return -1; // unbalanced: treat as data, never verbatim
    i = close;
  }
  // Must be followed by end-of-string or whitespace.
  if (i === cell.length) return i;
  if (/\s/.test(cell[i])) return i;
  return -1;
}

// Classify a cell as tagged, escaped, or bare.
// Returns {verbatim: head, text: string} for a tagged cell (head = tag+attrs,
// text = trailing text incl. its leading space, or ''), or {tag, text} for an
// escaped \th/\td or a bare cell.
function classifyCell(cell, defaultTag) {
  // Escaped \th / \td: a leading backslash whose UNESCAPED form would be a
  // tagged cell. Strip the backslash and emit as data so the literal text
  // starts with th/td. (A backslash before a non-tag word like `\theme` is
  // left untouched — there is nothing to escape.)
  if (cell[0] === '\\' && taggedCellHeadLength(cell.slice(1)) !== -1) {
    return {tag: defaultTag, text: cell.slice(1)};
  }
  // Tagged cell: the head (tag + balanced attrs) is returned verbatim for the
  // real lexer to parse; the trailing text is returned separately so generate.js
  // can neutralize a literal `#{` in it without touching the head (the head's
  // attribute values are not cell-escaped).
  const headLen = taggedCellHeadLength(cell);
  if (headLen !== -1) {
    return {verbatim: cell.slice(0, headLen), text: cell.slice(headLen)};
  }
  // Bare cell
  return {tag: defaultTag, text: cell};
}

// Parse optional caption from the first non-empty line.
// Returns {caption: {attrStr, text, location} | null, rest: record[]} where
// attrStr is the balanced (attrs) group (or '') and text is the raw caption
// text; generate.js assembles and escapes the Pugneum line. rest is the
// remaining located line records.
function parseCaption(lines) {
  if (lines.length === 0) return {caption: null, rest: lines};
  const firstRecord = lines[0];
  const first = firstRecord.text;
  // Match: caption(attrs) text  OR  caption text. The (attrs) group is scanned
  // with balanced parens so a ')' inside an attribute value does not truncate
  // it (the old /\([^)]*\)/ silently dropped such captions).
  if (first.slice(0, 7) !== 'caption') return {caption: null, rest: lines};
  const after = first.slice(7);
  const group = matchAttrGroup(after);
  // Require whitespace separating the caption head from its text.
  const sep = group.rest.match(/^\s+/);
  if (!sep) return {caption: null, rest: lines};
  const text = group.rest.slice(sep[0].length);
  return {
    caption: {
      attrStr: group.attrs,
      text: text,
      location: firstRecord.location,
    },
    rest: lines.slice(1),
  };
}

// Try to parse a section marker line: thead, tbody, or tfoot, optionally with attrs.
// Returns {tag: 'thead'|'tbody'|'tfoot', attrStr: string} or null.
function parseSectionMarker(line) {
  const m = line.match(/^(thead|tbody|tfoot)/);
  if (!m) return null;
  const tag = m[1];
  // The marker is the tag plus an optional balanced (attrs) group and nothing
  // else on the line. Balanced scanning lets a ')' appear inside an attribute
  // value (the old /\([^)]*\)/ silently dropped such markers).
  const group = matchAttrGroup(line.slice(tag.length));
  if (group.rest.trim() !== '') return null;
  return {tag: tag, attrStr: group.attrs};
}

// Parse an array of located, trimmed, non-empty line records into a table
// structure. Every authored construct retains its caller location so both
// parser and generator diagnostics can point back through the filter boundary.
// Returns {caption, sections, colgroups, hasSeparatorOrMarker, lastLocation}.
//   caption: {attrStr, text} | null
//   sections: [{tag, attrStr, rows}]
//   colgroups: array of colgroup descriptors from the first dash-sep, or null
//   hasSeparatorOrMarker: boolean
function parse(lines) {
  // Check for caption on the first non-empty line.
  const captionResult = parseCaption(lines);
  const caption = captionResult.caption;
  const dataLines = captionResult.rest;

  // Parse each data line as a section marker or a pipe row. Rejecting any other
  // nonempty line prevents a missing delimiter or misspelled marker from
  // disappearing silently.
  // Build a sequence of events: 'marker', 'row', 'dash-sep', 'equals-sep'.
  // Each event carries its payload.
  const events = [];
  for (let li = 0; li < dataLines.length; li++) {
    const record = dataLines[li];
    const line = record.text;
    const location = record.location;

    // Check for section marker (thead/tbody/tfoot on its own line)
    const marker = parseSectionMarker(line);
    if (marker) {
      events.push({
        type: 'marker',
        tag: marker.tag,
        attrStr: marker.attrStr,
        location,
      });
      continue;
    }

    // Check for pipe row
    const row = parseRow(line);
    if (row === null) {
      throw error(
        'INVALID_TABLE_LINE',
        'expected a section marker or pipe-delimited table row',
        location,
      );
    }
    row.location = location;

    // Parse separator grammar once into the descriptor the generator consumes.
    const separator = describeSeparatorRow(row);
    const sepType = separator === null ? null : separator.type;
    if (sepType === 'mixed') {
      throw error(
        'MIXED_TABLE_SEPARATOR',
        'Mixed separator: a row cannot mix --- and === segments',
        location,
      );
    } else if (sepType === 'dash') {
      if (row.trAttrs !== null) {
        throw error(
          'INVALID_TABLE_SEPARATOR_ATTRIBUTES',
          'row attributes are not allowed on a --- separator',
          location,
        );
      }
      const colgroups = separator.colgroups;
      colgroups.forEach(function (colgroup) {
        colgroup.location = location;
        colgroup.segs.forEach(function (segment) {
          segment.location = location;
        });
      });
      events.push({type: 'dash-sep', colgroups: colgroups, location});
    } else if (sepType === 'equals') {
      if (row.trAttrs !== null) {
        throw error(
          'INVALID_TABLE_SEPARATOR_ATTRIBUTES',
          'row attributes are not allowed on an === separator',
          location,
        );
      }
      events.push({type: 'equals-sep', location});
    } else {
      events.push({type: 'row', row: row, location});
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

  const sections = []; // [{tag, attrStr, rows}]
  let colgroups = null; // set from the first dash-sep
  let currentRows = [];
  let currentTag = null; // null = implicit, 'thead'/'tbody'/'tfoot' = explicit via marker
  let currentAttrs = '';
  let currentLocation = null;
  let seenFirstDashSep = false;
  let seenEqualsSep = false; // an === separator has been consumed
  // Section-uniqueness state. HTML permits at most one <thead> and one <tfoot>;
  // a <tfoot> must follow the body. We enforce this once, at the point a
  // section is actually emitted (pushSection), so the marker and separator
  // paths cannot diverge (previously only the === path was guarded, and marker
  // syntax silently produced two <thead>/<tfoot> or a tfoot-before-tbody).
  let seenThead = false;
  let seenTfoot = false;
  let lastSectionRank = -1;
  let lastSectionTag = null;
  let hasSeparatorOrMarker = false;

  const sectionRank = {thead: 0, tbody: 1, tfoot: 2};

  function assertSectionCanFollow(tag, location) {
    const rank = sectionRank[tag];
    if (rank < lastSectionRank) {
      throw error(
        'INVALID_TABLE_SECTION_ORDER',
        tag + ' cannot appear after a ' + lastSectionTag,
        location,
      );
    }
  }

  function pushSection(tag, attrStr, rows, location) {
    assertSectionCanFollow(tag, location);
    if (tag === 'thead') {
      if (seenThead) {
        throw error(
          'DUPLICATE_TABLE_SECTION',
          'a table may have only one thead',
          location,
        );
      }
      seenThead = true;
    } else if (tag === 'tfoot') {
      if (seenTfoot) {
        throw error(
          'DUPLICATE_TABLE_SECTION',
          'a table may have only one tfoot',
          location,
        );
      }
      seenTfoot = true;
    }
    sections.push({
      tag: tag,
      attrStr: attrStr,
      rows: rows.slice(),
      location,
    });
    lastSectionRank = sectionRank[tag];
    lastSectionTag = tag;
  }

  function assertNoPendingEmptySection(boundary, location) {
    if (currentTag !== null && currentRows.length === 0) {
      throw error(
        'EMPTY_TABLE_SECTION',
        boundary + ' cannot replace an empty pending ' + currentTag,
        location,
      );
    }
  }

  // Flush the accumulated rows as a section. An explicit marker tag
  // (currentTag) always wins over the implicit `defaultTag` argument; this is
  // the single source of truth for tag selection.
  function flushCurrentRows(defaultTag) {
    if (currentRows.length > 0) {
      const tag = currentTag !== null ? currentTag : defaultTag;
      const attrStr = currentTag !== null ? currentAttrs : '';
      const location = currentLocation || currentRows[0].location;
      pushSection(tag, attrStr, currentRows, location);
      currentRows = [];
      currentTag = null;
      currentAttrs = '';
      currentLocation = null;
    }
  }

  for (let ei = 0; ei < events.length; ei++) {
    const ev = events[ei];

    if (ev.type === 'marker') {
      hasSeparatorOrMarker = true;
      assertNoPendingEmptySection(ev.tag + ' marker', ev.location);
      // Flush accumulated rows with the implicit tbody tag, then adopt the
      // marker's tag for the rows that follow.
      flushCurrentRows('tbody');
      assertSectionCanFollow(ev.tag, ev.location);
      currentTag = ev.tag;
      currentAttrs = ev.attrStr;
      currentLocation = ev.location;
    } else if (ev.type === 'dash-sep') {
      hasSeparatorOrMarker = true;
      assertNoPendingEmptySection('--- separator', ev.location);
      if (seenEqualsSep) {
        throw error(
          'INVALID_TABLE_SECTION_ORDER',
          '--- separator cannot appear after ===',
          ev.location,
        );
      }
      // seenTfoot covers an already-emitted tfoot; currentTag covers a tfoot
      // marker whose rows are still pending. Either way a header/body separator
      // after the foot is structurally wrong.
      if (seenTfoot || currentTag === 'tfoot') {
        throw error(
          'INVALID_TABLE_SECTION_ORDER',
          '--- separator cannot follow a tfoot marker',
          ev.location,
        );
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
      assertNoPendingEmptySection('=== separator', ev.location);
      if (seenEqualsSep) {
        throw error(
          'DUPLICATE_TABLE_SECTION',
          '=== separator can only appear once in a table',
          ev.location,
        );
      }
      if (seenTfoot || currentTag === 'tfoot') {
        // A tfoot marker already opened the foot region.
        throw error(
          'INVALID_TABLE_SECTION_ORDER',
          '=== separator cannot follow a tfoot marker',
          ev.location,
        );
      }
      seenEqualsSep = true;
      // Flush current rows as tbody (the dash-sep already emitted any thead).
      flushCurrentRows('tbody');
      // Next rows will go into tfoot (set currentTag to 'tfoot')
      currentTag = 'tfoot';
      currentAttrs = '';
      currentLocation = ev.location;
    } else if (ev.type === 'row') {
      currentRows.push(ev.row);
    }
  }

  // Flush remaining rows. With currentTag unset, rows after an === go to tfoot
  // and everything else is tbody.
  if (currentRows.length > 0) {
    const finalTag =
      currentTag !== null ? currentTag : seenEqualsSep ? 'tfoot' : 'tbody';
    pushSection(
      finalTag,
      currentAttrs,
      currentRows,
      currentLocation || currentRows[0].location,
    );
  } else if (currentTag !== null) {
    throw error(
      'EMPTY_TABLE_SECTION',
      'pending ' + currentTag + ' has no rows',
      currentLocation,
    );
  }

  return {
    caption: caption,
    sections: sections,
    colgroups: colgroups,
    hasSeparatorOrMarker: hasSeparatorOrMarker,
    lastLocation: lines[lines.length - 1].location,
  };
}

module.exports = parse;
module.exports.classifyCell = classifyCell;
module.exports.classifySeparatorLine = classifySeparatorLine;
