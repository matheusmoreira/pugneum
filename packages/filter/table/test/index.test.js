'use strict';

var assert = require('node:assert/strict');
var {test, describe} = require('node:test');

var tableFilter = require('../');
var applyFilters = require('pugneum-filterer');
var lex = require('pugneum-lexer');
var parse = require('pugneum-parser');
var render = require('pugneum-renderer');

// The table filter is type:'pugneum' — the filterer re-lexes/re-parses its
// output. Round-trip the generated source through the real lexer+parser so a
// future change that emits subtly invalid Pugneum fails here rather than at
// build time. Returns the parsed AST (throws if the source does not re-lex).
function roundTrip(input, attrs) {
  var src = tableFilter.filter(input, attrs || {});
  var options = {filename: 'gen.pg', source: src};
  return parse(lex(src, options), options);
}

function renderRoundTrip(input, attrs) {
  var src = tableFilter.filter(input, attrs || {});
  var options = {filename: 'gen.pg', source: src, warnings: []};
  var ast = parse(lex(src, options), options);
  return {src, ast, html: render(ast, options)};
}

function collectNodes(root, type, result) {
  result = result || [];
  if (!root || typeof root !== 'object') return result;
  if (root.type === type) result.push(root);
  Object.keys(root).forEach((key) => {
    if (key === 'loc') return;
    var value = root[key];
    if (Array.isArray(value)) {
      value.forEach((entry) => collectNodes(entry, type, result));
    } else if (value && typeof value === 'object') {
      collectNodes(value, type, result);
    }
  });
  return result;
}

