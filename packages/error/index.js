module.exports = makeError;
module.exports.warning = makeWarning;
module.exports.clearSourceCache = clearSourceCache;

var CONTEXT_RADIUS = 3;
var TAB_SIZE = 8;
var MAX_SOURCE_DISPLAY_WIDTH = 120;
var MAX_SOURCE_SAMPLE_UNITS = 512;
var MAX_FILENAME_DISPLAY_WIDTH = 256;
var MAX_MESSAGE_DISPLAY_WIDTH = 1024;

// This cache covers the common alternating-entry/include diagnostic workload,
// but cannot retain an unbounded document or working set. Entries are indexed
// by source value and store only numeric line bounds. Oversized sources still
// get a bounded-allocation direct scan for the requested context window.
var MAX_CACHE_ENTRIES = 4;
var MAX_CACHE_ENTRY_BYTES = 1024 * 1024;
var MAX_CACHE_BYTES = 4 * 1024 * 1024;
var sourceLineCache = new Map();
var sourceLineCacheBytes = 0;

function clearSourceCache() {
  sourceLineCache.clear();
  sourceLineCacheBytes = 0;
}

var segmenter = new Intl.Segmenter(undefined, {granularity: 'grapheme'});
var markPattern = /^\p{Mark}$/u;
var emojiPattern = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

function normalizeMessage(message) {
  if (message === undefined) return '';
  try {
    return String(message);
  } catch (_error) {
    return '[unprintable diagnostic message]';
  }
}

function normalizeCoordinate(value) {
  var type = typeof value;
  if (type !== 'number' && type !== 'string' && type !== 'bigint') {
    return undefined;
  }
  if (type === 'string' && value.trim() === '') return undefined;

  var number;
  try {
    number = Number(value);
  } catch (_error) {
    return undefined;
  }
  return Number.isSafeInteger(number) && number >= 1 ? number : undefined;
}

function snapshotOptions(options) {
  options = options == null ? {} : options;

  // Read each public option exactly once. In particular, accessor-backed option
  // bags cannot make the formatted frame disagree with the exposed fields.
  var rawLine = options.line;
  var rawColumn = options.column;
  var rawFilename = options.filename;
  var rawSource = options.source;
  var line = normalizeCoordinate(rawLine);

  return {
    line: line,
    column: line === undefined ? undefined : normalizeCoordinate(rawColumn),
    filename:
      typeof rawFilename === 'string' && rawFilename.length > 0
        ? rawFilename
        : undefined,
    source: typeof rawSource === 'string' ? rawSource : undefined,
  };
}

function isNewline(code) {
  return code === 10 || code === 13;
}

function scanFrameRanges(source, line) {
  var first = Math.max(1, line - CONTEXT_RADIUS);
  var last = Math.min(Number.MAX_SAFE_INTEGER, line + CONTEXT_RADIUS);
  var ranges = [];
  var currentLine = 1;
  var start = 0;
  var found = false;

  for (var index = 0; index <= source.length; index++) {
    var atEnd = index === source.length;
    var code = atEnd ? -1 : source.charCodeAt(index);
    if (!atEnd && !isNewline(code)) continue;

    if (currentLine >= first && currentLine <= last) {
      ranges.push({line: currentLine, start: start, end: index});
    }
    if (currentLine === line) found = true;
    if (atEnd || currentLine >= last) break;

    if (
      code === 13 &&
      index + 1 < source.length &&
      source.charCodeAt(index + 1) === 10
    ) {
      index++;
    }
    start = index + 1;
    currentLine++;
  }

  return found ? ranges : null;
}

function buildLineBounds(source, sourceBytes) {
  var bounds = [];
  var start = 0;
  for (var index = 0; index < source.length; index++) {
    var code = source.charCodeAt(index);
    if (!isNewline(code)) continue;

    if (sourceBytes + (bounds.length + 2) * 8 > MAX_CACHE_ENTRY_BYTES) {
      return null;
    }
    bounds.push(start, index);
    if (
      code === 13 &&
      index + 1 < source.length &&
      source.charCodeAt(index + 1) === 10
    ) {
      index++;
    }
    start = index + 1;
  }
  if (sourceBytes + (bounds.length + 2) * 8 > MAX_CACHE_ENTRY_BYTES) {
    return null;
  }
  bounds.push(start, source.length);
  return bounds;
}

