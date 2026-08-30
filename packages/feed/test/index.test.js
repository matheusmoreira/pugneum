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

function makeSymlinkOrSkip(t, target, link, type) {
  try {
    var platformType =
      process.platform === 'win32' && type === 'dir' ? 'junction' : type;
    fs.symlinkSync(target, link, platformType);
    return true;
  } catch (error) {
    if (['EACCES', 'ENOTSUP', 'EPERM'].includes(error.code)) {
      t.skip('symlinks are unavailable on this runner (' + error.code + ')');
      return false;
    }
    throw error;
  }
}

function feedIndex(articleHref) {
  return (
    '<!DOCTYPE html><html lang="en"><head>' +
    '<base href="https://example.com/"><title>Site</title>' +
    '<meta name="description" content="description">' +
    '<meta name="author" content="Author"></head><body>' +
    '<div data-published-at="2026-01-01"><a href="' +
    articleHref +
    '">Post</a></div></body></html>'
  );
}

function feedArticle(content) {
  return (
    '<!DOCTYPE html><html><head><title>Post</title>' +
    '<meta name="description" content="summary">' +
    '<meta name="author" content="Author"></head><body>' +
    '<article><p>' +
    content +
    '</p></article></body></html>'
  );
}

function boundaryFixture(t) {
  var sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pugneum-feed-boundary-'),
  );
  var input = path.join(sandbox, 'input');
  var output = path.join(sandbox, 'output');
  var outside = path.join(sandbox, 'outside');
  fs.mkdirSync(path.join(input, 'articles'), {recursive: true});
  fs.mkdirSync(output);
  fs.mkdirSync(outside);
  fs.writeFileSync(
    path.join(input, 'index.html'),
    feedIndex('articles/post.html'),
  );
  fs.writeFileSync(
    path.join(input, 'articles', 'post.html'),
    feedArticle('inside content'),
  );
  t.after(() => fs.rmSync(sandbox, {recursive: true}));

  return {
    input,
    output,
    outside,
    generate(feeds) {
      return generateFeeds({
        outputDirectory: input,
        writeDirectory: output,
        feeds: Object.assign({enabled: true}, feeds),
      });
    },
  };
}

function assertFeedTraversal(fn) {
  assert.throws(fn, (error) => {
    assert.strictEqual(error.code, 'PUGNEUM:FEED_PATH_TRAVERSAL');
    return true;
  });
}

