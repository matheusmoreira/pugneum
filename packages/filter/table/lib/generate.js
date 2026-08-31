// This module emits a *Pugneum source string*, not HTML. The table filter is
// `exports.type = 'pugneum'`, so the filterer re-lexes/re-parses this output
// (packages/filterer/index.js applyFilterResult case 'pugneum'). Consequences a
// maintainer must respect:
//   - Indentation is significant: exactly 2 spaces per nesting level (the lexer
//     infers block structure from it).
//   - A tag's trailing text (`tag <text>`) becomes a text node the lexer/parser
//     reprocesses, so inline shorthands (`*(...)`, `@(...)`, ...) stay active in
//     cell text by design. A literal `#{` would be read as a mixin interpolation
//     (VARIABLE_OUTSIDE_MIXIN) — see escapeCellText, which neutralizes it.
//   - `(...)` after a tag is parsed by the lexer's attribute grammar, so any
//     attribute string this module emits (formatAttrs) must be valid Pugneum
//     source that survives re-lexing — escape backslashes and quotes, and keep
//     keys to lexable attribute-name characters.
//   - A VERBATIM attribute group taken straight from the table body (a tagged
//     cell head `td(...)`, a caption/section/tr/separator attr group) is NOT
//     cell text and is NOT escaped — it is handed to the lexer's attribute
//     grammar as-is. A live `#{...}` there is variable interpolation outside a
//     mixin, which crashes the re-lex (PUGNEUM:CALL_STACK_UNDERFLOW). Cell TEXT
//     neutralizes `#{` (escapeCellText), but neutralizing inside an attribute
//     value was rejected; instead we detect it up front and raise a clean,
//     coded INTERPOLATION_IN_TABLE_HEAD error — see assertNoInterpolation.

const classifyCell = require('./parse').classifyCell;
const error = require('pugneum-error');
const lex = require('pugneum-lexer');

function backslashRunStart(text, marker, lowerBound) {
  let start = marker;
  while (start > lowerBound && text[start - 1] === '\\') start--;
  return start;
}

// The lexer preserves raw attribute escape provenance and applies the same
// odd/even rule as text: an odd run escapes the opener, while an even run leaves
// a live interpolation after slash-pair decoding.
function hasLiveInterpolation(source) {
  let searchFrom = 0;
  for (;;) {
    const marker = source.indexOf('#{', searchFrom);
    if (marker === -1) return false;
    const slashStart = backslashRunStart(source, marker, searchFrom);
    if ((marker - slashStart) % 2 === 0) return true;
    searchFrom = marker + 2;
  }
}

// A verbatim attribute group (or tagged-cell head) is emitted as-is for the
// re-lex. A live `#{...}` in it cannot be neutralized without rewriting the
// author's attribute value (the rejected option), and reaching the renderer
// crashes with PUGNEUM:CALL_STACK_UNDERFLOW pointing at synthetic source the
// author never wrote. Detect it here and throw a clean, located, coded error
// naming the offending construct instead. `what` describes the construct (e.g.
// "table cell head") and `source` is the verbatim string for the message.
function assertNoInterpolation(source, what, location) {
  if (hasLiveInterpolation(source)) {
    throw error(
      'INTERPOLATION_IN_TABLE_HEAD',
      'live interpolation #{...} is not allowed in a ' +
        what +
        " (it is re-lexed verbatim and would crash); escape it as '\\#{' or " +
        'remove it: ' +
        source,
      location,
    );
  }
}

