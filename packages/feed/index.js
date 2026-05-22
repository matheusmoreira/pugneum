const path = require('path');
const fs = require('fs');
const makeError = require('pugneum-error');
const extract = require('./lib/extract');
const generateAtom = require('./lib/atom');
const generateRss = require('./lib/rss');

module.exports = function generateFeeds(options) {
  const feedsConfig = options.feeds || {};

  if (feedsConfig.enabled === false) {
    return;
  }

  const outputDir = options.outputDirectory;
  const writeDir = options.writeDirectory || outputDir;
  const indexFile = feedsConfig.index || 'index.html';
  const tagName = feedsConfig.selector || 'article';
  const atomPath = feedsConfig.atom || 'atom.xml';
  const rssPath = feedsConfig.rss || 'rss.xml';

  // Phase 1: Extract feed-level metadata from index page
  const indexData = extract.indexPage(path.join(outputDir, indexFile));

  // Resolve metadata: config overrides HTML
  let url = feedsConfig.url || indexData.url;
  const title = feedsConfig.title || indexData.title;
  const author = feedsConfig.author || indexData.author;
  const description = feedsConfig.description || indexData.description;
  const language = indexData.language;

  if (!url) {
    throw makeError(
      'FEED_MISSING_URL',
      'Could not determine site base URL. Add a <base href="..."> tag to your index page or set feeds.url in pugneum.json.',
      {line: 0, column: 0, filename: ''},
    );
  }

  // Ensure URL ends with /
  if (!url.endsWith('/')) {
    url += '/';
  }

  // Phase 2: Enrich entries from article pages
  const resolvedOutputDir = path.resolve(outputDir);
  const entries = [];
  for (let i = 0; i < indexData.entries.length; i++) {
    const entry = indexData.entries[i];
    let articlePath = path.join(outputDir, entry.href);

    // Prevent path traversal: article path must stay within output directory
    const resolvedArticle = path.resolve(articlePath);
    if (!resolvedArticle.startsWith(resolvedOutputDir + path.sep)) {
      throw makeError(
        'FEED_PATH_TRAVERSAL',
        'Article href escapes output directory: ' + entry.href,
        {line: 0, column: 0, filename: ''},
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
        {line: 0, column: 0, filename: ''},
      );
    }

    // Guard against directories
    if (!fs.statSync(articlePath).isFile()) {
      throw makeError(
        'FEED_ARTICLE_NOT_FOUND',
        'Article path is not a file: ' + entry.href,
        {line: 0, column: 0, filename: ''},
      );
    }

    const articleData = extract.articlePage(articlePath, tagName);

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
  const buildDate = new Date().toISOString();
  const feed = {
    url: url,
    title: title,
    description: description,
    author: author,
    language: language,
    entries: entries,
    atomPath: atomPath,
    rssPath: rssPath,
    buildDate: buildDate,
  };

  // Generate and write feeds
  const atom = generateAtom(feed);
  const rss = generateRss(feed);

  fs.mkdirSync(writeDir, {recursive: true});

  // Prevent path traversal: feed output paths must stay within write directory
  const resolvedWriteDir = path.resolve(writeDir);
  const resolvedAtom = path.resolve(path.join(writeDir, atomPath));
  const resolvedRss = path.resolve(path.join(writeDir, rssPath));
  if (
    !resolvedAtom.startsWith(resolvedWriteDir + path.sep) ||
    !resolvedRss.startsWith(resolvedWriteDir + path.sep)
  ) {
    throw makeError(
      'FEED_PATH_TRAVERSAL',
      'Feed output path escapes write directory',
      {line: 0, column: 0, filename: ''},
    );
  }

  fs.writeFileSync(path.join(writeDir, atomPath), atom, {encoding: 'utf8'});
  fs.writeFileSync(path.join(writeDir, rssPath), rss, {encoding: 'utf8'});
};

module.exports.resolveRelativeUrls = resolveRelativeUrls;

function resolveRelativeUrls(html, baseUrl) {
  const escaped = baseUrl.replace(/\$/g, '$$$$');
  const resolve = (attr) =>
    new RegExp('(<(?:a|img|source|video|audio|iframe)\\s[^>]*' + attr + '=")\/(?!\/)([^"]*")', 'g');
  return html
    .replace(resolve('href'), '$1' + escaped + '$2')
    .replace(resolve('src'), '$1' + escaped + '$2')
    .replace(resolve('poster'), '$1' + escaped + '$2');
}
