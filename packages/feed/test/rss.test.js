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

test('generates valid RSS feed with no entries', (t) => {
  var feed = {
    url: 'https://example.com/',
    title: 'Empty Site',
    description: 'No articles yet',
    author: 'Test Author',
    language: 'en',
    entries: [],
    rssPath: 'rss.xml',
    updated: '2026-01-01',
  };

  var xml = generateRss(feed);

  t.assert.snapshot(xml);
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
