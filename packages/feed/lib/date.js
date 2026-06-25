// Shared date handling for the Atom and RSS serializers.
//
// `data-published-at` (and feed config dates) are author-controlled strings.
// The only formats pugneum documents are ISO-8601 date-only (YYYY-MM-DD) and
// ISO-8601 datetime. A zoneless value would otherwise be parsed in the build
// machine's local timezone by `new Date(...)`, so identical source would emit
// different timestamps depending on where it is built. We pin zoneless ISO
// values to UTC: a date-only string becomes midnight UTC, and a datetime with
// no timezone designator gets a trailing `Z`.

// YYYY-MM-DD with nothing after it.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
// YYYY-MM-DDThh:mm(:ss)?(.fff)? with NO trailing Z and NO +hh:mm/-hh:mm offset.
const ZONELESS_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?$/;

function normalizeToUtc(dateStr) {
  if (DATE_ONLY.test(dateStr)) {
    return dateStr + 'T00:00:00Z';
  }
  if (ZONELESS_DATETIME.test(dateStr)) {
    return dateStr + 'Z';
  }
  return dateStr;
}

// Parse a date string to a Date, normalizing zoneless ISO values to UTC and
// falling back to `fallback` (then to now) when the input is empty or invalid.
function parseDate(dateStr, fallback) {
  if (!dateStr) {
    return new Date(fallback || Date.now());
  }
  const d = new Date(normalizeToUtc(dateStr));
  if (isNaN(d.getTime())) {
    return new Date(fallback || Date.now());
  }
  return d;
}

// Select the feed-level timestamp. Entries are pre-sorted newest-first by
// extract.js, so entries[0] is the most recent. With no entries the feed has
// no natural timestamp, so we fall back to the build date.
function feedTimestamp(feed) {
  if (feed.entries.length > 0) {
    return parseDate(feed.entries[0].published, feed.buildDate);
  }
  return parseDate(null, feed.buildDate);
}

exports.parseDate = parseDate;
exports.feedTimestamp = feedTimestamp;
