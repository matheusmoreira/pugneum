var assert = require('node:assert/strict');
var {test} = require('node:test');
var generateAtom = require('../lib/atom');
var {makeAtomFeed, makeEntry} = require('./helpers');
var {assertValidAtom} = require('./validate');

test('generates valid Atom feed', (t) => {
  var feed = makeAtomFeed({
    title: 'Test Site',
    description: 'A test site',
    author: 'Test Author',
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

  var xml = generateAtom(feed);

  assertValidAtom(xml, {selfUrl: 'https://example.com/atom.xml'});
  t.assert.snapshot(xml);
});

test('chunked Atom serialization is byte-identical and entry-bounded', () => {
  var feed = makeAtomFeed({
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

  var chunks = Array.from(generateAtom.chunks(feed));

  assert.strictEqual(chunks.join(''), generateAtom(feed));
  assert.strictEqual(chunks.length, feed.entries.length + 2);
  assert.ok(!chunks[0].includes('<entry>'));
  assert.ok(chunks[1].includes('<id>https://example.com/first</id>'));
  assert.ok(chunks[2].includes('<id>https://example.com/second</id>'));
  assert.strictEqual(chunks[3], '</feed>\n');
});

test('date-only published is pinned to midnight UTC', () => {
  var feed = makeAtomFeed({
    entries: [makeEntry({published: '2026-03-15'})],
  });

  var xml = generateAtom(feed);

  assert.ok(xml.includes('<published>2026-03-15T00:00:00.000Z</published>'));
});

test('zoneless datetime is interpreted as UTC, not local time', () => {
  // A datetime with no timezone designator must be treated as UTC so the feed
  // is reproducible regardless of the build machine's timezone. With local-time
  // parsing the emitted instant would shift by the host offset.
  var feed = makeAtomFeed({
    entries: [makeEntry({published: '2026-03-15T10:30:00'})],
  });

  var xml = generateAtom(feed);

  assert.ok(xml.includes('<published>2026-03-15T10:30:00.000Z</published>'));
});

test('invalid date string falls back to buildDate', () => {
  var feed = makeAtomFeed({
    entries: [makeEntry({published: 'not-a-date'})],
    buildDate: '2026-01-15T12:00:00.000Z',
  });

  var xml = generateAtom(feed);

  // The invalid date must fall back to buildDate, not produce "Invalid Date"
  assert.ok(!xml.includes('Invalid Date'));
  assert.ok(xml.includes('2026-01-15T12:00:00.000Z'));
});

test('feed language is emitted as xml:lang on the root', () => {
  var xml = generateAtom(makeAtomFeed({language: 'en'}));

  assert.ok(
    xml.includes('<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">'),
  );
});

test('entry keywords are emitted as Atom categories', () => {
  var feed = makeAtomFeed({
    entries: [makeEntry({keywords: ['alpha', 'beta']})],
  });

  var xml = generateAtom(feed);

  assert.ok(xml.includes('<category term="alpha"/>'));
  assert.ok(xml.includes('<category term="beta"/>'));
});

test('generates valid Atom feed with no entries', (t) => {
  // With no entries the feed-level <updated> comes from buildDate.
  var feed = makeAtomFeed({
    title: 'Empty Site',
    description: 'No articles yet',
    author: 'Test Author',
  });

  var xml = generateAtom(feed);

  assertValidAtom(xml, {selfUrl: 'https://example.com/atom.xml'});
  t.assert.snapshot(xml);
});

test('custom Atom self links remain valid', () => {
  var feed = makeAtomFeed({
    title: 'T',
    description: undefined,
    author: 'A',
    atomPath: 'ignored.xml',
    atomUrl: 'https://feeds.example.com/custom.atom',
  });

  assertValidAtom(generateAtom(feed), {selfUrl: feed.atomUrl});
});

test('Atom requires non-empty feed and entry titles', () => {
  [null, '   '].forEach((title) => {
    assert.throws(
      () => generateAtom(makeAtomFeed({title})),
      (error) => error.code === 'PUGNEUM:FEED_MISSING_TITLE',
    );
    assert.throws(
      () =>
        generateAtom(
          makeAtomFeed({entries: [makeEntry({title, author: 'A'})]}),
        ),
      (error) => error.code === 'PUGNEUM:FEED_MISSING_ENTRY_TITLE',
    );
  });
});

test('Atom entries inherit the feed author', () => {
  var xml = generateAtom(
    makeAtomFeed({
      author: 'Feed Author',
      entries: [makeEntry({author: null})],
    }),
  );

  assertValidAtom(xml);
  assert.strictEqual((xml.match(/<name>Feed Author<\/name>/g) || []).length, 2);
});

test('Atom permits entry authors without a feed author', () => {
  var xml = generateAtom(
    makeAtomFeed({
      author: null,
      entries: [makeEntry({author: 'Entry Author'})],
    }),
  );
  var header = xml.slice(0, xml.indexOf('  <entry>'));

  assertValidAtom(xml);
  assert.ok(!header.includes('<author>'));
  assert.ok(xml.includes('<name>Entry Author</name>'));
});

test('Atom rejects an entry with no entry or feed author', () => {
  assert.throws(
    () =>
      generateAtom(
        makeAtomFeed({
          author: null,
          entries: [makeEntry({author: '  '})],
        }),
      ),
    (error) => error.code === 'PUGNEUM:FEED_MISSING_AUTHOR',
  );
});

test('an empty Atom feed does not require or emit an author', () => {
  var xml = generateAtom(makeAtomFeed({author: null, entries: []}));

  assertValidAtom(xml);
  assert.ok(!xml.includes('<author>'));
});

test('Atom validity oracle rejects missing required structure', () => {
  var feed = makeAtomFeed({title: 'T', description: undefined, author: 'A'});
  var xml = generateAtom(feed);

  assert.throws(() =>
    assertValidAtom(xml.replace('<title>T</title>', '<title></title>')),
  );
  assert.throws(() =>
    assertValidAtom(xml.replace('<name>A</name>', '<name></name>')),
  );
  assert.throws(() => assertValidAtom(xml.replace('</feed>', '</not-feed>')));
});

test('empty feed with no buildDate uses one captured current instant', (t) => {
  var originalNow = Date.now;
  var expected = Date.parse('2026-07-08T09:10:11.012Z');
  var calls = 0;
  Date.now = function () {
    calls++;
    return expected;
  };
  t.after(() => {
    Date.now = originalNow;
  });

  var xml = generateAtom(
    makeAtomFeed({
      title: 'Empty Site',
      description: 'No articles yet',
      author: 'Test Author',
      buildDate: undefined,
    }),
  );

  assert.ok(xml.includes('<updated>2026-07-08T09:10:11.012Z</updated>'));
  assert.strictEqual(calls, 1);
});
