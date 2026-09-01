var path = require('path');
var fs = require('fs');
var os = require('os');
var crypto = require('crypto');
var htmlparser2 = require('htmlparser2');
var assert = require('node:assert/strict');
var {describe, test} = require('node:test');
var generateFeeds = require('../');
var generateAtom = require('../lib/atom');
var generateRss = require('../lib/rss');
var {resolveRelativeUrls} = require('../lib/urls');
var {temporaryDirectory} = require('./helpers');

var fixturesDir = path.join(__dirname, 'fixtures');

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
  var sandbox = temporaryDirectory(t, 'pugneum-feed-boundary-');
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

function assertInvalidOptions(options, field) {
  assert.throws(
    () => generateFeeds(options),
    (error) => {
      assert.strictEqual(error.code, 'PUGNEUM:FEED_INVALID_OPTIONS');
      assert.ok(error.message.includes(field));
      return true;
    },
  );
}

function failPublicationRename(t, destinationName) {
  var originalRenameSync = fs.renameSync;
  var failed = false;
  fs.renameSync = function (source, destination) {
    if (
      !failed &&
      path.basename(destination) === destinationName &&
      path.basename(source).endsWith('.temporary')
    ) {
      failed = true;
      var error = new Error('injected publication failure');
      error.code = 'EIO';
      throw error;
    }
    return Reflect.apply(originalRenameSync, this, arguments);
  };
  t.after(() => {
    fs.renameSync = originalRenameSync;
  });
  return () => failed;
}

function assertFeedWriteFailed(fn, outputName) {
  assert.throws(fn, (error) => {
    assert.strictEqual(error.code, 'PUGNEUM:FEED_WRITE_FAILED');
    assert.ok(error.message.includes(outputName));
    return true;
  });
}

function assertResolution(input, expected, base) {
  assert.strictEqual(
    resolveRelativeUrls(input, base || 'https://example.com/'),
    expected,
  );
}

