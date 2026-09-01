var assert = require('node:assert/strict');
var {test} = require('node:test');
var generateRss = require('../lib/rss');
var {makeEntry, makeRssFeed} = require('./helpers');
var {assertValidRss} = require('./validate');

test('generates valid RSS feed', (t) => {
  var feed = makeRssFeed({
    title: 'Test Site',
    description: 'A test site',
    author: 'Test Author',
    language: 'en',
    entries: [
      makeEntry({
        url: 'https://example.com/articles/second.html',
        title: 'Second Article',
        published: '2026-04-01',
        summary: 'Summary of the second article',
        author: 'Test Author',
        content: '<h1>Second Article</h1><p>Content.</p>',
      }),
      makeEntry({
        url: 'https://example.com/articles/first.html',
        title: 'First Article',
        published: '2026-03-15',
        summary: 'Summary of the first article',
        author: 'First Author',
        content: '<h1>First Article</h1><p>Content.</p>',
      }),
    ],
  });

  var xml = generateRss(feed);

  assertValidRss(xml, {selfUrl: 'https://example.com/rss.xml'});
  t.assert.snapshot(xml);
});

test('chunked RSS serialization is byte-identical and item-bounded', () => {
  var feed = makeRssFeed({
    title: 'Test Site',
    description: 'A test site',
    author: 'Test Author',
    entries: [
      makeEntry({
        url: 'https://example.com/first',
        title: 'First',
        published: '2026-01-02',
        author: 'A',
        content: '<p>first</p>',
      }),
      makeEntry({
        url: 'https://example.com/second',
        title: 'Second',
        author: 'B',
        content: '<p>second</p>',
      }),
    ],
    buildDate: '2026-01-03T00:00:00Z',
  });

  var chunks = Array.from(generateRss.chunks(feed));

  assert.strictEqual(chunks.join(''), generateRss(feed));
  assert.strictEqual(chunks.length, feed.entries.length + 2);
  assert.ok(!chunks[0].includes('<item>'));
  assert.ok(
    chunks[1].includes(
      '<guid isPermaLink="true">https://example.com/first</guid>',
    ),
  );
  assert.ok(
    chunks[2].includes(
      '<guid isPermaLink="true">https://example.com/second</guid>',
    ),
  );
  assert.strictEqual(chunks[3], '  </channel>\n</rss>\n');
});

test('entry keywords are emitted as RSS categories', () => {
  var feed = makeRssFeed({
    entries: [makeEntry({keywords: ['alpha', 'beta']})],
  });

  var rss = generateRss(feed);

  assert.ok(rss.includes('<category>alpha</category>'));
  assert.ok(rss.includes('<category>beta</category>'));
});

test('generates valid RSS feed with no entries', (t) => {
  // With no entries the feed-level <lastBuildDate> comes from buildDate.
  var feed = makeRssFeed({
    title: 'Empty Site',
    description: 'No articles yet',
    author: 'Test Author',
    language: 'en',
  });

  var xml = generateRss(feed);

  assertValidRss(xml, {selfUrl: 'https://example.com/rss.xml'});
  t.assert.snapshot(xml);
});

test('custom RSS self links remain valid', () => {
  var feed = makeRssFeed({
    title: 'T',
    description: 'D',
    author: 'A',
    rssPath: 'ignored.xml',
    rssUrl: 'https://feeds.example.com/custom.rss',
  });

  assertValidRss(generateRss(feed), {selfUrl: feed.rssUrl});
});

test('RSS requires non-empty feed and entry titles', () => {
  [null, '   '].forEach((title) => {
    assert.throws(
      () => generateRss(makeRssFeed({title})),
      (error) => error.code === 'PUGNEUM:FEED_MISSING_TITLE',
    );
    assert.throws(
      () => generateRss(makeRssFeed({entries: [makeEntry({title})]})),
      (error) => error.code === 'PUGNEUM:FEED_MISSING_ENTRY_TITLE',
    );
  });
});

test('RSS omits an unavailable optional creator', () => {
  var rss = generateRss(
    makeRssFeed({
      author: null,
      entries: [makeEntry({author: null})],
    }),
  );

  assertValidRss(rss);
  assert.ok(!rss.includes('<dc:creator>'));
});

test('RSS validity oracle rejects missing required structure', () => {
  var feed = makeRssFeed({title: 'T', description: 'D', author: 'A'});
  var xml = generateRss(feed);

  assert.throws(() =>
    assertValidRss(xml.replace('<title>T</title>', '<title></title>')),
  );
  assert.throws(() =>
    assertValidRss(
      xml.replace(
        '<description>D</description>',
        '<description></description>',
      ),
    ),
  );
  assert.throws(() => assertValidRss(xml.replace('</rss>', '</not-rss>')));
});

test('empty feed with no buildDate uses one captured current instant', (t) => {
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

  var rss = generateRss(
    makeRssFeed({
      title: 'Empty Site',
      description: 'No articles yet',
      author: 'Test Author',
      language: 'en',
      buildDate: undefined,
    }),
  );

  assert.ok(
    rss.includes(
      '<lastBuildDate>Wed, 08 Jul 2026 09:10:11 GMT</lastBuildDate>',
    ),
  );
  assert.strictEqual(calls, 1);
});

test('RSS description is required', () => {
  [null, '   '].forEach((description) => {
    assert.throws(
      () => generateRss(makeRssFeed({description})),
      (error) => {
        assert.strictEqual(error.code, 'PUGNEUM:FEED_MISSING_DESCRIPTION');
        assert.doesNotMatch(error.message, /^0(?:\n|$)/);
        return true;
      },
    );
  });
});

test('RSS lastBuildDate uses the configured build instant', () => {
  var rss = generateRss(
    makeRssFeed({
      buildDate: '2026-01-02T03:04:05-03:00',
      entries: [makeEntry({published: '2026-08-01'})],
    }),
  );

  assert.ok(
    rss.includes(
      '<lastBuildDate>Fri, 02 Jan 2026 06:04:05 GMT</lastBuildDate>',
    ),
  );
  assert.ok(rss.includes('<pubDate>Sat, 01 Aug 2026 00:00:00 GMT</pubDate>'));
});

test('zoneless datetime is interpreted as UTC, not local time', () => {
  // RFC-822 output of a zoneless datetime must reflect the UTC instant, not the
  // build host's local interpretation.
  var feed = makeRssFeed({
    entries: [makeEntry({published: '2026-03-15T10:30:00'})],
  });

  var rss = generateRss(feed);

  assert.ok(rss.includes('<pubDate>Sun, 15 Mar 2026 10:30:00 GMT</pubDate>'));
});

test('invalid date string falls back to buildDate', () => {
  var feed = makeRssFeed({
    entries: [makeEntry({published: 'garbage-date'})],
    buildDate: '2026-03-01T00:00:00.000Z',
  });

  var rss = generateRss(feed);

  // Must not contain "Invalid Date" — should fall back to buildDate
  assert.ok(!rss.includes('Invalid Date'));
  assert.ok(rss.includes('Sun, 01 Mar 2026'));
});

test('content with XML control characters produces valid XML without them', () => {
  var feed = makeRssFeed({
    entries: [
      makeEntry({
        title: 'Post with\x00control\x08chars',
        content: '<p>text\x01with\x0Bcontrol\x1Fchars</p>',
      }),
    ],
  });

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
  var feed = makeRssFeed({
    entries: [makeEntry({content: '<pre>xml: ]]></pre>'})],
  });

  var rss = generateRss(feed);

  assert.ok(!rss.includes('<pre>xml: ]]></pre>'));
  assert.ok(rss.includes(']]]]><![CDATA[>'));
});
