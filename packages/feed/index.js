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
  var resolvedOutputDir = path.resolve(outputDir);
  var entries = [];
  for (var i = 0; i < indexData.entries.length; i++) {
    var entry = indexData.entries[i];
    var articlePath = path.join(outputDir, entry.href);

    // Prevent path traversal: article path must stay within output directory
    var resolvedArticle = path.resolve(articlePath);
    if (
      resolvedArticle !== resolvedOutputDir &&
      !resolvedArticle.startsWith(resolvedOutputDir + path.sep)
    ) {
      throw makeError(
        'FEED_PATH_TRAVERSAL',
        'Article href escapes output directory: ' + entry.href,
        {line: 0},
      );
    }

    if (!fs.existsSync(articlePath) && fs.existsSync(articlePath + '.html')) {
      articlePath += '.html';
    }

    if (!fs.existsSync(articlePath)) {
      throw makeError(
        'FEED_ARTICLE_NOT_FOUND',
        'Article not found: ' +
          entry.href +
          '\n    resolved to: ' +
          articlePath,
        {line: 0},
      );
    }

    var articleData = extract.articlePage(articlePath, selector);

    entries.push({
      url: url + entry.href.replace(/^\//, ''),
      title: articleData.title || entry.title,
      published: entry.published,
      summary: articleData.description,
      author: articleData.author || author,
      content: resolveRelativeUrls(articleData.content, url),
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

  // Prevent path traversal: feed output paths must stay within write directory
  var resolvedWriteDir = path.resolve(writeDir);
  var resolvedAtom = path.resolve(path.join(writeDir, atomPath));
  var resolvedRss = path.resolve(path.join(writeDir, rssPath));
  if (
    !resolvedAtom.startsWith(resolvedWriteDir + path.sep) ||
    !resolvedRss.startsWith(resolvedWriteDir + path.sep)
  ) {
    throw makeError(
      'FEED_PATH_TRAVERSAL',
      'Feed output path escapes write directory',
      {line: 0},
    );
  }

  fs.writeFileSync(path.join(writeDir, atomPath), atom, {encoding: 'utf8'});
  fs.writeFileSync(path.join(writeDir, rssPath), rss, {encoding: 'utf8'});
};

function resolveRelativeUrls(html, baseUrl) {
  return html
    .replace(/(<a\s[^>]*href=")\/([^"]*")/g, '$1' + baseUrl + '$2')
    .replace(/(<img\s[^>]*src=")\/([^"]*")/g, '$1' + baseUrl + '$2')
    .replace(/(<source\s[^>]*src=")\/([^"]*")/g, '$1' + baseUrl + '$2');
}
