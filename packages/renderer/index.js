const makeError = require('pugneum-error');

// Map of self-closing void elements literally copied from the standard.
// https://html.spec.whatwg.org/multipage/syntax.html#void-elements
const selfClosing =
  'area, base, br, col, embed, hr, img, input, link, meta, source, track, wbr'
  .split(', ')
  .reduce(function(voidElements, element) {
    voidElements[element] = true;
    return voidElements;
  }, {});

module.exports = compileToHTML;

function compileToHTML(ast, options) {
  return new Compiler(ast, options).compile();
}

class Compiler {
  constructor(node, options) {
    this.options = options = options || {};
    this.node = node;
    this.mixins = {};
    this.callStack = [];
  }

  error(message, code, node) {
    const err = makeError(code, message, {
      line: node.line,
      column: node.column,
      filename: node.filename,
    });
    throw err;
  }

  compile() {
    this.buf = [];

    if (this.options.doctype !== false) {
      this.buffer('<!DOCTYPE html>');
    }

    this.visit(this.node);

    return this.buf.join('');
  }

  buffer(str) {
    this.buf.push(str);
  }

  visit(node, parent) {
    if (!node) {
      let msg;
      if (parent) {
        msg =
          'A child of ' +
          parent.type +
          ' (' +
          (parent.filename? parent.filename + ':' : '') +
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
        (node.filename? node.filename + ':' : '') +
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
        case 'NamedBlock':
        case 'FileReference': // unlikely but for the sake of completeness
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

  visitLiteral(node) {
    this.buffer(node.str);
  }

  visitInterpolatedTag(tag) {
    tag.name = tag.expr;
    return this.visitTag(tag);
  }

  visitNamedBlock(block) {
    return this.visitBlock(block);
  }

  visitBlock(block) {
    for (let i = 0; i < block.nodes.length; ++i) {
      this.visit(block.nodes[i], block);
    }
  }

  visitTag(tag, interpolated) {
    this.buffer('<');
    this.buffer(tag.name);
    this.visitAttributes(tag.attrs);

    if (tag.selfClosing || selfClosing[tag.name]) {
      this.buffer('>');

      // if it is non-empty throw an error
      if (
          tag.block &&
          !(tag.block.type === 'Block' && tag.block.nodes.length === 0) &&
          (tag.block.nodes.some(function(tag) {
            return tag.type !== 'Text' || !/^\s*$/.test(tag.val);
          }))
      ) {
        this.error(
          tag.name +
            ' is a self closing element: <' +
            tag.name +
            '> but contains nested content',
          'VOID_ELEMENT_WITH_CONTENT',
          tag
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
    this.buffer('<!--' + comment.val + '-->');
  }

  /**
   * Visit a `YieldBlock`.
   *
   * This is necessary since we allow compiling a file with `yield`.
   *
   * @param {YieldBlock} block
   * @api public
   */

  visitYieldBlock(block) {}

  visitBlockComment(comment) {
    if (!comment.buffer) return;
    this.buffer('<!--' + (comment.val || ''));
    this.visit(comment.block, comment);
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
      // resolve each class contribution individually; skip null ones
      const resolved = [];
      for (const attr of classes) {
        const val = this.resolveAttrValue(String(attr.val), attr);
        if (val !== null) resolved.push(val);
      }
      if (resolved.length > 0) {
        this.buffer(' class="');
        this.buffer(resolved.join(' ').replace(/"/g, '&quot;'));
        this.buffer('"');
      }
    }
    for (const attr of others) {
      if (attr.val === true) {
        // boolean attribute
        this.buffer(' ');
        this.buffer(attr.name);
      } else {
        const val = this.resolveAttrValue(String(attr.val), attr);
        if (val === null) continue; // null variable — omit entire attribute
        this.buffer(' ');
        this.buffer(attr.name);
        this.buffer('="');
        this.buffer(val.replace(/"/g, '&quot;'));
        this.buffer('"');
      }
    }
  }

  resolveAttrValue(str, attr) {
    if (!str.includes('#{')) return str;
    let hasNull = false;
    const resolved = str.replace(/\\#\{(\w+)\}|#\{(\w+)\}/g, (match, escapedName, name) => {
      if (escapedName) return '#{' + escapedName + '}';
      if (this.callStack.length === 0) {
        this.error(
          `Variable '${name}' used outside mixin in attribute`,
          'CALL_STACK_UNDERFLOW',
          attr
        );
      }
      const frame = this.callStack.at(-1);
      const value = frame.environment[name];
      if (value === undefined) {
        this.error(
          `Variable '${name}' is undefined`,
          'UNDEFINED_VARIABLE',
          attr
        );
      }
      if (value === null) {
        hasNull = true;
        return '';
      }
      return value;
    });
    return hasNull ? null : resolved;
  }

  visitMixin(mixin) {
    if (mixin.call) {
      // find defined mixin of same name
      const declared = this.mixins[mixin.name];
      if (!declared) {
        this.error(`Undefined mixin '${mixin.name}'`, 'UNDEFINED_MIXIN', mixin);
      }

      // check arguments: allow fewer (optional), reject too many
      const args = mixin.args, len = declared.args.length;

      if (args.length > len) {
        this.error(
            `Too many arguments: mixin '${mixin.name}' declared ${len} called ${args.length}`,
            'MIXIN_ARGUMENT_COUNT_MISMATCH',
            mixin
        );
      }

      // bind arguments: provided → string, default → default, neither → null
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

      // bind caller's block
      const block = mixin.block;

      // evaluate mixin block which may contain variable nodes
      this.callStack.push({environment, block});
      this.visit(declared.block);
      this.callStack.pop();
    } else {
      // mixin declaration, save mixin
      this.mixins[mixin.name] = mixin;
    }
  }

  visitVariable(variable) {
    if (this.callStack.length === 0) {
      this.error(`Variable '${variable.name}' used outside mixin`, 'CALL_STACK_UNDERFLOW', variable);
    }

    const frame = this.callStack.at(-1);
    const value = frame.environment[variable.name];

    if (value === undefined) {
      this.error(`Variable '${variable.name}' is undefined`, 'UNDEFINED_VARIABLE', variable);
    }

    // null means declared but not provided — emit nothing
    if (value === null) return;

    this.buffer(value);
  }

  visitMixinBlock(mixinBlock) {
    const current = this.callStack.at(-1);
    this.visit(current.block);
  }
}
