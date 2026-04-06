'use strict';

const error = require('pugneum-error');

class TokenStream {
  constructor(tokens) {
    this.tokens = tokens;
    this.index = 0;
    this.deferred = null;
  }
  peek() {
    if (this.deferred) {
      return this.deferred;
    }
    return this.tokens[this.index];
  }
  advance() {
    if (this.deferred) {
      let tok = this.deferred;
      this.deferred = null;
      return tok;
    }
    return this.tokens[this.index++];
  }
  defer(token) {
    if (this.deferred) {
      throw new Error('Cannot defer more than one token');
    }
    this.deferred = token;
  }
}

module.exports = parse;

function parse(tokens, options) {
  const parser = new Parser(tokens, options);
  const ast = parser.parse();
  return structuredClone(ast);
}

// https://developer.mozilla.org/en-US/docs/Web/HTML/Element#inline_text_semantics
// https://developer.mozilla.org/en-US/docs/Learn/HTML/Cheatsheet#inline_elements
const inlineTags = [
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

class Parser {
  constructor(tokens, options) {
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
    this.source = options.source;
    this.inMixin = 0;
  }

  error(code, message, token) {
    let err = error(code, message, {
      line: token.loc.start.line,
      column: token.loc.start.column,
      filename: this.filename,
      source: this.source,
    });
    throw err;
  }

  advance() {
    return this.tokens.advance();
  }

  peek() {
    return this.tokens.peek();
  }

  parse() {
    let block = this.emptyBlock(0);

    while ('eos' != this.peek().type) {
      if ('newline' == this.peek().type) {
        this.advance();
      } else if ('text-html' == this.peek().type) {
        block.nodes = block.nodes.concat(this.parseTextHtml());
      } else {
        let expr = this.parseExpr();
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
  }

  expect(type) {
    if (this.peek().type === type) {
      return this.advance();
    } else {
      this.error(
        'INVALID_TOKEN',
        'expected "' + type + '", but got "' + this.peek().type + '"',
        this.peek()
      );
    }
  }

  accept(type) {
    if (this.peek().type === type) {
      return this.advance();
    }
  }

  initBlock(line, nodes) {
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
  }

  emptyBlock(line) {
    return this.initBlock(line, []);
  }

  /**
   *   tag
   * | mixin
   * | variable
   * | include
   * | filter
   * | comment
   * | text
   * | text-html
   * | dot
   * | yield
   * | id
   * | class
   * | interpolation
   */

  parseExpr() {
    switch (this.peek().type) {
      case 'tag':
        return this.parseTag();
      case 'mixin':
        return this.parseMixin();
      case 'block':
        return this.parseBlock();
      case 'mixin-block':
        return this.parseMixinBlock();
      case 'variable':
        return this.parseVariable();
      case 'extends':
        return this.parseExtends();
      case 'include':
        return this.parseInclude();
      case 'filter':
        return this.parseFilter();
      case 'comment':
        return this.parseComment();
      case 'text':
      case 'start-interpolation':
        return this.parseText({block: true});
      case 'text-html':
        return this.initBlock(this.peek().loc.start.line, this.parseTextHtml());
      case 'dot':
        return this.parseDot();
      case 'call':
        return this.parseCall();
      case 'interpolation':
        return this.parseInterpolation();
      case 'yield':
        return this.parseYield();
      case 'id':
      case 'class':
        this.tokens.defer({
          type: 'tag',
          val: 'div',
          loc: this.peek().loc,
          filename: this.filename,
        });
        return this.parseExpr();
      default:
        this.error(
          'INVALID_TOKEN',
          'unexpected token "' + this.peek().type + '"',
          this.peek()
        );
    }
  }

  parseDot() {
    this.advance();
    return this.parseTextBlock();
  }

  /**
   * Text
   */

  parseText(options) {
    let tags = [];
    let lineno = this.peek().loc.start.line;
    let nextTok = this.peek();
    loop: while (true) {
      switch (nextTok.type) {
        case 'text': {
          const tok = this.advance();
          tags.push({
            type: 'Text',
            val: tok.val,
            line: tok.loc.start.line,
            column: tok.loc.start.column,
            filename: this.filename,
          });
          break;
        }
        case 'newline': {
          if (!options || !options.block) break loop;
          const tok = this.advance();
          const nextType = this.peek().type;
          if (nextType === 'text') {
            tags.push({
              type: 'Text',
              val: '\n',
              line: tok.loc.start.line,
              column: tok.loc.start.column,
              filename: this.filename,
            });
          }
          break;
        }
        case 'start-interpolation':
          this.advance();
          tags.push(this.parseExpr());
          this.expect('end-interpolation');
          break;
        default:
          break loop;
      }
      nextTok = this.peek();
    }
    if (tags.length === 1) return tags[0];
    else return this.initBlock(lineno, tags);
  }

  parseTextHtml() {
    let nodes = [];
    let currentNode = null;
    loop: while (true) {
      switch (this.peek().type) {
        case 'text-html':
          let text = this.advance();
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
          let block = this.block();
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
        case 'newline':
          this.advance();
          break;
        default:
          break loop;
      }
    }
    return nodes;
  }

  /**
   *   ':' expr
   * | block
   */

  parseBlockExpansion() {
    let tok = this.accept(':');
    if (tok) {
      let expr = this.parseExpr();
      return expr.type === 'Block'
        ? expr
        : this.initBlock(tok.loc.start.line, [expr]);
    } else {
      return this.block();
    }
  }

  /**
   * comment
   */

  parseComment() {
    let tok = this.expect('comment');
    let block;
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
  }

  parseIncludeFilter() {
    let tok = this.expect('filter');
    let attrs = [];

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
  }

  /**
   * filter attrs? text-block
   */

  parseFilter() {
    let tok = this.expect('filter');
    let block,
      attrs = [];

    if (this.peek().type === 'start-attributes') {
      attrs = this.attrs();
    }

    if (this.peek().type === 'text') {
      let textToken = this.advance();
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
  }

  /**
   * 'extends' name
   */

  parseExtends() {
    let tok = this.expect('extends');
    let path = this.expect('path');
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
  }

  /**
   * 'block' name block
   */

  parseBlock() {
    let tok = this.expect('block');

    let node =
      'indent' == this.peek().type
        ? this.block()
        : this.emptyBlock(tok.loc.start.line);
    node.type = 'NamedBlock';
    node.name = tok.val.trim();
    node.mode = tok.mode;
    node.line = tok.loc.start.line;
    node.column = tok.loc.start.column;

    return node;
  }

  parseMixinBlock() {
    let tok = this.expect('mixin-block');
    if (!this.inMixin) {
      this.error(
        'BLOCK_OUTSIDE_MIXIN',
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
  }

  parseVariable() {
    let tok = this.expect('variable');
    if (!this.inMixin) {
      this.error(
        'VARIABLE_OUTSIDE_MIXIN',
        'Variables cannot be used outside mixins',
        tok
      );
    }
    return {
      type: 'Variable',
      name: tok.val,
      line: tok.loc.start.line,
      column: tok.loc.start.column,
      filename: this.filename,
    };
  }

  parseYield() {
    let tok = this.expect('yield');
    return {
      type: 'YieldBlock',
      line: tok.loc.start.line,
      column: tok.loc.start.column,
      filename: this.filename,
    };
  }

  /**
   * include block?
   */

  parseInclude() {
    let tok = this.expect('include');
    let node = {
      type: 'Include',
      file: {
        type: 'FileReference',
        filename: this.filename,
      },
      line: tok.loc.start.line,
      column: tok.loc.start.column,
      filename: this.filename,
    };
    let filters = [];
    while (this.peek().type === 'filter') {
      filters.push(this.parseIncludeFilter());
    }
    let path = this.expect('path');

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
  }

  /**
   * call ident block
   */

  parseCall() {
    let tok = this.expect('call');
    let name = tok.val;
    let args = tok.args;
    let mixin = {
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
  }

  /**
   * mixin block
   */

  parseMixin() {
    let tok = this.expect('mixin');
    let name = tok.val;
    let args = tok.args;

    if ('indent' == this.peek().type) {
      this.inMixin++;
      let mixin = {
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
  }

  /**
   * indent (text | newline)* outdent
   */

  parseTextBlock() {
    let tok = this.accept('start-pipeless-text');
    if (!tok) return;
    let block = this.emptyBlock(tok.loc.start.line);
    while (this.peek().type !== 'end-pipeless-text') {
      let tok = this.advance();
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
        default:
          this.error(
            'INVALID_TOKEN',
            'Unexpected token type: ' + tok.type,
            tok
          );
      }
    }
    this.advance();
    return block;
  }

  /**
   * indent expr* outdent
   */

  block() {
    let tok = this.expect('indent');
    let block = this.emptyBlock(tok.loc.start.line);
    while ('outdent' != this.peek().type) {
      if ('newline' == this.peek().type) {
        this.advance();
      } else if ('text-html' == this.peek().type) {
        block.nodes = block.nodes.concat(this.parseTextHtml());
      } else {
        let expr = this.parseExpr();
        if (expr.type === 'Block') {
          block.nodes = block.nodes.concat(expr.nodes);
        } else {
          block.nodes.push(expr);
        }
      }
    }
    this.expect('outdent');
    return block;
  }

  /**
   * interpolation (attrs | class | id)* (text | ':')? newline* block?
   */

  parseInterpolation() {
    let tok = this.advance();
    let tag = {
      type: 'InterpolatedTag',
      expr: tok.val,
      block: this.emptyBlock(tok.loc.start.line),
      attrs: [],
      attributeBlocks: [],
      isInline: false,
      line: tok.loc.start.line,
      column: tok.loc.start.column,
      filename: this.filename,
    };

    return this.tag(tag);
  }

  /**
   * tag (attrs | class | id)* (text | ':')? newline* block?
   */

  parseTag() {
    let tok = this.advance();
    let tag = {
      type: 'Tag',
      name: tok.val,
      block: this.emptyBlock(tok.loc.start.line),
      attrs: [],
      attributeBlocks: [],
      isInline: inlineTags.indexOf(tok.val) !== -1,
      line: tok.loc.start.line,
      column: tok.loc.start.column,
      filename: this.filename,
    };

    return this.tag(tag);
  }

  /**
   * Parse tag.
   */

  tag(tag, options) {
    let seenAttrs = false;
    let attributeNames = [];
    // (attrs | class | id)*
    out: while (true) {
      switch (this.peek().type) {
        case 'id':
        case 'class':
          let tok = this.advance();
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
          break out;
      }
    }

    // check immediate '.'
    if ('dot' == this.peek().type) {
      tag.textOnly = true;
      this.advance();
    }

    // (text | ':')?
    switch (this.peek().type) {
      case 'text':
        let text = this.parseText();
        if (text.type === 'Block') {
          tag.block.nodes.push.apply(tag.block.nodes, text.nodes);
        } else {
          tag.block.nodes.push(text);
        }
        break;
      case ':':
        this.advance();
        let expr = this.parseExpr();
        tag.block =
          expr.type === 'Block' ? expr : this.initBlock(tag.line, [expr]);
        break;
      case 'variable':
        let variable = this.parseVariable();
        tag.block.nodes.push(variable);
        break;
      case 'newline':
      case 'indent':
      case 'outdent':
      case 'eos':
      case 'start-pipeless-text':
      case 'end-interpolation':
        break;
      default:
        this.error(
          'INVALID_TOKEN',
          'Unexpected token `' +
            this.peek().type +
            '` expected `text`, `:`, `newline` or `eos`',
          this.peek()
        );
    }

    // newline*
    while ('newline' == this.peek().type) this.advance();

    // block?
    if (tag.textOnly) {
      tag.block = this.parseTextBlock() || this.emptyBlock(tag.line);
    } else if ('indent' == this.peek().type) {
      let block = this.block();
      for (let i = 0, len = block.nodes.length; i < len; ++i) {
        tag.block.nodes.push(block.nodes[i]);
      }
    }

    return tag;
  }

  attrs(attributeNames) {
    this.expect('start-attributes');

    let attrs = [];
    let tok = this.advance();
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
  }
}