describe('resolveRelativeUrls', () => {
  test('the test helper is not exposed from the package root', () => {
    assert.strictEqual(generateFeeds.resolveRelativeUrls, undefined);
  });

  test('/path is resolved to absolute URL', () => {
    assertResolution(
      '<a href="/articles/post.html">link</a>',
      '<a href="https://example.com/articles/post.html">link</a>',
    );
  });

  test('protocol-relative //cdn.example.com is unchanged', () => {
    assertResolution(
      '<a href="//cdn.example.com/file.js">link</a>',
      '<a href="//cdn.example.com/file.js">link</a>',
    );
  });

  test('absolute https://other.com is unchanged', () => {
    assertResolution(
      '<a href="https://other.com/page">link</a>',
      '<a href="https://other.com/page">link</a>',
    );
  });

  test('base URL with $ is not corrupted', () => {
    assertResolution(
      '<a href="/path">link</a>',
      '<a href="https://ca$h.example.com/path">link</a>',
      'https://ca$h.example.com/',
    );
  });

  test('img src is resolved', () => {
    assertResolution(
      '<img src="/images/photo.jpg">',
      '<img src="https://example.com/images/photo.jpg">',
    );
  });

  test('data-href is not rewritten and the real href still is', () => {
    // Regex over serialized HTML matched any attribute ending in href/src and
    // preferred the rightmost one, corrupting data-* and leaving the real link
    // relative. The DOM rewrite keys on the exact attribute name.
    assertResolution(
      '<a href="/real" data-href="/widget">x</a>',
      '<a href="https://example.com/real" data-href="/widget">x</a>',
    );
  });

  test('lone data-src attribute is left untouched', () => {
    assertResolution(
      '<img data-src="/lazy.jpg">',
      '<img data-src="/lazy.jpg">',
    );
  });

  test('single-quoted attribute is resolved', () => {
    assertResolution(
      "<a href='/sq.html'>x</a>",
      '<a href="https://example.com/sq.html">x</a>',
    );
  });

  test('href is resolved even when an earlier attribute value contains >', () => {
    // The old regex stopped at the first '>' in an attribute value and never
    // reached href; the DOM rewrite is immune. (A bare '>' is valid in an
    // attribute value, so the serializer leaves it literal.)
    assertResolution(
      '<a title="a > b" href="/x.html">z</a>',
      '<a title="a > b" href="https://example.com/x.html">z</a>',
    );
  });

  test('srcset relative URLs are resolved, descriptors preserved', () => {
    assertResolution(
      '<img srcset="/a.jpg 1x, /b.jpg 2x" src="/a.jpg">',
      '<img srcset="https://example.com/a.jpg 1x, https://example.com/b.jpg 2x" src="https://example.com/a.jpg">',
    );
  });

  test('srcset data URL commas remain inside their candidate', () => {
    assertResolution(
      '<img srcset="data:image/png;base64,AAAA 1x, /fallback.png 2x">',
      '<img srcset="data:image/png;base64,AAAA 1x, https://example.com/fallback.png 2x">',
    );
  });

  test('srcset commas in a root-relative path are not separators', () => {
    assertResolution(
      '<img srcset="/images/a,b.png 1x, /fallback.png 2x">',
      '<img srcset="https://example.com/images/a,b.png 1x, https://example.com/fallback.png 2x">',
    );
  });

  test('srcset preserves empty candidates, spacing, and untouched URLs', () => {
    var html =
      '<img srcset=",  /a.png 1x,, data:image/svg+xml,%3Csvg%3E 2x, https://cdn.example/x.png 3x">';
    assertResolution(
      html,
      '<img srcset=",  https://example.com/a.png 1x,, data:image/svg+xml,%3Csvg%3E 2x, https://cdn.example/x.png 3x">',
    );
  });

  test('srcset preserves encoded commas and parenthesized descriptor text', () => {
    var html =
      '<img srcset="/images/a%2Cb.png type(foo,bar), /fallback.png 2x">';
    assertResolution(
      html,
      '<img srcset="https://example.com/images/a%2Cb.png type(foo,bar), https://example.com/fallback.png 2x">',
    );
  });

  test('source srcset relative URL is resolved', () => {
    assertResolution(
      '<source srcset="/img.jpg">',
      '<source srcset="https://example.com/img.jpg">',
    );
  });

  test('video poster and src are resolved', () => {
    assertResolution(
      '<video poster="/p.png" src="/v.mp4"></video>',
      '<video poster="https://example.com/p.png" src="https://example.com/v.mp4"></video>',
    );
  });

  test('XML-significant characters stay escaped in surrounding markup', () => {
    assertResolution(
      '<p>a &amp; b &lt; c</p><a href="/z">t</a>',
      '<p>a &amp; b &lt; c</p><a href="https://example.com/z">t</a>',
    );
  });

  test('document-relative attributes resolve against the article URL', () => {
    var html =
      '<a href="next.html">next</a>' +
      '<img src="../images/p.png">' +
      '<video poster="?poster=1" src="./v.mp4"></video>' +
      '<audio src="audio.mp3"></audio>' +
      '<iframe src="../../frame.html"></iframe>';
    assertResolution(
      html,
      '<a href="https://example.com/blog/articles/next.html">next</a>' +
        '<img src="https://example.com/blog/images/p.png">' +
        '<video poster="https://example.com/blog/articles/post.html?poster=1" src="https://example.com/blog/articles/v.mp4"></video>' +
        '<audio src="https://example.com/blog/articles/audio.mp3"></audio>' +
        '<iframe src="https://example.com/frame.html"></iframe>',
      'https://example.com/blog/articles/post.html?view=full#top',
    );
  });

  test('fragment-only, protocol-relative, and explicit schemes stay unchanged', () => {
    var html =
      '<a href="#part">part</a>' +
      '<a href="mailto:a@example.com">mail</a>' +
      '<img src="data:image/png;base64,AAAA">' +
      '<img src="//cdn.example.com/p.png">' +
      '<iframe src="https://other.example/frame"></iframe>';
    assertResolution(html, html, 'https://example.com/articles/post.html');
  });

  test('document-relative srcset candidates use the article URL', () => {
    var html =
      '<img srcset="small.png 1x, ../large.png 2x, data:image/png;base64,AAAA 3x">';
    assertResolution(
      html,
      '<img srcset="https://example.com/blog/articles/small.png 1x, https://example.com/blog/large.png 2x, data:image/png;base64,AAAA 3x">',
      'https://example.com/blog/articles/post.html',
    );
  });
});

