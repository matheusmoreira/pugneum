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

test('generates valid Atom feed with no entries', (t) => {
  var feed = {
    url: 'https://example.com/',
    title: 'Empty Site',
    description: 'No articles yet',
    author: 'Test Author',
    entries: [],
    atomPath: 'atom.xml',
    updated: '2026-01-01',
  };

  var xml = generateAtom(feed);

  t.assert.snapshot(xml);
});
