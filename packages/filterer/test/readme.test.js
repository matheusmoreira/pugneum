'use strict';

var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');
var {test} = require('node:test');

var applyFilters = require('../');
var readmePath = path.resolve(__dirname, '../README.md');

test('README quick start executes against the public export', () => {
  var readme = fs.readFileSync(readmePath, 'utf8');
  var match = /<!-- executable-quick-start -->\s*```js\n([\s\S]*?)\n```/.exec(
    readme,
  );
  assert.ok(match, 'README executable quick-start fence');

  var logged = [];
  var context = {
    Buffer,
    console: {log: (value) => logged.push(value)},
    require(specifier) {
      assert.strictEqual(specifier, 'pugneum-filterer');
      return applyFilters;
    },
  };
  vm.runInNewContext(match[1], context, {filename: readmePath});

  assert.deepStrictEqual(logged, ['<strong>hello</strong>']);
});

test('README publishes typed filter edges and cumulative limits', () => {
  var readme = fs.readFileSync(readmePath, 'utf8');

  assert.match(readme, /`options\.compilationLimits`/);
  assert.match(readme, /`options\.compilationContext`/);
  assert.match(readme, /generated-filter cycle/);
  assert.match(readme, /`text` result[\s\S]*escaped\s+exactly once/);
  assert.match(readme, /`html` result stays raw/);
});
