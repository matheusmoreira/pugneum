'use strict';

var assert = require('node:assert/strict');
var {test, describe} = require('node:test');

var tableFilter = require('../');
var lex = require('pugneum-lexer');
var parse = require('pugneum-parser');

// The table filter is type:'pugneum' — the filterer re-lexes/re-parses its
// output. Round-trip the generated source through the real lexer+parser so a
// future change that emits subtly invalid Pugneum fails here rather than at
// build time. Returns the parsed AST (throws if the source does not re-lex).
function roundTrip(input, attrs) {
  var src = tableFilter.filter(input, attrs || {});
  var options = {filename: 'gen.pg', source: src};
  return parse(lex(src, options), options);
}

describe('table filter', () => {
  test('exports type pugneum', () => {
    assert.strictEqual(tableFilter.type, 'pugneum');
  });

  test('bare rows without separator produce tbody only', () => {
    var input = '| Name | Count |\n| Alice | 42 |';
    var result = tableFilter.filter(input, {});
    assert.strictEqual(
      result,
      'table\n  tbody\n    tr\n      td Name\n      td Count\n    tr\n      td Alice\n      td 42',
    );
  });

  test('basic header-separator-body table', () => {
    var input = '| Name | Count |\n| --- | --- |\n| Alice | 42 |';
    var result = tableFilter.filter(input, {});
    assert.strictEqual(
      result,
      'table\n' +
        '  colgroup\n    col\n    col\n' +
        '  thead\n    tr\n      th(scope="col") Name\n      th(scope="col") Count\n' +
        '  tbody\n    tr\n      td Alice\n      td 42',
    );
  });

  test('filter attrs become table attrs', () => {
    var input = '| a |\n| --- |\n| b |';
    var result = tableFilter.filter(input, {class: 'data'});
    assert.match(result, /^table\(class="data"\)/);
  });
});

describe('tagged cells', () => {
  test('th with attrs', () => {
    var input = '| th(scope="col") Name | th Count |\n| --- | --- |\n| a | 1 |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /th\(scope="col"\) Name/);
  });

  test('td with attrs', () => {
    var input = '| a |\n| --- |\n| td(class="mono") value |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /td\(class="mono"\) value/);
  });

  test('td with colspan', () => {
    var input = '| a | b |\n| --- | --- |\n| td(colspan="2") merged |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /td\(colspan="2"\) merged/);
  });

  test('tagged cell with nested parens in attrs passes through verbatim', () => {
    var input = '| a |\n| --- |\n| td(style="width:calc(100% - 2em)") value |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /td\(style="width:calc\(100% - 2em\)"\) value/);
  });

  test('tagged cell with no text', () => {
    var input = '| a |\n| --- |\n| td(class="empty") |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /td\(class="empty"\)/);
  });

  test('bare td tag with no content', () => {
    var input = '| a |\n| --- |\n| td |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /^\s+td$/m);
  });

  test('escaped \\th produces literal text', () => {
    var input = '| --- |\n| \\th is not a tag |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /td th is not a tag/);
  });

  test('escaped \\td produces literal text', () => {
    var input = '| --- |\n| \\td also literal |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /td td also literal/);
  });
});

describe('row attrs', () => {
  test('tr(attrs) before first pipe', () => {
    var input = '| a |\n| --- |\ntr(class="highlight") | value |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /tr\(class="highlight"\)/);
  });
});

describe('caption', () => {
  test('plain caption', () => {
    var input = 'caption System calls\n| Name |\n| --- |\n| read |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /caption System calls/);
  });

  test('caption with attrs', () => {
    var input =
      'caption(class="sr-only") System call reference\n| Name |\n| --- |\n| read |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /caption\(class="sr-only"\) System call reference/);
  });
});

