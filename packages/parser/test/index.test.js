'use strict';

var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');
var {test, describe} = require('node:test');
var parse = require('../');
var lex = require('pugneum-lexer');

var testCasesDir = path.resolve(__dirname, '../../../test-cases');
var fixtureManifest = require('../../../test-cases/manifest.json');
var testCases = fixtureManifest.render
  .map((name) => name + '.pg')
  .concat(
    fixtureManifest.syntax,
    fixtureManifest.dependencies.filter((name) => name.endsWith('.pg')),
  )
  .sort();

function read(filename) {
  return fs.readFileSync(path.join(testCasesDir, filename), 'utf8');
}

function parseSource(source, filename) {
  filename = filename || 'test.pg';
  return parse(lex(source, {filename}), {filename, source});
}

function parseFixture(filename) {
  return parseSource(read(filename), filename);
}

function nestedIndentedSource(head, depth) {
  return Array.from(
    {length: depth},
    (_, index) => '  '.repeat(index) + head,
  ).join('\n');
}

function nestedColonSource(depth) {
  return Array(depth - 1)
    .fill('div:')
    .concat('p end')
    .join(' ');
}

function nestedInlineSource(depth) {
  return 'p ' + '*('.repeat(depth) + 'end' + ')'.repeat(depth);
}

function typedNodes(root) {
  const result = [];
  const pending = [root];
  while (pending.length > 0) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      for (const element of value) pending.push(element);
      continue;
    }
    if (typeof value.type === 'string') result.push(value);
    for (const child of Object.values(value)) pending.push(child);
  }
  return result;
}

testCases.forEach(function (filename) {
  test(filename, (t) => {
    t.assert.snapshot(parseFixture(filename));
  });
});

test('shared nested empty source parses as an empty root block', () => {
  var filename = 'fixtures/empty.pg';
  var ast = parseFixture(filename);
  assert.strictEqual(ast.type, 'Block');
  assert.deepStrictEqual(ast.nodes, []);
  assert.strictEqual(ast.filename, filename);
});

test('shared nested doctype parses as canonical leading text', () => {
  var filename = 'auxiliary/blocks-in-blocks-layout.pg';
  var ast = parseFixture(filename);
  assert.deepStrictEqual(ast.nodes[0], {
    type: 'Text',
    line: 1,
    column: 1,
    filename,
    val: '<!DOCTYPE html>',
  });
});

