var path = require('path');
var assert = require('node:assert/strict');
var {describe, test} = require('node:test');
var extract = require('../lib/extract');
var {temporaryHtml} = require('./helpers');

var fixturesDir = path.join(__dirname, 'fixtures');

var HEAD =
  '<base href="https://x.com/"><title>T</title>' +
  '<meta name="description" content="d"><meta name="author" content="a">';

describe('index page extraction', () => {
  test('extracts feed metadata from index page', () => {
    var result = extract.indexPage(path.join(fixturesDir, 'index.html'));

    assert.strictEqual(result.url, 'https://example.com/');
    assert.strictEqual(result.title, 'Test Site');
    assert.strictEqual(result.description, 'A test site for feed generation');
    assert.strictEqual(result.author, 'Test Author');
    assert.strictEqual(result.language, 'en');
  });

  test('matches metadata names case-insensitively and keeps the first value', (t) => {
    var p = temporaryHtml(
      t,
      'pugneum-extract-',
      '<!DOCTYPE html><html><head><title>T</title>' +
        '<meta name="Description" content="first">' +
        '<meta name="DESCRIPTION" content="later">' +
        '<meta name="AUTHOR"><meta name="author" content="later">' +
        '</head><body></body></html>',
    );
    var result = extract.indexPage(p);
    assert.strictEqual(result.description, 'first');
    assert.strictEqual(result.author, null);
  });

  test('discovers articles sorted newest first', () => {
    var result = extract.indexPage(path.join(fixturesDir, 'index.html'));

    assert.strictEqual(result.entries.length, 2);
    assert.strictEqual(result.entries[0].href, 'articles/second.html');
    assert.strictEqual(result.entries[0].title, 'Second Article');
    assert.strictEqual(result.entries[0].published, '2026-04-01');
    assert.strictEqual(result.entries[1].href, 'articles/first.html');
    assert.strictEqual(result.entries[1].title, 'First Article');
    assert.strictEqual(result.entries[1].published, '2026-03-15');
  });

  test('sorts mixed publication representations by instant', (t) => {
    var p = temporaryHtml(
      t,
      'pugneum-extract-',
      '<!DOCTYPE html><html><head><title>T</title></head><body>' +
        '<a data-published-at="2026-01-01T00:30:00+01:00" href="older.html">Older</a>' +
        '<a data-published-at="2026-01-01T00:00:00Z" href="newer.html">Newer</a>' +
        '<a data-published-at="2025-12-31" href="oldest.html">Oldest</a>' +
        '</body></html>',
    );
    var result = extract.indexPage(p);
    assert.deepStrictEqual(
      result.entries.map((entry) => entry.href),
      ['newer.html', 'older.html', 'oldest.html'],
    );
    assert.strictEqual(
      result.entries[0].publishedEpoch,
      Date.parse('2026-01-01T00:00:00Z'),
    );
  });

  test('keeps equal instants and invalid values stable, with invalid last', (t) => {
    var p = temporaryHtml(
      t,
      'pugneum-extract-',
      '<!DOCTYPE html><html><head><title>T</title></head><body>' +
        '<a data-published-at="2026-01-01T00:00:00Z" href="tie-a.html">A</a>' +
        '<a data-published-at="aaa" href="invalid-a.html">Invalid A</a>' +
        '<a data-published-at="2025-12-31T19:00:00-05:00" href="tie-b.html">B</a>' +
        '<a data-published-at="zzz" href="invalid-b.html">Invalid B</a>' +
        '</body></html>',
    );
    var result = extract.indexPage(p);
    assert.deepStrictEqual(
      result.entries.map((entry) => entry.href),
      ['tie-a.html', 'tie-b.html', 'invalid-a.html', 'invalid-b.html'],
    );
    assert.strictEqual(
      result.entries[0].publishedEpoch,
      result.entries[1].publishedEpoch,
    );
    assert.strictEqual(result.entries[2].publishedEpoch, null);
    assert.strictEqual(result.entries[3].publishedEpoch, null);
  });

  test('ignores links without data-published-at', () => {
    var result = extract.indexPage(path.join(fixturesDir, 'index.html'));

    var hrefs = result.entries.map((e) => e.href);
    assert.ok(!hrefs.includes('/'));
    assert.ok(!hrefs.includes('/about'));
  });

  test('entry without data-published-at attribute is excluded', (t) => {
    var p = temporaryHtml(
      t,
      'pugneum-extract-',
      '<!DOCTYPE html><html><head>' +
        HEAD +
        '</head><body><li><a href="article.html">No date</a></li>' +
        '</body></html>',
    );

    assert.strictEqual(extract.indexPage(p).entries.length, 0);
  });

  test('entries are sorted by normalized publication instant descending', (t) => {
    var p = temporaryHtml(
      t,
      'pugneum-extract-',
      '<!DOCTYPE html><html><head>' +
        HEAD +
        '</head><body>' +
        '<li data-published-at="2026-01-01"><a href="earlier.html">Earlier</a></li>' +
        '<li data-published-at="2026-06-15"><a href="later.html">Later</a></li>' +
        '</body></html>',
    );
    var result = extract.indexPage(p);

    assert.deepStrictEqual(
      result.entries.map((entry) => entry.href),
      ['later.html', 'earlier.html'],
    );
  });

  test('empty data-published-at attribute excludes the entry', (t) => {
    var p = temporaryHtml(
      t,
      'pugneum-extract-',
      '<!DOCTYPE html><html><head>' +
        HEAD +
        '</head><body>' +
        '<li data-published-at=""><a href="undated.html">Undated</a></li>' +
        '<li data-published-at="2026-01-02"><a href="dated.html">Dated</a></li>' +
        '</body></html>',
    );
    var result = extract.indexPage(p);

    assert.strictEqual(result.entries.length, 1);
    assert.strictEqual(result.entries[0].href, 'dated.html');
  });

  test('anchor without href is excluded from entries', (t) => {
    var p = temporaryHtml(
      t,
      'pugneum-extract-',
      '<!DOCTYPE html><html><head>' +
        HEAD +
        '</head><body>' +
        '<li data-published-at="2026-01-01"><a>No href anchor</a></li>' +
        '<li data-published-at="2026-01-02"><a href="valid.html">Valid</a></li>' +
        '</body></html>',
    );
    var result = extract.indexPage(p);

    assert.strictEqual(result.entries.length, 1);
    assert.strictEqual(result.entries[0].href, 'valid.html');
  });

  test('a nested matched element is skipped as a descendant', (t) => {
    // The outer article carries data-published-at and so does a nested <time>;
    // only the top-level article must become an entry. Exercises the
    // ancestor-Set dedup that replaced the O(N^2) pairwise filter.
    var p = temporaryHtml(
      t,
      'pugneum-extract-',
      '<!DOCTYPE html><html><head>' +
        HEAD +
        '</head><body>' +
        '<article data-published-at="2026-01-02">' +
        '<a href="outer.html">Outer</a>' +
        '<time data-published-at="2026-01-01"><a href="inner.html">Inner</a></time>' +
        '</article>' +
        '</body></html>',
    );
    var result = extract.indexPage(p);
    assert.strictEqual(result.entries.length, 1);
    assert.strictEqual(result.entries[0].href, 'outer.html');
  });

  test('a leading anchor without href does not drop the entry', (t) => {
    var p = temporaryHtml(
      t,
      'pugneum-extract-',
      '<!DOCTYPE html><html><head>' +
        HEAD +
        '</head><body>' +
        '<li data-published-at="2026-01-01">' +
        '<a name="top"></a><a href="real.html">Real Title</a>' +
        '</li>' +
        '</body></html>',
    );
    var result = extract.indexPage(p);
    assert.strictEqual(result.entries.length, 1);
    assert.strictEqual(result.entries[0].href, 'real.html');
    assert.strictEqual(result.entries[0].title, 'Real Title');
  });
});