function cacheLineBounds(source) {
  var sourceBytes = source.length * 2;
  if (sourceBytes > MAX_CACHE_ENTRY_BYTES) return;

  // Build before changing shared state. A failed scan therefore cannot publish
  // a new key paired with an old or incomplete line index.
  var bounds = buildLineBounds(source, sourceBytes);
  if (!bounds) return;
  var bytes = sourceBytes + bounds.length * 8;

  while (
    sourceLineCache.size >= MAX_CACHE_ENTRIES ||
    sourceLineCacheBytes + bytes > MAX_CACHE_BYTES
  ) {
    var oldestSource = sourceLineCache.keys().next().value;
    var oldest = sourceLineCache.get(oldestSource);
    sourceLineCache.delete(oldestSource);
    sourceLineCacheBytes -= oldest.bytes;
  }

  sourceLineCache.set(source, {bounds: bounds, bytes: bytes});
  sourceLineCacheBytes += bytes;
}

function rangesFromBounds(bounds, line) {
  var lineCount = bounds.length / 2;
  if (line > lineCount) return null;

  var first = Math.max(1, line - CONTEXT_RADIUS);
  var last = Math.min(lineCount, line + CONTEXT_RADIUS);
  var ranges = [];
  for (var current = first; current <= last; current++) {
    var offset = (current - 1) * 2;
    ranges.push({
      line: current,
      start: bounds[offset],
      end: bounds[offset + 1],
    });
  }
  return ranges;
}

function getFrameRanges(source, line) {
  var cached = sourceLineCache.get(source);
  if (cached) {
    // Refresh recency without changing the cache's byte footprint.
    sourceLineCache.delete(source);
    sourceLineCache.set(source, cached);
    return rangesFromBounds(cached.bounds, line);
  }

  // Prove that the requested line exists before building or retaining a full
  // index. Missing/invalid locations never populate the cache.
  var ranges = scanFrameRanges(source, line);
  if (!ranges) return null;
  cacheLineBounds(source);
  return ranges;
}

function isUnsafeDisplayCodePoint(code) {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x61c ||
    code === 0x200e ||
    code === 0x200f ||
    code === 0x2028 ||
    code === 0x2029 ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

function escapeCodePoint(code) {
  if (code === 9) return '\\t';
  if (code === 10) return '\\n';
  if (code === 13) return '\\r';
  if (code <= 0xff) {
    return '\\x' + code.toString(16).toUpperCase().padStart(2, '0');
  }
  if (code <= 0xffff) {
    return '\\u' + code.toString(16).toUpperCase().padStart(4, '0');
  }
  return '\\u{' + code.toString(16).toUpperCase() + '}';
}

function isWideCodePoint(code) {
  return (
    code >= 0x1100 &&
    (code <= 0x115f ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0x303e) ||
      (code >= 0x3040 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1b000 && code <= 0x1b2ff) ||
      (code >= 0x20000 && code <= 0x3fffd))
  );
}

function graphemeWidth(grapheme) {
  if (emojiPattern.test(grapheme)) return 2;

  for (const character of grapheme) {
    var code = character.codePointAt(0);
    if (
      markPattern.test(character) ||
      code === 0x200c ||
      code === 0x200d ||
      (code >= 0xfe00 && code <= 0xfe0f) ||
      (code >= 0xe0100 && code <= 0xe01ef)
    ) {
      continue;
    }
    return isWideCodePoint(code) ? 2 : 1;
  }
  return 0;
}

function pushAsciiTokens(tokens, text, start, end) {
  for (const character of text) {
    tokens.push({text: character, width: 1, start: start, end: end});
  }
}

