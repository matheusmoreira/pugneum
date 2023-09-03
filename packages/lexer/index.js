'use strict';

var assert = require('assert');
var characterParser = require('character-parser');
var error = require('pugneum-error');

module.exports = lex;

function lex(str, options) {
  var lexer = new Lexer(str, options);
  return JSON.parse(JSON.stringify(lexer.getTokens()));
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

/**
 * Initialize `Lexer` with the given `str`.
 *
 * @param {String} str
 * @param {String} filename
 * @api private
 */

function Lexer(str, options) {
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
  this.plugins = options.plugins || [];
  this.indentStack = [0];
  this.indentRe = null;
  // If #{}, !{} or #[] syntax is allowed when adding text
  this.interpolationAllowed = true;
  this.whitespaceRe = /[ \n\t]/;

  this.tokens = [];
  this.ended = false;
}

/**
 * Lexer prototype.
 */

Lexer.prototype = {
  constructor: Lexer,

  error: function(code, message) {
    var err = error(code, message, {
      line: this.lineno,
      column: this.colno,
      filename: this.filename,
      src: this.originalInput,
    });
    throw err;
  },

  assert: function(value, message) {
    if (!value) this.error('ASSERT_FAILED', message);
  },

  assertNestingCorrect: function(exp) {
    //this verifies that code is properly nested, but allows
    //invalid JavaScript such as the contents of `attributes`
    var res = characterParser.default(exp);
    if (res.isNesting()) {
      this.error(
        'INCORRECT_NESTING',
        'Nesting must match on expression `' + exp + '`'
      );
    }
  },

  /**
   * Construct a token with the given `type` and `val`.
   *
   * @param {String} type
   * @param {String} val
   * @return {Object}
   * @api private
   */

  tok: function(type, val) {
    var res = {
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
  },

  /**
   * Set the token's `loc.end` value.
   *
   * @param {Object} tok
   * @returns {Object}
   * @api private
   */

  tokEnd: function(tok) {
    tok.loc.end = {
      line: this.lineno,
      column: this.colno,
    };
    return tok;
  },

  /**
   * Increment `this.lineno` and reset `this.colno`.
   *
   * @param {Number} increment
   * @api private
   */

  incrementLine: function(increment) {
    this.lineno += increment;
    if (increment) this.colno = 1;
  },

  /**
   * Increment `this.colno`.
   *
   * @param {Number} increment
   * @api private
   */

  incrementColumn: function(increment) {
    this.colno += increment;
  },

  /**
   * Consume the given `len` of input.
   *
   * @param {Number} len
   * @api private
   */

  consume: function(len) {
    this.input = this.input.substr(len);
  },

  /**
   * Scan for `type` with the given `regexp`.
   *
   * @param {String} type
   * @param {RegExp} regexp
   * @return {Object}
   * @api private
   */

  scan: function(regexp, type) {
    var captures;
    if ((captures = regexp.exec(this.input))) {
      var len = captures[0].length;
      var val = captures[1];
      var diff = len - (val ? val.length : 0);
      var tok = this.tok(type, val);
      this.consume(len);
      this.incrementColumn(diff);
      return tok;
    }
  },
  scanEndOfLine: function(regexp, type) {
    var captures;
    if ((captures = regexp.exec(this.input))) {
      var whitespaceLength = 0;
      var whitespace;
      var tok;
      if ((whitespace = /^([ ]+)([^ ]*)/.exec(captures[0]))) {
        whitespaceLength = whitespace[1].length;
        this.incrementColumn(whitespaceLength);
      }
      var newInput = this.input.substr(captures[0].length);
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
  },

  /**
   * Return the indexOf `(` or `{` or `[` / `)` or `}` or `]` delimiters.
   *
   * Make sure that when calling this function, colno is at the character
   * immediately before the beginning.
   *
   * @return {Number}
   * @api private
   */

  bracketExpression: function(skip) {
    skip = skip || 0;
    var start = this.input[skip];
    assert(
      start === '(' || start === '{' || start === '[',
      'The start character should be "(", "{" or "["'
    );
    var end = {'(': ')', '{': '}', '[': ']'}[start];
    var range;
    try {
      range = characterParser.parseUntil(this.input, end, {start: skip + 1});
    } catch (ex) {
      if (ex.index !== undefined) {
        var idx = ex.index;
        // starting from this.input[skip]
        var tmp = this.input.substr(skip).indexOf('\n');
        // starting from this.input[0]
        var nextNewline = tmp + skip;
        var ptr = 0;
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
  },

  scanIndentation: function() {
    var captures, re;

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
  },

  /**
   * end-of-source.
   */

  eos: function() {
    if (this.input.length) return;
    if (this.interpolated) {
      this.error(
        'NO_END_BRACKET',
        'End of line was reached with no closing bracket for interpolation.'
      );
    }
    for (var i = 0; this.indentStack[i]; i++) {
      this.tokens.push(this.tokEnd(this.tok('outdent')));
    }
    this.tokens.push(this.tokEnd(this.tok('eos')));
    this.ended = true;
    return true;
  },

  /**
   * Blank line.
   */

  blank: function() {
    var captures;
    if ((captures = /^\n[ \t]*\n/.exec(this.input))) {
      this.consume(captures[0].length - 1);
      this.incrementLine(1);
      return true;
    }
  },

  /**
   * Comment.
   */

  comment: function() {
    var captures;
    if ((captures = /^\/\/(-)?([^\n]*)/.exec(this.input))) {
      this.consume(captures[0].length);
      var tok = this.tok('comment', captures[2]);
      tok.buffer = '-' != captures[1];
      this.interpolationAllowed = tok.buffer;
      this.tokens.push(tok);
      this.incrementColumn(captures[0].length);
      this.tokEnd(tok);
      this.callLexerFunction('pipelessText');
      return true;
    }
  },

  /**
   * Tag.
   */

  tag: function() {
    var captures;

    if ((captures = /^(\w(?:[-:\w]*\w)?)/.exec(this.input))) {
      var tok,
        name = captures[1],
        len = captures[0].length;
      this.consume(len);
      tok = this.tok('tag', name);
      this.tokens.push(tok);
      this.incrementColumn(len);
      this.tokEnd(tok);
      return true;
    }
  },

  /**
   * Filter.
   */

  filter: function(opts) {
    let tok = this.scan(/^:([\w\-]+)/, 'filter') ||
        this.scan(/^:'(.+)'/, 'filter') ||
        this.scan(/^:"(.+)"/, 'filter');

    var inInclude = opts && opts.inInclude;
    if (tok) {
      this.tokens.push(tok);
      this.incrementColumn(tok.val.length);
      this.tokEnd(tok);
      this.callLexerFunction('attrs');
      if (!inInclude) {
        this.interpolationAllowed = false;
        this.callLexerFunction('pipelessText');
      }
      return true;
    }
  },

  /**
   * Id.
   */

  id: function() {
    var tok = this.scan(/^#([\w-]+)/, 'id');
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
  },

  /**
   * Class.
   */

  className: function() {
    var tok = this.scan(/^\.([_a-z0-9\-]*[_a-z][_a-z0-9\-]*)/i, 'class');
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
  },

  /**
   * Text.
   */
  endInterpolation: function() {
    if (this.interpolated && this.input[0] === ']') {
      this.input = this.input.substr(1);
      this.ended = true;
      return true;
    }
  },
  addText: function(type, value, prefix, escaped) {
    var tok;
    if (value + prefix === '') return;
    prefix = prefix || '';
    escaped = escaped || 0;
    var indexOfEnd = this.interpolated ? value.indexOf(']') : -1;
    var indexOfStart = this.interpolationAllowed ? value.indexOf('#[') : -1;
    var indexOfEscaped = this.interpolationAllowed ? value.indexOf('\\#[') : -1;

    if (indexOfEnd === -1) indexOfEnd = Infinity;
    if (indexOfStart === -1) indexOfStart = Infinity;
    if (indexOfEscaped === -1) indexOfEscaped = Infinity;

    if (
      indexOfEscaped !== Infinity &&
      indexOfEscaped < indexOfEnd &&
      indexOfEscaped < indexOfStart
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
      indexOfStart < indexOfEscaped
    ) {
      tok = this.tok(type, prefix + value.substring(0, indexOfStart));
      this.incrementColumn(prefix.length + indexOfStart + escaped);
      this.tokens.push(this.tokEnd(tok));
      tok = this.tok('start-interpolation');
      this.incrementColumn(2);
      this.tokens.push(this.tokEnd(tok));
      var child = new this.constructor(value.substr(indexOfStart + 2), {
        filename: this.filename,
        interpolated: true,
        startingLine: this.lineno,
        startingColumn: this.colno,
        plugins: this.plugins,
      });
      var interpolated;
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
      indexOfEnd < indexOfEscaped
    ) {
      if (prefix + value.substring(0, indexOfEnd)) {
        this.addText(type, value.substring(0, indexOfEnd), prefix);
      }
      this.ended = true;
      this.input = value.substr(value.indexOf(']') + 1) + this.input;
      return;
    }

    value = prefix + value;
    tok = this.tok(type, value);
    this.incrementColumn(value.length + escaped);
    this.tokens.push(this.tokEnd(tok));
  },

  text: function() {
    var tok =
      this.scan(/^(?:\| ?| )([^\n]+)/, 'text') ||
      this.scan(/^( )/, 'text') ||
      this.scan(/^\|( ?)/, 'text');
    if (tok) {
      this.addText('text', tok.val);
      return true;
    }
  },

  textHtml: function() {
    var tok = this.scan(/^(<[^\n]*)/, 'text-html');
    if (tok) {
      this.addText('text-html', tok.val);
      return true;
    }
  },

  /**
   * Dot.
   */

  dot: function() {
    var tok;
    if ((tok = this.scanEndOfLine(/^\./, 'dot'))) {
      this.tokens.push(this.tokEnd(tok));
      this.callLexerFunction('pipelessText');
      return true;
    }
  },

  /**
   * Extends.
   */

  extends: function() {
    var tok = this.scan(/^extends?(?= |$|\n)/, 'extends');
    if (tok) {
      this.tokens.push(this.tokEnd(tok));
      if (!this.callLexerFunction('path')) {
        this.error('NO_EXTENDS_PATH', 'missing path for extends');
      }
      return true;
    }
    if (this.scan(/^extends?\b/)) {
      this.error('MALFORMED_EXTENDS', 'malformed extends');
    }
  },

  /**
   * Block prepend.
   */

  prepend: function() {
    var captures;
    if ((captures = /^(?:block +)?prepend +([^\n]+)/.exec(this.input))) {
      var name = captures[1].trim();
      var comment = '';
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
      var tok = this.tok('block', name);
      var len = captures[0].length - comment.length;
      while (this.whitespaceRe.test(this.input.charAt(len - 1))) len--;
      this.incrementColumn(len);
      tok.mode = 'prepend';
      this.tokens.push(this.tokEnd(tok));
      this.consume(captures[0].length - comment.length);
      this.incrementColumn(captures[0].length - comment.length - len);
      return true;
    }
  },

  /**
   * Block append.
   */

  append: function() {
    var captures;
    if ((captures = /^(?:block +)?append +([^\n]+)/.exec(this.input))) {
      var name = captures[1].trim();
      var comment = '';
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
      var tok = this.tok('block', name);
      var len = captures[0].length - comment.length;
      while (this.whitespaceRe.test(this.input.charAt(len - 1))) len--;
      this.incrementColumn(len);
      tok.mode = 'append';
      this.tokens.push(this.tokEnd(tok));
      this.consume(captures[0].length - comment.length);
      this.incrementColumn(captures[0].length - comment.length - len);
      return true;
    }
  },

  /**
   * Block.
   */

  block: function() {
    var captures;
    if ((captures = /^block +([^\n]+)/.exec(this.input))) {
      var name = captures[1].trim();
      var comment = '';
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
      var tok = this.tok('block', name);
      var len = captures[0].length - comment.length;
      while (this.whitespaceRe.test(this.input.charAt(len - 1))) len--;
      this.incrementColumn(len);
      tok.mode = 'replace';
      this.tokens.push(this.tokEnd(tok));
      this.consume(captures[0].length - comment.length);
      this.incrementColumn(captures[0].length - comment.length - len);
      return true;
    }
  },

  /**
   * Mixin Block.
   */

  mixinBlock: function() {
    var tok;
    if ((tok = this.scanEndOfLine(/^block/, 'mixin-block'))) {
      this.tokens.push(this.tokEnd(tok));
      return true;
    }
  },

  /**
   * Yield.
   */

  yield: function() {
    var tok = this.scanEndOfLine(/^yield/, 'yield');
    if (tok) {
      this.tokens.push(this.tokEnd(tok));
      return true;
    }
  },

  /**
   * Include.
   */

  include: function() {
    var tok = this.scan(/^include(?=:| |$|\n)/, 'include');
    if (tok) {
      this.tokens.push(this.tokEnd(tok));
      while (this.callLexerFunction('filter', {inInclude: true}));
      if (!this.callLexerFunction('path')) {
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
  },

  /**
   * Path
   */

  path: function() {
    var tok = this.scanEndOfLine(/^ ([^\n]+)/, 'path');
    if (tok && (tok.val = tok.val.trim())) {
      this.tokens.push(this.tokEnd(tok));
      return true;
    }
  },

  /**
   * Default.
   */

  default: function() {
    var tok = this.scanEndOfLine(/^default/, 'default');
    if (tok) {
      this.tokens.push(this.tokEnd(tok));
      return true;
    }
    if (this.scan(/^default\b/)) {
      this.error(
        'DEFAULT_WITH_EXPRESSION',
        'default should not have an expression'
      );
    }
  },

  /**
   * Call mixin.
   */

  call: function() {
    var tok, captures, increment;
    if ((captures = /^\+(\s*)([-\w]+)/.exec(this.input))) {
      // consume simple call
      increment = captures[0].length;
      this.consume(increment);
      tok = this.tok('call', captures[2]);

      this.incrementColumn(increment);

      tok.args = null;
      // Check for args (not attributes)
      if ((captures = /^ *\(/.exec(this.input))) {
        var range = this.bracketExpression(captures[0].length - 1);
        if (!/^\s*[-\w]+ *=/.test(range.src)) {
          // not attributes
          this.incrementColumn(1);
          this.consume(range.end + 1);
          tok.args = range.src;
          for (var i = 0; i <= tok.args.length; i++) {
            if (tok.args[i] === '\n') {
              this.incrementLine(1);
            } else {
              this.incrementColumn(1);
            }
          }
        }
      }
      this.tokens.push(this.tokEnd(tok));
      return true;
    }
  },

  /**
   * Mixin.
   */

  mixin: function() {
    var captures;
    if ((captures = /^mixin +([-\w]+)(?: *\((.*)\))? */.exec(this.input))) {
      this.consume(captures[0].length);
      var tok = this.tok('mixin', captures[1]);
      tok.args = captures[2] || null;
      this.incrementColumn(captures[0].length);
      this.tokens.push(this.tokEnd(tok));
      return true;
    }
  },

  skipWhitespace: function (str, i) {
    for (; i < str.length; i++) {
      if (!this.whitespaceRe.test(str[i])) break;
      if (str[i] === '\n') {
        this.incrementLine(1);
      } else {
        this.incrementColumn(1);
      }
    }
    return i;
  },

  /**
   * Attribute name and value.
   */
  attribute: function(str) {
    var quote = '';
    var quoteRe = /['"]/;
    var key = '', value = '';
    var i;

    // consume all whitespace before the key
    i = this.skipWhitespace(str, 0);

    if (i === str.length) {
      return '';
    }

    var tok = this.tok('attribute');

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
          this.whitespaceRe.test(str[i]) ||
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
          if (this.whitespaceRe.test(str[i])) {
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

    if (quote && str[i] && !this.whitespaceRe.test(str[i])) {
      this.error(
        'MALFORMED_ATTRIBUTE',
        'Invalid code point after attribute value: `' + str[i] + '`'
        );
    }

    i = this.skipWhitespace(str, i);

    return str.substr(i);
  },

  /**
   * Attributes.
   */

  attrs: function() {
    var tok;

    if ('(' == this.input.charAt(0)) {
      tok = this.tok('start-attributes');
      var index = this.bracketExpression().end;
      var str = this.input.substr(1, index - 1);

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
  },

  /**
   * Indent | Outdent | Newline.
   */

  indent: function() {
    var captures = this.scanIndentation();
    var tok;

    if (captures) {
      var indents = captures[1].length;

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
        var outdent_count = 0;
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
  },

  pipelessText: function pipelessText(indents) {
    while (this.callLexerFunction('blank'));

    var captures = this.scanIndentation();

    indents = indents || (captures && captures[1].length);
    if (indents > this.indentStack[0]) {
      this.tokens.push(this.tokEnd(this.tok('start-pipeless-text')));
      var tokens = [];
      var token_indent = [];
      var isMatch;
      // Index in this.input. Can't use this.consume because we might need to
      // retry lexing the block.
      var stringPtr = 0;
      do {
        // text has `\n` as a prefix
        var i = this.input.substr(stringPtr + 1).indexOf('\n');
        if (-1 == i) i = this.input.length - stringPtr - 1;
        var str = this.input.substr(stringPtr + 1, i);
        var lineCaptures = this.indentRe.exec('\n' + str);
        var lineIndents = lineCaptures && lineCaptures[1].length;
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
          return pipelessText.call(this, lineCaptures[1].length);
        }
      } while (this.input.length - stringPtr && isMatch);
      this.consume(stringPtr);
      while (this.input.length === 0 && tokens[tokens.length - 1] === '')
        tokens.pop();
      tokens.forEach(
        function(token, i) {
          var tok;
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
  },

  /**
   * Slash.
   */

  slash: function() {
    var tok = this.scan(/^\//, 'slash');
    if (tok) {
      this.tokens.push(this.tokEnd(tok));
      return true;
    }
  },

  /**
   * ':'
   */

  colon: function() {
    var tok = this.scan(/^: +/, ':');
    if (tok) {
      this.tokens.push(this.tokEnd(tok));
      return true;
    }
  },

  fail: function() {
    this.error(
      'UNEXPECTED_TEXT',
      'unexpected text "' + this.input.substr(0, 5) + '"'
    );
  },

  callLexerFunction: function(func) {
    var rest = [];
    for (var i = 1; i < arguments.length; i++) {
      rest.push(arguments[i]);
    }
    var pluginArgs = [this].concat(rest);
    for (var i = 0; i < this.plugins.length; i++) {
      var plugin = this.plugins[i];
      if (plugin[func] && plugin[func].apply(plugin, pluginArgs)) {
        return true;
      }
    }
    return this[func].apply(this, rest);
  },

  /**
   * Move to the next token
   *
   * @api private
   */

  advance: function() {
    return (
      this.callLexerFunction('blank') ||
      this.callLexerFunction('eos') ||
      this.callLexerFunction('endInterpolation') ||
      this.callLexerFunction('yield') ||
      this.callLexerFunction('default') ||
      this.callLexerFunction('extends') ||
      this.callLexerFunction('append') ||
      this.callLexerFunction('prepend') ||
      this.callLexerFunction('block') ||
      this.callLexerFunction('mixinBlock') ||
      this.callLexerFunction('include') ||
      this.callLexerFunction('mixin') ||
      this.callLexerFunction('call') ||
      this.callLexerFunction('tag') ||
      this.callLexerFunction('filter') ||
      this.callLexerFunction('id') ||
      this.callLexerFunction('dot') ||
      this.callLexerFunction('className') ||
      this.callLexerFunction('attrs') ||
      this.callLexerFunction('indent') ||
      this.callLexerFunction('text') ||
      this.callLexerFunction('textHtml') ||
      this.callLexerFunction('comment') ||
      this.callLexerFunction('slash') ||
      this.callLexerFunction('colon') ||
      this.fail()
    );
  },

  /**
   * Return an array of tokens for the current file
   *
   * @returns {Array.<Token>}
   * @api public
   */
  getTokens: function() {
    while (!this.ended) {
      this.callLexerFunction('advance');
    }
    return this.tokens;
  },
};