// Escape a value for a Pugneum double-quoted attribute string so it survives
// the type:'pugneum' re-lex. Backslash MUST be escaped before the quote, else a
// trailing `\` would escape the closing quote and break string termination
// (PUGNEUM:NO_END_BRACKET). Must stay in sync with the lexer's quoted-attribute
// unescaping (packages/lexer/index.js scanChar).
function escapeAttrValue(val) {
  return String(val).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Parentheses and commas have structural meaning in the generated Pugneum
// group even though HTML itself permits them in an attribute name. All other
// validity comes from the lexer's exported canonical HTML-name predicate.
function isValidGeneratedAttributeName(name) {
  return lex.isValidAttributeName(name) && !/[(),]/.test(name);
}

// Scan the raw contents of one Pugneum (...) attribute group. Attribute values
// are opaque across quotes, escapes, and balanced parentheses, so text such as
// `title="mentions scope=x"` cannot masquerade as another attribute. Offsets
// point into the original source, allowing style merging without reserializing
// unrelated author bytes.
function scanRawAttributes(source) {
  const attributes = [];
  let i = 0;

  while (i < source.length) {
    while (/\s/.test(source[i])) i++;
    if (i >= source.length) break;

    const start = i;
    let name;
    if (source[i] === '"' || source[i] === "'") {
      const quote = source[i++];
      const nameStart = i;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\' && i + 1 < source.length) i += 2;
        else i++;
      }
      name = source.slice(nameStart, i);
      if (source[i] === quote) i++;
    } else {
      const nameStart = i;
      while (i < source.length && !/\s|=/.test(source[i])) i++;
      name = source.slice(nameStart, i);
    }

    while (/\s/.test(source[i])) i++;
    let hasValue = false;
    let valueStart = i;
    let valueEnd = i;
    if (source[i] === '=') {
      hasValue = true;
      i++;
      while (/\s/.test(source[i])) i++;

      if (source[i] === '"' || source[i] === "'") {
        const quote = source[i++];
        valueStart = i;
        while (i < source.length && source[i] !== quote) {
          if (source[i] === '\\' && i + 1 < source.length) i += 2;
          else i++;
        }
        valueEnd = i;
        if (source[i] === quote) i++;
      } else {
        valueStart = i;
        let depth = 0;
        let quote = null;
        while (i < source.length) {
          const char = source[i];
          if (char === '\\' && i + 1 < source.length) {
            i += 2;
            continue;
          }
          if (quote) {
            if (char === quote) quote = null;
            i++;
            continue;
          }
          if (char === '"' || char === "'") {
            quote = char;
          } else if (char === '(') {
            depth++;
          } else if (char === ')' && depth > 0) {
            depth--;
          } else if (/\s/.test(char) && depth === 0) {
            break;
          }
          i++;
        }
        valueEnd = i;
      }
    }

    attributes.push({name, start, end: i, hasValue, valueStart, valueEnd});
  }

  return attributes;
}

// Render a col element line given {align, attrs} and an indent string.
function renderCol(seg, indent) {
  const alignStyle = seg.align ? 'text-align:' + seg.align : '';
  const attrs = seg.attrs || '';
  // The separator's (attrs) are emitted verbatim into a col(...) group; a live
  // `#{` would crash the re-lex.
  assertNoInterpolation(
    attrs,
    'separator column attribute group',
    seg.location,
  );
  // Alignment is emitted as style="text-align:...". If the user's col attrs
  // also carry a `style`, merging into two `style="..."` tokens would make the
  // re-lex throw PUGNEUM:DUPLICATE_ATTRIBUTE, so fold the alignment declaration
  // into the user's style value instead of emitting a second attribute.
  if (alignStyle) {
    const merged = mergeAlignmentIntoStyle(
      attrs,
      alignStyle,
      seg.location,
      'table separator',
    );
    if (merged !== null) {
      // Alignment was folded into an existing style="..."; emit attrs alone.
      return indent + 'col(' + merged + ')';
    }
  }
  const parts = [];
  if (alignStyle) {
    parts.push('style="' + alignStyle + '"');
  }
  if (attrs) {
    parts.push(attrs);
  }
  if (parts.length === 0) {
    return indent + 'col';
  }
  return indent + 'col(' + parts.join(' ') + ')';
}

// If `attrs` contains a semantic style attribute in any supported spelling,
// prepend `alignStyle;` to its value while preserving all unrelated raw bytes.
// Returns null when there is no style attribute (the caller emits a separate
// style token). A boolean style is replaced by the alignment declaration rather
// than duplicated; duplicate style attributes remain an explicit error.
function mergeAlignmentIntoStyle(attrs, alignStyle, location, what) {
  const styles = scanRawAttributes(attrs).filter(
    (attr) => attr.name.toLowerCase() === 'style',
  );
  if (styles.length === 0) return null;
  if (styles.length > 1) {
    throw error(
      'DUPLICATE_TABLE_ATTRIBUTE',
      'duplicate style attribute in ' + what,
      location,
    );
  }

  const style = styles[0];
  if (!style.hasValue) {
    return (
      attrs.slice(0, style.start) +
      'style="' +
      alignStyle +
      '"' +
      attrs.slice(style.end)
    );
  }

  const separator = style.valueStart === style.valueEnd ? '' : ';';
  return (
    attrs.slice(0, style.valueStart) +
    alignStyle +
    separator +
    attrs.slice(style.valueStart)
  );
}

function addAlignmentToCellHead(head, align, location) {
  if (!align) return head;

  const tag = head.slice(0, 2);
  const attrs = head.length === 2 ? '' : head.slice(3, -1);
  const alignStyle = 'text-align:' + align;
  const merged = mergeAlignmentIntoStyle(
    attrs,
    alignStyle,
    location,
    'table cell head',
  );
  const result =
    merged === null
      ? (attrs ? attrs + ' ' : '') + 'style="' + alignStyle + '"'
      : merged;
  return tag + '(' + result + ')';
}

