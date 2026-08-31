const fs = require('fs');
const path = require('path');
const htmlparser2 = require('htmlparser2');
const DomUtils = htmlparser2.DomUtils;
const makeError = require('pugneum-error');
const createRootedFilesystem = require('pugneum-filesystem');
const filesystemErrors = createRootedFilesystem.ERROR_CODES;
const extract = require('./lib/extract');
const generateAtom = require('./lib/atom');
const generateRss = require('./lib/rss');

// Feed errors are filesystem/config failures with no source-template location.
// Pass NO location: pugneum-error renders the `filename:line:column` header only
// from present parts, so an absent line/column/filename yields a clean message
// with no header. (Passing `line: 0` would push a literal "0" into the header —
// line 0 is finite but not a real source line — prefixing every message with a
// stray "0\n\n".) This wrapper keeps that single decision in one place.
function feedError(code, message) {
  return makeError(code, message, {});
}

function rethrowFilesystemBoundary(error, message, includeNonRegular) {
  if (
    error.code === filesystemErrors.PATH_ESCAPE ||
    (includeNonRegular &&
      (error.code === filesystemErrors.NOT_REGULAR_FILE ||
        error.code === filesystemErrors.NOT_DIRECTORY))
  ) {
    throw feedError('FEED_PATH_TRAVERSAL', message);
  }
  throw error;
}

function articleFilesystemPath(href) {
  // An href beginning with / is URL-root-relative, not an absolute host
  // filesystem path. Preserve that historical mapping beneath outputDirectory,
  // but never reinterpret a protocol-relative URL's authority as a local
  // directory. Query/fragment/percent-decoding separation belongs to D-02's
  // wider URL/path identity change.
  if (/^[/\\]{2}/.test(href)) {
    throw feedError(
      'FEED_PATH_TRAVERSAL',
      'Article href is not a local output path: ' + href,
    );
  }
  const articlePath = href.replace(/^[/\\]/, '');
  if (articlePath === '') {
    throw feedError(
      'FEED_ARTICLE_NOT_FOUND',
      'Article path is not a file: ' + href,
    );
  }
  return articlePath;
}

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

  const inputFiles = createRootedFilesystem(outputDir);

  // Phase 1: Extract feed-level metadata from a regular, no-follow index file
  // rooted beneath outputDirectory.
  let indexData;
  try {
    indexData = extract.indexPage(indexFile, inputFiles.readFile);
  } catch (error) {
    rethrowFilesystemBoundary(
      error,
      'Index path escapes output directory or is not a regular file: ' +
        indexFile,
      true,
    );
  }

  // Resolve metadata: config overrides HTML
  let url = feedsConfig.url || indexData.url;
  const title = feedsConfig.title || indexData.title;
  const author = feedsConfig.author || indexData.author;
  const description = feedsConfig.description || indexData.description;
  const language = indexData.language;

  if (!url) {
    throw feedError(
      'FEED_MISSING_URL',
      'Could not determine site base URL. Add a <base href="..."> tag to your index page or set feeds.url in pugneum.json.',
    );
  }

  // The base URL is the feed <id>/<link> and the origin every relative entry URL
  // resolves against. Atom <id> must be an absolute IRI and RSS guid/link must be
  // absolute URLs, so a path-only or protocol-relative base (e.g. "/blog/") would
  // produce a structurally-invalid feed. Require a real scheme + authority.
  const baseUrl = parseSiteBaseUrl(url);
  if (!baseUrl) {
    throw feedError(
      'FEED_INVALID_URL',
      'Site base URL must be absolute (include a scheme and host), got: ' +
        url +
        '\n    Use an absolute <base href="https://example.com/"> or set feeds.url in pugneum.json.',
    );
  }

  if (baseUrl.search || baseUrl.hash) {
    throw feedError(
      'FEED_INVALID_URL',
      'Site base URL must not include a query or fragment, got: ' + url,
    );
  }

  // Treat the site base as a directory URL without mutating query/fragment
  // text. URL serialisation also canonicalizes surrounding whitespace and
  // percent-encoding consistently for every downstream identity/link.
  if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';
  url = baseUrl.href;

  // Phase 2: Enrich entries from article pages
  const entries = [];
  for (let i = 0; i < indexData.entries.length; i++) {
    const entry = indexData.entries[i];
    let articlePath = articleFilesystemPath(entry.href);
    let articleData;
    try {
      articleData = extract.articlePage(
        articlePath,
        tagName,
        inputFiles.readFile,
      );
    } catch (error) {
      if (error.code === filesystemErrors.PATH_ESCAPE) {
        rethrowFilesystemBoundary(
          error,
          'Article href escapes output directory: ' + entry.href,
          false,
        );
      }
      if (error.code === filesystemErrors.NOT_REGULAR_FILE) {
        throw feedError(
          'FEED_ARTICLE_NOT_FOUND',
          'Article path is not a file: ' + entry.href,
        );
      }
      if (error.code !== 'ENOENT') throw error;

      const fallbackPath = articlePath + '.html';
      try {
        articleData = extract.articlePage(
          fallbackPath,
          tagName,
          inputFiles.readFile,
        );
        articlePath = fallbackPath;
      } catch (fallbackError) {
        if (fallbackError.code === filesystemErrors.PATH_ESCAPE) {
          rethrowFilesystemBoundary(
            fallbackError,
            'Article href escapes output directory: ' + entry.href,
            false,
          );
        }
        if (
          fallbackError.code !== 'ENOENT' &&
          fallbackError.code !== filesystemErrors.NOT_REGULAR_FILE
        ) {
          throw fallbackError;
        }
        throw feedError(
          'FEED_ARTICLE_NOT_FOUND',
          'Article not found: ' +
            entry.href +
            '\n    resolved to: ' +
            articlePath,
        );
      }
    }

    entries.push({
      url: new URL(entry.href, url).href,
      title: articleData.title || entry.title,
      published: entry.published,
      publishedEpoch: entry.publishedEpoch,
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
    atomUrl: publicFeedUrl(baseUrl, atomPath),
    rssUrl: publicFeedUrl(baseUrl, rssPath),
    buildDate: buildDate,
  };

  // Generate and write feeds
  const atom = generateAtom(feed);
  const rss = generateRss(feed);

  fs.mkdirSync(writeDir, {recursive: true});
  const outputFiles = createRootedFilesystem(writeDir);
  try {
    // Create each contained parent chain without following symlinks. Validate
    // both names before publishing either file, then repeat the same checks
    // inside each atomic write to close static check/use gaps.
    outputFiles.ensureDirectory(path.dirname(atomPath));
    outputFiles.ensureDirectory(path.dirname(rssPath));
    outputFiles.assertWritableFile(atomPath);
    outputFiles.assertWritableFile(rssPath);
    outputFiles.writeFileAtomic(atomPath, atom, {encoding: 'utf8'});
    outputFiles.writeFileAtomic(rssPath, rss, {encoding: 'utf8'});
  } catch (error) {
    rethrowFilesystemBoundary(
      error,
      'Feed output path escapes write directory or is not a regular file',
      true,
    );
  }
};

module.exports.resolveRelativeUrls = resolveRelativeUrls;

// Parse URLs with both a scheme and an authority (host). Path-only ("/blog/")
// and protocol-relative ("//cdn/") values are rejected.
function parseSiteBaseUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol && parsed.host ? parsed : null;
  } catch (e) {
    return null;
  }
}

