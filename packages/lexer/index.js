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

/**
 * Find the index of the closing bracket that matches the opening bracket
 * at position `start` in `str`. Respects quoted strings (single and double)
 * and escaped characters. Returns an object with an `end` property.
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

  for (; i < str.length; i++) {
    let c = str[i];

    if (quote) {
      if (c === '\\') {
        i++; // skip escaped character
        continue;
      }
      if (c === quote) {
        quote = null;
      }
      continue;
    }

    if (c === '\'' || c === '"' || c === '`') {
      quote = c;
      continue;
    }

    let open = {')': '(', '}': '{', ']': '['}[end];

    if (c === open) {
      depth++;
    } else if (c === end) {
      depth--;
      if (depth === 0) {
        return {end: i, src: str.substring(start, i)};
      }
    }
  }

  // Reached end of string without finding the closing bracket
  let err = new Error(
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
  let stack = [];
  let quote = null;
  let pairs = {'(': ')', '{': '}', '[': ']'};

  for (let i = 0; i < str.length; i++) {
    let c = str[i];

    if (quote) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === quote) {
        quote = null;
      }
      continue;
    }

    if (c === '\'' || c === '"' || c === '`') {
      quote = c;
      continue;
    }

    if (pairs[c]) {
      stack.push(pairs[c]);
    } else if (c === ')' || c === '}' || c === ']') {
      if (stack.length === 0 || stack.pop() !== c) {
        return true; // mismatched
      }
    }
  }

  return stack.length !== 0 || quote !== null;
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
    let err = error(code, message, {
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
    let res = {
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
    this.input = this.input.substr(len);
  }

  scan(regexp, type) {
    let captures;
    if ((captures = regexp.exec(this.input))) {
      let len =captures[0].length;
      let val = captures[1];
      let diff = len - (val ? val.length : 0);
      let tok =this.tok(type, val);
      this.consume(len);
      this.incrementColumn(diff);
      return tok;
    }
  }
  scanEndOfLine(regexp, type) {
    let captures;
    if ((captures = regexp.exec(this.input))) {
      let whitespaceLength = 0;
      let whitespace;
      let tok;
      if ((whitespace = /^([ ]+)([^ ]*)/.exec(captures[0]))) {
        whitespaceLength = whitespace[1].length;
        this.incrementColumn(whitespaceLength);
      }
      let newInput =this.input.substr(captures[0].length);
      if (newInput[0] === ':') {
        this.input = newInput;
        tok = this.tok(type, captures[1]);
        this.incrementColumn(captures[0].length - whitespaceLength);
        return tok;
      }
      if (/^[ \t]*(\n|$)/.test(newInput)) {
        this.input = newInput.substr(/^[ \t]*/.exec(newInput)[0].length);
        tok = this.tok(type, captures[1]);
        this.incrementColumn(captures[0].length - whitespaceLength);
        return tok;
      }
    }
  }

  bracketExpression(skip) {
    skip = skip || 0;
    let start = this.input[skip];
    if (start !== '(' && start !== '{' && start !== '[') {
      throw new Error('The start character should be "(", "{" or "["');
    }
    let end = {'(': ')', '{': '}', '[': ']'}[start];
    let range;
    try {
      range = parseUntil(this.input, end, skip + 1);
    } catch (ex) {
      if (ex.index !== undefined) {
        let idx = ex.index;
        // starting from this.input[skip]
        let tmp = this.input.substr(skip).indexOf('\n');
        // starting from this.input[0]
        let nextNewline = tmp + skip;
        let ptr = 0;
        while (idx > nextNewline && tmp !== -1) {
          this.incrementLine(1);
          idx -= nextNewline + 1;
          ptr += nextNewline + 1;
          tmp = nextNewline = this.input.substr(ptr).indexOf('\n');
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
      let tok =this.tok('comment', captures[2]);
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
    let tok =this.scan(/^:([\w\-]+)/, 'filter') ||
        this.scan(/^:'(.+)'/, 'filter') ||
        this.scan(/^:"(.+)"/, 'filter');

    let inInclude = opts && opts.inInclude;
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
    let tok =this.scan(/^#([\w-]+)/, 'id');
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
          /.[^ \t\(\#\.\:]*/.exec(this.input.substr(1))[0] +
          '" is not a valid ID.'
      );
    }
  }

  /**
   * Class.
   */

  className() {
    let tok =this.scan(/^\.([_a-z0-9\-]*[_a-z][_a-z0-9\-]*)/i, 'class');
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
          /.[^ \t\(\#\.\:]*/.exec(this.input.substr(1))[0] +
          '" is not a valid class name.  Class names can only contain "_", "-", a-z and 0-9, and must contain at least one of "_", or a-z'
      );
    }
  }

  /**
   * Text.
   */
  endInterpolation() {
    if (this.interpolated && this.input[0] === ']') {
      this.input = this.input.substr(1);
      this.ended = true;
      return true;
    }
  }
  addText(type, value, prefix, escaped) {
    let tok;
    if (value + prefix === '') return;
    prefix = prefix || '';
    escaped = escaped || 0;
    let indexOfEnd = this.interpolated ? value.indexOf(']') : -1;
    let indexOfStart = this.interpolationAllowed ? value.indexOf('#[') : -1;
    let indexOfEscaped = this.interpolationAllowed ? value.indexOf('\\#[') : -1;
    let matchOfVarRef = this.interpolationAllowed? /(\\)?#{(\w+)}/.exec(value) : null;
    let indexOfVarRef = matchOfVarRef? matchOfVarRef.index : Infinity;

    if (indexOfEnd === -1) indexOfEnd = Infinity;
    if (indexOfStart === -1) indexOfStart = Infinity;
    if (indexOfEscaped === -1) indexOfEscaped = Infinity;

    if (
      indexOfEscaped !== Infinity &&
      indexOfEscaped < indexOfEnd &&
      indexOfEscaped < indexOfStart &&
      indexOfEscaped < indexOfVarRef
    ) {
      prefix = prefix + value.substring(0, indexOfEscaped) + '#[';
      return this.addText(
        type,
        value.substring(indexOfEscaped + 3),
        prefix,
        escaped + 1
      );
    }
    if (
      indexOfStart !== Infinity &&
      indexOfStart < indexOfEnd &&
      indexOfStart < indexOfEscaped &&
      indexOfStart < indexOfVarRef
    ) {
      tok = this.tok(type, prefix + value.substring(0, indexOfStart));
      this.incrementColumn(prefix.length + indexOfStart + escaped);
      this.tokens.push(this.tokEnd(tok));
      tok = this.tok('start-interpolation');
      this.incrementColumn(2);
      this.tokens.push(this.tokEnd(tok));
      let child = new this.constructor(value.substr(indexOfStart + 2), {
        filename: this.filename,
        interpolated: true,
        startingLine: this.lineno,
        startingColumn: this.colno,
      });
      let interpolated;
      try {
        interpolated = child.getTokens();
      } catch (ex) {
        if (ex.code && /^PUGNEUM:/.test(ex.code)) {
          this.colno = ex.column;
          this.error(ex.code.substr(8), ex.msg);
        }
        throw ex;
      }
      this.colno = child.colno;
      this.tokens = this.tokens.concat(interpolated);
      tok = this.tok('end-interpolation');
      this.incrementColumn(1);
      this.tokens.push(this.tokEnd(tok));
      this.addText(type, child.input);
      return;
    }
    if (
      indexOfEnd !== Infinity &&
      indexOfEnd < indexOfStart &&
      indexOfEnd < indexOfEscaped &&
      indexOfEnd < indexOfVarRef
    ) {
      if (prefix + value.substring(0, indexOfEnd)) {
        this.addText(type, value.substring(0, indexOfEnd), prefix);
      }
      this.ended = true;
      this.input = value.substr(value.indexOf(']') + 1) + this.input;
      return;
    }

    if (indexOfVarRef !== Infinity) {
      if (matchOfVarRef[1]) {
        // escaped: \#{
        prefix = prefix + value.substring(0, indexOfVarRef) + '#{';
        return this.addText(
          type,
          value.substring(indexOfVarRef + 3),
          prefix,
          escaped + 1
        );
      }
      let before = value.substr(0, indexOfVarRef);
      if (prefix || before) {
        before = prefix + before;
        tok = this.tok(type, before);
        this.incrementColumn(before.length + escaped);
        this.tokens.push(this.tokEnd(tok));
      }

      tok = this.tok('start-interpolation');
      this.incrementColumn(2);
      this.tokens.push(this.tokEnd(tok));

      tok = this.tok('variable', matchOfVarRef[2]);
      this.tokens.push(tok);
      this.incrementColumn(matchOfVarRef[2].length);

      tok = this.tok('end-interpolation');
      this.incrementColumn(1);
      this.tokens.push(this.tokEnd(tok));

      value = value.substr(value.indexOf('}') + 1);
    }

    value = prefix + value;
    tok = this.tok(type, value);
    this.incrementColumn(value.length + escaped);
    this.tokens.push(this.tokEnd(tok));
  }

  text() {
    let tok =this.scan(/^(?:\| ?| )([^\n]+)/, 'text') ||
      this.scan(/^( )/, 'text') ||
      this.scan(/^\|( ?)/, 'text');
    if (tok) {
      this.addText('text', tok.val);
      return true;
    }
  }

  textHtml() {
    let tok =this.scan(/^(<[^\n]*)/, 'text-html');
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
    let tok =this.scan(/^extends?(?= |$|\n)/, 'extends');
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

  prepend() {
    let captures;
    if ((captures = /^(?:block +)?prepend +([^\n]+)/.exec(this.input))) {
      let name =captures[1].trim();
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
      let tok =this.tok('block', name);
      let len =captures[0].length - comment.length;
      while (whitespaceRe.test(this.input.charAt(len - 1))) len--;
      this.incrementColumn(len);
      tok.mode = 'prepend';
      this.tokens.push(this.tokEnd(tok));
      this.consume(captures[0].length - comment.length);
      this.incrementColumn(captures[0].length - comment.length - len);
      return true;
    }
  }

  /**
   * Block append.
   */

  append() {
    let captures;
    if ((captures = /^(?:block +)?append +([^\n]+)/.exec(this.input))) {
      let name =captures[1].trim();
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
      let tok =this.tok('block', name);
      let len =captures[0].length - comment.length;
      while (whitespaceRe.test(this.input.charAt(len - 1))) len--;
      this.incrementColumn(len);
      tok.mode = 'append';
      this.tokens.push(this.tokEnd(tok));
      this.consume(captures[0].length - comment.length);
      this.incrementColumn(captures[0].length - comment.length - len);
      return true;
    }
  }

  /**
   * Block.
   */

  block() {
    let captures;
    if ((captures = /^block +([^\n]+)/.exec(this.input))) {
      let name =captures[1].trim();
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
      let tok =this.tok('block', name);
      let len =captures[0].length - comment.length;
      while (whitespaceRe.test(this.input.charAt(len - 1))) len--;
      this.incrementColumn(len);
      tok.mode = 'replace';
      this.tokens.push(this.tokEnd(tok));
      this.consume(captures[0].length - comment.length);
      this.incrementColumn(captures[0].length - comment.length - len);
      return true;
    }
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
    let tok =this.scanEndOfLine(/^yield/, 'yield');
    if (tok) {
      this.tokens.push(this.tokEnd(tok));
      return true;
    }
  }

  /**
   * Include.
   */

  include() {
    let tok =this.scan(/^include(?=:| |$|\n)/, 'include');
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
    let tok =this.scanEndOfLine(/^ ([^\n]+)/, 'path');
    if (tok && (tok.val = tok.val.trim())) {
      this.tokens.push(this.tokEnd(tok));
      return true;
    }
  }

  variable() {
    let captures;
    if (captures = /^\s*#{(\w+)}/.exec(this.input)) {
      let tok =this.tok('variable', captures[1]);
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
        let increment = captures[0].length;
        this.consume(increment);
        this.incrementColumn(increment);

        let argsList = captures[1].split(/ +/).filter(Boolean);
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
      let tok =this.tok('mixin', captures[1]);
      tok.args = (captures[2] || '').split(/ +/).filter(Boolean);
      this.incrementColumn(captures[0].length);
      this.tokens.push(this.tokEnd(tok));
      return true;
    }
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
    let quoteRe = /['"]/;
    let key = '', value = '';
    let i;

    // consume all whitespace before the key
    i = this.skipWhitespace(str, 0);

    if (i === str.length) {
      return '';
    }

    let tok =this.tok('attribute');

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

    let invalid = key.replaceAll(attributeName, '');
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
            ++i;
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

    return str.substr(i);
  }

  /**
   * Attributes.
   */

  attrs() {
    let tok;

    if ('(' == this.input.charAt(0)) {
      tok = this.tok('start-attributes');
      let index = this.bracketExpression().end;
      let str = this.input.substr(1, index - 1);

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
    let captures = this.scanIndentation();
    let tok;

    if (captures) {
      let indents = captures[1].length;

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

    let captures = this.scanIndentation();

    indents = indents || (captures && captures[1].length);
    if (indents > this.indentStack[0]) {
      this.tokens.push(this.tokEnd(this.tok('start-pipeless-text')));
      let tokens = [];
      let token_indent = [];
      let isMatch;
      // Index in this.input. Can't use this.consume because we might need to
      // retry lexing the block.
      let stringPtr = 0;
      do {
        // text has `\n` as a prefix
        let i = this.input.substr(stringPtr + 1).indexOf('\n');
        if (-1 == i) i = this.input.length - stringPtr - 1;
        let str = this.input.substr(stringPtr + 1, i);
        let lineCaptures = this.indentRe.exec('\n' + str);
        let lineIndents = lineCaptures && lineCaptures[1].length;
        isMatch = lineIndents >= indents;
        token_indent.push(isMatch);
        isMatch = isMatch || !str.trim();
        if (isMatch) {
          // consume test along with `\n` prefix if match
          stringPtr += str.length + 1;
          tokens.push(str.substr(indents));
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
      tokens.forEach(
        function(token, i) {
          let tok;
          this.incrementLine(1);
          if (i !== 0) tok = this.tok('newline');
          if (token_indent[i]) this.incrementColumn(indents);
          if (tok) this.tokens.push(this.tokEnd(tok));
          this.addText('text', token);
        }.bind(this)
      );
      this.tokens.push(this.tokEnd(this.tok('end-pipeless-text')));
      return true;
    }
  }

  /**
   * ':'
   */

  colon() {
    let tok =this.scan(/^: +/, ':');
    if (tok) {
      this.tokens.push(this.tokEnd(tok));
      return true;
    }
  }

  fail() {
    this.error(
      'UNEXPECTED_TEXT',
      'unexpected text "' + this.input.substr(0, 5) + '"'
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
