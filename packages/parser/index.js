'use strict';

var assert = require('assert');
var TokenStream = require('token-stream');
var error = require('pugneum-error');

module.exports = parse;

function parse(tokens, options) {
  var parser = new Parser(tokens, options);
  var ast = parser.parse();
  return JSON.parse(JSON.stringify(ast));
}

// https://developer.mozilla.org/en-US/docs/Web/HTML/Element#inline_text_semantics
// https://developer.mozilla.org/en-US/docs/Learn/HTML/Cheatsheet#inline_elements
var inlineTags = [
  'a', 'abbr', 'acronym', 'address', 'audio',
  'b', 'bdi', 'bdo', 'br',
  'cite', 'code',
  'data', 'dfn',
  'em',
  'i', 'img',
  'kbd',
  'mark',
  'q',
  'rp', 'rt', 'ruby',
  's', 'samp', 'small', 'span', 'strong', 'sub', 'sup',
  'time',
  'u',
  'var', 'video',
  'wbr',
];

/**
 * Initialize `Parser` with the given input `str` and `filename`.
 *
 * @param {String} str
 * @param {String} filename
 * @param {Object} options
 * @api public
 */

function Parser(tokens, options) {
  options = options || {};
  if (!Array.isArray(tokens)) {
    throw new Error(
      'Expected tokens to be an Array but got "' + typeof tokens + '"'
    );
  }
  if (typeof options !== 'object') {
    throw new Error(
      'Expected "options" to be an object but got "' + typeof options + '"'
    );
  }
  this.tokens = new TokenStream(tokens);
  this.filename = options.filename;
  this.src = options.src;
  this.inMixin = 0;
  this.plugins = options.plugins || [];
}

/**
 * Parser prototype.
 */

