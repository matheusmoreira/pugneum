'use strict';

var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var {describe, test} = require('node:test');
var render = require('../');

var packageRoot = path.resolve(__dirname, '..');

// Helper: minimal Block wrapper
function block(nodes) {
  return {type: 'Block', nodes: nodes, line: 1, filename: 'test'};
}

// Helper: Tag node
function tag(name, attrs, children, opts) {
  return Object.assign(
    {
      type: 'Tag',
      name: name,
      attrs: attrs || [],
      attributeBlocks: [],
      block: block(children || []),
      isInline: false,
      line: 1,
      column: 1,
      filename: 'test',
    },
    opts,
  );
}

// Helper: Text node
function text(val) {
  return {type: 'Text', val: val, line: 1, column: 1, filename: 'test'};
}

function footnoteBody(nodes) {
  return Object.assign(block(nodes), {isFootnoteBody: true});
}

function footnoteSeparator() {
  return Object.assign(text(' '), {isFootnoteSeparator: true});
}

// Helper: NamedBlock node
function namedBlock(name, mode, nodes) {
  return {
    type: 'NamedBlock',
    name: name,
    mode: mode,
    nodes: nodes || [],
    line: 1,
    column: 1,
    filename: 'test',
  };
}

// Helper: Mixin definition node
function mixinDef(name, args, body, opts) {
  return Object.assign(
    {
      type: 'Mixin',
      name: name,
      args: args || [],
      block: block(body || []),
      call: false,
      usesNamedBlocks: false,
      usesUnnamedBlock: false,
      line: 1,
      column: 1,
      filename: 'test',
    },
    opts,
  );
}

// Helper: Mixin call node (with opts support)
function mixinCallOpts(name, args, children, opts) {
  return Object.assign(
    {
      type: 'Mixin',
      name: name,
      args: args || [],
      block: children ? block(children) : null,
      call: true,
      attrs: [],
      attributeBlocks: [],
      line: 2,
      column: 1,
      filename: 'test',
    },
    opts,
  );
}

describe('warnings option validation', () => {
  function invalidCollectors() {
    const fixedLength = [];
    Object.defineProperty(fixedLength, 'length', {writable: false});
    return [{}, {push() {}}, new Set(), Object.freeze([]), fixedLength];
  }

  function assertInvalidCollector(node, warnings) {
    assert.throws(
      () => render(node, {filename: 'test', warnings}),
      (err) =>
        err.code === undefined &&
        err.message === 'Expected "options.warnings" to be a mutable array',
    );
  }

  test('invalid collectors fail before warning-free nodes are rendered', () => {
    invalidCollectors().forEach((warnings) => {
      assertInvalidCollector(block([text('clean')]), warnings);
    });
  });

  test('warning-producing nodes get the same construction error', () => {
    invalidCollectors().forEach((warnings) => {
      assertInvalidCollector(mixinDef('unused', [], [text('body')]), warnings);
    });
  });

  test('an extensible array remains the caller-owned collector', () => {
    const warnings = [];

    render(mixinDef('unused', [], [text('body')]), {
      filename: 'test',
      warnings,
    });

    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].code, 'PUGNEUM:UNUSED_MIXIN');
  });
});

describe('basic rendering', () => {
  test('empty block', () => {
    assert.strictEqual(render(block([])), '');
  });

  test('text node', () => {
    assert.strictEqual(render(block([text('hello')])), 'hello');
  });

  test('tag with text', () => {
    assert.strictEqual(
      render(block([tag('p', [], [text('hi')])])),
      '<p>hi</p>',
    );
  });

  test('nested tags', () => {
    assert.strictEqual(
      render(block([tag('div', [], [tag('span', [], [text('x')])])])),
      '<div><span>x</span></div>',
    );
  });
});

describe('footnote line joining', () => {
  test('joins only segments that produce meaningful output', () => {
    assert.strictEqual(
      render(
        footnoteBody([
          footnoteSeparator(),
          text('  '),
          footnoteSeparator(),
          text('first'),
          footnoteSeparator(),
          text(''),
          footnoteSeparator(),
          text('last'),
          footnoteSeparator(),
        ]),
      ),
      'first last',
    );
  });

  test('waits for optional mixin variables to resolve', () => {
    const declaration = mixinDef(
      'note',
      [{name: 'value'}],
      [
        footnoteBody([
          {
            type: 'Variable',
            name: 'value',
            line: 1,
            column: 1,
            filename: 'test',
          },
          footnoteSeparator(),
          text('continuation'),
        ]),
      ],
    );

    assert.strictEqual(
      render(block([declaration, mixinCallOpts('note', [])])),
      'continuation',
    );
    assert.strictEqual(
      render(block([declaration, mixinCallOpts('note', ['first'])])),
      'first continuation',
    );
  });
});

describe('attributes', () => {
  test('string attribute', () => {
    var attrs = [{name: 'href', val: '/home', line: 1, column: 1}];
    assert.strictEqual(
      render(block([tag('a', attrs, [text('link')])])),
      '<a href="/home">link</a>',
    );
  });

  test('boolean attribute', () => {
    var attrs = [{name: 'disabled', val: true, line: 1, column: 1}];
    assert.strictEqual(
      render(block([tag('input', attrs)])),
      '<input disabled>',
    );
  });

  test('multiple classes joined with spaces', () => {
    var attrs = [
      {name: 'class', val: 'a', line: 1, column: 1},
      {name: 'class', val: 'b', line: 1, column: 1},
    ];
    assert.strictEqual(
      render(block([tag('div', attrs)])),
      '<div class="a b"></div>',
    );
  });

  test('quotes in attribute values are escaped', () => {
    var attrs = [
      {
        name: 'title',
        val: 'say "hello"',
        line: 1,
        column: 1,
      },
    ];
    assert.strictEqual(
      render(block([tag('span', attrs, [text('x')])])),
      '<span title="say &quot;hello&quot;">x</span>',
    );
  });

  test('quotes in class values are escaped', () => {
    var attrs = [{name: 'class', val: 'a"b', line: 1, column: 1}];
    assert.strictEqual(
      render(block([tag('div', attrs)])),
      '<div class="a&quot;b"></div>',
    );
  });
});

describe('void elements', () => {
  test('self-closing by tag name', () => {
    assert.strictEqual(render(block([tag('br')])), '<br>');
    assert.strictEqual(render(block([tag('hr')])), '<hr>');
    assert.strictEqual(render(block([tag('img')])), '<img>');
  });

  test('self-closing by property', () => {
    assert.strictEqual(
      render(block([tag('custom', [], [], {selfClosing: true})])),
      '<custom>',
    );
  });

  test('void element with whitespace-only content is allowed', () => {
    assert.strictEqual(render(block([tag('br', [], [text('  ')])])), '<br>');
  });

  test('void element with content throws VOID_ELEMENT_WITH_CONTENT', () => {
    assert.throws(
      () => render(block([tag('br', [], [text('content')])])),
      (err) => err.code === 'PUGNEUM:VOID_ELEMENT_WITH_CONTENT',
    );
  });
});