describe('end-to-end feed generation', () => {
  test('generates atom.xml and rss.xml from fixtures', (t) => {
    var output = temporaryDirectory(t, 'pugneum-feed-output-');

    generateFeeds({
      outputDirectory: fixturesDir,
      feeds: {
        enabled: true,
        buildDate: '2026-05-02T03:04:05Z',
      },
      writeDirectory: output,
    });

    var atom = fs.readFileSync(path.join(output, 'atom.xml'), 'utf8');
    var rss = fs.readFileSync(path.join(output, 'rss.xml'), 'utf8');

    t.assert.snapshot(atom);
    t.assert.snapshot(rss);
  });

  test('creates contained parents for distinct nested feed paths', (t) => {
    var fixture = boundaryFixture(t);
    fixture.generate({
      atom: 'feeds/atom/site.xml',
      rss: 'feeds/rss/site.xml',
    });

    var atomPath = path.join(fixture.output, 'feeds', 'atom', 'site.xml');
    var rssPath = path.join(fixture.output, 'feeds', 'rss', 'site.xml');
    assert.ok(
      fs.readFileSync(atomPath, 'utf8').includes('feeds/atom/site.xml'),
    );
    assert.ok(fs.readFileSync(rssPath, 'utf8').includes('feeds/rss/site.xml'));
  });

  test('keeps the base path and URL-encodes literal output-name delimiters', (t) => {
    var fixture = boundaryFixture(t);
    fixture.generate({
      url: 'https://example.com/blog',
      atom: 'feeds/atom#v.xml',
      rss: 'feeds/rss#v.xml',
    });

    var atom = fs.readFileSync(
      path.join(fixture.output, 'feeds', 'atom#v.xml'),
      'utf8',
    );
    var rss = fs.readFileSync(
      path.join(fixture.output, 'feeds', 'rss#v.xml'),
      'utf8',
    );
    assert.ok(atom.includes('<id>https://example.com/blog/</id>'));
    assert.ok(
      atom.includes(
        '<link href="https://example.com/blog/feeds/atom%23v.xml" rel="self"/>',
      ),
    );
    assert.ok(
      rss.includes(
        '<atom:link href="https://example.com/blog/feeds/rss%23v.xml"',
      ),
    );
  });

  test('orders entries by publication instant and keeps build time exact', (t) => {
    var sandbox = temporaryDirectory(t, 'pugneum-feed-order-');
    var input = path.join(sandbox, 'input');
    var output = path.join(sandbox, 'output');
    fs.mkdirSync(path.join(input, 'articles'), {recursive: true});
    fs.mkdirSync(output);
    fs.writeFileSync(
      path.join(input, 'index.html'),
      '<!DOCTYPE html><html><head><base href="https://example.com/">' +
        '<title>Site</title><meta name="description" content="D">' +
        '<meta name="author" content="A"></head><body>' +
        '<a data-published-at="2026-01-01T00:30:00+01:00" href="articles/older.html">Older</a>' +
        '<a data-published-at="2026-01-01T00:00:00Z" href="articles/newer.html">Newer</a>' +
        '</body></html>',
    );
    fs.writeFileSync(
      path.join(input, 'articles', 'older.html'),
      feedArticle('older').replace(
        '<title>Post</title>',
        '<title>Older</title>',
      ),
    );
    fs.writeFileSync(
      path.join(input, 'articles', 'newer.html'),
      feedArticle('newer').replace(
        '<title>Post</title>',
        '<title>Newer</title>',
      ),
    );

    generateFeeds({
      outputDirectory: input,
      writeDirectory: output,
      feeds: {
        enabled: true,
        buildDate: '2026-02-03T04:05:06Z',
      },
    });
    var atom = fs.readFileSync(path.join(output, 'atom.xml'), 'utf8');
    var rss = fs.readFileSync(path.join(output, 'rss.xml'), 'utf8');
    assert.ok(
      atom.indexOf('<title>Newer</title>') <
        atom.indexOf('<title>Older</title>'),
    );
    assert.ok(atom.includes('<updated>2026-01-01T00:00:00.000Z</updated>'));
    assert.ok(
      rss.includes(
        '<lastBuildDate>Tue, 03 Feb 2026 04:05:06 GMT</lastBuildDate>',
      ),
    );
  });

  test('captures one build-start instant for both empty formats', (t) => {
    var sandbox = temporaryDirectory(t, 'pugneum-feed-empty-clock-');
    var input = path.join(sandbox, 'input');
    var output = path.join(sandbox, 'output');
    fs.mkdirSync(input);
    fs.mkdirSync(output);
    fs.writeFileSync(
      path.join(input, 'index.html'),
      '<!DOCTYPE html><html><head><base href="https://example.com/">' +
        '<title>Empty Site</title><meta name="description" content="D">' +
        '<meta name="author" content="A"></head><body></body></html>',
    );
    var originalNow = Date.now;
    var expected = Date.parse('2026-07-08T09:10:11.000Z');
    var calls = 0;
    Date.now = function () {
      calls++;
      return expected;
    };
    t.after(() => {
      Date.now = originalNow;
    });

    generateFeeds({
      outputDirectory: input,
      writeDirectory: output,
      feeds: {enabled: true},
    });

    var atom = fs.readFileSync(path.join(output, 'atom.xml'), 'utf8');
    var rss = fs.readFileSync(path.join(output, 'rss.xml'), 'utf8');
    assert.ok(atom.includes('<updated>2026-07-08T09:10:11.000Z</updated>'));
    assert.ok(
      rss.includes(
        '<lastBuildDate>Wed, 08 Jul 2026 09:10:11 GMT</lastBuildDate>',
      ),
    );
    assert.strictEqual(calls, 1);
  });
});

