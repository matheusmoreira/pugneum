const fs = require('fs');
const path = require('path');
const makeError = require('pugneum-error');
const createRootedFilesystem = require('pugneum-filesystem');
const filesystemErrors = createRootedFilesystem.ERROR_CODES;
const extract = require('./lib/extract');
const generateAtom = require('./lib/atom');
const feedError = require('./lib/error');
const generateRss = require('./lib/rss');

function invalidOptions(message) {
  throw feedError('FEED_INVALID_OPTIONS', 'Invalid feed options: ' + message);
}

function isOptionsObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateOptionalString(value, field) {
  if (value !== undefined && typeof value !== 'string') {
    invalidOptions(field + ' must be a string when provided');
  }
}

function validatePathString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    invalidOptions(field + ' must be a non-empty string');
  }
  if (value.includes('\0')) {
    invalidOptions(field + ' must not contain a null byte');
  }
}

function canonicalDestination(writeDirectory, outputPath) {
  const destination = path.resolve(writeDirectory, outputPath);
  return process.platform === 'win32' ? destination.toLowerCase() : destination;
}

// Snapshot and validate the entire public option surface before touching the
// filesystem. Accessor-backed option bags therefore cannot change meaning
// between validation and use, and disabled feeds do not hide invalid siblings.
function validateOptions(options) {
  if (!isOptionsObject(options)) {
    invalidOptions('options must be an object');
  }

  const outputDirectory = options.outputDirectory;
  const configuredWriteDirectory = options.writeDirectory;
  const configuredFeeds = options.feeds;
  const configuredCompilationContext = options.compilationContext;
  const configuredCompilationLimits = options.compilationLimits;

  validatePathString(outputDirectory, 'outputDirectory');
  if (configuredWriteDirectory !== undefined) {
    validatePathString(configuredWriteDirectory, 'writeDirectory');
  }
  if (configuredFeeds !== undefined && !isOptionsObject(configuredFeeds)) {
    invalidOptions('feeds must be an object when provided');
  }

  const feeds = configuredFeeds === undefined ? {} : configuredFeeds;
  const enabled = feeds.enabled;
  const url = feeds.url;
  const title = feeds.title;
  const author = feeds.author;
  const description = feeds.description;
  const configuredIndex = feeds.index;
  const configuredSelector = feeds.selector;
  const configuredAtom = feeds.atom;
  const configuredRss = feeds.rss;

  if (enabled !== undefined && typeof enabled !== 'boolean') {
    invalidOptions('feeds.enabled must be a boolean when provided');
  }
  validateOptionalString(url, 'feeds.url');
  validateOptionalString(title, 'feeds.title');
  validateOptionalString(author, 'feeds.author');
  validateOptionalString(description, 'feeds.description');

  const index = configuredIndex === undefined ? 'index.html' : configuredIndex;
  const selector =
    configuredSelector === undefined ? 'article' : configuredSelector;
  const atom = configuredAtom === undefined ? 'atom.xml' : configuredAtom;
  const rss = configuredRss === undefined ? 'rss.xml' : configuredRss;

  validatePathString(index, 'feeds.index');
  if (typeof selector !== 'string' || !/^\w(?:[-:\w]*\w)?$/.test(selector)) {
    invalidOptions('feeds.selector must be one element tag name');
  }
  validatePathString(atom, 'feeds.atom');
  validatePathString(rss, 'feeds.rss');

  const writeDirectory =
    configuredWriteDirectory === undefined
      ? outputDirectory
      : configuredWriteDirectory;
  if (
    canonicalDestination(writeDirectory, atom) ===
    canonicalDestination(writeDirectory, rss)
  ) {
    invalidOptions(
      'feeds.atom and feeds.rss must resolve to different destinations',
    );
  }

  let compilationContext;
  try {
    compilationContext = makeError.getCompilationContext({
      compilationContext: configuredCompilationContext,
      compilationLimits: configuredCompilationLimits,
    });
  } catch (error) {
    invalidOptions(error.message);
  }

  return {
    compilationContext,
    outputDirectory,
    writeDirectory,
    feeds: {
      enabled: enabled === undefined ? true : enabled,
      url,
      title,
      author,
      description,
      index,
      selector,
      atom,
      rss,
    },
  };
}

function cachedBoundedReader(inputFiles, compilation) {
  const cache = new Map();
  return function readFile(requestedPath, options) {
    const normalized = path.normalize(requestedPath);
    const identity =
      process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    let raw = cache.get(identity);
    if (raw === undefined) {
      try {
        raw = inputFiles.readFile(requestedPath, {
          maxBytes: compilation.remaining('sourceBytes'),
        });
      } catch (error) {
        if (error.code === filesystemErrors.LIMIT_EXCEEDED) {
          compilation.charge(
            'sourceBytes',
            error.size,
            {},
            'reading feed input ' + requestedPath,
          );
        }
        throw error;
      }
      compilation.charge(
        'sourceBytes',
        raw.length,
        {},
        'reading feed input ' + requestedPath,
      );
      cache.set(identity, raw);
    }

    const encoding =
      typeof options === 'string' ? options : options && options.encoding;
    return encoding ? raw.toString(encoding) : Buffer.from(raw);
  };
}