describe('SVG void elements', () => {
  test('rect is self-closing', () => {
    var attrs = [
      {name: 'x', val: '0', line: 1, column: 1},
      {name: 'y', val: '0', line: 1, column: 1},
      {name: 'width', val: '100', line: 1, column: 1},
      {name: 'height', val: '50', line: 1, column: 1},
    ];
    assert.strictEqual(
      render(block([tag('rect', attrs)])),
      '<rect x="0" y="0" width="100" height="50" />',
    );
  });

  test('circle is self-closing', () => {
    var attrs = [
      {name: 'cx', val: '50', line: 1, column: 1},
      {name: 'cy', val: '50', line: 1, column: 1},
      {name: 'r', val: '25', line: 1, column: 1},
    ];
    assert.strictEqual(
      render(block([tag('circle', attrs)])),
      '<circle cx="50" cy="50" r="25" />',
    );
  });

  test('line is self-closing', () => {
    var attrs = [
      {name: 'x1', val: '0', line: 1, column: 1},
      {name: 'y1', val: '0', line: 1, column: 1},
      {name: 'x2', val: '100', line: 1, column: 1},
      {name: 'y2', val: '100', line: 1, column: 1},
    ];
    assert.strictEqual(
      render(block([tag('line', attrs)])),
      '<line x1="0" y1="0" x2="100" y2="100" />',
    );
  });

  test('path is self-closing', () => {
    var attrs = [{name: 'd', val: 'M0 0 L100 100', line: 1, column: 1}];
    assert.strictEqual(
      render(block([tag('path', attrs)])),
      '<path d="M0 0 L100 100" />',
    );
  });

  test('SVG container elements are NOT self-closing', () => {
    assert.strictEqual(
      render(block([tag('svg', [], [tag('rect')])])),
      '<svg><rect /></svg>',
    );
    assert.strictEqual(
      render(block([tag('g', [], [tag('circle')])])),
      '<g><circle /></g>',
    );
    assert.strictEqual(
      render(block([tag('text', [], [text('hello')])])),
      '<text>hello</text>',
    );
    assert.strictEqual(
      render(
        block([
          tag(
            'use',
            [
              {
                name: 'href',
                val: '#icon',
                line: 1,
                column: 1,
              },
            ],
            [text('')],
          ),
        ]),
      ),
      '<use href="#icon"></use>',
    );
    assert.strictEqual(
      render(
        block([
          tag(
            'image',
            [
              {
                name: 'href',
                val: 'pic.png',
                line: 1,
                column: 1,
              },
            ],
            [text('')],
          ),
        ]),
      ),
      '<image href="pic.png"></image>',
    );
  });

  test('SVG void element with content throws VOID_ELEMENT_WITH_CONTENT', () => {
    assert.throws(
      () => render(block([tag('rect', [], [text('content')])])),
      (err) => err.code === 'PUGNEUM:VOID_ELEMENT_WITH_CONTENT',
    );
  });

  test('sibling SVG shapes do not misnest (self-closing slash separates them)', () => {
    // Without the trailing slash, <rect> stays open in SVG foreign content and
    // the following <rect> is parsed as its child rather than its sibling.
    var a = [{name: 'id', val: 'a', line: 1, column: 1}];
    var b = [{name: 'id', val: 'b', line: 1, column: 1}];
    assert.strictEqual(
      render(block([tag('svg', [], [tag('rect', a), tag('rect', b)])])),
      '<svg><rect id="a" /><rect id="b" /></svg>',
    );
  });

  test('SVG animation element followed by a shape stays a sibling', () => {
    var attrs = [{name: 'attributeName', val: 'x', line: 1, column: 1}];
    assert.strictEqual(
      render(block([tag('svg', [], [tag('animate', attrs), tag('rect')])])),
      '<svg><animate attributeName="x" /><rect /></svg>',
    );
  });
});

describe('comments', () => {
  test('buffered comment', () => {
    var node = {
      type: 'Comment',
      val: ' hello ',
      buffer: true,
      line: 1,
      filename: 'test',
    };
    assert.strictEqual(render(block([node])), '<!-- hello -->');
  });

  test('unbuffered comment produces no output', () => {
    var node = {
      type: 'Comment',
      val: ' hidden ',
      buffer: false,
      line: 1,
      filename: 'test',
    };
    assert.strictEqual(render(block([node])), '');
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
    assert.strictEqual(render(block([node])), '<!-- start body-->');
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
    assert.strictEqual(render(block([node])), '');
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
    assert.strictEqual(render(block([node])), '<!--content-->');
  });

  test('comment with null val renders empty comment', () => {
    var node = {
      type: 'Comment',
      val: null,
      buffer: true,
      line: 1,
      filename: 'test',
    };
    assert.strictEqual(render(block([node])), '<!---->');
  });

  test('block comment with null val uses body only', () => {
    var node = {
      type: 'BlockComment',
      val: null,
      buffer: true,
      block: block([text('body')]),
      line: 1,
      filename: 'test',
    };
    assert.strictEqual(render(block([node])), '<!--body-->');
  });
});

