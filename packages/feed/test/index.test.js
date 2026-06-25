var path = require('path');
var fs = require('fs');
var os = require('os');
var crypto = require('crypto');
var assert = require('node:assert/strict');
var {describe, test} = require('node:test');
var generateFeeds = require('../');
var extract = require('../lib/extract');

var fixturesDir = path.join(__dirname, 'fixtures');
var outputDir = path.join(__dirname, 'output');

describe('extract.indexPage robustness', () => {
  function writeTemp(content) {
    var p = path.join(
      os.tmpdir(),
      'pugneum-extract-test-' + crypto.randomUUID() + '.html',
    );
    fs.writeFileSync(p, content);
    return p;
  }

  test('entry without data-published-at attribute is excluded', () => {
    var p = writeTemp(
      '<!DOCTYPE html><html><head><base href="https://x.com/"><title>T</title>' +
        '<meta name="description" content="d"><meta name="author" content="a"></head><body>' +
        '<li><a href="article.html">No date</a></li>' +
        '</body></html>',
    );
    try {
      var result = extract.indexPage(p);
      // The element has no data-published-at so extractEntries won't find it
      // (the guard requires data-published-at to be present for the element to be found at all)
      assert.strictEqual(result.entries.length, 0);
    } finally {
      fs.unlinkSync(p);
    }
  });

  test('entries are sorted in descending date order', () => {
    // Also exercises the sort guard: (b.published || '').localeCompare(a.published || '')
    var p = writeTemp(
      '<!DOCTYPE html><html><head><base href="https://x.com/"><title>T</title>' +
        '<meta name="description" content="d"><meta name="author" content="a"></head><body>' +
        '<li data-published-at="2026-01-01"><a href="earlier.html">Earlier</a></li>' +
        '<li data-published-at="2026-06-15"><a href="later.html">Later</a></li>' +
        '</body></html>',
    );
    try {
      var result = extract.indexPage(p);
      assert.strictEqual(result.entries.length, 2);
      // Later date sorts first (descending)
      assert.strictEqual(result.entries[0].href, 'later.html');
      assert.strictEqual(result.entries[1].href, 'earlier.html');
    } finally {
      fs.unlinkSync(p);
    }
  });

  test('empty data-published-at attribute excludes the entry', () => {
    // An empty date is treated the same as an absent one: a dated feed should
    // not carry an undated entry. This pins that intentional behavior.
    var p = writeTemp(
      '<!DOCTYPE html><html><head><base href="https://x.com/"><title>T</title>' +
        '<meta name="description" content="d"><meta name="author" content="a"></head><body>' +
        '<li data-published-at=""><a href="undated.html">Undated</a></li>' +
        '<li data-published-at="2026-01-02"><a href="dated.html">Dated</a></li>' +
        '</body></html>',
    );
    try {
      var result = extract.indexPage(p);
      assert.strictEqual(result.entries.length, 1);
      assert.strictEqual(result.entries[0].href, 'dated.html');
    } finally {
      fs.unlinkSync(p);
    }
  });

  test('anchor without href is excluded from entries', () => {
    var p = writeTemp(
      '<!DOCTYPE html><html><head><base href="https://x.com/"><title>T</title>' +
        '<meta name="description" content="d"><meta name="author" content="a"></head><body>' +
        '<li data-published-at="2026-01-01"><a>No href anchor</a></li>' +
        '<li data-published-at="2026-01-02"><a href="valid.html">Valid</a></li>' +
        '</body></html>',
    );
    try {
      var result = extract.indexPage(p);
      // The no-href anchor must be excluded; only the valid entry is present
      assert.strictEqual(result.entries.length, 1);
      assert.strictEqual(result.entries[0].href, 'valid.html');
    } finally {
      fs.unlinkSync(p);
    }
  });
});