function tokenizeDisplay(value, expandTabs) {
  var tokens = [];
  var displayWidth = 0;

  for (const part of segmenter.segment(value)) {
    var grapheme = part.segment;
    var unsafe = false;
    for (const character of grapheme) {
      var code = character.codePointAt(0);
      if (isUnsafeDisplayCodePoint(code)) {
        unsafe = true;
        break;
      }
    }

    if (!unsafe) {
      var width = graphemeWidth(grapheme);
      tokens.push({
        text: grapheme,
        width: width,
        start: part.index,
        end: part.index + grapheme.length,
      });
      displayWidth += width;
      continue;
    }

    var offset = part.index;
    for (const character of grapheme) {
      var characterCode = character.codePointAt(0);
      var end = offset + character.length;
      if (characterCode === 9 && expandTabs) {
        var spaces = TAB_SIZE - (displayWidth % TAB_SIZE);
        pushAsciiTokens(tokens, ' '.repeat(spaces), offset, end);
        displayWidth += spaces;
      } else if (isUnsafeDisplayCodePoint(characterCode)) {
        var escaped = escapeCodePoint(characterCode);
        pushAsciiTokens(tokens, escaped, offset, end);
        displayWidth += escaped.length;
      } else {
        var characterWidth = graphemeWidth(character);
        tokens.push({
          text: character,
          width: characterWidth,
          start: offset,
          end: end,
        });
        displayWidth += characterWidth;
      }
      offset = end;
    }
  }

  return tokens;
}

function tokensWidth(tokens) {
  return tokens.reduce(function (total, token) {
    return total + token.width;
  }, 0);
}

function widthBeforeOffset(tokens, offset) {
  var width = 0;
  for (const token of tokens) {
    if (offset <= token.start) return width;
    if (offset < token.end) return width;
    width += token.width;
  }
  return width;
}

function joinTokens(tokens) {
  return tokens
    .map(function (token) {
      return token.text;
    })
    .join('');
}

function clipStart(tokens, maxWidth, forceMarker) {
  var total = tokensWidth(tokens);
  if (total <= maxWidth && !forceMarker) return joinTokens(tokens);

  var selected = [];
  var width = 0;
  var budget = Math.max(0, maxWidth - 1);
  for (const token of tokens) {
    if (width + token.width > budget) break;
    selected.push(token);
    width += token.width;
  }
  return joinTokens(selected) + '…';
}

function clipAroundCaret(tokens, caret) {
  var total = tokensWidth(tokens);
  if (total <= MAX_SOURCE_DISPLAY_WIDTH) {
    return {text: joinTokens(tokens), caret: caret};
  }

  var desiredStart = Math.max(0, caret - 40);
  var startIndex = 0;
  var startWidth = 0;
  while (
    startIndex < tokens.length &&
    startWidth + tokens[startIndex].width <= desiredStart
  ) {
    startWidth += tokens[startIndex].width;
    startIndex++;
  }

  var leftMarker = startIndex > 0;
  var budget = MAX_SOURCE_DISPLAY_WIDTH - (leftMarker ? 1 : 0) - 1;
  var endIndex = startIndex;
  var selectedWidth = 0;
  while (
    endIndex < tokens.length &&
    selectedWidth + tokens[endIndex].width <= budget
  ) {
    selectedWidth += tokens[endIndex].width;
    endIndex++;
  }
  var rightMarker = endIndex < tokens.length;

  return {
    text:
      (leftMarker ? '…' : '') +
      joinTokens(tokens.slice(startIndex, endIndex)) +
      (rightMarker ? '…' : ''),
    caret: (leftMarker ? 1 : 0) + Math.max(0, caret - startWidth),
  };
}

function addMarkerToken(tokens, atStart) {
  var marker = {text: '…', width: 1, start: -1, end: -1};
  if (atStart) tokens.unshift(marker);
  else tokens.push(marker);
}