describe('error paths', () => {
  test('BLOCK_OUTSIDE_MIXIN when block keyword used outside mixin', () => {
    assert.throws(
      () => parseSource('p hello\nblock'),
      (err) => err.code === 'PUGNEUM:BLOCK_OUTSIDE_MIXIN',
    );
  });

  test('VARIABLE_OUTSIDE_MIXIN when #{var} used in text outside mixin', () => {
    assert.throws(
      () => parseSource('p #{name}'),
      (err) => err.code === 'PUGNEUM:VARIABLE_OUTSIDE_MIXIN',
    );
  });

  test('MULTIPLE_ATTRIBUTES when tag has two attribute blocks', () => {
    assert.throws(
      () => parseSource('div(a="1")(b="2")'),
      (err) => err.code === 'PUGNEUM:MULTIPLE_ATTRIBUTES',
    );
  });

  test('DUPLICATE_ID is independent of id syntax and ordering', () => {
    var cases = [
      ['#a#b', 3],
      ['div(id=a id=b)', 10],
      ['div#a(id=b)', 7],
      ['div(id=a)#b', 10],
    ];

    cases.forEach(([source, column]) => {
      assert.throws(
        () => parseSource(source),
        (err) =>
          err.code === 'PUGNEUM:DUPLICATE_ID' &&
          err.msg === 'Duplicate attribute "id" is not allowed.' &&
          err.line === 1 &&
          err.column === column &&
          err.filename === 'test.pg',
        source,
      );
    });
  });

  test('DUPLICATE_ATTRIBUTE when same attribute appears twice', () => {
    assert.throws(
      () => parseSource('div(title="a" title="b")'),
      (err) =>
        err.code === 'PUGNEUM:DUPLICATE_ATTRIBUTE' &&
        err.msg === 'Duplicate attribute "title" is not allowed.' &&
        err.column === 15,
    );
  });

  test('HTML attribute uniqueness is ASCII-case-insensitive', () => {
    [
      {
        source: 'div(ID=a id=b)',
        duplicate: 'id=b',
        code: 'DUPLICATE_ID',
        name: 'id',
      },
      {
        source: 'div(title=a TITLE=b)',
        duplicate: 'TITLE=b',
        code: 'DUPLICATE_ATTRIBUTE',
        name: 'title',
      },
      {
        source: 'div(data-X=a data-x=b)',
        duplicate: 'data-x=b',
        code: 'DUPLICATE_ATTRIBUTE',
        name: 'data-x',
      },
    ].forEach(({source, duplicate, code, name}) => {
      assert.throws(
        () => parseSource(source),
        (err) => {
          assert.strictEqual(err.code, 'PUGNEUM:' + code);
          assert.strictEqual(
            err.msg,
            'Duplicate attribute "' + name + '" is not allowed.',
          );
          assert.strictEqual(err.column, source.indexOf(duplicate) + 1);
          return true;
        },
        source,
      );
    });
  });

  test('ASCII-case variants of class retain merge semantics', () => {
    const ast = parseSource('div(CLASS=a Class=b class=c)');

    assert.deepStrictEqual(
      ast.nodes[0].attrs.map(({name, val}) => ({name, val})),
      [
        {name: 'class', val: 'a'},
        {name: 'class', val: 'b'},
        {name: 'class', val: 'c'},
      ],
    );
  });

  test('reference attributes cannot duplicate resolver-owned names', () => {
    [
      {
        source: 'p @[docs](href=/override)',
        duplicate: 'href=',
        name: 'href',
      },
      {
        source: 'p @[docs](HREF=/override)',
        duplicate: 'HREF=',
        name: 'href',
      },
      {
        source: 'p ![logo alt](src=/override)',
        duplicate: 'src=',
        name: 'src',
      },
      {
        source: 'p ![logo alt](ALT=override)',
        duplicate: 'ALT=',
        name: 'alt',
      },
    ].forEach(({source, duplicate, name}) => {
      assert.throws(
        () => parseSource(source),
        (err) => {
          assert.strictEqual(err.code, 'PUGNEUM:DUPLICATE_ATTRIBUTE');
          assert.strictEqual(
            err.msg,
            'Duplicate attribute "' + name + '" is not allowed.',
          );
          assert.deepStrictEqual(
            {line: err.line, column: err.column, filename: err.filename},
            {
              line: 1,
              column: source.indexOf(duplicate) + 1,
              filename: 'test.pg',
            },
          );
          return true;
        },
        source,
      );
    });
  });

  test('grammar diagnostics expose complete source and formatted location', () => {
    const source = 'p before\ndiv(title=a title=b)\np after';
    assert.throws(
      () => parseSource(source),
      (err) => {
        assert.deepStrictEqual(
          {
            code: err.code,
            msg: err.msg,
            line: err.line,
            column: err.column,
            filename: err.filename,
            source: err.source,
          },
          {
            code: 'PUGNEUM:DUPLICATE_ATTRIBUTE',
            msg: 'Duplicate attribute "title" is not allowed.',
            line: 2,
            column: 13,
            filename: 'test.pg',
            source,
          },
        );
        assert.strictEqual(
          err.message,
          [
            'test.pg:2:13',
            '    1| p before',
            '  > 2| div(title=a title=b)',
            '-------------------^',
            '    3| p after',
            '',
            'Duplicate attribute "title" is not allowed.',
          ].join('\n'),
        );
        return true;
      },
    );
  });

  test('DUPLICATE_FILTER_OPTION rejects exact names in both filter forms', () => {
    [
      {
        source: ':probe(option=first option=second)\n  body',
        duplicate: 'option=second',
        name: 'option',
      },
      {
        source: ':probe(class=first class=second)\n  body',
        duplicate: 'class=second',
        name: 'class',
      },
      {
        source: 'include:probe(option=first option=second) data.txt',
        duplicate: 'option=second',
        name: 'option',
      },
    ].forEach(({source, duplicate, name}) => {
      assert.throws(
        () => parseSource(source),
        (err) => {
          assert.strictEqual(err.code, 'PUGNEUM:DUPLICATE_FILTER_OPTION');
          assert.strictEqual(
            err.msg,
            'Duplicate filter option "' + name + '" is not allowed.',
          );
          assert.deepStrictEqual(
            {line: err.line, column: err.column, filename: err.filename},
            {
              line: 1,
              column: source.indexOf(duplicate) + 1,
              filename: 'test.pg',
            },
          );
          return true;
        },
      );
    });
  });

  test('RESERVED_FILTER_OPTION rejects filename in both filter forms', () => {
    [
      ':probe(filename=claimed.pg)\n  body',
      'include:probe(filename=claimed.pg) data.txt',
    ].forEach((source) => {
      assert.throws(
        () => parseSource(source),
        (err) => {
          assert.strictEqual(err.code, 'PUGNEUM:RESERVED_FILTER_OPTION');
          assert.strictEqual(
            err.msg,
            'Filter option "filename" is reserved for the invocation filename.',
          );
          assert.deepStrictEqual(
            {line: err.line, column: err.column, filename: err.filename},
            {
              line: 1,
              column: source.indexOf('filename=') + 1,
              filename: 'test.pg',
            },
          );
          return true;
        },
      );
    });
  });

  test('filter option names stay case-sensitive and source-ordered', () => {
    const ast = parseSource(':probe(option=first Option=second)\n  body');
    assert.deepStrictEqual(
      ast.nodes[0].attrs.map(({name, val}) => ({name, val})),
      [
        {name: 'option', val: 'first'},
        {name: 'Option', val: 'second'},
      ],
    );
  });

  test('INVALID_TOKEN for unexpected token in tag-content position', () => {
    var tokens = lex('div', {filename: 'test.pg'});
    tokens.splice(1, 0, {type: 'bogus', loc: {start: {line: 1, column: 4}}});
    assert.throws(
      () => parse(tokens, {filename: 'test.pg'}),
      (err) =>
        err.code === 'PUGNEUM:INVALID_TOKEN' &&
        err.msg === 'Unexpected token `bogus` while parsing tag content',
    );
  });

  test('INVALID_TOKEN from the _parseExpr default fires on a bogus leading token', () => {
    // Splicing the bogus token after `div` enters tag()'s tag-position default
    // (message "Unexpected token `...`"). A bogus token in expression position
    // (index 0) instead hits the _parseExpr dispatch default, whose distinct
    // message is "unexpected token \"...\"". Pin that branch by its message so
    // a regression collapsing it into another arm cannot pass silently.
    const loc = {start: {line: 1, column: 1}};
    const tokens = [
      {type: 'bogus', loc},
      {type: 'eos', loc},
    ];
    assert.throws(
      () => parse(tokens, {filename: 'test.pg'}),
      (err) =>
        err.code === 'PUGNEUM:INVALID_TOKEN' &&
        /unexpected token "bogus"/.test(err.msg),
    );
  });

  test('INVALID_TOKEN messages distinguish the ref-link/ref-image/footnote scan loops', () => {
    // parseRefLinkContent, parseRefImageContent and the parseFootnotes inner
    // loop each have their own INVALID_TOKEN default with a distinct noun.
    // These reach() through a hand-built token stream only; assert the message
    // so each branch is individually pinned (they were previously untested).
    const loc = {start: {line: 1, column: 1}};
    const expectMsg = (tokens, re) =>
      assert.throws(
        () => parse(tokens, {filename: 'test.pg'}),
        (err) => err.code === 'PUGNEUM:INVALID_TOKEN' && re.test(err.msg),
      );

    expectMsg(
      [
        {type: 'start-ref-link', val: 'x', loc},
        {type: 'footnotes', loc},
        {type: 'end-ref-link', loc},
        {type: 'eos', loc},
      ],
      /Unexpected token in reference link: footnotes/,
    );
    expectMsg(
      [
        {type: 'start-ref-image', val: 'x', loc},
        {type: 'footnotes', loc},
        {type: 'end-ref-image', loc},
        {type: 'eos', loc},
      ],
      /Unexpected token in reference image: footnotes/,
    );
    expectMsg(
      [
        {type: 'footnotes', loc},
        {type: 'footnote-def-start', val: 'n', loc},
        {type: 'toc', loc},
        {type: 'footnote-def-end', loc},
        {type: 'eos', loc},
      ],
      /Unexpected token in footnote definition: toc/,
    );
  });

  test('MIXIN_WITHOUT_BODY for mixin with no indented block', () => {
    assert.throws(
      () => parseSource('mixin foo'),
      (err) => err.code === 'PUGNEUM:MIXIN_WITHOUT_BODY',
    );
  });

  test('DUPLICATE_MIXIN_PARAMETER rejects exact duplicate bindings', () => {
    [
      {source: 'mixin m(x x)\n  p #{x}', name: 'x'},
      {source: 'mixin m(x? x?)\n  p #{x?}', name: 'x?'},
      {source: 'mixin m(x=one x=two)\n  p #{x}', name: 'x'},
    ].forEach(({source, name}) => {
      assert.throws(
        () => parseSource(source),
        (err) => {
          assert.strictEqual(err.code, 'PUGNEUM:DUPLICATE_MIXIN_PARAMETER');
          assert.strictEqual(
            err.msg,
            'Duplicate mixin parameter "' + name + '" is not allowed.',
          );
          assert.deepStrictEqual(
            {line: err.line, column: err.column, filename: err.filename},
            {line: 1, column: 1, filename: 'test.pg'},
          );
          return true;
        },
      );
    });
  });

  test('RAW_INCLUDE_BLOCK for raw include with block content', () => {
    assert.throws(
      () => parseSource('include:verbatim file.txt\n  p not allowed'),
      (err) => err.code === 'PUGNEUM:RAW_INCLUDE_BLOCK',
    );
  });

  test('explicit and implicit tags share the exact depth boundary', () => {
    ['div', '.item', '#item'].forEach((head) => {
      [255, 256].forEach((depth) => {
        assert.doesNotThrow(
          () => parseSource(nestedIndentedSource(head, depth)),
          head + ' at depth ' + depth,
        );
      });

      const source = nestedIndentedSource(head, 257);
      assert.throws(
        () => parseSource(source),
        (err) => {
          assert.strictEqual(err.code, 'PUGNEUM:NESTING_TOO_DEEP');
          assert.deepStrictEqual(
            {
              line: err.line,
              column: err.column,
              filename: err.filename,
              source: err.source,
            },
            {line: 257, column: 513, filename: 'test.pg', source},
          );
          assert.match(err.message, /^test\.pg:257:513\n/);
          assert.match(err.message, /\n  > 257\| /);
          return true;
        },
      );
    });
  });

  test('colon expansion pins and restores the exact depth boundary', () => {
    [255, 256].forEach((depth) => {
      assert.doesNotThrow(() => parseSource(nestedColonSource(depth)));
    });
    assert.throws(
      () => parseSource(nestedColonSource(257)),
      (err) => err.code === 'PUGNEUM:NESTING_TOO_DEEP',
    );

    const deepestBranch = nestedIndentedSource('div', 256);
    assert.doesNotThrow(() =>
      parseSource(deepestBranch + '\n' + deepestBranch),
    );
    assert.doesNotThrow(() => parseSource(nestedColonSource(256)));
  });

  test('lexer and parser share the inline shorthand depth boundary', () => {
    const deepestAccepted = nestedInlineSource(255);
    const tokens = lex(deepestAccepted, {filename: 'test.pg'});
    assert.doesNotThrow(() =>
      parse(tokens, {filename: 'test.pg', source: deepestAccepted}),
    );

    assert.throws(
      () => lex(nestedInlineSource(256), {filename: 'test.pg'}),
      (err) => {
        assert.strictEqual(err.code, 'PUGNEUM:NESTING_TOO_DEEP');
        assert.strictEqual(
          err.msg,
          'Template nesting exceeds maximum depth of 256',
        );
        return true;
      },
    );
  });

  test('mixin with both unnamed and named blocks sets both flags', (t) => {
    const source = 'mixin both\n  block name\n  block';
    const ast = parseSource(source, 'test');
    const mixin = ast.nodes[0];
    assert.strictEqual(mixin.usesNamedBlocks, true);
    assert.strictEqual(mixin.usesUnnamedBlock, true);
  });

  test('mixin with only unnamed block sets usesUnnamedBlock only', (t) => {
    const source = 'mixin simple\n  div\n    block';
    const ast = parseSource(source, 'test');
    const mixin = ast.nodes[0];
    assert.strictEqual(mixin.usesNamedBlocks, false);
    assert.strictEqual(mixin.usesUnnamedBlock, true);
  });

  test('mixin with only named blocks sets usesNamedBlocks only', (t) => {
    const source = 'mixin named\n  block header\n  block body';
    const ast = parseSource(source, 'test');
    const mixin = ast.nodes[0];
    assert.strictEqual(mixin.usesNamedBlocks, true);
    assert.strictEqual(mixin.usesUnnamedBlock, false);
  });

  test('unnamed block mixin with nested named-block call does not set usesNamedBlocks', (t) => {
    const source =
      'mixin outer\n  block\n  +inner\n    block slot\n      | content';
    const ast = parseSource(source, 'test');
    const mixin = ast.nodes[0];
    assert.strictEqual(mixin.usesNamedBlocks, false);
    assert.strictEqual(mixin.usesUnnamedBlock, true);
  });
});

