var assert = require('node:assert/strict');
var {test} = require('node:test');
var generateRss = require('../lib/rss');

test('generates valid RSS feed', (t) => {
  var feed = {
    url: 'https://example.com/',
    title: 'Test Site',
    description: 'A test site',
    author: 'Test Author',
    language: 'en',
    entries: [
      {
        url: 'https://example.com/articles/second.html',
        title: 'Second Article',
        published: '2026-04-01',
        summary: 'Summary of the second article',
        author: 'Test Author',
        content: '<h1>Second Article</h1><p>Content.</p>',
      },
      {
        url: 'https://example.com/articles/first.html',
        title: 'First Article',
        published: '2026-03-15',
        summary: 'Summary of the first article',
        author: 'First Author',
        content: '<h1>First Article</h1><p>Content.</p>',
      },
    ],
    rssPath: 'rss.xml',
  };

  var xml = generateRss(feed);

  t.assert.snapshot(xml);
});

test('entry keywords are emitted as RSS categories', () => {
  var feed = {
    url: 'https://example.com/',
    title: 'T',
    description: 'A test feed',
    author: 'A',
    entries: [
      {
        url: 'https://example.com/p',
        title: 'P',
        published: '2026-01-01',
        author: 'A',
        content: '<p>x</p>',
        keywords: ['alpha', 'beta'],
      },
    ],
    rssPath: 'rss.xml',
    buildDate: '2026-01-01T00:00:00Z',
  };

  var rss = generateRss(feed);

  assert.ok(rss.includes('<category>alpha</category>'));
  assert.ok(rss.includes('<category>beta</category>'));
});

test('generates valid RSS feed with no entries', (t) => {
  // With no entries the feed-level <lastBuildDate> comes from buildDate (the
  // production caller always sets buildDate and never sets `updated`).
  var feed = {
    url: 'https://example.com/',
    title: 'Empty Site',
    description: 'No articles yet',
    author: 'Test Author',
    language: 'en',
    entries: [],
    rssPath: 'rss.xml',
    buildDate: '2026-01-01T00:00:00Z',
  };

  var xml = generateRss(feed);

  t.assert.snapshot(xml);
});

test('empty feed with no buildDate does not emit "Invalid Date"', () => {
  var feed = {
    url: 'https://example.com/',
    title: 'Empty Site',
    description: 'No articles yet',
    author: 'Test Author',
    language: 'en',
    entries: [],
    rssPath: 'rss.xml',
  };

  var rss = generateRss(feed);

  // The empty-feed branch must reuse the guarded date fallback rather than
  // formatting `new Date(undefined)`, which yields the literal "Invalid Date".
  assert.ok(!rss.includes('Invalid Date'));
});

test('RSS description is required', () => {
  var feed = {
    url: 'https://example.com/',
    title: 'Test Site',
    description: null,
    author: 'Test Author',
    language: 'en',
    entries: [],
    rssPath: 'rss.xml',
  };

  assert.throws(
    () => generateRss(feed),
    (err) => err.code === 'PUGNEUM:FEED_MISSING_DESCRIPTION',
  );
});

test('zoneless datetime is interpreted as UTC, not local time', () => {
  // RFC-822 output of a zoneless datetime must reflect the UTC instant, not the
  // build host's local interpretation.
  var feed = {
    url: 'https://example.com/',
    title: 'Test',
    description: 'A test feed',
    author: 'Author',
    entries: [
      {
        url: 'https://example.com/post',
        title: 'Post',
        published: '2026-03-15T10:30:00',
        author: 'Author',
        content: '<p>Content</p>',
      },
    ],
    rssPath: 'rss.xml',
    buildDate: '2026-01-01T00:00:00.000Z',
  };

  var rss = generateRss(feed);

  assert.ok(rss.includes('<pubDate>Sun, 15 Mar 2026 10:30:00 GMT</pubDate>'));
});

test('invalid date string falls back to buildDate', () => {
  var feed = {
    url: 'https://example.com/',
    title: 'Test',
    description: 'A test feed',
    author: 'Author',
    entries: [
      {
        url: 'https://example.com/post',
        title: 'Post',
        published: 'garbage-date',
        author: 'Author',
        content: '<p>Content</p>',
      },
    ],
    rssPath: 'rss.xml',
    buildDate: '2026-03-01T00:00:00.000Z',
  };

  var rss = generateRss(feed);

  // Must not contain "Invalid Date" — should fall back to buildDate
  assert.ok(!rss.includes('Invalid Date'));
  assert.ok(rss.includes('Sun, 01 Mar 2026'));
});

test('content with XML control characters produces valid XML without them', () => {
  var feed = {
    url: 'https://example.com/',
    title: 'Test',
    description: 'A test feed',
    author: 'Author',
    entries: [
      {
        url: 'https://example.com/post',
        title: 'Post with\x00control\x08chars',
        published: '2026-01-01',
        author: 'Author',
        content: '<p>text\x01with\x0Bcontrol\x1Fchars</p>',
      },
    ],
    rssPath: 'rss.xml',
    buildDate: '2026-01-01T00:00:00Z',
  };

  var rss = generateRss(feed);

  // Control characters must be stripped
  assert.ok(!rss.includes('\x00'));
  assert.ok(!rss.includes('\x01'));
  assert.ok(!rss.includes('\x08'));
  assert.ok(!rss.includes('\x0B'));
  assert.ok(!rss.includes('\x1F'));
  // Actual content must still be present (spaces between words are preserved)
  assert.ok(rss.includes('Post withcontrolchars'));
  assert.ok(rss.includes('textwithcontrolchars'));
});

test('CDATA content with ]]> is properly escaped', () => {
  const feed = {
    url: 'https://example.com/',
    title: 'Test',
    description: 'A test feed',
    author: 'Author',
    entries: [
      {
        url: 'https://example.com/post',
        title: 'Post',
        published: '2026-01-01',
        author: 'Author',
        content: '<pre>xml: ]]></pre>',
      },
    ],
    rssPath: 'rss.xml',
    buildDate: '2026-01-01T00:00:00Z',
  };
  const rss = generateRss(feed);
  assert.ok(!rss.includes('<pre>xml: ]]></pre>'));
  assert.ok(rss.includes(']]]]><![CDATA[>'));
});

test('null entry fields do not crash', () => {
  const feed = {
    url: 'https://example.com/',
    title: null,
    description: 'A feed',
    author: null,
    entries: [
      {
        url: 'https://example.com/post',
        title: null,
        published: '2026-01-01',
        author: null,
        content: '',
      },
    ],
    rssPath: 'rss.xml',
    buildDate: '2026-01-01T00:00:00Z',
  };
  const rss = generateRss(feed);
  assert.ok(rss.includes('<title></title>'));
  assert.ok(rss.includes('<dc:creator></dc:creator>'));
});
