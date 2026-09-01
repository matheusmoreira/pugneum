const makeError = require('pugneum-error');
const generatedSourceOrigins = Symbol.for('pugneum.generatedSourceOrigins');
const attributeInterpolationSource = Symbol.for(
  'pugneum.attributeInterpolationSource',
);
const attributeVariableNameCharacter = /[-a-zA-Z_?]/;
const tagNamePattern = /^[A-Za-z](?:[-:A-Za-z0-9_]*[A-Za-z0-9_])?$/;

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

function requiredStage(node, type) {
  if (type === 'RawInclude') {
    return Array.isArray(node.filters) && node.filters.length > 0
      ? 'filter'
      : 'load -> link.assemble';
  }
  return upstreamNodeStages[type];
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
// Static tag names are validated by the lexer, and direct/generated AST names
// are revalidated here. Attribute names are validated by the lexer.
//
// HTML voidness is namespace-sensitive and rejects substantive content. SVG
// elements are never void: selected childless shapes may use compact `/>`
// syntax while non-empty shapes retain their children and explicit end tags.
// A selfClosing flag on a non-void HTML node is normalized to an ordinary empty
// element with an end tag because HTML has no self-closing custom elements.
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

function attributeVariableAt(str, start) {
  if (str[start] !== '#' || str[start + 1] !== '{') return null;

  let end = start + 2;
  while (end < str.length && attributeVariableNameCharacter.test(str[end])) {
    end++;
  }
  if (end === start + 2 || str[end] !== '}') return null;

  return {end: end + 1, name: str.substring(start + 2, end)};
}

function sourceOrigin(sources, filename) {
  const origins = sources && sources[generatedSourceOrigins];
  return origins && Object.prototype.hasOwnProperty.call(origins, filename)
    ? origins[filename]
    : filename;
}

function nameSet(names) {
  return names.split(', ').reduce(function (set, element) {
    set[element] = true;
    return set;
  }, Object.create(null));
}

// HTML void elements render with a bare '>'.
const htmlVoid = nameSet(
  'area, base, br, col, embed, hr, img, input, link, meta, source, track, wbr',
);

// Empty forms of these common SVG elements retain the compact spelling used by
// Pugneum historically. This is only a serialization preference inside SVG;
// it never makes the element void or forbids children.
const compactSvg = nameSet(
  'circle, ellipse, line, path, polygon, polyline, rect, stop, ' +
    'animate, animatemotion, animatetransform, set',
);
const svgHtmlIntegrationPoint = nameSet('foreignobject, desc, title');

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
    this.namespace = 'html';
    this.mixins = Object.create(null);
    this.mixinSlots = new WeakMap();
    this.usedMixins = new Set();
    this.warnings = options.warnings === undefined ? [] : options.warnings;
    this.callStack = [];
  }

  // Build the location/source descriptor for a node's diagnostic. The source
  // text is resolved per-file from options.sources, falling back to a single
  // options.source, then to '' (no ±3-line context).
  locate(node) {
    const sources = this.options.sources;
    const hasMappedSource =
      sources && Object.prototype.hasOwnProperty.call(sources, node.filename);
    return {
      line: node.line,
      column: node.column,
      filename: node.filename,
      source: hasMappedSource
        ? sources[node.filename]
        : this.options.source || '',
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
    const sources = this.options.sources;
    for (const name in this.mixins) {
      const mixin = this.mixins[name];
      if (
        !this.usedMixins.has(name) &&
        sourceOrigin(sources, mixin.filename) === sourceOrigin(sources, entry)
      ) {
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

  withCallerScope(callback) {
    const current = this.callStack.pop();
    try {
      return callback(current);
    } finally {
      this.callStack.push(current);
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

    const type = node.type;
    const visitor = this['visit' + type];
    if (!visitor) {
      const stage = requiredStage(node, type);
      if (stage) {
        this.error(
          'UNRESOLVED_AST_NODE',
          `AST node type '${type}' requires ${stage} before render`,
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
        type +
        ',' +
        ' which is not supported by the pugneum compiler';
      throw new TypeError(msg);
    }

    return visitor.call(this, node);
  }

  visitInterpolatedTag(interp) {
    return this.visitTag(interp, interp.expr);
  }

  visitNamedBlock(namedBlock) {
    if (this.callStack.length > 0) {
      const frame = this.callStack.at(-1);
      if (frame.namedBlocks) {
        const callerBlocks = frame.namedBlocks[namedBlock.name];
        if (callerBlocks) {
          delete frame.namedBlocks[namedBlock.name];
          let base = {nodes: namedBlock.nodes, scope: 'callee'};
          const prepends = [];
          const appends = [];
          // A combined slot retains two lexical owners: defaults belong to the
          // callee, while supplied fragments belong to the caller. Keep that
          // boundary through composition instead of flattening both into one
          // array and evaluating the default after the callee frame is gone.
          // The named-block entry stays deleted while every fragment renders,
          // preventing same-name content from recursively re-substituting.
          try {
            for (const callerBlock of callerBlocks) {
              const fragment = {nodes: callerBlock.nodes, scope: 'caller'};
              switch (callerBlock.mode) {
                case 'replace':
                  base = fragment;
                  prepends.length = 0;
                  appends.length = 0;
                  break;
                case 'append':
                  appends.push(fragment);
                  break;
                case 'prepend':
                  prepends.push(fragment);
                  break;
                default:
                  this.error(
                    'UNKNOWN_BLOCK_MODE',
                    `Unknown block mode '${callerBlock.mode}'`,
                    callerBlock,
                  );
              }
            }

            const renderFragment = (fragment) => {
              const renderNodes = () => {
                for (const node of fragment.nodes) {
                  this.visit(node, namedBlock);
                }
              };
              if (fragment.scope === 'caller') {
                this.withCallerScope(renderNodes);
              } else {
                renderNodes();
              }
            };

            for (let index = prepends.length - 1; index >= 0; index--) {
              renderFragment(prepends[index]);
            }
            renderFragment(base);
            for (const fragment of appends) {
              renderFragment(fragment);
            }
          } finally {
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

  visitTag(tag, explicitName) {
    const name = explicitName === undefined ? tag.name : explicitName;
    if (typeof name !== 'string' || !tagNamePattern.test(name)) {
      this.error(
        'INVALID_TAG_NAME',
        'Tag names must start with an ASCII letter',
        tag,
      );
    }
    const normalizedName = asciiLowerCase(name);
    const namespace =
      this.namespace === 'html' && normalizedName === 'svg'
        ? 'svg'
        : this.namespace;
    const isHtmlVoid = namespace === 'html' && htmlVoid[normalizedName];
    const nodes = tag.block ? tag.block.nodes || [] : [];

    this.buffer('<');
    this.buffer(name);
    this.visitAttributes(tag.attrs);

    if (isHtmlVoid) {
      // HTML void elements may carry whitespace-only source formatting but not
      // substantive AST content. Each child is a node, not necessarily a Tag.
      if (
        nodes.some(function (child) {
          return child.type !== 'Text' || !/^\s*$/.test(child.val);
        })
      ) {
        this.error(
          'VOID_ELEMENT_WITH_CONTENT',
          name +
            ' is a self closing element: <' +
            name +
            '> but contains nested content',
          tag,
        );
      }

      this.buffer('>');
      return;
    }

    if (
      namespace === 'svg' &&
      nodes.length === 0 &&
      (tag.selfClosing || compactSvg[normalizedName])
    ) {
      this.buffer(' />');
      return;
    }

    this.buffer('>');
    const parentNamespace = this.namespace;
    this.namespace =
      namespace === 'svg' && svgHtmlIntegrationPoint[normalizedName]
        ? 'html'
        : namespace;
    try {
      this.visit(tag.block, tag);
    } finally {
      this.namespace = parentNamespace;
    }
    this.buffer('</');
    this.buffer(name);
    this.buffer('>');
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
    // An unbuffered comment is opaque discarded source. Avoid evaluating its
    // descendants, which could otherwise throw or mutate compiler state even
    // though emitComment would discard the rendered bytes.
    if (!comment.buffer) return;
    this.emitComment(comment, this.renderToString(comment.block));
  }

  visitAttributes(attrs) {
    const classes = [];
    const others = [];
    for (const attr of attrs) {
      if (asciiLowerCase(attr.name) === 'class') {
        classes.push(attr);
      } else {
        others.push(attr);
      }
    }
    if (classes.length > 0) {
      const resolved = [];
      let hasValuelessClass = false;
      for (const attr of classes) {
        if (attr.val === true) {
          hasValuelessClass = true;
          continue;
        }
        const val = this.resolveAttrValue(String(attr.val), attr);
        if (val !== null) resolved.push(val);
      }
      if (resolved.length > 0) {
        this.buffer(' class="');
        this.buffer(escapeAttrValue(resolved.join(' ')));
        this.buffer('"');
      } else if (hasValuelessClass) {
        this.buffer(' class');
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
        'VARIABLE_OUTSIDE_MIXIN',
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
    const retained = attr[attributeInterpolationSource];
    const source = typeof retained === 'string' ? retained : str;
    if (!source.includes('#{')) return source;

    const pieces = [];
    let hasNull = false;
    let index = 0;

    while (index < source.length) {
      let marker = index;
      while (source[marker] === '\\') marker++;
      const variable = attributeVariableAt(source, marker);

      if (variable) {
        const backslashes = marker - index;
        pieces.push('\\'.repeat(Math.floor(backslashes / 2)));
        if (backslashes % 2 !== 0) {
          pieces.push(source.slice(marker, variable.end));
        } else {
          const value = this.resolveVariable(variable.name, attr);
          if (value === null) {
            hasNull = true;
          } else {
            pieces.push(value);
          }
        }
        index = variable.end;
        continue;
      }

      if (marker !== index) {
        pieces.push(source.slice(index, marker));
        index = marker;
      } else {
        let literalEnd = index + 1;
        while (
          literalEnd < source.length &&
          source[literalEnd] !== '\\' &&
          (source[literalEnd] !== '#' || source[literalEnd + 1] !== '{')
        ) {
          literalEnd++;
        }
        pieces.push(source.slice(index, literalEnd));
        index = literalEnd;
      }
    }

    return hasNull ? null : pieces.join('');
  }

  visitMixin(mixin) {
    if (mixin.call) {
      const declared = this.mixins[mixin.name];
      if (!declared) {
        this.error('UNDEFINED_MIXIN', `Undefined mixin '${mixin.name}'`, mixin);
      }
      this.usedMixins.add(mixin.name);
      const slots = this.mixinSlots.get(declared);

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
      if (slots.usesNamedBlocks) {
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
            } else if (slots.usesUnnamedBlock) {
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
        this.validateNamedBlocks(declared, namedBlocks, slots.namedBlockNames);
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
      // Parser flags describe the declaration when it was first parsed, but
      // includes and structured filters can replace its body before render.
      // Cache capabilities from the final declaration shape instead.
      this.mixinSlots.set(mixin, this.inspectMixinSlots(mixin.block));
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
    this.withCallerScope((current) => {
      const target =
        current.namedBlocks !== null ? current.unnamedBlock : current.block;
      if (target && target.nodes && target.nodes.length) {
        this.visit(target);
      }
    });
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

  validateNamedBlocks(declared, callerBlocks, declaredNames) {
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

  inspectMixinSlots(block) {
    const namedBlockNames = new Set();
    this.collectNamedBlockNames(block, namedBlockNames);
    return {
      namedBlockNames,
      usesNamedBlocks: namedBlockNames.size > 0,
      usesUnnamedBlock: this.containsUnnamedSlot(block),
    };
  }

  containsUnnamedSlot(node) {
    if (!node) return false;
    if (node.type === 'MixinBlock') return true;
    // A nested declaration owns its own slots. A nested call remains in the
    // enclosing lexical scope, so its caller block may deliberately forward
    // the enclosing unnamed slot through one or more helper calls.
    if (node.type === 'Mixin' && node.call === false) return false;
    if (node.nodes) {
      for (let i = 0; i < node.nodes.length; ++i) {
        if (this.containsUnnamedSlot(node.nodes[i])) return true;
      }
    }
    if (node.block) return this.containsUnnamedSlot(node.block);
    return false;
  }

  collectNamedBlockNames(node, names) {
    if (!node) return;
    // NamedBlock declares a fillable slot; Given declares a presence name a
    // caller may fill. Both contribute a declarable block name.
    if (node.type === 'NamedBlock' || node.type === 'Given') {
      names.add(node.name);
    }
    // Stop at nested mixins: declarations own their slots, while named blocks
    // in a call block are arguments to that callee rather than declarations on
    // the enclosing mixin. Unnamed forwarding through calls is scanned by the
    // separate containsUnnamedSlot path above.
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
