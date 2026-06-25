const {escapeXml} = require('./xml');
const {parseDate, feedTimestamp} = require('./date');

module.exports = function generateAtom(feed) {
  const entries = feed.entries.map((entry) => {
    const timestamp = toISO8601(entry.published, feed.buildDate);
    return [
      '  <entry>',
      '    <title>' + escapeXml(entry.title) + '</title>',
      '    <link href="' + escapeXml(entry.url) + '" rel="alternate"/>',
      '    <id>' + escapeXml(entry.url) + '</id>',
      '    <published>' + escapeXml(timestamp) + '</published>',
      '    <updated>' + escapeXml(timestamp) + '</updated>',
      entry.summary
        ? '    <summary>' + escapeXml(entry.summary) + '</summary>'
        : null,
      '    <content type="html">' + escapeXml(entry.content) + '</content>',
      '    <author>',
      '      <name>' + escapeXml(entry.author) + '</name>',
      '    </author>',
      categoryLines(entry.keywords, '    '),
      '  </entry>',
    ]
      .filter((line) => line !== null)
      .join('\n');
  });

  // Carry the language as xml:lang on the root, mirroring RSS's <language>.
  const langAttr = feed.language
    ? ' xml:lang="' + escapeXml(feed.language) + '"'
    : '';

  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom"' + langAttr + '>',
    '  <title>' + escapeXml(feed.title) + '</title>',
  ];

  if (feed.description) {
    lines.push('  <subtitle>' + escapeXml(feed.description) + '</subtitle>');
  }

  lines.push(
    '  <link href="' + escapeXml(feed.url) + '" rel="alternate"/>',
    '  <link href="' + escapeXml(feed.url + feed.atomPath) + '" rel="self"/>',
    '  <id>' + escapeXml(feed.url) + '</id>',
    '  <updated>' + escapeXml(feedTimestamp(feed).toISOString()) + '</updated>',
    '  <author>',
    '    <name>' + escapeXml(feed.author) + '</name>',
    '  </author>',
    '  <generator>pugneum-feed</generator>',
  );

  for (let i = 0; i < entries.length; i++) {
    lines.push(entries[i]);
  }

  lines.push('</feed>', '');

  return lines.join('\n');
};

function toISO8601(dateStr, fallback) {
  return parseDate(dateStr, fallback).toISOString();
}

// Emit one <category term="..."/> per keyword (Atom 1.0 §4.2.2), or null when
// there are none so the surrounding .filter() drops the line.
function categoryLines(keywords, indent) {
  if (!keywords || keywords.length === 0) {
    return null;
  }
  return keywords
    .map((kw) => indent + '<category term="' + escapeXml(kw) + '"/>')
    .join('\n');
}
