var fs = require('fs');
var os = require('os');
var path = require('path');

function temporaryDirectory(t, prefix) {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  return directory;
}

function temporaryHtml(t, prefix, content) {
  var directory = temporaryDirectory(t, prefix);
  var filename = path.join(directory, 'fixture.html');
  fs.writeFileSync(filename, content);
  return filename;
}

function makeEntry(overrides) {
  return Object.assign(
    {
      url: 'https://example.com/post',
      title: 'Post',
      published: '2026-01-01',
      author: 'Author',
      content: '<p>Content</p>',
    },
    overrides,
  );
}

function makeFeed(format, overrides) {
  var feed = {
    url: 'https://example.com/',
    title: 'Test',
    description: 'A test feed',
    author: 'Author',
    entries: [],
    buildDate: '2026-01-01T00:00:00Z',
  };
  feed[format + 'Path'] = format + '.xml';
  return Object.assign(feed, overrides);
}

function makeAtomFeed(overrides) {
  return makeFeed('atom', overrides);
}

function makeRssFeed(overrides) {
  return makeFeed('rss', overrides);
}

exports.temporaryDirectory = temporaryDirectory;
exports.temporaryHtml = temporaryHtml;
exports.makeEntry = makeEntry;
exports.makeAtomFeed = makeAtomFeed;
exports.makeRssFeed = makeRssFeed;
