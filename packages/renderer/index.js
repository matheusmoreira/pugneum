const makeError = require('pugneum-error');

const MAX_MIXIN_DEPTH = 256;

const upstreamNodeStages = Object.freeze(
  Object.assign(Object.create(null), {
    Extends: 'load -> link.assemble',
    Include: 'load -> link.assemble',
    FileReference: 'load -> link.assemble',
    Filter: 'filter',
    IncludeFilter: 'filter',
    References: 'link.resolve',
    ReferenceLink: 'link.resolve',
    ReferenceImage: 'link.resolve',
    Footnotes: 'link.resolve',
    FootnoteRef: 'link.resolve',
    Toc: 'link.resolve',
  }),
);

function requiredStage(node) {
  if (node.type === 'RawInclude') {
    return Array.isArray(node.filters) && node.filters.length > 0
      ? 'filter'
      : 'load -> link.assemble';
  }
  return upstreamNodeStages[node.type];
}

// HTML output context escaping.
//
// Pugneum templates are trusted source — the template author IS the HTML
// author. Text content passes through raw so authors can embed inline HTML.
// Escaping is applied only at syntactic boundaries where unescaped characters
// produce structurally invalid HTML.
//
// Attribute values: & and " must be escaped to prevent entity corruption
// and attribute breakout. < and > are legal in quoted attribute values
// per the HTML spec and are preserved so authors can store markup in
// data attributes.
//
// Comments: the HTML spec (§13.1.6) forbids the sequence -- inside
// comments, starting with > or ->, and ending with -. Consecutive
// hyphens are separated, and leading/trailing padding is applied.
//
// Tag and attribute names are validated by the lexer against the HTML
// spec regex and are safe by construction.
//
// Void / self-closing elements: the HTML and SVG tables below, together with a
// node's own selfClosing flag, are the other HTML-correctness mechanism in this
// file. Such elements reject substantive content (VOID_ELEMENT_WITH_CONTENT).
//
// Value contract: the renderer expects attribute values (attr.val) to be
// either a string or the boolean true (a valueless/boolean attribute), and
// mixin variable values to be a string or null (null = omit). These are the
// only shapes the lexer/parser produce. Any other value (false, a number,
// an object) is not part of the contract; it would be String()-coerced and
// emitted literally rather than treated as an omit/boolean.