function assertNoGeneratedFeeds(fixture) {
  assert.ok(!fs.existsSync(path.join(fixture.output, 'atom.xml')));
  assert.ok(!fs.existsSync(path.join(fixture.output, 'rss.xml')));
}

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

  test('error messages do not carry a stray leading "0"', () => {
    // Feed errors have no source-template location. pugneum-error builds its
    // header from present parts, so passing line:0 (finite but not a real line)
    // used to push a literal "0", rendering every message as "0\n\n<message>".
    // The message must equal the raw message text with no header prefix.
    var noBaseDir = path.join(__dirname, 'fixtures-no-base-msg');
    fs.mkdirSync(noBaseDir, {recursive: true});
    fs.writeFileSync(
      path.join(noBaseDir, 'index.html'),
      '<!DOCTYPE html><html><head><title>No Base</title>' +
        '<meta name="description" content="test"></head><body></body></html>',
    );

    try {
      assert.throws(
        () =>
          generateFeeds({
            outputDirectory: noBaseDir,
            feeds: {enabled: true},
            writeDirectory: noBaseDir,
          }),
        (err) => {
          assert.strictEqual(err.code, 'PUGNEUM:FEED_MISSING_URL');
          // No "0\n\n" (or any) header in front of the message.
          assert.strictEqual(err.message, err.msg);
          assert.doesNotMatch(err.message, /^0\n/);
          return true;
        },
      );
    } finally {
      fs.rmSync(noBaseDir, {recursive: true});
    }
  });

  test('extensionless article href resolves via the .html fallback', () => {
    // A common SSG pattern: index links to "articles/post" (no extension) and the
    // file on disk is "articles/post.html". index.js appends ".html" when the bare
    // path is absent. Exercises that previously-untested fallback end-to-end.
    var dir = path.join(__dirname, 'fixtures-html-fallback');
    fs.mkdirSync(path.join(dir, 'articles'), {recursive: true});
    fs.writeFileSync(
      path.join(dir, 'index.html'),
      '<!DOCTYPE html><html lang="en"><head>' +
        '<base href="https://example.com/"><title>T</title>' +
        '<meta name="description" content="d">' +
        '<meta name="author" content="A"></head><body>' +
        '<li data-published-at="2026-01-01"><a href="articles/post">No ext</a></li>' +
        '</body></html>',
    );
    fs.writeFileSync(
      path.join(dir, 'articles', 'post.html'),
      '<!DOCTYPE html><html><head><title>Post</title>' +
        '<meta name="description" content="s"></head><body>' +
        '<article><p>hi</p></article></body></html>',
    );

    try {
      generateFeeds({
        outputDirectory: dir,
        feeds: {enabled: true},
        writeDirectory: dir,
      });
      var atom = fs.readFileSync(path.join(dir, 'atom.xml'), 'utf8');
      // The entry was built from the .html file: its link is the (extensionless)
      // href resolved against the base, and title/content came from the article
      // page (the article body content is XML-escaped inside <content>).
      assert.ok(atom.includes('https://example.com/articles/post'));
      assert.ok(atom.includes('<title>Post</title>'));
      assert.ok(
        atom.includes('<content type="html">&lt;p&gt;hi&lt;/p&gt;</content>'),
      );
    } finally {
      fs.rmSync(dir, {recursive: true});
    }
  });

  test('throws FEED_ARTICLE_NOT_FOUND when an article href is a directory', () => {
    // The href resolves to an existing path, but it is a directory, not a file.
    // index.js guards this with statSync(...).isFile().
    var dir = path.join(__dirname, 'fixtures-article-dir');
    fs.mkdirSync(path.join(dir, 'articles', 'post.html'), {recursive: true});
    fs.writeFileSync(
      path.join(dir, 'index.html'),
      '<!DOCTYPE html><html lang="en"><head>' +
        '<base href="https://example.com/"><title>T</title>' +
        '<meta name="description" content="d">' +
        '<meta name="author" content="A"></head><body>' +
        '<li data-published-at="2026-01-01"><a href="articles/post.html">Dir</a></li>' +
        '</body></html>',
    );

    try {
      assert.throws(
        () =>
          generateFeeds({
            outputDirectory: dir,
            feeds: {enabled: true},
            writeDirectory: dir,
          }),
        (err) => err.code === 'PUGNEUM:FEED_ARTICLE_NOT_FOUND',
      );
    } finally {
      fs.rmSync(dir, {recursive: true});
    }
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

describe('feed filesystem boundary', () => {
  test('maps a URL-root-relative article href beneath the input root', (t) => {
    var fixture = boundaryFixture(t);
    fs.writeFileSync(
      path.join(fixture.input, 'index.html'),
      feedIndex('/articles/post.html'),
    );

    fixture.generate();

    var atom = fs.readFileSync(path.join(fixture.output, 'atom.xml'), 'utf8');
    assert.match(atom, /inside content/);
    assert.match(atom, /https:\/\/example\.com\/articles\/post\.html/);
  });

  test('reports a root-only article href as a coded missing article', (t) => {
    var fixture = boundaryFixture(t);
    fs.writeFileSync(path.join(fixture.input, 'index.html'), feedIndex('/'));

    assert.throws(
      () => fixture.generate(),
      (error) => {
        assert.strictEqual(error.code, 'PUGNEUM:FEED_ARTICLE_NOT_FOUND');
        assert.doesNotMatch(error.stack, /TypeError/);
        return true;
      },
    );
    assertNoGeneratedFeeds(fixture);
  });

  test('does not reinterpret a protocol-relative host as a local directory', (t) => {
    var fixture = boundaryFixture(t);
    var localAuthority = path.join(fixture.input, 'cdn.example.com');
    fs.mkdirSync(localAuthority);
    fs.writeFileSync(
      path.join(localAuthority, 'post.html'),
      feedArticle('local authority sentinel'),
    );
    fs.writeFileSync(
      path.join(fixture.input, 'index.html'),
      feedIndex('//cdn.example.com/post.html'),
    );

    assertFeedTraversal(() => fixture.generate());
    assertNoGeneratedFeeds(fixture);
  });

  test('rejects a configured index that lexically escapes the input root', (t) => {
    var fixture = boundaryFixture(t);
    fs.writeFileSync(
      path.join(fixture.outside, 'external-index.html'),
      feedIndex('nothing.html'),
    );

    assertFeedTraversal(() =>
      fixture.generate({index: '../outside/external-index.html'}),
    );
    assertNoGeneratedFeeds(fixture);
  });

  test('rejects a leaf index symlink', (t) => {
    var fixture = boundaryFixture(t);
    var external = path.join(fixture.outside, 'index.html');
    fs.writeFileSync(external, feedIndex('nothing.html'));
    fs.unlinkSync(path.join(fixture.input, 'index.html'));
    if (
      !makeSymlinkOrSkip(
        t,
        external,
        path.join(fixture.input, 'index.html'),
        'file',
      )
    ) {
      return;
    }

    assertFeedTraversal(() => fixture.generate());
    assertNoGeneratedFeeds(fixture);
  });

  test('rejects an ancestor index symlink', (t) => {
    var fixture = boundaryFixture(t);
    fs.writeFileSync(path.join(fixture.outside, 'index.html'), feedIndex('x'));
    if (
      !makeSymlinkOrSkip(
        t,
        fixture.outside,
        path.join(fixture.input, 'redirect'),
        'dir',
      )
    ) {
      return;
    }

    assertFeedTraversal(() => fixture.generate({index: 'redirect/index.html'}));
    assertNoGeneratedFeeds(fixture);
  });

  test('rejects a dangling index symlink', (t) => {
    var fixture = boundaryFixture(t);
    if (
      !makeSymlinkOrSkip(
        t,
        path.join(fixture.outside, 'missing-index.html'),
        path.join(fixture.input, 'dangling-index.html'),
        'file',
      )
    ) {
      return;
    }

    assertFeedTraversal(() => fixture.generate({index: 'dangling-index.html'}));
    assertNoGeneratedFeeds(fixture);
  });

  test('rejects a leaf article symlink without reading outside content', (t) => {
    var fixture = boundaryFixture(t);
    var external = path.join(fixture.outside, 'article.html');
    fs.writeFileSync(external, feedArticle('outside sentinel'));
    fs.unlinkSync(path.join(fixture.input, 'articles', 'post.html'));
    if (
      !makeSymlinkOrSkip(
        t,
        external,
        path.join(fixture.input, 'articles', 'post.html'),
        'file',
      )
    ) {
      return;
    }

    assertFeedTraversal(() => fixture.generate());
    assertNoGeneratedFeeds(fixture);
    assert.match(fs.readFileSync(external, 'utf8'), /outside sentinel/);
  });

  test('rejects an ancestor article symlink', (t) => {
    var fixture = boundaryFixture(t);
    fs.rmSync(path.join(fixture.input, 'articles'), {recursive: true});
    fs.mkdirSync(path.join(fixture.outside, 'articles'));
    fs.writeFileSync(
      path.join(fixture.outside, 'articles', 'post.html'),
      feedArticle('outside sentinel'),
    );
    if (
      !makeSymlinkOrSkip(
        t,
        path.join(fixture.outside, 'articles'),
        path.join(fixture.input, 'articles'),
        'dir',
      )
    ) {
      return;
    }

    assertFeedTraversal(() => fixture.generate());
    assertNoGeneratedFeeds(fixture);
  });

  test('rejects a dangling article symlink', (t) => {
    var fixture = boundaryFixture(t);
    fs.unlinkSync(path.join(fixture.input, 'articles', 'post.html'));
    if (
      !makeSymlinkOrSkip(
        t,
        path.join(fixture.outside, 'missing-article.html'),
        path.join(fixture.input, 'articles', 'post.html'),
        'file',
      )
    ) {
      return;
    }

    assertFeedTraversal(() => fixture.generate());
    assertNoGeneratedFeeds(fixture);
  });

  for (const role of ['atom', 'rss']) {
    test(
      'rejects a leaf ' + role + ' output symlink without clobbering it',
      (t) => {
        var fixture = boundaryFixture(t);
        var external = path.join(fixture.outside, role + '-sentinel');
        var outputName = role + '.xml';
        fs.writeFileSync(external, 'outside sentinel');
        if (
          !makeSymlinkOrSkip(
            t,
            external,
            path.join(fixture.output, outputName),
            'file',
          )
        ) {
          return;
        }

        assertFeedTraversal(() => fixture.generate());
        assert.strictEqual(
          fs.readFileSync(external, 'utf8'),
          'outside sentinel',
        );
        assert.ok(
          !fs.existsSync(
            path.join(fixture.output, role === 'atom' ? 'rss.xml' : 'atom.xml'),
          ),
        );
      },
    );

    test('rejects an ancestor ' + role + ' output symlink', (t) => {
      var fixture = boundaryFixture(t);
      var outsideOutput = path.join(fixture.outside, role + '-output');
      fs.mkdirSync(outsideOutput);
      if (
        !makeSymlinkOrSkip(
          t,
          outsideOutput,
          path.join(fixture.output, 'redirect'),
          'dir',
        )
      ) {
        return;
      }

      var feeds = {};
      feeds[role] = 'redirect/' + role + '.xml';
      assertFeedTraversal(() => fixture.generate(feeds));
      assertNoGeneratedFeeds(fixture);
      assert.ok(!fs.existsSync(path.join(outsideOutput, role + '.xml')));
    });

    test('rejects a dangling ' + role + ' output symlink', (t) => {
      var fixture = boundaryFixture(t);
      var outsideTarget = path.join(
        fixture.outside,
        'missing-' + role + '.xml',
      );
      if (
        !makeSymlinkOrSkip(
          t,
          outsideTarget,
          path.join(fixture.output, role + '.xml'),
          'file',
        )
      ) {
        return;
      }

      assertFeedTraversal(() => fixture.generate());
      assertNoGeneratedFeeds(fixture);
      assert.ok(!fs.existsSync(outsideTarget));
    });
  }
});
