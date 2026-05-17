const {escapeXml} = require('./xml');

module.exports = function generateAtom(feed) {
  const entries = feed.entries.map((entry) => {
    return [
      '  <entry>',
      '    <title>' + escapeXml(entry.title) + '</title>',
      '    <link href="' + escapeXml(entry.url) + '" rel="alternate"/>',
      '    <id>' + escapeXml(entry.url) + '</id>',
      '    <published>' + escapeXml(toISO8601(entry.published)) + '</published>',
      '    <updated>' + escapeXml(toISO8601(entry.published)) + '</updated>',
      entry.summary
        ? '    <summary>' + escapeXml(entry.summary) + '</summary>'
        : null,
      '    <content type="html">' + escapeXml(entry.content) + '</content>',
      '    <author>',
      '      <name>' + escapeXml(entry.author) + '</name>',
      '    </author>',
      '  </entry>',
    ]
      .filter((line) => line !== null)
      .join('\n');
  });

  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    '  <title>' + escapeXml(feed.title) + '</title>',
  ];

  if (feed.description) {
    lines.push('  <subtitle>' + escapeXml(feed.description) + '</subtitle>');
  }

  lines.push(
    '  <link href="' + escapeXml(feed.url) + '" rel="alternate"/>',
    '  <link href="' + escapeXml(feed.url + feed.atomPath) + '" rel="self"/>',
    '  <id>' + escapeXml(feed.url) + '</id>',
    '  <updated>' + feedUpdated(feed) + '</updated>',
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

function feedUpdated(feed) {
  if (feed.entries.length > 0) {
    return escapeXml(toISO8601(feed.entries[0].published));
  }
  if (feed.updated) {
    return escapeXml(toISO8601(feed.updated));
  }
  return new Date().toISOString();
}

function toISO8601(dateStr) {
  if (!dateStr) return new Date().toISOString();
  if (dateStr.includes('T')) return dateStr;
  return dateStr + 'T00:00:00Z';
}
