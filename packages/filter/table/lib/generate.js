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

// A live (unescaped) `#{` opening a variable interpolation. Inside a verbatim
// attribute group the lexer's quoted-string layer consumes one backslash before
// the `#`, so ANY backslash immediately before `#{` makes it literal; only a
// `#{` with no preceding backslash is live (verified across backslash runs).
// This differs from cell TEXT, where the even/odd backslash parity rule applies
// (see escapeCellText) — hence a dedicated detector for the attribute context.
const LIVE_INTERPOLATION = /(?<!\\)#\{/;

// A verbatim attribute group (or tagged-cell head) is emitted as-is for the
// re-lex. A live `#{...}` in it cannot be neutralized without rewriting the
// author's attribute value (the rejected option), and reaching the renderer
// crashes with PUGNEUM:CALL_STACK_UNDERFLOW pointing at synthetic source the
// author never wrote. Detect it here and throw a clean, located, coded error
// naming the offending construct instead. `what` describes the construct (e.g.
// "table cell head") and `source` is the verbatim string for the message.
function assertNoInterpolation(source, what) {
  if (LIVE_INTERPOLATION.test(source)) {
    throw error(
      'INTERPOLATION_IN_TABLE_HEAD',
      'live interpolation #{...} is not allowed in a ' +
        what +
        " (it is re-lexed verbatim and would crash); escape it as '\\#{' or " +
        'remove it: ' +
        source,
      {},
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

// A Pugneum attribute name the lexer will accept as a single token: it cannot
// contain whitespace, parens, quotes, `=`, or `,`, which would terminate the
// name and corrupt the surrounding attribute group.
const VALID_ATTR_KEY = /^[^\s(),="']+$/;

// Render a col element line given {align, attrs} and an indent string.
function renderCol(seg, indent) {
  const alignStyle = seg.align ? 'text-align:' + seg.align : '';
  const attrs = seg.attrs || '';
  // The separator's (attrs) are emitted verbatim into a col(...) group; a live
  // `#{` would crash the re-lex.
  assertNoInterpolation(attrs, 'separator column attribute group');
  // Alignment is emitted as style="text-align:...". If the user's col attrs
  // also carry a `style`, merging into two `style="..."` tokens would make the
  // re-lex throw PUGNEUM:DUPLICATE_ATTRIBUTE, so fold the alignment declaration
  // into the user's style value instead of emitting a second attribute.
  if (alignStyle) {
    const merged = mergeAlignmentIntoStyle(attrs, alignStyle);
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

// If `attrs` (the raw text inside a separator's (...) group) contains a
// `style="..."` attribute, prepend `alignStyle;` to its value and return the
// updated attrs string. Returns null when there is no style attribute to merge
// into (the caller then emits a separate style="..." token).
function mergeAlignmentIntoStyle(attrs, alignStyle) {
  // Match style="..." with a quote-respecting value. Anchored on a word
  // boundary so attributes like `data-style` are not mistaken for `style`.
  const m = attrs.match(/(^|\s)style="((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  const existing = m[2];
  const combined = alignStyle + (existing ? ';' + existing : '');
  return (
    attrs.slice(0, m.index) +
    m[1] +
    'style="' +
    combined +
    '"' +
    attrs.slice(m.index + m[0].length)
  );
}

// A `scope` attribute already present in a verbatim attribute group. Boundary
// anchored (start-of-group or whitespace) so `data-scope` / `rowscope` do not
// count as a `scope` attribute, and only matched up to its `=` so the value is
// irrelevant.
const HAS_SCOPE_ATTR = /(^|\s)scope=/;

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
  if (HAS_SCOPE_ATTR.test(inner)) return head;
  return 'th(scope="col"' + (inner ? ' ' + inner : '') + ')';
}

// Format filter attributes (excluding filename) as a Pugneum attribute string.
// Returns '' if no relevant attrs, or '(key="value" ...)' otherwise.
function formatAttrs(attrs) {
  const pairs = [];
  Object.keys(attrs).forEach(function (key) {
    if (key === 'filename') return;
    // A key that is not a single lexable attribute-name token (e.g. one
    // containing `)` or whitespace, reachable via programmatic filterOptions)
    // would break out of the attribute group and inject Pugneum. Reject it
    // rather than emit un-lexable source.
    if (!VALID_ATTR_KEY.test(key)) {
      throw new Error('invalid attribute name: ' + JSON.stringify(key));
    }
    const val = attrs[key];
    if (val === true) {
      pairs.push(key);
    } else {
      const escaped = escapeAttrValue(val);
      // The value is emitted verbatim into the table(...) attribute group; a
      // live `#{` (reachable via programmatic filterOptions) would crash the
      // re-lex (PUGNEUM:CALL_STACK_UNDERFLOW) — reject it cleanly.
      assertNoInterpolation(escaped, 'filter attribute value for ' + key);
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
  return text.replace(/(\\*)(#\{)/g, function (match, slashes, hash) {
    return slashes.length % 2 === 0 ? slashes + '\\' + hash : match;
  });
}

// Generate indented Pugneum lines for a section (thead, tbody, or tfoot),
// with the given default cell tag (th or td).
// rows is an array of {trAttrs, cells} objects.
// sectionAttrs is an optional attribute string like '(class="x")' or ''.
function renderSection(sectionTag, rows, defaultCellTag, indent, sectionAttrs) {
  const lines = [];
  // The section's (attrs) marker group is emitted verbatim; a live `#{` crashes.
  assertNoInterpolation(
    sectionAttrs || '',
    sectionTag + ' marker attribute group',
  );
  lines.push(indent + sectionTag + (sectionAttrs || ''));
  rows.forEach(function (row) {
    let trLine = indent + '  tr';
    if (row.trAttrs !== null && row.trAttrs !== '') {
      // The tr(attrs) prefix group is emitted verbatim; a live `#{` crashes.
      assertNoInterpolation(row.trAttrs, 'tr prefix attribute group');
      trLine = indent + '  tr' + row.trAttrs;
    }
    lines.push(trLine);
    row.cells.forEach(function (cell) {
      const classified = classifyCell(cell, defaultCellTag);
      let cellLine;
      if (classified.verbatim !== undefined) {
        // Tagged cell: the head (tag + attrs) is verbatim Pugneum the real lexer
        // parses; only the trailing text is re-lexed as inline content, so
        // neutralize a literal `#{` there (classified.text keeps its leading
        // space, or is '' when the cell is head-only). A live `#{` in the head's
        // attribute group is NOT cell text — reject it cleanly rather than let
        // the re-lex crash.
        assertNoInterpolation(classified.verbatim, 'table cell head');
        // An explicit `th` head in a thead still gets scope="col" (the README
        // contract: header cells in a thead are scoped automatically) — but only
        // when the author did not already set scope, else the re-lex would throw
        // DUPLICATE_ATTRIBUTE.
        const head =
          sectionTag === 'thead'
            ? addScopeColToThHead(classified.verbatim)
            : classified.verbatim;
        cellLine = indent + '    ' + head + escapeCellText(classified.text);
      } else {
        cellLine = indent + '    ' + classified.tag;
        if (classified.tag === 'th' && sectionTag === 'thead') {
          cellLine += '(scope="col")';
        }
        if (classified.text !== '') {
          // Bare-cell text is re-lexed as Pugneum inline content; neutralize a
          // literal `#{` so tabular data does not crash the build.
          cellLine += ' ' + escapeCellText(classified.text);
        }
      }
      lines.push(cellLine);
    });
  });
  return lines;
}

// Generate a Pugneum source string from the parsed table structure and filter attrs.
// parsed is {caption, sections, colgroups, hasSeparatorOrMarker}.
// attrs is the raw filter attributes object.
function generate(parsed, attrs) {
  const caption = parsed.caption;
  const sections = parsed.sections;
  const colgroups = parsed.colgroups;
  const hasSeparatorOrMarker = parsed.hasSeparatorOrMarker;

  const attrStr = formatAttrs(attrs);
  const lines = [];
  lines.push('table' + attrStr);

  // Emit caption if present. The attrs group is emitted verbatim (a live `#{`
  // there crashes the re-lex); the text is re-lexed as inline content, so a
  // literal `#{` in the text is neutralized.
  if (caption !== null) {
    assertNoInterpolation(caption.attrStr, 'caption attribute group');
    lines.push(
      '  caption' + caption.attrStr + ' ' + escapeCellText(caption.text),
    );
  }

  if (!hasSeparatorOrMarker) {
    // No separators or markers: all rows go in tbody with td.
    const allRows = sections.length > 0 ? sections[0].rows : [];
    lines.push(...renderSection('tbody', allRows, 'td', '  ', ''));
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
      const defaultCellTag = section.tag === 'thead' ? 'th' : 'td';
      lines.push(
        ...renderSection(
          section.tag,
          section.rows,
          defaultCellTag,
          '  ',
          section.attrStr,
        ),
      );
    });
  }

  return lines.join('\n');
}

module.exports = generate;