describe('resolveRelativeUrls', () => {
  var resolveRelativeUrls = generateFeeds.resolveRelativeUrls;

  test('/path is resolved to absolute URL', () => {
    var html = '<a href="/articles/post.html">link</a>';
    var result = resolveRelativeUrls(html, 'https://example.com/');
    assert.strictEqual(
      result,
      '<a href="https://example.com/articles/post.html">link</a>',
    );
  });

  test('protocol-relative //cdn.example.com is unchanged', () => {
    var html = '<a href="//cdn.example.com/file.js">link</a>';
    var result = resolveRelativeUrls(html, 'https://example.com/');
    assert.strictEqual(result, '<a href="//cdn.example.com/file.js">link</a>');
  });

  test('absolute https://other.com is unchanged', () => {
    var html = '<a href="https://other.com/page">link</a>';
    var result = resolveRelativeUrls(html, 'https://example.com/');
    assert.strictEqual(result, '<a href="https://other.com/page">link</a>');
  });

  test('base URL with $ is not corrupted', () => {
    var html = '<a href="/path">link</a>';
    var result = resolveRelativeUrls(html, 'https://ca$h.example.com/');
    assert.strictEqual(
      result,
      '<a href="https://ca$h.example.com/path">link</a>',
    );
  });

  test('img src is resolved', () => {
    var html = '<img src="/images/photo.jpg">';
    var result = resolveRelativeUrls(html, 'https://example.com/');
    assert.strictEqual(
      result,
      '<img src="https://example.com/images/photo.jpg">',
    );
  });

  test('data-href is not rewritten and the real href still is', () => {
    // Regex over serialized HTML matched any attribute ending in href/src and
    // preferred the rightmost one, corrupting data-* and leaving the real link
    // relative. The DOM rewrite keys on the exact attribute name.
    var html = '<a href="/real" data-href="/widget">x</a>';
    var result = resolveRelativeUrls(html, 'https://example.com/');
    assert.strictEqual(
      result,
      '<a href="https://example.com/real" data-href="/widget">x</a>',
    );
  });

  test('lone data-src attribute is left untouched', () => {
    var html = '<img data-src="/lazy.jpg">';
    var result = resolveRelativeUrls(html, 'https://example.com/');
    assert.strictEqual(result, '<img data-src="/lazy.jpg">');
  });

  test('single-quoted attribute is resolved', () => {
    var html = "<a href='/sq.html'>x</a>";
    var result = resolveRelativeUrls(html, 'https://example.com/');
    assert.strictEqual(result, '<a href="https://example.com/sq.html">x</a>');
  });

  test('href is resolved even when an earlier attribute value contains >', () => {
    // The old regex stopped at the first '>' in an attribute value and never
    // reached href; the DOM rewrite is immune. (A bare '>' is valid in an
    // attribute value, so the serializer leaves it literal.)
    var html = '<a title="a > b" href="/x.html">z</a>';
    var result = resolveRelativeUrls(html, 'https://example.com/');
    assert.strictEqual(
      result,
      '<a title="a > b" href="https://example.com/x.html">z</a>',
    );
  });

  test('srcset relative URLs are resolved, descriptors preserved', () => {
    var html = '<img srcset="/a.jpg 1x, /b.jpg 2x" src="/a.jpg">';
    var result = resolveRelativeUrls(html, 'https://example.com/');
    assert.strictEqual(
      result,
      '<img srcset="https://example.com/a.jpg 1x, https://example.com/b.jpg 2x" src="https://example.com/a.jpg">',
    );
  });

  test('source srcset relative URL is resolved', () => {
    var html = '<source srcset="/img.jpg">';
    var result = resolveRelativeUrls(html, 'https://example.com/');
    assert.strictEqual(result, '<source srcset="https://example.com/img.jpg">');
  });

  test('video poster and src are resolved', () => {
    var html = '<video poster="/p.png" src="/v.mp4"></video>';
    var result = resolveRelativeUrls(html, 'https://example.com/');
    assert.strictEqual(
      result,
      '<video poster="https://example.com/p.png" src="https://example.com/v.mp4"></video>',
    );
  });

  test('XML-significant characters stay escaped in surrounding markup', () => {
    var html = '<p>a &amp; b &lt; c</p><a href="/z">t</a>';
    var result = resolveRelativeUrls(html, 'https://example.com/');
    assert.strictEqual(
      result,
      '<p>a &amp; b &lt; c</p><a href="https://example.com/z">t</a>',
    );
  });
});

