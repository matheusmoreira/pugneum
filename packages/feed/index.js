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

const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const ABSOLUTE_URL_PREFIX = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const LOCAL_ARTICLE_BASE = new URL('https://pugneum.invalid/');

// An article href has two identities: its canonical public URL and the compiled
// HTML file used to enrich that entry. Resolve them together so URL-only search
// and hash components can never leak into filesystem lookup.
function resolveArticleLocation(href, baseUrl) {
  if (typeof href !== 'string') {
    throwInvalidArticleUrl(href, 'href must be a string');
  }

  let publicUrl;
  try {
    publicUrl = new URL(href, baseUrl);
  } catch (error) {
    throwInvalidArticleUrl(href, 'href is not a valid URL reference');
  }

  if (
    publicUrl.protocol !== baseUrl.protocol ||
    publicUrl.host !== baseUrl.host ||
    publicUrl.username !== baseUrl.username ||
    publicUrl.password !== baseUrl.password
  ) {
    throwInvalidArticleUrl(href, 'href must resolve to the configured site');
  }

  const rawPath = rawArticlePath(href);
  validateArticlePathSegments(rawPath, href);

  // Document-relative paths keep the historical output-root mapping even when
  // the public site is deployed below a base pathname. Root-relative and
  // same-site absolute references map their URL pathname below that same root.
  let localUrl = publicUrl;
  if (
    !URL_SCHEME.test(href) &&
    !href.startsWith('//') &&
    !href.startsWith('/')
  ) {
    localUrl = new URL(href, LOCAL_ARTICLE_BASE);
  }

  const articlePath = decodeArticlePath(localUrl.pathname, href);
  if (articlePath === '') {
    throw feedError(
      'FEED_ARTICLE_NOT_FOUND',
      'Article path is not a file: ' + href,
    );
  }

  return {path: articlePath, url: publicUrl.href};
}

function rawArticlePath(href) {
  const componentEnd = href.search(/[?#]/);
  const locator = componentEnd === -1 ? href : href.slice(0, componentEnd);

  if (URL_SCHEME.test(locator)) {
    if (!ABSOLUTE_URL_PREFIX.test(locator)) {
      throwInvalidArticleUrl(
        href,
        'an explicit scheme must use an absolute URL',
      );
    }
    const authorityStart = locator.indexOf('//') + 2;
    const pathStart = locator.indexOf('/', authorityStart);
    return pathStart === -1 ? '' : locator.slice(pathStart);
  }

  if (locator.startsWith('//')) {
    const pathStart = locator.indexOf('/', 2);
    return pathStart === -1 ? '' : locator.slice(pathStart);
  }

  return locator;
}

function validateArticlePathSegments(rawPath, href) {
  if (rawPath.includes('\\')) {
    throwArticlePathTraversal(href);
  }

  const segments = rawPath.split('/');
  for (let i = 0; i < segments.length; i++) {
    let decoded;
    try {
      decoded = decodeURIComponent(segments[i]);
    } catch (error) {
      throwInvalidArticleUrl(href, 'path contains malformed percent encoding');
    }
    if (decoded === '..' || decoded.includes('/') || decoded.includes('\\')) {
      throwArticlePathTraversal(href);
    }
    if (decoded.includes('\0')) {
      throwInvalidArticleUrl(href, 'path contains a null byte');
    }
  }
}

function decodeArticlePath(pathname, href) {
  try {
    return pathname
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/')
      .replace(/^\/+/, '');
  } catch (error) {
    throwInvalidArticleUrl(href, 'path contains malformed percent encoding');
  }
}

function throwInvalidArticleUrl(href, reason) {
  throw feedError(
    'FEED_INVALID_ARTICLE_URL',
    'Article href is not a supported local URL: ' + href + '\n    ' + reason,
  );
}

function throwArticlePathTraversal(href) {
  throw feedError(
    'FEED_PATH_TRAVERSAL',
    'Article href contains an unsafe path: ' + href,
  );
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
    const articleLocation = resolveArticleLocation(entry.href, baseUrl);
    let articlePath = articleLocation.path;
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
      url: articleLocation.url,
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

// Follow srcset's URL-token and descriptor-state boundaries rather than treating
// every comma as a separator. URL tokens may contain commas (notably data URLs),
// while a descriptor-list comma separates candidates unless it is parenthesized.
// Preserve every byte outside a root-relative URL token.
function resolveSrcset(value, baseUrl) {
  const output = [];
  let position = 0;

  while (position < value.length) {
    const prefixStart = position;
    while (
      position < value.length &&
      (isAsciiWhitespace(value[position]) || value[position] === ',')
    ) {
      position++;
    }
    output.push(value.slice(prefixStart, position));
    if (position === value.length) break;

    const urlStart = position;
    while (position < value.length && !isAsciiWhitespace(value[position])) {
      position++;
    }

    // A trailing comma belongs to candidate separation, not the URL token.
    let urlEnd = position;
    while (urlEnd > urlStart && value[urlEnd - 1] === ',') urlEnd--;
    const urlToken = value.slice(urlStart, urlEnd);
    output.push(
      isRootRelative(urlToken) ? resolveAgainst(urlToken, baseUrl) : urlToken,
      value.slice(urlEnd, position),
    );

    // Trailing URL commas already ended this candidate. Otherwise consume the
    // descriptor list through its first non-parenthesized comma.
    if (urlEnd !== position) continue;
    const descriptorStart = position;
    let parentheses = 0;
    while (position < value.length) {
      const character = value[position++];
      if (character === '(') {
        parentheses++;
      } else if (character === ')' && parentheses > 0) {
        parentheses--;
      } else if (character === ',' && parentheses === 0) {
        break;
      }
    }
    output.push(value.slice(descriptorStart, position));
  }

  return output.join('');
}

function isAsciiWhitespace(character) {
  return (
    character === '\t' ||
    character === '\n' ||
    character === '\f' ||
    character === '\r' ||
    character === ' '
  );
}