describe('alignment', () => {
  test('left alignment :---', () => {
    var input = '| a |\n| :--- |\n| b |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /col\(style="text-align:left"\)/);
  });

  test('right alignment ---:', () => {
    var input = '| a |\n| ---: |\n| b |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /col\(style="text-align:right"\)/);
  });

  test('center alignment :---:', () => {
    var input = '| a |\n| :---: |\n| b |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /col\(style="text-align:center"\)/);
  });

  test('no alignment ---', () => {
    var input = '| a |\n| --- |\n| b |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /^\s*col$/m);
  });

  test('col attrs ---(class="mono")---', () => {
    var input = '| a |\n| ---(class="mono")--- |\n| b |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /col\(class="mono"\)/);
  });

  test('alignment + col attrs :---(class="x")---:', () => {
    var input = '| a |\n| :---(class="x")---: |\n| b |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /col\(style="text-align:center" class="x"\)/);
  });

  test('mixed alignment across columns', () => {
    var input = '| a | b | c |\n| :--- | ---: | :---: |\n| 1 | 2 | 3 |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /col\(style="text-align:left"\)/);
    assert.match(result, /col\(style="text-align:right"\)/);
    assert.match(result, /col\(style="text-align:center"\)/);
  });
});

describe('colgroup boundaries', () => {
  test('|| creates separate colgroups', () => {
    var input =
      '| a | b | c | d |\n| :--- | ---: || :--- | :---: |\n| 1 | 2 | 3 | 4 |';
    var result = tableFilter.filter(input, {});
    var colgroups = result.match(/colgroup/g);
    assert.strictEqual(colgroups.length, 2);
  });

  test('|| in data rows treated as |', () => {
    var input =
      '| a | b || c | d |\n| --- | --- || --- | --- |\n| 1 | 2 || 3 | 4 |';
    var result = tableFilter.filter(input, {});
    var tds = result.match(/td /g);
    assert.strictEqual(tds.length, 4);
  });

  test('|| collapses to | in a data row (no separator) — no empty cell', () => {
    // Isolated data-row test: with no separator row, `||` must produce two
    // non-empty cells, not three cells with an empty middle one. Asserting the
    // full tbody pins the behavior the test above only names.
    var input = '| a || b |';
    var result = tableFilter.filter(input, {});
    assert.strictEqual(
      result,
      'table\n  tbody\n    tr\n      td a\n      td b',
    );
  });
});

describe('table structure', () => {
  test('second --- separator starts new tbody', () => {
    var input = '| a |\n| --- |\n| b |\n| --- |\n| c |';
    var result = tableFilter.filter(input, {});
    var tbodies = result.match(/tbody/g);
    assert.strictEqual(tbodies.length, 2);
  });

  test('=== separator starts tfoot', () => {
    var input = '| a |\n| --- |\n| b |\n| === |\n| c |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /tfoot\n\s+tr\n\s+td c/);
  });

  test('=== without --- produces tbody and tfoot, not thead', () => {
    var input = '| a |\n| === |\n| b |';
    var result = tableFilter.filter(input, {});
    assert.doesNotMatch(result, /thead/);
    assert.doesNotMatch(result, /colgroup/);
    assert.match(result, /tbody\n\s+tr\n\s+td a/);
    assert.match(result, /tfoot\n\s+tr\n\s+td b/);
  });

  test('second --- creates only one colgroup', () => {
    var input = '| a |\n| --- |\n| b |\n| --- |\n| c |';
    var result = tableFilter.filter(input, {});
    var colgroups = result.match(/colgroup/g);
    assert.strictEqual(colgroups.length, 1);
  });

  test('multiple === throws error', () => {
    var input = '| a |\n| --- |\n| b |\n| === |\n| c |\n| === |\n| d |';
    assert.throws(() => tableFilter.filter(input, {}), /===.*once/i);
  });

  test('--- after === throws error', () => {
    var input = '| a |\n| --- |\n| b |\n| === |\n| c |\n| --- |\n| d |';
    assert.throws(() => tableFilter.filter(input, {}), /---.*after.*===/i);
  });

  test('mixed --- and === in same row throws error', () => {
    assert.throws(
      () => tableFilter.filter('| --- | === |', {}),
      /[Mm]ixed separator/,
    );
  });
});