describe('transactional feed publication', () => {
  test('a later commit failure removes both fresh outputs', (t) => {
    var fixture = boundaryFixture(t);
    var didFail = failPublicationRename(t, 'rss.xml');

    assertFeedWriteFailed(() => fixture.generate(), 'rss.xml');

    assert.ok(didFail());
    assertNoGeneratedFeeds(fixture);
    assert.deepStrictEqual(fs.readdirSync(fixture.output), []);
  });

  test('a later commit failure restores both prior outputs', (t) => {
    var fixture = boundaryFixture(t);
    fs.writeFileSync(path.join(fixture.output, 'atom.xml'), 'old atom');
    fs.writeFileSync(path.join(fixture.output, 'rss.xml'), 'old rss');
    var didFail = failPublicationRename(t, 'rss.xml');

    assertFeedWriteFailed(() => fixture.generate(), 'rss.xml');

    assert.ok(didFail());
    assert.strictEqual(
      fs.readFileSync(path.join(fixture.output, 'atom.xml'), 'utf8'),
      'old atom',
    );
    assert.strictEqual(
      fs.readFileSync(path.join(fixture.output, 'rss.xml'), 'utf8'),
      'old rss',
    );
    assert.deepStrictEqual(fs.readdirSync(fixture.output).sort(), [
      'atom.xml',
      'rss.xml',
    ]);
  });
});

describe('feed generation work bounds', () => {
  test('parses the index and each selected article only once', (t) => {
    var fixture = boundaryFixture(t);
    var originalParseDocument = htmlparser2.parseDocument;
    var parseCount = 0;
    htmlparser2.parseDocument = function () {
      parseCount++;
      return Reflect.apply(originalParseDocument, this, arguments);
    };
    t.after(() => {
      htmlparser2.parseDocument = originalParseDocument;
    });

    fixture.generate();

    assert.strictEqual(parseCount, 2);
  });

  test('creates and stages Atom and RSS chunk iterators sequentially', (t) => {
    var fixture = boundaryFixture(t);
    var originalAtomChunks = generateAtom.chunks;
    var originalRssChunks = generateRss.chunks;
    var events = [];

    function tracedChunks(name, iterable) {
      return {
        *[Symbol.iterator]() {
          events.push(name + ':start');
          yield* iterable;
          events.push(name + ':end');
        },
      };
    }

    generateAtom.chunks = function (feed) {
      events.push('atom:create');
      return tracedChunks('atom', originalAtomChunks(feed));
    };
    generateRss.chunks = function (feed) {
      events.push('rss:create');
      return tracedChunks('rss', originalRssChunks(feed));
    };
    t.after(() => {
      if (originalAtomChunks === undefined) delete generateAtom.chunks;
      else generateAtom.chunks = originalAtomChunks;
      if (originalRssChunks === undefined) delete generateRss.chunks;
      else generateRss.chunks = originalRssChunks;
    });

    fixture.generate();

    assert.deepStrictEqual(events, [
      'atom:create',
      'rss:create',
      'atom:start',
      'atom:end',
      'rss:start',
      'rss:end',
    ]);
  });

  test('rejects oversized input before reading the index body', (t) => {
    var fixture = boundaryFixture(t);
    var indexSize = fs.statSync(path.join(fixture.input, 'index.html')).size;

    assert.throws(
      () =>
        generateFeeds({
          outputDirectory: fixture.input,
          writeDirectory: fixture.output,
          feeds: {enabled: true},
          compilationLimits: {sourceBytes: indexSize - 1},
        }),
      (failure) =>
        failure.code === 'PUGNEUM:COMPILATION_LIMIT_EXCEEDED' &&
        failure.resource === 'sourceBytes' &&
        failure.attempted === indexSize &&
        failure.limit === indexSize - 1,
    );
    assertNoGeneratedFeeds(fixture);
  });

  test('bounds entry discovery before reading article pages', (t) => {
    var fixture = boundaryFixture(t);
    var originalParseDocument = htmlparser2.parseDocument;
    var parseCount = 0;
    htmlparser2.parseDocument = function () {
      parseCount++;
      return Reflect.apply(originalParseDocument, this, arguments);
    };
    t.after(() => {
      htmlparser2.parseDocument = originalParseDocument;
    });

    assert.throws(
      () =>
        generateFeeds({
          outputDirectory: fixture.input,
          writeDirectory: fixture.output,
          feeds: {enabled: true},
          compilationLimits: {feedEntries: 0},
        }),
      (failure) =>
        failure.code === 'PUGNEUM:COMPILATION_LIMIT_EXCEEDED' &&
        failure.resource === 'feedEntries' &&
        failure.attempted === 1 &&
        failure.limit === 0,
    );
    assert.strictEqual(parseCount, 1);
    assertNoGeneratedFeeds(fixture);
  });

  test('bounds cumulative serialized bytes transactionally', (t) => {
    var fixture = boundaryFixture(t);

    assert.throws(
      () =>
        generateFeeds({
          outputDirectory: fixture.input,
          writeDirectory: fixture.output,
          feeds: {enabled: true},
          compilationLimits: {outputBytes: 0},
        }),
      (failure) =>
        failure.code === 'PUGNEUM:COMPILATION_LIMIT_EXCEEDED' &&
        failure.resource === 'outputBytes' &&
        failure.attempted > 0 &&
        failure.limit === 0,
    );
    assertNoGeneratedFeeds(fixture);
    assert.deepStrictEqual(fs.readdirSync(fixture.output), []);
  });

  test('reuses an exact article href without reparsing the document', (t) => {
    var fixture = boundaryFixture(t);
    var indexPath = path.join(fixture.input, 'index.html');
    var index = fs.readFileSync(indexPath, 'utf8');
    fs.writeFileSync(
      indexPath,
      index.replace(
        '</body>',
        '<div data-published-at="2026-01-02"><a href="articles/post.html">Post again</a></div></body>',
      ),
    );
    var originalParseDocument = htmlparser2.parseDocument;
    var parseCount = 0;
    htmlparser2.parseDocument = function () {
      parseCount++;
      return Reflect.apply(originalParseDocument, this, arguments);
    };
    t.after(() => {
      htmlparser2.parseDocument = originalParseDocument;
    });

    fixture.generate();

    assert.strictEqual(parseCount, 2, 'one index parse and one article parse');
    var atom = fs.readFileSync(path.join(fixture.output, 'atom.xml'), 'utf8');
    assert.strictEqual((atom.match(/<entry>/g) || []).length, 2);
  });
});

