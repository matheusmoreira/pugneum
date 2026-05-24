const error = require('pugneum-error');

const MAX_PARSE_DEPTH = 256;

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
      const tok = this.deferred;
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
  return parser.parse();
}

function containsNodeType(node, type) {
  if (!node) return false;
  if (node.type === type) return true;
  if (node.type === 'Mixin' && node.call) return false;
  if (node.nodes) {
    for (let i = 0; i < node.nodes.length; ++i) {
      if (containsNodeType(node.nodes[i], type)) return true;
    }
  }
  if (node.block) {
    return containsNodeType(node.block, type);
  }
  return false;
}

// https://developer.mozilla.org/en-US/docs/Web/HTML/Element#inline_text_semantics
// https://developer.mozilla.org/en-US/docs/Learn/HTML/Cheatsheet#inline_elements
const inlineTags = [
  'a',
  'abbr',
  'acronym',
  'address',
  'audio',
  'b',
  'bdi',
  'bdo',
  'br',
  'cite',
  'code',
  'data',
  'dfn',
  'em',
  'i',
  'img',
  'kbd',
  'mark',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'time',
  'u',
  'var',
  'video',
  'wbr',
];

class Parser {
  constructor(tokens, options) {
    options = options || {};
    if (!Array.isArray(tokens)) {
      throw new Error(
        'Expected tokens to be an Array but got "' + typeof tokens + '"',
      );
    }
    if (typeof options !== 'object') {
      throw new Error(
        'Expected "options" to be an object but got "' + typeof options + '"',
      );
    }
    this.tokens = new TokenStream(tokens);
    this.filename = options.filename;
    this.source = options.source;
    this.inMixin = 0;
    this.depth = 0;
  }

  node(type, tok, props) {
    const n = {
      type: type,
      line: tok.loc.start.line,
      column: tok.loc.start.column,
      filename: this.filename,
    };
    if (props) Object.assign(n, props);
    return n;
  }

  textNode(tok, val) {
    return this.node('Text', tok, {val: val !== undefined ? val : tok.val});
  }