describe('box drawing normalization', () => {
  test('│ normalizes to |', () => {
    var input = '│ a │ b │\n│ --- │ --- │\n│ 1 │ 2 │';
    var result = tableFilter.filter(input, {});
    assert.match(result, /thead/);
    assert.match(result, /tbody/);
  });

  test('║ normalizes to ||', () => {
    var input =
      '| a | b ║ c | d |\n| --- | --- ║ --- | --- |\n| 1 | 2 ║ 3 | 4 |';
    var result = tableFilter.filter(input, {});
    var colgroups = result.match(/colgroup/g);
    assert.strictEqual(colgroups.length, 2);
  });

  test('─ normalizes to -', () => {
    var input = '| a |\n| ─── |\n| b |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /thead/);
  });

  test('═ normalizes to =', () => {
    var input = '| a |\n| --- |\n| b |\n| ═══ |\n| c |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /tfoot/);
  });

  test('full box drawing table with junctions', () => {
    var input =
      '┌──────┬──────┐\n│ Name │ Type │\n├──────┼──────┤\n│ fd   │ int  │\n└──────┴──────┘';
    var result = tableFilter.filter(input, {});
    assert.match(result, /thead/);
    assert.match(result, /th\(scope="col"\) Name/);
    assert.match(result, /td fd/);
  });
});

describe('section markers', () => {
  test('thead(attrs) applies attrs to thead', () => {
    var input = 'thead(class="sticky")\n| a |\n| --- |\n| b |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /thead\(class="sticky"\)/);
  });

  test('tbody(attrs) applies attrs to tbody', () => {
    var input = '| a |\n| --- |\ntbody(class="primary")\n| b |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /tbody\(class="primary"\)/);
  });

  test('tfoot(attrs) applies attrs to tfoot', () => {
    var input = '| a |\n| --- |\n| b |\ntfoot(class="totals")\n| c |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /tfoot\(class="totals"\)/);
  });

  test('section markers without separators', () => {
    var input = 'thead\n| a |\ntbody\n| b |\ntfoot\n| c |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /thead\n/);
    assert.match(result, /th\(scope="col"\) a/);
    assert.match(result, /tbody\n/);
    assert.match(result, /td b/);
    assert.match(result, /tfoot\n/);
    assert.match(result, /td c/);
  });

  test('section marker after untagged rows uses tbody, not thead', () => {
    var input = '| a |\ntbody\n| b |';
    var result = tableFilter.filter(input, {});
    assert.doesNotMatch(result, /thead/);
    assert.match(result, /td a/);
    assert.match(result, /td b/);
  });

  test('thead marker followed by --- preserves thead', () => {
    var input = 'thead\n| a |\n| --- |\n| b |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /thead\n\s+tr\n\s+th\(scope="col"\) a/);
    assert.match(result, /tbody\n\s+tr\n\s+td b/);
  });

  test('tfoot marker then === throws error', () => {
    var input = '| a |\n| --- |\ntfoot\n| b |\n| === |\n| c |';
    // The === appears exactly once, so the message must name the real cause
    // (a tfoot marker already opened the foot), not "=== can only appear once".
    assert.throws(
      () => tableFilter.filter(input, {}),
      /===.*follow.*tfoot|tfoot.*===/i,
    );
  });
});

describe('edge cases', () => {
  test('empty cells', () => {
    var input = '| a |  | c |\n| --- | --- | --- |\n|  | b |  |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /th\(scope="col"\) a\n/);
    assert.match(result, /th\(scope="col"\)\n/);
    assert.match(result, /td\n/);
    assert.match(result, /td b\n/);
  });

  test('single column table', () => {
    var input = '| Name |\n| --- |\n| Alice |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /th\(scope="col"\) Name/);
    assert.match(result, /td Alice/);
  });

  test('no header (no separator)', () => {
    var input = '| a | b |\n| c | d |';
    var result = tableFilter.filter(input, {});
    assert.doesNotMatch(result, /thead/);
    assert.match(result, /tbody/);
    var ths = result.match(/\bth\b/g);
    assert.strictEqual(ths, null);
  });

  test('only whitespace lines are skipped', () => {
    var input = '\n\n| a |\n| --- |\n| b |\n\n';
    var result = tableFilter.filter(input, {});
    assert.match(result, /th\(scope="col"\) a/);
    assert.match(result, /td b/);
  });
});