function sourceLineDisplay(source, range, column) {
  var lineLength = range.end - range.start;
  var hasCaret = column !== undefined;
  var requestedOffset = hasCaret ? column - 1 : 0;
  var targetOffset = Math.min(requestedOffset, lineLength);
  var sampleStart = hasCaret
    ? Math.max(0, targetOffset - Math.floor(MAX_SOURCE_SAMPLE_UNITS / 2))
    : 0;
  var sampleEnd = Math.min(lineLength, sampleStart + MAX_SOURCE_SAMPLE_UNITS);

  // Do not make the bounded raw sample itself introduce a lone surrogate.
  if (
    sampleStart > 0 &&
    source.codePointAt(range.start + sampleStart - 1) > 0xffff
  ) {
    sampleStart--;
  }
  if (
    sampleEnd < lineLength &&
    source.codePointAt(range.start + sampleEnd - 1) > 0xffff
  ) {
    sampleEnd++;
  }

  var sample = source.slice(range.start + sampleStart, range.start + sampleEnd);
  var tokens = tokenizeDisplay(sample, true);
  var caret = hasCaret
    ? widthBeforeOffset(tokens, targetOffset - sampleStart)
    : undefined;
  var leftTruncated = sampleStart > 0;
  var rightTruncated = sampleEnd < lineLength || requestedOffset > lineLength;

  if (leftTruncated) {
    addMarkerToken(tokens, true);
    if (hasCaret) caret++;
  }
  if (rightTruncated && hasCaret) addMarkerToken(tokens, false);

  if (hasCaret) return clipAroundCaret(tokens, caret);
  return {
    text: clipStart(tokens, MAX_SOURCE_DISPLAY_WIDTH, rightTruncated),
    caret: undefined,
  };
}

function boundedDisplayText(value, maxWidth) {
  var rawLimit = maxWidth * 2;
  var sampled = value.slice(0, rawLimit);
  return clipStart(
    tokenizeDisplay(sampled, false),
    maxWidth,
    sampled.length < value.length,
  );
}

function formatFrame(source, line, column) {
  if (source.length === 0) return null;
  var ranges = getFrameRanges(source, line);
  if (!ranges) return null;

  var gutterWidth = String(ranges[ranges.length - 1].line).length;
  return ranges
    .map(function (range) {
      var current = range.line;
      var preamble =
        (current === line ? '  > ' : '    ') +
        String(current).padStart(gutterWidth, ' ') +
        '| ';
      var display = sourceLineDisplay(
        source,
        range,
        current === line ? column : undefined,
      );
      var output = preamble + display.text;
      if (current === line && display.caret !== undefined) {
        output += '\n' + '-'.repeat(preamble.length + display.caret) + '^';
      }
      return output;
    })
    .join('\n');
}

function formatMessage(message, options) {
  var filename = options.filename
    ? boundedDisplayText(options.filename, MAX_FILENAME_DISPLAY_WIDTH)
    : '';
  var parts = [];
  if (filename) parts.push(filename);
  if (options.line !== undefined) {
    parts.push(
      String(options.line) +
        (options.column === undefined ? '' : ':' + options.column),
    );
  }
  var header = parts.join(':');
  var frame =
    options.line !== undefined &&
    typeof options.source === 'string' &&
    options.source.length > 0
      ? formatFrame(options.source, options.line, options.column)
      : null;
  var displayMessage = boundedDisplayText(message, MAX_MESSAGE_DISPLAY_WIDTH);

  if (frame) return header + '\n' + frame + '\n\n' + displayMessage;
  return header ? header + '\n\n' + displayMessage : displayMessage;
}

function toJSON() {
  // Source, formatted display text, stack, and severity are deliberately not
  // part of this legacy restricted projection. See the package README.
  return {
    code: this.code,
    msg: this.msg,
    line: this.line,
    column: this.column,
    filename: this.filename,
  };
}

function fields(code, message, options) {
  return {
    code: 'PUGNEUM:' + code,
    msg: message,
    line: options.line,
    column: options.column,
    filename: options.filename,
    source: options.source,
    toJSON: toJSON,
  };
}

function makeDiagnostic(code, message, options, ErrorConstructor) {
  var normalizedMessage = normalizeMessage(message);
  var normalizedOptions = snapshotOptions(options);
  var displayMessage = formatMessage(normalizedMessage, normalizedOptions);
  var sharedFields = fields(code, normalizedMessage, normalizedOptions);

  if (ErrorConstructor) {
    return Object.assign(new ErrorConstructor(displayMessage), sharedFields);
  }
  return Object.assign(sharedFields, {message: displayMessage});
}

function makeError(code, message, options) {
  return makeDiagnostic(code, message, options, Error);
}

function makeWarning(code, message, options) {
  return makeDiagnostic(code, message, options, null);
}