function applyTableThroughFilterer(attrs) {
  var source = ':table\n  | a |\n  | --- |\n  | b |';
  var options = {
    filename: 'table-option.pg',
    source,
    filterOptions: {table: attrs},
  };
  var ast = parse(lex(source, options), options);
  return applyFilters(ast, {table: tableFilter}, options);
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

  test('large sections append output with constant-arity operations', () => {
    var input = Array.from(
      {length: 256},
      (_, index) => '| ' + index + ' |',
    ).join('\n');
    var originalPush = Array.prototype.push;
    var maxArguments = 0;
    var result;

    Array.prototype.push = function () {
      maxArguments = Math.max(maxArguments, arguments.length);
      return Reflect.apply(originalPush, this, arguments);
    };
    try {
      result = tableFilter.filter(input, {});
    } finally {
      Array.prototype.push = originalPush;
    }

    assert.match(result, /td 255$/);
    assert.strictEqual(maxArguments, 1);
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

  test('╠, ╣, and ╬ preserve double-line colgroup boundaries', () => {
    var input = '| a | b |\n╠───╬───╣\n| 1 | 2 |';
    assert.strictEqual(
      tableFilter.filter(input, {}),
      'table\n' +
        '  colgroup\n    col\n' +
        '  colgroup\n    col\n' +
        '  thead\n    tr\n      th(scope="col") a\n      th(scope="col") b\n' +
        '  tbody\n    tr\n      td 1\n      td 2',
    );
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
    var result = renderRoundTrip('| a |\n| --- |\n| b |', attrs);
    var table = collectNodes(result.ast, 'Tag').find(
      (node) => node.name === 'table',
    );
    assert.strictEqual(
      result.src.split('\n')[0],
      String.raw`table(title="a\\\"b")`,
    );
    assert.deepStrictEqual(
      table.attrs.map(({name, val}) => ({name, val})),
      [{name: 'title', val: attrs.title}],
    );
    assert.match(result.html, /^<table title="a\\&quot;b">/);
  });

  test('a boolean compact option survives source, AST, and HTML', () => {
    var result = renderRoundTrip('| a |\n| --- |\n| b |', {compact: true});
    var table = collectNodes(result.ast, 'Tag').find(
      (node) => node.name === 'table',
    );
    assert.strictEqual(result.src.split('\n')[0], 'table(compact)');
    assert.deepStrictEqual(
      table.attrs.map(({name, val}) => ({name, val})),
      [{name: 'compact', val: true}],
    );
    assert.match(result.html, /^<table compact>/);
  });

  test('a key that is not a lexable attribute name is rejected', () => {
    assert.throws(
      () =>
        tableFilter.filter('| a |\n| --- |\n| b |', {'x) tr.injected(': true}),
      /invalid table filter attribute name/i,
    );
  });

  test('lexer-forbidden programmatic keys fail at the table boundary', () => {
    ['x/y', 'x>y', 'x\0y'].forEach((key) => {
      assert.throws(
        () => applyTableThroughFilterer({[key]: 'value'}),
        (err) => {
          assert.strictEqual(err.code, 'PUGNEUM:FILTER_ERROR');
          assert.strictEqual(
            err.msg,
            "Filter 'table' failed: invalid table filter attribute name: " +
              JSON.stringify(key),
          );
          assert.strictEqual(err.filename, 'table-option.pg');
          assert.strictEqual(err.line, 1);
          assert.strictEqual(err.column, 1);
          return true;
        },
      );
    });
  });
});

describe('grammar-boundary value preservation', () => {
  test('an unquoted value with nested parentheses round-trips exactly', () => {
    var input = '| a |\n| ---(style=width:calc(1px))--- |\n| b |';
    var result = renderRoundTrip(input);
    var col = collectNodes(result.ast, 'Tag').find(
      (node) => node.name === 'col',
    );
    assert.match(result.src, /col\(style=width:calc\(1px\)\)/);
    assert.deepStrictEqual(
      col.attrs.map(({name, val}) => ({name, val})),
      [{name: 'style', val: 'width:calc(1px)'}],
    );
    assert.match(result.html, /<col style="width:calc\(1px\)">/);
  });

  test('odd backslash runs keep literal interpolation text', () => {
    [
      [1, 'path #{x}'],
      [3, 'path \\#{x}'],
    ].forEach(([count, expected]) => {
      var input = '| --- |\n| path ' + '\\'.repeat(count) + '#{x} |';
      var result = renderRoundTrip(input);
      var text = collectNodes(result.ast, 'Text').find((node) =>
        node.val.startsWith('path'),
      );
      assert.strictEqual(text.val, expected);
      assert.ok(result.html.includes('<td>' + expected + '</td>'));
    });
  });
});

describe('cell-text interpolation escape scaling', () => {
  test('preserves odd and even backslash parity before every marker', () => {
    for (var count = 0; count <= 8; count++) {
      var slashes = '\\'.repeat(count);
      var result = tableFilter.filter('| ' + slashes + '#{x} |', {});
      var expected = '\\'.repeat(count + (count % 2 === 0 ? 1 : 0)) + '#{x}';
      assert.ok(result.endsWith('td ' + expected), 'slash count ' + count);
    }
  });

  test('an unmatched backslash run is processed within a linear-work budget', () => {
    var slashes = '\\'.repeat(50000);
    var start = process.hrtime.bigint();
    var result = tableFilter.filter('| ' + slashes + 'x |', {});
    var elapsed = Number(process.hrtime.bigint() - start) / 1e6;

    assert.ok(elapsed < 2000, 'escaping took ' + elapsed.toFixed(0) + 'ms');
    assert.ok(result.endsWith('td ' + slashes + 'x'));
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

  test('single-quoted, spaced style merges as one semantic attribute', () => {
    var input = "| a |\n| :---(style = 'color:red')---: |\n| b |";
    var result = renderRoundTrip(input);
    var col = collectNodes(result.ast, 'Tag').find(
      (node) => node.name === 'col',
    );
    assert.match(result.src, /col\(style = 'text-align:center;color:red'\)/);
    assert.deepStrictEqual(
      col.attrs.map(({name, val}) => ({name, val})),
      [{name: 'style', val: 'text-align:center;color:red'}],
    );
    assert.match(result.html, /<col style="text-align:center;color:red">/);
  });

  test('style-like text inside another value is not rewritten', () => {
    var input = '| a |\n| :---(title=\'mentions style="x"\')---: |\n| b |';
    var result = renderRoundTrip(input);
    var col = collectNodes(result.ast, 'Tag').find(
      (node) => node.name === 'col',
    );
    assert.match(
      result.src,
      /col\(style="text-align:center" title='mentions style="x"'\)/,
    );
    assert.deepStrictEqual(
      col.attrs.map(({name, val}) => ({name, val})),
      [
        {name: 'style', val: 'text-align:center'},
        {name: 'title', val: 'mentions style="x"'},
      ],
    );
  });

  test('boolean style is replaced rather than duplicated', () => {
    var input = '| a |\n| :---(style)---: |\n| b |';
    var result = renderRoundTrip(input);
    var col = collectNodes(result.ast, 'Tag').find(
      (node) => node.name === 'col',
    );
    assert.match(result.src, /col\(style="text-align:center"\)/);
    assert.deepStrictEqual(
      col.attrs.map(({name, val}) => ({name, val})),
      [{name: 'style', val: 'text-align:center'}],
    );
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

  // The over-escape leak only manifests after render (the intermediate source
  // looks fine), so render the filter output through the full pipeline.
  function renderTable(input) {
    var src = tableFilter.filter(input, {});
    var options = {filename: 'gen.pg', source: src};
    return render(parse(lex(src, options), options), options);
  }

  test('a TAGGED cell containing #{x} does not crash and renders it literally', () => {
    var input = '| --- |\n| th(scope="col") cost #{usd} |';
    assert.doesNotThrow(() => roundTrip(input));
    assert.match(renderTable(input), /<th[^>]*>cost #\{usd\}<\/th>/);
  });

  test('#{ inside a `(...) code span renders literally with no leaked backslash', () => {
    var html = renderTable('| --- |\n| `(fmt #{n} end)` |');
    assert.match(html, /<code>fmt #\{n\} end<\/code>/);
    assert.doesNotMatch(html, /\\#\{/);
  });

  test('an even-length backslash run before #{ cannot smuggle a live interpolation', () => {
    // `\\#{x}` is a literal backslash + a would-be interpolation; escaping must
    // account for the run so the re-lex does not crash with VARIABLE_OUTSIDE_MIXIN.
    var input = '| --- |\n| path \\\\#{x} |';
    assert.doesNotThrow(() => roundTrip(input));
    assert.doesNotThrow(() => renderTable(input));
    // ...and the rendered output keeps the author's literal backslash: a run of
    // two collapses to one with #{x} inert, NOT stripped to a bare #{x}. Guards a
    // backslash-count regression the doesNotThrow checks alone would let through.
    assert.match(renderTable(input), /<td>path \\#\{x\}<\/td>/);
  });

  test('#{ inside link/image/abbr shorthands in a cell renders literally (attribute sinks)', () => {
    // @()/!()/?() route content into href/alt/title ATTRIBUTES that interpolate
    // later, so the escaped \#{ must survive the shorthand unescape (which must
    // NOT strip \#) and be resolved at attribute time. Regression guard: a shared
    // \#-># unescape re-exposed a live #{ here and crashed CALL_STACK_UNDERFLOW.
    assert.match(
      renderTable('| --- |\n| @(http://x/#{n} go) |'),
      /<a href="http:\/\/x\/#\{n\}">go<\/a>/,
    );
    assert.match(
      renderTable('| --- |\n| !(a.png alt #{n}) |'),
      /<img src="a\.png" alt="alt #\{n\}">/,
    );
    assert.match(
      renderTable('| --- |\n| ?(API uses #{tok}) |'),
      /<abbr title="uses #\{tok\}">API<\/abbr>/,
    );
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

  test('a thead marker cannot regress from a populated tfoot', () => {
    assert.throws(
      () => tableFilter.filter('tfoot\n| 1 |\nthead\n| 2 |', {}),
      /thead cannot appear after a tfoot/i,
    );
  });

  test('a thead marker cannot regress from a populated tbody', () => {
    assert.throws(
      () => tableFilter.filter('tbody\n| 1 |\nthead\n| 2 |', {}),
      /thead cannot appear after a tbody/i,
    );
  });

  test('a marker cannot overwrite a pending separator-created footer', () => {
    assert.throws(
      () => tableFilter.filter('| 1 |\n| === |\nthead\n| 2 |', {}),
      /thead marker cannot replace an empty pending tfoot/i,
    );
  });

  test('an end-of-input footer boundary cannot remain pending', () => {
    assert.throws(
      () => tableFilter.filter('| 1 |\n| === |', {}),
      /pending tfoot has no rows/i,
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

// DECIDED ITEM: a live interpolation `#{...}` inside a VERBATIM attribute group
// (a tagged cell head, a caption/section/tr/separator attr group, or a filter
// attribute value) used to reach the renderer and crash with the raw, uncoded
// PUGNEUM:CALL_STACK_UNDERFLOW ("variable used outside mixin") pointing at
// synthetic generated source. The decision was to RAISE A CLEAN coded error
// (not neutralize). The filter must throw INTERPOLATION_IN_TABLE_HEAD up front.
describe('live #{ in a verbatim attribute group is a clean coded error', () => {
  // Assert the filter throws the coded error AND that it is NOT the old raw
  // CALL_STACK_UNDERFLOW crash.
  function assertCodedInterpolationError(input, attrs) {
    assert.throws(
      () => tableFilter.filter(input, attrs || {}),
      (err) => {
        assert.strictEqual(err.code, 'PUGNEUM:INTERPOLATION_IN_TABLE_HEAD');
        assert.notStrictEqual(err.code, 'PUGNEUM:CALL_STACK_UNDERFLOW');
        assert.match(err.message, /interpolation/i);
        return true;
      },
    );
  }

  test('cell head td(title="#{q}") throws the coded error, not a crash', () => {
    assertCodedInterpolationError('| --- |\n| td(title="#{q}") x |');
  });

  test('cell head th(data-a="#{p}") throws the coded error', () => {
    assertCodedInterpolationError('| th(data-a="#{p}") text |\n| --- |\n| x |');
  });

  test('a #{ in the middle of an attribute value is caught too', () => {
    assertCodedInterpolationError('| --- |\n| td(class="a#{n}b") x |');
  });

  test('caption(attrs) with #{ throws the coded error', () => {
    assertCodedInterpolationError(
      'caption(class="#{c}") Title\n| a |\n| --- |\n| b |',
    );
  });

  test('thead/tbody/tfoot marker attrs with #{ throw the coded error', () => {
    assertCodedInterpolationError('thead(class="#{c}")\n| a |\n| --- |\n| b |');
    assertCodedInterpolationError('| a |\n| --- |\ntbody(class="#{c}")\n| b |');
    assertCodedInterpolationError(
      '| a |\n| --- |\n| b |\ntfoot(class="#{c}")\n| c |',
    );
  });

  test('tr(attrs) prefix with #{ throws the coded error', () => {
    assertCodedInterpolationError('| a |\n| --- |\ntr(class="#{c}") | v |');
  });

  test('separator col attrs ---(class="#{c}")--- throw the coded error', () => {
    assertCodedInterpolationError('| a |\n| ---(class="#{c}")--- |\n| b |');
  });

  test('a filter attribute value with #{ throws the coded error', () => {
    // Reachable via programmatic filterOptions.
    assertCodedInterpolationError('| a |\n| --- |\n| b |', {title: '#{x}'});
  });

  // The fix must NOT break currently-working input: an author who escapes the
  // interpolation (`\#{`) keeps a literal `#{...}` in the output. Render through
  // the full pipeline to prove the escaped form survives and is not rejected.
  function renderTable(input, attrs) {
    var src = tableFilter.filter(input, attrs || {});
    var options = {filename: 'gen.pg', source: src};
    return render(parse(lex(src, options), options), options);
  }

  test('an ESCAPED \\#{ in a cell head still renders a literal #{', () => {
    var input = '| --- |\n| td(title="\\#{q}") x |';
    assert.doesNotThrow(() => tableFilter.filter(input, {}));
    assert.match(renderTable(input), /<td title="#\{q\}">x<\/td>/);
  });

  test('an ESCAPED \\#{ in a separator col attr still renders literally', () => {
    var input = '| a |\n| ---(class="\\#{c}")--- |\n| b |';
    assert.doesNotThrow(() => tableFilter.filter(input, {}));
    assert.match(renderTable(input), /<col class="#\{c\}">/);
  });

  test('a # not opening an interpolation (#tag) is fine in a head', () => {
    var input = '| --- |\n| td(data-x="#tag") v |';
    assert.doesNotThrow(() => tableFilter.filter(input, {}));
    assert.match(renderTable(input), /<td data-x="#tag">v<\/td>/);
  });

  test('a #{ in cell TEXT is still neutralized, not rejected (decision #4 intact)', () => {
    // The head is plain; the trailing #{ is TEXT, which is neutralized — it must
    // NOT trip the head-interpolation error.
    var input = '| --- |\n| td(class="k") cost #{usd} |';
    assert.doesNotThrow(() => tableFilter.filter(input, {}));
    assert.match(renderTable(input), /<td class="k">cost #\{usd\}<\/td>/);
  });
});

// The README documents "header cells in a thead get scope=col automatically".
// A bare cell got it, but an EXPLICIT th/th(...) head took the verbatim branch
// and silently lost scope — inconsistent within one thead and contradicting the
// package's own docs.
describe('explicit th cells in thead get scope="col"', () => {
  test('bare th and explicit th cells in thead are both scoped', () => {
    var input = '| th Name | Count |\n| --- | --- |\n| a | 1 |';
    var result = tableFilter.filter(input, {});
    // BOTH header cells carry scope="col" (the explicit `th Name` no longer
    // loses it). Two scope="col" tokens, both on th in the thead.
    var headLines = result
      .split('\n')
      .filter((l) => /^\s+th/.test(l) && /Name|Count/.test(l));
    assert.strictEqual(headLines.length, 2);
    headLines.forEach((l) => assert.match(l, /th\(scope="col"\)/));
    assert.doesNotThrow(() => roundTrip(input));
  });

  test('explicit th(attrs) head in thead merges scope without duplicating', () => {
    var input = '| th(class="k") Name |\n| --- |\n| a |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /th\(scope="col" class="k"\) Name/);
    // Exactly one scope on the header cell — no DUPLICATE_ATTRIBUTE on re-lex.
    var th = result.split('\n').find((l) => /th\(/.test(l));
    assert.strictEqual((th.match(/scope=/g) || []).length, 1);
    assert.doesNotThrow(() => roundTrip(input));
  });

  test('an author-set scope on a th head is preserved, not duplicated', () => {
    // th(scope="row") in a thead must keep the author's value and NOT get a
    // second scope (which would crash the re-lex with DUPLICATE_ATTRIBUTE).
    var input = '| th(scope="row") Name |\n| --- |\n| a |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /th\(scope="row"\) Name/);
    assert.doesNotMatch(result, /scope="col"/);
    assert.doesNotThrow(() => roundTrip(input));
  });

  test('a spaced scope assignment is detected and preserves its value', () => {
    var input = '| th(scope = "row") Name |\n| --- |\n| a |';
    var result = renderRoundTrip(input);
    var header = collectNodes(result.ast, 'Tag').find(
      (node) => node.name === 'th',
    );
    assert.match(result.src, /th\(scope = "row"\) Name/);
    assert.deepStrictEqual(
      header.attrs.map(({name, val}) => ({name, val})),
      [{name: 'scope', val: 'row'}],
    );
    assert.doesNotMatch(result.src, /scope="col"/);
  });

  test('a boolean scope is detected and not duplicated', () => {
    var input = '| th(scope) Name |\n| --- |\n| a |';
    var result = renderRoundTrip(input);
    var header = collectNodes(result.ast, 'Tag').find(
      (node) => node.name === 'th',
    );
    assert.match(result.src, /th\(scope\) Name/);
    assert.deepStrictEqual(
      header.attrs.map(({name, val}) => ({name, val})),
      [{name: 'scope', val: true}],
    );
  });

  test('scope-like text inside another value still gets scope="col"', () => {
    var input = '| th(title="mentions scope=x") Name |\n| --- |\n| a |';
    var result = renderRoundTrip(input);
    var header = collectNodes(result.ast, 'Tag').find(
      (node) => node.name === 'th',
    );
    assert.match(result.src, /th\(scope="col" title="mentions scope=x"\) Name/);
    assert.deepStrictEqual(
      header.attrs.map(({name, val}) => ({name, val})),
      [
        {name: 'scope', val: 'col'},
        {name: 'title', val: 'mentions scope=x'},
      ],
    );
  });

  test('data-scope is not mistaken for scope (scope="col" still added)', () => {
    var input = '| th(data-scope="x") Name |\n| --- |\n| a |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /th\(scope="col" data-scope="x"\) Name/);
    assert.doesNotThrow(() => roundTrip(input));
  });

  test('an explicit td head in thead is NOT given scope', () => {
    var input = '| td(class="k") Name |\n| --- |\n| a |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /td\(class="k"\) Name/);
    assert.doesNotMatch(result, /scope=/);
  });

  test('an explicit th head in tbody is NOT given scope', () => {
    var input = '| a |\n| --- |\n| th(class="k") row |';
    var result = tableFilter.filter(input, {});
    // The thead's bare `a` becomes th(scope="col"); the tbody th(class) must not.
    var tbodyTh = result.split('\n').find((l) => /th\(class="k"\)/.test(l));
    assert.ok(tbodyTh, 'expected the tbody th(class="k") line');
    assert.doesNotMatch(tbodyTh, /scope=/);
  });
});
