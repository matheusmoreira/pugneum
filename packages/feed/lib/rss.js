var makeError = require('pugneum-error');

module.exports = function generateRss(feed) {
  if (!feed.description) {
    throw makeError(
      'FEED_MISSING_DESCRIPTION',
      'RSS requires a channel description. Add a <meta name="description"> to your index page or set feeds.description in pugneum.json.',
      {line: 0},
    );
  }

  var items = feed.entries.map((entry) => {
    return [
      '    <item>',
      '      <title>' + escapeXml(entry.title) + '</title>',
      '      <link>' + escapeXml(entry.url) + '</link>',
      '      <guid isPermaLink="true">' + escapeXml(entry.url) + '</guid>',
      '      <pubDate>' + toRFC822(entry.published) + '</pubDate>',
      entry.summary
        ? '      <description>' + escapeXml(entry.summary) + '</description>'
        : null,
      '      <content:encoded><![CDATA[' +
        entry.content +
        ']]></content:encoded>',
      '      <author>' + escapeXml(entry.author) + '</author>',
      '    </item>',
    ]
      .filter((line) => line !== null)
      .join('\n');
  });

  var lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    '    <title>' + escapeXml(feed.title) + '</title>',
    '    <link>' + escapeXml(feed.url) + '</link>',
    '    <description>' + escapeXml(feed.description) + '</description>',
  ];

  if (feed.language) {
    lines.push('    <language>' + escapeXml(feed.language) + '</language>');
  }

  lines.push(
    '    <lastBuildDate>' + feedLastBuildDate(feed) + '</lastBuildDate>',
    '    <generator>pugneum-feed</generator>',
    '    <atom:link href="' +
      escapeXml(feed.url + feed.rssPath) +
      '" rel="self" type="application/rss+xml"/>',
  );

  for (var i = 0; i < items.length; i++) {
    lines.push(items[i]);
  }

  lines.push('  </channel>', '</rss>', '');

  return lines.join('\n');
};

function feedLastBuildDate(feed) {
  if (feed.entries.length > 0) {
    return toRFC822(feed.entries[0].published);
  }
  if (feed.updated) {
    return toRFC822(feed.updated);
  }
  return new Date().toUTCString();
}

function toRFC822(dateStr) {
  var date = new Date(dateStr + 'T00:00:00Z');
  return date.toUTCString();
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