  error(code, message, token) {
    const err = error(code, message, {
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
    const block = this.emptyBlock(0);

    while ('eos' !== this.peek().type) {
      if ('newline' === this.peek().type) {
        this.advance();
      } else {
        const expr = this.parseExpr();
        if (expr) {
          if (expr.type === 'Block') {
            for (let ni = 0; ni < expr.nodes.length; ni++) {
              block.nodes.push(expr.nodes[ni]);
            }
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
        this.peek(),
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
   * | dot
   * | yield
   * | id
   * | class
   * | interpolation
   */

  parseExpr() {
    if (++this.depth > MAX_PARSE_DEPTH) {
      this.error(
        'NESTING_TOO_DEEP',
        `Template nesting exceeds maximum depth of ${MAX_PARSE_DEPTH}`,
        this.peek(),
      );
    }
    try {
      return this._parseExpr();
    } finally {
      this.depth--;
    }
  }

  _parseExpr() {
    switch (this.peek().type) {
      case 'tag':
        return this.parseTag();
      case 'mixin':
        return this.parseMixin();
      case 'block':
        return this.parseBlock();
      case 'mixin-block':
        return this.parseMixinBlock();
      case 'given':
        return this.parseGiven();
      case 'variable':
        return this.parseVariable();
      case 'extends':
        return this.parseExtends();
      case 'include':
        return this.parseInclude();
      case 'references':
        return this.parseReferences();
      case 'footnotes':
        return this.parseFootnotes();
      case 'toc':
        return this.parseToc();
      case 'filter':
        return this.parseFilter();
      case 'comment':
        return this.parseComment();
      case 'text':
      case 'start-interpolation':
      case 'start-ref-link':
      case 'start-ref-image':
      case 'start-footnote-ref':
        return this.parseText({block: true});
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
          this.peek(),
        );
    }
  }

  parseDot() {
    const tok = this.advance();
    return this.parseTextBlock() || this.emptyBlock(tok.loc.start.line);
  }

  /**
   * Text
   */

  collectInlineContent(nodes, options) {
    let nextTok = this.peek();
    loop: while (true) {
      switch (nextTok.type) {
        case 'text':
          nodes.push(this.textNode(this.advance()));
          break;
        case 'newline': {
          if (!options || !options.block) break loop;
          const tok = this.advance();
          if (this.peek().type === 'text') {
            nodes.push(this.textNode(tok, '\n'));
          }
          break;
        }
        case 'start-interpolation':
          this.advance();
          nodes.push(this.parseExpr());
          this.expect('end-interpolation');
          break;
        case 'start-ref-link':
          nodes.push(this.parseRefLink());
          break;
        case 'start-ref-image':
          nodes.push(this.parseRefImage());
          break;
        case 'start-footnote-ref':
          nodes.push(this.parseFootnoteRef());
          break;
        default:
          break loop;
      }
      nextTok = this.peek();
    }
  }

  parseText(options) {
    const lineno = this.peek().loc.start.line;
    const tags = [];
    this.collectInlineContent(tags, options);
    if (tags.length === 1) return tags[0];
    else return this.initBlock(lineno, tags);
  }

  /**
   * comment
   */

  parseComment() {
    const tok = this.expect('comment');
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
    const tok = this.expect('filter');
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
    const tok = this.expect('filter');
    let block,
      attrs = [];

    if (this.peek().type === 'start-attributes') {
      attrs = this.attrs();
    }

    if (this.peek().type === 'text') {
      const textToken = this.advance();
      block = this.initBlock(textToken.loc.start.line, [
        this.textNode(textToken),
      ]);
    } else if (this.peek().type === 'filter') {
      block = this.initBlock(tok.loc.start.line, [this.parseExpr()]);
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
    const tok = this.expect('extends');
    const path = this.expect('path');
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
    const tok = this.expect('block');

    const node =
      'indent' === this.peek().type
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
    const tok = this.expect('mixin-block');
    if (!this.inMixin) {
      this.error(
        'BLOCK_OUTSIDE_MIXIN',
        'Anonymous blocks are not allowed unless they are part of a mixin.',
        tok,
      );
    }
    return {
      type: 'MixinBlock',
      line: tok.loc.start.line,
      column: tok.loc.start.column,
      filename: this.filename,
    };
  }

  parseGiven() {
    const tok = this.expect('given');
    if (!this.inMixin) {
      this.error(
        'GIVEN_OUTSIDE_MIXIN',
        'The given keyword can only be used inside a mixin definition.',
        tok,
      );
    }
    const node = {
      type: 'Given',
      name: tok.val,
      block:
        'indent' === this.peek().type
          ? this.block()
          : this.emptyBlock(tok.loc.start.line),
      line: tok.loc.start.line,
      column: tok.loc.start.column,
      filename: this.filename,
    };
    return node;
  }

  parseVariable() {
    const tok = this.expect('variable');
    if (!this.inMixin) {
      this.error(
        'VARIABLE_OUTSIDE_MIXIN',
        'Variables cannot be used outside mixins',
        tok,
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
    const tok = this.expect('yield');
    return {
      type: 'YieldBlock',
      line: tok.loc.start.line,
      column: tok.loc.start.column,
      filename: this.filename,
    };
  }

  parseReferences() {
    const tok = this.expect('references');
    const definitions = [];
    while (this.peek().type === 'ref-def') {
      const def = this.advance();
      definitions.push({
        name: def.name,
        url: def.url,
        defaultText: def.defaultText || null,
        line: def.loc.start.line,
        column: def.loc.start.column,
        filename: this.filename,
      });
    }
    return {
      type: 'References',
      definitions: definitions,
      line: tok.loc.start.line,
      column: tok.loc.start.column,
      filename: this.filename,
    };
  }

  parseRefLink() {
    const tok = this.expect('start-ref-link');
    return this.parseRefLinkContent(tok);
  }

  parseRefLinkContent(tok) {
    const name = tok.val;
    const block = this.emptyBlock(tok.loc.start.line);

    while (this.peek().type !== 'end-ref-link') {
      const next = this.peek();
      switch (next.type) {
        case 'text':
          block.nodes.push(this.textNode(this.advance()));
          break;
        case 'start-interpolation':
          this.advance();
          block.nodes.push(this.parseExpr());
          this.expect('end-interpolation');
          break;
        default:
          this.error(
            'INVALID_TOKEN',
            'Unexpected token in reference link: ' + next.type,
            next,
          );
      }
    }
    this.expect('end-ref-link');

    // Collect optional (attrs) after ]
    let attrs = [];
    if (this.peek().type === 'start-attributes') {
      attrs = this.attrs();
    }

    return {
      type: 'ReferenceLink',
      name: name,
      block: block,
      attrs: attrs,
      line: tok.loc.start.line,
      column: tok.loc.start.column,
      filename: this.filename,
    };
  }

  parseRefImage() {
    const tok = this.expect('start-ref-image');
    return this.parseRefImageContent(tok);
  }

  parseRefImageContent(tok) {
    const name = tok.val;
    const block = this.emptyBlock(tok.loc.start.line);

    while (this.peek().type !== 'end-ref-image') {
      const next = this.peek();
      switch (next.type) {
        case 'text':
          block.nodes.push(this.textNode(this.advance()));
          break;
        case 'start-interpolation':
          this.advance();
          block.nodes.push(this.parseExpr());
          this.expect('end-interpolation');
          break;
        default:
          this.error(
            'INVALID_TOKEN',
            'Unexpected token in reference image: ' + next.type,
            next,
          );
      }
    }
    this.expect('end-ref-image');

    let attrs = [];
    if (this.peek().type === 'start-attributes') {
      attrs = this.attrs();
    }

    return {
      type: 'ReferenceImage',
      name: name,
      block: block,
      attrs: attrs,
      line: tok.loc.start.line,
      column: tok.loc.start.column,
      filename: this.filename,
    };
  }

  parseFootnoteRef() {
    const tok = this.expect('start-footnote-ref');
    return this.parseFootnoteRefContent(tok);
  }

  parseFootnoteRefContent(tok) {
    const name = tok.val;
    this.expect('end-footnote-ref');
    return {
      type: 'FootnoteRef',
      name: name,
      line: tok.loc.start.line,
      column: tok.loc.start.column,
      filename: this.filename,
    };
  }

  parseToc() {
    const tok = this.expect('toc');
    return {
      type: 'Toc',
      line: tok.loc.start.line,
      column: tok.loc.start.column,
      filename: this.filename,
    };
  }

  parseFootnotes() {
    const tok = this.expect('footnotes');
    const definitions = [];

    while (this.peek().type === 'footnote-def-start') {
      const defTok = this.advance();
      const name = defTok.val;
      const block = this.emptyBlock(defTok.loc.start.line);

      while (
        this.peek().type !== 'footnote-def-end' &&
        this.peek().type !== 'eos'
      ) {
        const next = this.peek();
        switch (next.type) {
          case 'text':
            block.nodes.push(this.textNode(this.advance()));
            break;
          case 'newline':
            this.advance();
            block.nodes.push({
              type: 'Text',
              val: ' ',
              line: next.loc.start.line,
              column: next.loc.start.column,
              filename: this.filename,
            });
            break;
          case 'start-interpolation':
            this.advance();
            block.nodes.push(this.parseExpr());
            this.expect('end-interpolation');
            break;
          case 'start-ref-link':
            block.nodes.push(this.parseRefLink());
            break;
          case 'start-ref-image':
            block.nodes.push(this.parseRefImage());
            break;
          case 'start-footnote-ref':
            block.nodes.push(this.parseFootnoteRef());
            break;
          default:
            this.error(
              'INVALID_TOKEN',
              'Unexpected token in footnote definition: ' + next.type,
              next,
            );
        }
      }
      this.expect('footnote-def-end');

      definitions.push({
        name: name,
        block: block,
        line: defTok.loc.start.line,
        column: defTok.loc.start.column,
        filename: this.filename,
      });
    }

    return {
      type: 'Footnotes',
      definitions: definitions,
      line: tok.loc.start.line,
      column: tok.loc.start.column,
      filename: this.filename,
    };
  }

  /**
   * include block?
   */

  parseInclude() {
    const tok = this.expect('include');
    const node = {
      type: 'Include',
      file: {
        type: 'FileReference',
        filename: this.filename,
      },
      line: tok.loc.start.line,
      column: tok.loc.start.column,
      filename: this.filename,
    };
    const filters = [];
    while (this.peek().type === 'filter') {
      filters.push(this.parseIncludeFilter());
    }
    const path = this.expect('path');

    node.file.path = path.val.trim();
    node.file.line = path.loc.start.line;
    node.file.column = path.loc.start.column;

    if (/\.pg$/.test(node.file.path) && !filters.length) {
      node.block =
        'indent' === this.peek().type
          ? this.block()
          : this.emptyBlock(tok.loc.start.line);
    } else {
      node.type = 'RawInclude';
      node.filters = filters;
      if (this.peek().type === 'indent') {
        this.error(
          'RAW_INCLUDE_BLOCK',
          'Raw inclusion cannot contain a block',
          this.peek(),
        );
      }
    }
    return node;
  }

  /**
   * call ident block
   */

  parseCall() {
    const tok = this.expect('call');
    const name = tok.val;
    const args = tok.args;
    const mixin = {
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
    if (mixin.block.nodes.length === 0) mixin.block = null;
    return mixin;
  }

  /**
   * mixin block
   */

  parseMixin() {
    const tok = this.expect('mixin');
    const name = tok.val;
    const args = tok.args;

    if ('indent' === this.peek().type) {
      this.inMixin++;
      let block;
      try {
        block = this.block();
      } finally {
        this.inMixin--;
      }

      const hasMixinBlock = containsNodeType(block, 'MixinBlock');
      const hasNamedBlock = containsNodeType(block, 'NamedBlock');
      const hasGiven = containsNodeType(block, 'Given');

      return {
        type: 'Mixin',
        name: name,
        args: args,
        block: block,
        call: false,
        usesNamedBlocks: hasNamedBlock || hasGiven,
        usesUnnamedBlock: hasMixinBlock,
        line: tok.loc.start.line,
        column: tok.loc.start.column,
        filename: this.filename,
      };
    } else {
      this.error(
        'MIXIN_WITHOUT_BODY',
        'Mixin ' + name + ' declared without body',
        tok,
      );
    }
  }

  /**
   * indent (text | newline)* outdent
   */

  parseTextBlock() {
    const tok = this.accept('start-pipeless-text');
    if (!tok) return;
    const block = this.emptyBlock(tok.loc.start.line);
    while (this.peek().type !== 'end-pipeless-text') {
      const currentTok = this.advance();
      switch (currentTok.type) {
        case 'text':
          block.nodes.push(this.textNode(currentTok));
          break;
        case 'newline':
          block.nodes.push(this.textNode(currentTok, '\n'));
          break;
        case 'start-interpolation':
          block.nodes.push(this.parseExpr());
          this.expect('end-interpolation');
          break;
        case 'start-ref-link':
          block.nodes.push(this.parseRefLinkContent(currentTok));
          break;
        case 'start-ref-image':
          block.nodes.push(this.parseRefImageContent(currentTok));
          break;
        case 'start-footnote-ref':
          block.nodes.push(this.parseFootnoteRefContent(currentTok));
          break;
        default:
          this.error(
            'INVALID_TOKEN',
            'Unexpected token type: ' + currentTok.type,
            currentTok,
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
    const tok = this.expect('indent');
    const block = this.emptyBlock(tok.loc.start.line);
    while ('outdent' !== this.peek().type) {
      if ('newline' === this.peek().type) {
        this.advance();
      } else {
        const expr = this.parseExpr();
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
    const tok = this.advance();
    const tag = {
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
    const tok = this.advance();
    const tag = {
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

  tag(tag) {
    let seenAttrs = false;
    const attributeNames = new Set();
    // (attrs | class | id)*
    out: while (true) {
      switch (this.peek().type) {
        case 'id':
        case 'class':
          const tok = this.advance();
          if (tok.type === 'id') {
            if (attributeNames.has('id')) {
              this.error(
                'DUPLICATE_ID',
                'Duplicate attribute "id" is not allowed.',
                tok,
              );
            }
            attributeNames.add('id');
          }
          tag.attrs.push({
            name: tok.type,
            val: tok.val,
            line: tok.loc.start.line,
            column: tok.loc.start.column,
            filename: this.filename,
          });
          continue;
        case 'start-attributes':
          if (seenAttrs) {
            this.error(
              'MULTIPLE_ATTRIBUTES',
              'Tags should not have multiple attribute blocks',
              this.peek(),
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
    if ('dot' === this.peek().type) {
      tag.textOnly = true;
      this.advance();
    }

    // (text | ':')?
    switch (this.peek().type) {
      case 'text':
      case 'start-interpolation':
      case 'start-ref-link':
      case 'start-ref-image':
      case 'start-footnote-ref':
        const text = this.parseText();
        if (text.type === 'Block') {
          tag.block.nodes.push.apply(tag.block.nodes, text.nodes);
        } else {
          tag.block.nodes.push(text);
        }
        break;
      case ':':
        this.advance();
        const expr = this.parseExpr();
        tag.block =
          expr.type === 'Block' ? expr : this.initBlock(tag.line, [expr]);
        break;
      case 'variable':
        const variable = this.parseVariable();
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
          this.peek(),
        );
    }

    // newline*
    while ('newline' === this.peek().type) this.advance();

    // block?
    if (tag.textOnly) {
      tag.block = this.parseTextBlock() || this.emptyBlock(tag.line);
    } else if ('indent' === this.peek().type) {
      const block = this.block();
      for (let i = 0, len = block.nodes.length; i < len; ++i) {
        tag.block.nodes.push(block.nodes[i]);
      }
    }

    return tag;
  }

  attrs(attributeNames) {
    this.expect('start-attributes');

    const attrs = [];
    let tok = this.advance();
    while (tok.type === 'attribute') {
      if (tok.name !== 'class' && attributeNames) {
        if (attributeNames.has(tok.name)) {
          this.error(
            'DUPLICATE_ATTRIBUTE',
            'Duplicate attribute "' + tok.name + '" is not allowed.',
            tok,
          );
        }
        attributeNames.add(tok.name);
      }
      attrs.push({
        name: tok.name,
        val: tok.val,
        line: tok.loc.start.line,
        column: tok.loc.start.column,
        filename: this.filename,
      });
      tok = this.advance();
    }
    this.tokens.defer(tok);
    this.expect('end-attributes');
    return attrs;
  }
}
