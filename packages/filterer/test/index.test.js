'use strict';

var path = require('path');
var assert = require('node:assert/strict');
var {test} = require('node:test');

var lex = require('pugneum-lexer');
var parse = require('pugneum-parser');
var filter = require('../');

var filename = path.basename(__filename);

var customFilters = {
  custom: {
    type: 'html',
    filter: function (str, options) {
      return 'BEGIN' + str + 'END';
    },
  },
  'custom-with-options': {
    type: 'html',
    filter: function (str, options) {
      return (
        'option=' + options.option + ' number=' + options.number + ' ' + str
      );
    },
  },
};

test('filters can be used', (t) => {
  const source = `
p
  :custom
    Filters can be used.
`;

  const ast = parse(lex(source, {filename}), {filename, source});

  const output = filter(ast, customFilters);
  t.assert.snapshot(output);
});

test('__proto__ attribute does not pollute Object.prototype', () => {
  const inspecting = {
    type: 'html',
    filter: function (str, options) {
      // The __proto__ attr should be a regular property on the null-prototype
      // attrs object, not trigger prototype pollution
      assert.strictEqual(options.__proto__, 'malicious');
      // Object.prototype must remain unpolluted
      assert.strictEqual({}.malicious, undefined);
      return str;
    },
  };

  const source = `
p
  :inspecting(__proto__=malicious)
    test
`;

  const ast = parse(lex(source, {filename}), {filename, source});
  filter(ast, {inspecting});
});

test('invalid filter name throws INVALID_FILTER_NAME', () => {
  const source = `
p
  :'../../../etc/malicious'
    test
`;

  const ast = parse(lex(source, {filename}), {filename, source});
  assert.throws(
    () => filter(ast),
    (err) =>
      err.code === 'PUGNEUM:INVALID_FILTER_NAME' &&
      /Invalid filter name/.test(err.message),
  );
});

test('filter that throws raw Error is wrapped as FILTER_ERROR', () => {
  var exploding = {
    type: 'html',
    filter: function () {
      throw new Error('kaboom');
    },
  };

  const source = `
p
  :exploding
    test
`;

  const ast = parse(lex(source, {filename}), {filename, source});
  assert.throws(
    () => filter(ast, {exploding}),
    (err) => err.code === 'PUGNEUM:FILTER_ERROR' && /kaboom/.test(err.message),
  );
});

test('verbatim filter passes text through unchanged', () => {
  const source = `
p
  :verbatim
    <strong>raw html</strong>
`;

  const ast = parse(lex(source, {filename}), {filename, source});
  const output = filter(ast, {});

  const textNode = output.nodes[0].block.nodes[0];
  assert.strictEqual(textNode.type, 'Text');
  assert.strictEqual(textNode.val, '<strong>raw html</strong>');
});

test('filters can be used with options', () => {
  const source = `
p
  :custom-with-options(option=value number=2)
    Filters can be used with options.
    The values aren't parsed though.
    They're just strings.
`;

  const ast = parse(lex(source, {filename}), {filename, source});

  const output = filter(ast, customFilters);

  // find the filtered text node
  const textNode = output.nodes[0].block.nodes[0];
  assert.strictEqual(
    textNode.val,
    "option=value number=2 Filters can be used with options.\nThe values aren't parsed though.\nThey're just strings.",
  );
});

test('text type filter escapes HTML entities', () => {
  const textFilter = {
    type: 'text',
    filter: function (str) {
      return '<script>alert("xss")</script> & "quotes"';
    },
  };

  const source = `
p
  :textFilter
    input
`;

  const ast = parse(lex(source, {filename}), {filename, source});
  const output = filter(ast, {textFilter});

  const textNode = output.nodes[0].block.nodes[0];
  assert.strictEqual(textNode.type, 'Text');
  assert.strictEqual(
    textNode.val,
    '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &quot;quotes&quot;',
  );
});

