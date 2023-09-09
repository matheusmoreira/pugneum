var makeError = require('pugneum-error');

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

function Compiler(node, options) {
  this.options = options = options || {};
  this.node = node;
  this.mixins = {};
  this.callStack = [];
}

Compiler.prototype = {
  error: function(message, code, node) {
    var err = makeError(code, message, {
      line: node.line,
      column: node.column,
      filename: node.filename,
    });
    throw err;
  },

  compile: function() {
    this.buf = [];

    // all pugneum documents will compile to HTML5
    this.buffer('<!DOCTYPE html>');

    this.visit(this.node);

    return this.buf.join('');
  },

  buffer: function(str) {
    this.buf.push(str);
  },

  visit: function(node, parent) {
    if (!node) {
      var msg;
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
      var msg;
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
  },

  visitNode: function(node) {
    return this['visit' + node.type](node);
  },

  visitLiteral: function(node) {
    this.buffer(node.str);
  },

  visitNamedBlock: function(block) {
    return this.visitBlock(block);
  },

  visitBlock: function(block) {
    for (var i = 0; i < block.nodes.length; ++i) {
      this.visit(block.nodes[i], block);
    }
  },

  visitTag: function(tag, interpolated) {
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
  },

  visitText: function(text) {
    this.buffer(text.val);
  },

  visitComment: function(comment) {
    if (!comment.buffer) return;
    this.buffer('<!--' + comment.val + '-->');
  },

  /**
   * Visit a `YieldBlock`.
   *
   * This is necessary since we allow compiling a file with `yield`.
   *
   * @param {YieldBlock} block
   * @api public
   */

  visitYieldBlock: function(block) {},

  visitBlockComment: function(comment) {
    if (!comment.buffer) return;
    this.buffer('<!--' + (comment.val || ''));
    this.visit(comment.block, comment);
    this.buffer('-->');
  },

  visitAttributes: function(attrs) {
    for (let len = attrs.length, i = 0; i < len; ++i) {
      let attr = attrs[i];
      this.buffer(' ');
      this.buffer(attr.name);
      this.buffer('="');
      this.buffer(attr.val);
      this.buffer('"');
    }
  },

  visitMixin: function(mixin) {
    if (mixin.call) {
      // find defined mixin of same name
      let declared = this.mixins[mixin.name];
      if (!declared) {
        this.error(`Undefined mixin '${mixin.name}'`, 'UNDEFINED_MIXIN', mixin);
      }

      // check arguments
      let args = mixin.args, len = declared.args.length;

      if (args.length !== declared.args.length) {
        this.error(
            `Arguments mismatch: mixin '${mixin.name}' declared ${len} called ${args.length}`,
            'MIXIN_ARGUMENT_COUNT_MISMATCH',
            mixin
        );
      }

      // bind arguments
      let frame = this.callStack.at(-1);
      let parentEnvironment = (frame && frame.environment) || null;
      let environment = Object.create(parentEnvironment);

      for (let i = 0; i <len; ++i) {
        environment[declared.args[i]] = args[i];
      }

      // bind caller's block
      let block = mixin.block;

      // evaluate mixin block which may contain variable nodes
      this.callStack.push({environment, block});
      this.visit(declared.block);
      this.callStack.pop();
    } else {
      // mixin declaration, save mixin
      this.mixins[mixin.name] = mixin;
    }
  },

  visitVariable: function(variable) {
    if (this.callStack.length === 0) {
      this.error(`Variable '${variable.name}' used outside mixin`, 'CALL_STACK_UNDERFLOW', variable);
    }

    let frame = this.callStack.at(-1);
    let value = frame.environment[variable.name];

    if (!value) {
      this.error(`Variable '${variable.name}' is undefined`, 'UNDEFINED_VARIABLE', variable);
    }

    this.buffer(value);
  },

  visitMixinBlock: function(mixinBlock) {
    let current = this.callStack.at(-1);
    this.visit(current.block);
  },
};

function tagCanInline(tag) {
  function isInline(node) {
    // Recurse if the node is a block
    if (node.type === 'Block') return node.nodes.every(isInline);
    // When there is a YieldBlock here, it is an indication that the file is
    // expected to be included but is not. If this is the case, the block
    // must be empty.
    if (node.type === 'YieldBlock') return true;
    return (node.type === 'Text' && !/\n/.test(node.val)) || node.isInline;
  }

  return tag.block.nodes.every(isInline);
}
