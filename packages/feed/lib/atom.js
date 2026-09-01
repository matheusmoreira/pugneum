const {escapeXml} = require('./xml');
const {prepareFeed} = require('./model');

function generateAtom(feed) {
  return Array.from(atomChunks(feed)).join('');
}

generateAtom.chunks = atomChunks;
module.exports = generateAtom;

function atomChunks(feed) {
  return serializeAtom(prepareFeed(feed, 'atom'));
}

function* serializeAtom(feed) {
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
    '  <link href="' +
      escapeXml(feed.atomUrl || feed.url + feed.atomPath) +
      '" rel="self"/>',
    '  <id>' + escapeXml(feed.url) + '</id>',
    '  <updated>' +
      escapeXml(new Date(feed.updatedEpoch).toISOString()) +
      '</updated>',
  );
  if (feed.author) {
    lines.push(
      '  <author>',
      '    <name>' + escapeXml(feed.author) + '</name>',
      '  </author>',
    );
  }
  lines.push('  <generator>pugneum-feed</generator>');

  yield lines.join('\n') + '\n';
  for (let i = 0; i < feed.entries.length; i++) {
    yield atomEntry(feed.entries[i]) + '\n';
  }
  yield '</feed>\n';
}

function atomEntry(entry) {
  const timestamp = new Date(entry.publishedEpoch).toISOString();

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
