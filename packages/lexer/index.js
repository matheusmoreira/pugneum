const error = require('pugneum-error');

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
const attributeName = new RegExp(
  '[^' + control + attributeNamePunctuation + noncharacter + ']',
  'g',
);

const whitespaceRe = /[ \n\t]/;

const bracketPairs = {'(': ')', '{': '}', '[': ']'};
const closingBrackets = {')': '(', '}': '{', ']': '['};

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

/**
 * Find the closing bracket matching the opener at position `start - 1`.
 * Respects quoted strings and escaped characters.
 *
 * @param {string} str - The string to search
 * @param {string} end - The closing bracket character to find
 * @param {number} start - The index to start searching from (after the opening bracket)
 * @returns {{end: number, src: string}}
 */
function parseUntil(str, end, start) {
  let depth = 1;
  let i = start;
  let quote = null;
  const open = closingBrackets[end];

  while (i < str.length) {
    const c = str[i];

    if (quote || c === "'" || c === '"') {
      ({i, quote} = scanChar(str, i, quote));
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

  const err = new Error(
    'The end of the string reached with no closing bracket ' + end + ' found.',
  );
  err.code = 'CHARACTER_PARSER:END_OF_STRING_REACHED';
  err.index = i;
  throw err;
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
 * Unescape backslash sequences in URL or text extracted from shorthand syntax.
 * Handles \( \) \\ \' \" escapes.
 *
 * @param {string} str - The string to unescape
 * @returns {string}
 */
function unescapeShorthand(str) {
  return str.replace(/\\([()\\'"])/g, '$1');
}

/**
 * Check whether a line has unclosed inline shorthand constructs.
 * Returns true if all constructs are closed (line is complete).
 */
function interpolationsAreClosed(str, state) {
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === "'" && !state.dq) {
      state.sq = !state.sq;
      continue;
    }
    if (ch === '"' && !state.sq) {
      state.dq = !state.dq;
      continue;
    }
    if (state.sq || state.dq) continue;
    if (ch === '#' && str[i + 1] === '(') {
      state.interp++;
      i++;
      continue;
    }
    if (ch === '@' && str[i + 1] === '[') {
      state.ref++;
      i++;
      continue;
    }
    if (ch === '!' && str[i + 1] === '[') {
      state.refImage++;
      i++;
      continue;
    }
    if (ch === ']') {
      if (state.refImage > 0) {
        state.refImage--;
        continue;
      }
      if (state.ref > 0) {
        state.ref--;
        continue;
      }
    }
    if (ch === '@' && str[i + 1] === '(') {
      state.link++;
      i++;
      continue;
    }
    if (state.link > 0) {
      if (ch === '(') {
        state.linkParen++;
        continue;
      }
      if (ch === ')') {
        if (state.linkParen > 0) state.linkParen--;
        else state.link--;
        continue;
      }
    }
    if (ch === '!' && str[i + 1] === '(') {
      state.image++;
      i++;
      continue;
    }
    if (state.image > 0) {
      if (ch === '(') {
        state.imageParen++;
        continue;
      }
      if (ch === ')') {
        if (state.imageParen > 0) state.imageParen--;
        else state.image--;
        continue;
      }
    }
    if (ch === '*' && str[i + 1] === '(') {
      state.strong++;
      i++;
      continue;
    }
    if (state.strong > 0) {
      if (ch === '(') {
        state.strongParen++;
        continue;
      }
      if (ch === ')') {
        if (state.strongParen > 0) state.strongParen--;
        else state.strong--;
        continue;
      }
    }
    if (ch === '_' && str[i + 1] === '(') {
      state.emphasis++;
      i++;
      continue;
    }
    if (state.emphasis > 0) {
      if (ch === '(') {
        state.emphasisParen++;
        continue;
      }
      if (ch === ')') {
        if (state.emphasisParen > 0) state.emphasisParen--;
        else state.emphasis--;
        continue;
      }
    }
    if (ch === '~' && str[i + 1] === '(') {
      state.del++;
      i++;
      continue;
    }
    if (state.del > 0) {
      if (ch === '(') {
        state.delParen++;
        continue;
      }
      if (ch === ')') {
        if (state.delParen > 0) state.delParen--;
        else state.del--;
        continue;
      }
    }
    if (ch === '&' && str[i + 1] === '(') {
      state.ins++;
      i++;
      continue;
    }
    if (state.ins > 0) {
      if (ch === '(') {
        state.insParen++;
        continue;
      }
      if (ch === ')') {
        if (state.insParen > 0) state.insParen--;
        else state.ins--;
        continue;
      }
    }
    if (ch === '^' && str[i + 1] === '(') {
      state.sup++;
      i++;
      continue;
    }
    if (state.sup > 0) {
      if (ch === '(') {
        state.supParen++;
        continue;
      }
      if (ch === ')') {
        if (state.supParen > 0) state.supParen--;
        else state.sup--;
        continue;
      }
    }
    if (ch === '%' && str[i + 1] === '(') {
      state.kbd++;
      i++;
      continue;
    }
    if (state.kbd > 0) {
      if (ch === '(') {
        state.kbdParen++;
        continue;
      }
      if (ch === ')') {
        if (state.kbdParen > 0) state.kbdParen--;
        else state.kbd--;
        continue;
      }
    }
    if (ch === ',' && str[i + 1] === '(') {
      state.sub++;
      i++;
      continue;
    }
    if (state.sub > 0) {
      if (ch === '(') {
        state.subParen++;
        continue;
      }
      if (ch === ')') {
        if (state.subParen > 0) state.subParen--;
        else state.sub--;
        continue;
      }
    }
    if (ch === '?' && str[i + 1] === '(') {
      state.abbr++;
      i++;
      continue;
    }
    if (state.abbr > 0) {
      if (ch === '(') {
        state.abbrParen++;
        continue;
      }
      if (ch === ')') {
        if (state.abbrParen > 0) state.abbrParen--;
        else state.abbr--;
        continue;
      }
    }
    if (ch === '^' && str[i + 1] === '[') {
      state.footnoteRef++;
      i++;
      continue;
    }
    if (state.footnoteRef > 0) {
      if (ch === '[') {
        state.footnoteRefBracket++;
        continue;
      }
      if (ch === ']') {
        if (state.footnoteRefBracket > 0) state.footnoteRefBracket--;
        else state.footnoteRef--;
        continue;
      }
    }
    if (ch === '`' && str[i + 1] === '(') {
      state.code++;
      i++;
      continue;
    }
    if (state.code > 0) {
      if (ch === '(') {
        state.codeParen++;
        continue;
      }
      if (ch === ')') {
        if (state.codeParen > 0) state.codeParen--;
        else state.code--;
        continue;
      }
    }
    if (state.interp > 0) {
      if (ch === '(') {
        state.interpParen++;
        continue;
      }
      if (ch === ')') {
        if (state.interpParen > 0) state.interpParen--;
        else state.interp--;
        continue;
      }
    }
  }
  return (
    state.interp <= 0 &&
    state.link <= 0 &&
    state.ref <= 0 &&
    state.refImage <= 0 &&
    state.footnoteRef <= 0 &&
    state.image <= 0 &&
    state.strong <= 0 &&
    state.emphasis <= 0 &&
    state.del <= 0 &&
    state.ins <= 0 &&
    state.sup <= 0 &&
    state.kbd <= 0 &&
    state.sub <= 0 &&
    state.abbr <= 0 &&
    state.code <= 0
  );
}

function resetInterpolationState(state) {
  state.interp = 0;
  state.interpParen = 0;
  state.link = 0;
  state.linkParen = 0;
  state.ref = 0;
  state.refImage = 0;
  state.footnoteRef = 0;
  state.footnoteRefBracket = 0;
  state.image = 0;
  state.imageParen = 0;
  state.strong = 0;
  state.strongParen = 0;
  state.emphasis = 0;
  state.emphasisParen = 0;
  state.del = 0;
  state.delParen = 0;
  state.ins = 0;
  state.insParen = 0;
  state.sup = 0;
  state.supParen = 0;
  state.kbd = 0;
  state.kbdParen = 0;
  state.sub = 0;
  state.subParen = 0;
  state.abbr = 0;
  state.abbrParen = 0;
  state.code = 0;
  state.codeParen = 0;
  state.sq = false;
  state.dq = false;
  return state;
}

/**
 * Merge consecutive lines that have unclosed inline shorthand constructs
 * into single entries so multi-line inline elements are handled as one unit.
 *
 * Returns an array of {text, indented, lines} objects.
 */
function mergeMultiLineInterpolations(tokens, token_indent) {
  const result = [];
  let pendingText = null;
  let pendingLines = 0;
  let pendingIndentIdx = 0;
  const state = resetInterpolationState({});

  for (let j = 0; j < tokens.length; j++) {
    if (pendingText !== null) {
      pendingText += ' ' + tokens[j].trimStart();
    } else {
      pendingText = tokens[j];
      pendingIndentIdx = j;
    }
    pendingLines++;

    if (interpolationsAreClosed(tokens[j], state)) {
      result.push({
        text: pendingText,
        indented: token_indent[pendingIndentIdx],
        lines: pendingLines,
      });
      pendingText = null;
      pendingLines = 0;
      resetInterpolationState(state);
    }
  }
  if (pendingText !== null) {
    result.push({
      text: pendingText,
      indented: token_indent[pendingIndentIdx],
      lines: pendingLines,
    });
  }
  return result;
}

class Lexer {
  constructor(str, options) {
    options = options || {};
    if (typeof str !== 'string') {
      throw new Error(
        'Expected source code to be a string but got "' + typeof str + '"',
      );
    }
    if (typeof options !== 'object') {
      throw new Error(
        'Expected "options" to be an object but got "' + typeof options + '"',
      );
    }
    //Strip any UTF-8 BOM off of the start of `str`, if it exists.
    str = str.replace(/^\uFEFF/, '');
    this.input = str.replace(/\r\n|\r/g, '\n');
    this.originalInput = this.input;
    this.filename = options.filename;
    this.interpolated = options.interpolated || false;
    this.depth = options.depth || 0;
    this.lineno = options.startingLine || 1;
    this.colno = options.startingColumn || 1;
    this.indentStack = [0];
    this.indentRe = null;
    // If #{} or inline shorthand syntax is allowed when adding text
    this.interpolationAllowed = true;

    this.tokens = [];
    this.ended = false;
  }

  error(code, message) {
    const err = error(code, message, {
      line: this.lineno,
      column: this.colno,
      filename: this.filename,
      source: this.originalInput,
    });
    throw err;
  }

  assert(value, message) {
    if (!value) this.error('ASSERT_FAILED', message);
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
    const res = {
      type: type,
      loc: {
        start: {
          line: this.lineno,
          column: this.colno,
        },
        filename: this.filename,
      },
    };

    if (val !== undefined) res.val = val;

    return res;
  }

  tokEnd(tok) {
    tok.loc.end = {
      line: this.lineno,
      column: this.colno,
    };
    return tok;
  }

  incrementLine(increment) {
    this.lineno += increment;
    if (increment) this.colno = 1;
  }

  incrementColumn(increment) {
    this.colno += increment;
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

  bracketExpression(skip) {
    skip = skip || 0;
    const start = this.input[skip];
    if (start !== '(' && start !== '{' && start !== '[') {
      throw new Error('The start character should be "(", "{" or "["');
    }
    const end = {'(': ')', '{': '}', '[': ']'}[start];
    let range;
    try {
      range = parseUntil(this.input, end, skip + 1);
    } catch (ex) {
      if (ex.index !== undefined) {
        let idx = ex.index;
        let tmp = this.input.slice(skip).indexOf('\n');
        let nextNewline = tmp + skip;
        let ptr = 0;
        while (idx > nextNewline && tmp !== -1) {
          this.incrementLine(1);
          idx -= nextNewline + 1;
          ptr += nextNewline + 1;
          tmp = this.input.slice(ptr).indexOf('\n');
          nextNewline = tmp === -1 ? -1 : tmp + ptr;
        }

        this.incrementColumn(idx);
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
    if (!/^\\(\w(?:[-:\w]*\w)?)/.test(this.input)) return;
    this.consume(1);
    this.incrementColumn(1);
    return this.tag();
  }

  /**
   * Tag.
   */

  tag() {
    let captures;

    if ((captures = /^(\w(?:[-:\w]*\w)?)/.exec(this.input))) {
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
      this.scan(/^:([\w\-]+)/, 'filter') ||
      this.scan(/^:'([^']+)'/, 'filter') ||
      this.scan(/^:"([^"]+)"/, 'filter');

    const inInclude = opts && opts.inInclude;
    if (tok) {
      this.tokens.push(tok);
      this.incrementColumn(tok.val.length);
      this.tokEnd(tok);
      this.attrs();
      if (!inInclude) {
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
          /.[^ \t\(\#\.\:]*/.exec(this.input.slice(1))[0] +
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
          /.[^ \t\(\#\.\:]*/.exec(this.input.slice(1))[0] +
          '" is not a valid class name.  Class names can only contain "_", "-", a-z and 0-9, and must contain at least one of "_", or a-z',
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

    while (true) {
      let earliest;
      let escapedParenDepth = 0;
      let scanPos = 0;

      for (;;) {
        earliest = this.findEarliestCandidate(
          value,
          scanPos,
          escapedParenDepth,
        );

        if (!earliest) {
          value = prefix + value.substring(scanPos);
          tok = this.tok(type, value);
          this.incrementColumn(value.length + escaped);
          this.tokens.push(this.tokEnd(tok));
          return;
        }

        if (earliest.kind !== 'escaped') {
          prefix = prefix + value.substring(scanPos, earliest.pos);
          value = value.substring(earliest.pos);
          earliest.pos = 0;
          if (earliest.match) earliest.match.index = 0;
          break;
        }

        const segment = value.substring(scanPos, earliest.pos);
        for (let ci = 0; ci < segment.length; ci++) {
          if (segment[ci] === '(') escapedParenDepth++;
          else if (segment[ci] === ')' && escapedParenDepth > 0)
            escapedParenDepth--;
        }
        for (let ci = 0; ci < earliest.literal.length; ci++) {
          if (earliest.literal[ci] === '(') escapedParenDepth++;
          else if (earliest.literal[ci] === ')' && escapedParenDepth > 0)
            escapedParenDepth--;
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
        return this.handleRefLink(type, value, prefix, escaped, earliest.pos);

      case 'ref-image':
        return this.handleRefImage(type, value, prefix, escaped, earliest.pos);

      case 'footnote-ref':
        return this.handleFootnoteRef(
          type,
          value,
          prefix,
          escaped,
          earliest.pos,
        );

      case 'strong':
        return this.handleStrongShorthand(
          type,
          value,
          prefix,
          escaped,
          earliest.pos,
        );

      case 'emphasis':
        return this.handleEmphasisShorthand(
          type,
          value,
          prefix,
          escaped,
          earliest.pos,
        );

      case 'del':
        return this.handleDelShorthand(
          type,
          value,
          prefix,
          escaped,
          earliest.pos,
        );

      case 'ins':
        return this.handleInsShorthand(
          type,
          value,
          prefix,
          escaped,
          earliest.pos,
        );

      case 'sup':
        return this.handleSupShorthand(
          type,
          value,
          prefix,
          escaped,
          earliest.pos,
        );

      case 'kbd':
        return this.handleKbdShorthand(
          type,
          value,
          prefix,
          escaped,
          earliest.pos,
        );

      case 'sub':
        return this.handleSubShorthand(
          type,
          value,
          prefix,
          escaped,
          earliest.pos,
        );

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
        return this.handleVariableRef(
          type,
          value,
          prefix,
          escaped,
          earliest.match,
        );
    }
  }

  findEarliestCandidate(value, startPos, initialParenDepth) {
    startPos = startPos || 0;
    const candidates = [];

    if (this.interpolated) {
      let parenDepth = initialParenDepth || 0;
      for (let i = startPos; i < value.length; i++) {
        const ch = value[i];
        if (ch === '\\') {
          i++;
          continue;
        }
        if (ch === '(') {
          parenDepth++;
        } else if (ch === ')') {
          if (parenDepth > 0) {
            parenDepth--;
          } else {
            candidates.push({pos: i, kind: 'end'});
            break;
          }
        }
      }
    }

    if (this.interpolationAllowed) {
      let i;

      i = value.indexOf('\\#(', startPos);
      if (i !== -1) candidates.push({pos: i, kind: 'escaped', literal: '#('});

      i = value.indexOf('\\@(', startPos);
      if (i !== -1) candidates.push({pos: i, kind: 'escaped', literal: '@('});

      i = value.indexOf('\\@[', startPos);
      if (i !== -1) candidates.push({pos: i, kind: 'escaped', literal: '@['});

      i = value.indexOf('\\![', startPos);
      if (i !== -1) candidates.push({pos: i, kind: 'escaped', literal: '!['});

      i = value.indexOf('\\^[', startPos);
      if (i !== -1) candidates.push({pos: i, kind: 'escaped', literal: '^['});

      i = value.indexOf('\\!(', startPos);
      if (i !== -1) candidates.push({pos: i, kind: 'escaped', literal: '!('});

      i = value.indexOf('\\*(', startPos);
      if (i !== -1) candidates.push({pos: i, kind: 'escaped', literal: '*('});

      i = value.indexOf('\\_(', startPos);
      if (i !== -1) candidates.push({pos: i, kind: 'escaped', literal: '_('});

      i = value.indexOf('\\`(', startPos);
      if (i !== -1) candidates.push({pos: i, kind: 'escaped', literal: '`('});

      i = value.indexOf('\\~(', startPos);
      if (i !== -1) candidates.push({pos: i, kind: 'escaped', literal: '~('});

      i = value.indexOf('\\&(', startPos);
      if (i !== -1) candidates.push({pos: i, kind: 'escaped', literal: '&('});

      i = value.indexOf('\\^(', startPos);
      if (i !== -1) candidates.push({pos: i, kind: 'escaped', literal: '^('});

      i = value.indexOf('\\%(', startPos);
      if (i !== -1) candidates.push({pos: i, kind: 'escaped', literal: '%('});

      i = value.indexOf('\\,(', startPos);
      if (i !== -1) candidates.push({pos: i, kind: 'escaped', literal: ',('});

      i = value.indexOf('\\?(', startPos);
      if (i !== -1) candidates.push({pos: i, kind: 'escaped', literal: '?('});

      i = value.indexOf('`(', startPos);
      if (i !== -1) candidates.push({pos: i, kind: 'code'});

      i = value.indexOf('#(', startPos);
      if (i !== -1) candidates.push({pos: i, kind: 'interpolation'});

      i = value.indexOf('@(', startPos);
      if (i !== -1) candidates.push({pos: i, kind: 'link'});

      i = value.indexOf('@[', startPos);
      if (i !== -1) candidates.push({pos: i, kind: 'reference'});

      i = value.indexOf('![', startPos);
      if (i !== -1) candidates.push({pos: i, kind: 'ref-image'});

      i = value.indexOf('^[', startPos);
      if (i !== -1) candidates.push({pos: i, kind: 'footnote-ref'});

      i = value.indexOf('!(', startPos);
      if (i !== -1) candidates.push({pos: i, kind: 'image'});

      i = value.indexOf('*(', startPos);
      if (i !== -1) candidates.push({pos: i, kind: 'strong'});

      i = value.indexOf('_(', startPos);
      if (i !== -1) candidates.push({pos: i, kind: 'emphasis'});

      i = value.indexOf('~(', startPos);
      if (i !== -1) candidates.push({pos: i, kind: 'del'});

      i = value.indexOf('&(', startPos);
      if (i !== -1) candidates.push({pos: i, kind: 'ins'});

      i = value.indexOf('^(', startPos);
      if (i !== -1) candidates.push({pos: i, kind: 'sup'});

      i = value.indexOf('%(', startPos);
      if (i !== -1) candidates.push({pos: i, kind: 'kbd'});

      i = value.indexOf(',(', startPos);
      if (i !== -1) candidates.push({pos: i, kind: 'sub'});

      i = value.indexOf('?(', startPos);
      if (i !== -1) candidates.push({pos: i, kind: 'abbr'});

      const m = /(\\)?#{([-a-zA-Z_?]+)}/.exec(value.substring(startPos));
      if (m) {
        const absPos = m.index + startPos;
        if (m[1]) {
          candidates.push({pos: absPos, kind: 'escaped', literal: '#{'});
        } else {
          m.index = absPos;
          candidates.push({pos: absPos, kind: 'variable', match: m});
        }
      }
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => a.pos - b.pos);
    return candidates[0];
  }

  spawnChildLexer(input) {
    if (this.depth >= 256) {
      this.error(
        'NESTING_TOO_DEEP',
        'Inline element nesting exceeds maximum depth of 256',
      );
    }
    const child = new this.constructor(input, {
      filename: this.filename,
      interpolated: true,
      depth: this.depth + 1,
      startingLine: this.lineno,
      startingColumn: this.colno,
    });
    try {
      child.getTokens();
    } catch (ex) {
      if (ex.code && /^PUGNEUM:/.test(ex.code)) {
        this.colno = ex.column;
        this.error(ex.code.slice(8), ex.msg);
      }
      throw ex;
    }
    return child;
  }

  handleInterpolation(type, value, prefix, escaped, pos) {
    let tok = this.tok(type, prefix + value.substring(0, pos));
    this.incrementColumn(prefix.length + pos + escaped);
    this.tokens.push(this.tokEnd(tok));
    tok = this.tok('start-interpolation');
    this.incrementColumn(2);
    this.tokens.push(this.tokEnd(tok));
    const child = this.spawnChildLexer(value.slice(pos + 2));
    this.colno = child.colno;
    for (let ti = 0; ti < child.tokens.length; ti++) {
      this.tokens.push(child.tokens[ti]);
    }
    tok = this.tok('end-interpolation');
    this.incrementColumn(1);
    this.tokens.push(this.tokEnd(tok));
    return child.input;
  }

  parseShorthandContent(rest, errorPrefix, errorCode) {
    let range;
    try {
      range = parseUntil(rest, ')', 1);
    } catch (ex) {
      if (ex.code === 'CHARACTER_PARSER:END_OF_STRING_REACHED') {
        this.error('NO_END_BRACKET', errorPrefix);
      }
      throw ex;
    }
    const content = range.src;
    const after = rest.substring(range.end + 1);

    let url, text;
    if (content.length > 0 && (content[0] === "'" || content[0] === '"')) {
      const quote = content[0];
      const endQuote = findClosingQuote(content, quote, 1);
      if (endQuote === -1) {
        this.error(errorCode, `Unclosed quote in ${errorPrefix} URL.`);
      }
      url = content.substring(1, endQuote);
      text = content.substring(endQuote + 1).trimStart() || url;
    } else {
      const spaceIdx = content.indexOf(' ');
      if (spaceIdx === -1 || !content.substring(spaceIdx + 1)) {
        url = spaceIdx === -1 ? content : content.substring(0, spaceIdx);
        text = url;
      } else {
        url = content.substring(0, spaceIdx);
        text = content.substring(spaceIdx + 1);
      }
    }
    return {
      url: unescapeShorthand(url),
      text: unescapeShorthand(text),
      content,
      after,
    };
  }

  escapeForAttr(value) {
    const quote = value.includes("'") ? '"' : "'";
    const escaped = value
      .replaceAll('\\', '\\\\')
      .replaceAll(quote, '\\' + quote);
    return {quote, escaped};
  }

  desugarAsInterpolation(childInput, contentLen) {
    let tok = this.tok('start-interpolation');
    this.incrementColumn(2);
    this.tokens.push(this.tokEnd(tok));
    const child = this.spawnChildLexer(childInput);
    this.incrementColumn(contentLen);
    for (let ti = 0; ti < child.tokens.length; ti++) {
      this.tokens.push(child.tokens[ti]);
    }
    tok = this.tok('end-interpolation');
    this.incrementColumn(1);
    this.tokens.push(this.tokEnd(tok));
    return child.input;
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
    );
    const {quote, escaped: escapedUrl} = this.escapeForAttr(parsed.url);
    const childInput = `a(href=${quote}${escapedUrl}${quote}) ${parsed.text})${parsed.after}`;
    return this.desugarAsInterpolation(childInput, parsed.content.length);
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
    );
    let afterImage = parsed.after;
    const altText = parsed.text === parsed.url ? '' : parsed.text;
    const {quote, escaped: escapedUrl} = this.escapeForAttr(parsed.url);
    const {quote: altQuote, escaped: escapedAlt} = this.escapeForAttr(altText);

    let extraAttrs = '';
    if (afterImage.startsWith('(')) {
      let attrRange;
      try {
        attrRange = parseUntil(afterImage, ')', 1);
      } catch (ex) {
        if (ex.code === 'CHARACTER_PARSER:END_OF_STRING_REACHED') {
          this.error(
            'NO_END_BRACKET',
            'End of line reached with no closing ) for !() image attributes.',
          );
        }
        throw ex;
      }
      extraAttrs = ' ' + attrRange.src;
      afterImage = afterImage.substring(attrRange.end + 1);
    }

    const childInput = `img(src=${quote}${escapedUrl}${quote} alt=${altQuote}${escapedAlt}${altQuote}${extraAttrs}))${afterImage}`;
    return this.desugarAsInterpolation(childInput, parsed.content.length);
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
    );
    const afterAbbr = parsed.after;

    // parsed.url = first word (the abbreviation)
    // parsed.text = rest (the expansion), or same as url if no space
    const abbreviation = parsed.url;
    const expansion = parsed.text === parsed.url ? '' : parsed.text;

    let childInput;
    if (expansion) {
      const {quote, escaped: escapedExpansion} = this.escapeForAttr(expansion);
      childInput = `abbr(title=${quote}${escapedExpansion}${quote}) ${abbreviation})${afterAbbr}`;
    } else {
      childInput = `abbr ${abbreviation})${afterAbbr}`;
    }
    return this.desugarAsInterpolation(childInput, parsed.content.length);
  }

  handleStrongShorthand(type, value, prefix, escaped, pos) {
    let tok = this.tok(type, prefix + value.substring(0, pos));
    this.incrementColumn(prefix.length + pos + escaped);
    this.tokens.push(this.tokEnd(tok));

    const rest = value.substring(pos + 1);
    let range;
    try {
      range = parseUntil(rest, ')', 1);
    } catch (ex) {
      if (ex.code === 'CHARACTER_PARSER:END_OF_STRING_REACHED') {
        this.error(
          'NO_END_BRACKET',
          'End of line reached with no closing ) for *() strong shorthand.',
        );
      }
      throw ex;
    }
    const content = unescapeShorthand(range.src);
    const afterShorthand = rest.substring(range.end + 1);
    const childInput = `strong ${content})${afterShorthand}`;
    return this.desugarAsInterpolation(childInput, range.src.length);
  }

  handleEmphasisShorthand(type, value, prefix, escaped, pos) {
    let tok = this.tok(type, prefix + value.substring(0, pos));
    this.incrementColumn(prefix.length + pos + escaped);
    this.tokens.push(this.tokEnd(tok));

    const rest = value.substring(pos + 1);
    let range;
    try {
      range = parseUntil(rest, ')', 1);
    } catch (ex) {
      if (ex.code === 'CHARACTER_PARSER:END_OF_STRING_REACHED') {
        this.error(
          'NO_END_BRACKET',
          'End of line reached with no closing ) for _() emphasis shorthand.',
        );
      }
      throw ex;
    }
    const content = unescapeShorthand(range.src);
    const afterShorthand = rest.substring(range.end + 1);
    const childInput = `em ${content})${afterShorthand}`;
    return this.desugarAsInterpolation(childInput, range.src.length);
  }

  handleDelShorthand(type, value, prefix, escaped, pos) {
    let tok = this.tok(type, prefix + value.substring(0, pos));
    this.incrementColumn(prefix.length + pos + escaped);
    this.tokens.push(this.tokEnd(tok));

    const rest = value.substring(pos + 1);
    let range;
    try {
      range = parseUntil(rest, ')', 1);
    } catch (ex) {
      if (ex.code === 'CHARACTER_PARSER:END_OF_STRING_REACHED') {
        this.error(
          'NO_END_BRACKET',
          'End of line reached with no closing ) for ~() del shorthand.',
        );
      }
      throw ex;
    }
    const content = unescapeShorthand(range.src);
    const afterShorthand = rest.substring(range.end + 1);
    const childInput = `del ${content})${afterShorthand}`;
    return this.desugarAsInterpolation(childInput, range.src.length);
  }

  handleInsShorthand(type, value, prefix, escaped, pos) {
    let tok = this.tok(type, prefix + value.substring(0, pos));
    this.incrementColumn(prefix.length + pos + escaped);
    this.tokens.push(this.tokEnd(tok));

    const rest = value.substring(pos + 1);
    let range;
    try {
      range = parseUntil(rest, ')', 1);
    } catch (ex) {
      if (ex.code === 'CHARACTER_PARSER:END_OF_STRING_REACHED') {
        this.error(
          'NO_END_BRACKET',
          'End of line reached with no closing ) for &() ins shorthand.',
        );
      }
      throw ex;
    }
    const content = unescapeShorthand(range.src);
    const afterShorthand = rest.substring(range.end + 1);
    const childInput = `ins ${content})${afterShorthand}`;
    return this.desugarAsInterpolation(childInput, range.src.length);
  }

  handleSupShorthand(type, value, prefix, escaped, pos) {
    let tok = this.tok(type, prefix + value.substring(0, pos));
    this.incrementColumn(prefix.length + pos + escaped);
    this.tokens.push(this.tokEnd(tok));

    const rest = value.substring(pos + 1);
    let range;
    try {
      range = parseUntil(rest, ')', 1);
    } catch (ex) {
      if (ex.code === 'CHARACTER_PARSER:END_OF_STRING_REACHED') {
        this.error(
          'NO_END_BRACKET',
          'End of line reached with no closing ) for ^() sup shorthand.',
        );
      }
      throw ex;
    }
    const content = unescapeShorthand(range.src);
    const afterShorthand = rest.substring(range.end + 1);
    const childInput = `sup ${content})${afterShorthand}`;
    return this.desugarAsInterpolation(childInput, range.src.length);
  }

  handleKbdShorthand(type, value, prefix, escaped, pos) {
    let tok = this.tok(type, prefix + value.substring(0, pos));
    this.incrementColumn(prefix.length + pos + escaped);
    this.tokens.push(this.tokEnd(tok));

    const rest = value.substring(pos + 1);
    let range;
    try {
      range = parseUntil(rest, ')', 1);
    } catch (ex) {
      if (ex.code === 'CHARACTER_PARSER:END_OF_STRING_REACHED') {
        this.error(
          'NO_END_BRACKET',
          'End of line reached with no closing ) for %() kbd shorthand.',
        );
      }
      throw ex;
    }
    const content = unescapeShorthand(range.src);
    const afterShorthand = rest.substring(range.end + 1);
    const childInput = `kbd ${content})${afterShorthand}`;
    return this.desugarAsInterpolation(childInput, range.src.length);
  }

  handleSubShorthand(type, value, prefix, escaped, pos) {
    let tok = this.tok(type, prefix + value.substring(0, pos));
    this.incrementColumn(prefix.length + pos + escaped);
    this.tokens.push(this.tokEnd(tok));

    const rest = value.substring(pos + 1);
    let range;
    try {
      range = parseUntil(rest, ')', 1);
    } catch (ex) {
      if (ex.code === 'CHARACTER_PARSER:END_OF_STRING_REACHED') {
        this.error(
          'NO_END_BRACKET',
          'End of line reached with no closing ) for ,() sub shorthand.',
        );
      }
      throw ex;
    }
    const content = unescapeShorthand(range.src);
    const afterShorthand = rest.substring(range.end + 1);
    const childInput = `sub ${content})${afterShorthand}`;
    return this.desugarAsInterpolation(childInput, range.src.length);
  }

  handleCodeShorthand(type, value, prefix, escaped, pos) {
    let tok = this.tok(type, prefix + value.substring(0, pos));
    this.incrementColumn(prefix.length + pos + escaped);
    this.tokens.push(this.tokEnd(tok));

    const rest = value.substring(pos + 1);
    let range;
    try {
      range = parseUntil(rest, ')', 1);
    } catch (ex) {
      if (ex.code === 'CHARACTER_PARSER:END_OF_STRING_REACHED') {
        this.error(
          'NO_END_BRACKET',
          'End of line reached with no closing ) for `() code shorthand.',
        );
      }
      throw ex;
    }
    const content = unescapeShorthand(range.src);

    tok = this.tok('start-interpolation');
    this.incrementColumn(2);
    this.tokens.push(this.tokEnd(tok));

    tok = this.tok('tag', 'code');
    this.incrementColumn(0);
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
    // Find the matching ] for the ref link.
    // #(...) interpolations nest inside ref links; track paren depth to handle them.
    // Use \] to include a literal ] in the link text.
    let end = -1;
    let interpDepth = 0;
    let bracketDepth = 0;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '#' && inner[i + 1] === '(') {
        interpDepth++;
        i++;
        continue;
      }
      if (ch === '(' && interpDepth > 0) {
        interpDepth++;
        continue;
      }
      if (ch === ')' && interpDepth > 0) {
        interpDepth--;
        continue;
      }
      if ((ch === '@' || ch === '!') && inner[i + 1] === '[') {
        bracketDepth++;
        i++;
        continue;
      }
      if (ch === ']') {
        if (bracketDepth > 0) {
          bracketDepth--;
          continue;
        }
        if (interpDepth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) {
      this.error(
        'NO_END_BRACKET',
        'End of line reached with no closing ] for @[] reference link.',
      );
    }
    const content = inner.substring(0, end);
    let afterLink = inner.substring(end + 1);

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
      // Unescape \[ \] \\ sequences in link text
      const unescaped = linkText.replace(/\\([\[\]\\])/g, '$1');
      const textTok = this.tok('text', unescaped);
      this.incrementColumn(name.length + 1 + linkText.length); // name + space + text (source length)
      this.tokens.push(this.tokEnd(textTok));
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
    let end = -1;
    let interpDepth = 0;
    let bracketDepth = 0;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '#' && inner[i + 1] === '(') {
        interpDepth++;
        i++;
        continue;
      }
      if (ch === '(' && interpDepth > 0) {
        interpDepth++;
        continue;
      }
      if (ch === ')' && interpDepth > 0) {
        interpDepth--;
        continue;
      }
      if ((ch === '@' || ch === '!') && inner[i + 1] === '[') {
        bracketDepth++;
        i++;
        continue;
      }
      if (ch === ']') {
        if (bracketDepth > 0) {
          bracketDepth--;
          continue;
        }
        if (interpDepth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) {
      this.error(
        'NO_END_BRACKET',
        'End of line reached with no closing ] for ![] reference image.',
      );
    }
    const content = inner.substring(0, end);
    let afterImage = inner.substring(end + 1);

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
      const unescaped = altText.replace(/\\([\[\]\\])/g, '$1');
      const textTok = this.tok('text', unescaped);
      this.incrementColumn(name.length + 1 + altText.length);
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
    let end = -1;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === ']') {
        end = i;
        break;
      }
    }
    if (end === -1) {
      this.error(
        'NO_END_BRACKET',
        'End of line reached with no closing ] for ^[] footnote reference.',
      );
    }
    const name = inner.substring(0, end).trim();
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
    this.incrementColumn(name.length);

    tok = this.tok('end-footnote-ref');
    this.incrementColumn(1); // ]
    this.tokens.push(this.tokEnd(tok));

    return inner.substring(end + 1);
  }

  handleVariableRef(type, value, prefix, escaped, match) {
    let tok;
    let before = value.slice(0, match.index);
    if (prefix || before) {
      before = prefix + before;
      tok = this.tok(type, before);
      this.incrementColumn(before.length + escaped);
      this.tokens.push(this.tokEnd(tok));
    }

    tok = this.tok('start-interpolation');
    this.incrementColumn(2);
    this.tokens.push(this.tokEnd(tok));

    tok = this.tok('variable', match[2]);
    this.incrementColumn(match[2].length);
    this.tokens.push(this.tokEnd(tok));

    tok = this.tok('end-interpolation');
    this.incrementColumn(1);
    this.tokens.push(this.tokEnd(tok));

    return value.slice(match.index + match[0].length);
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

  variable() {
    let captures;
    if ((captures = /^#{([-a-zA-Z_?]+)}/.exec(this.input))) {
      const tok = this.tok('variable', captures[1]);
      this.tokens.push(tok);
      this.incrementColumn(captures[0].length);
      this.consume(captures[0].length);
      this.tokEnd(tok);
      return true;
    }
    const bad = /^#{([^}\n]*)}/.exec(this.input);
    if (bad) {
      this.error(
        'INVALID_VARIABLE_NAME',
        '"' +
          bad[1] +
          '" is not a valid variable name.' +
          ' Variable names may only contain letters, hyphens, underscores and question marks.',
      );
    }
  }

  /**
   * Call mixin.
   */

  call() {
    let tok, captures, increment;
    if ((captures = /^\+\s*([a-zA-Z][-\w]*)/.exec(this.input))) {
      increment = captures[0].length;
      tok = this.tok('call', captures[1]);
      this.consume(increment);
      this.incrementColumn(increment);

      tok.args = [];
      // Check for args (not attributes)
      // just a space separated list of strings
      // no nested parentheses allowed
      if (this.input[0] === '(' || /^ *\(/.test(this.input)) {
        const leading = /^ *\(/.exec(this.input)[0];
        let range;
        try {
          range = parseUntil(this.input, ')', leading.length);
        } catch (ex) {
          if (ex.code === 'CHARACTER_PARSER:END_OF_STRING_REACHED') {
            this.error(
              'NO_END_BRACKET',
              'End of line reached with no closing ) for mixin call arguments.',
            );
          }
          throw ex;
        }
        const argsStr = range.src;
        const increment = range.end + 1;
        this.consume(increment);
        this.incrementColumn(increment);

        // Parse arguments respecting quoted strings and escape sequences
        let j = 0;
        while (j < argsStr.length) {
          while (j < argsStr.length && argsStr[j] === ' ') j++;
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
            while (j < argsStr.length && argsStr[j] !== ' ') {
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
    let captures;
    if (
      (captures = /^mixin +([a-zA-Z][-\w]*)(?: *\((.*)\))? */.exec(this.input))
    ) {
      this.consume(captures[0].length);
      const tok = this.tok('mixin', captures[1]);
      tok.args = this.parseMixinParams(captures[2] || '');
      this.incrementColumn(captures[0].length);
      this.tokens.push(this.tokEnd(tok));
      return true;
    }
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
  parseMixinParams(str) {
    const params = [];
    let i = 0;

    while (i < str.length) {
      // skip whitespace
      while (i < str.length && str[i] === ' ') i++;
      if (i >= str.length) break;

      // read parameter name: only characters valid for variable interpolation
      let name = '';
      while (i < str.length && /[-a-zA-Z_?]/.test(str[i])) {
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
          const quote = str[i++];
          while (i < str.length && str[i] !== quote) {
            if (str[i] === '\\' && i + 1 < str.length) {
              i++; // skip backslash, include next char
            }
            dflt += str[i++];
          }
          if (i < str.length) i++; // skip closing quote
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

    let stringPtr = 0;
    let isMatch;
    do {
      let i = this.input.slice(stringPtr + 1).indexOf('\n');
      if (i === -1) i = this.input.length - stringPtr - 1;
      const str = this.input.slice(stringPtr + 1, stringPtr + 1 + i);
      const lineCaptures = this.indentRe.exec('\n' + str);
      const lineIndents = lineCaptures && lineCaptures[1].length;
      isMatch = lineIndents >= indents || !str.trim();
      if (isMatch) {
        stringPtr += str.length + 1;
        const content = str.slice(indents).trim();
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
          let rest = content.substring(spaceIdx + 1).trim();
          let url;
          let defaultText = null;

          // Handle quoted URLs (may be followed by default text)
          if (rest[0] === "'" || rest[0] === '"') {
            const quote = rest[0];
            const closeIdx = rest.indexOf(quote, 1);
            if (closeIdx !== -1) {
              url = rest.substring(1, closeIdx);
              const afterUrl = rest.substring(closeIdx + 1).trim();
              if (afterUrl) defaultText = afterUrl;
            } else {
              url = rest;
            }
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
          this.incrementColumn(content.length);
          this.tokens.push(this.tokEnd(tok));
        } else {
          this.incrementLine(1);
        }
      }
    } while (this.input.length - stringPtr && isMatch);
    this.consume(stringPtr);
  }

  /**
   * Table of contents.
   */

  doctype() {
    const tok = this.scan(/^doctype html(?= *$| *\n)/, 'text');
    if (tok) {
      tok.val = '<!DOCTYPE html>';
      this.tokens.push(this.tokEnd(tok));
      return true;
    }
  }

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
      let len = 'given '.length + name.length;
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

    // Collect all lines belonging to this block
    const blockLines = [];
    let stringPtr = 0;
    let isMatch;
    do {
      let i = this.input.slice(stringPtr + 1).indexOf('\n');
      if (i === -1) i = this.input.length - stringPtr - 1;
      const str = this.input.slice(stringPtr + 1, stringPtr + 1 + i);
      const lineCaptures = this.indentRe.exec('\n' + str);
      const lineIndents = lineCaptures && lineCaptures[1].length;
      isMatch = lineIndents >= defIndent || !str.trim();
      if (isMatch) {
        stringPtr += str.length + 1;
        blockLines.push({raw: str, indent: lineIndents || 0});
      }
    } while (this.input.length - stringPtr && isMatch);
    this.consume(stringPtr);

    // Group lines into definitions
    let currentName = null;
    let contentLines = [];

    const self = this;
    function flushDefinition() {
      if (currentName === null) return;

      let tok = self.tok('footnote-def-start');
      tok.val = currentName;
      self.tokens.push(self.tokEnd(tok));

      for (let ci = 0; ci < contentLines.length; ci++) {
        if (ci > 0) {
          self.incrementLine(1);
          self.tokens.push(self.tokEnd(self.tok('newline')));
        }
        self.addText('text', contentLines[ci]);
      }

      self.tokens.push(self.tokEnd(self.tok('footnote-def-end')));
      currentName = null;
      contentLines = [];
    }

    for (let li = 0; li < blockLines.length; li++) {
      const line = blockLines[li];
      this.incrementLine(1);

      if (!line.raw.trim()) continue;

      if (line.indent <= defIndent) {
        // New definition starts
        flushDefinition();
        const content = line.raw.slice(defIndent);
        const spaceIdx = content.indexOf(' ');
        if (spaceIdx === -1) {
          currentName = content.trim();
          this.incrementColumn(defIndent + currentName.length);
        } else {
          currentName = content.substring(0, spaceIdx);
          const inlineContent = content.substring(spaceIdx + 1);
          this.incrementColumn(defIndent + currentName.length + 1);
          contentLines.push(inlineContent);
        }
      } else {
        // Continuation line
        const continuation = line.raw.slice(defIndent).trimStart();
        this.incrementColumn(line.indent);
        contentLines.push(continuation);
      }
    }
    flushDefinition();
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
      value = '';
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

    const invalid = key.replaceAll(attributeName, '');
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
        quote = null;
      }

      // start looping through the value
      for (; i < str.length; i++) {
        if (quote) {
          if (str[i] === quote) {
            this.incrementColumn(1);
            i++;
            break;
          }
          if (str[i] === '\\') {
            ++i;
            switch (str[i]) {
              case "'":
                value += "'";
                break;
              case '"':
                value += '"';
                break;
              case '\\':
                value += '\\';
                break;
              case 'n':
                value += '\n';
                break;
              case 't':
                value += '\t';
                break;
              default:
                value += '\\' + str[i];
                break;
            }
            this.incrementColumn(2);
            continue;
          }
        } else {
          if (str[i] === '\\' && i + 1 < str.length) {
            const next = str[i + 1];
            if (next === '\\' || whitespaceRe.test(next)) {
              value += next;
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
        let outdent_count = 0;
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
          outdent_count++;
          this.indentStack.shift();
        }
        while (outdent_count--) {
          this.colno = 1;
          tok = this.tok('outdent');
          this.colno = this.indentStack[0] + 1;
          this.tokens.push(this.tokEnd(tok));
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
      // First pass: find the minimum indent among non-blank indented lines
      let minIndent = indents;
      let scanPtr = 0;
      while (scanPtr < this.input.length) {
        let i = this.input.indexOf('\n', scanPtr + 1);
        if (i === -1) i = this.input.length;
        const str = this.input.slice(scanPtr + 1, i);
        const lineCaptures = this.indentRe.exec('\n' + str);
        const lineIndents = lineCaptures && lineCaptures[1].length;
        if (str.trim() && lineIndents <= this.indentStack[0]) break;
        if (str.trim() && lineIndents < minIndent) minIndent = lineIndents;
        scanPtr = i;
      }
      indents = minIndent;

      this.tokens.push(this.tokEnd(this.tok('start-pipeless-text')));
      const tokens = [];
      const token_indent = [];
      let isMatch;
      let stringPtr = 0;
      do {
        let i = this.input.slice(stringPtr + 1).indexOf('\n');
        if (-1 === i) i = this.input.length - stringPtr - 1;
        const str = this.input.slice(stringPtr + 1, stringPtr + 1 + i);
        const lineCaptures = this.indentRe.exec('\n' + str);
        const lineIndents = lineCaptures && lineCaptures[1].length;
        isMatch = lineIndents >= indents;
        token_indent.push(isMatch);
        isMatch = isMatch || !str.trim();
        if (isMatch) {
          stringPtr += str.length + 1;
          tokens.push(str.slice(indents));
        }
      } while (this.input.length - stringPtr && isMatch);
      this.consume(stringPtr);
      while (this.input.length === 0 && tokens[tokens.length - 1] === '')
        tokens.pop();

      // Merge lines with unclosed inline shorthand constructs so that
      // inline elements can span multiple lines in text blocks.
      const merged = mergeMultiLineInterpolations(tokens, token_indent);

      for (let mi = 0; mi < merged.length; mi++) {
        let tok;
        this.incrementLine(1);
        if (mi !== 0) tok = this.tok('newline');
        if (merged[mi].indented) this.incrementColumn(indents);
        if (tok) this.tokens.push(this.tokEnd(tok));
        this.addText('text', merged[mi].text);
        if (merged[mi].lines > 1) {
          this.incrementLine(merged[mi].lines - 1);
        }
      }
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
    const inlinePatterns = [
      [/^#\(/, '#(...) inline tags'],
      [/^@\(/, '@(...) inline links'],
      [/^@\[/, '@[...] reference links'],
      [/^!\[/, '![...] reference images'],
      [/^!\(/, '!(...) inline images'],
      [/^\*\(/, '*(...) inline strong'],
      [/^~\(/, '~(...) inline del'],
      [/^&\(/, '&(...) inline ins'],
      [/^\^\(/, '^(...) inline sup'],
      [/^\^\[/, '^[...] footnote references'],
      [/^%\(/, '%(...) inline kbd'],
      [/^,\(/, ',(...) inline sub'],
      [/^`\(/, '`(...) inline code'],
      [/^\?\(/, '?(...) inline abbr'],
    ];
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
    return (
      this.blank() ||
      this.eos() ||
      this.endInterpolation() ||
      this.variable() ||
      this.escapedTag() ||
      this.yield() ||
      this['extends']() ||
      this.append() ||
      this.prepend() ||
      this.block() ||
      this.mixinBlock() ||
      this.include() ||
      this.references() ||
      this.footnotes() ||
      this.given() ||
      this.toc() ||
      this.doctype() ||
      this.mixin() ||
      this.call() ||
      this.tag() ||
      this.filter() ||
      this.id() ||
      this.dot() ||
      this.className() ||
      this.attrs() ||
      this.indent() ||
      this.text() ||
      this.comment() ||
      this.colon() ||
      this.fail()
    );
  }

  getTokens() {
    while (!this.ended) {
      this.advance();
    }
    return this.tokens;
  }
}
