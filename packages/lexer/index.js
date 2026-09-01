const error = require('pugneum-error');
const attributeInterpolationSource = Symbol.for(
  'pugneum.attributeInterpolationSource',
);

const MAX_TEMPLATE_DEPTH = 256;
const MAX_INLINE_ELEMENT_DEPTH = MAX_TEMPLATE_DEPTH - 1;

module.exports = lex;

function lex(str, options) {
  const lexer = new Lexer(str, options);
  return lexer.getTokens();
}

// https://infra.spec.whatwg.org/#c0-control
const c0 = '\u0000-\u001F';

// https://infra.spec.whatwg.org/#control
const control = c0 + '\u007F-\u009F';

// https://infra.spec.whatwg.org/#noncharacter
const noncharacter =
  '\uFDD0-\uFDEF' +
  '\uFFFE\uFFFF' +
  '\u{1FFFE}\u{1FFFF}' +
  '\u{2FFFE}\u{2FFFF}' +
  '\u{3FFFE}\u{3FFFF}' +
  '\u{4FFFE}\u{4FFFF}' +
  '\u{5FFFE}\u{5FFFF}' +
  '\u{6FFFE}\u{6FFFF}' +
  '\u{7FFFE}\u{7FFFF}' +
  '\u{8FFFE}\u{8FFFF}' +
  '\u{9FFFE}\u{9FFFF}' +
  '\u{AFFFE}\u{AFFFF}' +
  '\u{BFFFE}\u{BFFFF}' +
  '\u{CFFFE}\u{CFFFF}' +
  '\u{DFFFE}\u{DFFFF}' +
  '\u{EFFFE}\u{EFFFF}' +
  '\u{FFFFE}\u{FFFFF}' +
  '\u{10FFFE}\u{10FFFF}';

// https://html.spec.whatwg.org/multipage/syntax.html#attributes-2
const attributeNamePunctuation = ' \'">/=';
// The `u` flag is required because `noncharacter` contains astral code points
// (\u{1FFFE}…\u{10FFFF}); without it the class would match their surrogate
// halves as separate UTF-16 code units rather than the intended code points.
const attributeName = new RegExp(
  '[^' + control + attributeNamePunctuation + noncharacter + ']',
  'gu',
);

function invalidAttributeNameCharacters(name) {
  return String(name).replaceAll(attributeName, '');
}

function isValidAttributeName(name) {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    invalidAttributeNameCharacters(name).length === 0
  );
}

// Generated-source producers must apply the same HTML-name boundary as the
// lexer before emitting an attribute token. Keep this predicate on the public
// lexer function so packages do not maintain subtly different deny lists.
lex.isValidAttributeName = isValidAttributeName;

const whitespaceRe = /[ \n\t]/;

// Curly "smart" quotes that editors and AI tools auto-substitute for straight
// quotes. They are not attribute delimiters; left here they end up inside the
// value and silently produce broken output (e.g. href="‘/x’").
const typographicQuoteRe = /[‘’“”]/;

// Non-ASCII / invisible whitespace (NBSP, narrow NBSP, ideographic space,
// zero-width space, etc.) that editors and copy-paste introduce. Structural
// whitespace must be plain spaces or tabs, so these are never valid here.
const nonAsciiWhitespaceRe =
  /[\u0085\u00A0\u1680\u2000-\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF]/;

const bracketPairs = {'(': ')', '{': '}', '[': ']'};
const closingBrackets = {')': '(', '}': '{', ']': '['};

const inlineShorthands = {
  strong: {tag: 'strong', sigil: '*'},
  emphasis: {tag: 'em', sigil: '_', name: 'emphasis'},
  del: {tag: 'del', sigil: '~'},
  ins: {tag: 'ins', sigil: '&'},
  sup: {tag: 'sup', sigil: '^'},
  kbd: {tag: 'kbd', sigil: '%'},
  sub: {tag: 'sub', sigil: ','},
};

const parenShorthands = [
  {sigil: '@', key: 'link', kind: 'link', label: 'inline links'},
  {sigil: '!', key: 'image', kind: 'image', label: 'inline images'},
  {sigil: '*', key: 'strong', kind: 'strong', label: 'inline strong'},
  {sigil: '_', key: 'emphasis', kind: 'emphasis', label: 'inline emphasis'},
  {sigil: '~', key: 'del', kind: 'del', label: 'inline del'},
  {sigil: '&', key: 'ins', kind: 'ins', label: 'inline ins'},
  {sigil: '^', key: 'sup', kind: 'sup', label: 'inline sup'},
  {sigil: '%', key: 'kbd', kind: 'kbd', label: 'inline kbd'},
  {sigil: ',', key: 'sub', kind: 'sub', label: 'inline sub'},
  {sigil: '?', key: 'abbr', kind: 'abbr', label: 'inline abbr'},
  {sigil: '`', key: 'code', kind: 'code', label: 'inline code'},
  {sigil: '#', key: 'interp', kind: 'interpolation', label: 'inline tags'},
];

const bracketShorthands = [
  {
    sigil: '@',
    key: 'ref',
    kind: 'reference',
    label: 'reference links',
    handler: 'handleRefLink',
  },
  {
    sigil: '!',
    key: 'refImage',
    kind: 'ref-image',
    label: 'reference images',
    handler: 'handleRefImage',
  },
  {
    sigil: '^',
    key: 'footnoteRef',
    kind: 'footnote-ref',
    label: 'footnote references',
    handler: 'handleFootnoteRef',
  },
];

// Sigil -> kind lookups so findEarliestCandidate can classify a candidate in a
// single left-to-right pass (O(1) per character) instead of running a separate
// full-tail indexOf for every sigil (which was O(constructs) full scans per
// call and O(n^2) on a line packed with escapes/shorthands).
const parenShorthandBySigil = {};
for (const t of parenShorthands) parenShorthandBySigil[t.sigil] = t.kind;
const bracketShorthandBySigil = {};
for (const t of bracketShorthands) bracketShorthandBySigil[t.sigil] = t.kind;

function escapeForRegex(ch) {
  return /[\\^$.*+?()[\]{}|]/.test(ch) ? '\\' + ch : ch;
}

// Format a character as its `U+XXXX` Unicode codepoint label for diagnostics.
function formatCodepoint(ch) {
  return 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
}

