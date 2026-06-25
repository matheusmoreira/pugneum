const makeError = require('pugneum-error');
const {escapeXml, escapeCdata} = require('./xml');
const {parseDate, feedTimestamp} = require('./date');

module.exports = function generateRss(feed) {
  if (!feed.description) {
    throw makeError(
      'FEED_MISSING_DESCRIPTION',
      'RSS requires a channel description. Add a <meta name="description"> to your index page or set feeds.description in pugneum.json.',
      {line: 0, column: 0, filename: ''},
    );
  }

  const items = feed.entries.map((entry) => {
    return [
      '    <item>',
      '      <title>' + escapeXml(entry.title) + '</title>',
      '      <link>' + escapeXml(entry.url) + '</link>',
      '      <guid isPermaLink="true">' + escapeXml(entry.url) + '</guid>',
      '      <pubDate>' +
        escapeXml(toRFC822(entry.published, feed.buildDate)) +
        '</pubDate>',
      entry.summary
        ? '      <description>' + escapeXml(entry.summary) + '</description>'
        : null,
      '      <content:encoded><![CDATA[' +
        escapeCdata(entry.content) +
        ']]></content:encoded>',
      '      <dc:creator>' + escapeXml(entry.author) + '</dc:creator>',
      categoryLines(entry.keywords, '      '),
      '    </item>',
    ]
      .filter((line) => line !== null)
      .join('\n');
  });

  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    '    <title>' + escapeXml(feed.title) + '</title>',
    '    <link>' + escapeXml(feed.url) + '</link>',
    '    <description>' + escapeXml(feed.description) + '</description>',
  ];

  if (feed.language) {
    lines.push('    <language>' + escapeXml(feed.language) + '</language>');
  }

  lines.push(
    '    <lastBuildDate>' +
      escapeXml(feedTimestamp(feed).toUTCString()) +
      '</lastBuildDate>',
    '    <generator>pugneum-feed</generator>',
    '    <atom:link href="' +
      escapeXml(feed.url + feed.rssPath) +
      '" rel="self" type="application/rss+xml"/>',
  );

  for (let i = 0; i < items.length; i++) {
    lines.push(items[i]);
  }

  lines.push('  </channel>', '</rss>', '');

  return lines.join('\n');
};

function toRFC822(dateStr, fallback) {
  return parseDate(dateStr, fallback).toUTCString();
}

// Emit one <category> per keyword (RSS 2.0), or null when there are none so the
// surrounding .filter() drops the line.
function categoryLines(keywords, indent) {
  if (!keywords || keywords.length === 0) {
    return null;
  }
  return keywords
    .map((kw) => indent + '<category>' + escapeXml(kw) + '</category>')
    .join('\n');
}