describe('config overrides', () => {
  test('json config overrides html-extracted values', (t) => {
    var output = temporaryDirectory(t, 'pugneum-feed-output-');

    generateFeeds({
      outputDirectory: fixturesDir,
      feeds: {
        enabled: true,
        url: 'https://override.com/',
        title: 'Override Title',
        author: 'Override Author',
        description: 'Override Description',
      },
      writeDirectory: output,
    });

    var atom = fs.readFileSync(path.join(output, 'atom.xml'), 'utf8');
    assert.match(atom, /https:\/\/override\.com\//);
    assert.ok(atom.includes('Override Title'));
    assert.ok(atom.includes('Override Author'));
    assert.ok(atom.includes('Override Description'));
  });
});

describe('required feed metadata', () => {
  test('rejects an explicitly blank feed title before output setup', (t) => {
    var fixture = boundaryFixture(t);

    assert.throws(
      () => fixture.generate({title: '   '}),
      (error) => error.code === 'PUGNEUM:FEED_MISSING_TITLE',
    );
    assertNoGeneratedFeeds(fixture);
  });

  test('rejects an entry when article and link titles are blank', (t) => {
    var fixture = boundaryFixture(t);
    fs.writeFileSync(
      path.join(fixture.input, 'index.html'),
      feedIndex('articles/post.html').replace('>Post</a>', '>   </a>'),
    );
    fs.writeFileSync(
      path.join(fixture.input, 'articles', 'post.html'),
      feedArticle('inside content').replace(
        '<title>Post</title>',
        '<title>   </title>',
      ),
    );

    assert.throws(
      () => fixture.generate(),
      (error) => error.code === 'PUGNEUM:FEED_MISSING_ENTRY_TITLE',
    );
    assertNoGeneratedFeeds(fixture);
  });

  test('uses an article author when the feed has no author', (t) => {
    var fixture = boundaryFixture(t);
    var indexPath = path.join(fixture.input, 'index.html');
    fs.writeFileSync(
      indexPath,
      fs
        .readFileSync(indexPath, 'utf8')
        .replace('<meta name="author" content="Author">', ''),
    );

    fixture.generate();

    var atom = fs.readFileSync(path.join(fixture.output, 'atom.xml'), 'utf8');
    var header = atom.slice(0, atom.indexOf('  <entry>'));
    assert.ok(!header.includes('<author>'));
    assert.ok(atom.includes('<name>Author</name>'));
  });

  test('uses the feed author when an article has no author', (t) => {
    var fixture = boundaryFixture(t);
    var articlePath = path.join(fixture.input, 'articles', 'post.html');
    fs.writeFileSync(
      articlePath,
      fs
        .readFileSync(articlePath, 'utf8')
        .replace('<meta name="author" content="Author">', ''),
    );

    fixture.generate();

    var atom = fs.readFileSync(path.join(fixture.output, 'atom.xml'), 'utf8');
    assert.strictEqual((atom.match(/<name>Author<\/name>/g) || []).length, 2);
  });

  test('rejects an Atom entry when neither author source exists', (t) => {
    var fixture = boundaryFixture(t);
    var indexPath = path.join(fixture.input, 'index.html');
    var articlePath = path.join(fixture.input, 'articles', 'post.html');
    fs.writeFileSync(
      indexPath,
      fs
        .readFileSync(indexPath, 'utf8')
        .replace('<meta name="author" content="Author">', ''),
    );
    fs.writeFileSync(
      articlePath,
      fs
        .readFileSync(articlePath, 'utf8')
        .replace('<meta name="author" content="Author">', ''),
    );

    assert.throws(
      () => fixture.generate(),
      (error) => error.code === 'PUGNEUM:FEED_MISSING_AUTHOR',
    );
    assertNoGeneratedFeeds(fixture);
  });
});

describe('end-to-end URL resolution', () => {
  test('article content keeps its original URL semantics in the feed', (t) => {
    var dir = temporaryDirectory(t, 'pugneum-feed-urls-');
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
        '<a href="/other.html">root</a>' +
        '<a href="next.html">relative</a>' +
        '<a href="?print=1">query</a>' +
        '<a href="#local">fragment</a>' +
        '<a href="mailto:a@example.com">mail</a>' +
        '<img src="hero.png" srcset="small.png 1x, ../large.png 2x">' +
        '<video poster="poster.png" src="/video.mp4"></video>' +
        '<audio src="audio.mp3"></audio>' +
        '<iframe src="../frame.html"></iframe>' +
        '<a data-href="/keep">keep</a>' +
        '</article></body></html>',
    );

    generateFeeds({
      outputDirectory: dir,
      feeds: {enabled: true},
      writeDirectory: dir,
    });
    var atom = fs.readFileSync(path.join(dir, 'atom.xml'), 'utf8');
    // Root-relative href/src/srcset are absolutized...
    assert.ok(atom.includes('https://example.com/other.html'));
    assert.ok(atom.includes('https://example.com/articles/next.html'));
    assert.ok(atom.includes('https://example.com/articles/post.html?print=1'));
    assert.ok(atom.includes('href=&quot;#local&quot;'));
    assert.ok(atom.includes('href=&quot;mailto:a@example.com&quot;'));
    assert.ok(atom.includes('https://example.com/articles/hero.png'));
    assert.ok(atom.includes('https://example.com/articles/small.png 1x'));
    assert.ok(atom.includes('https://example.com/large.png 2x'));
    assert.ok(atom.includes('https://example.com/articles/poster.png'));
    assert.ok(atom.includes('https://example.com/video.mp4'));
    assert.ok(atom.includes('https://example.com/articles/audio.mp3'));
    assert.ok(atom.includes('https://example.com/frame.html'));
    // ...but data-href is left exactly as authored.
    assert.ok(atom.includes('data-href=&quot;/keep&quot;'));
  });
});

