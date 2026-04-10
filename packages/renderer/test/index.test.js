'use strict';

var assert = require('node:assert/strict');
var {describe, test} = require('node:test');
var render = require('../');

// Helper: minimal Block wrapper
function block(nodes) {
  return {type: 'Block', nodes: nodes, line: 1, filename: 'test'};
}

// Helper: Tag node
function tag(name, attrs, children, opts) {
  return Object.assign({
    type: 'Tag',
    name: name,
    attrs: attrs || [],
    attributeBlocks: [],
    block: block(children || []),
    isInline: false,
    line: 1,
    column: 1,
    filename: 'test',
  }, opts);
}

// Helper: Text node
function text(val) {
  return {type: 'Text', val: val, line: 1, column: 1, filename: 'test'};
}

describe('basic rendering', () => {
  test('empty block', () => {
    assert.strictEqual(render(block([])), '<!DOCTYPE html>');
  });

  test('text node', () => {
    assert.strictEqual(render(block([text('hello')])), '<!DOCTYPE html>hello');
  });

  test('tag with text', () => {
    assert.strictEqual(
      render(block([tag('p', [], [text('hi')])])),
      '<!DOCTYPE html><p>hi</p>'
    );
  });

  test('nested tags', () => {
    assert.strictEqual(
      render(block([tag('div', [], [tag('span', [], [text('x')])])])),
      '<!DOCTYPE html><div><span>x</span></div>'
    );
  });
});

describe('attributes', () => {
  test('string attribute', () => {
    var attrs = [{name: 'href', val: '/home', line: 1, column: 1, mustEscape: false}];
    assert.strictEqual(
      render(block([tag('a', attrs, [text('link')])])),
      '<!DOCTYPE html><a href="/home">link</a>'
    );
  });

  test('boolean attribute', () => {
    var attrs = [{name: 'disabled', val: true, line: 1, column: 1, mustEscape: false}];
    assert.strictEqual(
      render(block([tag('input', attrs)])),
      '<!DOCTYPE html><input disabled>'
    );
  });

  test('multiple classes joined with spaces', () => {
    var attrs = [
      {name: 'class', val: 'a', line: 1, column: 1, mustEscape: false},
      {name: 'class', val: 'b', line: 1, column: 1, mustEscape: false},
    ];
    assert.strictEqual(
      render(block([tag('div', attrs)])),
      '<!DOCTYPE html><div class="a b"></div>'
    );
  });

  test('quotes in attribute values are escaped', () => {
    var attrs = [{name: 'title', val: 'say "hello"', line: 1, column: 1, mustEscape: false}];
    assert.strictEqual(
      render(block([tag('span', attrs, [text('x')])])),
      '<!DOCTYPE html><span title="say &quot;hello&quot;">x</span>'
    );
  });

  test('quotes in class values are escaped', () => {
    var attrs = [{name: 'class', val: 'a"b', line: 1, column: 1, mustEscape: false}];
    assert.strictEqual(
      render(block([tag('div', attrs)])),
      '<!DOCTYPE html><div class="a&quot;b"></div>'
    );
  });
});

describe('void elements', () => {
  test('self-closing by tag name', () => {
    assert.strictEqual(
      render(block([tag('br')])),
      '<!DOCTYPE html><br>'
    );
    assert.strictEqual(
      render(block([tag('hr')])),
      '<!DOCTYPE html><hr>'
    );
    assert.strictEqual(
      render(block([tag('img')])),
      '<!DOCTYPE html><img>'
    );
  });

  test('self-closing by property', () => {
    assert.strictEqual(
      render(block([tag('custom', [], [], {selfClosing: true})])),
      '<!DOCTYPE html><custom>'
    );
  });

  test('void element with whitespace-only content is allowed', () => {
    assert.strictEqual(
      render(block([tag('br', [], [text('  ')])])),
      '<!DOCTYPE html><br>'
    );
  });

  test('void element with content throws VOID_ELEMENT_WITH_CONTENT', () => {
    assert.throws(
      () => render(block([tag('br', [], [text('content')])])),
      (err) => err.code === 'PUGNEUM:VOID_ELEMENT_WITH_CONTENT'
    );
  });
});