test('preserves private attribute interpolation provenance', () => {
  const interpolationSource = Symbol.for(
    'pugneum.attributeInterpolationSource',
  );
  const ast = parseSource('div(data-x="\\\\#{x}")');
  const attr = ast.nodes[0].attrs[0];

  assert.strictEqual(attr.val, '\\#{x}');
  assert.strictEqual(attr[interpolationSource], '\\\\#{x}');
  assert.strictEqual(
    Object.getOwnPropertyDescriptor(attr, interpolationSource).enumerable,
    false,
  );
});

test('the inline grammar accepts every lexer inline-start token', () => {
  const source =
    'mixin inline(v)\n' +
    '  p text#{v} #(strong bold) @[docs label] ![logo alt] ^[note]';
  const tokens = lex(source, {filename: 'inline.pg'});
  const tokenTypes = new Set(tokens.map((token) => token.type));
  const inlineStarts = [
    'text',
    'variable',
    'start-interpolation',
    'start-ref-link',
    'start-ref-image',
    'start-footnote-ref',
  ];

  inlineStarts.forEach((type) => {
    assert.ok(tokenTypes.has(type), 'fixture must emit ' + type);
  });

  const ast = parse(tokens, {filename: 'inline.pg', source});
  const nodeTypes = new Set(typedNodes(ast).map((node) => node.type));
  [
    'Text',
    'Variable',
    'Tag',
    'ReferenceLink',
    'ReferenceImage',
    'FootnoteRef',
  ].forEach((type) => {
    assert.ok(nodeTypes.has(type), 'parser must retain ' + type);
  });
});