describe('article URL to filesystem mapping', () => {
  test('decodes only the path for lookup and preserves query and fragment', (t) => {
    var fixture = boundaryFixture(t);
    fs.unlinkSync(path.join(fixture.input, 'articles', 'post.html'));
    fs.writeFileSync(
      path.join(fixture.input, 'articles', 'my post.html'),
      feedArticle('decoded filename sentinel'),
    );
    fs.writeFileSync(
      path.join(fixture.input, 'index.html'),
      feedIndex('articles/my%20post.html?view=full#top'),
    );

    fixture.generate({url: 'https://example.com/blog/'});

    var atom = fs.readFileSync(path.join(fixture.output, 'atom.xml'), 'utf8');
    var rss = fs.readFileSync(path.join(fixture.output, 'rss.xml'), 'utf8');
    var publicUrl =
      'https://example.com/blog/articles/my%20post.html?view=full#top';
    assert.match(atom, /decoded filename sentinel/);
    assert.ok(
      atom.includes('<link href="' + publicUrl + '" rel="alternate"/>'),
    );
    assert.ok(
      rss.includes('<guid isPermaLink="true">' + publicUrl + '</guid>'),
    );
  });

  test('accepts an absolute same-origin article URL', (t) => {
    var fixture = boundaryFixture(t);
    fs.writeFileSync(
      path.join(fixture.input, 'index.html'),
      feedIndex('https://example.com/articles/post.html'),
    );

    fixture.generate();

    var atom = fs.readFileSync(path.join(fixture.output, 'atom.xml'), 'utf8');
    assert.match(atom, /inside content/);
    assert.ok(
      atom.includes(
        '<link href="https://example.com/articles/post.html" rel="alternate"/>',
      ),
    );
  });

  [
    ['an external origin', 'https://other.example/articles/post.html'],
    ['an unsupported scheme', 'mailto:author@example.com'],
    ['malformed percent encoding', 'articles/post%ZZ.html'],
  ].forEach(([label, href]) => {
    test('rejects ' + label + ' with an article-URL error', (t) => {
      var fixture = boundaryFixture(t);
      fs.writeFileSync(path.join(fixture.input, 'index.html'), feedIndex(href));

      assert.throws(
        () => fixture.generate(),
        (error) => {
          assert.strictEqual(error.code, 'PUGNEUM:FEED_INVALID_ARTICLE_URL');
          return true;
        },
      );
      assertNoGeneratedFeeds(fixture);
    });
  });

  [
    ['an encoded parent segment', 'articles/%2e%2e/post.html'],
    ['an encoded forward slash', 'articles%2fpost.html'],
    ['an encoded backslash', 'articles%5cpost.html'],
  ].forEach(([label, href]) => {
    test('rejects ' + label + ' before filesystem lookup', (t) => {
      var fixture = boundaryFixture(t);
      fs.writeFileSync(path.join(fixture.input, 'index.html'), feedIndex(href));

      assertFeedTraversal(() => fixture.generate());
      assertNoGeneratedFeeds(fixture);
    });
  });
});