function isTagStart(ch) {
  const code = ch.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

const variableNamePattern = '[-a-zA-Z_?]';
const variableNameRe = new RegExp(variableNamePattern);
const variableNameOnlyRe = new RegExp('^' + variableNamePattern + '+$');

function parseVariableAt(str, start) {
  if (str[start] !== '#' || str[start + 1] !== '{') return null;

  const bodyStart = start + 2;
  const newline = str.indexOf('\n', bodyStart);
  const close = str.indexOf('}', bodyStart);
  if (close === -1 || (newline !== -1 && newline < close)) {
    return {error: 'unclosed'};
  }

  const name = str.substring(bodyStart, close);
  if (!variableNameOnlyRe.test(name)) {
    return {error: 'invalid', name};
  }

  return {length: close - start + 1, name};
}

function validVariableAt(str, start) {
  if (str[start] !== '#' || str[start + 1] !== '{') return null;

  let end = start + 2;
  while (end < str.length && variableNameRe.test(str[end])) end++;
  if (end === start + 2 || str[end] !== '}') return null;

  return {length: end - start + 1, name: str.substring(start + 2, end)};
}

function backslashRun(str, start) {
  if (str[start] !== '\\') return null;
  let end = start;
  while (str[end] === '\\') end++;
  return {
    length: end - start,
    variable: validVariableAt(str, end),
  };
}

function retainAttributeInterpolationSource(target, value, source) {
  if (
    typeof value !== 'string' ||
    typeof source !== 'string' ||
    source === value
  ) {
    return;
  }
  Object.defineProperty(target, attributeInterpolationSource, {
    configurable: true,
    value: source,
    writable: true,
  });
}

/**
 * Advance past one character inside a quote-aware bracket scan.
 * Handles escape sequences and quote toggling.
 *
 * @param {string} str - The string being scanned
 * @param {number} i - Current index
 * @param {string|null} quote - Current quote character, or null if not in a quote
 * @returns {{i: number, quote: string|null}} Updated index and quote state
 */
function scanChar(str, i, quote) {
  const c = str[i];

  if (quote) {
    if (c === '\\') return {i: i + 2, quote};
    if (c === quote) return {i: i + 1, quote: null};
    return {i: i + 1, quote};
  }

  if (c === '\\') return {i: i + 2, quote: null};

  if (c === "'" || c === '"') {
    return {i: i + 1, quote: c};
  }

  return {i: i + 1, quote: null};
}

function throwUnclosed(end, i, quoteStart) {
  const err = new Error(
    'The end of the string reached with no closing bracket ' + end + ' found.',
  );
  err.code = 'CHARACTER_PARSER:END_OF_STRING_REACHED';
  err.index = i;
  if (quoteStart >= 0) err.quoteStart = quoteStart;
  throw err;
}

/**
 * Find the closing bracket in an expression context (attributes, mixin args).
 * Quotes are string delimiters; backslash escaping inside quotes.
 */
function parseExpressionUntil(str, end, start) {
  let depth = 1;
  let i = start;
  let quote = null;
  let quoteStart = -1;
  const open = closingBrackets[end];

  while (i < str.length) {
    const c = str[i];

    if (quote || c === "'" || c === '"') {
      const wasQuoted = quote !== null;
      if (!wasQuoted) quoteStart = i;
      ({i, quote} = scanChar(str, i, quote));
      if (wasQuoted && quote === null) quoteStart = -1;
      continue;
    }

    if (c === open) {
      depth++;
    } else if (c === end) {
      depth--;
      if (depth === 0) {
        return {end: i, src: str.substring(start, i)};
      }
    }
    i++;
  }

  throwUnclosed(end, i, quoteStart);
}

// Return the index just past a balanced (...) expression group, or -1 when the
// requested offset is not an opener or the group is incomplete. Generated-
// source packages use this narrow helper instead of duplicating the lexer's
// quote and escape boundary rules.
function scanExpressionGroup(str, start) {
  if (
    typeof str !== 'string' ||
    !Number.isSafeInteger(start) ||
    start < 0 ||
    str[start] !== '('
  ) {
    return -1;
  }

  try {
    return parseExpressionUntil(str, ')', start + 1).end + 1;
  } catch (ex) {
    if (ex.code === 'CHARACTER_PARSER:END_OF_STRING_REACHED') return -1;
    throw ex;
  }
}

lex.scanExpressionGroup = scanExpressionGroup;

/**
 * Find the closing bracket in a text context (inline shorthands).
 * Quotes are literal; backslash escapes brackets.
 */
function parseTextUntil(str, end, start) {
  let depth = 1;
  let i = start;
  const open = closingBrackets[end];

  while (i < str.length) {
    const c = str[i];

    if (c === '\\' && i + 1 < str.length) {
      const next = str[i + 1];
      if (next === '\\' || next === open || next === end) {
        i += 2;
        continue;
      }
    }

    if (c === open) {
      depth++;
    } else if (c === end) {
      depth--;
      if (depth === 0) {
        return {end: i, src: str.substring(start, i)};
      }
    }
    i++;
  }

  throwUnclosed(end, i);
}

function textParenFrame(sigil, escaped) {
  return {
    kind: 'text-paren',
    depth: 1,
    trailingAttributes: !escaped && sigil === '!',
    stop: false,
  };
}

function interpolationFrame() {
  return {kind: 'interpolation', depth: 0, head: true, stop: false};
}

function bracketFrame(sigil, escaped, stop) {
  return {
    kind: 'bracket',
    trailingAttributes: !escaped && !stop && (sigil === '@' || sigil === '!'),
    stop,
  };
}

function expressionFrame() {
  return {kind: 'expression', depth: 1, quote: null, stop: false};
}

function finishInlineFrame(str, state, frame, index) {
  state.stack.pop();
  if (frame.stop) return {end: index};
  if (frame.trailingAttributes && str[index + 1] === '(') {
    state.stack.push(expressionFrame());
    return {next: index + 2};
  }
  return {next: index + 1};
}

function scanInlineContexts(str, state, start) {
  let i = start;

  while (i < str.length) {
    const ch = str[i];
    const next = str[i + 1];
    const delimiter = str[i + 2];
    const frame = state.stack[state.stack.length - 1];

    if (!frame) {
      if (ch === '\\') {
        i += next === undefined ? 1 : 2;
      } else if (next === '(' && parenShorthandBySigil[ch] !== undefined) {
        state.stack.push(
          ch === '#' ? interpolationFrame() : textParenFrame(ch, false),
        );
        i += 2;
      } else if (next === '[' && bracketShorthandBySigil[ch] !== undefined) {
        state.stack.push(bracketFrame(ch, false, false));
        i += 2;
      } else {
        i++;
      }
      continue;
    }

    if (frame.kind === 'text-paren') {
      if (ch === '\\' && (next === '\\' || next === '(' || next === ')')) {
        i += 2;
      } else if (ch === '(') {
        frame.depth++;
        i++;
      } else if (ch === ')') {
        frame.depth--;
        if (frame.depth === 0) {
          const finished = finishInlineFrame(str, state, frame, i);
          if (finished.end !== undefined) return finished.end;
          i = finished.next;
        } else {
          i++;
        }
      } else {
        i++;
      }
      continue;
    }

    if (frame.kind === 'expression') {
      if (frame.quote !== null) {
        if (ch === '\\' && next !== undefined) {
          i += 2;
        } else {
          if (ch === frame.quote) frame.quote = null;
          i++;
        }
      } else if (ch === "'" || ch === '"') {
        frame.quote = ch;
        i++;
      } else if (ch === '(') {
        frame.depth++;
        i++;
      } else if (ch === ')') {
        frame.depth--;
        if (frame.depth === 0) state.stack.pop();
        i++;
      } else {
        i++;
      }
      continue;
    }

    if (frame.kind === 'interpolation') {
      if (ch === '\\') {
        i += next === undefined ? 1 : 2;
        continue;
      }

      if (frame.depth === 0 && frame.head && ch === '(') {
        state.stack.push(expressionFrame());
        i++;
        continue;
      }

      if (frame.depth === 0 && (ch === ' ' || ch === '\t' || ch === '\n')) {
        frame.head = false;
        i++;
        continue;
      }

      if (!frame.head) {
        if (next === '(' && parenShorthandBySigil[ch] !== undefined) {
          state.stack.push(
            ch === '#' ? interpolationFrame() : textParenFrame(ch, false),
          );
          i += 2;
          continue;
        }
        if (next === '[' && bracketShorthandBySigil[ch] !== undefined) {
          state.stack.push(bracketFrame(ch, false, false));
          i += 2;
          continue;
        }
      }

      if (ch === '(') {
        frame.depth++;
        i++;
      } else if (ch === ')') {
        if (frame.depth > 0) {
          frame.depth--;
          i++;
        } else {
          const finished = finishInlineFrame(str, state, frame, i);
          if (finished.end !== undefined) return finished.end;
          i = finished.next;
        }
      } else {
        i++;
      }
      continue;
    }

    if (ch === '\\') {
      if (delimiter === '(' && parenShorthandBySigil[next] !== undefined) {
        state.stack.push(textParenFrame(next, true));
        i += 3;
      } else if (
        delimiter === '[' &&
        bracketShorthandBySigil[next] !== undefined
      ) {
        state.stack.push(bracketFrame(next, true, false));
        i += 3;
      } else {
        i += next === undefined ? 1 : 2;
      }
      continue;
    }

    if (next === '(' && parenShorthandBySigil[ch] !== undefined) {
      state.stack.push(
        ch === '#' ? interpolationFrame() : textParenFrame(ch, false),
      );
      i += 2;
      continue;
    }

    if (next === '[' && bracketShorthandBySigil[ch] !== undefined) {
      state.stack.push(bracketFrame(ch, false, false));
      i += 2;
      continue;
    }

    if (ch === ']') {
      const finished = finishInlineFrame(str, state, frame, i);
      if (finished.end !== undefined) return finished.end;
      i = finished.next;
    } else {
      i++;
    }
  }

  return -1;
}

/**
 * Scan bracket content for `@[...]`, `![...]`, and `^[...]` shorthands.
 * Nested inline constructs delegate to their own text/expression boundary
 * grammar, so literal `]` characters inside them cannot close this bracket.
 * Escaped shorthand openers likewise retain a paired literal closer.
 *
 * @param {string} str - The string to scan
 * @param {number} start - The index to start scanning from
 * @returns {{end: number, src: string} | null}
 */
function parseBracketContent(str, start) {
  const state = {stack: [bracketFrame(null, false, true)]};
  const end = scanInlineContexts(str, state, start);
  return end === -1 ? null : {end, src: str.substring(start, end)};
}

function findInterpolationEnd(str) {
  const frame = interpolationFrame();
  frame.stop = true;
  return scanInlineContexts(str, {stack: [frame]}, 0);
}

/**
 * Check if brackets are properly nested in the given expression string.
 * Returns true if nesting is incorrect (unbalanced brackets).
 *
 * @param {string} str - The expression to check
 * @returns {boolean}
 */
function isNesting(str) {
  const stack = [];
  let quote = null;
  let i = 0;

  while (i < str.length) {
    const c = str[i];

    if (quote || c === "'" || c === '"') {
      ({i, quote} = scanChar(str, i, quote));
      continue;
    }

    if (bracketPairs[c]) {
      stack.push(bracketPairs[c]);
    } else if (closingBrackets[c]) {
      if (stack.length === 0 || stack.pop() !== c) {
        return true;
      }
    }
    i++;
  }

  return stack.length !== 0 || quote !== null;
}

/**
 * Find the closing quote in a string, respecting backslash escapes.
 * Returns the index of the closing quote, or -1 if not found.
 *
 * @param {string} str - The string to search within
 * @param {string} quote - The quote character to find (' or ")
 * @param {number} start - The index to start searching from (after the opening quote)
 * @returns {number}
 */
function findClosingQuote(str, quote, start) {
  for (let i = start; i < str.length; i++) {
    if (str[i] === '\\' && i + 1 < str.length) {
      i++;
      continue;
    }
    if (str[i] === quote) {
      return i;
    }
  }
  return -1;
}

/**
 * Decode resource escapes while retaining the original slash count before a
 * valid attribute interpolation. The public value still handles \( \) \\ \' \"
 * exactly as before; interpolationSource is private cross-stage provenance.
 *
 * @param {string} str - The string to decode
 * @returns {{value: string, interpolationSource: string}}
 */
function decodeResource(str) {
  let value = '';
  let interpolationSource = '';

  for (let i = 0; i < str.length; ) {
    const run = backslashRun(str, i);
    if (run) {
      if (run.variable) {
        value += '\\'.repeat(Math.ceil(run.length / 2));
        interpolationSource += '\\'.repeat(run.length);
        i += run.length;
        continue;
      }
      const pairLength = run.length - (run.length % 2);
      if (pairLength !== 0) {
        const decoded = '\\'.repeat(pairLength / 2);
        value += decoded;
        interpolationSource += decoded;
        i += pairLength;
        continue;
      }
    }

    if (
      str[i] === '\\' &&
      i + 1 < str.length &&
      '()\\\'"'.includes(str[i + 1])
    ) {
      value += str[i + 1];
      interpolationSource += str[i + 1];
      i += 2;
      continue;
    }

    value += str[i];
    interpolationSource += str[i];
    i++;
  }

  return {value, interpolationSource};
}

// Code-span content is literal text and is NOT re-interpolated downstream, so an
// escaped \#{ must become the literal #{ right here — this is how a table cell's
// neutralized `#{` renders correctly inside `(...). The \# strip is scoped to a
// following `{` on purpose: `#` is
// only special as the head of an interpolation, so a bare \# elsewhere in a code
// span (e.g. `\#general`) keeps its backslash, exactly as base and every other
// shorthand do — only the interpolation sigil the table filter neutralizes is
// unescaped here.
function unescapeCodeSpan(str) {
  return str.replace(/\\([()\\'"])|\\(#)(?=\{)/g, '$1$2');
}

/**
 * Check whether a line has unclosed inline shorthand constructs.
 * Returns true if all constructs are closed (line is complete).
 */
function interpolationsAreClosed(str, state) {
  scanInlineContexts(str, state, 0);
  return state.stack.length === 0;
}

/**
 * Merge consecutive lines that have unclosed inline shorthand constructs
 * into single entries so multi-line inline elements are handled as one unit.
 *
 * Returns groups with both normalized text and the original line segments.
 * The segments let the lexer map each normalized boundary back to its physical
 * line and column instead of assigning a whole folded construct to line one.
 */
function mergeMultiLineInterpolations(
  tokens,
  tokenIndents,
  interpolationAllowed,
) {
  if (!interpolationAllowed) {
    // Filters and unbuffered comments have already declared their bodies
    // literal, so every physical line is a complete group.
    return tokens.map((text, index) => ({
      text,
      indented: tokenIndents[index],
      lines: 1,
      segments: [{text, indented: tokenIndents[index]}],
    }));
  }

  const result = [];
  let pendingText = null;
  let pendingLines = 0;
  let pendingIndentIdx = 0;
  let pendingSegments = [];
  const state = {stack: []};

  for (let j = 0; j < tokens.length; j++) {
    if (pendingText !== null) {
      pendingText += ' ' + tokens[j].trimStart();
      // The normalized representation inserts one separator between physical
      // lines; feed it through the same context scanner as the visible bytes.
      scanInlineContexts(' ', state, 0);
    } else {
      pendingText = tokens[j];
      pendingIndentIdx = j;
    }
    pendingSegments.push({text: tokens[j], indented: tokenIndents[j]});
    pendingLines++;

    if (interpolationsAreClosed(tokens[j], state)) {
      result.push({
        text: pendingText,
        indented: tokenIndents[pendingIndentIdx],
        lines: pendingLines,
        segments: pendingSegments,
      });
      pendingText = null;
      pendingLines = 0;
      pendingSegments = [];
      state.stack.length = 0;
    }
  }
  if (pendingText !== null) {
    result.push({
      text: pendingText,
      indented: tokenIndents[pendingIndentIdx],
      lines: pendingLines,
      segments: pendingSegments,
    });
  }
  return result;
}

class Lexer {
  constructor(str, options) {
    if (typeof str !== 'string') {
      throw new Error(
        'Expected source code to be a string but got "' + typeof str + '"',
      );
    }
    if (options == null) options = {};
    if (typeof options !== 'object' || Array.isArray(options)) {
      throw new Error(
        'Expected "options" to be an object but got "' + typeof options + '"',
      );
    }
    if (
      options.warnings !== undefined &&
      (!Array.isArray(options.warnings) ||
        !Object.isExtensible(options.warnings) ||
        !Object.getOwnPropertyDescriptor(options.warnings, 'length').writable)
    ) {
      throw new Error('Expected "options.warnings" to be a mutable array');
    }
    //Strip any UTF-8 BOM off of the start of `str`, if it exists.
    str = str.replace(/^\uFEFF/, '');
    this.input = str.replace(/\r\n|\r/g, '\n');
    this.generatedInput = this.input;
    this.originalInput =
      options.originalInput === undefined ? str : options.originalInput;
    // Mapped child lexers scan normalized or generated input while publishing
    // locations and diagnostics in the root source coordinate space. Each
    // entry maps one generated string boundary, including the final boundary.
    this.locationMap = options.locationMap || null;
    this.generatedLineStarts = [0];
    if (this.locationMap) {
      for (let i = 0; i < this.generatedInput.length; i++) {
        if (this.generatedInput[i] === '\n')
          this.generatedLineStarts.push(i + 1);
      }
    }
    this.filename = options.filename;
    // Shared sink for non-fatal diagnostics. The same array is threaded
    // through the loader and child lexers so warnings from included files
    // and nested inline content are collected in one place.
    this.warnings = options.warnings === undefined ? [] : options.warnings;
    this.interpolated = options.interpolated || false;
    this.depth = options.depth || 0;
    this.lineno = options.startingLine || 1;
    this.colno = options.startingColumn || 1;
    this.indentStack = [0];
    this.indentRe = null;
    // If #{} or inline shorthand syntax is allowed when adding text
    this.interpolationAllowed =
      options.interpolationAllowed === undefined
        ? true
        : options.interpolationAllowed;

    this.tokens = [];
    this.ended = false;
  }

  error(code, message) {
    const location = this.sourceLocation(this.lineno, this.colno);
    const err = error(code, message, {
      line: location.line,
      column: location.column,
      filename: this.filename,
      source: this.originalInput,
    });
    throw err;
  }

  warn(code, message) {
    const location = this.sourceLocation(this.lineno, this.colno);
    this.warnings.push(
      error.warning(code, message, {
        line: location.line,
        column: location.column,
        filename: this.filename,
        source: this.originalInput,
      }),
    );
  }

  warnTypographicQuote(char, field) {
    const codepoint = formatCodepoint(char);
    this.warn(
      'TYPOGRAPHIC_QUOTE_DELIMITER',
      'Unicode typographic quote ' +
        char +
        ' (' +
        codepoint +
        ') is not an attribute ' +
        field +
        ' delimiter; the ' +
        field +
        ' is used literally, which ' +
        'usually produces broken output. Use a straight quote (\' or ") or ' +
        'remove the quotes — your editor may have auto-replaced them.',
    );
  }

  assertNestingCorrect(exp) {
    if (isNesting(exp)) {
      this.error(
        'INCORRECT_NESTING',
        'Nesting must match on expression `' + exp + '`',
      );
    }
  }

  tok(type, val) {
    const start = this.sourceLocation(this.lineno, this.colno);
    const res = {
      type: type,
      loc: {
        start,
        filename: this.filename,
      },
    };

    if (val !== undefined) res.val = val;

    return res;
  }

  tokEnd(tok) {
    tok.loc.end = this.sourceLocation(this.lineno, this.colno);
    return tok;
  }

  sourceLocation(line, column) {
    if (!this.locationMap) return {line, column};

    const lineStart = this.generatedLineStarts[line - 1];
    const offset =
      lineStart === undefined
        ? this.locationMap.length - 1
        : lineStart + column - 1;
    const boundedOffset = Math.max(
      0,
      Math.min(offset, this.locationMap.length - 1),
    );
    const mapped = this.locationMap[boundedOffset];
    return {line: mapped.line, column: mapped.column};
  }

  sourceLocationMap(source) {
    let line = this.lineno;
    let column = this.colno;
    const locations = [this.sourceLocation(line, column)];

    for (let i = 0; i < source.length; i++) {
      if (source[i] === '\n') {
        line++;
        column = 1;
      } else {
        column++;
      }
      locations.push(this.sourceLocation(line, column));
    }

    return locations;
  }

  incrementLine(increment) {
    this.lineno += increment;
    if (increment) this.colno = 1;
  }

  incrementColumn(increment) {
    this.colno += increment;
  }

  locationAfter(source) {
    let newlineCount = 0;
    let lastNewline = -1;

    for (let i = 0; i < source.length; i++) {
      if (source[i] === '\n') {
        newlineCount++;
        lastNewline = i;
      }
    }

    if (!newlineCount) {
      return {line: this.lineno, column: this.colno + source.length};
    }

    return {
      line: this.lineno + newlineCount,
      column: source.length - lastNewline,
    };
  }

  advanceLocation(source) {
    const location = this.locationAfter(source);
    this.lineno = location.line;
    this.colno = location.column;
  }

  consume(len) {
    this.input = this.input.slice(len);
  }

  scan(regexp, type) {
    let captures;
    if ((captures = regexp.exec(this.input))) {
      const len = captures[0].length;
      const val = captures[1];
      const diff = len - (val ? val.length : 0);
      const tok = this.tok(type, val);
      this.consume(len);
      this.incrementColumn(diff);
      return tok;
    }
  }
  scanEndOfLine(regexp, type) {
    const captures = regexp.exec(this.input);
    if (!captures) return;

    const rest = this.input.slice(captures[0].length);
    const followedByColon = rest[0] === ':';
    const followedByEndOfLine = /^[ \t]*(\n|$)/.test(rest);

    if (!followedByColon && !followedByEndOfLine) return;

    // Match accepted — consume input and emit token
    const leadingSpaces = /^([ ]+)/.exec(captures[0]);
    const whitespaceLength = leadingSpaces ? leadingSpaces[1].length : 0;
    this.incrementColumn(whitespaceLength);

    if (followedByColon) {
      this.input = rest;
    } else {
      this.input = rest.slice(/^[ \t]*/.exec(rest)[0].length);
    }

    const tok = this.tok(type, captures[1]);
    this.incrementColumn(captures[0].length - whitespaceLength);
    return tok;
  }

  consumeEndOfLinePadding() {
    const padding = /^[ \t]+(?=\n|$)/.exec(this.input);
    if (!padding) return;

    this.consume(padding[0].length);
    this.incrementColumn(padding[0].length);
  }

  bracketExpression(skip) {
    skip = skip || 0;
    const start = this.input[skip];
    const end = bracketPairs[start];
    if (!end) {
      throw new Error('The start character should be "(", "{" or "["');
    }
    let range;
    try {
      range = parseExpressionUntil(this.input, end, skip + 1);
    } catch (ex) {
      if (ex.index !== undefined) {
        this.advanceLocation(this.input.slice(0, ex.index));
      }
      if (ex.code === 'CHARACTER_PARSER:END_OF_STRING_REACHED') {
        this.error(
          'NO_END_BRACKET',
          'The end of the string reached with no closing bracket ' +
            end +
            ' found.',
        );
      }
      throw ex;
    }
    return range;
  }

  scanIndentation() {
    let captures, re;

    // established regexp
    if (this.indentRe) {
      captures = this.indentRe.exec(this.input);
      // determine regexp
    } else {
      // tabs
      re = /^\n(\t*) */;
      captures = re.exec(this.input);

      // spaces
      if (captures && !captures[1].length) {
        re = /^\n( *)/;
        captures = re.exec(this.input);
      }

      // established
      if (captures && captures[1].length) this.indentRe = re;
    }

    return captures;
  }

  collectIndentedBlockLines(minIndent) {
    const lines = [];
    let consumed = 0;
    let termination = 'end-of-source';

    while (consumed < this.input.length) {
      if (this.input[consumed] !== '\n') {
        termination = 'same-line-content';
        break;
      }

      const start = consumed + 1;
      let end = this.input.indexOf('\n', start);
      if (end === -1) end = this.input.length;

      const raw = this.input.slice(start, end);
      const captures = this.indentRe.exec('\n' + raw);
      const indent = captures ? captures[1].length : 0;
      const blank = !raw.trim();
      if (!blank && indent < minIndent) {
        termination = 'outdent';
        break;
      }

      lines.push({
        raw,
        indent,
        blank,
        indented: indent >= minIndent,
        span: {start: consumed, contentStart: start, end},
      });
      consumed = end;
    }

    return {lines, consumed, termination};
  }

  /**
   * end-of-source.
   */

  eos() {
    if (this.input.length) return;
    if (this.interpolated) {
      this.error(
        'NO_END_BRACKET',
        'End of line was reached with no closing bracket for interpolation.',
      );
    }
    for (let i = 0; this.indentStack[i]; i++) {
      this.tokens.push(this.tokEnd(this.tok('outdent')));
    }
    this.tokens.push(this.tokEnd(this.tok('eos')));
    this.ended = true;
    return true;
  }

  /**
   * Blank line.
   */

  blank() {
    let captures;
    if ((captures = /^\n[ \t]*\n/.exec(this.input))) {
      this.consume(captures[0].length - 1);
      this.incrementLine(1);
      return true;
    }
  }

  /**
   * Comment.
   */

  comment() {
    let captures;
    if ((captures = /^\/\/(-)?([^\n]*)/.exec(this.input))) {
      this.consume(captures[0].length);
      const tok = this.tok('comment', captures[2]);
      tok.buffer = '-' !== captures[1];
      this.interpolationAllowed = tok.buffer;
      this.tokens.push(tok);
      this.incrementColumn(captures[0].length);
      this.tokEnd(tok);
      this.pipelessText();
      return true;
    }
  }

  /**
   * Escaped tag.
   *
   * A backslash before a valid tag name escapes keyword meaning,
   * forcing it to be treated as an HTML element name.
   * e.g. \extends → <extends>, \yield → <yield>
   */

  escapedTag() {
    if (this.input[0] !== '\\') return;
    if (/^\\[0-9_]/.test(this.input)) {
      this.consume(1);
      this.incrementColumn(1);
      return this.invalidTagName();
    }
    if (!/^\\([A-Za-z](?:[-:\w]*\w)?)/.test(this.input)) return;
    this.consume(1);
    this.incrementColumn(1);
    return this.tag();
  }

  invalidTagName() {
    this.error('INVALID_TAG_NAME', 'Tag names must start with an ASCII letter');
  }

  /**
   * Tag.
   */

  tag() {
    let captures;

    if ((captures = /^([A-Za-z](?:[-:\w]*\w)?)/.exec(this.input))) {
      let tok,
        name = captures[1],
        len = captures[0].length;
      this.consume(len);
      tok = this.tok('tag', name);
      this.tokens.push(tok);
      this.incrementColumn(len);
      this.tokEnd(tok);
      return true;
    }
  }

  /**
   * Filter.
   */

  filter(opts) {
    const tok =
      this.scan(/^:([\w-]+(?:\.[\w-]+)*)/, 'filter') ||
      this.scan(/^:'([^'\r\n]+)'/, 'filter') ||
      this.scan(/^:"([^"\r\n]+)"/, 'filter');

    const quote = this.input[0] === ':' ? this.input[1] : null;
    if (!tok && (quote === "'" || quote === '"')) {
      const close = this.input.indexOf(quote, 2);
      const newline = this.input.search(/[\r\n]/);
      if (close === -1 || (newline !== -1 && newline < close)) {
        this.incrementColumn(1);
        this.error(
          'MALFORMED_FILTER',
          'Quoted filter names must close on the same line.',
        );
      }
    }

    const inInclude = opts && opts.inInclude;
    if (tok) {
      this.tokens.push(tok);
      this.incrementColumn(tok.val.length);
      this.tokEnd(tok);
      this.attrs();
      if (!inInclude) {
        this.consumeEndOfLinePadding();
        this.interpolationAllowed = false;
        this.pipelessText();
      }
      return true;
    }
  }

  /**
   * Id.
   */

  id() {
    const tok = this.scan(/^#([\w-]+)/, 'id');
    if (tok) {
      this.tokens.push(tok);
      this.incrementColumn(tok.val.length);
      this.tokEnd(tok);
      return true;
    }
    if (/^#/.test(this.input) && !/^#[({]/.test(this.input)) {
      this.error(
        'INVALID_ID',
        '"' +
          (/.[^ \t\(\#\.\:]*/.exec(this.input.slice(1)) || [''])[0] +
          '" is not a valid ID.',
      );
    }
  }

  /**
   * Class.
   */

  className() {
    const tok = this.scan(/^\.([_a-z0-9\-]*[_a-z][_a-z0-9\-]*)/i, 'class');
    if (tok) {
      this.tokens.push(tok);
      this.incrementColumn(tok.val.length);
      this.tokEnd(tok);
      return true;
    }
    if (/^\.[_a-z0-9\-]+/i.test(this.input)) {
      this.error(
        'INVALID_CLASS_NAME',
        'Class names must contain at least one letter or underscore.',
      );
    }
    if (/^\./.test(this.input)) {
      this.error(
        'INVALID_CLASS_NAME',
        '"' +
          (/.[^ \t\(\#\.\:]*/.exec(this.input.slice(1)) || [''])[0] +
          '" is not a valid class name.  Class names can only contain "_", "-", a-z, A-Z and 0-9, and must contain at least one of "_", a-z or A-Z',
      );
    }
  }

  /**
   * Text.
   */
  endInterpolation() {
    if (this.interpolated && this.input[0] === ')') {
      this.input = this.input.slice(1);
      this.ended = true;
      return true;
    }
  }
  addText(type, value, prefix, escaped) {
    let tok;
    prefix = prefix || '';
    escaped = escaped || 0;
    // Candidate handlers consume their own syntax, but the surrounding text's
    // ordinary parenthesis depth must survive each dispatch.
    let parenDepth = 0;

    while (true) {
      let earliest;
      let scanPos = 0;

      for (;;) {
        earliest = this.findEarliestCandidate(value, scanPos, parenDepth);

        if (!earliest) {
          value = prefix + value.substring(scanPos);
          tok = this.tok(type, value);
          this.incrementColumn(value.length + escaped);
          this.tokens.push(this.tokEnd(tok));
          return;
        }

        parenDepth = earliest.parenDepth;
        if (earliest.kind !== 'escaped') {
          prefix = prefix + value.substring(scanPos, earliest.pos);
          value = value.substring(earliest.pos);
          earliest.pos = 0;
          break;
        }

        const segment = value.substring(scanPos, earliest.pos);
        // Sigil-specific escapes like \*( produce literals containing brackets
        // that the end-of-interpolation scanner would count for depth. Track them.
        // Standalone delimiter escapes (\(, \), \\, \', \") produce single-char
        // literals that are text content, not bracket structure.
        if (earliest.literal.length > 1) {
          for (let ci = 0; ci < earliest.literal.length; ci++) {
            if (earliest.literal[ci] === '(') parenDepth++;
            else if (earliest.literal[ci] === ')' && parenDepth > 0)
              parenDepth--;
          }
        }

        prefix = prefix + segment + earliest.literal;
        scanPos = earliest.pos + 1 + earliest.literal.length;
        escaped++;
      }

      if (earliest.kind === 'end') {
        if (prefix + value.substring(0, earliest.pos)) {
          const tok = this.tok(type, prefix + value.substring(0, earliest.pos));
          this.incrementColumn(prefix.length + earliest.pos + escaped);
          this.tokens.push(this.tokEnd(tok));
        }
        this.ended = true;
        this.input = value.slice(earliest.pos + 1) + this.input;
        return;
      }

      const remainder = this._processInlineElement(
        type,
        value,
        prefix,
        escaped,
        earliest,
      );
      value = remainder;
      prefix = '';
      escaped = 0;
    }
  }

  _processInlineElement(type, value, prefix, escaped, earliest) {
    switch (earliest.kind) {
      case 'interpolation':
        return this.handleInterpolation(
          type,
          value,
          prefix,
          escaped,
          earliest.pos,
        );

      case 'link':
        return this.handleLinkShorthand(
          type,
          value,
          prefix,
          escaped,
          earliest.pos,
        );

      case 'image':
        return this.handleImageShorthand(
          type,
          value,
          prefix,
          escaped,
          earliest.pos,
        );

      case 'reference':
      case 'ref-image':
      case 'footnote-ref': {
        const bt = bracketShorthands.find((t) => t.kind === earliest.kind);
        return this[bt.handler](type, value, prefix, escaped, earliest.pos);
      }

      case 'strong':
      case 'emphasis':
      case 'del':
      case 'ins':
      case 'sup':
      case 'kbd':
      case 'sub': {
        const shorthand = inlineShorthands[earliest.kind];
        return this.handleInlineShorthand(
          type,
          value,
          prefix,
          escaped,
          earliest.pos,
          shorthand.tag,
          shorthand.sigil,
          shorthand.name || shorthand.tag,
        );
      }

      case 'abbr':
        return this.handleAbbrShorthand(
          type,
          value,
          prefix,
          escaped,
          earliest.pos,
        );

      case 'code':
        return this.handleCodeShorthand(
          type,
          value,
          prefix,
          escaped,
          earliest.pos,
        );

      case 'variable':
        return this.handleVariableRef(type, value, prefix, escaped, earliest);

      case 'invalid-variable':
        this.incrementColumn(prefix.length + earliest.pos + escaped);
        this.raiseVariableError(earliest.variable);
        return;

      default:
        // The shorthand tables (parenShorthands/bracketShorthands) and this
        // switch must be extended together. If a new shorthand kind is added
        // to a table but its case is forgotten here, the switch would return
        // undefined and corrupt the addText loop with an uncoded TypeError far
        // from the mistake. Fail loudly and locally instead.
        this.error(
          'LEXER_BUG',
          'Unhandled inline element kind: ' + earliest.kind,
        );
    }
  }

  findEarliestCandidate(value, startPos, initialParenDepth) {
    startPos = startPos || 0;
    const interpolated = this.interpolated;
    const interpolationAllowed = this.interpolationAllowed;

    // Single left-to-right scan returning the earliest inline candidate. The
    // candidate kinds are positionally disjoint (each begins with a distinct
    // character or sigil+delimiter pair), so the first position carrying any
    // candidate is the earliest — no need to run a separate full-tail indexOf
    // per construct and sort, which scanned O(constructs * tail) on every call
    // and made a line of N escapes/shorthands O(N^2).
    let parenDepth = initialParenDepth || 0;
    for (let i = startPos; i < value.length; i++) {
      const ch = value[i];

      if (ch === '\\') {
        if (interpolationAllowed) {
          const next = value[i + 1];
          if (next === '\\') {
            return {pos: i, kind: 'escaped', literal: '\\', parenDepth};
          }
          const after = value[i + 2];
          if (after === '(' && parenShorthandBySigil[next] !== undefined) {
            return {
              pos: i,
              kind: 'escaped',
              literal: next + '(',
              parenDepth,
            };
          }
          if (after === '[' && bracketShorthandBySigil[next] !== undefined) {
            return {
              pos: i,
              kind: 'escaped',
              literal: next + '[',
              parenDepth,
            };
          }
          if (
            interpolated &&
            (next === '(' || next === ')' || next === "'" || next === '"')
          ) {
            return {pos: i, kind: 'escaped', literal: next, parenDepth};
          }
          if (next === '#' && after === '{') {
            return {pos: i, kind: 'escaped', literal: '#{', parenDepth};
          }
        }
        // Backslash that is not a recognized escape: skip the escaped char so
        // it cannot start a construct or count toward interpolation paren depth
        // (matches the original paren-tracking pass, which skipped 2 on '\\').
        i++;
        continue;
      }

      if (interpolationAllowed) {
        const next = value[i + 1];
        if (next === '(' && parenShorthandBySigil[ch] !== undefined) {
          return {
            pos: i,
            kind: parenShorthandBySigil[ch],
            parenDepth,
          };
        }
        if (next === '[' && bracketShorthandBySigil[ch] !== undefined) {
          return {
            pos: i,
            kind: bracketShorthandBySigil[ch],
            parenDepth,
          };
        }
        if (ch === '#' && next === '{') {
          const variable = parseVariableAt(value, i);
          return {
            pos: i,
            kind: variable.error ? 'invalid-variable' : 'variable',
            variable,
            parenDepth,
          };
        }
      }

      if (interpolated) {
        if (ch === '(') {
          parenDepth++;
        } else if (ch === ')') {
          if (parenDepth > 0) {
            parenDepth--;
          } else {
            return {pos: i, kind: 'end', parenDepth};
          }
        }
      }
    }

    return null;
  }

  createChildLexer(input, locationMap, options) {
    options = options || {};
    if (options.nested && this.depth >= MAX_INLINE_ELEMENT_DEPTH) {
      this.error(
        'NESTING_TOO_DEEP',
        `Template nesting exceeds maximum depth of ${MAX_TEMPLATE_DEPTH}`,
      );
    }
    const child = new this.constructor(input, {
      filename: this.filename,
      interpolated: options.interpolated,
      interpolationAllowed: this.interpolationAllowed,
      depth: this.depth + (options.nested ? 1 : 0),
      originalInput: this.originalInput,
      locationMap,
      warnings: this.warnings,
    });
    return child;
  }

  spawnChildLexer(input, locationMap) {
    const child = this.createChildLexer(input, locationMap, {
      interpolated: true,
      nested: true,
    });
    child.getTokens();
    return child;
  }

  addMappedText(value, locationMap, options) {
    options = options || {};
    // Invoke the inline scanner directly: running the normal dispatch loop
    // would reinterpret an authored leading word as a tag. The child retains
    // the original nesting/escaping behavior but exposes only mapped tokens.
    const child = this.createChildLexer(value, locationMap, options);
    child.input = '';
    child.addText('text', value);
    const trailing = child.tokens[child.tokens.length - 1];
    // Synthetic shorthand children used to stop at an invented closing `)`
    // before addText could emit its final empty text token. Preserve that token
    // only for direct pipeless/reference text, where it was already observable.
    if (
      options.trimTrailingEmpty &&
      value &&
      trailing &&
      trailing.type === 'text' &&
      trailing.val === ''
    ) {
      child.tokens.pop();
    }
    for (let ti = 0; ti < child.tokens.length; ti++) {
      this.tokens.push(child.tokens[ti]);
    }
  }

  mapPipelessText(segments, startLine, indents) {
    let value = '';
    let locations = null;
    let endLine = startLine;
    let endColumn = 1;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const line = startLine + i;
      const trimmed = i === 0 ? segment.text : segment.text.trimStart();
      const trimmedColumns = segment.text.length - trimmed.length;
      const column = (segment.indented ? indents : 0) + trimmedColumns + 1;

      if (i === 0) {
        locations = [this.sourceLocation(line, column)];
      } else {
        value += ' ';
        locations.push(this.sourceLocation(line, column));
      }

      value += trimmed;
      for (let j = 1; j <= trimmed.length; j++) {
        locations.push(this.sourceLocation(line, column + j));
      }

      endLine = line;
      endColumn = (segment.indented ? indents : 0) + segment.text.length + 1;
    }

    return {value, locations, endLine, endColumn};
  }

  addSourceText(value) {
    if (value) {
      this.addMappedText(value, this.sourceLocationMap(value), {
        interpolated: true,
        nested: true,
        trimTrailingEmpty: true,
      });
    }
    this.advanceLocation(value);
  }

  addReferenceText(value) {
    const sourceMap = this.sourceLocationMap(value);
    const preparedMap = [sourceMap[0]];
    let prepared = '';

    for (let i = 0; i < value.length; ) {
      if (
        value[i] === '\\' &&
        (value[i + 1] === '@' ||
          value[i + 1] === '!' ||
          value[i + 1] === '^') &&
        value[i + 2] === '['
      ) {
        // Preserve one escape for the child scanner. Treating the authored
        // backslash separately and then escaping every live-looking opener
        // would produce two backslashes and reactivate the nested shorthand.
        prepared += '\\';
        preparedMap.push(sourceMap[i + 1]);
        prepared += value[i + 1];
        preparedMap.push(sourceMap[i + 2]);
        prepared += '[';
        preparedMap.push(sourceMap[i + 3]);
        i += 3;
        continue;
      }

      if (
        value[i] === '\\' &&
        i + 1 < value.length &&
        (value[i + 1] === '[' || value[i + 1] === ']' || value[i + 1] === '\\')
      ) {
        prepared += value[i + 1];
        preparedMap.push(sourceMap[i + 2]);
        i += 2;
        continue;
      }

      if (
        (value[i] === '@' || value[i] === '!' || value[i] === '^') &&
        value[i + 1] === '['
      ) {
        prepared += '\\';
        preparedMap.push(sourceMap[i]);
        prepared += value[i];
        preparedMap.push(sourceMap[i + 1]);
        prepared += '[';
        preparedMap.push(sourceMap[i + 2]);
        i += 2;
        continue;
      }

      prepared += value[i];
      preparedMap.push(sourceMap[i + 1]);
      i++;
    }

    this.addMappedText(prepared, preparedMap);
    this.advanceLocation(value);
  }

  startDesugaredElement(tag) {
    let tok = this.tok('start-interpolation');
    this.incrementColumn(2);
    this.tokens.push(this.tokEnd(tok));

    // The tag spelling is generated, so it is zero-width at the first authored
    // payload boundary. User-authored child text receives its own mapped span.
    tok = this.tok('tag', tag);
    this.tokens.push(this.tokEnd(tok));
  }

  generatedAttribute(name, value, interpolationSource) {
    // Generated attributes share the same zero-width origin policy as their
    // generated tag. Appended source attributes are parsed at physical spans.
    const tok = this.tok('attribute');
    tok.name = name;
    tok.val = value;
    retainAttributeInterpolationSource(tok, value, interpolationSource);
    this.tokens.push(this.tokEnd(tok));
  }

  handleInterpolation(type, value, prefix, escaped, pos) {
    let tok = this.tok(type, prefix + value.substring(0, pos));
    this.incrementColumn(prefix.length + pos + escaped);
    this.tokens.push(this.tokEnd(tok));
    tok = this.tok('start-interpolation');
    this.incrementColumn(2);
    this.tokens.push(this.tokEnd(tok));
    const remainder = value.slice(pos + 2);
    const end = findInterpolationEnd(remainder);
    // Keep the trailing caller text out of the child. Passing the whole suffix
    // makes a dense run of sibling #() tags normalize and scan shrinking tails,
    // turning linear source into quadratic work. An unclosed interpolation is
    // left intact so the child retains its established diagnostic path.
    const childInput = end === -1 ? remainder : remainder.slice(0, end + 1);
    const child = this.spawnChildLexer(
      childInput,
      this.sourceLocationMap(childInput),
    );
    const consumed = childInput.length - child.input.length - 1;
    this.advanceLocation(childInput.slice(0, consumed));
    for (let ti = 0; ti < child.tokens.length; ti++) {
      this.tokens.push(child.tokens[ti]);
    }
    tok = this.tok('end-interpolation');
    this.incrementColumn(1);
    this.tokens.push(this.tokEnd(tok));
    return child.input + remainder.slice(childInput.length);
  }

  parseShorthandContent(rest, errorPrefix, errorCode, label) {
    let range;
    try {
      range = parseTextUntil(rest, ')', 1);
    } catch (ex) {
      if (ex.code === 'CHARACTER_PARSER:END_OF_STRING_REACHED') {
        this.error('NO_END_BRACKET', errorPrefix);
      }
      throw ex;
    }
    const content = range.src;
    const after = rest.substring(range.end + 1);

    let url, text, urlStart, urlEnd, textStart;
    if (content.length > 0 && (content[0] === "'" || content[0] === '"')) {
      const quote = content[0];
      const endQuote = findClosingQuote(content, quote, 1);
      if (endQuote === -1) {
        this.error(errorCode, `Unclosed quote in ${label} URL.`);
      }
      urlStart = 1;
      urlEnd = endQuote;
      url = content.substring(1, endQuote);
      const afterUrl = content.substring(endQuote + 1);
      const trimmed = afterUrl.trimStart();
      text = trimmed || null;
      textStart = text === null ? null : content.length - trimmed.length;
    } else {
      const spaceIdx = content.indexOf(' ');
      urlStart = 0;
      urlEnd = spaceIdx === -1 ? content.length : spaceIdx;
      if (spaceIdx === -1 || !content.substring(spaceIdx + 1)) {
        url = spaceIdx === -1 ? content : content.substring(0, spaceIdx);
        text = null;
        textStart = null;
      } else {
        url = content.substring(0, spaceIdx);
        text = content.substring(spaceIdx + 1);
        textStart = spaceIdx + 1;
      }
    }
    const decodedUrl = decodeResource(url);
    return {
      url: decodedUrl.value,
      urlInterpolationSource: decodedUrl.interpolationSource,
      rawUrl: url,
      text,
      urlStart,
      urlEnd,
      textStart,
      content,
      after,
    };
  }

  handleLinkShorthand(type, value, prefix, escaped, pos) {
    let tok = this.tok(type, prefix + value.substring(0, pos));
    this.incrementColumn(prefix.length + pos + escaped);
    this.tokens.push(this.tokEnd(tok));

    const rest = value.substring(pos + 1);
    const parsed = this.parseShorthandContent(
      rest,
      'End of line reached with no closing ) for @() link shorthand.',
      'INVALID_LINK',
      '@() link',
    );
    this.startDesugaredElement('a');

    tok = this.tok('start-attributes');
    this.tokens.push(this.tokEnd(tok));
    this.generatedAttribute('href', parsed.url, parsed.urlInterpolationSource);
    tok = this.tok('end-attributes');
    this.tokens.push(this.tokEnd(tok));

    const linkText = parsed.text !== null ? parsed.text : parsed.rawUrl;
    const textStart = parsed.text !== null ? parsed.textStart : parsed.urlStart;
    this.advanceLocation(parsed.content.slice(0, textStart));
    this.addSourceText(linkText);
    this.advanceLocation(parsed.content.slice(textStart + linkText.length));

    tok = this.tok('end-interpolation');
    this.incrementColumn(1);
    this.tokens.push(this.tokEnd(tok));
    return parsed.after;
  }

  handleImageShorthand(type, value, prefix, escaped, pos) {
    let tok = this.tok(type, prefix + value.substring(0, pos));
    this.incrementColumn(prefix.length + pos + escaped);
    this.tokens.push(this.tokEnd(tok));

    const rest = value.substring(pos + 1);
    const parsed = this.parseShorthandContent(
      rest,
      'End of line reached with no closing ) for !() image shorthand.',
      'INVALID_IMAGE',
      '!() image',
    );
    const decodedAlt =
      parsed.text !== null
        ? decodeResource(parsed.text)
        : {value: '', interpolationSource: ''};
    let afterImage = parsed.after;
    let attrRange = null;
    if (afterImage.startsWith('(')) {
      try {
        attrRange = parseExpressionUntil(afterImage, ')', 1);
      } catch (ex) {
        if (ex.code === 'CHARACTER_PARSER:END_OF_STRING_REACHED') {
          this.error(
            'NO_END_BRACKET',
            'End of line reached with no closing ) for !() image attributes.',
          );
        }
        throw ex;
      }
    }

    this.startDesugaredElement('img');
    tok = this.tok('start-attributes');
    this.tokens.push(this.tokEnd(tok));
    this.generatedAttribute('src', parsed.url, parsed.urlInterpolationSource);
    this.generatedAttribute(
      'alt',
      decodedAlt.value,
      decodedAlt.interpolationSource,
    );

    this.advanceLocation(parsed.content);
    if (attrRange) {
      this.incrementColumn(1); // primary shorthand close
      this.incrementColumn(1); // appended attribute block open
      let attrs = attrRange.src;
      while (attrs) attrs = this.attribute(attrs);
      this.incrementColumn(1); // appended attribute block close
      afterImage = afterImage.substring(attrRange.end + 1);

      tok = this.tok('end-attributes');
      this.tokens.push(this.tokEnd(tok));
      tok = this.tok('end-interpolation');
      this.tokens.push(this.tokEnd(tok));
    } else {
      tok = this.tok('end-attributes');
      this.tokens.push(this.tokEnd(tok));
      tok = this.tok('end-interpolation');
      this.incrementColumn(1);
      this.tokens.push(this.tokEnd(tok));
    }
    return afterImage;
  }

  handleAbbrShorthand(type, value, prefix, escaped, pos) {
    let tok = this.tok(type, prefix + value.substring(0, pos));
    this.incrementColumn(prefix.length + pos + escaped);
    this.tokens.push(this.tokEnd(tok));

    const rest = value.substring(pos + 1);
    const parsed = this.parseShorthandContent(
      rest,
      'End of line reached with no closing ) for ?() abbr shorthand.',
      'INVALID_ABBR',
      '?() abbr',
    );
    // parsed.url = first word (the abbreviation), unescaped for attributes
    // parsed.rawUrl = raw abbreviation, for visible text
    // parsed.text = rest (the expansion), or null if no space
    const decodedExpansion =
      parsed.text !== null
        ? decodeResource(parsed.text)
        : {value: '', interpolationSource: ''};

    this.startDesugaredElement('abbr');
    if (decodedExpansion.value) {
      tok = this.tok('start-attributes');
      this.tokens.push(this.tokEnd(tok));
      this.generatedAttribute(
        'title',
        decodedExpansion.value,
        decodedExpansion.interpolationSource,
      );
      tok = this.tok('end-attributes');
      this.tokens.push(this.tokEnd(tok));
    }

    this.advanceLocation(parsed.content.slice(0, parsed.urlStart));
    this.addSourceText(parsed.rawUrl);
    this.advanceLocation(parsed.content.slice(parsed.urlEnd));

    tok = this.tok('end-interpolation');
    this.incrementColumn(1);
    this.tokens.push(this.tokEnd(tok));
    return parsed.after;
  }

  handleInlineShorthand(type, value, prefix, escaped, pos, tag, sigil, name) {
    let tok = this.tok(type, prefix + value.substring(0, pos));
    this.incrementColumn(prefix.length + pos + escaped);
    this.tokens.push(this.tokEnd(tok));

    const rest = value.substring(pos + 1);
    let range;
    try {
      range = parseTextUntil(rest, ')', 1);
    } catch (ex) {
      if (ex.code === 'CHARACTER_PARSER:END_OF_STRING_REACHED') {
        this.error(
          'NO_END_BRACKET',
          `End of line reached with no closing ) for ${sigil}() ${name} shorthand.`,
        );
      }
      throw ex;
    }
    const afterShorthand = rest.substring(range.end + 1);
    this.startDesugaredElement(tag);
    this.addSourceText(range.src);

    tok = this.tok('end-interpolation');
    this.incrementColumn(1);
    this.tokens.push(this.tokEnd(tok));
    return afterShorthand;
  }

  handleCodeShorthand(type, value, prefix, escaped, pos) {
    let tok = this.tok(type, prefix + value.substring(0, pos));
    this.incrementColumn(prefix.length + pos + escaped);
    this.tokens.push(this.tokEnd(tok));

    const rest = value.substring(pos + 1);
    let range;
    try {
      range = parseTextUntil(rest, ')', 1);
    } catch (ex) {
      if (ex.code === 'CHARACTER_PARSER:END_OF_STRING_REACHED') {
        this.error(
          'NO_END_BRACKET',
          'End of line reached with no closing ) for `() code shorthand.',
        );
      }
      throw ex;
    }
    const content = unescapeCodeSpan(range.src);

    tok = this.tok('start-interpolation');
    this.incrementColumn(2);
    this.tokens.push(this.tokEnd(tok));

    // The synthetic `code` tag occupies zero source columns (the
    // `start-interpolation` above already advanced past the opener), so there
    // is no column increment here.
    tok = this.tok('tag', 'code');
    this.tokens.push(this.tokEnd(tok));

    tok = this.tok('text', content);
    this.incrementColumn(range.src.length);
    this.tokens.push(this.tokEnd(tok));

    tok = this.tok('end-interpolation');
    this.incrementColumn(1);
    this.tokens.push(this.tokEnd(tok));

    return rest.substring(range.end + 1);
  }

  handleRefLink(type, value, prefix, escaped, pos) {
    let tok = this.tok(type, prefix + value.substring(0, pos));
    this.incrementColumn(prefix.length + pos + escaped);
    this.tokens.push(this.tokEnd(tok));

    const inner = value.substring(pos + 2); // after @[
    const result = parseBracketContent(inner, 0);
    if (!result) {
      this.error(
        'NO_END_BRACKET',
        'End of line reached with no closing ] for @[] reference link.',
      );
    }
    const content = inner.substring(0, result.end);
    let afterLink = inner.substring(result.end + 1);

    // Extract identifier (first word) and optional link text
    const spaceIdx = content.indexOf(' ');
    let name, linkText;
    if (spaceIdx === -1) {
      name = content;
      linkText = null;
    } else {
      name = content.substring(0, spaceIdx);
      linkText = content.substring(spaceIdx + 1);
    }

    if (!name) {
      this.error(
        'INVALID_REF_LINK',
        'Reference link @[] requires an identifier.',
      );
    }

    tok = this.tok('start-ref-link');
    tok.val = name;
    this.incrementColumn(2); // @[
    this.tokens.push(this.tokEnd(tok));

    if (linkText) {
      this.incrementColumn(name.length + 1);
      const savedInterpolated = this.interpolated;
      this.interpolated = false;
      try {
        // addText can throw (e.g. unclosed inline shorthand in the link text);
        // restore in finally so the flag does not leak, mirroring the
        // try/finally-guarded this.input swap for trailing attrs below.
        this.addReferenceText(linkText);
      } finally {
        this.interpolated = savedInterpolated;
      }
    } else {
      this.incrementColumn(name.length);
    }

    tok = this.tok('end-ref-link');
    this.incrementColumn(1); // ]
    this.tokens.push(this.tokEnd(tok));

    // Support (attrs) immediately after ]: @[name text](class="x")
    if (afterLink.startsWith('(')) {
      const savedInput = this.input;
      this.input = afterLink;
      try {
        this.attrs();
        afterLink = this.input;
      } finally {
        this.input = savedInput;
      }
    }

    return afterLink;
  }

  handleRefImage(type, value, prefix, escaped, pos) {
    let tok = this.tok(type, prefix + value.substring(0, pos));
    this.incrementColumn(prefix.length + pos + escaped);
    this.tokens.push(this.tokEnd(tok));

    const inner = value.substring(pos + 2); // after ![
    const result = parseBracketContent(inner, 0);
    if (!result) {
      this.error(
        'NO_END_BRACKET',
        'End of line reached with no closing ] for ![] reference image.',
      );
    }
    const content = inner.substring(0, result.end);
    let afterImage = inner.substring(result.end + 1);

    const spaceIdx = content.indexOf(' ');
    let name, altText;
    if (spaceIdx === -1) {
      name = content;
      altText = null;
    } else {
      name = content.substring(0, spaceIdx);
      altText = content.substring(spaceIdx + 1);
    }

    if (!name) {
      this.error(
        'INVALID_REF_IMAGE',
        'Reference image ![] requires an identifier.',
      );
    }

    tok = this.tok('start-ref-image');
    tok.val = name;
    this.incrementColumn(2); // ![
    this.tokens.push(this.tokEnd(tok));

    if (altText) {
      // Alt text is emitted as a raw text token — not processed through addText —
      // because the linker extracts alt text by filtering for Text nodes only.
      // Expanding shorthands here would create Tag nodes the linker silently drops.
      const unescaped = altText.replace(/\\([\[\]\\])/g, '$1');
      this.incrementColumn(name.length + 1);
      const textTok = this.tok('text', unescaped);
      this.incrementColumn(altText.length);
      this.tokens.push(this.tokEnd(textTok));
    } else {
      this.incrementColumn(name.length);
    }

    tok = this.tok('end-ref-image');
    this.incrementColumn(1); // ]
    this.tokens.push(this.tokEnd(tok));

    // Support (attrs) immediately after ]: ![name alt](class="x")
    if (afterImage.startsWith('(')) {
      const savedInput = this.input;
      this.input = afterImage;
      try {
        this.attrs();
        afterImage = this.input;
      } finally {
        this.input = savedInput;
      }
    }

    return afterImage;
  }

  handleFootnoteRef(type, value, prefix, escaped, pos) {
    let tok = this.tok(type, prefix + value.substring(0, pos));
    this.incrementColumn(prefix.length + pos + escaped);
    this.tokens.push(this.tokEnd(tok));

    const inner = value.substring(pos + 2); // after ^[
    const result = parseBracketContent(inner, 0);
    if (!result) {
      this.error(
        'NO_END_BRACKET',
        'End of line reached with no closing ] for ^[] footnote reference.',
      );
    }
    const rawName = inner.substring(0, result.end);
    const name = rawName.trim();
    if (!name) {
      this.error(
        'INVALID_FOOTNOTE_REF',
        'Footnote reference ^[] requires an identifier.',
      );
    }

    tok = this.tok('start-footnote-ref');
    tok.val = name;
    this.incrementColumn(2); // ^[
    this.tokens.push(this.tokEnd(tok));
    this.incrementColumn(rawName.length);

    tok = this.tok('end-footnote-ref');
    this.incrementColumn(1); // ]
    this.tokens.push(this.tokEnd(tok));

    return inner.substring(result.end + 1);
  }

  handleVariableRef(type, value, prefix, escaped, candidate) {
    let tok;
    let before = value.slice(0, candidate.pos);
    if (prefix || before) {
      before = prefix + before;
      tok = this.tok(type, before);
      this.incrementColumn(before.length + escaped);
      this.tokens.push(this.tokEnd(tok));
    }

    tok = this.tok('start-interpolation');
    this.incrementColumn(2);
    this.tokens.push(this.tokEnd(tok));

    tok = this.tok('variable', candidate.variable.name);
    this.incrementColumn(candidate.variable.name.length);
    this.tokens.push(this.tokEnd(tok));

    tok = this.tok('end-interpolation');
    this.incrementColumn(1);
    this.tokens.push(this.tokEnd(tok));

    return value.slice(candidate.pos + candidate.variable.length);
  }

  text() {
    const tok =
      this.scan(/^(?:\| ?| )([^\n]+)/, 'text') ||
      this.scan(/^( )/, 'text') ||
      this.scan(/^\|( ?)/, 'text');
    if (tok) {
      this.addText('text', tok.val);
      return true;
    }
  }

  /**
   * Dot.
   */

  dot() {
    let tok;
    if ((tok = this.scanEndOfLine(/^\./, 'dot'))) {
      this.tokens.push(this.tokEnd(tok));
      this.pipelessText();
      return true;
    }
  }

  /**
   * Extends.
   */

  ['extends']() {
    const tok = this.scan(/^extends(?= |$|\n)/, 'extends');
    if (tok) {
      this.tokens.push(this.tokEnd(tok));
      if (!this.path()) {
        this.error('NO_EXTENDS_PATH', 'missing path for extends');
      }
      return true;
    }
    if (this.scan(/^extends\b/)) {
      this.error('MALFORMED_EXTENDS', 'malformed extends');
    }
  }

  /**
   * Block prepend.
   */

  blockDirective(regexp, mode) {
    let captures;
    if ((captures = regexp.exec(this.input))) {
      let name = captures[1].trim();
      let comment = '';
      if (name.indexOf('//') !== -1) {
        comment = '//' + name.split('//').slice(1).join('//');
        name = name.split('//')[0].trim();
      }
      if (!name) return;
      const tok = this.tok('block', name);
      let len = captures[0].length - comment.length;
      while (whitespaceRe.test(this.input.charAt(len - 1))) len--;
      this.incrementColumn(len);
      tok.mode = mode;
      this.tokens.push(this.tokEnd(tok));
      this.consume(captures[0].length - comment.length);
      this.incrementColumn(captures[0].length - comment.length - len);
      return true;
    }
  }

  prepend() {
    return this.blockDirective(/^(?:block +)?prepend +([^\n]+)/, 'prepend');
  }

  append() {
    return this.blockDirective(/^(?:block +)?append +([^\n]+)/, 'append');
  }

  block() {
    return this.blockDirective(/^block +([^\n]+)/, 'replace');
  }

  /**
   * Mixin Block.
   */

  mixinBlock() {
    let tok;
    if ((tok = this.scanEndOfLine(/^block/, 'mixin-block'))) {
      this.tokens.push(this.tokEnd(tok));
      return true;
    }
  }

  /**
   * Yield.
   */

  yield() {
    const tok = this.scanEndOfLine(/^yield/, 'yield');
    if (tok) {
      this.tokens.push(this.tokEnd(tok));
      return true;
    }
  }

  /**
   * Include.
   */

  include() {
    const tok = this.scan(/^include(?=:| |$|\n)/, 'include');
    if (tok) {
      this.tokens.push(this.tokEnd(tok));
      while (this.filter({inInclude: true}));
      if (!this.path()) {
        if (/^[^ \n]+/.test(this.input)) {
          // if there is more text
          this.fail();
        } else {
          // if not
          this.error('NO_INCLUDE_PATH', 'missing path for include');
        }
      }
      return true;
    }
    if (this.scan(/^include\b/)) {
      this.error('MALFORMED_INCLUDE', 'malformed include');
    }
  }

  /**
   * Path
   */

  path() {
    const tok = this.scanEndOfLine(/^ ([^\n]+)/, 'path');
    if (tok && (tok.val = tok.val.trim())) {
      this.tokens.push(this.tokEnd(tok));
      return true;
    }
  }

  raiseVariableError(variable) {
    if (variable.error === 'unclosed') {
      this.error(
        'NO_END_BRACKET',
        'End of line reached with no closing } for variable interpolation.',
      );
    }
    this.error(
      'INVALID_VARIABLE_NAME',
      '"' +
        variable.name +
        '" is not a valid variable name.' +
        ' Variable names may only contain letters, hyphens, underscores and question marks.',
    );
  }

  variable() {
    const variable = parseVariableAt(this.input, 0);
    if (variable) {
      if (variable.error) this.raiseVariableError(variable);
      const tok = this.tok('variable', variable.name);
      this.tokens.push(tok);
      this.incrementColumn(variable.length);
      this.consume(variable.length);
      this.tokEnd(tok);

      // A bare variable can immediately follow a tag or begin a mixin-body
      // expression. Once it has claimed that line as inline content, scan the
      // physical suffix in the same text context instead of redispatching an
      // identifier as a sibling tag or dropping a leading space delimiter.
      const newline = this.input.indexOf('\n');
      const continuation =
        newline === -1 ? this.input : this.input.substring(0, newline);
      if (continuation) {
        this.consume(continuation.length);
        this.addText('text', continuation);
      }
      return true;
    }
  }

  /**
   * Call mixin.
   */

  call() {
    let tok, captures, increment;
    if ((captures = /^\+[ \t]*([a-zA-Z][-\w]*)/.exec(this.input))) {
      increment = captures[0].length;
      tok = this.tok('call', captures[1]);
      this.consume(increment);
      this.incrementColumn(increment);

      tok.args = [];
      // Check for args (not attributes)
      // Arguments are separated by ASCII spaces, tabs, or newlines. Balanced
      // parentheses remain part of an unquoted argument. A leading quote
      // groups separator whitespace; outer quotes are stripped and a
      // backslash escapes the next quoted character.
      const argumentList = /^[ \t]*\(/.exec(this.input);
      if (argumentList) {
        const leading = argumentList[0];
        let range;
        try {
          range = parseExpressionUntil(this.input, ')', leading.length);
        } catch (ex) {
          if (ex.code === 'CHARACTER_PARSER:END_OF_STRING_REACHED') {
            this.advanceLocation(this.input.slice(0, ex.index));
            this.error(
              'NO_END_BRACKET',
              'End of source reached with no closing ) for mixin call arguments.',
            );
          }
          throw ex;
        }
        const argsStr = range.src;
        const increment = range.end + 1;
        const consumed = this.input.slice(0, increment);
        this.consume(increment);
        this.advanceLocation(consumed);

        // Parse arguments respecting quoted strings and escape sequences
        let j = 0;
        while (j < argsStr.length) {
          while (j < argsStr.length && whitespaceRe.test(argsStr[j])) j++;
          if (j >= argsStr.length) break;
          if (argsStr[j] === "'" || argsStr[j] === '"') {
            const quote = argsStr[j++];
            let arg = '';
            while (j < argsStr.length && argsStr[j] !== quote) {
              if (argsStr[j] === '\\' && j + 1 < argsStr.length) {
                j++; // skip backslash, include next char
              }
              arg += argsStr[j++];
            }
            if (j < argsStr.length) j++; // skip closing quote
            tok.args.push(arg);
          } else {
            let arg = '';
            while (j < argsStr.length && !whitespaceRe.test(argsStr[j])) {
              arg += argsStr[j++];
            }
            tok.args.push(arg);
          }
        }
      }
      this.tokens.push(this.tokEnd(tok));
      return true;
    }
  }

  /**
   * Mixin.
   */

  mixin() {
    const captures = /^mixin +([a-zA-Z][-\w]*)/.exec(this.input);
    if (!captures) return;

    let end = captures[0].length;
    while (this.input[end] === ' ') end++;

    let params = '';
    let paramsStart = end;
    if (this.input[end] === '(') {
      const lineEnd = this.input.indexOf('\n');
      const line =
        lineEnd === -1 ? this.input : this.input.substring(0, lineEnd);
      let range;
      try {
        range = parseExpressionUntil(line, ')', end + 1);
      } catch (ex) {
        if (ex.code === 'CHARACTER_PARSER:END_OF_STRING_REACHED') {
          if (Number.isInteger(ex.quoteStart)) {
            this.incrementColumn(ex.quoteStart);
            this.error(
              'INVALID_MIXIN_PARAM',
              'Unclosed quote in mixin parameter list.',
            );
          }
          this.advanceLocation(line.slice(0, ex.index));
          this.error(
            'NO_END_BRACKET',
            'End of line reached with no closing ) for mixin parameters.',
          );
        }
        throw ex;
      }
      params = range.src;
      paramsStart = end + 1;
      end = range.end + 1;
      while (this.input[end] === ' ') end++;
    }

    const tok = this.tok('mixin', captures[1]);
    tok.args = this.parseMixinParams(params, paramsStart);
    this.consume(end);
    this.incrementColumn(end);
    this.tokens.push(this.tokEnd(tok));
    return true;
  }

  /**
   * Parse mixin definition parameter list into an array of objects.
   * Each object has a `name` property and an optional `default` property.
   *
   * Supports:
   *   name              → { name: 'name' }
   *   name?             → { name: 'name?' }  (? is part of the name)
   *   name=value        → { name: 'name', default: 'value' }
   *   name?=value       → { name: 'name?', default: 'value' }
   *   name='val ue'     → { name: 'name', default: 'val ue' }
   *   name="val ue"     → { name: 'name', default: 'val ue' }
   */
  parseMixinParams(str, paramsStart) {
    const params = [];
    let i = 0;

    while (i < str.length) {
      // skip whitespace
      while (i < str.length && str[i] === ' ') i++;
      if (i >= str.length) break;

      // read parameter name: only characters valid for variable interpolation
      let name = '';
      while (i < str.length && variableNameRe.test(str[i])) {
        name += str[i++];
      }

      if (!name) {
        this.error(
          'INVALID_MIXIN_PARAM',
          'Invalid character in mixin parameter name: ' +
            JSON.stringify(str[i]),
        );
      }

      // check for default value
      if (i < str.length && str[i] === '=') {
        i++; // skip '='
        let dflt = '';
        if (i < str.length && (str[i] === "'" || str[i] === '"')) {
          // quoted default value with escape sequence support
          const quoteStart = i;
          const quote = str[i++];
          while (i < str.length && str[i] !== quote) {
            if (str[i] === '\\' && i + 1 < str.length) {
              i++; // skip backslash, include next char
            }
            dflt += str[i++];
          }
          if (i >= str.length) {
            this.incrementColumn(paramsStart + quoteStart);
            this.error(
              'INVALID_MIXIN_PARAM',
              'Unclosed quote in mixin parameter list.',
            );
          }
          i++; // skip closing quote
        } else {
          // unquoted default value
          while (i < str.length && str[i] !== ' ') {
            dflt += str[i++];
          }
        }
        params.push({name, default: dflt});
      } else {
        params.push({name});
      }
    }

    return params;
  }

  /**
   * References block.
   */

  references() {
    const tok = this.scanEndOfLine(/^references/, 'references');
    if (tok) {
      this.tokens.push(this.tokEnd(tok));
      this.referencesBlock();
      return true;
    }
  }

  referencesBlock() {
    while (this.blank());

    const captures = this.scanIndentation();
    const indents = captures && captures[1].length;
    if (!indents || indents <= this.indentStack[0]) return;

    const block = this.collectIndentedBlockLines(indents);
    for (const line of block.lines) {
      const content = line.raw.slice(indents).trim();
      if (content) {
        this.incrementLine(1);
        this.incrementColumn(indents);

        // Parse "name url" or "name 'quoted url'" or 'name "quoted url"'
        const spaceIdx = content.indexOf(' ');
        if (spaceIdx === -1) {
          this.error(
            'INVALID_REF_DEF',
            'Reference definition requires both a name and a URL: ' + content,
          );
        }
        const name = content.substring(0, spaceIdx);
        const rawRest = content.substring(spaceIdx + 1);
        const leadingRestWhitespace =
          rawRest.length - rawRest.trimStart().length;
        const restStart = spaceIdx + 1 + leadingRestWhitespace;
        const rest = rawRest.trim();
        let url;
        let urlInterpolationSource;
        let defaultText = null;

        // Handle quoted URLs (may be followed by default text)
        if (rest[0] === "'" || rest[0] === '"') {
          const quote = rest[0];
          const closeIdx = findClosingQuote(rest, quote, 1);
          if (closeIdx === -1) {
            this.incrementColumn(restStart);
            this.error(
              'INVALID_REF_DEF',
              'Unclosed quote in reference definition URL: ' + content,
            );
          }
          const decodedUrl = decodeResource(rest.substring(1, closeIdx));
          url = decodedUrl.value;
          urlInterpolationSource = decodedUrl.interpolationSource;
          const afterUrl = rest.substring(closeIdx + 1).trim();
          if (afterUrl) defaultText = afterUrl;
        } else {
          // Unquoted URL: first word is URL, rest is default text
          const urlEnd = rest.indexOf(' ');
          if (urlEnd === -1) {
            url = rest;
          } else {
            url = rest.substring(0, urlEnd);
            const afterUrl = rest.substring(urlEnd + 1).trim();
            if (afterUrl) defaultText = afterUrl;
          }
          urlInterpolationSource = url;
        }

        if (!url) {
          this.error(
            'INVALID_REF_DEF',
            'Reference definition requires a non-empty URL: ' + content,
          );
        }

        const tok = this.tok('ref-def');
        tok.name = name;
        tok.url = url;
        tok.defaultText = defaultText;
        retainAttributeInterpolationSource(tok, url, urlInterpolationSource);
        this.incrementColumn(content.length);
        this.tokens.push(this.tokEnd(tok));
      } else {
        this.incrementLine(1);
      }
    }
    this.consume(block.consumed);
  }

  /**
   * Doctype.
   */

  doctype() {
    const tok = this.scan(/^doctype html(?=[ \t]*(?:\n|$))/, 'text');
    if (tok) {
      tok.val = '<!DOCTYPE html>';
      this.tokens.push(this.tokEnd(tok));
      this.consumeEndOfLinePadding();
      return true;
    }
  }

  /**
   * Given.
   */

  given() {
    let captures;
    if ((captures = /^given +([^\n]+)/.exec(this.input))) {
      let name = captures[1].trim();
      if (name.indexOf('//') !== -1) {
        name = name.split('//')[0].trim();
      }
      if (!name) {
        this.error('MALFORMED_GIVEN', 'given requires a block name');
      }
      const tok = this.tok('given', name);
      // Span "given", any (possibly multiple) spaces, and the name — not a
      // hard-coded single space — so the token's loc.end.column is accurate
      // when extra spaces separate the keyword from the name.
      const namePos = captures[0].length - captures[1].length;
      let len = namePos + name.length;
      this.incrementColumn(len);
      this.tokens.push(this.tokEnd(tok));
      this.consume(captures[0].length);
      this.incrementColumn(captures[0].length - len);
      return true;
    }
    if (/^given\b/.test(this.input)) {
      this.error('MALFORMED_GIVEN', 'given requires a block name');
    }
  }

  /**
   * Table of contents.
   */

  toc() {
    const tok = this.scanEndOfLine(/^toc/, 'toc');
    if (tok) {
      this.tokens.push(this.tokEnd(tok));
      return true;
    }
  }

  /**
   * Footnotes block.
   */

  footnotes() {
    const tok = this.scanEndOfLine(/^footnotes/, 'footnotes');
    if (tok) {
      this.tokens.push(this.tokEnd(tok));
      this.footnotesBlock();
      return true;
    }
  }

  footnotesBlock() {
    while (this.blank());

    const captures = this.scanIndentation();
    const defIndent = captures && captures[1].length;
    if (!defIndent || defIndent <= this.indentStack[0]) return;

    const block = this.collectIndentedBlockLines(defIndent);
    this.consume(block.consumed);

    // Group lines into definitions. Tokens are emitted eagerly, line by line,
    // so each one is tagged with the line/column it physically occupies (the
    // same discipline referencesBlock uses). Deferring emission until the next
    // definition starts — after incrementLine has already advanced — is what
    // mis-attributed every footnote token to the following line.
    let defOpen = false;

    const closeDefinition = () => {
      if (!defOpen) return;
      this.tokens.push(this.tokEnd(this.tok('footnote-def-end')));
      defOpen = false;
    };

    for (let li = 0; li < block.lines.length; li++) {
      const line = block.lines[li];

      if (!line.raw.trim()) {
        this.incrementLine(1);
        continue;
      }

      if (line.indent <= defIndent) {
        // New definition starts. Close the previous one first, while the line
        // counter still points at its last content line.
        closeDefinition();
        this.incrementLine(1);

        const content = line.raw.slice(defIndent);
        const spaceIdx = content.indexOf(' ');
        const name =
          spaceIdx === -1 ? content.trim() : content.slice(0, spaceIdx);

        this.incrementColumn(defIndent);
        const startTok = this.tok('footnote-def-start');
        startTok.val = name;
        this.incrementColumn(name.length);
        this.tokens.push(this.tokEnd(startTok));
        defOpen = true;

        if (spaceIdx !== -1) {
          this.incrementColumn(1);
          this.addText('text', content.substring(spaceIdx + 1));
        }
      } else {
        // Continuation line of the current definition.
        this.incrementLine(1);
        const continuation = line.raw.slice(defIndent).trimStart();
        this.tokens.push(this.tokEnd(this.tok('newline')));
        this.incrementColumn(line.indent);
        this.addText('text', continuation);
      }
    }
    closeDefinition();
  }

  skipWhitespace(str, i) {
    for (; i < str.length; i++) {
      if (!whitespaceRe.test(str[i])) break;
      if (str[i] === '\n') {
        this.incrementLine(1);
      } else {
        this.incrementColumn(1);
      }
    }
    return i;
  }

  /**
   * Attribute name and value.
   */
  attribute(str) {
    let quote = '';
    const quoteRe = /['"]/;
    let key = '',
      value = '',
      interpolationValue = '';
    let i;

    // consume all whitespace before the key
    i = this.skipWhitespace(str, 0);

    if (i === str.length) {
      return '';
    }

    const tok = this.tok('attribute');

    // quote?
    if (quoteRe.test(str[i])) {
      quote = str[i];
      this.incrementColumn(1);
      i++;
    } else if (typographicQuoteRe.test(str[i])) {
      this.warnTypographicQuote(str[i], 'name');
    }

    // start looping through the key
    for (; i < str.length; i++) {
      if (quote) {
        if (str[i] === quote) {
          this.incrementColumn(1);
          i++;
          break;
        }
      } else {
        if (whitespaceRe.test(str[i]) || str[i] === '=') {
          break;
        }
      }

      key += str[i];

      if (str[i] === '\n') {
        this.incrementLine(1);
      } else {
        this.incrementColumn(1);
      }
    }

    const invalid = invalidAttributeNameCharacters(key);
    if (invalid.length !== 0) {
      this.error(
        'INVALID_ATTRIBUTE_NAME',
        'Code points not allowed in HTML attribute names: ' + invalid,
      );
    }

    tok.name = key;

    if (key === '') {
      this.error('EMPTY_ATTRIBUTE_NAME', 'Attribute name cannot be empty');
    }

    // consume all whitespace before the =
    i = this.skipWhitespace(str, i);

    if (str[i] === '=') {
      this.incrementColumn(1);
      ++i;

      // consume all whitespace after the =
      i = this.skipWhitespace(str, i);

      // quote?
      if (quoteRe.test(str[i])) {
        quote = str[i];
        this.incrementColumn(1);
        i++;
      } else {
        if (typographicQuoteRe.test(str[i])) {
          this.warnTypographicQuote(str[i], 'value');
        }
        quote = null;
      }

      // start looping through the value
      for (; i < str.length; i++) {
        const run = backslashRun(str, i);
        if (run) {
          if (run.variable) {
            value += '\\'.repeat(Math.ceil(run.length / 2));
            interpolationValue += '\\'.repeat(run.length);
            this.incrementColumn(run.length);
            i += run.length - 1;
            continue;
          }
          const pairLength = run.length - (run.length % 2);
          if (pairLength !== 0) {
            const decoded = '\\'.repeat(pairLength / 2);
            value += decoded;
            interpolationValue += decoded;
            this.incrementColumn(pairLength);
            i += pairLength - 1;
            continue;
          }
        }

        if (quote) {
          if (str[i] === quote) {
            this.incrementColumn(1);
            i++;
            break;
          }
          if (str[i] === '\\') {
            const escapeStart = i;
            let decoded;
            ++i;
            switch (str[i]) {
              case "'":
                decoded = "'";
                break;
              case '"':
                decoded = '"';
                break;
              case '\\':
                decoded = '\\';
                break;
              case 'n':
                decoded = '\n';
                break;
              case 't':
                decoded = '\t';
                break;
              default:
                decoded = '\\' + str[i];
                break;
            }
            value += decoded;
            interpolationValue += decoded;
            this.advanceLocation(str.slice(escapeStart, i + 1));
            continue;
          }
        } else {
          if (str[i] === '\\' && i + 1 < str.length) {
            const next = str[i + 1];
            if (next === '\\' || whitespaceRe.test(next)) {
              value += next;
              interpolationValue += next;
              this.incrementColumn(2);
              i++;
              continue;
            }
          }
          if (whitespaceRe.test(str[i])) {
            break;
          }
        }

        value += str[i];
        interpolationValue += str[i];

        if (str[i] === '\n') {
          this.incrementLine(1);
        } else {
          this.incrementColumn(1);
        }
      }
    } else {
      // was a boolean attribute (ex: `input(disabled)`)
      value = true;
    }

    tok.val = value;
    retainAttributeInterpolationSource(tok, value, interpolationValue);

    this.tokens.push(this.tokEnd(tok));

    if (quote && str[i] && !whitespaceRe.test(str[i])) {
      this.error(
        'MALFORMED_ATTRIBUTE',
        'Invalid code point after attribute value: `' + str[i] + '`',
      );
    }

    i = this.skipWhitespace(str, i);

    return str.slice(i);
  }

  /**
   * Attributes.
   */

  attrs() {
    let tok;

    if ('(' === this.input.charAt(0)) {
      tok = this.tok('start-attributes');
      const index = this.bracketExpression().end;
      let str = this.input.slice(1, index);

      this.incrementColumn(1);
      this.tokens.push(this.tokEnd(tok));
      this.assertNestingCorrect(str);
      this.consume(index + 1);

      while (str) {
        str = this.attribute(str);
      }

      tok = this.tok('end-attributes');
      this.incrementColumn(1);
      this.tokens.push(this.tokEnd(tok));
      return true;
    }
  }

  /**
   * Indent | Outdent | Newline.
   */

  indent() {
    const captures = this.scanIndentation();
    let tok;

    if (captures) {
      const indents = captures[1].length;

      this.incrementLine(1);
      this.consume(indents + 1);

      if (' ' === this.input[0] || '\t' === this.input[0]) {
        this.error(
          'INVALID_INDENTATION',
          'Invalid indentation, you can use tabs or spaces but not both',
        );
      }

      // blank line
      if ('\n' === this.input[0]) {
        this.interpolationAllowed = true;
        return this.tokEnd(this.tok('newline'));
      }

      // outdent
      if (indents < this.indentStack[0]) {
        let outdentCount = 0;
        while (this.indentStack[0] > indents) {
          if (this.indentStack[1] < indents) {
            this.error(
              'INCONSISTENT_INDENTATION',
              'Inconsistent indentation. Expecting either ' +
                this.indentStack[1] +
                ' or ' +
                this.indentStack[0] +
                ' spaces/tabs.',
            );
          }
          outdentCount++;
          this.indentStack.shift();
        }
        this.colno = indents + 1;
        while (outdentCount--) {
          this.tokens.push(this.tokEnd(this.tok('outdent')));
        }
        // indent
      } else if (indents && indents !== this.indentStack[0]) {
        tok = this.tok('indent', indents);
        this.colno = 1 + indents;
        this.tokens.push(this.tokEnd(tok));
        this.indentStack.unshift(indents);
        // newline
      } else {
        tok = this.tok('newline');
        this.colno = 1 + Math.min(this.indentStack[0] || 0, indents);
        this.tokens.push(this.tokEnd(tok));
      }

      this.interpolationAllowed = true;
      return true;
    }
  }

  pipelessText(indents) {
    while (this.blank());

    const captures = this.scanIndentation();

    indents = indents || (captures && captures[1].length);
    if (indents > this.indentStack[0]) {
      const block = this.collectIndentedBlockLines(this.indentStack[0] + 1);
      for (const line of block.lines) {
        if (!line.blank && line.indent < indents) indents = line.indent;
      }

      this.tokens.push(this.tokEnd(this.tok('start-pipeless-text')));
      const tokens = block.lines.map((line) => line.raw.slice(indents));
      const tokenIndents = block.lines.map((line) => line.indent >= indents);
      const consumedEnd = this.locationAfter(
        this.input.slice(0, block.consumed),
      );
      this.consume(block.consumed);
      while (this.input.length === 0 && tokens[tokens.length - 1] === '')
        tokens.pop();

      // Merge lines with unclosed inline shorthand constructs so that
      // inline elements can span multiple lines in text blocks.
      const merged = mergeMultiLineInterpolations(
        tokens,
        tokenIndents,
        this.interpolationAllowed,
      );

      for (let mi = 0; mi < merged.length; mi++) {
        let tok;
        const mapped = this.mapPipelessText(
          merged[mi].segments,
          this.lineno + 1,
          indents,
        );
        this.incrementLine(1);
        if (mi !== 0) tok = this.tok('newline');
        if (merged[mi].indented) this.incrementColumn(indents);
        if (tok) this.tokens.push(this.tokEnd(tok));
        this.addMappedText(mapped.value, mapped.locations);
        this.lineno = mapped.endLine;
        this.colno = mapped.endColumn;
      }
      this.lineno = consumedEnd.line;
      this.colno = consumedEnd.column;
      this.tokens.push(this.tokEnd(this.tok('end-pipeless-text')));
      return true;
    }
  }

  /**
   * ':'
   */

  colon() {
    const tok = this.scan(/^: +/, ':');
    if (tok) {
      this.tokens.push(this.tokEnd(tok));
      return true;
    }
  }

  fail() {
    const first = this.input[0];
    if (first && nonAsciiWhitespaceRe.test(first)) {
      const codepoint = formatCodepoint(first);
      this.error(
        'NON_ASCII_WHITESPACE',
        'Unexpected non-ASCII whitespace ' +
          codepoint +
          '. If this is indentation, use regular spaces or tabs — your ' +
          'editor may have inserted it.',
      );
    }

    const inlinePatterns = [];
    for (const t of parenShorthands) {
      inlinePatterns.push([
        new RegExp('^' + escapeForRegex(t.sigil) + '\\('),
        t.sigil + '(...) ' + t.label,
      ]);
    }
    for (const t of bracketShorthands) {
      inlinePatterns.push([
        new RegExp('^' + escapeForRegex(t.sigil) + '\\['),
        t.sigil + '[...] ' + t.label,
      ]);
    }
    for (const [re, name] of inlinePatterns) {
      if (re.test(this.input)) {
        this.error(
          'INLINE_SYNTAX_AT_LINE_START',
          name +
            ' can only appear inside text content,' +
            ' not at the start of a line.',
        );
      }
    }
    this.error(
      'UNEXPECTED_TEXT',
      'unexpected text "' + this.input.slice(0, 5) + '"',
    );
  }

  advance() {
    const first = this.input[0];

    if (first === undefined) return this.eos();

    switch (first) {
      case '\n':
        return this.blank() || this.indent() || this.fail();
      case ')':
        return this.endInterpolation() || this.fail();
      case '#':
        return this.variable() || this.id() || this.fail();
      case '\\':
        return this.escapedTag() || this.fail();
      case '+':
        return this.call() || this.fail();
      case ':':
        return this.filter() || this.colon() || this.fail();
      case '.':
        return this.dot() || this.className() || this.fail();
      case '(':
        return this.attrs() || this.fail();
      case ' ':
      case '|':
        return this.text() || this.fail();
      case '/':
        return this.comment() || this.fail();
      case 'a':
        if (this.append()) return true;
        break;
      case 'b':
        if (
          this.append() ||
          this.prepend() ||
          this.block() ||
          this.mixinBlock()
        ) {
          return true;
        }
        break;
      case 'd':
        if (this.doctype()) return true;
        break;
      case 'e':
        if (this['extends']()) return true;
        break;
      case 'f':
        if (this.footnotes()) return true;
        break;
      case 'g':
        if (this.given()) return true;
        break;
      case 'i':
        if (this.include()) return true;
        break;
      case 'm':
        if (this.mixin()) return true;
        break;
      case 'p':
        if (this.prepend()) return true;
        break;
      case 'r':
        if (this.references()) return true;
        break;
      case 't':
        if (this.toc()) return true;
        break;
      case 'y':
        if (this.yield()) return true;
        break;
    }

    if (first === '_' || (first >= '0' && first <= '9')) {
      return this.invalidTagName();
    }
    if (isTagStart(first)) return this.tag();
    return this.fail();
  }

  getTokens() {
    while (!this.ended) {
      this.advance();
    }
    return this.tokens;
  }
}