describe('comments', () => {
  test('buffered comment', () => {
    var node = {type: 'Comment', val: ' hello ', buffer: true, line: 1, filename: 'test'};
    assert.strictEqual(
      render(block([node])),
      '<!DOCTYPE html><!-- hello -->'
    );
  });

  test('unbuffered comment produces no output', () => {
    var node = {type: 'Comment', val: ' hidden ', buffer: false, line: 1, filename: 'test'};
    assert.strictEqual(
      render(block([node])),
      '<!DOCTYPE html>'
    );
  });

  test('buffered block comment', () => {
    var node = {
      type: 'BlockComment',
      val: ' start ',
      buffer: true,
      block: block([text('body')]),
      line: 1,
      filename: 'test',
    };
    assert.strictEqual(
      render(block([node])),
      '<!DOCTYPE html><!-- start body-->'
    );
  });

  test('unbuffered block comment produces no output', () => {
    var node = {
      type: 'BlockComment',
      val: ' hidden ',
      buffer: false,
      block: block([text('body')]),
      line: 1,
      filename: 'test',
    };
    assert.strictEqual(
      render(block([node])),
      '<!DOCTYPE html>'
    );
  });

  test('block comment with empty val', () => {
    var node = {
      type: 'BlockComment',
      val: '',
      buffer: true,
      block: block([text('content')]),
      line: 1,
      filename: 'test',
    };
    assert.strictEqual(
      render(block([node])),
      '<!DOCTYPE html><!--content-->'
    );
  });
});

describe('mixins', () => {
  test('declaration and call', () => {
    var declaration = {
      type: 'Mixin',
      name: 'greeting',
      call: false,
      args: ['name'],
      block: block([
        tag('p', [], [{type: 'Variable', name: 'name', line: 1, column: 1, filename: 'test'}]),
      ]),
      line: 1,
      column: 1,
      filename: 'test',
    };
    var call = {
      type: 'Mixin',
      name: 'greeting',
      call: true,
      args: ['world'],
      block: block([]),
      line: 2,
      column: 1,
      filename: 'test',
    };
    assert.strictEqual(
      render(block([declaration, call])),
      '<!DOCTYPE html><p>world</p>'
    );
  });

  test('mixin with no args', () => {
    var declaration = {
      type: 'Mixin',
      name: 'hr',
      call: false,
      args: [],
      block: block([tag('hr')]),
      line: 1,
      column: 1,
      filename: 'test',
    };
    var call = {
      type: 'Mixin',
      name: 'hr',
      call: true,
      args: [],
      block: block([]),
      line: 2,
      column: 1,
      filename: 'test',
    };
    assert.strictEqual(
      render(block([declaration, call])),
      '<!DOCTYPE html><hr>'
    );
  });

  test('mixin block (caller content)', () => {
    var declaration = {
      type: 'Mixin',
      name: 'wrapper',
      call: false,
      args: [],
      block: block([
        tag('div', [], [{type: 'MixinBlock', line: 1, column: 1, filename: 'test'}]),
      ]),
      line: 1,
      column: 1,
      filename: 'test',
    };
    var call = {
      type: 'Mixin',
      name: 'wrapper',
      call: true,
      args: [],
      block: block([text('inside')]),
      line: 2,
      column: 1,
      filename: 'test',
    };
    assert.strictEqual(
      render(block([declaration, call])),
      '<!DOCTYPE html><div>inside</div>'
    );
  });

  test('nested mixin calls inherit parent environment', () => {
    var inner = {
      type: 'Mixin',
      name: 'inner',
      call: false,
      args: [],
      block: block([{type: 'Variable', name: 'x', line: 1, column: 1, filename: 'test'}]),
      line: 1,
      column: 1,
      filename: 'test',
    };
    var outer = {
      type: 'Mixin',
      name: 'outer',
      call: false,
      args: ['x'],
      block: block([{
        type: 'Mixin',
        name: 'inner',
        call: true,
        args: [],
        block: block([]),
        line: 3,
        column: 1,
        filename: 'test',
      }]),
      line: 2,
      column: 1,
      filename: 'test',
    };
    var call = {
      type: 'Mixin',
      name: 'outer',
      call: true,
      args: ['hello'],
      block: block([]),
      line: 4,
      column: 1,
      filename: 'test',
    };
    assert.strictEqual(
      render(block([inner, outer, call])),
      '<!DOCTYPE html>hello'
    );
  });
});