// Output names are filesystem paths, not URL references. Encode every literal
// segment before appending it to the canonical site pathname so characters such
// as # and ? continue to name the published file rather than becoming a URL
// fragment or query.
function publicFeedUrl(baseUrl, outputPath) {
  const publicUrl = new URL(baseUrl.href);
  const encodedPath = String(outputPath)
    .split(/[\\/]/)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  publicUrl.pathname += encodedPath;
  return publicUrl.href;
}

// Attributes that carry a single resolvable URL, keyed by tag name. Mirrors the
// previous regex allow-list, but applied to exact attribute names on the parsed
// DOM so it cannot misfire on data-*/namespaced look-alikes.
const URL_ATTRS = {
  a: ['href'],
  img: ['src', 'poster'],
  source: ['src', 'poster'],
  video: ['src', 'poster'],
  audio: ['src', 'poster'],
  iframe: ['src'],
};
// Elements whose srcset (comma-separated url+descriptor list) we also resolve.
const SRCSET_TAGS = {img: true, source: true};

// Rewrite root-relative URLs ("/path") in feed content to absolute URLs against
// the feed base. Operates on the parsed DOM rather than the serialized string:
// keying on exact attribute names avoids rewriting data-href/xlink:href, handles
// single quotes and '>' in attribute values for free, resolves srcset, and has
// no quadratic-backtracking failure mode. Protocol-relative ("//host"),
// fragment, and already-absolute URLs are left untouched (only a leading single
// '/' is rewritten), preserving the documented and tested contract.
function resolveRelativeUrls(html, baseUrl) {
  const dom = htmlparser2.parseDocument(html);
  const elements = DomUtils.findAll((el) => el.attribs, dom);
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const names = URL_ATTRS[el.name];
    if (names) {
      for (let j = 0; j < names.length; j++) {
        const name = names[j];
        const value = el.attribs[name];
        if (isRootRelative(value)) {
          el.attribs[name] = resolveAgainst(value, baseUrl);
        }
      }
    }
    if (SRCSET_TAGS[el.name] && el.attribs.srcset) {
      el.attribs.srcset = resolveSrcset(el.attribs.srcset, baseUrl);
    }
  }
  // encodeEntities:'utf8' keeps XML-significant characters (& < > ") escaped
  // while leaving ordinary ASCII such as '$' verbatim, matching the previous
  // string-replacement behavior (which never re-encoded the URL).
  return DomUtils.getOuterHTML(dom.children, {encodeEntities: 'utf8'});
}

function isRootRelative(value) {
  return typeof value === 'string' && value[0] === '/' && value[1] !== '/';
}

function resolveAgainst(value, baseUrl) {
  return new URL(value, baseUrl).href;
}

// srcset is a comma-separated list of "url [descriptor]" candidates; resolve the
// url token of each candidate, leaving descriptors (1x, 200w, ...) intact.
function resolveSrcset(value, baseUrl) {
  return value
    .split(',')
    .map((candidate) => {
      const trimmed = candidate.trim();
      if (trimmed === '') return candidate;
      const space = trimmed.search(/\s/);
      const urlToken = space === -1 ? trimmed : trimmed.slice(0, space);
      const descriptor = space === -1 ? '' : trimmed.slice(space);
      if (isRootRelative(urlToken)) {
        return resolveAgainst(urlToken, baseUrl) + descriptor;
      }
      return trimmed;
    })
    .join(', ');
}
