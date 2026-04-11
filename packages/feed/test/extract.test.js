var path = require('path');
var assert = require('node:assert/strict');
var {describe, test} = require('node:test');
var extract = require('../lib/extract');

var fixturesDir = path.join(__dirname, 'fixtures');

describe('index page extraction', () => {
  test('extracts feed metadata from index page', (t) => {
    var result = extract.indexPage(
      path.join(fixturesDir, 'index.html'),
    );

    assert.strictEqual(result.url, 'https://example.com/');
    assert.strictEqual(result.title, 'Test Site');
    assert.strictEqual(result.description, 'A test site for feed generation');
    assert.strictEqual(result.author, 'Test Author');
    assert.strictEqual(result.language, 'en');
  });

  test('discovers articles sorted newest first', (t) => {
    var result = extract.indexPage(
      path.join(fixturesDir, 'index.html'),
    );

    assert.strictEqual(result.entries.length, 2);
    assert.strictEqual(result.entries[0].href, 'articles/second.html');
    assert.strictEqual(result.entries[0].title, 'Second Article');
    assert.strictEqual(result.entries[0].published, '2026-04-01');
    assert.strictEqual(result.entries[1].href, 'articles/first.html');
    assert.strictEqual(result.entries[1].title, 'First Article');
    assert.strictEqual(result.entries[1].published, '2026-03-15');
  });

  test('ignores links without data-published-at', (t) => {
    var result = extract.indexPage(
      path.join(fixturesDir, 'index.html'),
    );

    var hrefs = result.entries.map((e) => e.href);
    assert.ok(!hrefs.includes('/'));
    assert.ok(!hrefs.includes('/about'));
  });
});
