var assert = require('node:assert/strict');
var {test} = require('node:test');
var generateAtom = require('../lib/atom');

test('generates valid Atom feed', (t) => {
  var feed = {
    url: 'https://example.com/',
    title: 'Test Site',
    description: 'A test site',
    author: 'Test Author',
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
    atomPath: 'atom.xml',
  };

  var xml = generateAtom(feed);

  t.assert.snapshot(xml);
});

test('chunked Atom serialization is byte-identical and entry-bounded', () => {
  var feed = {
    url: 'https://example.com/',
    title: 'Test Site',
    description: 'A test site',
    author: 'Test Author',
    entries: [
      {
        url: 'https://example.com/first',
        title: 'First',
        published: '2026-01-02',
        author: 'A',
        content: '<p>first</p>',
      },
      {
        url: 'https://example.com/second',
        title: 'Second',
        published: '2026-01-01',
        author: 'B',
        content: '<p>second</p>',
      },
    ],
    atomPath: 'atom.xml',
    buildDate: '2026-01-03T00:00:00Z',
  };

  var chunks = Array.from(generateAtom.chunks(feed));

  assert.strictEqual(chunks.join(''), generateAtom(feed));
  assert.strictEqual(chunks.length, feed.entries.length + 2);
  assert.ok(!chunks[0].includes('<entry>'));
  assert.ok(chunks[1].includes('<id>https://example.com/first</id>'));
  assert.ok(chunks[2].includes('<id>https://example.com/second</id>'));
  assert.strictEqual(chunks[3], '</feed>\n');
});

test('date-only published is pinned to midnight UTC', () => {
  var feed = {
    url: 'https://example.com/',
    title: 'T',
    description: 'd',
    author: 'A',
    entries: [
      {
        url: 'https://example.com/p',
        title: 'P',
        published: '2026-03-15',
        author: 'A',
        content: '<p>x</p>',
      },
    ],
    atomPath: 'atom.xml',
    buildDate: '2026-01-01T00:00:00.000Z',
  };

  var xml = generateAtom(feed);

  assert.ok(xml.includes('<published>2026-03-15T00:00:00.000Z</published>'));
});

test('zoneless datetime is interpreted as UTC, not local time', () => {
  // A datetime with no timezone designator must be treated as UTC so the feed
  // is reproducible regardless of the build machine's timezone. With local-time
  // parsing the emitted instant would shift by the host offset.
  var feed = {
    url: 'https://example.com/',
    title: 'T',
    description: 'd',
    author: 'A',
    entries: [
      {
        url: 'https://example.com/p',
        title: 'P',
        published: '2026-03-15T10:30:00',
        author: 'A',
        content: '<p>x</p>',
      },
    ],
    atomPath: 'atom.xml',
    buildDate: '2026-01-01T00:00:00.000Z',
  };

  var xml = generateAtom(feed);

  assert.ok(xml.includes('<published>2026-03-15T10:30:00.000Z</published>'));
});

test('invalid date string falls back to buildDate', () => {
  var feed = {
    url: 'https://example.com/',
    title: 'Test',
    description: 'desc',
    author: 'Author',
    entries: [
      {
        url: 'https://example.com/post',
        title: 'Post',
        published: 'not-a-date',
        author: 'Author',
        content: '<p>Content</p>',
      },
    ],
    atomPath: 'atom.xml',
    buildDate: '2026-01-15T12:00:00.000Z',
  };

  var xml = generateAtom(feed);

  // The invalid date must fall back to buildDate, not produce "Invalid Date"
  assert.ok(!xml.includes('Invalid Date'));
  assert.ok(xml.includes('2026-01-15T12:00:00.000Z'));
});

test('feed language is emitted as xml:lang on the root', () => {
  var feed = {
    url: 'https://example.com/',
    title: 'T',
    description: 'd',
    author: 'A',
    language: 'en',
    entries: [],
    atomPath: 'atom.xml',
    buildDate: '2026-01-01T00:00:00Z',
  };

  var xml = generateAtom(feed);

  assert.ok(
    xml.includes('<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">'),
  );
});

test('entry keywords are emitted as Atom categories', () => {
  var feed = {
    url: 'https://example.com/',
    title: 'T',
    description: 'd',
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
    atomPath: 'atom.xml',
    buildDate: '2026-01-01T00:00:00Z',
  };

  var xml = generateAtom(feed);

  assert.ok(xml.includes('<category term="alpha"/>'));
  assert.ok(xml.includes('<category term="beta"/>'));
});

test('generates valid Atom feed with no entries', (t) => {
  // With no entries the feed-level <updated> comes from buildDate (the
  // production caller always sets buildDate and never sets `updated`).
  var feed = {
    url: 'https://example.com/',
    title: 'Empty Site',
    description: 'No articles yet',
    author: 'Test Author',
    entries: [],
    atomPath: 'atom.xml',
    buildDate: '2026-01-01T00:00:00Z',
  };

  var xml = generateAtom(feed);

  t.assert.snapshot(xml);
});

test('empty feed with no buildDate does not emit "Invalid Date"', () => {
  var feed = {
    url: 'https://example.com/',
    title: 'Empty Site',
    description: 'No articles yet',
    author: 'Test Author',
    entries: [],
    atomPath: 'atom.xml',
  };

  var xml = generateAtom(feed);

  // The empty-feed branch must reuse the guarded date fallback, never leak the
  // literal "Invalid Date" string nor emit an empty <updated> element.
  assert.ok(!xml.includes('Invalid Date'));
  assert.doesNotMatch(xml, /<updated><\/updated>/);
});