describe('direct variable continuations', () => {
  function contentSignature(tag) {
    return tag.block.nodes
      .filter((node) => node.type !== 'Text' || node.val !== '')
      .map((node) => {
        if (node.type === 'Variable') return ['Variable', node.name];
        if (node.type === 'Text') return ['Text', node.val];
        if (node.type === 'Tag') return ['Tag', node.name];
        return [node.type];
      });
  }

  test('same-line suffixes stay in their owning tag and nesting scope', () => {
    const source = [
      'mixin show(x)',
      '  div',
      '    p#{x} tail',
      '    p#{x}#{x}',
      '    p#{x}tail',
      '    p #{x} tail',
      '    p#{x}*(bold)',
      '  #{x}tail',
    ].join('\n');
    const ast = parseSource(source, 'variables.pg');
    const mixin = ast.nodes[0];
    const container = mixin.block.nodes[0];

    assert.deepStrictEqual(
      container.block.nodes.map((node) => node.name),
      ['p', 'p', 'p', 'p', 'p'],
    );
    assert.deepStrictEqual(container.block.nodes.map(contentSignature), [
      [
        ['Variable', 'x'],
        ['Text', ' tail'],
      ],
      [
        ['Variable', 'x'],
        ['Variable', 'x'],
      ],
      [
        ['Variable', 'x'],
        ['Text', 'tail'],
      ],
      [
        ['Variable', 'x'],
        ['Text', ' tail'],
      ],
      [
        ['Variable', 'x'],
        ['Tag', 'strong'],
      ],
    ]);
    assert.deepStrictEqual(
      mixin.block.nodes
        .slice(1)
        .map((node) =>
          node.type === 'Variable'
            ? [node.type, node.name]
            : [node.type, node.val],
        ),
      [
        ['Variable', 'x'],
        ['Text', 'tail'],
      ],
    );
  });
});

