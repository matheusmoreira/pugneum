// Find the index just past a balanced, quote-aware (...) group that begins at
// `start` (where str[start] must be '('). Quotes ("..."/'...') are treated as
// opaque so a ')' inside a quoted attribute value does not close the group, and
// a backslash escapes the next character (inside or outside a quote). Returns
// the index one past the matching ')', or -1 if the group is never closed.
//
// This is the table filter's quote-aware analogue of the lexer's bracket
// scanner (packages/lexer/index.js scanChar/parseExpressionUntil). It must stay
// consistent with how the lexer parses attribute groups, since the table filter
// emits Pugneum source that the filterer re-lexes. A single linear scan, so it
// cannot exhibit the O(n^2) backtracking of the old `\([^)]*\)` regexes.
function scanParenGroup(str, start) {
  let depth = 0;
  let quote = null;
  let i = start;
  while (i < str.length) {
    const c = str[i];
    if (quote) {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      i++;
      continue;
    }
    if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return -1;
}

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

// Parse a separator line (the raw line after tr-prefix extraction) into
// an array of colgroup descriptors: [{segs: [{align, attrs}, ...]}, ...].
// || marks colgroup boundaries; | separates cols within a colgroup.
function parseSeparatorLine(rowLine) {
  // Split on || first to get colgroup chunks
  const cgChunks = rowLine.split('||');
  return cgChunks
    .map(function (chunk) {
      // Each chunk is a pipe-delimited list of separator segments
      const segs = splitPipeCells(chunk).map(parseSepSegment);
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
  // Remove an optional balanced (attrs) group wherever it sits between dashes.
  // Quote-aware scanning (not `[^)]*`) so a ')' inside calc(...)/url(...) does
  // not end the group early — and a long run of unbalanced '(' cannot trigger
  // quadratic backtracking.
  const open = s.indexOf('(');
  if (open !== -1) {
    const close = scanParenGroup(s, open);
    if (close !== -1) s = s.slice(0, open) + s.slice(close);
  }
  // Remaining must be the documented separator width: at least three dashes.
  return /^-{3,}$/.test(s);
}

// An equals separator segment is at least three equals signs.
function isEqualsSepSegment(cell) {
  return /^={3,}$/.test(cell);
}

// Classify a pipe-delimited row by its separator type:
// Returns 'dash' if its cells are dash-separator segments,
// 'equals' if its cells are equals-separator segments,
// 'mixed' if some are dash and some are equals,
// or null if it is not a separator row at all.
// An empty cell (e.g. a blank middle column, or a `||` colgroup edge) is a
// no-alignment column: it neither disqualifies the row nor decides its type, so
// `| --- |  | --- |` is still a separator rather than silently demoting to data.
// Each cell is classified once in a single pass (the old some/some/every form
// re-ran isDashSepSegment up to 3x per cell, each call allocating + scanning).
function classifySeparatorRow(row) {
  if (row.cells.length === 0) return null;
  let hasDash = false;
  let hasEquals = false;
  for (const cell of row.cells) {
    if (cell === '') continue; // empty column: allowed, type-neutral
    if (isDashSepSegment(cell)) hasDash = true;
    else if (isEqualsSepSegment(cell)) hasEquals = true;
    else return null; // a non-separator, non-empty cell: this is a data row
  }
  if (hasDash && hasEquals) return 'mixed';
  if (hasDash) return 'dash';
  if (hasEquals) return 'equals';
  return null; // all cells empty: not a separator
}

// Parse a separator segment into {align, attrs}.
// align is '' | 'left' | 'right' | 'center'
// attrs is the raw content inside parens, or ''
function parseSepSegment(seg) {
  seg = seg.trim();
  const left = seg[0] === ':';
  const right = seg[seg.length - 1] === ':';
  // Extract the inside of a balanced (attrs) group (quote-aware, so a ')' in a
  // value such as style="calc(1px)" survives). `attrs` is the content between
  // the outer parens, matching the old /\(([^)]*)\)/ capture for simple values.
  let attrs = '';
  const open = seg.indexOf('(');
  if (open !== -1) {
    const close = scanParenGroup(seg, open);
    if (close !== -1) attrs = seg.slice(open + 1, close - 1);
  }
  const align = left && right ? 'center' : left ? 'left' : right ? 'right' : '';
  return {align: align, attrs: attrs};
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
// Returns {caption: {attrStr, text} | null, rest: string[]} where attrStr is the
// balanced (attrs) group (or '') and text is the raw caption text; generate.js
// assembles and escapes the Pugneum line. rest is the remaining lines.
function parseCaption(lines) {
  if (lines.length === 0) return {caption: null, rest: lines};
  const first = lines[0];
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
    caption: {attrStr: group.attrs, text: text},
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

// Parse an array of trimmed non-empty lines into a table structure.
// Returns {caption, sections, colgroups, hasSeparatorOrMarker}.
//   caption: {attrStr, text} | null
//   sections: [{tag, attrStr, rows}]
//   colgroups: array of colgroup descriptors from the first dash-sep, or null
//   hasSeparatorOrMarker: boolean
function parse(lines) {
  // Check for caption on the first non-empty line.
  const captionResult = parseCaption(lines);
  const caption = captionResult.caption;
  const dataLines = captionResult.rest;

  // Parse each data line as: section marker, pipe row, or ignored non-pipe line.
  // Build a sequence of events: 'marker', 'row', 'dash-sep', 'equals-sep'.
  // Each event carries its payload.
  const events = [];
  for (let li = 0; li < dataLines.length; li++) {
    const line = dataLines[li];

    // Check for section marker (thead/tbody/tfoot on its own line)
    const marker = parseSectionMarker(line);
    if (marker) {
      events.push({type: 'marker', tag: marker.tag, attrStr: marker.attrStr});
      continue;
    }

    // Check for pipe row
    const row = parseRow(line);
    if (row === null) continue; // non-pipe, non-marker line: skip

    // Classify the row
    const sepType = classifySeparatorRow(row);
    if (sepType === 'mixed') {
      throw new Error('Mixed separator: a row cannot mix --- and === segments');
    } else if (sepType === 'dash') {
      // Capture colgroup info from the post-prefix separator line. parseRow
      // already extracted the tr-prefix once and surfaced the remainder as
      // `row.rest` (with `||` colgroup boundaries intact), so there is one
      // decomposition rather than a second parseTrPrefix pass.
      const colgroups = parseSeparatorLine(row.rest);
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

  const sections = []; // [{tag, attrStr, rows}]
  let colgroups = null; // set from the first dash-sep
  let currentRows = [];
  let currentTag = null; // null = implicit, 'thead'/'tbody'/'tfoot' = explicit via marker
  let currentAttrs = '';
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

  function assertSectionCanFollow(tag) {
    const rank = sectionRank[tag];
    if (rank < lastSectionRank) {
      throw new Error(tag + ' cannot appear after a ' + lastSectionTag);
    }
  }

  function pushSection(tag, attrStr, rows) {
    assertSectionCanFollow(tag);
    if (tag === 'thead') {
      if (seenThead) {
        throw new Error('a table may have only one thead');
      }
      seenThead = true;
    } else if (tag === 'tfoot') {
      if (seenTfoot) {
        throw new Error('a table may have only one tfoot');
      }
      seenTfoot = true;
    }
    sections.push({tag: tag, attrStr: attrStr, rows: rows.slice()});
    lastSectionRank = sectionRank[tag];
    lastSectionTag = tag;
  }

  function assertNoPendingEmptySection(boundary) {
    if (currentTag !== null && currentRows.length === 0) {
      throw new Error(
        boundary + ' cannot replace an empty pending ' + currentTag,
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
      pushSection(tag, attrStr, currentRows);
      currentRows = [];
      currentTag = null;
      currentAttrs = '';
    }
  }

  for (let ei = 0; ei < events.length; ei++) {
    const ev = events[ei];

    if (ev.type === 'marker') {
      hasSeparatorOrMarker = true;
      assertNoPendingEmptySection(ev.tag + ' marker');
      // Flush accumulated rows with the implicit tbody tag, then adopt the
      // marker's tag for the rows that follow.
      flushCurrentRows('tbody');
      assertSectionCanFollow(ev.tag);
      currentTag = ev.tag;
      currentAttrs = ev.attrStr;
    } else if (ev.type === 'dash-sep') {
      hasSeparatorOrMarker = true;
      assertNoPendingEmptySection('--- separator');
      if (seenEqualsSep) {
        throw new Error('--- separator cannot appear after ===');
      }
      // seenTfoot covers an already-emitted tfoot; currentTag covers a tfoot
      // marker whose rows are still pending. Either way a header/body separator
      // after the foot is structurally wrong.
      if (seenTfoot || currentTag === 'tfoot') {
        throw new Error('--- separator cannot follow a tfoot marker');
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
      assertNoPendingEmptySection('=== separator');
      if (seenEqualsSep) {
        throw new Error('=== separator can only appear once in a table');
      }
      if (seenTfoot || currentTag === 'tfoot') {
        // A tfoot marker already opened the foot region.
        throw new Error('=== separator cannot follow a tfoot marker');
      }
      seenEqualsSep = true;
      // Flush current rows as tbody (the dash-sep already emitted any thead).
      flushCurrentRows('tbody');
      // Next rows will go into tfoot (set currentTag to 'tfoot')
      currentTag = 'tfoot';
      currentAttrs = '';
    } else if (ev.type === 'row') {
      currentRows.push(ev.row);
    }
  }

  // Flush remaining rows. With currentTag unset, rows after an === go to tfoot
  // and everything else is tbody.
  if (currentRows.length > 0) {
    const finalTag =
      currentTag !== null ? currentTag : seenEqualsSep ? 'tfoot' : 'tbody';
    pushSection(finalTag, currentAttrs, currentRows);
  } else if (currentTag !== null) {
    throw new Error('pending ' + currentTag + ' has no rows');
  }

  return {
    caption: caption,
    sections: sections,
    colgroups: colgroups,
    hasSeparatorOrMarker: hasSeparatorOrMarker,
  };
}

module.exports = parse;
module.exports.classifyCell = classifyCell;
