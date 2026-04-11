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

describe('SVG void elements', () => {
  test('rect is self-closing', () => {
    var attrs = [
      {name: 'x', val: '0', line: 1, column: 1, mustEscape: false},
      {name: 'y', val: '0', line: 1, column: 1, mustEscape: false},
      {name: 'width', val: '100', line: 1, column: 1, mustEscape: false},
      {name: 'height', val: '50', line: 1, column: 1, mustEscape: false},
    ];
    assert.strictEqual(
      render(block([tag('rect', attrs)])),
      '<!DOCTYPE html><rect x="0" y="0" width="100" height="50">'
    );
  });

  test('circle is self-closing', () => {
    var attrs = [
      {name: 'cx', val: '50', line: 1, column: 1, mustEscape: false},
      {name: 'cy', val: '50', line: 1, column: 1, mustEscape: false},
      {name: 'r', val: '25', line: 1, column: 1, mustEscape: false},
    ];
    assert.strictEqual(
      render(block([tag('circle', attrs)])),
      '<!DOCTYPE html><circle cx="50" cy="50" r="25">'
    );
  });

  test('line is self-closing', () => {
    var attrs = [
      {name: 'x1', val: '0', line: 1, column: 1, mustEscape: false},
      {name: 'y1', val: '0', line: 1, column: 1, mustEscape: false},
      {name: 'x2', val: '100', line: 1, column: 1, mustEscape: false},
      {name: 'y2', val: '100', line: 1, column: 1, mustEscape: false},
    ];
    assert.strictEqual(
      render(block([tag('line', attrs)])),
      '<!DOCTYPE html><line x1="0" y1="0" x2="100" y2="100">'
    );
  });

  test('path is self-closing', () => {
    var attrs = [{name: 'd', val: 'M0 0 L100 100', line: 1, column: 1, mustEscape: false}];
    assert.strictEqual(
      render(block([tag('path', attrs)])),
      '<!DOCTYPE html><path d="M0 0 L100 100">'
    );
  });

  test('SVG container elements are NOT self-closing', () => {
    assert.strictEqual(
      render(block([tag('svg', [], [tag('rect')])])),
      '<!DOCTYPE html><svg><rect></svg>'
    );
    assert.strictEqual(
      render(block([tag('g', [], [tag('circle')])])),
      '<!DOCTYPE html><g><circle></g>'
    );
    assert.strictEqual(
      render(block([tag('text', [], [text('hello')])])),
      '<!DOCTYPE html><text>hello</text>'
    );
    assert.strictEqual(
      render(block([tag('use', [{name: 'href', val: '#icon', line: 1, column: 1, mustEscape: false}], [text('')])])),
      '<!DOCTYPE html><use href="#icon"></use>'
    );
    assert.strictEqual(
      render(block([tag('image', [{name: 'href', val: 'pic.png', line: 1, column: 1, mustEscape: false}], [text('')])])),
      '<!DOCTYPE html><image href="pic.png"></image>'
    );
  });

  test('SVG void element with content throws VOID_ELEMENT_WITH_CONTENT', () => {
    assert.throws(
      () => render(block([tag('rect', [], [text('content')])])),
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
      args: [{name: 'name'}],
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
      args: [{name: 'x'}],
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

  test('too many arguments throws MIXIN_ARGUMENT_COUNT_MISMATCH', () => {
    var declaration = {
      type: 'Mixin',
      name: 'greet',
      call: false,
      args: [{name: 'a'}],
      block: block([]),
      line: 1,
      column: 1,
      filename: 'test',
    };
    var call = {
      type: 'Mixin',
      name: 'greet',
      call: true,
      args: ['one', 'two'],
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

describe('variables in attributes', () => {
  test('resolves #{var} in attribute value inside mixin', () => {
    var declaration = {
      type: 'Mixin',
      name: 'link',
      call: false,
      args: [{name: 'url'}],
      block: block([tag('a', [{name: 'href', val: '#{url}', line: 1, column: 1, mustEscape: false}], [text('click')])]),
      line: 1,
      column: 1,
      filename: 'test',
    };
    var call = {
      type: 'Mixin',
      name: 'link',
      call: true,
      args: ['/home'],
      block: block([]),
      line: 2,
      column: 1,
      filename: 'test',
    };
    assert.strictEqual(
      render(block([declaration, call])),
      '<!DOCTYPE html><a href="/home">click</a>'
    );
  });

  test('resolves multiple #{var} in one attribute', () => {
    var declaration = {
      type: 'Mixin',
      name: 'test',
      call: false,
      args: [{name: 'a'}, {name: 'b'}],
      block: block([tag('div', [{name: 'data-x', val: '#{a}-#{b}', line: 1, column: 1, mustEscape: false}])]),
      line: 1,
      column: 1,
      filename: 'test',
    };
    var call = {
      type: 'Mixin',
      name: 'test',
      call: true,
      args: ['hello', 'world'],
      block: block([]),
      line: 2,
      column: 1,
      filename: 'test',
    };
    assert.strictEqual(
      render(block([declaration, call])),
      '<!DOCTYPE html><div data-x="hello-world"></div>'
    );
  });

  test('escaped \\#{var} passes through as literal', () => {
    var declaration = {
      type: 'Mixin',
      name: 'test',
      call: false,
      args: [{name: 'x'}],
      block: block([tag('div', [{name: 'data-t', val: '\\#{x}', line: 1, column: 1, mustEscape: false}])]),
      line: 1,
      column: 1,
      filename: 'test',
    };
    var call = {
      type: 'Mixin',
      name: 'test',
      call: true,
      args: ['val'],
      block: block([]),
      line: 2,
      column: 1,
      filename: 'test',
    };
    assert.strictEqual(
      render(block([declaration, call])),
      '<!DOCTYPE html><div data-t="#{x}"></div>'
    );
  });

  test('#{var} in class attribute is resolved', () => {
    var declaration = {
      type: 'Mixin',
      name: 'test',
      call: false,
      args: [{name: 'cls'}],
      block: block([tag('div', [{name: 'class', val: 'item-#{cls}', line: 1, column: 1, mustEscape: false}])]),
      line: 1,
      column: 1,
      filename: 'test',
    };
    var call = {
      type: 'Mixin',
      name: 'test',
      call: true,
      args: ['active'],
      block: block([]),
      line: 2,
      column: 1,
      filename: 'test',
    };
    assert.strictEqual(
      render(block([declaration, call])),
      '<!DOCTYPE html><div class="item-active"></div>'
    );
  });

  test('#{var} outside mixin throws CALL_STACK_UNDERFLOW', () => {
    assert.throws(
      () => render(block([tag('div', [{name: 'x', val: '#{oops}', line: 1, column: 1, mustEscape: false}])])),
      (err) => err.code === 'PUGNEUM:CALL_STACK_UNDERFLOW'
    );
  });

  test('undefined #{var} in attribute throws UNDEFINED_VARIABLE', () => {
    var declaration = {
      type: 'Mixin',
      name: 'test',
      call: false,
      args: [],
      block: block([tag('div', [{name: 'x', val: '#{missing}', line: 1, column: 1, mustEscape: false}])]),
      line: 1,
      column: 1,
      filename: 'test',
    };
    var call = {
      type: 'Mixin',
      name: 'test',
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

  test('attribute without #{} is not affected', () => {
    assert.strictEqual(
      render(block([tag('a', [{name: 'href', val: '/static', line: 1, column: 1, mustEscape: false}], [text('link')])])),
      '<!DOCTYPE html><a href="/static">link</a>'
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

  test('recursive mixin throws RECURSIVE_MIXIN', () => {
    // mixin loop calls +loop
    var call = mixinCall('loop', []);
    var decl = mixinDecl('loop', [], [call]);
    assert.throws(
      () => render(block([decl, mixinCall('loop', [])])),
      (err) => err.code === 'PUGNEUM:RECURSIVE_MIXIN' && /Recursive call to mixin 'loop'/.test(err.message)
    );
  });

  test('mutual recursion throws RECURSIVE_MIXIN', () => {
    // mixin a calls +b, mixin b calls +a
    var declA = mixinDecl('a', [], [mixinCall('b', [])]);
    var declB = mixinDecl('b', [], [mixinCall('a', [])]);
    assert.throws(
      () => render(block([declA, declB, mixinCall('a', [])])),
      (err) => err.code === 'PUGNEUM:RECURSIVE_MIXIN'
    );
  });
});

// Helper: mixin declaration node
function mixinDecl(name, args, children) {
  return {
    type: 'Mixin',
    name: name,
    call: false,
    args: args,
    block: block(children || []),
    line: 1,
    column: 1,
    filename: 'test',
  };
}

// Helper: mixin call node
function mixinCall(name, args, children) {
  return {
    type: 'Mixin',
    name: name,
    call: true,
    args: args,
    block: children ? block(children) : null,
    line: 2,
    column: 1,
    filename: 'test',
  };
}

// Helper: variable node
function variable(name) {
  return {type: 'Variable', name: name, line: 1, column: 1, filename: 'test'};
}

// Helper: attribute
function attr(name, val) {
  return {name: name, val: val, line: 1, column: 1, mustEscape: false};
}

describe('optional arguments', () => {
  test('omitted trailing args produce no text output', () => {
    var decl = mixinDecl('greet', [{name: 'name'}, {name: 'title'}], [
      tag('p', [], [variable('title'), text(' '), variable('name')]),
    ]);
    var call = mixinCall('greet', ['Alice']);
    assert.strictEqual(
      render(block([decl, call])),
      '<!DOCTYPE html><p> Alice</p>'
    );
  });

  test('omitted arg with default uses default value', () => {
    var decl = mixinDecl('greet', [{name: 'name'}, {name: 'title', default: 'friend'}], [
      tag('p', [], [text('Hello, '), variable('title'), text(' '), variable('name')]),
    ]);
    var call = mixinCall('greet', ['Alice']);
    assert.strictEqual(
      render(block([decl, call])),
      '<!DOCTYPE html><p>Hello, friend Alice</p>'
    );
  });

  test('explicit arg overrides default', () => {
    var decl = mixinDecl('greet', [{name: 'name'}, {name: 'title', default: 'friend'}], [
      tag('p', [], [variable('title'), text(' '), variable('name')]),
    ]);
    var call = mixinCall('greet', ['Alice', 'Doctor']);
    assert.strictEqual(
      render(block([decl, call])),
      '<!DOCTYPE html><p>Doctor Alice</p>'
    );
  });

  test('all args can be omitted', () => {
    var decl = mixinDecl('empty', [{name: 'a'}, {name: 'b'}], [
      tag('p', [], [variable('a'), variable('b')]),
    ]);
    var call = mixinCall('empty', []);
    assert.strictEqual(
      render(block([decl, call])),
      '<!DOCTYPE html><p></p>'
    );
  });

  test('all defaults used when no args provided', () => {
    var decl = mixinDecl('defaults', [{name: 'a', default: 'x'}, {name: 'b', default: 'y'}], [
      tag('p', [], [variable('a'), text('-'), variable('b')]),
    ]);
    var call = mixinCall('defaults', []);
    assert.strictEqual(
      render(block([decl, call])),
      '<!DOCTYPE html><p>x-y</p>'
    );
  });

  test('too many args still throws MIXIN_ARGUMENT_COUNT_MISMATCH', () => {
    var decl = mixinDecl('m', [{name: 'a'}], []);
    var call = mixinCall('m', ['one', 'two', 'three']);
    assert.throws(
      () => render(block([decl, call])),
      (err) => err.code === 'PUGNEUM:MIXIN_ARGUMENT_COUNT_MISMATCH'
    );
  });

  test('explicit empty string overrides default', () => {
    var decl = mixinDecl('m', [{name: 'x', default: 'fallback'}], [
      tag('p', [], [variable('x')]),
    ]);
    var call = mixinCall('m', ['']);
    assert.strictEqual(
      render(block([decl, call])),
      '<!DOCTYPE html><p></p>'
    );
  });

  test('default with empty string default', () => {
    var decl = mixinDecl('m', [{name: 'x', default: ''}], [
      tag('p', [], [variable('x')]),
    ]);
    var call = mixinCall('m', []);
    assert.strictEqual(
      render(block([decl, call])),
      '<!DOCTYPE html><p></p>'
    );
  });
});

describe('optional arguments and attributes', () => {
  test('null variable omits entire attribute', () => {
    var decl = mixinDecl('link', [{name: 'href'}, {name: 'target'}], [
      tag('a', [attr('href', '#{href}'), attr('target', '#{target}')], [text('click')]),
    ]);
    var call = mixinCall('link', ['/page']);
    assert.strictEqual(
      render(block([decl, call])),
      '<!DOCTYPE html><a href="/page">click</a>'
    );
  });

  test('null variable in composite attribute omits entire attribute', () => {
    var decl = mixinDecl('icon', [{name: 'name'}, {name: 'size'}], [
      tag('img', [attr('src', '/icons/#{name}.svg'), attr('class', 'icon-#{size}')]),
    ]);
    var call = mixinCall('icon', ['arrow']);
    assert.strictEqual(
      render(block([decl, call])),
      '<!DOCTYPE html><img src="/icons/arrow.svg">'
    );
  });

  test('default value used in attribute', () => {
    var decl = mixinDecl('link', [{name: 'href'}, {name: 'target', default: '_blank'}], [
      tag('a', [attr('href', '#{href}'), attr('target', '#{target}')], [text('click')]),
    ]);
    var call = mixinCall('link', ['/page']);
    assert.strictEqual(
      render(block([decl, call])),
      '<!DOCTYPE html><a href="/page" target="_blank">click</a>'
    );
  });

  test('provided arg overrides default in attribute', () => {
    var decl = mixinDecl('link', [{name: 'href'}, {name: 'target', default: '_blank'}], [
      tag('a', [attr('href', '#{href}'), attr('target', '#{target}')], [text('click')]),
    ]);
    var call = mixinCall('link', ['/page', '_self']);
    assert.strictEqual(
      render(block([decl, call])),
      '<!DOCTYPE html><a href="/page" target="_self">click</a>'
    );
  });

  test('null class contribution is skipped, others preserved', () => {
    var decl = mixinDecl('item', [{name: 'kind'}], [
      tag('div', [attr('class', 'base'), attr('class', 'kind-#{kind}')], [text('hi')]),
    ]);
    var call = mixinCall('item', []);
    assert.strictEqual(
      render(block([decl, call])),
      '<!DOCTYPE html><div class="base">hi</div>'
    );
  });

  test('all class contributions null omits class attribute', () => {
    var decl = mixinDecl('item', [{name: 'a'}, {name: 'b'}], [
      tag('div', [attr('class', '#{a}'), attr('class', '#{b}')], [text('hi')]),
    ]);
    var call = mixinCall('item', []);
    assert.strictEqual(
      render(block([decl, call])),
      '<!DOCTYPE html><div>hi</div>'
    );
  });

  test('boolean attributes unaffected by optional args', () => {
    var decl = mixinDecl('input', [{name: 'type'}], [
      tag('input', [attr('type', '#{type}'), attr('disabled', true)]),
    ]);
    var call = mixinCall('input', []);
    assert.strictEqual(
      render(block([decl, call])),
      '<!DOCTYPE html><input disabled>'
    );
  });

  test('static attributes unaffected when variable attribute omitted', () => {
    var decl = mixinDecl('m', [{name: 'x'}], [
      tag('div', [attr('id', 'fixed'), attr('data-x', '#{x}')], [text('content')]),
    ]);
    var call = mixinCall('m', []);
    assert.strictEqual(
      render(block([decl, call])),
      '<!DOCTYPE html><div id="fixed">content</div>'
    );
  });

  test('undeclared variable still throws UNDEFINED_VARIABLE', () => {
    var decl = mixinDecl('m', [{name: 'x'}], [
      tag('p', [], [variable('typo')]),
    ]);
    var call = mixinCall('m', ['val']);
    assert.throws(
      () => render(block([decl, call])),
      (err) => err.code === 'PUGNEUM:UNDEFINED_VARIABLE'
    );
  });

  test('undeclared variable in attribute still throws UNDEFINED_VARIABLE', () => {
    var decl = mixinDecl('m', [{name: 'x'}], [
      tag('div', [attr('data-x', '#{typo}')]),
    ]);
    var call = mixinCall('m', ['val']);
    assert.throws(
      () => render(block([decl, call])),
      (err) => err.code === 'PUGNEUM:UNDEFINED_VARIABLE'
    );
  });

  test('null variable does not leak through prototypal inheritance', () => {
    // Inner mixin has param 'x' not provided (null).
    // Outer mixin has param 'x' provided.
    // Inner's null should NOT fall through to outer's value.
    var inner = mixinDecl('inner', [{name: 'x'}], [
      tag('span', [], [variable('x')]),
    ]);
    var outer = mixinDecl('outer', [{name: 'x'}], [
      mixinCall('inner', []),
    ]);
    outer.line = 2;
    var call = mixinCall('outer', ['hello']);
    call.line = 3;
    assert.strictEqual(
      render(block([inner, outer, call])),
      '<!DOCTYPE html><span></span>'
    );
  });
});
