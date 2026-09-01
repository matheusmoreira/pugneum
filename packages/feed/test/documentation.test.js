'use strict';

var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var {describe, test} = require('node:test');

var generateFeeds = require('../');
var readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');

describe('feed documentation contract', () => {
  test('publishes the date grammar, ordering, and fallback policy', () => {
    assert.match(readme, /Date-only values mean midnight UTC/);
    assert.match(readme, /Datetimes with no zone also mean UTC/);
    assert.match(readme, /Invalid or overflowing values/);
    assert.match(readme, /ordered by their UTC instant/);
    assert.match(readme, /Atom `updated`\nand RSS `lastBuildDate`/);
  });

  test('publishes language mapping and the package-root export boundary', () => {
    assert.match(readme, /copied to `xml:lang` on the Atom `<feed>` root/);
    assert.match(readme, /RSS `<channel><language>`/);
    assert.match(readme, /exports this one generation function/);
    assert.deepStrictEqual(Object.keys(generateFeeds), []);
  });

  test('publishes the shared bounded and transactional generation contract', () => {
    assert.match(readme, /`compilationLimits`/);
    assert.match(readme, /`compilationContext`/);
    assert.match(readme, /`PUGNEUM:COMPILATION_LIMIT_EXCEEDED`/);
    assert.match(readme, /transaction/);
  });
});
