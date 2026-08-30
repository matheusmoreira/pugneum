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

// Used to compute a mixin's usesNamedBlocks / usesUnnamedBlock flags by
// searching its body for NamedBlock / MixinBlock / Given nodes. The stop at
// nested Mixin nodes is load-bearing: a mixin's block flags must reflect only
// its OWN body, so an inner mixin definition's (or call's) named/unnamed blocks
// must not leak onto the outer mixin's flags. Do not reuse this as a generic
// "subtree contains X" walker without accounting for that boundary.
function containsNodeType(node, type) {
  if (!node) return false;
  if (node.type === type) return true;
  if (node.type === 'Mixin') return false;
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

// Token types that begin a piece of inline content inside a text block.
// Used by collectInlineContent to decide whether a consumed newline still
// separates two pieces of inline content (in which case the '\n' separator
// must be emitted) or is merely a trailing newline before outdent/eos.
const inlineStartTokens = new Set([
  'text',
  'start-interpolation',
  'start-ref-link',
  'start-ref-image',
  'start-footnote-ref',
]);

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
    this.inMixinCall = 0;
    // Stack of the enclosing mixin constructs in lexical nesting order: 'def'
    // for a mixin definition body, 'call' for a mixin call block. The top of
    // the stack is the innermost enclosing mixin construct, which is what
    // decides `given` validity. Cumulative counters cannot express "innermost"
    // and mis-decide nested definition-inside-call / call-inside-definition.
    this.mixinCtx = [];
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
   * Dispatch on the leading token. Kept in sync with the switch in
   * _parseExpr (the authoritative dispatch table):
   *
   *   tag
   * | mixin
   * | block
   * | mixin-block
   * | given
   * | variable
   * | extends
   * | include
   * | references
   * | footnotes
   * | toc
   * | filter
   * | comment
   * | text | start-interpolation | start-ref-link | start-ref-image | start-footnote-ref
   * | dot
   * | call
   * | interpolation
   * | yield
   * | id
   * | class
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
          // Emit the line separator whenever more inline content follows, not
          // only when the next line begins with a literal text token. A
          // continued line that starts with an interpolation (#{var}) or an
          // inline reference/footnote sigil is still inline content, and
          // dropping the '\n' here glues the two lines' words together.
          if (inlineStartTokens.has(this.peek().type)) {
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
    const ctx = this.mixinCtx[this.mixinCtx.length - 1];
    if (ctx === undefined) {
      this.error(
        'GIVEN_OUTSIDE_MIXIN',
        'The given keyword can only be used inside a mixin definition.',
        tok,
      );
    }
    if (ctx !== 'def') {
      this.error(
        'GIVEN_OUTSIDE_MIXIN',
        'The given keyword cannot be used inside a mixin call block.',
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
            // A newline inside a footnote definition joins the surrounding
            // lines with a single space. It is a separator, so it must only
            // appear BETWEEN pieces of content, never lead the body: when the
            // definition's content starts on the line after the name, the
            // lexer emits a leading newline token, and converting it to a
            // space prepended a spurious U+0020 to the rendered footnote (e.g.
            // " first line second line"). Mirror collectInlineContent: emit
            // the joining space only when content already precedes it.
            if (block.nodes.length > 0) {
              block.nodes.push({
                type: 'Text',
                val: ' ',
                line: next.loc.start.line,
                column: next.loc.start.column,
                filename: this.filename,
              });
            }
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
   * include filter* path
   *
   * An unfiltered `.pg` path may consume an `indent`/`outdent` block. Every
   * other path becomes a RawInclude and rejects a following `indent`.
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

    this.inMixinCall++;
    this.mixinCtx.push('call');
    try {
      this.tag(mixin);
    } finally {
      this.mixinCtx.pop();
      this.inMixinCall--;
    }
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
      this.mixinCtx.push('def');
      let block;
      try {
        block = this.block();
      } finally {
        this.mixinCtx.pop();
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
   * start-pipeless-text
   *   (text | newline
   *     | start-interpolation expr end-interpolation
   *     | start-ref-link ... end-ref-link
   *     | start-ref-image ... end-ref-image
   *     | start-footnote-ref ... end-footnote-ref)*
   * end-pipeless-text
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
          for (let i = 0; i < expr.nodes.length; ++i) {
            block.nodes.push(expr.nodes[i]);
          }
        } else {
          block.nodes.push(expr);
        }
      }
    }
    this.expect('outdent');
    return block;
  }

  /**
   * Create an InterpolatedTag from a direct compatibility token, then consume
   * its shared suffix in tag().
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
   * Create a Tag from its head token, then consume its shared suffix in tag().
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
   * Consume the suffix shared by Tag, InterpolatedTag, and Mixin-call nodes.
   * The switches below are the authoritative accepted-token lists.
   */

  tag(tag) {
    let seenAttrs = false;
    const attributeNames = new Set();
    // Attribute and shorthand prefix.
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

    // An immediate dot selects pipeless-text body handling.
    if ('dot' === this.peek().type) {
      tag.textOnly = true;
      this.advance();
    }

    // Optional immediate inline content, colon expression, or mixin variable.
    switch (this.peek().type) {
      case 'text':
      case 'start-interpolation':
      case 'start-ref-link':
      case 'start-ref-image':
      case 'start-footnote-ref':
        const text = this.parseText();
        if (text.type === 'Block') {
          // In-place push rather than push.apply(...spread): a single line
          // packed with inline shorthands can collect more nodes than V8's
          // apply argument-spread limit, which would throw a raw RangeError
          // (no PUGNEUM code) instead of parsing or aborting honestly.
          for (let i = 0; i < text.nodes.length; ++i) {
            tag.block.nodes.push(text.nodes[i]);
          }
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
            '` while parsing tag content',
          this.peek(),
        );
    }

    // Line separators before an optional body.
    while ('newline' === this.peek().type) this.advance();

    // Dot syntax owns a pipeless body; otherwise accept an ordinary block.
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