describe('given keyword', () => {
  test('given produces Given node with name and block', (t) => {
    const source = 'mixin card\n  given header\n    h1 Title';
    const ast = parseSource(source, 'test');
    const mixin = ast.nodes[0];
    const givenNode = mixin.block.nodes[0];
    assert.strictEqual(givenNode.type, 'Given');
    assert.strictEqual(givenNode.name, 'header');
    assert.ok(givenNode.block);
    assert.strictEqual(givenNode.block.nodes[0].type, 'Tag');
    assert.strictEqual(givenNode.block.nodes[0].name, 'h1');
  });

  test('given outside mixin throws GIVEN_OUTSIDE_MIXIN', (t) => {
    const source = 'given header\n  h1 Title';
    assert.throws(
      () => parseSource(source, 'test'),
      (err) => err.code === 'PUGNEUM:GIVEN_OUTSIDE_MIXIN',
    );
  });

  test('given sets usesNamedBlocks on containing mixin', (t) => {
    const source = 'mixin card\n  block\n  given footer\n    p foot';
    const ast = parseSource(source, 'test');
    const mixin = ast.nodes[0];
    assert.strictEqual(mixin.usesNamedBlocks, true);
    assert.strictEqual(mixin.usesUnnamedBlock, true);
  });

  test('given inside mixin call block throws GIVEN_OUTSIDE_MIXIN', (t) => {
    const source = 'mixin outer\n  +inner\n    given slot\n      p hi';
    assert.throws(
      () => parseSource(source, 'test'),
      (err) => err.code === 'PUGNEUM:GIVEN_OUTSIDE_MIXIN',
    );
  });

  // Given validity is decided by the top of the lexical mixin-context stack;
  // aggregate definition/call counts cannot express "innermost" and mis-decide
  // both nesting directions below.
  test('given inside a mixin DEFINITION nested in a call block is accepted', (t) => {
    // Both a call and a definition are open, but the definition is innermost.
    const source =
      'mixin host\n  block\n+host\n  mixin nested\n    given slot\n      p y';
    const ast = parseSource(source, 'test');
    const call = ast.nodes.find((n) => n.type === 'Mixin' && n.call);
    const nested = call.block.nodes.find((n) => n.type === 'Mixin');
    const given = nested.block.nodes.find((n) => n.type === 'Given');
    assert.ok(given, 'given inside the nested definition should be parsed');
    assert.strictEqual(given.name, 'slot');
  });

  test('given lexically inside a call block (with more defs than calls stacked) throws', (t) => {
    // Two definitions are open, but the call is innermost.
    const source = 'mixin a\n  mixin b\n    +c\n      given slot\n        p hi';
    assert.throws(
      () => parseSource(source, 'test'),
      (err) => err.code === 'PUGNEUM:GIVEN_OUTSIDE_MIXIN',
    );
  });
});

