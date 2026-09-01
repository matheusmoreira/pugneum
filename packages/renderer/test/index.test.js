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

function comment(val, buffer, children) {
  const node = {
    type: children === undefined ? 'Comment' : 'BlockComment',
    val,
    buffer,
    line: 1,
    filename: 'test',
  };
  if (children !== undefined) node.block = block(children);
  return node;
}

function given(name, children) {
  return {
    type: 'Given',
    name,
    block: block(children || []),
    line: 1,
    column: 1,
    filename: 'test',
  };
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

function mixinBlock() {
  return {type: 'MixinBlock', line: 1, column: 1, filename: 'test'};
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

// Helper: Mixin call node
function mixinCall(name, args, children, opts) {
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

  test('generic dispatch reads a node type only once', () => {
    const node = text('hello');
    let reads = 0;
    Object.defineProperty(node, 'type', {
      enumerable: true,
      get() {
        reads++;
        return 'Text';
      },
    });

    assert.strictEqual(render(block([node])), 'hello');
    assert.strictEqual(reads, 1);
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
      render(block([declaration, mixinCall('note', [])])),
      'continuation',
    );
    assert.strictEqual(
      render(block([declaration, mixinCall('note', ['first'])])),
      'first continuation',
    );
  });
});

describe('attributes', () => {
  test('string attribute', () => {
    var attrs = [attr('href', '/home')];
    assert.strictEqual(
      render(block([tag('a', attrs, [text('link')])])),
      '<a href="/home">link</a>',
    );
  });

  test('boolean attribute', () => {
    var attrs = [attr('disabled', true)];
    assert.strictEqual(
      render(block([tag('input', attrs)])),
      '<input disabled>',
    );
  });

  test('multiple classes joined with spaces', () => {
    var attrs = [attr('class', 'a'), attr('class', 'b')];
    assert.strictEqual(
      render(block([tag('div', attrs)])),
      '<div class="a b"></div>',
    );
  });

  test('a valueless class attribute is preserved', () => {
    var attrs = [attr('class', true)];
    assert.strictEqual(render(block([tag('div', attrs)])), '<div class></div>');
  });

  test('class coalescing uses ASCII-case-insensitive HTML identity', () => {
    var attrs = [attr('CLASS', 'a'), attr('Class', true), attr('class', 'b')];
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
    var attrs = [attr('class', 'a"b')];
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

  test('a selfClosing flag cannot leave a non-void HTML element dangling', () => {
    assert.strictEqual(
      render(
        block([
          tag('custom', [], [], {selfClosing: true}),
          tag('p', [], [text('sibling')]),
        ]),
      ),
      '<custom></custom><p>sibling</p>',
    );
    assert.strictEqual(
      render(
        block([tag('custom', [], [text('content')], {selfClosing: true})]),
      ),
      '<custom>content</custom>',
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

  test('mixed-case HTML void names preserve spelling and void semantics', () => {
    assert.strictEqual(render(block([tag('BR')])), '<BR>');
    assert.strictEqual(render(block([tag('iMg')])), '<iMg>');
    assert.throws(
      () => render(block([tag('Br', [], [text('content')])])),
      (err) => err.code === 'PUGNEUM:VOID_ELEMENT_WITH_CONTENT',
    );
  });
});

describe('SVG foreign elements', () => {
  test('an empty rect uses compact SVG syntax', () => {
    var attrs = [
      attr('x', '0'),
      attr('y', '0'),
      attr('width', '100'),
      attr('height', '50'),
    ];
    assert.strictEqual(
      render(block([tag('svg', [], [tag('rect', attrs)])])),
      '<svg><rect x="0" y="0" width="100" height="50" /></svg>',
    );
  });

  test('an empty circle uses compact SVG syntax', () => {
    var attrs = [attr('cx', '50'), attr('cy', '50'), attr('r', '25')];
    assert.strictEqual(
      render(block([tag('svg', [], [tag('circle', attrs)])])),
      '<svg><circle cx="50" cy="50" r="25" /></svg>',
    );
  });

  test('an empty line uses compact SVG syntax', () => {
    var attrs = [
      attr('x1', '0'),
      attr('y1', '0'),
      attr('x2', '100'),
      attr('y2', '100'),
    ];
    assert.strictEqual(
      render(block([tag('svg', [], [tag('line', attrs)])])),
      '<svg><line x1="0" y1="0" x2="100" y2="100" /></svg>',
    );
  });

  test('an empty path uses compact SVG syntax', () => {
    var attrs = [attr('d', 'M0 0 L100 100')];
    assert.strictEqual(
      render(block([tag('svg', [], [tag('path', attrs)])])),
      '<svg><path d="M0 0 L100 100" /></svg>',
    );
  });

  test('SVG container elements retain explicit end tags', () => {
    assert.strictEqual(
      render(block([tag('svg', [], [tag('rect')])])),
      '<svg><rect /></svg>',
    );
    assert.strictEqual(
      render(block([tag('svg', [], [tag('g', [], [tag('circle')])])])),
      '<svg><g><circle /></g></svg>',
    );
    assert.strictEqual(
      render(block([tag('svg', [], [tag('text', [], [text('hello')])])])),
      '<svg><text>hello</text></svg>',
    );
    assert.strictEqual(
      render(
        block([
          tag(
            'svg',
            [],
            [
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
            ],
          ),
        ]),
      ),
      '<svg><use href="#icon"></use></svg>',
    );
    assert.strictEqual(
      render(
        block([
          tag(
            'svg',
            [],
            [
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
            ],
          ),
        ]),
      ),
      '<svg><image href="pic.png"></image></svg>',
    );
  });

  test('non-empty SVG shapes retain descriptive and animation children', () => {
    assert.strictEqual(
      render(
        block([
          tag(
            'svg',
            [],
            [
              tag('rect', [], [tag('title', [], [text('A square')])]),
              tag('path', [], [tag('desc', [], [text('A route')])]),
              tag(
                'animateMotion',
                [],
                [tag('mpath', [attr('href', '#route')])],
              ),
            ],
          ),
        ]),
      ),
      '<svg><rect><title>A square</title></rect>' +
        '<path><desc>A route</desc></path>' +
        '<animateMotion><mpath href="#route"></mpath></animateMotion></svg>',
    );
  });

  test('SVG-like names in HTML remain ordinary paired elements', () => {
    assert.strictEqual(
      render(
        block([
          tag('rect', [], [tag('span', [], [text('ordinary')])]),
          tag('p', [], [text('sibling')]),
        ]),
      ),
      '<rect><span>ordinary</span></rect><p>sibling</p>',
    );
  });

  test('foreignObject children return to the HTML namespace', () => {
    assert.strictEqual(
      render(
        block([
          tag(
            'svg',
            [],
            [
              tag(
                'foreignObject',
                [],
                [tag('rect', [], [tag('span', [], [text('HTML child')])])],
              ),
              tag('rect'),
            ],
          ),
        ]),
      ),
      '<svg><foreignObject><rect><span>HTML child</span></rect>' +
        '</foreignObject><rect /></svg>',
    );
  });

  test('sibling SVG shapes do not misnest (self-closing slash separates them)', () => {
    // Without the trailing slash, <rect> stays open in SVG foreign content and
    // the following <rect> is parsed as its child rather than its sibling.
    var a = [attr('id', 'a')];
    var b = [attr('id', 'b')];
    assert.strictEqual(
      render(block([tag('svg', [], [tag('rect', a), tag('rect', b)])])),
      '<svg><rect id="a" /><rect id="b" /></svg>',
    );
  });

  test('SVG animation element followed by a shape stays a sibling', () => {
    var attrs = [attr('attributeName', 'x')];
    assert.strictEqual(
      render(block([tag('svg', [], [tag('animate', attrs), tag('rect')])])),
      '<svg><animate attributeName="x" /><rect /></svg>',
    );
  });
});

describe('comments', () => {
  test('buffered comment', () => {
    var node = comment(' hello ', true);
    assert.strictEqual(render(block([node])), '<!-- hello -->');
  });

  test('unbuffered comment produces no output', () => {
    var node = comment(' hidden ', false);
    assert.strictEqual(render(block([node])), '');
  });

  test('buffered block comment', () => {
    var node = comment(' start ', true, [text('body')]);
    assert.strictEqual(render(block([node])), '<!-- start body-->');
  });

  test('unbuffered block comment produces no output', () => {
    var node = comment(' hidden ', false, [text('body')]);
    assert.strictEqual(render(block([node])), '');
  });

  test('unbuffered block comments do not evaluate invalid descendants', () => {
    var node = comment(' hidden ', false, [variable('outside')]);
    assert.strictEqual(render(block([node])), '');
  });

  test('unbuffered block comments do not register hidden mixins', () => {
    var hidden = comment(' hidden ', false, [
      mixinDef('hidden', [], [text('body')]),
    ]);
    assert.throws(
      () => render(block([hidden, mixinCall('hidden')])),
      (err) => err.code === 'PUGNEUM:UNDEFINED_MIXIN',
    );
  });

  test('block comment with empty val', () => {
    var node = comment('', true, [text('content')]);
    assert.strictEqual(render(block([node])), '<!--content-->');
  });

  test('comment with null val renders empty comment', () => {
    var node = comment(null, true);
    assert.strictEqual(render(block([node])), '<!---->');
  });

  test('block comment with null val uses body only', () => {
    var node = comment(null, true, [text('body')]);
    assert.strictEqual(render(block([node])), '<!--body-->');
  });
});

describe('comment sanitization', () => {
  test('-- in comment is separated with spaces', () => {
    var node = comment('foo--bar', true);
    assert.strictEqual(render(block([node])), '<!--foo- -bar-->');
  });

  test('--- (odd-length dashes) are all separated', () => {
    var node = comment('foo---bar', true);
    assert.strictEqual(render(block([node])), '<!--foo- - -bar-->');
  });

  test('comment starting with > has space prepended', () => {
    var node = comment('>dangerous', true);
    assert.strictEqual(render(block([node])), '<!-- >dangerous-->');
  });

  test('comment starting with -> has space prepended', () => {
    var node = comment('->dangerous', true);
    assert.strictEqual(render(block([node])), '<!-- ->dangerous-->');
  });

  test('comment ending with - has space appended', () => {
    var node = comment('trailing-', true);
    assert.strictEqual(render(block([node])), '<!--trailing- -->');
  });

  test('block comment with -- in body text is sanitized', () => {
    var node = comment(' start ', true, [text('has--dashes')]);
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
      block: block([tag('div', [], [mixinBlock()])]),
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

  test('nested mixin calls cannot capture undeclared caller parameters', () => {
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
    assert.throws(
      () => render(block([inner, outer, call])),
      (err) => err.code === 'PUGNEUM:UNDEFINED_VARIABLE',
    );
  });

  test('nested mixin calls explicitly forward caller parameters', () => {
    const inner = mixinDef('inner', [{name: 'x'}], [variable('x')]);
    const outer = mixinDef(
      'outer',
      [{name: 'x'}],
      [mixinCall('inner', ['#{x}'])],
    );

    assert.strictEqual(
      render(block([inner, outer, mixinCall('outer', ['hello'])])),
      'hello',
    );
  });

  test('nested same-name declarations have distinct recursion identities', () => {
    const inner = mixinDef('outer', [], [text('inner')]);
    inner.line = 2;
    const outer = mixinDef('outer', [], [inner, mixinCall('outer', [])]);

    assert.strictEqual(render(block([outer, mixinCall('outer', [])])), 'inner');
  });

  test('nested declarations restore the surrounding binding on return', () => {
    const globalHelper = mixinDef('helper', [], [text('global')]);
    const localHelper = mixinDef('helper', [], [text('local')]);
    const install = mixinDef(
      'install',
      [],
      [localHelper, mixinCall('helper', [])],
    );

    assert.strictEqual(
      render(
        block([
          globalHelper,
          install,
          mixinCall('install', []),
          mixinCall('helper', []),
        ]),
      ),
      'localglobal',
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
    var declaration = mixinDef('box', [], [tag('div', [], [])]);
    var call = mixinCall('box', [], null, {
      attrs: [attr('class', 'highlight', 2)],
    });
    assert.throws(
      () => render(block([declaration, call])),
      (err) => err.code === 'PUGNEUM:UNSUPPORTED_MIXIN_CALL_ATTRIBUTES',
    );
  });

  test('id shorthand on a mixin call throws UNSUPPORTED_MIXIN_CALL_ATTRIBUTES', () => {
    // +box#main
    var declaration = mixinDef('box', [], [tag('div', [], [])]);
    var call = mixinCall('box', [], null, {
      attrs: [attr('id', 'main', 2)],
    });
    assert.throws(
      () => render(block([declaration, call])),
      (err) => err.code === 'PUGNEUM:UNSUPPORTED_MIXIN_CALL_ATTRIBUTES',
    );
  });

  test('attributeBlocks on a mixin call throws UNSUPPORTED_MIXIN_CALL_ATTRIBUTES', () => {
    var declaration = mixinDef('box', [], [tag('div', [], [])]);
    var call = mixinCall('box', [], null, {
      attributeBlocks: [{}],
    });
    assert.throws(
      () => render(block([declaration, call])),
      (err) => err.code === 'PUGNEUM:UNSUPPORTED_MIXIN_CALL_ATTRIBUTES',
    );
  });

  test('plain mixin call with no shorthand attributes still renders', () => {
    var declaration = mixinDef('box', [], [tag('div', [], [text('x')])]);
    var call = mixinCall('box', []);
    assert.strictEqual(render(block([declaration, call])), '<div>x</div>');
  });
});

describe('variable errors', () => {
  test('variable outside mixin throws VARIABLE_OUTSIDE_MIXIN', () => {
    var variable = {
      type: 'Variable',
      name: 'x',
      line: 1,
      column: 1,
      filename: 'test',
    };
    assert.throws(
      () => render(block([variable])),
      (err) => err.code === 'PUGNEUM:VARIABLE_OUTSIDE_MIXIN',
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

  test('#{var} outside mixin throws VARIABLE_OUTSIDE_MIXIN', () => {
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
      (err) => err.code === 'PUGNEUM:VARIABLE_OUTSIDE_MIXIN',
    );
  });

  test('undefined #{var} in attribute throws UNDEFINED_VARIABLE', () => {
    var declaration = {
      type: 'Mixin',
      name: 'test',
      call: false,
      args: [],
      block: block([tag('div', [attr('x', '#{missing}')])]),
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

  test('selfClosing cannot leave an interpolated non-void tag dangling', () => {
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
    assert.strictEqual(
      render(block([node, tag('p', [], [text('sibling')])])),
      '<foo></foo><p>sibling</p>',
    );
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

  test('does not read unrelated extension metadata', () => {
    var reads = 0;
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
    Object.defineProperty(node, 'extensionMetadata', {
      enumerable: true,
      get() {
        reads++;
        return 'unused';
      },
    });

    assert.strictEqual(render(block([node])), '<em>x</em>');
    assert.strictEqual(reads, 0);
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

  test('README states the runtime, pipeline, and output trust contracts', () => {
    var readme = fs.readFileSync(path.join(packageRoot, 'README.md'), 'utf8');
    var manifest = require('../package.json');
    var documentedNode = /Node\.js (\d+) or newer/.exec(readme);

    assert.ok(documentedNode, 'README must state its Node.js floor');
    assert.strictEqual(manifest.engines.node, '>=' + documentedNode[1]);
    assert.match(readme, /var pugneum = require\('pugneum'\);/);
    assert.match(readme, /not an HTML sanitizer/);
    assert.match(readme, /escapes `&` as `&amp;` and `"` as `&quot;`/);
    assert.match(readme, /SVG-like names outside SVG are ordinary paired HTML/);
    assert.match(readme, /selfClosing.*never suppresses the end tag/s);
    assert.match(readme, /explicitly supplied empty\s+named block/);
    assert.match(readme, /code` begins\s+with `PUGNEUM:`/);
    assert.match(readme, /`compilationLimits` \/ `compilationContext`/);
    assert.match(
      readme,
      /renderer iteratively validates the complete direct\s+AST/,
    );
  });

  test('null and undefined nodes fail direct-AST validation', () => {
    [null, undefined].forEach((node) => {
      assert.throws(
        () => render(block([node])),
        (err) =>
          err.code === 'PUGNEUM:INVALID_AST' &&
          /expected a node object/.test(err.message),
      );
    });
  });

  test('direct AST tag names require an ASCII-letter start', () => {
    var source = 'first\ninvalid tag\nthird';
    var cases = [
      tag('1card', [], []),
      {
        type: 'InterpolatedTag',
        expr: '_panel',
        attrs: [],
        attributeBlocks: [],
        block: block([]),
        selfClosing: false,
        isInline: false,
      },
    ];

    cases.forEach((node) => {
      Object.assign(node, {
        line: 2,
        column: 1,
        filename: 'invalid.pg',
      });
      assert.throws(
        () =>
          render(block([node]), {
            sources: {'invalid.pg': source},
          }),
        (err) =>
          err.code === 'PUGNEUM:INVALID_TAG_NAME' &&
          err.msg === 'Tag names must start with an ASCII letter' &&
          err.line === 2 &&
          err.column === 1 &&
          err.filename === 'invalid.pg',
      );
    });
  });

  test('errors and warnings route mapped, fallback, and absent sources', () => {
    var mapped = 'mapped first\nmapped selection\nmapped third';
    var fallback = 'fallback first\nfallback selection\nfallback third';
    var routes = [
      {
        options: {source: fallback, sources: {'partial.pg': mapped}},
        expected: mapped,
        marker: 'mapped selection',
      },
      {
        options: {source: fallback, sources: {'other.pg': mapped}},
        expected: fallback,
        marker: 'fallback selection',
      },
      {
        options: {source: fallback, sources: {'partial.pg': ''}},
        expected: '',
      },
      {options: {}, expected: ''},
    ];

    routes.forEach((route) => {
      var options = Object.assign({filename: 'partial.pg'}, route.options);
      var invalid = tag('1invalid');
      Object.assign(invalid, {
        line: 2,
        column: 3,
        filename: 'partial.pg',
      });
      var failure;
      assert.throws(
        () => render(block([invalid]), options),
        (err) => {
          failure = err;
          return err.code === 'PUGNEUM:INVALID_TAG_NAME';
        },
      );

      var declaration = mixinDef('unused', [], [text('body')]);
      Object.assign(declaration, {
        line: 2,
        column: 3,
        filename: 'partial.pg',
      });
      var warnings = [];
      render(block([declaration]), Object.assign({}, options, {warnings}));

      [failure, warnings[0]].forEach((diagnostic) => {
        assert.strictEqual(diagnostic.filename, 'partial.pg');
        assert.strictEqual(diagnostic.line, 2);
        assert.strictEqual(diagnostic.column, 3);
        assert.strictEqual(diagnostic.source, route.expected);
        if (route.marker) {
          assert.match(diagnostic.message, new RegExp(route.marker));
        } else {
          assert.doesNotMatch(
            diagnostic.message,
            /mapped selection|fallback selection/,
          );
        }
      });
    });
  });

  test('upstream-only nodes name the required pipeline stage', () => {
    var file = () => ({
      type: 'FileReference',
      path: 'dependency.pg',
      line: 2,
      column: 3,
      filename: 'dependency.pg',
    });
    var cases = [
      ['Extends', 'load -> link.assemble', {file: file()}],
      ['Include', 'load -> link.assemble', {block: block([]), file: file()}],
      ['FileReference', 'load -> link.assemble', {path: 'dependency.pg'}],
      ['RawInclude', 'load -> link.assemble', {filters: [], file: file()}],
      ['Filter', 'filter', {name: 'test', attrs: [], block: block([])}],
      ['IncludeFilter', 'filter', {name: 'test', attrs: []}],
      [
        'RawInclude',
        'filter',
        {
          filters: [{type: 'IncludeFilter', name: 'test', attrs: []}],
          file: file(),
        },
      ],
      ['References', 'link.resolve', {definitions: []}],
      [
        'ReferenceLink',
        'link.resolve',
        {name: 'test', attrs: [], block: block([])},
      ],
      [
        'ReferenceImage',
        'link.resolve',
        {name: 'test', attrs: [], block: block([])},
      ],
      ['Footnotes', 'link.resolve', {definitions: []}],
      ['FootnoteRef', 'link.resolve', {name: 'test'}],
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

  test('unknown extension nodes fail direct-AST validation', () => {
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
          err.code === 'PUGNEUM:INVALID_AST' &&
          new RegExp(`unknown node type '${type}'`).test(err.message),
        type,
      );
    });
  });

  test('recursive mixin throws RECURSIVE_MIXIN', () => {
    // mixin loop calls +loop
    var call = mixinCall('loop', []);
    var decl = mixinDef('loop', [], [call]);
    assert.throws(
      () => render(block([decl, mixinCall('loop', [])])),
      (err) =>
        err.code === 'PUGNEUM:RECURSIVE_MIXIN' &&
        /Recursive call to mixin 'loop'/.test(err.message),
    );
  });

  test('mutual recursion throws RECURSIVE_MIXIN', () => {
    // mixin a calls +b, mixin b calls +a
    var declA = mixinDef('a', [], [mixinCall('b', [])]);
    var declB = mixinDef('b', [], [mixinCall('a', [])]);
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
      nodes.push(mixinDef('m' + i, [], [mixinCall('m' + (i + 1), [])]));
    }
    // Final mixin that doesn't call anything
    nodes.push(mixinDef('m' + depth, [], [text('end')]));
    // Kick off the chain
    nodes.push(mixinCall('m0', []));
    assert.throws(
      () => render(block(nodes)),
      (err) => err.code === 'PUGNEUM:MIXIN_STACK_OVERFLOW',
    );
  });
});

// Helper: variable node
function variable(name) {
  return {type: 'Variable', name: name, line: 1, column: 1, filename: 'test'};
}

// Helper: attribute
function attr(name, val, line) {
  return {name: name, val: val, line: line || 1, column: 1};
}

describe('optional arguments', () => {
  test('omitted trailing args produce no text output', () => {
    var decl = mixinDef(
      'greet',
      [{name: 'name'}, {name: 'title'}],
      [tag('p', [], [variable('title'), text(' '), variable('name')])],
    );
    var call = mixinCall('greet', ['Alice']);
    assert.strictEqual(render(block([decl, call])), '<p> Alice</p>');
  });

  test('omitted arg with default uses default value', () => {
    var decl = mixinDef(
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
    var decl = mixinDef(
      'greet',
      [{name: 'name'}, {name: 'title', default: 'friend'}],
      [tag('p', [], [variable('title'), text(' '), variable('name')])],
    );
    var call = mixinCall('greet', ['Alice', 'Doctor']);
    assert.strictEqual(render(block([decl, call])), '<p>Doctor Alice</p>');
  });

  test('all args can be omitted', () => {
    var decl = mixinDef(
      'empty',
      [{name: 'a'}, {name: 'b'}],
      [tag('p', [], [variable('a'), variable('b')])],
    );
    var call = mixinCall('empty', []);
    assert.strictEqual(render(block([decl, call])), '<p></p>');
  });

  test('all defaults used when no args provided', () => {
    var decl = mixinDef(
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
    var decl = mixinDef('m', [{name: 'a'}], []);
    var call = mixinCall('m', ['one', 'two', 'three']);
    assert.throws(
      () => render(block([decl, call])),
      (err) => err.code === 'PUGNEUM:MIXIN_ARGUMENT_COUNT_MISMATCH',
    );
  });

  test('explicit empty string overrides default', () => {
    var decl = mixinDef(
      'm',
      [{name: 'x', default: 'fallback'}],
      [tag('p', [], [variable('x')])],
    );
    var call = mixinCall('m', ['']);
    assert.strictEqual(render(block([decl, call])), '<p></p>');
  });

  test('default with empty string default', () => {
    var decl = mixinDef(
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
    var decl = mixinDef(
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
    var decl = mixinDef(
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
    var decl = mixinDef(
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
    var decl = mixinDef(
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
    var decl = mixinDef(
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
    var decl = mixinDef(
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
    var decl = mixinDef(
      'input',
      [{name: 'type'}],
      [tag('input', [attr('type', '#{type}'), attr('disabled', true)])],
    );
    var call = mixinCall('input', []);
    assert.strictEqual(render(block([decl, call])), '<input disabled>');
  });

  test('static attributes unaffected when variable attribute omitted', () => {
    var decl = mixinDef(
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
    var decl = mixinDef('m', [{name: 'x'}], [tag('p', [], [variable('typo')])]);
    var call = mixinCall('m', ['val']);
    assert.throws(
      () => render(block([decl, call])),
      (err) => err.code === 'PUGNEUM:UNDEFINED_VARIABLE',
    );
  });

  test('undeclared variable in attribute still throws UNDEFINED_VARIABLE', () => {
    var decl = mixinDef(
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
    var inner = mixinDef(
      'inner',
      [{name: 'x'}],
      [tag('span', [], [variable('x')])],
    );
    var outer = mixinDef('outer', [{name: 'x'}], [mixinCall('inner', [])]);
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
    const call = mixinCall(
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
    const call = mixinCall(
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
    const call = mixinCall('wrap', []);
    assert.strictEqual(render(block([decl, call])), 'fallback');
  });

  test('append adds after default content', () => {
    const decl = mixinDef(
      'nav',
      [],
      [namedBlock('links', 'replace', [text('A')])],
      {usesNamedBlocks: true},
    );
    const call = mixinCall(
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
    const call = mixinCall(
      'nav',
      [],
      [namedBlock('links', 'prepend', [text('B')])],
    );
    assert.strictEqual(render(block([decl, call])), 'BA');
  });

  test('many prepends preserve order without shifting accumulated fragments', () => {
    const count = 128;
    const decl = mixinDef(
      'nav',
      [],
      [namedBlock('links', 'replace', [text('base')])],
      {usesNamedBlocks: true},
    );
    const contributions = Array.from({length: count}, (_, index) =>
      namedBlock('links', 'prepend', [text(index + ',')]),
    );
    const call = mixinCall('nav', [], contributions);
    const originalUnshift = Array.prototype.unshift;
    let shifts = 0;
    let output;

    Array.prototype.unshift = function () {
      shifts++;
      return Reflect.apply(originalUnshift, this, arguments);
    };
    try {
      output = render(block([decl, call]));
    } finally {
      Array.prototype.unshift = originalUnshift;
    }

    const expected =
      Array.from({length: count}, (_, index) => count - index - 1 + ',').join(
        '',
      ) + 'base';
    assert.strictEqual(output, expected);
    assert.strictEqual(shifts, 0);
  });

  test('repeated calls do not rescan static named-slot metadata', () => {
    function metadataReads(callCount) {
      let reads = 0;
      const optionalNodes = new Proxy(
        Array.from({length: 64}, () => text('unused')),
        {
          get(target, property, receiver) {
            if (typeof property === 'string' && /^\d+$/.test(property)) {
              reads++;
            }
            return Reflect.get(target, property, receiver);
          },
        },
      );
      const optional = given('optional', optionalNodes);
      const decl = mixinDef('card', [], [optional], {usesNamedBlocks: true});
      const calls = Array.from({length: callCount}, () =>
        mixinCall('card', []),
      );

      assert.strictEqual(render(block([decl].concat(calls))), '');
      return reads;
    }

    assert.strictEqual(metadataReads(100), metadataReads(1));
  });

  for (const [mode, expected] of [
    ['append', 'default:inner|caller'],
    ['prepend', 'caller|default:inner'],
  ]) {
    test(mode + ' keeps the default in the callee parameter scope', () => {
      const decl = mixinDef(
        'wrap',
        [{name: 'label'}],
        [namedBlock('slot', 'replace', [text('default:'), variable('label')])],
        {usesNamedBlocks: true},
      );
      const call = mixinCall(
        'wrap',
        ['inner'],
        [
          namedBlock('slot', mode, [
            text(mode === 'append' ? '|caller' : 'caller|'),
          ]),
        ],
      );

      assert.strictEqual(render(block([decl, call])), expected);
    });
  }

  test('combined slot fragments retain distinct nested lexical scopes', () => {
    const inner = mixinDef(
      'inner',
      [{name: 'label'}],
      [namedBlock('slot', 'replace', [variable('label')])],
      {usesNamedBlocks: true},
    );
    const outer = mixinDef(
      'outer',
      [{name: 'label'}],
      [
        mixinCall(
          'inner',
          ['inner'],
          [namedBlock('slot', 'append', [text('|caller:'), variable('label')])],
        ),
      ],
    );
    const call = mixinCall('outer', ['outer']);

    assert.strictEqual(
      render(block([inner, outer, call])),
      'inner|caller:outer',
    );
  });

  test('final declaration shape overrides stale slot capability flags', () => {
    const decl = mixinDef(
      'layout',
      [],
      [
        tag('header', [], [namedBlock('title', 'replace', [text('default')])]),
        tag('main', [], [mixinBlock()]),
      ],
      {usesNamedBlocks: false, usesUnnamedBlock: false},
    );
    const call = mixinCall(
      'layout',
      [],
      [namedBlock('title', 'replace', [text('Title')]), text('Body')],
    );

    assert.strictEqual(
      render(block([decl, call])),
      '<header>Title</header><main>Body</main>',
    );
  });

  test('removed slots are not retained by stale capability flags', () => {
    const decl = mixinDef('fixed', [], [text('fixed')], {
      usesNamedBlocks: true,
      usesUnnamedBlock: true,
    });
    const call = mixinCall(
      'fixed',
      [],
      [namedBlock('removed', 'replace', [text('ignored')])],
    );

    assert.strictEqual(render(block([decl, call])), 'fixed');
  });

  test('multi-hop nested calls forward an enclosing unnamed slot', () => {
    const leaf = mixinDef('leaf', [], [mixinBlock()], {
      usesUnnamedBlock: true,
    });
    const relay = mixinDef(
      'relay',
      [],
      [mixinCall('leaf', [], [mixinBlock()])],
      {usesUnnamedBlock: false},
    );
    const page = mixinDef(
      'page',
      [],
      [
        namedBlock('title', 'replace', [text('default')]),
        mixinCall('relay', [], [mixinBlock()]),
      ],
      {usesNamedBlocks: true, usesUnnamedBlock: false},
    );
    const call = mixinCall(
      'page',
      [],
      [namedBlock('title', 'replace', [text('Title')]), text('Body')],
    );

    assert.strictEqual(render(block([leaf, relay, page, call])), 'TitleBody');
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
    const call = mixinCall(
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
    const call = mixinCall('wrap', [], [namedBlock('slot', 'replace')]);
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
    const call = mixinCall(
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
    const call = mixinCall(
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
        mixinCall(
          'inner',
          [],
          [namedBlock('slot', 'replace', [text('inner default')])],
        ),
      ],
      {usesNamedBlocks: true},
    );
    const call = mixinCall(
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
    const call = mixinCall('wrap', [], [text('loose content')]);
    assert.throws(
      () => render(block([decl, call])),
      (err) => err.code === 'PUGNEUM:UNEXPECTED_CONTENT_IN_NAMED_BLOCK_CALL',
    );
  });

  test('duplicate replace blocks use last one', () => {
    const decl = mixinDef('wrap', [], [namedBlock('slot', 'replace')], {
      usesNamedBlocks: true,
    });
    const call = mixinCall(
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
    const call = mixinCall(
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
    const call = mixinCall(
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
    const call = mixinCall(
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
      [namedBlock('header', 'replace'), tag('div', [], [mixinBlock()])],
      {usesNamedBlocks: true, usesUnnamedBlock: true},
    );
    const call = mixinCall(
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
        tag('div', [], [mixinBlock()]),
      ],
      {usesNamedBlocks: true, usesUnnamedBlock: true},
    );
    const call = mixinCall('card', [], [text('Body only')]);
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
        tag('div', [], [mixinBlock()]),
      ],
      {usesNamedBlocks: true, usesUnnamedBlock: true},
    );
    const call = mixinCall(
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
      [namedBlock('nav', 'replace'), tag('main', [], [mixinBlock()])],
      {usesNamedBlocks: true, usesUnnamedBlock: true},
    );
    const call = mixinCall(
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
        tag('div', [], [mixinBlock()]),
      ],
      {usesNamedBlocks: true, usesUnnamedBlock: true},
    );
    const call = mixinCall('card', []);
    assert.strictEqual(render(block([decl, call])), 'H<div></div>');
  });

  test('unnamed content at call site for named-only mixin still errors', () => {
    const decl = mixinDef('wrap', [], [namedBlock('slot', 'replace')], {
      usesNamedBlocks: true,
      usesUnnamedBlock: false,
    });
    const call = mixinCall('wrap', [], [text('loose content')]);
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
        tag('div', [], [mixinBlock()]),
      ],
      {usesNamedBlocks: true, usesUnnamedBlock: true},
    );
    const call = mixinCall(
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
        mixinBlock(),
        given('footer', [tag('footer', [], [namedBlock('footer', 'replace')])]),
      ],
      {usesNamedBlocks: true, usesUnnamedBlock: true},
    );
    const call = mixinCall(
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
        mixinBlock(),
        given('footer', [tag('footer', [], [namedBlock('footer', 'replace')])]),
      ],
      {usesNamedBlocks: true, usesUnnamedBlock: true},
    );
    const call = mixinCall('card', [], [text('Body only')]);
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
        mixinBlock(),
        given('footer', [tag('footer', [], [namedBlock('footer', 'replace')])]),
      ],
      {usesNamedBlocks: true, usesUnnamedBlock: true},
    );
    const call = mixinCall(
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
        given('sidebar', [
          tag('aside', [], [namedBlock('sidebar', 'replace')]),
        ]),
      ],
      {usesNamedBlocks: true, usesUnnamedBlock: false},
    );
    const call = mixinCall(
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
        given('sidebar', [
          tag('aside', [], [namedBlock('sidebar', 'replace')]),
        ]),
      ],
      {usesNamedBlocks: true, usesUnnamedBlock: false},
    );
    const call = mixinCall(
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
        mixinBlock(),
        given('nav', [tag('nav', [], [namedBlock('nav', 'replace')])]),
        given('footer', [tag('footer', [], [namedBlock('footer', 'replace')])]),
      ],
      {usesNamedBlocks: true, usesUnnamedBlock: true},
    );
    const call = mixinCall(
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
    const footer = given('footer', [text('content')]);
    assert.throws(
      () => render(block([footer])),
      (err) => err.code === 'PUGNEUM:GIVEN_OUTSIDE_CALL',
    );
  });
});

describe('unused mixin warnings', () => {
  test('unused entry-file mixin pushes one UNUSED_MIXIN warning', () => {
    const decl = mixinDef('unused', [], [tag('p', [], [text('x')])]);
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
    const decl = mixinDef('used', [], [tag('p', [], [text('x')])]);
    const call = mixinCall('used', []);
    const warnings = [];
    render(block([decl, call]), {filename: 'test', warnings});
    assert.strictEqual(warnings.length, 0);
  });

  test('tracks unused redefinitions by declaration identity', () => {
    const first = mixinDef('item', [], [text('first')]);
    const second = mixinDef('item', [], [text('second')]);
    first.line = 1;
    second.line = 3;
    const warnings = [];

    assert.strictEqual(
      render(block([first, mixinCall('item', []), second]), {
        filename: 'test',
        warnings,
      }),
      'first',
    );
    assert.deepStrictEqual(
      warnings.map((warning) => warning.line),
      [3],
    );
  });

  test('warns once for each unused same-name declaration', () => {
    const first = mixinDef('item', [], [text('first')]);
    const second = mixinDef('item', [], [text('second')]);
    first.line = 1;
    second.line = 3;
    const warnings = [];

    render(block([first, second]), {filename: 'test', warnings});

    assert.deepStrictEqual(
      warnings.map((warning) => warning.line),
      [1, 3],
    );
  });

  test('mixin defined in a different file is not flagged', () => {
    // filename !== options.filename means it is a library mixin from an
    // included file; it must not warn even though it is never called.
    const decl = mixinDef('lib', [], [tag('p', [], [text('x')])]);
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
    const decl = mixinDef('unused', [], [tag('p', [], [text('x')])]);
    assert.strictEqual(render(block([decl]), {filename: 'test'}), '');
  });
});

describe('defensive error paths', () => {
  test('unknown block mode throws UNKNOWN_BLOCK_MODE', () => {
    const decl = mixinDef('wrap', [], [namedBlock('slot', 'replace')], {
      usesNamedBlocks: true,
    });
    const call = mixinCall(
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
    const node = mixinBlock();
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
      nodes.push(mixinDef('m' + i, [], [mixinCall('m' + (i + 1), [])]));
    }
    nodes.push(mixinDef('m' + depth, [], [text('end')]));
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
    const h = mixinDef('h', [], [text('h')]);
    const w = mixinDef('w', [], [mixinCall('h', []), mixinCall('h', [])]);
    assert.strictEqual(render(block([h, w, mixinCall('w', [])])), 'hh');
  });

  test('diamond mixin calls are allowed (not recursion)', () => {
    const h = mixinDef('h', [], [text('h')]);
    const a = mixinDef('a', [], [mixinCall('h', [])]);
    const b = mixinDef('b', [], [mixinCall('h', [])]);
    const w = mixinDef('w', [], [mixinCall('a', []), mixinCall('b', [])]);
    assert.strictEqual(render(block([h, a, b, w, mixinCall('w', [])])), 'hh');
  });
});

describe('aggregate compilation limits', () => {
  test('bounds direct-AST validation before recursive rendering', () => {
    const ast = block([text('first'), text('second'), text('third')]);

    assert.throws(
      () => render(ast, {compilationLimits: {astNodes: 2}}),
      (failure) =>
        failure.code === 'PUGNEUM:COMPILATION_LIMIT_EXCEEDED' &&
        failure.resource === 'astNodes' &&
        failure.attempted === 4 &&
        failure.limit === 2,
    );
  });

  test('counts rendered output as UTF-8 bytes', () => {
    assert.throws(
      () => render(block([text('é')]), {compilationLimits: {outputBytes: 1}}),
      (failure) =>
        failure.code === 'PUGNEUM:COMPILATION_LIMIT_EXCEEDED' &&
        failure.resource === 'outputBytes' &&
        failure.attempted === 2 &&
        failure.limit === 1 &&
        failure.filename === 'test',
    );
  });

  test('bounds cumulative mixin calls across completed siblings', () => {
    const ast = block([
      mixinDef('item', [], [text('item')]),
      mixinCall('item', []),
      mixinCall('item', []),
    ]);

    assert.throws(
      () => render(ast, {compilationLimits: {mixinInvocations: 1}}),
      (failure) =>
        failure.code === 'PUGNEUM:COMPILATION_LIMIT_EXCEEDED' &&
        failure.resource === 'mixinInvocations' &&
        failure.attempted === 2 &&
        failure.limit === 1,
    );
  });

  test('bounds warnings before mutating the caller collector', () => {
    const warnings = [];
    assert.throws(
      () =>
        render(mixinDef('unused', [], [text('body')]), {
          filename: 'test',
          warnings,
          compilationLimits: {diagnostics: 0},
        }),
      (failure) =>
        failure.code === 'PUGNEUM:COMPILATION_LIMIT_EXCEEDED' &&
        failure.resource === 'diagnostics' &&
        failure.attempted === 1 &&
        failure.limit === 0,
    );
    assert.deepStrictEqual(warnings, []);
  });
});

describe('attribute escaping after substitution', () => {
  test('mixin-arg value with breakout characters is escaped in attribute', () => {
    // Security-relevant: resolveAttrValue runs first, escapeAttrValue second.
    // A value containing " and & must be escaped so it cannot break out of the
    // quoted attribute.
    const decl = mixinDef(
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
