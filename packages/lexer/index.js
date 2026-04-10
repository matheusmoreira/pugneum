const error = require('pugneum-error');

module.exports = lex;

function lex(str, options) {
  const lexer = new Lexer(str, options);
  return structuredClone(lexer.getTokens());
}

// https://infra.spec.whatwg.org/#c0-control
const c0 = '\u0000-\u001F';

// https://infra.spec.whatwg.org/#control
const control = c0 + '\u007F-\u009F';

// https://infra.spec.whatwg.org/#noncharacter
const noncharacter  =
  '\uFDD0-\uFDEF'   +
  '\uFFFE\uFFFF'    +
  '\u1FFFE\u1FFFF'  +
  '\u2FFFE\u2FFFF'  +
  '\u3FFFE\u3FFFF'  +
  '\u4FFFE\u4FFFF'  +
  '\u5FFFE\u5FFFF'  +
  '\u6FFFE\u6FFFF'  +
  '\u7FFFE\u7FFFF'  +
  '\u8FFFE\u8FFFF'  +
  '\u9FFFE\u9FFFF'  +
  '\uAFFFE\uAFFFF'  +
  '\uBFFFE\uBFFFF'  +
  '\uCFFFE\uCFFFF'  +
  '\uDFFFE\uDFFFF'  +
  '\uEFFFE\uEFFFF'  +
  '\uFFFFE\uFFFFF'  +
  '\u10FFFE\u10FFFF';