describe('end-to-end feed generation', () => {
  test('generates atom.xml and rss.xml from fixtures', (t) => {
    fs.mkdirSync(outputDir, {recursive: true});

    generateFeeds({
      outputDirectory: fixturesDir,
      feeds: {enabled: true},
      writeDirectory: outputDir,
    });

    var atom = fs.readFileSync(path.join(outputDir, 'atom.xml'), 'utf8');
    var rss = fs.readFileSync(path.join(outputDir, 'rss.xml'), 'utf8');

    t.assert.snapshot(atom);
    t.assert.snapshot(rss);

    fs.rmSync(outputDir, {recursive: true});
  });
});

describe('config overrides', () => {
  test('json config overrides html-extracted values', (t) => {
    fs.mkdirSync(outputDir, {recursive: true});

    generateFeeds({
      outputDirectory: fixturesDir,
      feeds: {
        enabled: true,
        url: 'https://override.com/',
        title: 'Override Title',
        author: 'Override Author',
        description: 'Override Description',
      },
      writeDirectory: outputDir,
    });

    var atom = fs.readFileSync(path.join(outputDir, 'atom.xml'), 'utf8');
    assert.match(atom, /https:\/\/override\.com\//);
    assert.ok(atom.includes('Override Title'));
    assert.ok(atom.includes('Override Author'));
    assert.ok(atom.includes('Override Description'));

    fs.rmSync(outputDir, {recursive: true});
  });
});

describe('end-to-end URL resolution', () => {
  test('root-relative URLs in article content are absolutized in the feed', () => {
    var dir = path.join(__dirname, 'fixtures-urls');
    fs.mkdirSync(path.join(dir, 'articles'), {recursive: true});
    fs.writeFileSync(
      path.join(dir, 'index.html'),
      '<!DOCTYPE html><html lang="en"><head>' +
        '<base href="https://example.com/">' +
        '<title>Site</title>' +
        '<meta name="description" content="d">' +
        '<meta name="author" content="A">' +
        '</head><body>' +
        '<li data-published-at="2026-01-01"><a href="articles/post.html">Post</a></li>' +
        '</body></html>',
    );
    fs.writeFileSync(
      path.join(dir, 'articles', 'post.html'),
      '<!DOCTYPE html><html><head><title>Post</title>' +
        '<meta name="description" content="s"></head><body><article>' +
        '<a href="/other.html">link</a>' +
        '<img src="/img.png" srcset="/a.png 1x, /b.png 2x">' +
        '<a data-href="/keep">keep</a>' +
        '</article></body></html>',
    );

    try {
      generateFeeds({
        outputDirectory: dir,
        feeds: {enabled: true},
        writeDirectory: dir,
      });
      var atom = fs.readFileSync(path.join(dir, 'atom.xml'), 'utf8');
      // Root-relative href/src/srcset are absolutized...
      assert.ok(atom.includes('https://example.com/other.html'));
      assert.ok(atom.includes('https://example.com/img.png'));
      assert.ok(atom.includes('https://example.com/a.png 1x'));
      assert.ok(atom.includes('https://example.com/b.png 2x'));
      // ...but data-href is left exactly as authored.
      assert.ok(atom.includes('data-href=&quot;/keep&quot;'));
    } finally {
      fs.rmSync(dir, {recursive: true});
    }
  });
});

describe('error handling', () => {
  test('throws FEED_INVALID_URL for a path-only base href', () => {
    var dir = path.join(__dirname, 'fixtures-relbase');
    fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(
      path.join(dir, 'index.html'),
      '<!DOCTYPE html><html><head>' +
        '<base href="/blog/">' +
        '<title>T</title>' +
        '<meta name="description" content="d"></head><body></body></html>',
    );

    assert.throws(
      () =>
        generateFeeds({
          outputDirectory: dir,
          feeds: {enabled: true},
          writeDirectory: dir,
        }),
      (err) => err.code === 'PUGNEUM:FEED_INVALID_URL',
    );

    fs.rmSync(dir, {recursive: true});
  });

  test('throws FEED_INVALID_URL for a protocol-relative feeds.url', () => {
    assert.throws(
      () =>
        generateFeeds({
          outputDirectory: fixturesDir,
          feeds: {enabled: true, url: '//cdn.example.com/'},
          writeDirectory: outputDir,
        }),
      (err) => err.code === 'PUGNEUM:FEED_INVALID_URL',
    );
  });

  test('throws when base URL is unresolvable', () => {
    var noBaseDir = path.join(__dirname, 'fixtures-no-base');
    fs.mkdirSync(noBaseDir, {recursive: true});
    fs.writeFileSync(
      path.join(noBaseDir, 'index.html'),
      '<!DOCTYPE html><html><head><title>No Base</title><meta name="description" content="test"></head><body></body></html>',
    );

    assert.throws(
      () =>
        generateFeeds({
          outputDirectory: noBaseDir,
          feeds: {enabled: true},
          writeDirectory: noBaseDir,
        }),
      (err) => err.code === 'PUGNEUM:FEED_MISSING_URL',
    );

    fs.rmSync(noBaseDir, {recursive: true});
  });

  test('throws FEED_ARTICLE_NOT_FOUND for missing article', () => {
    var missingDir = path.join(__dirname, 'fixtures-missing-article');
    fs.mkdirSync(missingDir, {recursive: true});
    fs.writeFileSync(
      path.join(missingDir, 'index.html'),
      '<!DOCTYPE html><html lang="en"><head>' +
        '<base href="https://example.com/">' +
        '<title>Test</title>' +
        '<meta name="description" content="test">' +
        '<meta name="author" content="Author">' +
        '</head><body>' +
        '<div data-published-at="2026-01-01"><a href="nonexistent.html">Missing</a></div>' +
        '</body></html>',
    );

    assert.throws(
      () =>
        generateFeeds({
          outputDirectory: missingDir,
          feeds: {enabled: true},
          writeDirectory: missingDir,
        }),
      (err) => err.code === 'PUGNEUM:FEED_ARTICLE_NOT_FOUND',
    );

    fs.rmSync(missingDir, {recursive: true});
  });

  test('throws FEED_PATH_TRAVERSAL for article href escaping output directory', () => {
    var traversalDir = path.join(__dirname, 'fixtures-traversal');
    fs.mkdirSync(traversalDir, {recursive: true});
    fs.writeFileSync(
      path.join(traversalDir, 'index.html'),
      '<!DOCTYPE html><html lang="en"><head>' +
        '<base href="https://example.com/">' +
        '<title>Test</title>' +
        '<meta name="description" content="test">' +
        '<meta name="author" content="Author">' +
        '</head><body>' +
        '<div data-published-at="2026-01-01"><a href="../../etc/passwd">Malicious</a></div>' +
        '</body></html>',
    );

    assert.throws(
      () =>
        generateFeeds({
          outputDirectory: traversalDir,
          feeds: {enabled: true},
          writeDirectory: traversalDir,
        }),
      (err) => err.code === 'PUGNEUM:FEED_PATH_TRAVERSAL',
    );

    fs.rmSync(traversalDir, {recursive: true});
  });

  test('throws FEED_PATH_TRAVERSAL for feed write path escaping write directory', () => {
    fs.mkdirSync(outputDir, {recursive: true});

    assert.throws(
      () =>
        generateFeeds({
          outputDirectory: fixturesDir,
          feeds: {enabled: true, atom: '../../malicious.xml'},
          writeDirectory: outputDir,
        }),
      (err) => err.code === 'PUGNEUM:FEED_PATH_TRAVERSAL',
    );

    fs.rmSync(outputDir, {recursive: true});
  });

  test('skips when feeds.enabled is false', () => {
    fs.mkdirSync(outputDir, {recursive: true});

    generateFeeds({
      outputDirectory: fixturesDir,
      feeds: {enabled: false},
      writeDirectory: outputDir,
    });

    assert.ok(!fs.existsSync(path.join(outputDir, 'atom.xml')));
    assert.ok(!fs.existsSync(path.join(outputDir, 'rss.xml')));

    fs.rmSync(outputDir, {recursive: true});
  });
});