test('html type filter outputs raw HTML', () => {
  const htmlFilter = {
    type: 'html',
    filter: function (str) {
      return '<strong>' + str.trim() + '</strong>';
    },
  };

  const source = `
p
  :htmlFilter
    bold text
`;

  const ast = parse(lex(source, {filename}), {filename, source});
  const output = filter(ast, {htmlFilter});

  const textNode = output.nodes[0].block.nodes[0];
  assert.strictEqual(textNode.type, 'Text');
  assert.strictEqual(textNode.val, '<strong>bold text</strong>');
});

test('pugneum type filter output is lexed and parsed into AST nodes', () => {
  const pugneumFilter = {
    type: 'pugneum',
    filter: function (str) {
      return 'strong hello';
    },
  };

  const source = `
p
  :pugneumFilter
    ignored input
`;

  const ast = parse(lex(source, {filename}), {filename, source});
  const output = filter(ast, {pugneumFilter});

  const block = output.nodes[0].block.nodes[0];
  assert.strictEqual(block.type, 'Block');
  assert.strictEqual(block.nodes[0].type, 'Tag');
  assert.strictEqual(block.nodes[0].name, 'strong');
});

test('syntax type filter inserts AST nodes directly', () => {
  const syntaxFilter = {
    type: 'syntax',
    filter: function (str) {
      return [
        {
          type: 'Tag',
          name: 'em',
          attrs: [],
          attributeBlocks: [],
          isInline: true,
          block: {
            type: 'Block',
            nodes: [
              {
                type: 'Text',
                val: 'direct',
                line: 1,
                column: 1,
                filename: '',
              },
            ],
            line: 1,
            filename: '',
          },
          line: 1,
          column: 1,
          filename: '',
        },
      ];
    },
  };

  const source = `
p
  :syntaxFilter
    ignored
`;

  const ast = parse(lex(source, {filename}), {filename, source});
  const output = filter(ast, {syntaxFilter});

  const block = output.nodes[0].block.nodes[0];
  assert.strictEqual(block.type, 'Block');
  assert.strictEqual(block.nodes[0].type, 'Tag');
  assert.strictEqual(block.nodes[0].name, 'em');
});

test('MISSING_FILTER_TYPE when filter has no type', () => {
  const untyped = {
    filter: function (str) {
      return str;
    },
  };

  const source = `
p
  :untyped
    test
`;

  const ast = parse(lex(source, {filename}), {filename, source});
  assert.throws(
    () => filter(ast, {untyped}),
    (err) =>
      err.code === 'PUGNEUM:MISSING_FILTER_TYPE' &&
      /must declare a type/.test(err.message),
  );
});

test('INVALID_FILTER_TYPE when filter has unknown type', () => {
  const badType = {
    type: 'markdown',
    filter: function (str) {
      return str;
    },
  };

  const source = `
p
  :badType
    test
`;

  const ast = parse(lex(source, {filename}), {filename, source});
  assert.throws(
    () => filter(ast, {badType}),
    (err) =>
      err.code === 'PUGNEUM:INVALID_FILTER_TYPE' &&
      /unknown type/.test(err.message),
  );
});

test('INVALID_FILTER_OUTPUT when syntax filter returns non-array', () => {
  const badSyntax = {
    type: 'syntax',
    filter: function (str) {
      return 'not an array';
    },
  };

  const source = `
p
  :badSyntax
    test
`;

  const ast = parse(lex(source, {filename}), {filename, source});
  assert.throws(
    () => filter(ast, {badSyntax}),
    (err) =>
      err.code === 'PUGNEUM:INVALID_FILTER_OUTPUT' &&
      /must return an array/.test(err.message),
  );
});

test('INVALID_FILTER_OUTPUT when pugneum filter returns non-string', () => {
  const badPugneum = {
    type: 'pugneum',
    filter: function (str) {
      return 42;
    },
  };

  const source = `
p
  :badPugneum
    test
`;

  const ast = parse(lex(source, {filename}), {filename, source});
  assert.throws(
    () => filter(ast, {badPugneum}),
    (err) =>
      err.code === 'PUGNEUM:INVALID_FILTER_OUTPUT' &&
      /must return a string/.test(err.message),
  );
});