describe('article page enrichment', () => {
  test('extracts full metadata from article page', () => {
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

  test('extracts mixed-case article metadata names', (t) => {
    var p = temporaryHtml(
      t,
      'pugneum-extract-',
      '<!DOCTYPE html><html><head><title>T</title>' +
        '<meta name="Description" content="Summary">' +
        '<meta name="AUTHOR" content="Author">' +
        '<meta name="KeyWords" content="one, two">' +
        '</head><body><article>Content</article></body></html>',
    );
    var result = extract.articlePage(p, 'article');
    assert.strictEqual(result.description, 'Summary');
    assert.strictEqual(result.author, 'Author');
    assert.deepStrictEqual(result.keywords, ['one', 'two']);
  });

  test('handles missing optional metadata', () => {
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

  test('a valid tag name with no matching element produces empty content', () => {
    var result = extract.articlePage(
      path.join(fixturesDir, 'articles', 'second.html'),
      'aside',
    );

    assert.strictEqual(result.content, '');
  });

  test('uses the first article base href for extracted content URLs', (t) => {
    var p = temporaryHtml(
      t,
      'pugneum-extract-',
      '<!DOCTYPE html><html><head><title>B</title>' +
        '<base target="_blank"><base href="../assets/"></head><body>' +
        '<article><img src="hero.png"><a href="#local">local</a></article>' +
        '</body></html>',
    );
    var result = extract.articlePage(
      p,
      'article',
      undefined,
      'https://example.com/blog/articles/post.html',
    );
    assert.strictEqual(
      result.content,
      '<img src="https://example.com/blog/assets/hero.png"><a href="#local">local</a>',
    );
  });

  test('falls back to the article URL when its base href is invalid', (t) => {
    var p = temporaryHtml(
      t,
      'pugneum-extract-',
      '<!DOCTYPE html><html><head><title>B</title>' +
        '<base href="http://["></head><body>' +
        '<article><a href="next.html">next</a></article></body></html>',
    );
    var result = extract.articlePage(
      p,
      'article',
      undefined,
      'https://example.com/blog/articles/post.html',
    );
    assert.strictEqual(
      result.content,
      '<a href="https://example.com/blog/articles/next.html">next</a>',
    );
  });

  test('keywords drops empty segments from a sloppy comma list', (t) => {
    var p = temporaryHtml(
      t,
      'pugneum-extract-',
      '<!DOCTYPE html><html><head><title>K</title>' +
        '<meta name="keywords" content="a, ,b,,c"></head>' +
        '<body><article>x</article></body></html>',
    );
    var result = extract.articlePage(p, 'article');
    assert.deepStrictEqual(result.keywords, ['a', 'b', 'c']);
  });
});
