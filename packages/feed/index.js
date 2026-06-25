const path = require('path');
const fs = require('fs');
const htmlparser2 = require('htmlparser2');
const DomUtils = htmlparser2.DomUtils;
const makeError = require('pugneum-error');
const extract = require('./lib/extract');
const generateAtom = require('./lib/atom');
const generateRss = require('./lib/rss');

// Feed errors are filesystem/config failures with no source-template location,
// so they all share an empty location object (the project convention, also used
// by the loader). This wrapper keeps that single decision in one place.
function feedError(code, message) {
  return makeError(code, message, {line: 0, column: 0, filename: ''});
}

// Security boundary: a resolved path must stay inside an allowed base directory.
// Reject classic `..` escapes and the sibling-prefix trap (`/out` vs `/out-evil`)
// via the trailing path.sep. Stated once and called for each path we touch.
function assertWithin(baseResolved, candidatePath, message) {
  const resolved = path.resolve(candidatePath);
  if (!resolved.startsWith(baseResolved + path.sep)) {
    throw feedError('FEED_PATH_TRAVERSAL', message);
  }
  return resolved;
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

  // Phase 1: Extract feed-level metadata from index page
  const indexData = extract.indexPage(path.join(outputDir, indexFile));

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
  if (!isAbsoluteUrl(url)) {
    throw feedError(
      'FEED_INVALID_URL',
      'Site base URL must be absolute (include a scheme and host), got: ' +
        url +
        '\n    Use an absolute <base href="https://example.com/"> or set feeds.url in pugneum.json.',
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
    assertWithin(
      resolvedOutputDir,
      articlePath,
      'Article href escapes output directory: ' + entry.href,
    );

    if (!fs.existsSync(articlePath) && fs.existsSync(articlePath + '.html')) {
      articlePath += '.html';
    }

    if (!fs.existsSync(articlePath)) {
      throw feedError(
        'FEED_ARTICLE_NOT_FOUND',
        'Article not found: ' +
          entry.href +
          '\n    resolved to: ' +
          articlePath,
      );
    }

    // Guard against directories
    if (!fs.statSync(articlePath).isFile()) {
      throw feedError(
        'FEED_ARTICLE_NOT_FOUND',
        'Article path is not a file: ' + entry.href,
      );
    }

    const articleData = extract.articlePage(articlePath, tagName);

    entries.push({
      url: new URL(entry.href, url).href,
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
  assertWithin(
    resolvedWriteDir,
    path.join(writeDir, atomPath),
    'Feed output path escapes write directory',
  );
  assertWithin(
    resolvedWriteDir,
    path.join(writeDir, rssPath),
    'Feed output path escapes write directory',
  );

  fs.writeFileSync(path.join(writeDir, atomPath), atom, {encoding: 'utf8'});
  fs.writeFileSync(path.join(writeDir, rssPath), rss, {encoding: 'utf8'});
};

module.exports.resolveRelativeUrls = resolveRelativeUrls;

// True only for URLs with both a scheme and an authority (host). Path-only
// ("/blog/") and protocol-relative ("//cdn/") values are rejected.
function isAbsoluteUrl(value) {
  try {
    const parsed = new URL(value);
    return Boolean(parsed.protocol && parsed.host);
  } catch (e) {
    return false;
  }
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