test('pugneum type filter supports inline shorthands in output', () => {
  const pugneumFilter = {
    type: 'pugneum',
    filter: function (str) {
      return 'p This is *(bold) and _(italic) text.';
    },
  };

  const source = `
div
  :pugneumFilter
    ignored
`;

  const ast = parse(lex(source, {filename}), {filename, source});
  const output = filter(ast, {pugneumFilter});

  const block = output.nodes[0].block.nodes[0];
  assert.strictEqual(block.type, 'Block');
  const pTag = block.nodes[0];
  assert.strictEqual(pTag.type, 'Tag');
  assert.strictEqual(pTag.name, 'p');
});

test('INVALID_FILTER_TYPE when include uses pugneum type filter', () => {
  const pugneumInclude = {
    type: 'pugneum',
    filter: function (str) {
      return 'p hello';
    },
  };

  const ast = {
    type: 'Block',
    nodes: [
      {
        type: 'RawInclude',
        filters: [{name: 'pugneumInclude', attrs: []}],
        file: {fullPath: 'test.txt', str: 'test content'},
        line: 1,
        column: 1,
        filename: filename,
      },
    ],
    line: 1,
    filename: filename,
  };

  assert.throws(
    () => filter(ast, {pugneumInclude}),
    (err) =>
      err.code === 'PUGNEUM:INVALID_FILTER_TYPE' &&
      /cannot be used with include/.test(err.message),
  );
});

test('warnings from pugneum-type filter output reach the shared collector', () => {
  const smartFilters = {
    smart: {
      type: 'pugneum',
      filter: function () {
        // Filter emits Pugneum source containing a smart-quoted attribute.
        return 'a(href=‘/x’) link';
      },
    },
  };
  const source = 'div\n  :smart\n    ignored';
  const ast = parse(lex(source, {filename}), {filename, source});
  const warnings = [];

  filter(ast, smartFilters, {warnings});

  const typographic = warnings.filter(
    (w) => w.code === 'PUGNEUM:TYPOGRAPHIC_QUOTE_DELIMITER',
  );
  assert.strictEqual(typographic.length, 1);
});

// --- Nested filters: outer filter must consume inner structured output ---
// Previously a pugneum/syntax inner filter was rewritten into a Block node
// (no .val) and getBodyAsText (n.val || '') silently dropped it, so a
// string-consuming outer filter received ''. The inner output is now rendered
// to HTML and handed to the outer filter.

test('html outer filter consumes a nested pugneum inner filter (was silently dropped)', () => {
  const filters = {
    outer: {type: 'html', filter: (str) => '[OUTER:' + str + ']'},
    innerpug: {type: 'pugneum', filter: () => 'strong hi'},
  };
  const source = `
p
  :outer:innerpug
    ignored
`;
  const ast = parse(lex(source, {filename}), {filename, source});
  const output = filter(ast, filters);

  const textNode = output.nodes[0].block.nodes[0];
  assert.strictEqual(textNode.type, 'Text');
  // Inner pugneum 'strong hi' renders to <strong>hi</strong>, wrapped by outer.
  assert.strictEqual(textNode.val, '[OUTER:<strong>hi</strong>]');
});

test('html outer filter consumes a nested syntax inner filter (was silently dropped)', () => {
  const filters = {
    outer: {type: 'html', filter: (str) => '[OUTER:' + str + ']'},
    innersyn: {
      type: 'syntax',
      filter: () => [
        {
          type: 'Tag',
          name: 'em',
          attrs: [],
          attributeBlocks: [],
          isInline: true,
          block: {
            type: 'Block',
            nodes: [{type: 'Text', val: 'syn', line: 1, column: 1, filename}],
            line: 1,
            filename,
          },
          line: 1,
          column: 1,
          filename,
        },
      ],
    },
  };
  const source = `
p
  :outer:innersyn
    ignored
`;
  const ast = parse(lex(source, {filename}), {filename, source});
  const output = filter(ast, filters);

  const textNode = output.nodes[0].block.nodes[0];
  assert.strictEqual(textNode.type, 'Text');
  assert.strictEqual(textNode.val, '[OUTER:<em>syn</em>]');
});