describe('errors', () => {
  test('empty filter body', () => {
    assert.throws(
      () => tableFilter.filter('', {}),
      /empty|no.*rows|no.*cells/i,
    );
  });

  test('whitespace-only body', () => {
    assert.throws(
      () => tableFilter.filter('   \n   \n', {}),
      /empty|no.*rows|no.*cells/i,
    );
  });

  test('separator-only table throws error', () => {
    assert.throws(
      () => tableFilter.filter('| --- | --- |', {}),
      /no.*data.*rows/i,
    );
  });
});

// A ')' inside a quoted attribute value (calc(), url(), rgb()) used to truncate
// the old `\([^)]*\)` regexes, silently dropping or misparsing the construct.
// Balanced-paren scanning fixes all five sites; each output must also re-lex.
describe('balanced parens in attribute groups', () => {
  test('caption(style="calc(...)") is recognized, not dropped', () => {
    var input =
      'caption(style="width:calc(100% - 1em)") Title\n| a |\n| --- |\n| b |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /caption\(style="width:calc\(100% - 1em\)"\) Title/);
    assert.doesNotThrow(() => roundTrip(input));
  });

  test('thead(style="calc(...)") marker keeps its attrs', () => {
    var input = 'thead(style="width:calc(1px)")\n| a |\n| --- |\n| b |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /thead\(style="width:calc\(1px\)"\)/);
    assert.doesNotThrow(() => roundTrip(input));
  });

  test('tbody(style="calc(...)") marker keeps its attrs', () => {
    var input = '| a |\n| --- |\ntbody(style="width:calc(1px)")\n| b |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /tbody\(style="width:calc\(1px\)"\)/);
  });

  test('tr(style="calc(...)") prefix is recognized, not leaked into a cell', () => {
    var input = '| a |\n| --- |\ntr(style="width:calc(100% - 2em)") | v |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /tr\(style="width:calc\(100% - 2em\)"\)/);
    // The literal tr(...) must not appear as cell text.
    assert.doesNotMatch(result, /td tr\(/);
    assert.doesNotThrow(() => roundTrip(input));
  });

  test('separator ---(style="calc(...)")--- is recognized as a separator', () => {
    var input = '| a |\n| ---(style="width:calc(1px)")--- |\n| b |';
    var result = tableFilter.filter(input, {});
    // Not demoted to a data row: a thead/colgroup must appear.
    assert.match(result, /thead/);
    assert.match(result, /col\(style="width:calc\(1px\)"\)/);
    assert.doesNotMatch(result, /td ---/);
    assert.doesNotThrow(() => roundTrip(input));
  });

  test('a long run of unbalanced ( in a cell does not blow up (linear time)', () => {
    // The old `\([^)]*\)` regexes backtracked O(n^2): ~80 KB stalled >10 s.
    var input = '| --- |\n| ' + '('.repeat(200000) + ' |';
    var t0 = Date.now();
    tableFilter.filter(input, {});
    var elapsed = Date.now() - t0;
    assert.ok(elapsed < 2000, 'took ' + elapsed + 'ms (expected linear)');
  });
});

// formatAttrs emits Pugneum source the filterer re-lexes; it must escape
// backslashes (not just quotes) and reject keys that are not lexable names.
describe('formatAttrs serialization', () => {
  test('a value ending in a backslash re-lexes (no NO_END_BRACKET)', () => {
    var input = '| a |\n| --- |\n| b |';
    var result = tableFilter.filter(input, {'data-path': 'C:\\'});
    assert.match(result, /^table\(data-path="C:\\\\"\)/);
    assert.doesNotThrow(() => roundTrip(input, {'data-path': 'C:\\'}));
  });

  test('a value with backslash-quote re-lexes', () => {
    var attrs = {title: 'a\\"b'};
    assert.doesNotThrow(() => roundTrip('| a |\n| --- |\n| b |', attrs));
  });

  test('a key that is not a lexable attribute name is rejected', () => {
    assert.throws(
      () =>
        tableFilter.filter('| a |\n| --- |\n| b |', {'x) tr.injected(': true}),
      /invalid attribute name/i,
    );
  });
});

// Alignment is emitted as style="text-align:..."; combining it with an explicit
// col `style` attr must merge, not emit two style attributes (DUPLICATE_ATTRIBUTE).
describe('alignment + explicit style attr', () => {
  test(':---(style="color:red")---: merges alignment into the style', () => {
    var input = '| a |\n| :---(style="color:red")---: |\n| b |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /col\(style="text-align:center;color:red"\)/);
    // Exactly one style attribute on the col.
    var col = result.split('\n').find((l) => /col\(/.test(l));
    assert.strictEqual((col.match(/style=/g) || []).length, 1);
    assert.doesNotThrow(() => roundTrip(input));
  });

  test('alignment + non-style attr still emits two attributes', () => {
    var input = '| a |\n| :---(class="x")---: |\n| b |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /col\(style="text-align:center" class="x"\)/);
  });
});

// DECISION #4: cell/caption text keeps inline shorthands ACTIVE, but a literal
// `#{` is neutralized so tabular data cannot crash with VARIABLE_OUTSIDE_MIXIN.
describe('literal #{ in cell/caption text', () => {
  test('a cell containing #{x} does not crash and re-lexes', () => {
    var input = '| --- |\n| value #{x} here |';
    var result = tableFilter.filter(input, {});
    // The emitted source escapes the interpolation so the lexer treats it as
    // literal text.
    assert.match(result, /td value \\#\{x\} here/);
    assert.doesNotThrow(() => roundTrip(input));
  });

  test('a caption containing #{n} does not crash and re-lexes', () => {
    var input = 'caption ref #{n}\n| a |\n| --- |\n| b |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /caption ref \\#\{n\}/);
    assert.doesNotThrow(() => roundTrip(input));
  });

  test('inline shorthands stay active in cell text', () => {
    var input = '| --- |\n| *(bold) |';
    var result = tableFilter.filter(input, {});
    // *(bold) is left intact (the lexer turns it into <strong>); only #{ is
    // neutralized.
    assert.match(result, /td \*\(bold\)/);
  });
});

// classifyCell must require a BALANCED (attrs) group for verbatim treatment, so
// an unbalanced th(/td( becomes data instead of crashing the re-lex.
describe('cell classification edge cases', () => {
  test('unbalanced th( is treated as data, not a verbatim tag (no crash)', () => {
    var input = '| a |\n| --- |\n| th(scope value |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /td th\(scope value/);
    assert.doesNotThrow(() => roundTrip(input));
  });

  test('a cell with a .class/#id is data, not an invalid tag (no re-lex crash)', () => {
    // td.5 is NOT treated as a tag with class "5" (which would throw
    // INVALID_CLASS_NAME on re-lex); it is plain cell data.
    var input = '| --- |\n| td.5 |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /td td\.5/);
    assert.doesNotThrow(() => roundTrip(input));
  });

  test('\\theme keeps its literal text (backslash escape is precise)', () => {
    // \theme is not a tagged-cell form, so the backslash is not stripped.
    var input = '| --- |\n| \\theme |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /td \\theme/);
  });
});

// Section uniqueness is enforced uniformly across marker and separator paths.
describe('section uniqueness', () => {
  test('two thead markers throw', () => {
    assert.throws(
      () => tableFilter.filter('thead\n| 1 |\nthead\n| 2 |', {}),
      /only one thead/i,
    );
  });

  test('implicit thead (dash-sep) plus an explicit thead marker throws', () => {
    var input = '| h |\n| --- |\nthead(class="x")\n| 2 |\n| b |';
    assert.throws(() => tableFilter.filter(input, {}), /only one thead/i);
  });

  test('two tfoot markers throw', () => {
    assert.throws(
      () => tableFilter.filter('tfoot\n| 1 |\ntfoot\n| 2 |', {}),
      /only one tfoot/i,
    );
  });

  test('a tbody marker after a tfoot marker throws (tfoot must be last)', () => {
    assert.throws(
      () => tableFilter.filter('tfoot\n| 1 |\ntbody\n| 2 |', {}),
      /tbody cannot appear after a tfoot/i,
    );
  });
});

// An empty separator cell is a type-neutral column, not a demotion to data.
describe('empty separator cells', () => {
  test('a blank middle separator cell still yields a thead', () => {
    var input = '| a | b | c |\n| --- |   | --- |\n| 1 | 2 | 3 |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /thead/);
    // The --- separator text must not leak as a data cell.
    assert.doesNotMatch(result, /td ---/);
  });
});