describe('mixin errors', () => {
  test('undefined mixin throws UNDEFINED_MIXIN', () => {
    var call = {
      type: 'Mixin',
      name: 'nonexistent',
      call: true,
      args: [],
      block: block([]),
      line: 1,
      column: 1,
      filename: 'test',
    };
    assert.throws(
      () => render(block([call])),
      (err) => err.code === 'PUGNEUM:UNDEFINED_MIXIN'
    );
  });

  test('argument count mismatch throws MIXIN_ARGUMENT_COUNT_MISMATCH', () => {
    var declaration = {
      type: 'Mixin',
      name: 'greet',
      call: false,
      args: ['a', 'b'],
      block: block([]),
      line: 1,
      column: 1,
      filename: 'test',
    };
    var call = {
      type: 'Mixin',
      name: 'greet',
      call: true,
      args: ['only-one'],
      block: block([]),
      line: 2,
      column: 1,
      filename: 'test',
    };
    assert.throws(
      () => render(block([declaration, call])),
      (err) => err.code === 'PUGNEUM:MIXIN_ARGUMENT_COUNT_MISMATCH'
    );
  });
});

describe('variable errors', () => {
  test('variable outside mixin throws CALL_STACK_UNDERFLOW', () => {
    var variable = {type: 'Variable', name: 'x', line: 1, column: 1, filename: 'test'};
    assert.throws(
      () => render(block([variable])),
      (err) => err.code === 'PUGNEUM:CALL_STACK_UNDERFLOW'
    );
  });

  test('undefined variable throws UNDEFINED_VARIABLE', () => {
    var declaration = {
      type: 'Mixin',
      name: 'm',
      call: false,
      args: [],
      block: block([{type: 'Variable', name: 'missing', line: 1, column: 1, filename: 'test'}]),
      line: 1,
      column: 1,
      filename: 'test',
    };
    var call = {
      type: 'Mixin',
      name: 'm',
      call: true,
      args: [],
      block: block([]),
      line: 2,
      column: 1,
      filename: 'test',
    };
    assert.throws(
      () => render(block([declaration, call])),
      (err) => err.code === 'PUGNEUM:UNDEFINED_VARIABLE'
    );
  });
});

describe('interpolated tags', () => {
  test('renders like a normal tag using expr as name', () => {
    var node = {
      type: 'InterpolatedTag',
      expr: 'em',
      attrs: [],
      attributeBlocks: [],
      block: block([text('stressed')]),
      selfClosing: false,
      isInline: true,
      line: 1,
      column: 1,
      filename: 'test',
    };
    assert.strictEqual(
      render(block([node])),
      '<!DOCTYPE html><em>stressed</em>'
    );
  });

  test('self-closing interpolated tag', () => {
    var node = {
      type: 'InterpolatedTag',
      expr: 'br',
      attrs: [],
      attributeBlocks: [],
      block: block([]),
      selfClosing: false,
      isInline: false,
      line: 1,
      column: 1,
      filename: 'test',
    };
    assert.strictEqual(
      render(block([node])),
      '<!DOCTYPE html><br>'
    );
  });
});

describe('yield block', () => {
  test('produces no output', () => {
    var node = {type: 'YieldBlock', line: 1, filename: 'test'};
    assert.strictEqual(
      render(block([node])),
      '<!DOCTYPE html>'
    );
  });
});

describe('named block', () => {
  test('renders child nodes', () => {
    var node = {
      type: 'NamedBlock',
      name: 'content',
      mode: 'replace',
      nodes: [text('block content')],
      line: 1,
      filename: 'test',
    };
    assert.strictEqual(
      render(block([node])),
      '<!DOCTYPE html>block content'
    );
  });
});

describe('error handling', () => {
  test('null node throws TypeError', () => {
    assert.throws(
      () => render(block([null])),
      (err) => err instanceof TypeError && /is null/.test(err.message)
    );
  });

  test('undefined node throws TypeError', () => {
    assert.throws(
      () => render(block([undefined])),
      (err) => err instanceof TypeError && /is undefined/.test(err.message)
    );
  });

  test('unsupported node type throws TypeError', () => {
    var node = {type: 'Filter', name: 'x', line: 1, filename: 'test'};
    assert.throws(
      () => render(block([node])),
      (err) => err instanceof TypeError && /pugneum-filterer/.test(err.message)
    );
  });

  test('unsupported Extends node suggests pugneum-linker', () => {
    var node = {type: 'Extends', line: 1, filename: 'test'};
    assert.throws(
      () => render(block([node])),
      (err) => err instanceof TypeError && /pugneum-linker/.test(err.message)
    );
  });
});
