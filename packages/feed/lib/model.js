const feedError = require('./error');
const {parseAuthoredDate} = require('./date');

const hasOwn = Function.call.bind(Object.prototype.hasOwnProperty);

function isNonemptyText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function captureBuildEpoch(configuredBuildDate) {
  if (configuredBuildDate === undefined) return Date.now();

  const parsed = parseAuthoredDate(configuredBuildDate);
  if (!parsed) {
    throw feedError(
      'FEED_INVALID_BUILD_DATE',
      'Feed build date must be a valid ISO-8601 date or datetime. Correct feeds.buildDate in pugneum.json.',
    );
  }
  return parsed.getTime();
}

function prepareFeed(feed, format) {
  if (!isNonemptyText(feed.title)) {
    throw feedError(
      'FEED_MISSING_TITLE',
      'Feed title is required. Add a non-empty <title> to the index page or set feeds.title in pugneum.json.',
    );
  }
  if (format === 'rss' && !isNonemptyText(feed.description)) {
    throw feedError(
      'FEED_MISSING_DESCRIPTION',
      'RSS requires a channel description. Add a non-empty <meta name="description"> to the index page or set feeds.description in pugneum.json.',
    );
  }

  const buildEpoch = resolveBuildEpoch(feed);
  const feedAuthor = isNonemptyText(feed.author) ? feed.author : null;
  const sourceEntries = Array.isArray(feed.entries) ? feed.entries : [];
  let newestAuthoredEpoch = null;
  const entries = sourceEntries.map((entry) => {
    if (!isNonemptyText(entry.title)) {
      throw feedError(
        'FEED_MISSING_ENTRY_TITLE',
        'Feed entry title is required' +
          (isNonemptyText(entry.url) ? ' for ' + entry.url : '') +
          '. Add a non-empty <title> to the article page or non-empty link text to the index entry.',
      );
    }

    const authoredEpoch = resolveAuthoredEpoch(entry);
    if (
      authoredEpoch !== null &&
      (newestAuthoredEpoch === null || authoredEpoch > newestAuthoredEpoch)
    ) {
      newestAuthoredEpoch = authoredEpoch;
    }

    const entryAuthor = isNonemptyText(entry.author)
      ? entry.author
      : feedAuthor;
    if (format === 'atom' && entryAuthor === null) {
      throw feedError(
        'FEED_MISSING_AUTHOR',
        'Atom requires an author for every entry. Add a non-empty <meta name="author"> to the article or index page, or set feeds.author in pugneum.json.',
      );
    }

    return Object.assign({}, entry, {
      author: entryAuthor,
      publishedEpoch: authoredEpoch === null ? buildEpoch : authoredEpoch,
    });
  });

  return Object.assign({}, feed, {
    author: feedAuthor,
    buildEpoch,
    description: isNonemptyText(feed.description) ? feed.description : null,
    entries,
    updatedEpoch:
      newestAuthoredEpoch === null ? buildEpoch : newestAuthoredEpoch,
  });
}

function resolveBuildEpoch(feed) {
  if (hasOwn(feed, 'buildEpoch')) {
    if (Number.isFinite(feed.buildEpoch)) return feed.buildEpoch;
    throw feedError(
      'FEED_INVALID_BUILD_DATE',
      'Feed build date must resolve to a finite instant.',
    );
  }
  return captureBuildEpoch(feed.buildDate);
}

// Extracted entries already carry publishedEpoch, including null for an
// invalid authored value. Direct serializer callers omit that field, so their
// string is parsed exactly once while the serializer prepares its model.
function resolveAuthoredEpoch(entry) {
  if (hasOwn(entry, 'publishedEpoch')) {
    return Number.isFinite(entry.publishedEpoch) ? entry.publishedEpoch : null;
  }
  const parsed = parseAuthoredDate(entry.published);
  return parsed ? parsed.getTime() : null;
}

exports.captureBuildEpoch = captureBuildEpoch;
exports.prepareFeed = prepareFeed;
