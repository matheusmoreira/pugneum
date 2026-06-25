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

const classifyCell = require('./parse').classifyCell;

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
      pairs.push(key + '="' + escapeAttrValue(val) + '"');
    }
  });
  if (pairs.length === 0) return '';
  return '(' + pairs.join(' ') + ')';
}

// Neutralize a literal `#{` in cell/caption text. Cell text is re-lexed as
// Pugneum, where `#{name}` is variable interpolation that is illegal outside a
// mixin (VARIABLE_OUTSIDE_MIXIN) — so a table documenting shell prompts or
// Pugneum syntax would otherwise crash the whole build. The lexer treats a
// backslash-escaped `\#{` as the literal text `#{`, so we prepend a backslash
// to each unescaped `#{`. A `#{` already preceded by a backslash is left alone
// (the author already escaped it; double-escaping would reintroduce the crash).
// Inline shorthand sigils (`*(`, `@(`, ...) are deliberately left ACTIVE per the
// cell contract; only `#{` is neutralized.
function escapeCellText(text) {
  return text.replace(/(?<!\\)#\{/g, '\\#{');
}

// Generate indented Pugneum lines for a section (thead, tbody, or tfoot),
// with the given default cell tag (th or td).
// rows is an array of {trAttrs, cells} objects.
// sectionAttrs is an optional attribute string like '(class="x")' or ''.
function renderSection(sectionTag, rows, defaultCellTag, indent, sectionAttrs) {
  const lines = [];
  lines.push(indent + sectionTag + (sectionAttrs || ''));
  rows.forEach(function (row) {
    let trLine = indent + '  tr';
    if (row.trAttrs !== null && row.trAttrs !== '') {
      trLine = indent + '  tr' + row.trAttrs;
    }
    lines.push(trLine);
    row.cells.forEach(function (cell) {
      const classified = classifyCell(cell, defaultCellTag);
      let cellLine;
      if (classified.verbatim !== undefined) {
        cellLine = indent + '    ' + classified.verbatim;
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

  // Emit caption if present. The attrs group is already valid Pugneum source;
  // the text is re-lexed as inline content, so neutralize a literal `#{`.
  if (caption !== null) {
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