function boundedChunks(chunks, format, compilation) {
  return {
    *[Symbol.iterator]() {
      for (const chunk of chunks) {
        compilation.charge(
          'outputBytes',
          Buffer.byteLength(chunk, 'utf8'),
          {},
          'serializing the ' + format + ' feed',
        );
        yield chunk;
      }
    },
  };
}

function findCompilationLimit(error, seen) {
  if (error === null || typeof error !== 'object') return undefined;
  seen = seen || new Set();
  if (seen.has(error)) return undefined;
  seen.add(error);
  if (error.code === 'PUGNEUM:COMPILATION_LIMIT_EXCEEDED') return error;

  const cause = findCompilationLimit(error.cause, seen);
  if (cause) return cause;
  if (Array.isArray(error.errors)) {
    for (const nested of error.errors) {
      const found = findCompilationLimit(nested, seen);
      if (found) return found;
    }
  }
}

function isFilesystemBoundary(error, includeNonRegular) {
  return (
    error.code === filesystemErrors.PATH_ESCAPE ||
    (includeNonRegular &&
      (error.code === filesystemErrors.NOT_REGULAR_FILE ||
        error.code === filesystemErrors.NOT_DIRECTORY))
  );
}

function rethrowFilesystemBoundary(error, message, includeNonRegular) {
  if (isFilesystemBoundary(error, includeNonRegular)) {
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
  const validatedOptions = validateOptions(options);
  const feedsConfig = validatedOptions.feeds;
  const compilation = validatedOptions.compilationContext;

  if (feedsConfig.enabled === false) {
    return;
  }

  const outputDir = validatedOptions.outputDirectory;
  const writeDir = validatedOptions.writeDirectory;
  const indexFile = feedsConfig.index;
  const tagName = feedsConfig.selector;
  const atomPath = feedsConfig.atom;
  const rssPath = feedsConfig.rss;

  const inputFiles = createRootedFilesystem(outputDir);
  const readInput = cachedBoundedReader(inputFiles, compilation);

  // Phase 1: Extract feed-level metadata from a regular, no-follow index file
  // rooted beneath outputDirectory.
  let indexData;
  try {
    indexData = extract.indexPage(indexFile, readInput);
  } catch (error) {
    rethrowFilesystemBoundary(
      error,
      'Index path escapes output directory or is not a regular file: ' +
        indexFile,
      true,
    );
  }

  compilation.charge(
    'feedEntries',
    indexData.entries.length,
    {},
    'discovering feed entries',
  );

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
  const articleCache = new Map();
  function readArticle(articlePath, articleUrl) {
    const identity = articlePath + '\0' + articleUrl;
    if (!articleCache.has(identity)) {
      articleCache.set(
        identity,
        extract.articlePage(articlePath, tagName, readInput, articleUrl),
      );
    }
    return articleCache.get(identity);
  }
  for (let i = 0; i < indexData.entries.length; i++) {
    const entry = indexData.entries[i];
    const articleLocation = resolveArticleLocation(entry.href, baseUrl);
    let articlePath = articleLocation.path;
    let articleData;
    try {
      articleData = readArticle(articlePath, articleLocation.url);
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
        articleData = readArticle(fallbackPath, articleLocation.url);
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
      content: articleData.content,
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

  // Construct both serializers before filesystem work so their eager
  // validation still fails before output setup. Their chunks are consumed one
  // format at a time while the transaction stages its temporary siblings.
  const atomChunks = boundedChunks(
    generateAtom.chunks(feed),
    'Atom',
    compilation,
  );
  const rssChunks = boundedChunks(generateRss.chunks(feed), 'RSS', compilation);

  try {
    fs.mkdirSync(writeDir, {recursive: true});
    const outputFiles = createRootedFilesystem(writeDir);

    // Create each contained parent chain without following symlinks. The batch
    // writer then preflights both final names, stages and syncs both documents,
    // and keeps rollback links until every final rename has committed.
    outputFiles.ensureDirectory(path.dirname(atomPath));
    outputFiles.ensureDirectory(path.dirname(rssPath));
    outputFiles.writeFilesTransaction([
      {path: atomPath, chunks: atomChunks, options: {encoding: 'utf8'}},
      {path: rssPath, chunks: rssChunks, options: {encoding: 'utf8'}},
    ]);
  } catch (error) {
    const compilationLimit = findCompilationLimit(error);
    if (compilationLimit) throw compilationLimit;
    if (isFilesystemBoundary(error, true)) {
      rethrowFilesystemBoundary(
        error,
        'Feed output path escapes write directory or is not a regular file',
        true,
      );
    }
    const failedOutput =
      error.code === filesystemErrors.WRITE_FAILED && error.path
        ? error.path
        : writeDir;
    throw feedError(
      'FEED_WRITE_FAILED',
      'Could not publish feed output: ' + failedOutput,
    );
  }
};

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
