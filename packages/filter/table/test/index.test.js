'use strict';

var assert = require('node:assert/strict');
var {test, describe} = require('node:test');

var tableFilter = require('../');

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
        '  thead\n    tr\n      th Name\n      th Count\n' +
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
    assert.match(result, /th Name/);
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
    assert.match(result, /th a/);
    assert.match(result, /tbody\n/);
    assert.match(result, /td b/);
    assert.match(result, /tfoot\n/);
    assert.match(result, /td c/);
  });
});

describe('edge cases', () => {
  test('empty cells', () => {
    var input = '| a |  | c |\n| --- | --- | --- |\n|  | b |  |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /th a\n/);
    assert.match(result, /th\n/);
    assert.match(result, /td\n/);
    assert.match(result, /td b\n/);
  });

  test('single column table', () => {
    var input = '| Name |\n| --- |\n| Alice |';
    var result = tableFilter.filter(input, {});
    assert.match(result, /th Name/);
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
    assert.match(result, /th a/);
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

  test('section marker after untagged rows uses tbody, not thead', () => {
    var input = '| a |\ntbody\n| b |';
    var result = tableFilter.filter(input, {});
    assert.doesNotMatch(result, /thead/);
    assert.match(result, /td a/);
    assert.match(result, /td b/);
  });
});