Parser.prototype = {
  /**
   * Save original constructor
   */

  constructor: Parser,

  error: function(code, message, token) {
    var err = error(code, message, {
      line: token.loc.start.line,
      column: token.loc.start.column,
      filename: this.filename,
      src: this.src,
    });
    throw err;
  },

  /**
   * Return the next token object.
   *
   * @return {Object}
   * @api private
   */

  advance: function() {
    return this.tokens.advance();
  },

  /**
   * Single token lookahead.
   *
   * @return {Object}
   * @api private
   */

  peek: function() {
    return this.tokens.peek();
  },

  /**
   * `n` token lookahead.
   *
   * @param {Number} n
   * @return {Object}
   * @api private
   */

  lookahead: function(n) {
    return this.tokens.lookahead(n);
  },

  /**
   * Parse input returning a string of js for evaluation.
   *
   * @return {String}
   * @api public
   */

  parse: function() {
    var block = this.emptyBlock(0);

    while ('eos' != this.peek().type) {
      if ('newline' == this.peek().type) {
        this.advance();
      } else if ('text-html' == this.peek().type) {
        block.nodes = block.nodes.concat(this.parseTextHtml());
      } else {
        var expr = this.parseExpr();
        if (expr) {
          if (expr.type === 'Block') {
            block.nodes = block.nodes.concat(expr.nodes);
          } else {
            block.nodes.push(expr);
          }
        }
      }
    }

    return block;
  },

  /**
   * Expect the given type, or throw an exception.
   *
   * @param {String} type
   * @api private
   */

  expect: function(type) {
    if (this.peek().type === type) {
      return this.advance();
    } else {
      this.error(
        'INVALID_TOKEN',
        'expected "' + type + '", but got "' + this.peek().type + '"',
        this.peek()
      );
    }
  },

  /**
   * Accept the given `type`.
   *
   * @param {String} type
   * @api private
   */

  accept: function(type) {
    if (this.peek().type === type) {
      return this.advance();
    }
  },

  initBlock: function(line, nodes) {
    /* istanbul ignore if */
    if ((line | 0) !== line) throw new Error('`line` is not an integer');
    /* istanbul ignore if */
    if (!Array.isArray(nodes)) throw new Error('`nodes` is not an array');
    return {
      type: 'Block',
      nodes: nodes,
      line: line,
      filename: this.filename,
    };
  },

  emptyBlock: function(line) {
    return this.initBlock(line, []);
  },

  runPlugin: function(context, tok) {
    var rest = [this];
    for (var i = 2; i < arguments.length; i++) {
      rest.push(arguments[i]);
    }
    var pluginContext;
    for (var i = 0; i < this.plugins.length; i++) {
      var plugin = this.plugins[i];
      if (plugin[context] && plugin[context][tok.type]) {
        if (pluginContext)
          throw new Error(
            'Multiple plugin handlers found for context ' +
              JSON.stringify(context) +
              ', token type ' +
              JSON.stringify(tok.type)
          );
        pluginContext = plugin[context];
      }
    }
    if (pluginContext)
      return pluginContext[tok.type].apply(pluginContext, rest);
  },

  /**
   *   tag
   * | doctype
   * | mixin
   * | include
   * | filter
   * | comment
   * | text
   * | text-html
   * | dot
   * | each
   * | code
   * | yield
   * | id
   * | class
   * | interpolation
   */

  parseExpr: function() {
    switch (this.peek().type) {
      case 'tag':
        return this.parseTag();
      case 'mixin':
        return this.parseMixin();
      case 'block':
        return this.parseBlock();
      case 'mixin-block':
        return this.parseMixinBlock();
      case 'case':
        return this.parseCase();
      case 'extends':
        return this.parseExtends();
      case 'include':
        return this.parseInclude();
      case 'doctype':
        return this.parseDoctype();
      case 'filter':
        return this.parseFilter();
      case 'comment':
        return this.parseComment();
      case 'text':
      case 'interpolated-code':
      case 'start-interpolation':
        return this.parseText({block: true});
      case 'text-html':
        return this.initBlock(this.peek().loc.start.line, this.parseTextHtml());
      case 'dot':
        return this.parseDot();
      case 'each':
        return this.parseEach();
      case 'eachOf':
        return this.parseEachOf();
      case 'code':
        return this.parseCode();
      case 'blockcode':
        return this.parseBlockCode();
      case 'if':
        return this.parseConditional();
      case 'while':
        return this.parseWhile();
      case 'call':
        return this.parseCall();
      case 'interpolation':
        return this.parseInterpolation();
      case 'yield':
        return this.parseYield();
      case 'id':
      case 'class':
        if (!this.peek().loc.start) debugger;
        this.tokens.defer({
          type: 'tag',
          val: 'div',
          loc: this.peek().loc,
          filename: this.filename,
        });
        return this.parseExpr();
      default:
        var pluginResult = this.runPlugin('expressionTokens', this.peek());
        if (pluginResult) return pluginResult;
        this.error(
          'INVALID_TOKEN',
          'unexpected token "' + this.peek().type + '"',
          this.peek()
        );
    }
  },

  parseDot: function() {
    this.advance();
    return this.parseTextBlock();
  },

  /**
   * Text
   */

  parseText: function(options) {
    var tags = [];
    var lineno = this.peek().loc.start.line;
    var nextTok = this.peek();
    loop: while (true) {
      switch (nextTok.type) {
        case 'text':
          var tok = this.advance();
          tags.push({
            type: 'Text',
            val: tok.val,
            line: tok.loc.start.line,
            column: tok.loc.start.column,
            filename: this.filename,
          });
          break;
        case 'interpolated-code':
          var tok = this.advance();
          tags.push({
            type: 'Code',
            val: tok.val,
            buffer: tok.buffer,
            mustEscape: tok.mustEscape !== false,
            isInline: true,
            line: tok.loc.start.line,
            column: tok.loc.start.column,
            filename: this.filename,
          });
          break;
        case 'newline':
          if (!options || !options.block) break loop;
          var tok = this.advance();
          var nextType = this.peek().type;
          if (nextType === 'text' || nextType === 'interpolated-code') {
            tags.push({
              type: 'Text',
              val: '\n',
              line: tok.loc.start.line,
              column: tok.loc.start.column,
              filename: this.filename,
            });
          }
          break;
        case 'start-interpolation':
          this.advance();
          tags.push(this.parseExpr());
          this.expect('end-interpolation');
          break;
        default:
          var pluginResult = this.runPlugin('textTokens', nextTok, tags);
          if (pluginResult) break;
          break loop;
      }
      nextTok = this.peek();
    }
    if (tags.length === 1) return tags[0];
    else return this.initBlock(lineno, tags);
  },

  parseTextHtml: function() {
    var nodes = [];
    var currentNode = null;
    loop: while (true) {
      switch (this.peek().type) {
        case 'text-html':
          var text = this.advance();
          if (!currentNode) {
            currentNode = {
              type: 'Text',
              val: text.val,
              filename: this.filename,
              line: text.loc.start.line,
              column: text.loc.start.column,
              isHtml: true,
            };
            nodes.push(currentNode);
          } else {
            currentNode.val += '\n' + text.val;
          }
          break;
        case 'indent':
          var block = this.block();
          block.nodes.forEach(function(node) {
            if (node.isHtml) {
              if (!currentNode) {
                currentNode = node;
                nodes.push(currentNode);
              } else {
                currentNode.val += '\n' + node.val;
              }
            } else {
              currentNode = null;
              nodes.push(node);
            }
          });
          break;
        case 'code':
          currentNode = null;
          nodes.push(this.parseCode(true));
          break;
        case 'newline':
          this.advance();
          break;
        default:
          break loop;
      }
    }
    return nodes;
  },

  /**
   *   ':' expr
   * | block
   */

  parseBlockExpansion: function() {
    var tok = this.accept(':');
    if (tok) {
      var expr = this.parseExpr();
      return expr.type === 'Block'
        ? expr
        : this.initBlock(tok.loc.start.line, [expr]);
    } else {
      return this.block();
    }
  },

  /**
   * comment
   */

  parseComment: function() {
    var tok = this.expect('comment');
    var block;
    if ((block = this.parseTextBlock())) {
      return {
        type: 'BlockComment',
        val: tok.val,
        block: block,
        buffer: tok.buffer,
        line: tok.loc.start.line,
        column: tok.loc.start.column,
        filename: this.filename,
      };
    } else {
      return {
        type: 'Comment',
        val: tok.val,
        buffer: tok.buffer,
        line: tok.loc.start.line,
        column: tok.loc.start.column,
        filename: this.filename,
      };
    }
  },

  /**
   * doctype
   */

  parseDoctype: function() {
    var tok = this.expect('doctype');
    return {
      type: 'Doctype',
      val: tok.val,
      line: tok.loc.start.line,
      column: tok.loc.start.column,
      filename: this.filename,
    };
  },

  parseIncludeFilter: function() {
    var tok = this.expect('filter');
    var attrs = [];

    if (this.peek().type === 'start-attributes') {
      attrs = this.attrs();
    }

    return {
      type: 'IncludeFilter',
      name: tok.val,
      attrs: attrs,
      line: tok.loc.start.line,
      column: tok.loc.start.column,
      filename: this.filename,
    };
  },

  /**
   * filter attrs? text-block
   */

  parseFilter: function() {
    var tok = this.expect('filter');
    var block,
      attrs = [];

    if (this.peek().type === 'start-attributes') {
      attrs = this.attrs();
    }

    if (this.peek().type === 'text') {
      var textToken = this.advance();
      block = this.initBlock(textToken.loc.start.line, [
        {
          type: 'Text',
          val: textToken.val,
          line: textToken.loc.start.line,
          column: textToken.loc.start.column,
          filename: this.filename,
        },
      ]);
    } else if (this.peek().type === 'filter') {
      block = this.initBlock(tok.loc.start.line, [this.parseFilter()]);
    } else {
      block = this.parseTextBlock() || this.emptyBlock(tok.loc.start.line);
    }

    return {
      type: 'Filter',
      name: tok.val,
      block: block,
      attrs: attrs,
      line: tok.loc.start.line,
      column: tok.loc.start.column,
      filename: this.filename,
    };
  },

  /**
   * 'extends' name
   */

  parseExtends: function() {
    var tok = this.expect('extends');
    var path = this.expect('path');
    return {
      type: 'Extends',
      file: {
        type: 'FileReference',
        path: path.val.trim(),
        line: path.loc.start.line,
        column: path.loc.start.column,
        filename: this.filename,
      },
      line: tok.loc.start.line,
      column: tok.loc.start.column,
      filename: this.filename,
    };
  },

  /**
   * 'block' name block
   */

  parseBlock: function() {
    var tok = this.expect('block');

    var node =
      'indent' == this.peek().type
        ? this.block()
        : this.emptyBlock(tok.loc.start.line);
    node.type = 'NamedBlock';
    node.name = tok.val.trim();
    node.mode = tok.mode;
    node.line = tok.loc.start.line;
    node.column = tok.loc.start.column;

    return node;
  },

  parseMixinBlock: function() {
    var tok = this.expect('mixin-block');
    if (!this.inMixin) {
      this.error(
        'BLOCK_OUTISDE_MIXIN',
        'Anonymous blocks are not allowed unless they are part of a mixin.',
        tok
      );
    }
    return {
      type: 'MixinBlock',
      line: tok.loc.start.line,
      column: tok.loc.start.column,
      filename: this.filename,
    };
  },

  parseYield: function() {
    var tok = this.expect('yield');
    return {
      type: 'YieldBlock',
      line: tok.loc.start.line,
      column: tok.loc.start.column,
      filename: this.filename,
    };
  },

  /**
   * include block?
   */

  parseInclude: function() {
    var tok = this.expect('include');
    var node = {
      type: 'Include',
      file: {
        type: 'FileReference',
        filename: this.filename,
      },
      line: tok.loc.start.line,
      column: tok.loc.start.column,
      filename: this.filename,
    };
    var filters = [];
    while (this.peek().type === 'filter') {
      filters.push(this.parseIncludeFilter());
    }
    var path = this.expect('path');

    node.file.path = path.val.trim();
    node.file.line = path.loc.start.line;
    node.file.column = path.loc.start.column;

    if (/\.pg$/.test(node.file.path) && !filters.length) {
      node.block =
        'indent' == this.peek().type
          ? this.block()
          : this.emptyBlock(tok.loc.start.line);
    } else {
      node.type = 'RawInclude';
      node.filters = filters;
      if (this.peek().type === 'indent') {
        this.error(
          'RAW_INCLUDE_BLOCK',
          'Raw inclusion cannot contain a block',
          this.peek()
        );
      }
    }
    return node;
  },

  /**
   * call ident block
   */

  parseCall: function() {
    var tok = this.expect('call');
    var name = tok.val;
    var args = tok.args;
    var mixin = {
      type: 'Mixin',
      name: name,
      args: args,
      block: this.emptyBlock(tok.loc.start.line),
      call: true,
      attrs: [],
      attributeBlocks: [],
      line: tok.loc.start.line,
      column: tok.loc.start.column,
      filename: this.filename,
    };

    this.tag(mixin);
    if (mixin.code) {
      mixin.block.nodes.push(mixin.code);
      delete mixin.code;
    }
    if (mixin.block.nodes.length === 0) mixin.block = null;
    return mixin;
  },

  /**
   * mixin block
   */

  parseMixin: function() {
    var tok = this.expect('mixin');
    var name = tok.val;
    var args = tok.args;

    if ('indent' == this.peek().type) {
      this.inMixin++;
      var mixin = {
        type: 'Mixin',
        name: name,
        args: args,
        block: this.block(),
        call: false,
        line: tok.loc.start.line,
        column: tok.loc.start.column,
        filename: this.filename,
      };
      this.inMixin--;
      return mixin;
    } else {
      this.error(
        'MIXIN_WITHOUT_BODY',
        'Mixin ' + name + ' declared without body',
        tok
      );
    }
  },

  /**
   * indent (text | newline)* outdent
   */

  parseTextBlock: function() {
    var tok = this.accept('start-pipeless-text');
    if (!tok) return;
    var block = this.emptyBlock(tok.loc.start.line);
    while (this.peek().type !== 'end-pipeless-text') {
      var tok = this.advance();
      switch (tok.type) {
        case 'text':
          block.nodes.push({
            type: 'Text',
            val: tok.val,
            line: tok.loc.start.line,
            column: tok.loc.start.column,
            filename: this.filename,
          });
          break;
        case 'newline':
          block.nodes.push({
            type: 'Text',
            val: '\n',
            line: tok.loc.start.line,
            column: tok.loc.start.column,
            filename: this.filename,
          });
          break;
        case 'start-interpolation':
          block.nodes.push(this.parseExpr());
          this.expect('end-interpolation');
          break;
        case 'interpolated-code':
          block.nodes.push({
            type: 'Code',
            val: tok.val,
            buffer: tok.buffer,
            mustEscape: tok.mustEscape !== false,
            isInline: true,
            line: tok.loc.start.line,
            column: tok.loc.start.column,
            filename: this.filename,
          });
          break;
        default:
          var pluginResult = this.runPlugin('textBlockTokens', tok, block, tok);
          if (pluginResult) break;
          this.error(
            'INVALID_TOKEN',
            'Unexpected token type: ' + tok.type,
            tok
          );
      }
    }
    this.advance();
    return block;
  },

  /**
   * indent expr* outdent
   */

  block: function() {
    var tok = this.expect('indent');
    var block = this.emptyBlock(tok.loc.start.line);
    while ('outdent' != this.peek().type) {
      if ('newline' == this.peek().type) {
        this.advance();
      } else if ('text-html' == this.peek().type) {
        block.nodes = block.nodes.concat(this.parseTextHtml());
      } else {
        var expr = this.parseExpr();
        if (expr.type === 'Block') {
          block.nodes = block.nodes.concat(expr.nodes);
        } else {
          block.nodes.push(expr);
        }
      }
    }
    this.expect('outdent');
    return block;
  },

  /**
   * interpolation (attrs | class | id)* (text | code | ':')? newline* block?
   */

  parseInterpolation: function() {
    var tok = this.advance();
    var tag = {
      type: 'InterpolatedTag',
      expr: tok.val,
      selfClosing: false,
      block: this.emptyBlock(tok.loc.start.line),
      attrs: [],
      attributeBlocks: [],
      isInline: false,
      line: tok.loc.start.line,
      column: tok.loc.start.column,
      filename: this.filename,
    };

    return this.tag(tag, {selfClosingAllowed: true});
  },

  /**
   * tag (attrs | class | id)* (text | code | ':')? newline* block?
   */

  parseTag: function() {
    var tok = this.advance();
    var tag = {
      type: 'Tag',
      name: tok.val,
      selfClosing: false,
      block: this.emptyBlock(tok.loc.start.line),
      attrs: [],
      attributeBlocks: [],
      isInline: inlineTags.indexOf(tok.val) !== -1,
      line: tok.loc.start.line,
      column: tok.loc.start.column,
      filename: this.filename,
    };

    return this.tag(tag, {selfClosingAllowed: true});
  },

  /**
   * Parse tag.
   */

  tag: function(tag, options) {
    var seenAttrs = false;
    var attributeNames = [];
    var selfClosingAllowed = options && options.selfClosingAllowed;
    // (attrs | class | id)*
    out: while (true) {
      switch (this.peek().type) {
        case 'id':
        case 'class':
          var tok = this.advance();
          if (tok.type === 'id') {
            if (attributeNames.indexOf('id') !== -1) {
              this.error(
                'DUPLICATE_ID',
                'Duplicate attribute "id" is not allowed.',
                tok
              );
            }
            attributeNames.push('id');
          }
          tag.attrs.push({
            name: tok.type,
            val: tok.val,
            line: tok.loc.start.line,
            column: tok.loc.start.column,
            filename: this.filename,
            mustEscape: false,
          });
          continue;
        case 'start-attributes':
          if (seenAttrs) {
            console.warn(
              this.filename +
                ', line ' +
                this.peek().loc.start.line +
                ':\nYou should not have pugneum tags with multiple attributes.'
            );
          }
          seenAttrs = true;
          tag.attrs = tag.attrs.concat(this.attrs(attributeNames));
          continue;
        default:
          var pluginResult = this.runPlugin(
            'tagAttributeTokens',
            this.peek(),
            tag,
            attributeNames
          );
          if (pluginResult) break;
          break out;
      }
    }

    // check immediate '.'
    if ('dot' == this.peek().type) {
      tag.textOnly = true;
      this.advance();
    }

    // (text | code | ':')?
    switch (this.peek().type) {
      case 'text':
      case 'interpolated-code':
        var text = this.parseText();
        if (text.type === 'Block') {
          tag.block.nodes.push.apply(tag.block.nodes, text.nodes);
        } else {
          tag.block.nodes.push(text);
        }
        break;
      case ':':
        this.advance();
        var expr = this.parseExpr();
        tag.block =
          expr.type === 'Block' ? expr : this.initBlock(tag.line, [expr]);
        break;
      case 'newline':
      case 'indent':
      case 'outdent':
      case 'eos':
      case 'start-pipeless-text':
      case 'end-interpolation':
        break;
      case 'slash':
        if (selfClosingAllowed) {
          this.advance();
          tag.selfClosing = true;
          break;
        }
      default:
        var pluginResult = this.runPlugin(
          'tagTokens',
          this.peek(),
          tag,
          options
        );
        if (pluginResult) break;
        this.error(
          'INVALID_TOKEN',
          'Unexpected token `' +
            this.peek().type +
            '` expected `text`, `interpolated-code`, `code`, `:`' +
            (selfClosingAllowed ? ', `slash`' : '') +
            ', `newline` or `eos`',
          this.peek()
        );
    }

    // newline*
    while ('newline' == this.peek().type) this.advance();

    // block?
    if (tag.textOnly) {
      tag.block = this.parseTextBlock() || this.emptyBlock(tag.line);
    } else if ('indent' == this.peek().type) {
      var block = this.block();
      for (var i = 0, len = block.nodes.length; i < len; ++i) {
        tag.block.nodes.push(block.nodes[i]);
      }
    }

    return tag;
  },

  attrs: function(attributeNames) {
    this.expect('start-attributes');

    var attrs = [];
    var tok = this.advance();
    while (tok.type === 'attribute') {
      if (tok.name !== 'class' && attributeNames) {
        if (attributeNames.indexOf(tok.name) !== -1) {
          this.error(
            'DUPLICATE_ATTRIBUTE',
            'Duplicate attribute "' + tok.name + '" is not allowed.',
            tok
          );
        }
        attributeNames.push(tok.name);
      }
      attrs.push({
        name: tok.name,
        val: tok.val,
        line: tok.loc.start.line,
        column: tok.loc.start.column,
        filename: this.filename,
        mustEscape: tok.mustEscape !== false,
      });
      tok = this.advance();
    }
    this.tokens.defer(tok);
    this.expect('end-attributes');
    return attrs;
  },
};