describe('parser structure and boundary regressions', () => {
  test('HTML inline classification is ASCII-case-insensitive without rewriting names', () => {
    const source = 'SPAN text\nDiv block';
    const ast = parseSource(source, 'case.pg');

    assert.deepStrictEqual(
      ast.nodes.map((node) => ({name: node.name, isInline: node.isInline})),
      [
        {name: 'SPAN', isInline: true},
        {name: 'Div', isInline: false},
      ],
    );
  });

  test('zero-length lexer padding is not materialized as Text nodes', () => {
    for (const filename of testCases) {
      const source = read(filename);
      const ast = parseSource(source, filename);
      const emptyText = typedNodes(ast).filter(
        (node) => node.type === 'Text' && node.val === '',
      );
      assert.strictEqual(
        emptyText.length,
        0,
        filename + ' contains an empty Text node',
      );
    }
  });

  test('adjacent inline shorthands scale to one meaningful child each', () => {
    const count = 1000;
    const source = 'p ' + '*(x)'.repeat(count);
    const ast = parseSource(source, 'adjacent.pg');
    const paragraph = ast.nodes[0];

    assert.strictEqual(paragraph.block.nodes.length, count);
    assert.ok(
      paragraph.block.nodes.every(
        (node) =>
          node.type === 'Tag' &&
          node.name === 'strong' &&
          node.block.nodes.length === 1 &&
          node.block.nodes[0].type === 'Text' &&
          node.block.nodes[0].val === 'x',
      ),
    );
    assert.strictEqual(
      typedNodes(ast).filter((node) => node.type === 'Text' && node.val === '')
        .length,
      0,
    );
  });

  test('continued text-block line beginning with #{var} keeps the line separator', (t) => {
    // collectInlineContent must emit the joining '\n' whenever more inline
    // content follows, not only when the next token is literal text. Gating on
    // 'text' alone dropped the separator before an interpolation, gluing the
    // two lines' words together (e.g. <p>alphaVALUE beta</p>).
    const source = 'mixin m(x)\n  p\n    | alpha\n    | #{x} beta';
    const ast = parseSource(source, 'test');
    const p = ast.nodes[0].block.nodes.find(
      (n) => n.type === 'Tag' && n.name === 'p',
    );
    const kinds = p.block.nodes.map((n) =>
      n.type === 'Text' ? JSON.stringify(n.val) : n.type,
    );
    assert.deepStrictEqual(kinds, ['"alpha"', '"\\n"', 'Variable', '" beta"']);
  });

  test('a trailing newline before the end of a text block is not turned into a separator', (t) => {
    // The new gate must still suppress the separator when nothing inline
    // follows the newline (outdent/eos), so no spurious trailing '\n' appears.
    const source = 'mixin m(x)\n  p\n    | alpha\n    | beta\n  div';
    const ast = parseSource(source, 'test');
    const p = ast.nodes[0].block.nodes.find(
      (n) => n.type === 'Tag' && n.name === 'p',
    );
    const vals = p.block.nodes
      .filter((n) => n.type === 'Text')
      .map((n) => n.val);
    assert.deepStrictEqual(vals, ['alpha', '\n', 'beta']);
  });

  test('a single long inline-shorthand line parses without a raw RangeError', (t) => {
    // tag() must flush collected inline nodes with an in-place push loop, not
    // push.apply(...spread): a line with more inline nodes than V8's apply
    // argument-spread limit threw a raw RangeError (no PUGNEUM code) instead of
    // parsing. A synthetic token stream of many text tokens on one logical line
    // reproduces the exact flush at the crash site.
    const N = 150000;
    const loc = {start: {line: 1, column: 1}, end: {line: 1, column: 1}};
    const tokens = [{type: 'tag', val: 'p', loc}];
    for (let i = 0; i < N; ++i) tokens.push({type: 'text', val: 'a', loc});
    tokens.push({type: 'eos', loc});
    const ast = parse(tokens, {filename: 'test'});
    assert.strictEqual(ast.nodes[0].block.nodes.length, N);
  });

  test('a multi-line footnote body does not gain a spurious leading space', (t) => {
    // parseFootnotes joins multi-line footnote bodies with a single space, but
    // the space is a separator: it must appear BETWEEN content, never lead it.
    // When the body starts on the line after the name, the lexer emits a
    // leading newline token; converting it unconditionally to a space
    // prepended a stray U+0020 (rendered footnote " first line second line").
    const source = [
      'p ^[n] z',
      '',
      'footnotes',
      '  n',
      '    one',
      '    two',
    ].join('\n');
    const ast = parseSource(source, 'test');
    const def = ast.nodes.find((n) => n.type === 'Footnotes').definitions[0];
    assert.strictEqual(def.block.isFootnoteBody, true);
    const vals = def.block.nodes
      .filter((n) => n.type === 'Text')
      .map((n) => n.val);
    // No leading separator; the interior newline still joins the two lines.
    assert.deepStrictEqual(vals, ['one', ' ', 'two']);
    assert.strictEqual(def.block.nodes[1].isFootnoteSeparator, true);
  });

  test('footnote definitions preserve inline references, attrs, and separators', () => {
    const source = [
      'references',
      '  doc https://example.test/doc',
      '  logo https://example.test/logo.png',
      '',
      'p Cite^[one].',
      '',
      'footnotes',
      '  one See @[doc documentation](class=source) and ![logo diagram](class=icon).',
      '    Continue ^[two].',
      '  two Next.',
    ].join('\n');
    const ast = parseSource(source, 'footnotes.pg');
    const footnotes = ast.nodes.find((node) => node.type === 'Footnotes');
    const nodes = footnotes.definitions[0].block.nodes;

    assert.deepStrictEqual(
      nodes.map((node) => node.type),
      [
        'Text',
        'ReferenceLink',
        'Text',
        'ReferenceImage',
        'Text',
        'Text',
        'Text',
        'FootnoteRef',
        'Text',
      ],
    );
    assert.deepStrictEqual(
      {
        name: nodes[1].name,
        text: nodes[1].block.nodes[0].val,
        attrs: nodes[1].attrs.map(({name, val}) => ({name, val})),
        line: nodes[1].line,
        column: nodes[1].column,
        filename: nodes[1].filename,
      },
      {
        name: 'doc',
        text: 'documentation',
        attrs: [{name: 'class', val: 'source'}],
        line: 8,
        column: 11,
        filename: 'footnotes.pg',
      },
    );
    assert.deepStrictEqual(
      {
        name: nodes[3].name,
        alt: nodes[3].block.nodes[0].val,
        attrs: nodes[3].attrs.map(({name, val}) => ({name, val})),
        line: nodes[3].line,
        column: nodes[3].column,
        filename: nodes[3].filename,
      },
      {
        name: 'logo',
        alt: 'diagram',
        attrs: [{name: 'class', val: 'icon'}],
        line: 8,
        column: 50,
        filename: 'footnotes.pg',
      },
    );
    assert.deepStrictEqual(
      {
        val: nodes[5].val,
        separator: nodes[5].isFootnoteSeparator,
        line: nodes[5].line,
        column: nodes[5].column,
      },
      {val: ' ', separator: true, line: 9, column: 1},
    );
    assert.deepStrictEqual(
      {name: nodes[7].name, line: nodes[7].line, column: nodes[7].column},
      {name: 'two', line: 9, column: 14},
    );
  });

  test('pipeless text preserves reference images and footnote refs', () => {
    const source = [
      'references',
      '  logo /logo.png',
      '',
      'p.',
      '  Before ![logo alt](class=hero)',
      '  after ^[note].',
      '',
      'footnotes',
      '  note Note.',
    ].join('\n');
    const ast = parseSource(source, 'pipeless.pg');
    const paragraph = ast.nodes.find(
      (node) => node.type === 'Tag' && node.name === 'p',
    );
    const nodes = paragraph.block.nodes;

    assert.deepStrictEqual(
      nodes.map((node) => node.type),
      ['Text', 'ReferenceImage', 'Text', 'Text', 'FootnoteRef', 'Text', 'Text'],
    );
    assert.deepStrictEqual(
      nodes.filter((node) => node.type === 'Text').map((node) => node.val),
      ['Before ', '\n', 'after ', '.', '\n'],
    );
    assert.deepStrictEqual(
      {
        name: nodes[1].name,
        alt: nodes[1].block.nodes[0].val,
        attrs: nodes[1].attrs.map(({name, val}) => ({name, val})),
        line: nodes[1].line,
        column: nodes[1].column,
        filename: nodes[1].filename,
      },
      {
        name: 'logo',
        alt: 'alt',
        attrs: [{name: 'class', val: 'hero'}],
        line: 5,
        column: 10,
        filename: 'pipeless.pg',
      },
    );
    assert.deepStrictEqual(
      {
        name: nodes[4].name,
        line: nodes[4].line,
        column: nodes[4].column,
        filename: nodes[4].filename,
      },
      {name: 'note', line: 6, column: 9, filename: 'pipeless.pg'},
    );
  });

  test('footnote joins are pending, coalesced, and never terminal', () => {
    const source = ['p ^[n] z', '', 'footnotes', '  n first', '    '].join(
      '\n',
    );
    const ast = parseSource(source, 'test');
    const def = ast.nodes.find((n) => n.type === 'Footnotes').definitions[0];

    assert.strictEqual(def.block.isFootnoteBody, true);
    assert.deepStrictEqual(
      def.block.nodes.map((node) => ({
        val: node.val,
        separator: node.isFootnoteSeparator === true,
      })),
      [{val: 'first', separator: false}],
    );
  });

  test('a block with many text children has linear accumulation work and output', () => {
    // block() must accumulate Block-typed children with in-place push rather
    // than repeatedly reallocating the growing destination with Array.concat.
    // Count the elements copied by any concat during parsing so the old O(n^2)
    // implementation cannot pass merely by producing the right final AST.
    const N = 400;
    const lines = ['mixin m(v)'];
    for (let i = 0; i < N; ++i) {
      lines.push('  div');
      lines.push('  | a #{v} b');
    }
    const source = lines.join('\n');
    const tokens = lex(source, {filename: 'test'});
    const originalConcat = Array.prototype.concat;
    let copiedElements = 0;
    Array.prototype.concat = function (...items) {
      copiedElements += this.length;
      for (const item of items) {
        copiedElements += Array.isArray(item) ? item.length : 1;
      }
      return originalConcat.apply(this, items);
    };

    let ast;
    try {
      ast = parse(tokens, {filename: 'test', source});
    } finally {
      Array.prototype.concat = originalConcat;
    }

    // N `div` tags + N piped-text Blocks (each contributing 3 nodes) = 4N nodes.
    assert.strictEqual(ast.nodes[0].block.nodes.length, 4 * N);
    assert.ok(
      copiedElements <= 20 * N,
      'parser copied ' + copiedElements + ' array elements for N=' + N,
    );
  });
});
