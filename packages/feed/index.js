var path = require('path');
var fs = require('fs');
var makeError = require('pugneum-error');
var extract = require('./lib/extract');
var generateAtom = require('./lib/atom');
var generateRss = require('./lib/rss');

module.exports = function generateFeeds(options) {
  var feedsConfig = options.feeds || {};

  if (feedsConfig.enabled === false) {
    return;
  }

  var outputDir = options.outputDirectory;
  var writeDir = options.writeDirectory || outputDir;
  var indexFile = feedsConfig.index || 'index.html';
  var selector = feedsConfig.selector || 'article';
  var atomPath = feedsConfig.atom || 'atom.xml';
  var rssPath = feedsConfig.rss || 'rss.xml';

  // Phase 1: Extract feed-level metadata from index page
  var indexData = extract.indexPage(path.join(outputDir, indexFile));

  // Resolve metadata: config overrides HTML
  var url = feedsConfig.url || indexData.url;
  var title = feedsConfig.title || indexData.title;
  var author = feedsConfig.author || indexData.author;
  var description = feedsConfig.description || indexData.description;
  var language = indexData.language;

  if (!url) {
    throw makeError(
      'FEED_MISSING_URL',
      'Could not determine site base URL. Add a <base href="..."> tag to your index page or set feeds.url in pugneum.json.',
      {line: 0},
    );
  }

  // Ensure URL ends with /
  if (!url.endsWith('/')) {
    url += '/';
  }

  // Phase 2: Enrich entries from article pages
  var entries = [];
  for (var i = 0; i < indexData.entries.length; i++) {
    var entry = indexData.entries[i];
    var articlePath = path.join(outputDir, entry.href);

    if (!fs.existsSync(articlePath)) {
      console.warn(
        'pugneum-feed: article not found, skipping: ' + entry.href,
      );
      continue;
    }

    var articleData = extract.articlePage(articlePath, selector);

    entries.push({
      url: url + entry.href,
      title: articleData.title || entry.title,
      published: entry.published,
      summary: articleData.description,
      author: articleData.author || author,
      content: articleData.content,
      keywords: articleData.keywords,
    });
  }

  // Build feed data
  var feed = {
    url: url,
    title: title,
    description: description,
    author: author,
    language: language,
    entries: entries,
    atomPath: atomPath,
    rssPath: rssPath,
  };

  // Generate and write feeds
  var atom = generateAtom(feed);
  var rss = generateRss(feed);

  fs.mkdirSync(writeDir, {recursive: true});
  fs.writeFileSync(path.join(writeDir, atomPath), atom, {encoding: 'utf8'});
  fs.writeFileSync(path.join(writeDir, rssPath), rss, {encoding: 'utf8'});
};