test('text outer filter escapes the HTML of a nested pugneum inner filter', () => {
  const filters = {
    txt: {type: 'text', filter: (str) => str},
    innerpug: {type: 'pugneum', filter: () => 'strong hi'},
  };
  const source = `
p
  :txt:innerpug
    ignored
`;
  const ast = parse(lex(source, {filename}), {filename, source});
  const output = filter(ast, filters);

  const textNode = output.nodes[0].block.nodes[0];
  assert.strictEqual(textNode.type, 'Text');
  // text outer escapes the inner <strong>hi</strong> HTML it received.
  assert.strictEqual(textNode.val, '&lt;strong&gt;hi&lt;/strong&gt;');
});

test('text outer filter escapes the HTML of a nested syntax inner filter', () => {
  const filters = {
    txt: {type: 'text', filter: (str) => str},
    innersyn: {
      type: 'syntax',
      filter: () => [
        {
          type: 'Tag',
          name: 'em',
          attrs: [],
          attributeBlocks: [],
          isInline: true,
          block: {
            type: 'Block',
            nodes: [{type: 'Text', val: 'x', line: 1, column: 1, filename}],
            line: 1,
            filename,
          },
          line: 1,
          column: 1,
          filename,
        },
      ],
    },
  };
  const source = `
p
  :txt:innersyn
    ignored
`;
  const ast = parse(lex(source, {filename}), {filename, source});
  const output = filter(ast, filters);

  const textNode = output.nodes[0].block.nodes[0];
  assert.strictEqual(textNode.type, 'Text');
  assert.strictEqual(textNode.val, '&lt;em&gt;x&lt;/em&gt;');
});

test('filterer errors carry the source code frame', () => {
  const source = `
p
  :bogusfilter
    test
`;
  const ast = parse(lex(source, {filename}), {filename, source});
  assert.throws(
    () => filter(ast, {}, {source}),
    (err) =>
      err.code === 'PUGNEUM:UNKNOWN_FILTER' &&
      // The ±3-line code frame (error/index.js) renders the offending line with
      // a "> N|" marker only when source is threaded through; previously every
      // filterer error hard-coded source:'' so this frame was absent.
      />\s*3\|/.test(err.message) &&
      /bogusfilter/.test(err.message),
  );
});

test('filterer errors use options.sources for an included node filename', () => {
  // A Filter node whose filename has its own entry in options.sources should
  // get that source for its code frame, not options.source.
  const ast = {
    type: 'Block',
    nodes: [
      {
        type: 'Filter',
        name: 'nope',
        block: {type: 'Block', nodes: []},
        attrs: [],
        line: 1,
        column: 1,
        filename: 'partial.pg',
      },
    ],
    line: 1,
    filename: 'partial.pg',
  };
  const opts = {source: 'entry source', sources: {'partial.pg': ':nope'}};
  assert.throws(
    () => filter(ast, {}, opts),
    (err) => err.code === 'PUGNEUM:UNKNOWN_FILTER' && /:nope/.test(err.message),
  );
});

test('filter that throws a primitive (null) is wrapped as FILTER_ERROR', () => {
  const exploding = {
    type: 'html',
    filter: function () {
      throw null;
    },
  };
  const source = `
p
  :exploding
    test
`;
  const ast = parse(lex(source, {filename}), {filename, source});
  assert.throws(
    () => filter(ast, {exploding}),
    (err) => err.code === 'PUGNEUM:FILTER_ERROR',
  );
});

test('rewritten filter node carries no stale name property', () => {
  const source = `
p
  :custom
    body
`;
  const ast = parse(lex(source, {filename}), {filename, source});
  const output = filter(ast, customFilters);

  const textNode = output.nodes[0].block.nodes[0];
  assert.strictEqual(textNode.type, 'Text');
  assert.strictEqual(textNode.name, undefined);
});