function escapeAttrValue(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function sanitizeCommentContent(str) {
  let result = str.replace(/-{2,}/g, (m) => m.split('').join(' '));
  if (result.startsWith('>') || result.startsWith('->')) result = ' ' + result;
  if (result.endsWith('-')) result += ' ';
  return result;
}

function asciiLowerCase(value) {
  return value.replace(/[A-Z]/g, function (character) {
    return String.fromCharCode(character.charCodeAt(0) + 32);
  });
}

function nameSet(names) {
  return names.split(', ').reduce(function (set, element) {
    set[element] = true;
    return set;
  }, Object.create(null));
}

// HTML void elements render with a bare '>' (HTML5 forbids the trailing slash).
const htmlVoid = nameSet(
  'area, base, br, col, embed, hr, img, input, link, meta, source, track, wbr',
);

// SVG self-closing (foreign-content) elements render with ' />': without the
// slash an SVG start tag stays open and its following siblings misnest.
const svgSelfClosing = nameSet(
  'circle, ellipse, line, path, polygon, polyline, rect, stop, ' +
    'animate, animateMotion, animateTransform, set',
);

module.exports = compileToHTML;

function compileToHTML(ast, options) {
  return new Compiler(ast, options).compile();
}

class Compiler {
  constructor(node, options) {
    this.options = options = options || {};
    if (
      options.warnings !== undefined &&
      (!Array.isArray(options.warnings) ||
        !Object.isExtensible(options.warnings) ||
        !Object.getOwnPropertyDescriptor(options.warnings, 'length').writable)
    ) {
      throw new Error('Expected "options.warnings" to be a mutable array');
    }
    this.node = node;
    this.mixins = Object.create(null);
    this.usedMixins = new Set();
    this.warnings = options.warnings === undefined ? [] : options.warnings;
    this.callStack = [];
  }

  // Build the location/source descriptor for a node's diagnostic. The source
  // text is resolved per-file from options.sources, falling back to a single
  // options.source, then to '' (no ±3-line context).
  locate(node) {
    const sources = this.options.sources;
    return {
      line: node.line,
      column: node.column,
      filename: node.filename,
      source: (sources && sources[node.filename]) || this.options.source || '',
    };
  }

  error(code, message, node) {
    throw makeError(code, message, this.locate(node));
  }

  warn(code, message, node) {
    this.warnings.push(makeError.warning(code, message, this.locate(node)));
  }

  compile() {
    this.buf = [];
    this.visit(this.node);
    this.warnUnusedMixins();
    return this.buf.join('');
  }

  // Only flag mixins defined in the entry file: mixins from included files are
  // typically reusable library definitions that a given page may not call.
  warnUnusedMixins() {
    const entry = this.options.filename;
    for (const name in this.mixins) {
      const mixin = this.mixins[name];
      if (!this.usedMixins.has(name) && mixin.filename === entry) {
        this.warn(
          'UNUSED_MIXIN',
          "Mixin '" + name + "' is defined but never called",
          mixin,
        );
      }
    }
  }

  buffer(str) {
    this.buf.push(str);
  }

  renderToString(node) {
    const saved = this.buf;
    this.buf = [];
    try {
      this.visit(node);
      return this.buf.join('');
    } finally {
      this.buf = saved;
    }
  }

  visit(node, parent) {
    if (!node) {
      let msg;
      if (parent) {
        msg =
          'A child of ' +
          parent.type +
          ' (' +
          (parent.filename ? parent.filename + ':' : '') +
          parent.line +
          ')';
      } else {
        msg = 'A top-level node';
      }
      msg += ' is ' + node + ', expected a pugneum abstract syntax tree node';
      throw new TypeError(msg);
    }

    if (!this['visit' + node.type]) {
      const stage = requiredStage(node);
      if (stage) {
        this.error(
          'UNRESOLVED_AST_NODE',
          `AST node type '${node.type}' requires ${stage} before render`,
          node,
        );
      }

      let msg;
      if (parent) {
        msg = 'A child of ' + parent.type;
      } else {
        msg = 'A top-level node';
      }
      msg +=
        ' (' +
        (node.filename ? node.filename + ':' : '') +
        node.line +
        ')' +
        ' is of type ' +
        node.type +
        ',' +
        ' which is not supported by the pugneum compiler';
      throw new TypeError(msg);
    }

    this.visitNode(node);
  }

  visitNode(node) {
    return this['visit' + node.type](node);
  }

  visitInterpolatedTag(interp) {
    return this.visitTag(Object.assign({}, interp, {name: interp.expr}));
  }

  visitNamedBlock(namedBlock) {
    if (this.callStack.length > 0) {
      const frame = this.callStack.at(-1);
      if (frame.namedBlocks) {
        const callerBlocks = frame.namedBlocks[namedBlock.name];
        if (callerBlocks) {
          delete frame.namedBlocks[namedBlock.name];
          let nodes = namedBlock.nodes;
          for (const callerBlock of callerBlocks) {
            switch (callerBlock.mode) {
              case 'replace':
                nodes = callerBlock.nodes;
                break;
              case 'append':
                nodes = nodes.concat(callerBlock.nodes);
                break;
              case 'prepend':
                nodes = callerBlock.nodes.concat(nodes);
                break;
              default:
                this.error(
                  'UNKNOWN_BLOCK_MODE',
                  `Unknown block mode '${callerBlock.mode}'`,
                  callerBlock,
                );
            }
          }
          // Caller-supplied content must render in the caller's lexical scope,
          // so temporarily drop this mixin's frame (restored in finally). The
          // named-block entry was deleted above (and is restored here) so a
          // same-named NamedBlock nested in the caller content renders its own
          // default instead of recursively re-substituting.
          this.callStack.pop();
          try {
            for (const node of nodes) {
              this.visit(node, namedBlock);
            }
          } finally {
            this.callStack.push(frame);
            frame.namedBlocks[namedBlock.name] = callerBlocks;
          }
          return;
        }
        this.visitBlock(namedBlock);
        return;
      }
    }
    this.visitBlock(namedBlock);
  }

  visitBlock(block) {
    if (block.isFootnoteBody) {
      this.renderFootnoteBody(block);
      return;
    }
    for (let i = 0; i < block.nodes.length; ++i) {
      this.visit(block.nodes[i], block);
    }
  }

  renderFootnoteBody(block) {
    let segmentStart = 0;
    let wroteContent = false;

    for (let index = 0; index <= block.nodes.length; index++) {
      const node = block.nodes[index];
      if (
        index < block.nodes.length &&
        (node.type !== 'Text' || node.isFootnoteSeparator !== true)
      ) {
        continue;
      }

      const saved = this.buf;
      this.buf = [];
      let rendered;
      try {
        for (let child = segmentStart; child < index; child++) {
          this.visit(block.nodes[child], block);
        }
        rendered = this.buf.join('');
      } finally {
        this.buf = saved;
      }

      // Source indentation and blank definition lines are not footnote
      // content. Preserve every non-ASCII-whitespace code point, including a
      // deliberate non-breaking space.
      if (/[^ \t\r\n\f]/.test(rendered)) {
        if (wroteContent) this.buffer(' ');
        this.buffer(rendered);
        wroteContent = true;
      }
      segmentStart = index + 1;
    }
  }

  visitTag(tag) {
    const isHtmlVoid = htmlVoid[asciiLowerCase(tag.name)];
    const isSvgSelfClosing = svgSelfClosing[tag.name];

    this.buffer('<');
    this.buffer(tag.name);
    this.visitAttributes(tag.attrs);

    if (tag.selfClosing || isHtmlVoid || isSvgSelfClosing) {
      // Void elements may carry whitespace-only content (formatting) but not
      // substantive content. Each child is a node, not necessarily a Tag.
      if (
        tag.block &&
        (tag.block.nodes || []).some(function (child) {
          return child.type !== 'Text' || !/^\s*$/.test(child.val);
        })
      ) {
        this.error(
          'VOID_ELEMENT_WITH_CONTENT',
          tag.name +
            ' is a self closing element: <' +
            tag.name +
            '> but contains nested content',
          tag,
        );
      }

      // HTML void elements get a bare '>' (HTML5 forbids the trailing slash);
      // SVG foreign-content elements REQUIRE ' />' or the start tag stays open
      // and parses its following siblings as children, misnesting the shapes.
      this.buffer(isSvgSelfClosing ? ' />' : '>');
    } else {
      this.buffer('>');
      this.visit(tag.block, tag);
      this.buffer('</');
      this.buffer(tag.name);
      this.buffer('>');
    }
  }

  visitText(text) {
    this.buffer(text.val);
  }

  // The single HTML-comment envelope: guard, delimiters, and the
  // security-relevant sanitize step (§13.1.6) live here so the plain and
  // block comment paths cannot drift apart.
  emitComment(node, extra) {
    if (!node.buffer) return;
    this.buffer('<!--');
    this.buffer(sanitizeCommentContent((node.val || '') + (extra || '')));
    this.buffer('-->');
  }

  visitComment(comment) {
    this.emitComment(comment, '');
  }

  // YieldBlock is an include's unfilled yield point. The linker rewrites
  // filled yields into Block nodes, so an unfilled yield reaching the renderer
  // deliberately emits nothing.
  visitYieldBlock() {}

  visitBlockComment(comment) {
    this.emitComment(comment, this.renderToString(comment.block));
  }

  visitAttributes(attrs) {
    const classes = [];
    const others = [];
    for (const attr of attrs) {
      if (attr.name === 'class') {
        classes.push(attr);
      } else {
        others.push(attr);
      }
    }
    if (classes.length > 0) {
      const resolved = [];
      for (const attr of classes) {
        if (attr.val === true) continue;
        const val = this.resolveAttrValue(String(attr.val), attr);
        if (val !== null) resolved.push(val);
      }
      if (resolved.length > 0) {
        this.buffer(' class="');
        this.buffer(escapeAttrValue(resolved.join(' ')));
        this.buffer('"');
      }
    }
    for (const attr of others) {
      if (attr.val === true) {
        this.buffer(' ');
        this.buffer(attr.name);
      } else {
        const val = this.resolveAttrValue(String(attr.val), attr);
        if (val === null) continue;
        this.buffer(' ');
        this.buffer(attr.name);
        this.buffer('="');
        this.buffer(escapeAttrValue(val));
        this.buffer('"');
      }
    }
  }

  resolveVariable(name, node) {
    if (this.callStack.length === 0) {
      this.error(
        'CALL_STACK_UNDERFLOW',
        `Variable '${name}' used outside mixin`,
        node,
      );
    }
    const frame = this.callStack.at(-1);
    const value = frame.environment[name];
    if (value === undefined) {
      this.error('UNDEFINED_VARIABLE', `Variable '${name}' is undefined`, node);
    }
    return value;
  }

  resolveAttrValue(str, attr) {
    if (!str.includes('#{')) return str;
    let hasNull = false;
    const resolved = str.replace(
      /\\#\{([-a-zA-Z_?]+)\}|#\{([-a-zA-Z_?]+)\}/g,
      (match, escapedName, name) => {
        if (escapedName) return '#{' + escapedName + '}';
        const value = this.resolveVariable(name, attr);
        if (value === null) {
          hasNull = true;
          return '';
        }
        return value;
      },
    );
    return hasNull ? null : resolved;
  }

  visitMixin(mixin) {
    if (mixin.call) {
      const declared = this.mixins[mixin.name];
      if (!declared) {
        this.error('UNDEFINED_MIXIN', `Undefined mixin '${mixin.name}'`, mixin);
      }
      this.usedMixins.add(mixin.name);

      // Class/id/attribute shorthand on a call (e.g. +box.highlight, +box#main)
      // is parsed onto mixin.attrs but has no defined target element, so it
      // would otherwise be silently dropped. Reject it explicitly rather than
      // lose the author's intent without a trace.
      if (
        (mixin.attrs && mixin.attrs.length > 0) ||
        (mixin.attributeBlocks && mixin.attributeBlocks.length > 0)
      ) {
        this.error(
          'UNSUPPORTED_MIXIN_CALL_ATTRIBUTES',
          `Attributes on a call to mixin '${mixin.name}' are not supported; ` +
            'apply classes, ids and attributes to an element inside the mixin instead',
          mixin,
        );
      }

      const args = mixin.args,
        len = declared.args.length;

      if (args.length > len) {
        this.error(
          'MIXIN_ARGUMENT_COUNT_MISMATCH',
          `Too many arguments: mixin '${mixin.name}' declared ${len} called ${args.length}`,
          mixin,
        );
      }

      for (const frame of this.callStack) {
        if (frame.name === mixin.name) {
          this.error(
            'RECURSIVE_MIXIN',
            `Recursive call to mixin '${mixin.name}' detected`,
            mixin,
          );
        }
      }

      if (this.callStack.length >= MAX_MIXIN_DEPTH) {
        this.error(
          'MIXIN_STACK_OVERFLOW',
          `Mixin call stack depth exceeded ${MAX_MIXIN_DEPTH}`,
          mixin,
        );
      }

      const frame = this.callStack.at(-1);
      const parentEnvironment = (frame && frame.environment) || null;
      const environment = Object.create(parentEnvironment);

      for (let i = 0; i < len; ++i) {
        const param = declared.args[i];
        if (i < args.length) {
          environment[param.name] = args[i];
        } else if ('default' in param) {
          environment[param.name] = param.default;
        } else {
          environment[param.name] = null;
        }
      }

      const block = mixin.block;

      let namedBlocks = null;
      let unnamedBlock = null;
      if (declared.usesNamedBlocks) {
        namedBlocks = Object.create(null);
        const unnamedNodes = [];
        if (block && block.nodes) {
          for (let i = 0; i < block.nodes.length; ++i) {
            const node = block.nodes[i];
            if (node.type === 'NamedBlock') {
              if (!(node.name in namedBlocks)) {
                namedBlocks[node.name] = [];
              }
              namedBlocks[node.name].push(node);
            } else if (declared.usesUnnamedBlock) {
              unnamedNodes.push(node);
            } else {
              this.error(
                'UNEXPECTED_CONTENT_IN_NAMED_BLOCK_CALL',
                `Content outside named blocks in call to mixin '${mixin.name}' which uses named blocks`,
                node,
              );
            }
          }
        }
        if (unnamedNodes.length > 0) {
          unnamedBlock = {
            type: 'Block',
            nodes: unnamedNodes,
            line: unnamedNodes[0].line,
            column: unnamedNodes[0].column,
            filename: unnamedNodes[0].filename,
          };
        }
        this.validateNamedBlocks(declared, namedBlocks, mixin);
      }

      this.callStack.push({
        name: mixin.name,
        environment,
        block,
        namedBlocks,
        unnamedBlock,
      });
      try {
        this.visit(declared.block);
      } finally {
        this.callStack.pop();
      }
    } else {
      this.mixins[mixin.name] = mixin;
    }
  }

  visitVariable(variable) {
    const value = this.resolveVariable(variable.name, variable);
    if (value === null) return;
    this.buffer(value);
  }

  visitMixinBlock(mixinBlock) {
    if (this.callStack.length === 0) {
      this.error(
        'CALL_STACK_UNDERFLOW',
        'MixinBlock used outside mixin call',
        mixinBlock,
      );
    }
    // Pop so the caller's yielded content renders in the caller's scope (one
    // frame up), restored in finally. namedBlocks !== null means this mixin
    // mixes named blocks with an unnamed slot, so MixinBlock yields only the
    // unnamed remainder; otherwise it yields the whole caller block.
    const current = this.callStack.pop();
    try {
      const target =
        current.namedBlocks !== null ? current.unnamedBlock : current.block;
      if (target && target.nodes && target.nodes.length) {
        this.visit(target);
      }
    } finally {
      this.callStack.push(current);
    }
  }

  visitGiven(given) {
    if (this.callStack.length === 0) {
      this.error('GIVEN_OUTSIDE_CALL', 'Given used outside mixin call', given);
    }
    const frame = this.callStack.at(-1);
    if (frame.namedBlocks && frame.namedBlocks[given.name]) {
      this.visit(given.block);
    }
  }

  validateNamedBlocks(declared, callerBlocks, callNode) {
    const declaredNames = new Set();
    this.collectNamedBlockNames(declared.block, declaredNames);
    for (const name of Object.keys(callerBlocks)) {
      if (!declaredNames.has(name)) {
        this.error(
          'UNEXPECTED_NAMED_BLOCK',
          `Mixin '${declared.name}' does not define named block '${name}'`,
          callerBlocks[name][0],
        );
      }
    }
  }

  collectNamedBlockNames(node, names) {
    if (!node) return;
    // NamedBlock declares a fillable slot; Given declares a presence name a
    // caller may fill. Both contribute a declarable block name.
    if (node.type === 'NamedBlock' || node.type === 'Given') {
      names.add(node.name);
    }
    // Stop at nested mixin declarations: their named blocks belong to that
    // mixin, not this one.
    if (node.type === 'Mixin') return;
    if (node.nodes) {
      for (let i = 0; i < node.nodes.length; ++i) {
        this.collectNamedBlockNames(node.nodes[i], names);
      }
    }
    if (node.block) {
      this.collectNamedBlockNames(node.block, names);
    }
  }
}
