const parseCell = require('./parse').parseCell;

// Render a col element line given {align, attrs} and an indent string.
function renderCol(seg, indent) {
  let parts = [];
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
  let pairs = [];
  Object.keys(attrs).forEach(function (key) {
    if (key === 'filename') return;
    let val = attrs[key];
    if (val === true) {
      pairs.push(key);
    } else {
      pairs.push(key + '="' + String(val).replace(/"/g, '\\"') + '"');
    }
  });
  if (pairs.length === 0) return '';
  return '(' + pairs.join(' ') + ')';
}

// Generate indented Pugneum lines for a section (thead, tbody, or tfoot),
// with the given default cell tag (th or td).
// rows is an array of {trAttrs, cells} objects.
// sectionAttrs is an optional attribute string like '(class="x")' or ''.
function renderSection(sectionTag, rows, defaultCellTag, indent, sectionAttrs) {
  let lines = [];
  lines.push(indent + sectionTag + (sectionAttrs || ''));
  rows.forEach(function (row) {
    let trLine = indent + '  tr';
    if (row.trAttrs !== null && row.trAttrs !== '') {
      trLine = indent + '  tr' + row.trAttrs;
    }
    lines.push(trLine);
    row.cells.forEach(function (cell) {
      let parsed = parseCell(cell, defaultCellTag);
      let cellLine = indent + '    ' + parsed.tag + parsed.attrStr;
      if (parsed.text !== '') {
        cellLine += ' ' + parsed.text;
      }
      lines.push(cellLine);
    });
  });
  return lines;
}

// Generate a Pugneum source string from the parsed table structure and filter attrs.
// parsed is {captionLine, sections, colgroups, hasSeparatorOrMarker}.
// attrs is the raw filter attributes object.
function generate(parsed, attrs) {
  let captionLine = parsed.captionLine;
  let sections = parsed.sections;
  let colgroups = parsed.colgroups;
  let hasSeparatorOrMarker = parsed.hasSeparatorOrMarker;

  let attrStr = formatAttrs(attrs);
  let lines = [];
  lines.push('table' + attrStr);

  // Emit caption if present.
  if (captionLine !== null) {
    lines.push('  ' + captionLine);
  }

  if (!hasSeparatorOrMarker) {
    // No separators or markers: all rows go in tbody with td.
    let allRows = sections.length > 0 ? sections[0].rows : [];
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
      let defaultCellTag = section.tag === 'thead' ? 'th' : 'td';
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
}

module.exports = generate;