test('syntax filter emitting a blockless Filter node does not crash with a raw TypeError', () => {
  const filters = {
    outer: {
      type: 'syntax',
      filter: () => [{type: 'Filter', name: 'inner', attrs: []}],
    },
    inner: {type: 'html', filter: () => 'Z'},
  };
  const source = `
p
  :outer
    ignored
`;
  const ast = parse(lex(source, {filename}), {filename, source});
  // Must surface a coded PUGNEUM error (or succeed), never a bare TypeError
  // from dereferencing node.block.nodes on a blockless Filter.
  try {
    const output = filter(ast, filters);
    // If it succeeds, the inner filter ran on an empty body.
    assert.ok(output);
  } catch (err) {
    assert.ok(
      err.code && err.code.startsWith('PUGNEUM:'),
      'expected a coded PUGNEUM error, got: ' + err,
    );
  }
});

// --- Positive include-filter coverage (the RawInclude chain path) ---

function rawIncludeAst(filters, str) {
  return {
    type: 'Block',
    nodes: [
      {
        type: 'RawInclude',
        filters: filters,
        file: {fullPath: 'data.txt', str: str},
        line: 1,
        column: 1,
        filename,
      },
    ],
    line: 1,
    filename,
  };
}

test('single html-type include filter passes file content through raw', () => {
  const wrap = {type: 'html', filter: (s) => '<b>' + s + '</b>'};
  const ast = rawIncludeAst([{name: 'wrap', attrs: []}], 'a & b');
  const output = filter(ast, {wrap});
  const node = output.nodes[0];
  assert.strictEqual(node.type, 'Text');
  assert.strictEqual(node.val, '<b>a & b</b>');
});

test('single text-type include filter escapes the final output', () => {
  const ident = {type: 'text', filter: (s) => s};
  const ast = rawIncludeAst([{name: 'ident', attrs: []}], '<x> & "y"');
  const output = filter(ast, {ident});
  const node = output.nodes[0];
  assert.strictEqual(node.type, 'Text');
  assert.strictEqual(node.val, '&lt;x&gt; &amp; &quot;y&quot;');
});

test('include filter chain applies right-to-left (innermost wraps file first)', () => {
  const filters = {
    a: {type: 'html', filter: (s) => 'A(' + s + ')'},
    b: {type: 'html', filter: (s) => 'B(' + s + ')'},
    c: {type: 'html', filter: (s) => 'C(' + s + ')'},
  };
  // Source order [a, b, c] => a(b(c(RAW))).
  const ast = rawIncludeAst(
    [
      {name: 'a', attrs: []},
      {name: 'b', attrs: []},
      {name: 'c', attrs: []},
    ],
    'X',
  );
  const output = filter(ast, filters);
  assert.strictEqual(output.nodes[0].val, 'A(B(C(X)))');
});

test('include chain output-validation error names the failing (outermost) filter', () => {
  const filters = {
    // a is outermost (applied last) and returns a non-string.
    a: {type: 'html', filter: () => 999},
    b: {type: 'html', filter: (s) => s},
  };
  const ast = rawIncludeAst(
    [
      {name: 'a', attrs: []},
      {name: 'b', attrs: []},
    ],
    'X',
  );
  assert.throws(
    () => filter(ast, filters),
    (err) =>
      err.code === 'PUGNEUM:INVALID_FILTER_OUTPUT' &&
      /Filter 'a'/.test(err.message),
  );
});

test('include chain validates intermediate (non-final) filter output', () => {
  const filters = {
    // outer consumes; inner (applied first) returns a non-string.
    outer: {type: 'html', filter: (s) => 'O(' + s + ')'},
    inner: {type: 'html', filter: () => undefined},
  };
  const ast = rawIncludeAst(
    [
      {name: 'outer', attrs: []},
      {name: 'inner', attrs: []},
    ],
    'X',
  );
  assert.throws(
    () => filter(ast, filters),
    (err) =>
      err.code === 'PUGNEUM:INVALID_FILTER_OUTPUT' &&
      /Filter 'inner'/.test(err.message),
  );
});
