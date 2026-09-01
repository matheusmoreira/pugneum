'use strict';

var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var {describe, test} = require('node:test');

var generateFeeds = require('../');
var readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');

describe('feed documentation contract', () => {
  test('publishes the date grammar, ordering, and fallback policy', () => {
    assert.match(readme, /Date-only\s+values mean midnight UTC/);
    assert.match(readme, /Datetimes with no zone also mean UTC/);
    assert.match(readme, /Invalid or overflowing values/);
    assert.match(readme, /ordered by their UTC instant/);
    assert.match(readme, /captures one\nbuild instant/);
    assert.match(readme, /RSS\n`lastBuildDate` is always the build instant/);
    assert.match(readme, /`PUGNEUM:FEED_INVALID_BUILD_DATE`/);
  });

  test('publishes metadata and configured destination rules', () => {
    assert.match(readme, /feed title and every resolved entry title/);
    assert.match(readme, /Atom entry authors resolve/);
    assert.match(readme, /RSS creators are optional/);
    assert.match(
      readme,
      /filesystem destination\nand advertised Atom\/RSS self URL/,
    );
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
