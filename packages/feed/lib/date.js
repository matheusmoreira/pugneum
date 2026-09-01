// Shared date handling for the Atom and RSS serializers.
//
// `data-published-at` values are author-controlled strings.
// The only formats pugneum documents are ISO-8601 date-only (YYYY-MM-DD) and
// ISO-8601 datetime. A zoneless value would otherwise be parsed in the build
// machine's local timezone by `new Date(...)`, so identical source would emit
// different timestamps depending on where it is built. We pin zoneless ISO
// values to UTC: a date-only string becomes midnight UTC, and a datetime with
// no timezone designator gets a trailing `Z`.

// YYYY-MM-DD with nothing after it.
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
// YYYY-MM-DDThh:mm(:ss)?(.fff)? with NO trailing Z and NO +hh:mm/-hh:mm offset.
const ZONELESS_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?$/;
const ISO_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?(?:Z|[+-](\d{2}):(\d{2}))?$/;

function normalizeToUtc(dateStr) {
  if (DATE_ONLY.test(dateStr)) {
    return dateStr + 'T00:00:00Z';
  }
  if (ZONELESS_DATETIME.test(dateStr)) {
    return dateStr + 'Z';
  }
  return dateStr;
}

function hasValidIsoComponents(dateStr) {
  const dateOnly = DATE_ONLY.exec(dateStr);
  if (dateOnly) {
    return isCalendarDate(
      Number(dateOnly[1]),
      Number(dateOnly[2]),
      Number(dateOnly[3]),
    );
  }

  const datetime = ISO_DATETIME.exec(dateStr);
  if (!datetime) return false;

  if (
    !isCalendarDate(
      Number(datetime[1]),
      Number(datetime[2]),
      Number(datetime[3]),
    ) ||
    Number(datetime[4]) > 23 ||
    Number(datetime[5]) > 59 ||
    (datetime[6] !== undefined && Number(datetime[6]) > 59) ||
    (datetime[8] !== undefined && Number(datetime[8]) > 23) ||
    (datetime[9] !== undefined && Number(datetime[9]) > 59)
  ) {
    return false;
  }

  return true;
}

function isCalendarDate(year, month, day) {
  const monthLengths = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return (
    month >= 1 && month <= 12 && day >= 1 && day <= monthLengths[month - 1]
  );
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

// Parse an authored value without a fallback. Extraction uses this once to
// retain the epoch used for ordering and serialization; null marks an invalid
// value so callers can apply their documented policy explicitly.
function parseAuthoredDate(dateStr) {
  if (dateStr === null || dateStr === undefined || dateStr === '') {
    return null;
  }
  if (typeof dateStr === 'string' && !hasValidIsoComponents(dateStr)) {
    return null;
  }
  const d = new Date(normalizeToUtc(dateStr));
  return isNaN(d.getTime()) ? null : d;
}

// Parse a date string to a Date, normalizing zoneless ISO values to UTC and
// falling back to `fallback` (then to now) when the input is empty or invalid.
function parseDate(dateStr, fallback) {
  return (
    parseAuthoredDate(dateStr) ||
    parseAuthoredDate(fallback) ||
    new Date(Date.now())
  );
}

exports.parseAuthoredDate = parseAuthoredDate;
exports.parseDate = parseDate;