describe('option validation', () => {
  var unreadableRoot = path.join(
    os.tmpdir(),
    'pugneum-feed-options-' + crypto.randomUUID(),
  );

  [
    ['an absent options value', undefined, 'options'],
    ['a null options value', null, 'options'],
    ['an options array', [], 'options'],
    ['a missing output directory', {}, 'outputDirectory'],
    ['an empty output directory', {outputDirectory: ''}, 'outputDirectory'],
    ['a non-string output directory', {outputDirectory: 42}, 'outputDirectory'],
    [
      'a null write directory',
      {outputDirectory: unreadableRoot, writeDirectory: null},
      'writeDirectory',
    ],
    [
      'a null feeds object',
      {outputDirectory: unreadableRoot, feeds: null},
      'feeds',
    ],
    ['a feeds array', {outputDirectory: unreadableRoot, feeds: []}, 'feeds'],
    [
      'a non-boolean enabled flag',
      {outputDirectory: unreadableRoot, feeds: {enabled: 'false'}},
      'feeds.enabled',
    ],
    [
      'a non-string URL override',
      {outputDirectory: unreadableRoot, feeds: {url: new URL('https://x/')}},
      'feeds.url',
    ],
    [
      'a non-string title override',
      {outputDirectory: unreadableRoot, feeds: {title: null}},
      'feeds.title',
    ],
    [
      'a non-string author override',
      {outputDirectory: unreadableRoot, feeds: {author: []}},
      'feeds.author',
    ],
    [
      'a non-string description override',
      {outputDirectory: unreadableRoot, feeds: {description: {}}},
      'feeds.description',
    ],
    [
      'a non-string build date',
      {outputDirectory: unreadableRoot, feeds: {buildDate: 0}},
      'feeds.buildDate',
    ],
    [
      'an empty index path',
      {outputDirectory: unreadableRoot, feeds: {index: ''}},
      'feeds.index',
    ],
    [
      'selector syntax beyond one tag name',
      {outputDirectory: unreadableRoot, feeds: {selector: 'article.main'}},
      'feeds.selector',
    ],
    [
      'an empty Atom path',
      {outputDirectory: unreadableRoot, feeds: {atom: ''}},
      'feeds.atom',
    ],
    [
      'a non-string RSS path',
      {outputDirectory: unreadableRoot, feeds: {rss: 3}},
      'feeds.rss',
    ],
    [
      'an invalid ignored field while disabled',
      {
        outputDirectory: unreadableRoot,
        feeds: {enabled: false, atom: false},
      },
      'feeds.atom',
    ],
  ].forEach(([label, options, field]) => {
    test('rejects ' + label + ' before filesystem access', () => {
      assertInvalidOptions(options, field);
      assert.ok(!fs.existsSync(unreadableRoot));
    });
  });

  [
    [{atom: 'feed.xml', rss: 'feed.xml'}, 'the same spelling'],
    [{atom: 'feeds/../feed.xml', rss: 'feed.xml'}, 'normalized aliases'],
    [{atom: 'rss.xml'}, 'an explicit name colliding with a default'],
  ].forEach(([feeds, label]) => {
    test('rejects Atom/RSS destinations using ' + label, () => {
      assertInvalidOptions(
        {outputDirectory: unreadableRoot, feeds},
        'feeds.atom and feeds.rss',
      );
      assert.ok(!fs.existsSync(unreadableRoot));
    });
  });

  test('a valid disabled configuration still performs no filesystem work', () => {
    assert.strictEqual(
      generateFeeds({
        outputDirectory: unreadableRoot,
        feeds: {enabled: false},
      }),
      undefined,
    );
    assert.ok(!fs.existsSync(unreadableRoot));
  });

  test('an invalid build date is rejected before filesystem access', () => {
    assert.throws(
      () =>
        generateFeeds({
          outputDirectory: unreadableRoot,
          feeds: {enabled: false, buildDate: 'not-an-instant'},
        }),
      (error) => error.code === 'PUGNEUM:FEED_INVALID_BUILD_DATE',
    );
    assert.ok(!fs.existsSync(unreadableRoot));
  });
});

