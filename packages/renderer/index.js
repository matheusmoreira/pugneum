const makeError = require('pugneum-error');

const MAX_MIXIN_DEPTH = 256;

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

function escapeAttrValue(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function sanitizeCommentContent(str) {
  let result = str.replace(/-{2,}/g, (m) => m.split('').join(' '));
  if (result.startsWith('>') || result.startsWith('->')) result = ' ' + result;
  if (result.endsWith('-')) result += ' ';
  return result;
}

const selfClosing = (
  'area, base, br, col, embed, hr, img, input, link, meta, source, track, wbr, ' +
  'circle, ellipse, line, path, polygon, polyline, rect, stop, ' +
  'animate, animateMotion, animateTransform, set'
)
  .split(', ')
  .reduce(function (voidElements, element) {
    voidElements[element] = true;
    return voidElements;
  }, Object.create(null));

module.exports = compileToHTML;

function compileToHTML(ast, options) {
  return new Compiler(ast, options).compile();
}

class Compiler {
  constructor(node, options) {
    this.options = options = options || {};
    this.node = node;
    this.mixins = Object.create(null);
    this.callStack = [];
  }

  error(code, message, node) {
    const sources = this.options.sources;
    const err = makeError(code, message, {
      line: node.line,
      column: node.column,
      filename: node.filename,
      source: (sources && sources[node.filename]) || this.options.source || '',
    });
    throw err;
  }

  compile() {
    this.buf = [];
    this.visit(this.node);
    return this.buf.join('');
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
      switch (node.type) {
        case 'Filter':
          msg += '; use pugneum-filterer';
          break;
        case 'Extends':
        case 'Include':
        case 'FileReference':
          msg += '; use pugneum-linker';
          break;
      }
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
    for (let i = 0; i < block.nodes.length; ++i) {
      this.visit(block.nodes[i], block);
    }
  }

  visitTag(tag) {
    this.buffer('<');
    this.buffer(tag.name);
    this.visitAttributes(tag.attrs);

    if (tag.selfClosing || selfClosing[tag.name]) {
      this.buffer('>');

      if (
        tag.block &&
        !(tag.block.type === 'Block' && tag.block.nodes.length === 0) &&
        tag.block.nodes.some(function (tag) {
          return tag.type !== 'Text' || !/^\s*$/.test(tag.val);
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

  visitComment(comment) {
    if (!comment.buffer) return;
    this.buffer('<!--');
    this.buffer(sanitizeCommentContent(comment.val || ''));
    this.buffer('-->');
  }

  visitYieldBlock(block) {}

  visitBlockComment(comment) {
    if (!comment.buffer) return;
    const blockContent = this.renderToString(comment.block);
    this.buffer('<!--');
    this.buffer(sanitizeCommentContent((comment.val || '') + blockContent));
    this.buffer('-->');
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
      if (declared.usesNamedBlocks) {
        namedBlocks = Object.create(null);
        if (block && block.nodes) {
          for (let i = 0; i < block.nodes.length; ++i) {
            const node = block.nodes[i];
            if (node.type === 'NamedBlock') {
              if (!(node.name in namedBlocks)) {
                namedBlocks[node.name] = [];
              }
              namedBlocks[node.name].push(node);
            } else {
              this.error(
                'UNEXPECTED_CONTENT_IN_NAMED_BLOCK_CALL',
                `Content outside named blocks in call to mixin '${mixin.name}' which uses named blocks`,
                node,
              );
            }
          }
        }
        this.validateNamedBlocks(declared, namedBlocks, mixin);
      }

      this.callStack.push({name: mixin.name, environment, block, namedBlocks});
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
    const current = this.callStack.pop();
    if (!current.block || !current.block.nodes || !current.block.nodes.length) {
      this.callStack.push(current);
      return;
    }
    try {
      this.visit(current.block);
    } finally {
      this.callStack.push(current);
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
    if (node.type === 'NamedBlock') {
      names.add(node.name);
    }
    if (node.type === 'Mixin' && node.call) return;
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