function cellColumnSpan(head) {
  if (head === undefined || head.length === 2) return 1;
  const attrs = head.slice(3, -1);
  const colspan = scanRawAttributes(attrs).find(
    (attr) => attr.name.toLowerCase() === 'colspan',
  );
  if (!colspan || !colspan.hasValue) return 1;

  const value = attrs.slice(colspan.valueStart, colspan.valueEnd);
  if (!/^[1-9][0-9]*$/.test(value)) return 1;
  const span = Number(value);
  return Number.isSafeInteger(span) ? span : 1;
}

function hasRawAttribute(attrs, name) {
  const expected = name.toLowerCase();
  return scanRawAttributes(attrs).some(
    (attr) => attr.name.toLowerCase() === expected,
  );
}

// Add scope="col" to a verbatim `th` head for a thead cell, honoring the
// documented contract that header cells in a thead are scoped automatically.
// `td` heads are left untouched. If the author already set a `scope`, the head
// is returned unchanged — appending a second `scope` would make the re-lex throw
// PUGNEUM:DUPLICATE_ATTRIBUTE. Otherwise scope is the first attribute so it
// merges cleanly into an existing group or opens a new one.
function addScopeColToThHead(head) {
  if (head.slice(0, 2) !== 'th') return head;
  // The head is `th` optionally followed by a balanced `(attrs)` group (no
  // trailing text — classifyCell split that off). A 3rd char other than `(`
  // would mean this is not a plain `th` head (e.g. a longer tag the lexer would
  // reject anyway); leave it untouched.
  if (head.length === 2) return 'th(scope="col")';
  if (head[2] !== '(') return head;
  const inner = head.slice(3, -1); // contents between the outer parens
  if (hasRawAttribute(inner, 'scope')) return head;
  return 'th(scope="col"' + (inner ? ' ' + inner : '') + ')';
}

// Format filter attributes (excluding filename) as a Pugneum attribute string.
// Returns '' if no relevant attrs, or '(key="value" ...)' otherwise.
function formatAttrs(attrs, location) {
  const pairs = [];
  Object.keys(attrs).forEach(function (key) {
    if (key === 'filename') return;
    // A key that is not a single lexable attribute-name token (e.g. one
    // containing `)` or whitespace, reachable via programmatic filterOptions)
    // would break out of the attribute group and inject Pugneum. Reject it
    // rather than emit un-lexable source.
    if (!isValidGeneratedAttributeName(key)) {
      throw error(
        'INVALID_TABLE_ATTRIBUTE_NAME',
        'invalid table filter attribute name: ' + JSON.stringify(key),
        location,
      );
    }
    const val = attrs[key];
    if (val === true) {
      pairs.push(key);
    } else {
      const escaped = escapeAttrValue(val);
      // The value is emitted verbatim into the table(...) attribute group; a
      // live `#{` (reachable via programmatic filterOptions) would crash the
      // re-lex (PUGNEUM:CALL_STACK_UNDERFLOW) — reject it cleanly.
      assertNoInterpolation(
        escaped,
        'filter attribute value for ' + key,
        location,
      );
      pairs.push(key + '="' + escaped + '"');
    }
  });
  if (pairs.length === 0) return '';
  return '(' + pairs.join(' ') + ')';
}

// Neutralize a literal `#{` in cell/caption text. Cell text is re-lexed as
// Pugneum, where `#{name}` is variable interpolation that is illegal outside a
// mixin (VARIABLE_OUTSIDE_MIXIN) — so a table documenting shell prompts or
// Pugneum syntax would otherwise crash the whole build. The lexer treats a
// backslash-escaped `\#{` as the literal text `#{` everywhere it re-lexes cell
// text — plain text, inline-shorthand content, and `(...) code spans alike (see
// unescapeShorthand) — so we prepend a backslash to each LIVE `#{`. "Live" means
// an even-length run of preceding backslashes (including zero); an odd run is
// already escaped, and escaping it again would yield `\\#{` = a literal
// backslash followed by live interpolation (the crash, reintroduced).
// Inline shorthand sigils (`*(`, `@(`, ...) stay ACTIVE per the cell contract;
// only `#{` is neutralized. Applied to every re-lexed cell-text path (bare cell,
// tagged-cell trailing text, caption). A `#{` inside a tagged head's (or any
// verbatim) attribute value is NOT neutralized here — that was the rejected
// option; it is rejected with a coded error instead (assertNoInterpolation).
function escapeCellText(text) {
  const pieces = [];
  let copiedThrough = 0;

  for (;;) {
    const marker = text.indexOf('#{', copiedThrough);
    if (marker === -1) break;

    const slashStart = backslashRunStart(text, marker, copiedThrough);

    pieces.push(text.slice(copiedThrough, marker));
    if ((marker - slashStart) % 2 === 0) pieces.push('\\');
    pieces.push('#{');
    copiedThrough = marker + 2;
  }

  if (copiedThrough === 0) return text;
  pieces.push(text.slice(copiedThrough));
  return pieces.join('');
}