// https://html.spec.whatwg.org/multipage/syntax.html#attributes-2
const attributeNamePunctuation = ' \'">/=';
const attributeName = new RegExp('[^' + control + attributeNamePunctuation + noncharacter + ']', 'g');

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

  if (c === '\'' || c === '"' || c === '`') {
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

    if (quote || c === '\'' || c === '"' || c === '`') {
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
    'The end of the string reached with no closing bracket ' + end + ' found.'
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

    if (quote || c === '\'' || c === '"' || c === '`') {
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
 * Check whether a line has unclosed #[...] or @(...) interpolation constructs.
 * Returns true if all interpolations are closed (line is complete).
 */
function interpolationsAreClosed(str, state) {
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '\\') { i++; continue; }
    if (ch === "'" && !state.dq) { state.sq = !state.sq; continue; }
    if (ch === '"' && !state.sq) { state.dq = !state.dq; continue; }
    if (state.sq || state.dq) continue;
    if (ch === '#' && str[i + 1] === '[') { state.interp++; i++; continue; }
    if (ch === '@' && str[i + 1] === '[') { state.ref++; i++; continue; }
    if (ch === ']') {
      if (state.ref > 0) { state.ref--; continue; }
      if (state.interp > 0) { state.interp--; continue; }
    }
    if (ch === '@' && str[i + 1] === '(') { state.link++; i++; continue; }
    if (state.link > 0) {
      if (ch === '(') { state.paren++; continue; }
      if (ch === ')') {
        if (state.paren > 0) state.paren--;
        else state.link--;
        continue;
      }
    }
  }
  return state.interp <= 0 && state.link <= 0 && state.ref <= 0;
}

/**
 * Merge consecutive lines that have unclosed #[...] or @(...) constructs
 * into single entries so multi-line inline elements are handled as one unit.
 *
 * Returns an array of {text, indented, lines} objects.
 */
function mergeMultiLineInterpolations(tokens, token_indent) {
  const result = [];
  let pendingText = null;
  let pendingLines = 0;
  let pendingIndentIdx = 0;
  const state = { interp: 0, link: 0, ref: 0, paren: 0, sq: false, dq: false };

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
      state.interp = 0; state.link = 0; state.ref = 0; state.paren = 0;
      state.sq = false; state.dq = false;
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
        'Expected source code to be a string but got "' + typeof str + '"'
      );
    }
    if (typeof options !== 'object') {
      throw new Error(
        'Expected "options" to be an object but got "' + typeof options + '"'
      );
    }
    //Strip any UTF-8 BOM off of the start of `str`, if it exists.
    str = str.replace(/^\uFEFF/, '');
    this.input = str.replace(/\r\n|\r/g, '\n');
    this.originalInput = this.input;
    this.filename = options.filename;
    this.interpolated = options.interpolated || false;
    this.lineno = options.startingLine || 1;
    this.colno = options.startingColumn || 1;
    this.indentStack = [0];
    this.indentRe = null;
    // If #{}, !{} or #[] syntax is allowed when adding text
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
        'Nesting must match on expression `' + exp + '`'
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
      const len =captures[0].length;
      const val = captures[1];
      const diff = len - (val ? val.length : 0);
      const tok =this.tok(type, val);
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
        // starting from this.input[skip]
        let tmp = this.input.slice(skip).indexOf('\n');
        // starting from this.input[0]
        let nextNewline = tmp + skip;
        let ptr = 0;
        while (idx > nextNewline && tmp !== -1) {
          this.incrementLine(1);
          idx -= nextNewline + 1;
          ptr += nextNewline + 1;
          tmp = nextNewline = this.input.slice(ptr).indexOf('\n');
        }

        this.incrementColumn(idx);
      }
      if (ex.code === 'CHARACTER_PARSER:END_OF_STRING_REACHED') {
        this.error(
          'NO_END_BRACKET',
          'The end of the string reached with no closing bracket ' +
            end +
            ' found.'
        );
      } else if (ex.code === 'CHARACTER_PARSER:MISMATCHED_BRACKET') {
        this.error('BRACKET_MISMATCH', ex.message);
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
        'End of line was reached with no closing bracket for interpolation.'
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
      const tok =this.tok('comment', captures[2]);
      tok.buffer = '-' != captures[1];
      this.interpolationAllowed = tok.buffer;
      this.tokens.push(tok);
      this.incrementColumn(captures[0].length);
      this.tokEnd(tok);
      this.pipelessText();
      return true;
    }
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
    const tok =this.scan(/^:([\w\-]+)/, 'filter') ||
        this.scan(/^:'(.+)'/, 'filter') ||
        this.scan(/^:"(.+)"/, 'filter');

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
    const tok =this.scan(/^#([\w-]+)/, 'id');
    if (tok) {
      this.tokens.push(tok);
      this.incrementColumn(tok.val.length);
      this.tokEnd(tok);
      return true;
    }
    if (/^#/.test(this.input)) {
      this.error(
        'INVALID_ID',
        '"' +
          /.[^ \t\(\#\.\:]*/.exec(this.input.slice(1))[0] +
          '" is not a valid ID.'
      );
    }
  }

  /**
   * Class.
   */

  className() {
    const tok =this.scan(/^\.([_a-z0-9\-]*[_a-z][_a-z0-9\-]*)/i, 'class');
    if (tok) {
      this.tokens.push(tok);
      this.incrementColumn(tok.val.length);
      this.tokEnd(tok);
      return true;
    }
    if (/^\.[_a-z0-9\-]+/i.test(this.input)) {
      this.error(
        'INVALID_CLASS_NAME',
        'Class names must contain at least one letter or underscore.'
      );
    }
    if (/^\./.test(this.input)) {
      this.error(
        'INVALID_CLASS_NAME',
        '"' +
          /.[^ \t\(\#\.\:]*/.exec(this.input.slice(1))[0] +
          '" is not a valid class name.  Class names can only contain "_", "-", a-z and 0-9, and must contain at least one of "_", or a-z'
      );
    }
  }

  /**
   * Text.
   */
  endInterpolation() {
    if (this.interpolated && this.input[0] === ']') {
      this.input = this.input.slice(1);
      this.ended = true;
      return true;
    }
  }
  addText(type, value, prefix, escaped) {
    let tok;
    if (value + prefix === '') return;
    prefix = prefix || '';
    escaped = escaped || 0;

    // Process leading escape sequences iteratively instead of recursing.
    // Each iteration consumes one \#[, \@(, or \#{ and accumulates the
    // literal characters into prefix.
    for (;;) {
      const earliest = this.findEarliestCandidate(value);

      if (!earliest) {
        value = prefix + value;
        tok = this.tok(type, value);
        this.incrementColumn(value.length + escaped);
        this.tokens.push(this.tokEnd(tok));
        return;
      }

      if (earliest.kind !== 'escaped') break;

      prefix = prefix + value.substring(0, earliest.pos) + earliest.literal;
      value = value.substring(earliest.pos + 3);
      escaped++;
    }

    const earliest = this.findEarliestCandidate(value);

    switch (earliest.kind) {

    case 'interpolation':
      return this.handleInterpolation(type, value, prefix, escaped, earliest.pos);

    case 'link':
      return this.handleLinkShorthand(type, value, prefix, escaped, earliest.pos);

    case 'image':
      return this.handleImageShorthand(type, value, prefix, escaped, earliest.pos);

    case 'reference':
      return this.handleRefLink(type, value, prefix, escaped, earliest.pos);

    case 'end':
      if (prefix + value.substring(0, earliest.pos)) {
        this.addText(type, value.substring(0, earliest.pos), prefix);
      }
      this.ended = true;
      this.input = value.slice(earliest.pos + 1) + this.input;
      return;

    case 'variable':
      return this.handleVariableRef(type, value, prefix, escaped, earliest.match);

    }
  }

  findEarliestCandidate(value) {
    const candidates = [];

    if (this.interpolated) {
      const i = value.indexOf(']');
      if (i !== -1) candidates.push({ pos: i, kind: 'end' });
    }

    if (this.interpolationAllowed) {
      let i;

      i = value.indexOf('\\#[');
      if (i !== -1) candidates.push({ pos: i, kind: 'escaped', literal: '#[' });

      i = value.indexOf('\\@(');
      if (i !== -1) candidates.push({ pos: i, kind: 'escaped', literal: '@(' });

      i = value.indexOf('\\@[');
      if (i !== -1) candidates.push({ pos: i, kind: 'escaped', literal: '@[' });

      i = value.indexOf('\\!(');
      if (i !== -1) candidates.push({ pos: i, kind: 'escaped', literal: '!(' });

      i = value.indexOf('#[');
      if (i !== -1) candidates.push({ pos: i, kind: 'interpolation' });

      i = value.indexOf('@(');
      if (i !== -1) candidates.push({ pos: i, kind: 'link' });

      i = value.indexOf('@[');
      if (i !== -1) candidates.push({ pos: i, kind: 'reference' });

      i = value.indexOf('!(');
      if (i !== -1) candidates.push({ pos: i, kind: 'image' });

      const m = /(\\)?#{(\w+)}/.exec(value);
      if (m) {
        if (m[1]) {
          candidates.push({ pos: m.index, kind: 'escaped', literal: '#{' });
        } else {
          candidates.push({ pos: m.index, kind: 'variable', match: m });
        }
      }
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => a.pos - b.pos);
    return candidates[0];
  }

  spawnChildLexer(input) {
    const child = new this.constructor(input, {
      filename: this.filename,
      interpolated: true,
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
    this.tokens = this.tokens.concat(child.tokens);
    tok = this.tok('end-interpolation');
    this.incrementColumn(1);
    this.tokens.push(this.tokEnd(tok));
    this.addText(type, child.input);
  }

  handleLinkShorthand(type, value, prefix, escaped, pos) {
    let tok = this.tok(type, prefix + value.substring(0, pos));
    this.incrementColumn(prefix.length + pos + escaped);
    this.tokens.push(this.tokEnd(tok));

    const linkRest = value.substring(pos + 1); // from ( onwards
    let range;
    try {
      range = parseUntil(linkRest, ')', 1);
    } catch (ex) {
      if (ex.code === 'CHARACTER_PARSER:END_OF_STRING_REACHED') {
        this.error(
          'NO_END_BRACKET',
          'End of line reached with no closing ) for @() link shorthand.'
        );
      }
      throw ex;
    }
    const content = range.src;
    const afterLink = linkRest.substring(range.end + 1);

    let url, linkText;
    if (content.length > 0 && (content[0] === "'" || content[0] === '"')) {
      const quote = content[0];
      const endQuote = content.indexOf(quote, 1);
      if (endQuote === -1) {
        this.error('INVALID_LINK', 'Unclosed quote in @() link URL.');
      }
      url = content.substring(1, endQuote);
      const after = content.substring(endQuote + 1).trimStart();
      linkText = after || url;
    } else {
      const spaceIdx = content.indexOf(' ');
      if (spaceIdx === -1 || !content.substring(spaceIdx + 1)) {
        url = spaceIdx === -1 ? content : content.substring(0, spaceIdx);
        linkText = url;
      } else {
        url = content.substring(0, spaceIdx);
        linkText = content.substring(spaceIdx + 1);
      }
    }

    // Desugar @(url text) to equivalent #[a(href='url') text] and use child lexer
    const quote = url.includes("'") ? '"' : "'";
    const escapedUrl = url.replaceAll('\\', '\\\\').replaceAll(quote, '\\' + quote);
    const childInput = `a(href=${quote}${escapedUrl}${quote}) ${linkText}]${afterLink}`;

    tok = this.tok('start-interpolation');
    this.incrementColumn(2); // @(
    this.tokens.push(this.tokEnd(tok));
    const child = this.spawnChildLexer(childInput);
    // Correct column to actual source position (synthesized input has different length)
    this.incrementColumn(content.length);
    this.tokens = this.tokens.concat(child.tokens);
    tok = this.tok('end-interpolation');
    this.incrementColumn(1); // )
    this.tokens.push(this.tokEnd(tok));
    this.addText(type, child.input);
  }

  handleImageShorthand(type, value, prefix, escaped, pos) {
    let tok = this.tok(type, prefix + value.substring(0, pos));
    this.incrementColumn(prefix.length + pos + escaped);
    this.tokens.push(this.tokEnd(tok));

    const imageRest = value.substring(pos + 1); // from ( onwards
    let range;
    try {
      range = parseUntil(imageRest, ')', 1);
    } catch (ex) {
      if (ex.code === 'CHARACTER_PARSER:END_OF_STRING_REACHED') {
        this.error(
          'NO_END_BRACKET',
          'End of line reached with no closing ) for !() image shorthand.'
        );
      }
      throw ex;
    }
    const content = range.src;
    let afterImage = imageRest.substring(range.end + 1);

    let url, altText;
    if (content.length > 0 && (content[0] === "'" || content[0] === '"')) {
      const quote = content[0];
      const endQuote = content.indexOf(quote, 1);
      if (endQuote === -1) {
        this.error('INVALID_IMAGE', 'Unclosed quote in !() image URL.');
      }
      url = content.substring(1, endQuote);
      altText = content.substring(endQuote + 1).trimStart() || url;
    } else {
      const spaceIdx = content.indexOf(' ');
      if (spaceIdx === -1 || !content.substring(spaceIdx + 1)) {
        url = spaceIdx === -1 ? content : content.substring(0, spaceIdx);
        altText = url;
      } else {
        url = content.substring(0, spaceIdx);
        altText = content.substring(spaceIdx + 1);
      }
    }

    // Build attribute string: src='url' alt='alt text'
    const quote = url.includes("'") ? '"' : "'";
    const escapedUrl = url.replaceAll('\\', '\\\\').replaceAll(quote, '\\' + quote);
    const altQuote = altText.includes("'") ? '"' : "'";
    const escapedAlt = altText.replaceAll('\\', '\\\\').replaceAll(altQuote, '\\' + altQuote);

    // Check for optional trailing (attrs) and include them in the tag
    let extraAttrs = '';
    if (afterImage[0] === '(') {
      let attrRange;
      try {
        attrRange = parseUntil(afterImage, ')', 1);
      } catch (ex) {
        if (ex.code === 'CHARACTER_PARSER:END_OF_STRING_REACHED') {
          this.error(
            'NO_END_BRACKET',
            'End of line reached with no closing ) for !() image attributes.'
          );
        }
        throw ex;
      }
      extraAttrs = ' ' + attrRange.src;
      afterImage = afterImage.substring(attrRange.end + 1);
    }

    // Desugar !(url alt) to equivalent #[img(src='url' alt='alt text')] and use child lexer
    const childInput = `img(src=${quote}${escapedUrl}${quote} alt=${altQuote}${escapedAlt}${altQuote}${extraAttrs})]${afterImage}`;

    tok = this.tok('start-interpolation');
    this.incrementColumn(2); // !(
    this.tokens.push(this.tokEnd(tok));
    const child = this.spawnChildLexer(childInput);
    this.incrementColumn(content.length);
    this.tokens = this.tokens.concat(child.tokens);
    tok = this.tok('end-interpolation');
    this.incrementColumn(1); // )
    this.tokens.push(this.tokEnd(tok));
    this.addText(type, child.input);
  }

  handleRefLink(type, value, prefix, escaped, pos) {
    let tok = this.tok(type, prefix + value.substring(0, pos));
    this.incrementColumn(prefix.length + pos + escaped);
    this.tokens.push(this.tokEnd(tok));

    const inner = value.substring(pos + 2); // after @[
    // Find the matching ] accounting for nested #[...] brackets only
    let depth = 1;
    let end = -1;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === '\\') { i++; continue; }
      if (ch === '#' && inner[i + 1] === '[') { depth++; i++; continue; }
      if (ch === '[') { depth++; continue; }
      if (ch === ']') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) {
      this.error(
        'NO_END_BRACKET',
        'End of line reached with no closing ] for @[] reference link.'
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
      this.error('INVALID_REF_LINK', 'Reference link @[] requires an identifier.');
    }

    tok = this.tok('start-ref-link');
    tok.val = name;
    this.incrementColumn(2); // @[
    this.tokens.push(this.tokEnd(tok));

    if (linkText) {
      const textTok = this.tok('text', linkText);
      this.incrementColumn(name.length + 1 + linkText.length); // name + space + text
      this.tokens.push(this.tokEnd(textTok));
    } else {
      this.incrementColumn(name.length);
    }

    tok = this.tok('end-ref-link');
    this.incrementColumn(1); // ]
    this.tokens.push(this.tokEnd(tok));

    // Support (attrs) immediately after ]: @[name text](class="x")
    if (afterLink[0] === '(') {
      const savedInput = this.input;
      this.input = afterLink;
      this.attrs();
      afterLink = this.input;
      this.input = savedInput;
    }

    this.addText(type, afterLink);
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
    this.tokens.push(tok);
    this.incrementColumn(match[2].length);

    tok = this.tok('end-interpolation');
    this.incrementColumn(1);
    this.tokens.push(this.tokEnd(tok));

    this.addText(type, value.slice(match.index + match[0].length));
  }

  text() {
    const tok =this.scan(/^(?:\| ?| )([^\n]+)/, 'text') ||
      this.scan(/^( )/, 'text') ||
      this.scan(/^\|( ?)/, 'text');
    if (tok) {
      this.addText('text', tok.val);
      return true;
    }
  }

  textHtml() {
    const tok =this.scan(/^(<[^\n]*)/, 'text-html');
    if (tok) {
      this.addText('text-html', tok.val);
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
    const tok =this.scan(/^extends?(?= |$|\n)/, 'extends');
    if (tok) {
      this.tokens.push(this.tokEnd(tok));
      if (!this.path()) {
        this.error('NO_EXTENDS_PATH', 'missing path for extends');
      }
      return true;
    }
    if (this.scan(/^extends?\b/)) {
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
        comment =
          '//' +
          name
            .split('//')
            .slice(1)
            .join('//');
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
    const tok =this.scanEndOfLine(/^yield/, 'yield');
    if (tok) {
      this.tokens.push(this.tokEnd(tok));
      return true;
    }
  }

  /**
   * Include.
   */

  include() {
    const tok =this.scan(/^include(?=:| |$|\n)/, 'include');
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
    const tok =this.scanEndOfLine(/^ ([^\n]+)/, 'path');
    if (tok && (tok.val = tok.val.trim())) {
      this.tokens.push(this.tokEnd(tok));
      return true;
    }
  }

  variable() {
    let captures;
    if (captures = /^\s*#{(\w+)}/.exec(this.input)) {
      const tok =this.tok('variable', captures[1]);
      this.tokens.push(tok);
      this.incrementColumn(captures[0].length);
      this.consume(captures[0].length);
      this.tokEnd(tok);
      return true;
    }
  }

  /**
   * Call mixin.
   */

  call() {
    let tok, captures, increment;
    if ((captures = /^\+\s*([a-zA-Z][-\w]*)/.exec(this.input))) {
      // found mixin call syntax: +name
      increment = captures[0].length;
      this.consume(increment);
      this.incrementColumn(increment);
      tok = this.tok('call', captures[1]);

      tok.args = [];
      // Check for args (not attributes)
      // just a space separated list of strings
      // no nested parentheses allowed
      if ((captures = /^ *\((.*)\)/.exec(this.input))) {
        const increment = captures[0].length;
        this.consume(increment);
        this.incrementColumn(increment);

        const argsList = captures[1].split(/ +/).filter(Boolean);
        if (argsList.length > 0) {
          for (let i = 0, len = argsList.length; i < len; ++i) {
            if ((captures = /'(.*)'/.exec(argsList[i])) || (captures = /"(.*)"/.exec(argsList[i]))) {
              tok.args.push(captures[1]);
            } else {
              tok.args.push(argsList[i]);
            }
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
    if ((captures = /^mixin +([-\w]+)(?: *\((.*)\))? */.exec(this.input))) {
      this.consume(captures[0].length);
      const tok =this.tok('mixin', captures[1]);
      tok.args = (captures[2] || '').split(/ +/).filter(Boolean);
      this.incrementColumn(captures[0].length);
      this.tokens.push(this.tokEnd(tok));
      return true;
    }
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
              'Reference definition requires both a name and a URL: ' + content
            );
          }
          const name = content.substring(0, spaceIdx);
          let url = content.substring(spaceIdx + 1).trim();

          // Handle quoted URLs
          if ((url[0] === "'" || url[0] === '"') && url[url.length - 1] === url[0]) {
            url = url.substring(1, url.length - 1);
          }

          const tok = this.tok('ref-def');
          tok.name = name;
          tok.url = url;
          this.incrementColumn(content.length);
          this.tokens.push(this.tokEnd(tok));
        } else {
          this.incrementLine(1);
        }
      }
    } while (this.input.length - stringPtr && isMatch);
    this.consume(stringPtr);
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
    let key = '', value = '';
    let i;

    // consume all whitespace before the key
    i = this.skipWhitespace(str, 0);

    if (i === str.length) {
      return '';
    }

    const tok =this.tok('attribute');

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
        if (
          whitespaceRe.test(str[i]) ||
          str[i] === '='
        ) {
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
          'Code points not allowed in HTML attribute names: ' + invalid
        );
    }

    tok.name = key;

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
      } else { quote = null; }

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
            case '\'':
              value += '\'';
              break;
            case '"':
              value += '"';
              break;
            case 'n':
              value += '\n';
              break;
            case 't':
              value += '\t';
              break;
            default:
              value += str[i];
              break;
            }
            this.incrementColumn(2);
            continue;
          }
        } else {
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
        'Invalid code point after attribute value: `' + str[i] + '`'
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

    if ('(' == this.input.charAt(0)) {
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

      if (' ' == this.input[0] || '\t' == this.input[0]) {
        this.error(
          'INVALID_INDENTATION',
          'Invalid indentation, you can use tabs or spaces but not both'
        );
      }

      // blank line
      if ('\n' == this.input[0]) {
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
                ' spaces/tabs.'
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
      } else if (indents && indents != this.indentStack[0]) {
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
      this.tokens.push(this.tokEnd(this.tok('start-pipeless-text')));
      const tokens = [];
      const token_indent = [];
      let isMatch;
      // Index in this.input. Can't use this.consume because we might need to
      // retry lexing the block.
      let stringPtr = 0;
      do {
        // text has `\n` as a prefix
        let i = this.input.slice(stringPtr + 1).indexOf('\n');
        if (-1 == i) i = this.input.length - stringPtr - 1;
        const str = this.input.slice(stringPtr + 1, stringPtr + 1 + i);
        const lineCaptures = this.indentRe.exec('\n' + str);
        const lineIndents = lineCaptures && lineCaptures[1].length;
        isMatch = lineIndents >= indents;
        token_indent.push(isMatch);
        isMatch = isMatch || !str.trim();
        if (isMatch) {
          // consume test along with `\n` prefix if match
          stringPtr += str.length + 1;
          tokens.push(str.slice(indents));
        } else if (lineIndents > this.indentStack[0]) {
          // line is indented less than the first line but is still indented
          // need to retry lexing the text block
          this.tokens.pop();
          return this.pipelessText(lineCaptures[1].length);
        }
      } while (this.input.length - stringPtr && isMatch);
      this.consume(stringPtr);
      while (this.input.length === 0 && tokens[tokens.length - 1] === '')
        tokens.pop();

      // Merge lines with unclosed #[...] or @(...) constructs so that
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
    const tok =this.scan(/^: +/, ':');
    if (tok) {
      this.tokens.push(this.tokEnd(tok));
      return true;
    }
  }

  fail() {
    this.error(
      'UNEXPECTED_TEXT',
      'unexpected text "' + this.input.slice(0, 5) + '"'
    );
  }

  advance() {
    return (
      this.blank() ||
      this.eos() ||
      this.endInterpolation() ||
      this.variable() ||
      this.yield() ||
      this['extends']() ||
      this.append() ||
      this.prepend() ||
      this.block() ||
      this.mixinBlock() ||
      this.include() ||
      this.references() ||
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
      this.textHtml() ||
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