describe('error handling', () => {
  test('throws FEED_INVALID_URL for a path-only base href', (t) => {
    var dir = temporaryDirectory(t, 'pugneum-feed-relative-base-');
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
  });

  test('throws FEED_INVALID_URL for a protocol-relative feeds.url', (t) => {
    var output = temporaryDirectory(t, 'pugneum-feed-output-');
    assert.throws(
      () =>
        generateFeeds({
          outputDirectory: fixturesDir,
          feeds: {enabled: true, url: '//cdn.example.com/'},
          writeDirectory: output,
        }),
      (err) => err.code === 'PUGNEUM:FEED_INVALID_URL',
    );
  });

  ['?view=full', '#section'].forEach((suffix) => {
    test('throws FEED_INVALID_URL for a base URL ending in ' + suffix, (t) => {
      var fixture = boundaryFixture(t);
      assert.throws(
        () => fixture.generate({url: 'https://example.com/blog' + suffix}),
        (err) => err.code === 'PUGNEUM:FEED_INVALID_URL',
      );
      assertNoGeneratedFeeds(fixture);
    });
  });

  test('throws when base URL is unresolvable', (t) => {
    var noBaseDir = temporaryDirectory(t, 'pugneum-feed-no-base-');
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
  });

  test('error messages do not carry a stray leading "0"', (t) => {
    // Feed errors have no source-template location. pugneum-error builds its
    // header from present parts, so passing line:0 (finite but not a real line)
    // used to push a literal "0", rendering every message as "0\n\n<message>".
    // The message must equal the raw message text with no header prefix.
    var noBaseDir = temporaryDirectory(t, 'pugneum-feed-no-base-message-');
    fs.writeFileSync(
      path.join(noBaseDir, 'index.html'),
      '<!DOCTYPE html><html><head><title>No Base</title>' +
        '<meta name="description" content="test"></head><body></body></html>',
    );

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
  });

  test('extensionless article href resolves via the .html fallback', (t) => {
    // A common SSG pattern: index links to "articles/post" (no extension) and the
    // file on disk is "articles/post.html". index.js appends ".html" when the bare
    // path is absent. Exercises that previously-untested fallback end-to-end.
    var dir = temporaryDirectory(t, 'pugneum-feed-html-fallback-');
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
  });

  test('throws FEED_ARTICLE_NOT_FOUND when an article href is a directory', (t) => {
    // The href resolves to an existing path, but it is a directory, not a file.
    // The rooted reader rejects it before attempting a content read.
    var dir = temporaryDirectory(t, 'pugneum-feed-article-directory-');
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

    assert.throws(
      () =>
        generateFeeds({
          outputDirectory: dir,
          feeds: {enabled: true},
          writeDirectory: dir,
        }),
      (err) => err.code === 'PUGNEUM:FEED_ARTICLE_NOT_FOUND',
    );
  });

  test('throws FEED_ARTICLE_NOT_FOUND for missing article', (t) => {
    var missingDir = temporaryDirectory(t, 'pugneum-feed-missing-article-');
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
  });

  test('throws FEED_PATH_TRAVERSAL for article href escaping output directory', (t) => {
    var traversalDir = temporaryDirectory(t, 'pugneum-feed-traversal-');
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
  });

  test('throws FEED_PATH_TRAVERSAL for feed write path escaping write directory', (t) => {
    var output = temporaryDirectory(t, 'pugneum-feed-output-');

    assert.throws(
      () =>
        generateFeeds({
          outputDirectory: fixturesDir,
          feeds: {enabled: true, atom: '../../malicious.xml'},
          writeDirectory: output,
        }),
      (err) => err.code === 'PUGNEUM:FEED_PATH_TRAVERSAL',
    );
  });

  test('skips when feeds.enabled is false', (t) => {
    var output = temporaryDirectory(t, 'pugneum-feed-output-');

    generateFeeds({
      outputDirectory: fixturesDir,
      feeds: {enabled: false},
      writeDirectory: output,
    });

    assert.ok(!fs.existsSync(path.join(output, 'atom.xml')));
    assert.ok(!fs.existsSync(path.join(output, 'rss.xml')));
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

    assert.throws(
      () => fixture.generate(),
      (error) => error.code === 'PUGNEUM:FEED_INVALID_ARTICLE_URL',
    );
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
