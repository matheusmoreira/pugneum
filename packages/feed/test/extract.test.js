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

describe('article page enrichment', () => {
  test('extracts full metadata from article page', (t) => {
    var result = extract.articlePage(
      path.join(fixturesDir, 'articles', 'first.html'),
      'article',
    );

    assert.strictEqual(result.title, 'First Article - Test Site');
    assert.strictEqual(result.description, 'Summary of the first article');
    assert.strictEqual(result.author, 'First Author');
    assert.deepStrictEqual(result.keywords, ['test', 'first', 'article']);
    assert.ok(result.content.includes('<h1>First Article</h1>'));
    assert.ok(result.content.includes('<p>This is the full content'));
    assert.ok(!result.content.includes('<nav>'));
  });

  test('handles missing optional metadata', (t) => {
    var result = extract.articlePage(
      path.join(fixturesDir, 'articles', 'second.html'),
      'article',
    );

    assert.strictEqual(result.title, 'Second Article - Test Site');
    assert.strictEqual(result.description, 'Summary of the second article');
    assert.strictEqual(result.author, 'Test Author');
    assert.deepStrictEqual(result.keywords, []);
    assert.ok(result.content.includes('<h1>Second Article</h1>'));
  });
});