// Build one cell source line regardless of whether its head was authored
// explicitly or supplied by the section. Alignment and header scope therefore
// have one ordering and duplicate-attribute policy for both forms.
function renderCell(classified, sectionTag, align, location) {
  const isVerbatim = classified.verbatim !== undefined;
  let head = isVerbatim ? classified.verbatim : classified.tag;

  if (isVerbatim) {
    // Tagged-cell heads are handed back to the real lexer. Reject live
    // interpolation here; only the trailing text is cell-escaped.
    assertNoInterpolation(head, 'table cell head', location);
  }

  head = addAlignmentToCellHead(head, align, location);
  if (sectionTag === 'thead') head = addScopeColToThHead(head);

  const textPrefix = !isVerbatim && classified.text !== '' ? ' ' : '';
  return head + textPrefix + escapeCellText(classified.text);
}

// Append indented Pugneum lines for a section (thead, tbody, or tfoot) directly
// to the caller-owned accumulator, with the given default cell tag (th or td).
// rows is an array of {trAttrs, cells} objects.
// sectionAttrs is an optional attribute string like '(class="x")' or ''.
function renderSection(
  lines,
  sectionTag,
  rows,
  defaultCellTag,
  indent,
  sectionAttrs,
  sectionLocation,
  columnAlignments,
) {
  // The section's (attrs) marker group is emitted verbatim; a live `#{` crashes.
  assertNoInterpolation(
    sectionAttrs || '',
    sectionTag + ' marker attribute group',
    sectionLocation,
  );
  lines.push(indent + sectionTag + (sectionAttrs || ''));
  rows.forEach(function (row) {
    let trLine = indent + '  tr';
    if (row.trAttrs !== null && row.trAttrs !== '') {
      // The tr(attrs) prefix group is emitted verbatim; a live `#{` crashes.
      assertNoInterpolation(
        row.trAttrs,
        'tr prefix attribute group',
        row.location,
      );
      trLine = indent + '  tr' + row.trAttrs;
    }
    lines.push(trLine);
    let columnIndex = 0;
    row.cells.forEach(function (cell) {
      const classified = classifyCell(cell, defaultCellTag);
      const align = columnAlignments[columnIndex] || '';
      columnIndex += cellColumnSpan(classified.verbatim);
      const source = renderCell(classified, sectionTag, align, row.location);
      lines.push(indent + '    ' + source);
    });
  });
}

// Generate a Pugneum source string from the parsed table structure and filter attrs.
// parsed is {caption, sections, colgroups, hasSeparatorOrMarker}.
// attrs is the raw filter attributes object.
function generate(parsed, attrs, invocationLocation) {
  const caption = parsed.caption;
  const sections = parsed.sections;
  const colgroups = parsed.colgroups;
  const hasSeparatorOrMarker = parsed.hasSeparatorOrMarker;

  const attrStr = formatAttrs(attrs, invocationLocation);
  const lines = [];
  lines.push('table' + attrStr);

  // Emit caption if present. The attrs group is emitted verbatim (a live `#{`
  // there crashes the re-lex); the text is re-lexed as inline content, so a
  // literal `#{` in the text is neutralized.
  if (caption !== null) {
    assertNoInterpolation(
      caption.attrStr,
      'caption attribute group',
      caption.location,
    );
    lines.push(
      '  caption' + caption.attrStr + ' ' + escapeCellText(caption.text),
    );
  }

  if (!hasSeparatorOrMarker) {
    // No separators or markers: all rows go in tbody with td.
    const allRows = sections.length > 0 ? sections[0].rows : [];
    renderSection(
      lines,
      'tbody',
      allRows,
      'td',
      '  ',
      '',
      allRows[0] && allRows[0].location,
      [],
    );
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

    const columnAlignments = [];
    if (colgroups !== null) {
      colgroups.forEach(function (colgroup) {
        colgroup.segs.forEach(function (segment) {
          columnAlignments.push(segment.align);
        });
      });
    }

    // Emit each section.
    sections.forEach(function (section) {
      if (section.rows.length === 0) return;
      const defaultCellTag = section.tag === 'thead' ? 'th' : 'td';
      renderSection(
        lines,
        section.tag,
        section.rows,
        defaultCellTag,
        '  ',
        section.attrStr,
        section.location,
        columnAlignments,
      );
    });
  }

  return lines.join('\n');
}

module.exports = generate;
