'use strict';

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

/**
 * Initialize `Compiler` with the given `node`.
 *
 * @param {Node} node
 * @param {Object} options
 * @api public
 */

function Compiler(node, options) {
  this.options = options = options || {};
  this.node = node;
  this.bufferedConcatenationCount = 0;
  this.hasCompiledTag = false;
  this.terse = true;
  this.mixins = {};
  this.dynamicMixins = false;
  this.eachCount = 0;
  this.runtimeFunctionsUsed = [];
  this.inlineRuntimeFunctions = options.inlineRuntimeFunctions || false;
  if (this.debug && this.inlineRuntimeFunctions) {
    this.runtimeFunctionsUsed.push('rethrow');
  }
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
    this.lastBufferedIdx = -1;

    // all pugneum documents will compile to HTML5
    this.buffer('<!DOCTYPE html>');

    this.visit(this.node);

    return this.buf.join('');
  },

  /**
   * Buffer the given `str` exactly as is or with interpolation
   *
   * @param {String} str
   * @param {Boolean} interpolate
   * @api public
   */

  buffer: function(str) {
    this.buf.push(str);
  },

  /**
   * Visit `node`.
   *
   * @param {Node} node
   * @api public
   */

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
          msg += '; use pugneum-filters';
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

  /**
   * Visit `node`.
   *
   * @param {Node} node
   * @api public
   */

  visitNode: function(node) {
    return this['visit' + node.type](node);
  },

  /**
   * Visit literal `node`.
   *
   * @param {Literal} node
   * @api public
   */

  visitLiteral: function(node) {
    this.buffer(node.str);
  },

  visitNamedBlock: function(block) {
    return this.visitBlock(block);
  },

  /**
   * Visit all nodes in `block`.
   *
   * @param {Block} block
   * @api public
   */

  visitBlock: function(block) {
    for (var i = 0; i < block.nodes.length; ++i) {
      this.visit(block.nodes[i], block);
    }
  },

  /**
   * Visit a mixin's `block` keyword.
   *
   * @param {MixinBlock} block
   * @api public
   */

  visitMixinBlock: function(block) {
    this.buf.push('block && block();');
  },

  /**
   * Visit `mixin`, generating a function that
   * may be called within the template.
   *
   * @param {Mixin} mixin
   * @api public
   */

  visitMixin: function(mixin) {
    var name = 'pug_mixins[';
    var args = mixin.args || '';
    var block = mixin.block;
    var attrs = mixin.attrs;
    var dynamic = mixin.name[0] === '#';
    var key = mixin.name;
    if (dynamic) this.dynamicMixins = true;
    name +=
      (dynamic
        ? mixin.name.substr(2, mixin.name.length - 3)
        : '"' + mixin.name + '"') + ']';

    this.mixins[key] = this.mixins[key] || {used: false, instances: []};
    if (mixin.call) {
      this.mixins[key].used = true;
      if (block || attrs.length || attrsBlocks.length) {
        this.buf.push(name + '.call({');

        if (block) {
          this.buf.push('block: function(){');

          // Render block with no indents, dynamically added when rendered
          this.visit(mixin.block, mixin);

          if (attrs.length || attrsBlocks.length) {
            this.buf.push('},');
          } else {
            this.buf.push('}');
          }
        }

        if (attrsBlocks.length) {
          if (attrs.length) {
            var val = this.attrs(attrs);
            attrsBlocks.unshift(val);
          }
          if (attrsBlocks.length > 1) {
            this.buf.push(
              'attributes: ' +
                this.runtime('merge') +
                '([' +
                attrsBlocks.join(',') +
                '])'
            );
          } else {
            this.buf.push('attributes: ' + attrsBlocks[0]);
          }
        } else if (attrs.length) {
          var val = this.attrs(attrs);
          this.buf.push('attributes: ' + val);
        }

        if (args) {
          this.buf.push('}, ' + args + ');');
        } else {
          this.buf.push('});');
        }
      } else {
        this.buf.push(name + '(' + args + ');');
      }
    } else {
      var mixin_start = this.buf.length;
      args = args ? args.split(',') : [];
      var rest;
      if (args.length && /^\.\.\./.test(args[args.length - 1].trim())) {
        rest = args
          .pop()
          .trim()
          .replace(/^\.\.\./, '');
      }
      // we need use pug_interp here for v8: https://code.google.com/p/v8/issues/detail?id=4165
      // once fixed, use this: this.buf.push(name + ' = function(' + args.join(',') + '){');
      this.buf.push(name + ' = pug_interp = function(' + args.join(',') + '){');
      this.buf.push(
        'var block = (this && this.block), attributes = (this && this.attributes) || {};'
      );
      if (rest) {
        this.buf.push('var ' + rest + ' = [];');
        this.buf.push(
          'for (pug_interp = ' +
            args.length +
            '; pug_interp < arguments.length; pug_interp++) {'
        );
        this.buf.push('  ' + rest + '.push(arguments[pug_interp]);');
        this.buf.push('}');
      }
      this.visit(block, mixin);
      this.buf.push('};');
      var mixin_end = this.buf.length;
      this.mixins[key].instances.push({start: mixin_start, end: mixin_end});
    }
  },

  /**
   * Visit `tag` buffering tag markup, generating
   * attributes, visiting the `tag`'s code and block.
   *
   * @param {Tag} tag
   * @param {boolean} interpolated
   * @api public
   */

  visitTag: function(tag, interpolated) {
    this.buffer('<');
    this.buffer(tag.name);
    if (tag.attrs.length > 0) { this.buffer(' '); }
    this.visitAttributes(tag.attrs);

    if (tag.selfClosing || selfClosing[tag.name]) {
      this.buffer('/>');

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
            '/> but contains nested content',
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

  /**
   * Visit `text` node.
   *
   * @param {Text} text
   * @api public
   */

  visitText: function(text) {
    this.buffer(text.val);
  },

  /**
   * Visit a `comment`, only buffering when the buffer flag is set.
   *
   * @param {Comment} comment
   * @api public
   */

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

  /**
   * Visit a `BlockComment`.
   *
   * @param {Comment} comment
   * @api public
   */

  visitBlockComment: function(comment) {
    if (!comment.buffer) return;
    this.buffer('<!--' + (comment.val || ''));
    this.visit(comment.block, comment);
    this.buffer('-->');
  },

  /**
   * Visit `attrs`.
   *
   * @param {Array} attrs
   * @api public
   */

  visitAttributes: function(attrs, attributeBlocks) {
    if (attributeBlocks.length) {
      if (attrs.length) {
        var val = this.attrs(attrs);
        attributeBlocks.unshift(val);
      }
      if (attributeBlocks.length > 1) {
        this.bufferExpression(
          this.runtime('attrs') +
            '(' +
            this.runtime('merge') +
            '([' +
            attributeBlocks.join(',') +
            ']), ' +
            stringify(this.terse) +
            ')'
        );
      } else {
        this.bufferExpression(
          this.runtime('attrs') +
            '(' +
            attributeBlocks[0] +
            ', ' +
            stringify(this.terse) +
            ')'
        );
      }
    } else if (attrs.length) {
      this.attrs(attrs, true);
    }
  },

  /**
   * Compile attributes.
   */

  attrs: function(attrs, buffer) {
    var res = compileAttrs(attrs, {
      terse: this.terse,
      format: buffer ? 'html' : 'object',
      runtime: this.runtime.bind(this),
    });
    if (buffer) {
      this.bufferExpression(res);
    }
    return res;
  },

  /**
   * Compile attribute blocks.
   */

  attributeBlocks: function(attributeBlocks) {
    return (
      attributeBlocks &&
      attributeBlocks.slice().map(function(attrBlock) {
        return attrBlock.val;
      })
    );
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
