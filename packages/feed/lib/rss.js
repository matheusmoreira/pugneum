const makeError = require('pugneum-error');
const {escapeXml, escapeCdata} = require('./xml');

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
      '      <pubDate>' + escapeXml(toRFC822(entry.published, feed.buildDate)) + '</pubDate>',
      entry.summary
        ? '      <description>' + escapeXml(entry.summary) + '</description>'
        : null,
      '      <content:encoded><![CDATA[' +
        escapeCdata(entry.content) +
        ']]></content:encoded>',
      '      <dc:creator>' + escapeXml(entry.author) + '</dc:creator>',
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
    '    <lastBuildDate>' + escapeXml(feedLastBuildDate(feed)) + '</lastBuildDate>',
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

function feedLastBuildDate(feed) {
  if (feed.entries.length > 0) {
    return toRFC822(feed.entries[0].published, feed.buildDate);
  }
  if (feed.updated) {
    return toRFC822(feed.updated, feed.buildDate);
  }
  return new Date(feed.buildDate).toUTCString();
}

function toRFC822(dateStr, fallback) {
  if (!dateStr) return new Date(fallback || Date.now()).toUTCString();
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
    ? dateStr + 'T00:00:00Z'
    : dateStr;
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return new Date(fallback || Date.now()).toUTCString();
  return d.toUTCString();
}