describe('comment sanitization', () => {
  test('-- in comment is separated with spaces', () => {
    var node = {
      type: 'Comment',
      val: 'foo--bar',
      buffer: true,
      line: 1,
      filename: 'test',
    };
    assert.strictEqual(render(block([node])), '<!--foo- -bar-->');
  });

  test('--- (odd-length dashes) are all separated', () => {
    var node = {
      type: 'Comment',
      val: 'foo---bar',
      buffer: true,
      line: 1,
      filename: 'test',
    };
    assert.strictEqual(render(block([node])), '<!--foo- - -bar-->');
  });

  test('comment starting with > has space prepended', () => {
    var node = {
      type: 'Comment',
      val: '>dangerous',
      buffer: true,
      line: 1,
      filename: 'test',
    };
    assert.strictEqual(render(block([node])), '<!-- >dangerous-->');
  });

  test('comment starting with -> has space prepended', () => {
    var node = {
      type: 'Comment',
      val: '->dangerous',
      buffer: true,
      line: 1,
      filename: 'test',
    };
    assert.strictEqual(render(block([node])), '<!-- ->dangerous-->');
  });

  test('comment ending with - has space appended', () => {
    var node = {
      type: 'Comment',
      val: 'trailing-',
      buffer: true,
      line: 1,
      filename: 'test',
    };
    assert.strictEqual(render(block([node])), '<!--trailing- -->');
  });

  test('block comment with -- in body text is sanitized', () => {
    var node = {
      type: 'BlockComment',
      val: ' start ',
      buffer: true,
      block: block([text('has--dashes')]),
      line: 1,
      filename: 'test',
    };
    assert.strictEqual(render(block([node])), '<!-- start has- -dashes-->');
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
        tag(
          'p',
          [],
          [
            {
              type: 'Variable',
              name: 'name',
              line: 1,
              column: 1,
              filename: 'test',
            },
          ],
        ),
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
    assert.strictEqual(render(block([declaration, call])), '<p>world</p>');
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
    assert.strictEqual(render(block([declaration, call])), '<hr>');
  });

  test('mixin block (caller content)', () => {
    var declaration = {
      type: 'Mixin',
      name: 'wrapper',
      call: false,
      args: [],
      block: block([
        tag(
          'div',
          [],
          [{type: 'MixinBlock', line: 1, column: 1, filename: 'test'}],
        ),
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
    assert.strictEqual(render(block([declaration, call])), '<div>inside</div>');
  });

  test('nested mixin calls inherit parent environment', () => {
    var inner = {
      type: 'Mixin',
      name: 'inner',
      call: false,
      args: [],
      block: block([
        {type: 'Variable', name: 'x', line: 1, column: 1, filename: 'test'},
      ]),
      line: 1,
      column: 1,
      filename: 'test',
    };
    var outer = {
      type: 'Mixin',
      name: 'outer',
      call: false,
      args: [{name: 'x'}],
      block: block([
        {
          type: 'Mixin',
          name: 'inner',
          call: true,
          args: [],
          block: block([]),
          line: 3,
          column: 1,
          filename: 'test',
        },
      ]),
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
    assert.strictEqual(render(block([inner, outer, call])), 'hello');
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
      (err) => err.code === 'PUGNEUM:UNDEFINED_MIXIN',
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
      (err) => err.code === 'PUGNEUM:MIXIN_ARGUMENT_COUNT_MISMATCH',
    );
  });

  test('class shorthand on a mixin call throws UNSUPPORTED_MIXIN_CALL_ATTRIBUTES', () => {
    // +box.highlight — the .highlight is parsed onto the call's attrs and must
    // not be silently dropped.
    var declaration = mixinDecl('box', [], [tag('div', [], [])]);
    var call = mixinCallOpts('box', [], null, {
      attrs: [{name: 'class', val: 'highlight', line: 2, column: 1}],
    });
    assert.throws(
      () => render(block([declaration, call])),
      (err) => err.code === 'PUGNEUM:UNSUPPORTED_MIXIN_CALL_ATTRIBUTES',
    );
  });

  test('id shorthand on a mixin call throws UNSUPPORTED_MIXIN_CALL_ATTRIBUTES', () => {
    // +box#main
    var declaration = mixinDecl('box', [], [tag('div', [], [])]);
    var call = mixinCallOpts('box', [], null, {
      attrs: [{name: 'id', val: 'main', line: 2, column: 1}],
    });
    assert.throws(
      () => render(block([declaration, call])),
      (err) => err.code === 'PUGNEUM:UNSUPPORTED_MIXIN_CALL_ATTRIBUTES',
    );
  });

  test('attributeBlocks on a mixin call throws UNSUPPORTED_MIXIN_CALL_ATTRIBUTES', () => {
    var declaration = mixinDecl('box', [], [tag('div', [], [])]);
    var call = mixinCallOpts('box', [], null, {
      attributeBlocks: [{}],
    });
    assert.throws(
      () => render(block([declaration, call])),
      (err) => err.code === 'PUGNEUM:UNSUPPORTED_MIXIN_CALL_ATTRIBUTES',
    );
  });

  test('plain mixin call with no shorthand attributes still renders', () => {
    var declaration = mixinDecl('box', [], [tag('div', [], [text('x')])]);
    var call = mixinCallOpts('box', []);
    assert.strictEqual(render(block([declaration, call])), '<div>x</div>');
  });
});

describe('variable errors', () => {
  test('variable outside mixin throws CALL_STACK_UNDERFLOW', () => {
    var variable = {
      type: 'Variable',
      name: 'x',
      line: 1,
      column: 1,
      filename: 'test',
    };
    assert.throws(
      () => render(block([variable])),
      (err) => err.code === 'PUGNEUM:CALL_STACK_UNDERFLOW',
    );
  });

  test('undefined variable throws UNDEFINED_VARIABLE', () => {
    var declaration = {
      type: 'Mixin',
      name: 'm',
      call: false,
      args: [],
      block: block([
        {
          type: 'Variable',
          name: 'missing',
          line: 1,
          column: 1,
          filename: 'test',
        },
      ]),
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
      (err) => err.code === 'PUGNEUM:UNDEFINED_VARIABLE',
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
      block: block([
        tag(
          'a',
          [
            {
              name: 'href',
              val: '#{url}',
              line: 1,
              column: 1,
            },
          ],
          [text('click')],
        ),
      ]),
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
      '<a href="/home">click</a>',
    );
  });

  test('resolves multiple #{var} in one attribute', () => {
    var declaration = {
      type: 'Mixin',
      name: 'test',
      call: false,
      args: [{name: 'a'}, {name: 'b'}],
      block: block([
        tag('div', [
          {
            name: 'data-x',
            val: '#{a}-#{b}',
            line: 1,
            column: 1,
          },
        ]),
      ]),
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
      '<div data-x="hello-world"></div>',
    );
  });

  test('escaped \\#{var} passes through as literal', () => {
    var declaration = {
      type: 'Mixin',
      name: 'test',
      call: false,
      args: [{name: 'x'}],
      block: block([
        tag('div', [
          {
            name: 'data-t',
            val: '\\#{x}',
            line: 1,
            column: 1,
          },
        ]),
      ]),
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
      '<div data-t="#{x}"></div>',
    );
  });

  test('#{var} in class attribute is resolved', () => {
    var declaration = {
      type: 'Mixin',
      name: 'test',
      call: false,
      args: [{name: 'cls'}],
      block: block([
        tag('div', [
          {
            name: 'class',
            val: 'item-#{cls}',
            line: 1,
            column: 1,
          },
        ]),
      ]),
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
      '<div class="item-active"></div>',
    );
  });

  test('#{var} outside mixin throws CALL_STACK_UNDERFLOW', () => {
    assert.throws(
      () =>
        render(
          block([
            tag('div', [
              {
                name: 'x',
                val: '#{oops}',
                line: 1,
                column: 1,
              },
            ]),
          ]),
        ),
      (err) => err.code === 'PUGNEUM:CALL_STACK_UNDERFLOW',
    );
  });

  test('undefined #{var} in attribute throws UNDEFINED_VARIABLE', () => {
    var declaration = {
      type: 'Mixin',
      name: 'test',
      call: false,
      args: [],
      block: block([
        tag('div', [{name: 'x', val: '#{missing}', line: 1, column: 1}]),
      ]),
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
      (err) => err.code === 'PUGNEUM:UNDEFINED_VARIABLE',
    );
  });

  test('attribute without #{} is not affected', () => {
    assert.strictEqual(
      render(
        block([
          tag(
            'a',
            [
              {
                name: 'href',
                val: '/static',
                line: 1,
                column: 1,
              },
            ],
            [text('link')],
          ),
        ]),
      ),
      '<a href="/static">link</a>',
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
    assert.strictEqual(render(block([node])), '<em>stressed</em>');
  });

  test('void-name interpolated tag is self-closing via the void table', () => {
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
    assert.strictEqual(render(block([node])), '<br>');
  });

  test('selfClosing flag propagates through visitInterpolatedTag', () => {
    // Non-void name, so the only thing that can close it is the selfClosing
    // flag being copied onto the synthesized Tag. A regression dropping it in
    // the Object.assign would emit <foo></foo> instead.
    var node = {
      type: 'InterpolatedTag',
      expr: 'foo',
      attrs: [],
      attributeBlocks: [],
      block: block([]),
      selfClosing: true,
      isInline: false,
      line: 1,
      column: 1,
      filename: 'test',
    };
    assert.strictEqual(render(block([node])), '<foo>');
  });

  test('does not mutate the input AST node', () => {
    var node = {
      type: 'InterpolatedTag',
      expr: 'em',
      attrs: [],
      attributeBlocks: [],
      block: block([text('x')]),
      selfClosing: false,
      isInline: true,
      line: 1,
      column: 1,
      filename: 'test',
    };
    assert.strictEqual('name' in node, false);
    render(block([node]));
    assert.strictEqual('name' in node, false);
  });
});

describe('yield block', () => {
  test('produces no output', () => {
    var node = {type: 'YieldBlock', line: 1, filename: 'test'};
    assert.strictEqual(render(block([node])), '');
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
    assert.strictEqual(render(block([node])), 'block content');
  });
});

describe('error handling', () => {
  test('README direct-render boundary matches the implemented node visitors', () => {
    var readme = fs.readFileSync(path.join(packageRoot, 'README.md'), 'utf8');
    var implementation = fs.readFileSync(
      path.join(packageRoot, 'index.js'),
      'utf8',
    );
    var directRow = readme.match(/^\| Direct renderer \| (.+) \|$/m);
    assert.ok(directRow, 'README must contain the direct-renderer node row');
    var documented = Array.from(
      directRow[1].matchAll(/`([A-Za-z]+)`/g),
      (match) => match[1],
    ).sort();
    var implemented = Array.from(
      implementation.matchAll(/^  visit([A-Z][A-Za-z]+)\(/gm),
      (match) => match[1],
    )
      .filter((name) => name !== 'Node' && name !== 'Attributes')
      .sort();

    assert.deepStrictEqual(documented, implemented);
    assert.match(
      readme,
      /`lex` -> `parse` -> `load` -> `link\.assemble` -> `filter` -> `link\.resolve` -> `render`/,
    );
  });

  test('null node throws TypeError', () => {
    assert.throws(
      () => render(block([null])),
      (err) => err instanceof TypeError && /is null/.test(err.message),
    );
  });

  test('undefined node throws TypeError', () => {
    assert.throws(
      () => render(block([undefined])),
      (err) => err instanceof TypeError && /is undefined/.test(err.message),
    );
  });

  test('upstream-only nodes name the required pipeline stage', () => {
    var cases = [
      ['Extends', 'load -> link.assemble'],
      ['Include', 'load -> link.assemble'],
      ['FileReference', 'load -> link.assemble'],
      ['RawInclude', 'load -> link.assemble', {filters: []}],
      ['Filter', 'filter'],
      ['IncludeFilter', 'filter'],
      ['RawInclude', 'filter', {filters: [{type: 'IncludeFilter'}]}],
      ['References', 'link.resolve'],
      ['ReferenceLink', 'link.resolve'],
      ['ReferenceImage', 'link.resolve'],
      ['Footnotes', 'link.resolve'],
      ['FootnoteRef', 'link.resolve'],
      ['Toc', 'link.resolve'],
    ];
    var source = 'first\nunresolved\nthird';

    cases.forEach(([type, stage, fields]) => {
      var node = Object.assign(
        {
          type,
          line: 2,
          column: 3,
          filename: 'dependency.pg',
        },
        fields,
      );

      assert.throws(
        () => render(block([node]), {sources: {'dependency.pg': source}}),
        (err) =>
          err.code === 'PUGNEUM:UNRESOLVED_AST_NODE' &&
          err.msg ===
            `AST node type '${type}' requires ${stage} before render` &&
          err.line === 2 &&
          err.column === 3 &&
          err.filename === 'dependency.pg' &&
          err.source === source &&
          /dependency\.pg:2:3/.test(err.message) &&
          /\n  > 2\| unresolved\n/.test(err.message),
        `${type} should require ${stage}`,
      );
    });
  });

  test('unknown extension node remains an unsupported-type TypeError', () => {
    ['PluginWidget', 'toString'].forEach((type) => {
      var node = {
        type,
        line: 1,
        column: 1,
        filename: 'test',
      };
      assert.throws(
        () => render(block([node])),
        (err) =>
          err instanceof TypeError &&
          err.code === undefined &&
          new RegExp(`type ${type}`).test(err.message) &&
          /not supported by the pugneum compiler/.test(err.message),
        type,
      );
    });
  });

  test('recursive mixin throws RECURSIVE_MIXIN', () => {
    // mixin loop calls +loop
    var call = mixinCall('loop', []);
    var decl = mixinDecl('loop', [], [call]);
    assert.throws(
      () => render(block([decl, mixinCall('loop', [])])),
      (err) =>
        err.code === 'PUGNEUM:RECURSIVE_MIXIN' &&
        /Recursive call to mixin 'loop'/.test(err.message),
    );
  });

  test('mutual recursion throws RECURSIVE_MIXIN', () => {
    // mixin a calls +b, mixin b calls +a
    var declA = mixinDecl('a', [], [mixinCall('b', [])]);
    var declB = mixinDecl('b', [], [mixinCall('a', [])]);
    assert.throws(
      () => render(block([declA, declB, mixinCall('a', [])])),
      (err) => err.code === 'PUGNEUM:RECURSIVE_MIXIN',
    );
  });

  test('deep mixin chain exceeding MAX_MIXIN_DEPTH throws MIXIN_STACK_OVERFLOW', () => {
    // Build a chain of 257 distinct mixins: m0 calls m1, m1 calls m2, ..., m256 calls m257
    var depth = 257;
    var nodes = [];
    for (var i = 0; i < depth; i++) {
      nodes.push(mixinDecl('m' + i, [], [mixinCall('m' + (i + 1), [])]));
    }
    // Final mixin that doesn't call anything
    nodes.push(mixinDecl('m' + depth, [], [text('end')]));
    // Kick off the chain
    nodes.push(mixinCall('m0', []));
    assert.throws(
      () => render(block(nodes)),
      (err) => err.code === 'PUGNEUM:MIXIN_STACK_OVERFLOW',
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
  return {name: name, val: val, line: 1, column: 1};
}

describe('optional arguments', () => {
  test('omitted trailing args produce no text output', () => {
    var decl = mixinDecl(
      'greet',
      [{name: 'name'}, {name: 'title'}],
      [tag('p', [], [variable('title'), text(' '), variable('name')])],
    );
    var call = mixinCall('greet', ['Alice']);
    assert.strictEqual(render(block([decl, call])), '<p> Alice</p>');
  });

  test('omitted arg with default uses default value', () => {
    var decl = mixinDecl(
      'greet',
      [{name: 'name'}, {name: 'title', default: 'friend'}],
      [
        tag(
          'p',
          [],
          [text('Hello, '), variable('title'), text(' '), variable('name')],
        ),
      ],
    );
    var call = mixinCall('greet', ['Alice']);
    assert.strictEqual(
      render(block([decl, call])),
      '<p>Hello, friend Alice</p>',
    );
  });

  test('explicit arg overrides default', () => {
    var decl = mixinDecl(
      'greet',
      [{name: 'name'}, {name: 'title', default: 'friend'}],
      [tag('p', [], [variable('title'), text(' '), variable('name')])],
    );
    var call = mixinCall('greet', ['Alice', 'Doctor']);
    assert.strictEqual(render(block([decl, call])), '<p>Doctor Alice</p>');
  });

  test('all args can be omitted', () => {
    var decl = mixinDecl(
      'empty',
      [{name: 'a'}, {name: 'b'}],
      [tag('p', [], [variable('a'), variable('b')])],
    );
    var call = mixinCall('empty', []);
    assert.strictEqual(render(block([decl, call])), '<p></p>');
  });

  test('all defaults used when no args provided', () => {
    var decl = mixinDecl(
      'defaults',
      [
        {name: 'a', default: 'x'},
        {name: 'b', default: 'y'},
      ],
      [tag('p', [], [variable('a'), text('-'), variable('b')])],
    );
    var call = mixinCall('defaults', []);
    assert.strictEqual(render(block([decl, call])), '<p>x-y</p>');
  });

  test('too many args still throws MIXIN_ARGUMENT_COUNT_MISMATCH', () => {
    var decl = mixinDecl('m', [{name: 'a'}], []);
    var call = mixinCall('m', ['one', 'two', 'three']);
    assert.throws(
      () => render(block([decl, call])),
      (err) => err.code === 'PUGNEUM:MIXIN_ARGUMENT_COUNT_MISMATCH',
    );
  });

  test('explicit empty string overrides default', () => {
    var decl = mixinDecl(
      'm',
      [{name: 'x', default: 'fallback'}],
      [tag('p', [], [variable('x')])],
    );
    var call = mixinCall('m', ['']);
    assert.strictEqual(render(block([decl, call])), '<p></p>');
  });

  test('default with empty string default', () => {
    var decl = mixinDecl(
      'm',
      [{name: 'x', default: ''}],
      [tag('p', [], [variable('x')])],
    );
    var call = mixinCall('m', []);
    assert.strictEqual(render(block([decl, call])), '<p></p>');
  });
});

describe('optional arguments and attributes', () => {
  test('null variable omits entire attribute', () => {
    var decl = mixinDecl(
      'link',
      [{name: 'href'}, {name: 'target'}],
      [
        tag(
          'a',
          [attr('href', '#{href}'), attr('target', '#{target}')],
          [text('click')],
        ),
      ],
    );
    var call = mixinCall('link', ['/page']);
    assert.strictEqual(
      render(block([decl, call])),
      '<a href="/page">click</a>',
    );
  });

  test('null variable in composite attribute omits entire attribute', () => {
    var decl = mixinDecl(
      'icon',
      [{name: 'name'}, {name: 'size'}],
      [
        tag('img', [
          attr('src', '/icons/#{name}.svg'),
          attr('class', 'icon-#{size}'),
        ]),
      ],
    );
    var call = mixinCall('icon', ['arrow']);
    assert.strictEqual(
      render(block([decl, call])),
      '<img src="/icons/arrow.svg">',
    );
  });

  test('default value used in attribute', () => {
    var decl = mixinDecl(
      'link',
      [{name: 'href'}, {name: 'target', default: '_blank'}],
      [
        tag(
          'a',
          [attr('href', '#{href}'), attr('target', '#{target}')],
          [text('click')],
        ),
      ],
    );
    var call = mixinCall('link', ['/page']);
    assert.strictEqual(
      render(block([decl, call])),
      '<a href="/page" target="_blank">click</a>',
    );
  });

  test('provided arg overrides default in attribute', () => {
    var decl = mixinDecl(
      'link',
      [{name: 'href'}, {name: 'target', default: '_blank'}],
      [
        tag(
          'a',
          [attr('href', '#{href}'), attr('target', '#{target}')],
          [text('click')],
        ),
      ],
    );
    var call = mixinCall('link', ['/page', '_self']);
    assert.strictEqual(
      render(block([decl, call])),
      '<a href="/page" target="_self">click</a>',
    );
  });

  test('null class contribution is skipped, others preserved', () => {
    var decl = mixinDecl(
      'item',
      [{name: 'kind'}],
      [
        tag(
          'div',
          [attr('class', 'base'), attr('class', 'kind-#{kind}')],
          [text('hi')],
        ),
      ],
    );
    var call = mixinCall('item', []);
    assert.strictEqual(
      render(block([decl, call])),
      '<div class="base">hi</div>',
    );
  });

  test('all class contributions null omits class attribute', () => {
    var decl = mixinDecl(
      'item',
      [{name: 'a'}, {name: 'b'}],
      [
        tag(
          'div',
          [attr('class', '#{a}'), attr('class', '#{b}')],
          [text('hi')],
        ),
      ],
    );
    var call = mixinCall('item', []);
    assert.strictEqual(render(block([decl, call])), '<div>hi</div>');
  });

  test('boolean attributes unaffected by optional args', () => {
    var decl = mixinDecl(
      'input',
      [{name: 'type'}],
      [tag('input', [attr('type', '#{type}'), attr('disabled', true)])],
    );
    var call = mixinCall('input', []);
    assert.strictEqual(render(block([decl, call])), '<input disabled>');
  });

  test('static attributes unaffected when variable attribute omitted', () => {
    var decl = mixinDecl(
      'm',
      [{name: 'x'}],
      [
        tag(
          'div',
          [attr('id', 'fixed'), attr('data-x', '#{x}')],
          [text('content')],
        ),
      ],
    );
    var call = mixinCall('m', []);
    assert.strictEqual(
      render(block([decl, call])),
      '<div id="fixed">content</div>',
    );
  });

  test('undeclared variable still throws UNDEFINED_VARIABLE', () => {
    var decl = mixinDecl(
      'm',
      [{name: 'x'}],
      [tag('p', [], [variable('typo')])],
    );
    var call = mixinCall('m', ['val']);
    assert.throws(
      () => render(block([decl, call])),
      (err) => err.code === 'PUGNEUM:UNDEFINED_VARIABLE',
    );
  });

  test('undeclared variable in attribute still throws UNDEFINED_VARIABLE', () => {
    var decl = mixinDecl(
      'm',
      [{name: 'x'}],
      [tag('div', [attr('data-x', '#{typo}')])],
    );
    var call = mixinCall('m', ['val']);
    assert.throws(
      () => render(block([decl, call])),
      (err) => err.code === 'PUGNEUM:UNDEFINED_VARIABLE',
    );
  });

  test('null variable does not leak through prototypal inheritance', () => {
    // Inner mixin has param 'x' not provided (null).
    // Outer mixin has param 'x' provided.
    // Inner's null should NOT fall through to outer's value.
    var inner = mixinDecl(
      'inner',
      [{name: 'x'}],
      [tag('span', [], [variable('x')])],
    );
    var outer = mixinDecl('outer', [{name: 'x'}], [mixinCall('inner', [])]);
    outer.line = 2;
    var call = mixinCall('outer', ['hello']);
    call.line = 3;
    assert.strictEqual(render(block([inner, outer, call])), '<span></span>');
  });
});

describe('named mixin blocks', () => {
  test('basic replace semantics', () => {
    const decl = mixinDef(
      'wrap',
      [],
      [
        tag(
          'div',
          [],
          [namedBlock('header', 'replace'), namedBlock('body', 'replace')],
        ),
      ],
      {usesNamedBlocks: true},
    );
    const call = mixinCallOpts(
      'wrap',
      [],
      [
        namedBlock('header', 'replace', [text('H')]),
        namedBlock('body', 'replace', [text('B')]),
      ],
    );
    assert.strictEqual(render(block([decl, call])), '<div>HB</div>');
  });

  test('default content when caller omits a named block', () => {
    const decl = mixinDef(
      'wrap',
      [],
      [
        namedBlock('header', 'replace', [text('Default')]),
        namedBlock('body', 'replace'),
      ],
      {usesNamedBlocks: true},
    );
    const call = mixinCallOpts(
      'wrap',
      [],
      [namedBlock('body', 'replace', [text('B')])],
    );
    assert.strictEqual(render(block([decl, call])), 'DefaultB');
  });

  test('caller with no block uses all defaults', () => {
    const decl = mixinDef(
      'wrap',
      [],
      [namedBlock('slot', 'replace', [text('fallback')])],
      {usesNamedBlocks: true},
    );
    const call = mixinCallOpts('wrap', []);
    assert.strictEqual(render(block([decl, call])), 'fallback');
  });

  test('append adds after default content', () => {
    const decl = mixinDef(
      'nav',
      [],
      [namedBlock('links', 'replace', [text('A')])],
      {usesNamedBlocks: true},
    );
    const call = mixinCallOpts(
      'nav',
      [],
      [namedBlock('links', 'append', [text('B')])],
    );
    assert.strictEqual(render(block([decl, call])), 'AB');
  });

  test('prepend adds before default content', () => {
    const decl = mixinDef(
      'nav',
      [],
      [namedBlock('links', 'replace', [text('A')])],
      {usesNamedBlocks: true},
    );
    const call = mixinCallOpts(
      'nav',
      [],
      [namedBlock('links', 'prepend', [text('B')])],
    );
    assert.strictEqual(render(block([decl, call])), 'BA');
  });

  test('named blocks with variables', () => {
    const decl = mixinDef(
      'card',
      [{name: 'title'}],
      [
        tag(
          'div',
          [],
          [
            tag(
              'h2',
              [],
              [
                {
                  type: 'Variable',
                  name: 'title',
                  line: 1,
                  column: 1,
                  filename: 'test',
                },
              ],
            ),
            namedBlock('body', 'replace'),
          ],
        ),
      ],
      {usesNamedBlocks: true},
    );
    const call = mixinCallOpts(
      'card',
      ['Hello'],
      [namedBlock('body', 'replace', [text('content')])],
    );
    assert.strictEqual(
      render(block([decl, call])),
      '<div><h2>Hello</h2>content</div>',
    );
  });

  test('empty named block at call site replaces default with nothing', () => {
    const decl = mixinDef(
      'wrap',
      [],
      [namedBlock('slot', 'replace', [text('default')])],
      {usesNamedBlocks: true},
    );
    const call = mixinCallOpts('wrap', [], [namedBlock('slot', 'replace')]);
    assert.strictEqual(render(block([decl, call])), '');
  });

  test('same block name at multiple positions injects at all', () => {
    const decl = mixinDef(
      'multi',
      [],
      [
        tag('header', [], [namedBlock('slot', 'replace', [text('h')])]),
        tag('footer', [], [namedBlock('slot', 'replace', [text('f')])]),
      ],
      {usesNamedBlocks: true},
    );
    const call = mixinCallOpts(
      'multi',
      [],
      [namedBlock('slot', 'replace', [text('X')])],
    );
    assert.strictEqual(
      render(block([decl, call])),
      '<header>X</header><footer>X</footer>',
    );
  });
});

describe('named mixin block errors', () => {
  test('caller names non-existent block throws UNEXPECTED_NAMED_BLOCK', () => {
    const decl = mixinDef('wrap', [], [namedBlock('header', 'replace')], {
      usesNamedBlocks: true,
    });
    const call = mixinCallOpts(
      'wrap',
      [],
      [namedBlock('nonexistent', 'replace', [text('x')])],
    );
    assert.throws(
      () => render(block([decl, call])),
      (err) => err.code === 'PUGNEUM:UNEXPECTED_NAMED_BLOCK',
    );
  });

  test('caller naming a block from nested mixin call throws UNEXPECTED_NAMED_BLOCK', () => {
    const inner = mixinDef('inner', [], [namedBlock('slot', 'replace')], {
      usesNamedBlocks: true,
    });
    const outer = mixinDef(
      'outer',
      [],
      [
        namedBlock('header', 'replace'),
        mixinCallOpts(
          'inner',
          [],
          [namedBlock('slot', 'replace', [text('inner default')])],
        ),
      ],
      {usesNamedBlocks: true},
    );
    const call = mixinCallOpts(
      'outer',
      [],
      [
        namedBlock('header', 'replace', [text('ok')]),
        namedBlock('slot', 'replace', [text('should fail')]),
      ],
    );
    assert.throws(
      () => render(block([inner, outer, call])),
      (err) => err.code === 'PUGNEUM:UNEXPECTED_NAMED_BLOCK',
    );
  });

  test('loose content in named block call throws UNEXPECTED_CONTENT_IN_NAMED_BLOCK_CALL', () => {
    const decl = mixinDef('wrap', [], [namedBlock('slot', 'replace')], {
      usesNamedBlocks: true,
      usesUnnamedBlock: false,
    });
    const call = mixinCallOpts('wrap', [], [text('loose content')]);
    assert.throws(
      () => render(block([decl, call])),
      (err) => err.code === 'PUGNEUM:UNEXPECTED_CONTENT_IN_NAMED_BLOCK_CALL',
    );
  });

  test('duplicate replace blocks use last one', () => {
    const decl = mixinDef('wrap', [], [namedBlock('slot', 'replace')], {
      usesNamedBlocks: true,
    });
    const call = mixinCallOpts(
      'wrap',
      [],
      [
        namedBlock('slot', 'replace', [text('first')]),
        namedBlock('slot', 'replace', [text('second')]),
      ],
    );
    assert.strictEqual(render(block([decl, call])), 'second');
  });

  test('replace then append combines content', () => {
    const decl = mixinDef(
      'wrap',
      [],
      [tag('div', [], [namedBlock('slot', 'replace', [text('default')])])],
      {usesNamedBlocks: true},
    );
    const call = mixinCallOpts(
      'wrap',
      [],
      [
        namedBlock('slot', 'replace', [text('base')]),
        namedBlock('slot', 'append', [text(' added')]),
      ],
    );
    assert.strictEqual(render(block([decl, call])), '<div>base added</div>');
  });

  test('multiple appends accumulate', () => {
    const decl = mixinDef(
      'wrap',
      [],
      [tag('div', [], [namedBlock('slot', 'replace', [text('default')])])],
      {usesNamedBlocks: true},
    );
    const call = mixinCallOpts(
      'wrap',
      [],
      [
        namedBlock('slot', 'append', [text(' one')]),
        namedBlock('slot', 'append', [text(' two')]),
      ],
    );
    assert.strictEqual(
      render(block([decl, call])),
      '<div>default one two</div>',
    );
  });

  test('same-name named block in caller content does not recurse', () => {
    const decl = mixinDef(
      'card',
      [],
      [tag('div', [], [namedBlock('header', 'replace', [text('default')])])],
      {usesNamedBlocks: true},
    );
    const call = mixinCallOpts(
      'card',
      [],
      [
        namedBlock('header', 'replace', [
          namedBlock('header', 'replace', [text('inner')]),
        ]),
      ],
    );
    assert.strictEqual(render(block([decl, call])), '<div>inner</div>');
  });
});

describe('mixed named + unnamed blocks', () => {
  test('both named and unnamed content dispatched correctly', () => {
    const decl = mixinDef(
      'card',
      [],
      [
        namedBlock('header', 'replace'),
        tag(
          'div',
          [],
          [{type: 'MixinBlock', line: 1, column: 1, filename: 'test'}],
        ),
      ],
      {usesNamedBlocks: true, usesUnnamedBlock: true},
    );
    const call = mixinCallOpts(
      'card',
      [],
      [namedBlock('header', 'replace', [text('Title')]), text('Body content')],
    );
    assert.strictEqual(
      render(block([decl, call])),
      'Title<div>Body content</div>',
    );
  });

  test('only unnamed content provided — named blocks use defaults', () => {
    const decl = mixinDef(
      'card',
      [],
      [
        namedBlock('header', 'replace', [text('Default Header')]),
        tag(
          'div',
          [],
          [{type: 'MixinBlock', line: 1, column: 1, filename: 'test'}],
        ),
      ],
      {usesNamedBlocks: true, usesUnnamedBlock: true},
    );
    const call = mixinCallOpts('card', [], [text('Body only')]);
    assert.strictEqual(
      render(block([decl, call])),
      'Default Header<div>Body only</div>',
    );
  });

  test('only named blocks provided — unnamed block empty', () => {
    const decl = mixinDef(
      'card',
      [],
      [
        namedBlock('header', 'replace', [text('Default')]),
        tag(
          'div',
          [],
          [{type: 'MixinBlock', line: 1, column: 1, filename: 'test'}],
        ),
      ],
      {usesNamedBlocks: true, usesUnnamedBlock: true},
    );
    const call = mixinCallOpts(
      'card',
      [],
      [namedBlock('header', 'replace', [text('Custom Header')])],
    );
    assert.strictEqual(render(block([decl, call])), 'Custom Header<div></div>');
  });

  test('interleaved order — named blocks extracted, rest collected in order', () => {
    const decl = mixinDef(
      'page',
      [],
      [
        namedBlock('nav', 'replace'),
        tag(
          'main',
          [],
          [{type: 'MixinBlock', line: 1, column: 1, filename: 'test'}],
        ),
      ],
      {usesNamedBlocks: true, usesUnnamedBlock: true},
    );
    const call = mixinCallOpts(
      'page',
      [],
      [
        text('First '),
        namedBlock('nav', 'replace', [tag('nav', [], [text('links')])]),
        text('Second'),
      ],
    );
    assert.strictEqual(
      render(block([decl, call])),
      '<nav>links</nav><main>First Second</main>',
    );
  });

  test('no caller block at all — both slots empty/default', () => {
    const decl = mixinDef(
      'card',
      [],
      [
        namedBlock('header', 'replace', [text('H')]),
        tag(
          'div',
          [],
          [{type: 'MixinBlock', line: 1, column: 1, filename: 'test'}],
        ),
      ],
      {usesNamedBlocks: true, usesUnnamedBlock: true},
    );
    const call = mixinCallOpts('card', []);
    assert.strictEqual(render(block([decl, call])), 'H<div></div>');
  });

  test('unnamed content at call site for named-only mixin still errors', () => {
    const decl = mixinDef('wrap', [], [namedBlock('slot', 'replace')], {
      usesNamedBlocks: true,
      usesUnnamedBlock: false,
    });
    const call = mixinCallOpts('wrap', [], [text('loose content')]);
    assert.throws(
      () => render(block([decl, call])),
      (err) => err.code === 'PUGNEUM:UNEXPECTED_CONTENT_IN_NAMED_BLOCK_CALL',
    );
  });

  test('append mode works in mixed context', () => {
    const decl = mixinDef(
      'card',
      [],
      [
        namedBlock('footer', 'replace', [text('default footer')]),
        tag(
          'div',
          [],
          [{type: 'MixinBlock', line: 1, column: 1, filename: 'test'}],
        ),
      ],
      {usesNamedBlocks: true, usesUnnamedBlock: true},
    );
    const call = mixinCallOpts(
      'card',
      [],
      [namedBlock('footer', 'append', [text(' extra')]), text('body')],
    );
    assert.strictEqual(
      render(block([decl, call])),
      'default footer extra<div>body</div>',
    );
  });
});

describe('given keyword', () => {
  test('given renders subtree when caller provides the named block', () => {
    const decl = mixinDef(
      'card',
      [],
      [
        {type: 'MixinBlock', line: 1, column: 1, filename: 'test'},
        {
          type: 'Given',
          name: 'footer',
          block: block([tag('footer', [], [namedBlock('footer', 'replace')])]),
          line: 1,
          column: 1,
          filename: 'test',
        },
      ],
      {usesNamedBlocks: true, usesUnnamedBlock: true},
    );
    const call = mixinCallOpts(
      'card',
      [],
      [text('Body'), namedBlock('footer', 'replace', [text('Foot')])],
    );
    assert.strictEqual(
      render(block([decl, call])),
      'Body<footer>Foot</footer>',
    );
  });

  test('given skips subtree when caller does not provide the named block', () => {
    const decl = mixinDef(
      'card',
      [],
      [
        {type: 'MixinBlock', line: 1, column: 1, filename: 'test'},
        {
          type: 'Given',
          name: 'footer',
          block: block([tag('footer', [], [namedBlock('footer', 'replace')])]),
          line: 1,
          column: 1,
          filename: 'test',
        },
      ],
      {usesNamedBlocks: true, usesUnnamedBlock: true},
    );
    const call = mixinCallOpts('card', [], [text('Body only')]);
    assert.strictEqual(render(block([decl, call])), 'Body only');
  });

  test('given FIRES on an empty caller block (presence, not content — decision #2)', () => {
    // Decision #2: `given` fires when the caller NAMES the block, even with no
    // content — the (empty) wrapper still renders. Same mixin as the skip test,
    // but the caller now supplies an empty `footer` block.
    const decl = mixinDef(
      'card',
      [],
      [
        {type: 'MixinBlock', line: 1, column: 1, filename: 'test'},
        {
          type: 'Given',
          name: 'footer',
          block: block([tag('footer', [], [namedBlock('footer', 'replace')])]),
          line: 1,
          column: 1,
          filename: 'test',
        },
      ],
      {usesNamedBlocks: true, usesUnnamedBlock: true},
    );
    const call = mixinCallOpts(
      'card',
      [],
      [text('Body'), namedBlock('footer', 'replace', [])],
    );
    const out = render(block([decl, call]));
    assert.match(out, /Body/);
    assert.match(out, /<footer><\/footer>/);
  });

  test('given with named-only mixin (no unnamed block)', () => {
    const decl = mixinDef(
      'wrap',
      [],
      [
        namedBlock('main', 'replace'),
        {
          type: 'Given',
          name: 'sidebar',
          block: block([tag('aside', [], [namedBlock('sidebar', 'replace')])]),
          line: 1,
          column: 1,
          filename: 'test',
        },
      ],
      {usesNamedBlocks: true, usesUnnamedBlock: false},
    );
    const call = mixinCallOpts(
      'wrap',
      [],
      [
        namedBlock('main', 'replace', [text('Main')]),
        namedBlock('sidebar', 'replace', [text('Side')]),
      ],
    );
    assert.strictEqual(render(block([decl, call])), 'Main<aside>Side</aside>');
  });

  test('given without caller block omits subtree', () => {
    const decl = mixinDef(
      'wrap',
      [],
      [
        namedBlock('main', 'replace', [text('default')]),
        {
          type: 'Given',
          name: 'sidebar',
          block: block([tag('aside', [], [namedBlock('sidebar', 'replace')])]),
          line: 1,
          column: 1,
          filename: 'test',
        },
      ],
      {usesNamedBlocks: true, usesUnnamedBlock: false},
    );
    const call = mixinCallOpts(
      'wrap',
      [],
      [namedBlock('main', 'replace', [text('Main')])],
    );
    assert.strictEqual(render(block([decl, call])), 'Main');
  });

  test('multiple given blocks in same mixin', () => {
    const decl = mixinDef(
      'page',
      [],
      [
        {type: 'MixinBlock', line: 1, column: 1, filename: 'test'},
        {
          type: 'Given',
          name: 'nav',
          block: block([tag('nav', [], [namedBlock('nav', 'replace')])]),
          line: 1,
          column: 1,
          filename: 'test',
        },
        {
          type: 'Given',
          name: 'footer',
          block: block([tag('footer', [], [namedBlock('footer', 'replace')])]),
          line: 1,
          column: 1,
          filename: 'test',
        },
      ],
      {usesNamedBlocks: true, usesUnnamedBlock: true},
    );
    const call = mixinCallOpts(
      'page',
      [],
      [text('Content'), namedBlock('footer', 'replace', [text('Foot')])],
    );
    assert.strictEqual(
      render(block([decl, call])),
      'Content<footer>Foot</footer>',
    );
  });

  test('given outside mixin call throws GIVEN_OUTSIDE_CALL', () => {
    const given = {
      type: 'Given',
      name: 'footer',
      block: block([text('content')]),
      line: 1,
      column: 1,
      filename: 'test',
    };
    assert.throws(
      () => render(block([given])),
      (err) => err.code === 'PUGNEUM:GIVEN_OUTSIDE_CALL',
    );
  });
});

describe('unused mixin warnings', () => {
  test('unused entry-file mixin pushes one UNUSED_MIXIN warning', () => {
    const decl = mixinDecl('unused', [], [tag('p', [], [text('x')])]);
    const warnings = [];
    const out = render(block([decl, tag('p', [], [text('hi')])]), {
      filename: 'test',
      warnings,
    });
    assert.strictEqual(out, '<p>hi</p>');
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].code, 'PUGNEUM:UNUSED_MIXIN');
    assert.match(warnings[0].msg, /Mixin 'unused' is defined but never called/);
  });

  test('a called mixin produces no warning', () => {
    const decl = mixinDecl('used', [], [tag('p', [], [text('x')])]);
    const call = mixinCall('used', []);
    const warnings = [];
    render(block([decl, call]), {filename: 'test', warnings});
    assert.strictEqual(warnings.length, 0);
  });

  test('mixin defined in a different file is not flagged', () => {
    // filename !== options.filename means it is a library mixin from an
    // included file; it must not warn even though it is never called.
    const decl = mixinDecl('lib', [], [tag('p', [], [text('x')])]);
    decl.filename = 'included.pg';
    const warnings = [];
    render(block([decl, tag('p', [], [text('hi')])]), {
      filename: 'entry.pg',
      warnings,
    });
    assert.strictEqual(warnings.length, 0);
  });

  test('warnings are discarded when no collector is supplied', () => {
    // Must not throw when options/warnings is absent; the warning is collected
    // into an internal throwaway array.
    const decl = mixinDecl('unused', [], [tag('p', [], [text('x')])]);
    assert.strictEqual(render(block([decl]), {filename: 'test'}), '');
  });
});

describe('defensive error paths', () => {
  test('unknown block mode throws UNKNOWN_BLOCK_MODE', () => {
    const decl = mixinDef('wrap', [], [namedBlock('slot', 'replace')], {
      usesNamedBlocks: true,
    });
    const call = mixinCallOpts(
      'wrap',
      [],
      [namedBlock('slot', 'bogus', [text('X')])],
    );
    assert.throws(
      () => render(block([decl, call])),
      (err) => err.code === 'PUGNEUM:UNKNOWN_BLOCK_MODE',
    );
  });

  test('MixinBlock outside a mixin call throws CALL_STACK_UNDERFLOW', () => {
    const node = {type: 'MixinBlock', line: 1, column: 1, filename: 'test'};
    assert.throws(
      () => render(block([node])),
      (err) => err.code === 'PUGNEUM:CALL_STACK_UNDERFLOW',
    );
  });
});

describe('mixin depth and recursion boundaries', () => {
  // Pin the exact MAX_MIXIN_DEPTH limit (256): a chain of 256 frames renders,
  // 257 overflows. A boundary test well past the edge would not catch an
  // off-by-one regression.
  function chain(depth) {
    const nodes = [];
    for (let i = 0; i < depth; i++) {
      nodes.push(mixinDecl('m' + i, [], [mixinCall('m' + (i + 1), [])]));
    }
    nodes.push(mixinDecl('m' + depth, [], [text('end')]));
    nodes.push(mixinCall('m0', []));
    return block(nodes);
  }

  test('deepest legal mixin chain (256 frames) renders', () => {
    assert.strictEqual(render(chain(255)), 'end');
  });

  test('one frame deeper (257) throws MIXIN_STACK_OVERFLOW', () => {
    assert.throws(
      () => render(chain(256)),
      (err) => err.code === 'PUGNEUM:MIXIN_STACK_OVERFLOW',
    );
  });

  test('repeated sibling calls of one mixin are not recursion', () => {
    const h = mixinDecl('h', [], [text('h')]);
    const w = mixinDecl('w', [], [mixinCall('h', []), mixinCall('h', [])]);
    assert.strictEqual(render(block([h, w, mixinCall('w', [])])), 'hh');
  });

  test('diamond mixin calls are allowed (not recursion)', () => {
    const h = mixinDecl('h', [], [text('h')]);
    const a = mixinDecl('a', [], [mixinCall('h', [])]);
    const b = mixinDecl('b', [], [mixinCall('h', [])]);
    const w = mixinDecl('w', [], [mixinCall('a', []), mixinCall('b', [])]);
    assert.strictEqual(render(block([h, a, b, w, mixinCall('w', [])])), 'hh');
  });
});

describe('attribute escaping after substitution', () => {
  test('mixin-arg value with breakout characters is escaped in attribute', () => {
    // Security-relevant: resolveAttrValue runs first, escapeAttrValue second.
    // A value containing " and & must be escaped so it cannot break out of the
    // quoted attribute.
    const decl = mixinDecl(
      'link',
      [{name: 'u'}],
      [tag('a', [attr('title', '#{u}')], [text('x')])],
    );
    const call = mixinCall('link', ['evil" onmouseover="alert(1)&y']);
    assert.strictEqual(
      render(block([decl, call])),
      '<a title="evil&quot; onmouseover=&quot;alert(1)&amp;y">x</a>',
    );
  });
});
