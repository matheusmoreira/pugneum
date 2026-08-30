'use strict';

var path = require('path');
var assert = require('node:assert/strict');
var {test} = require('node:test');

var lex = require('pugneum-lexer');
var parse = require('pugneum-parser');
var link = require('pugneum-linker');
var render = require('pugneum-renderer');
var filter = require('../');

var filename = path.basename(__filename);

// Run the slice of the pipeline that exercises a pugneum-type filter end to end,
// in the real pipeline order: lex -> parse -> link.assemble (inheritance/
// includes) -> filter -> link.resolve (references/footnotes/toc) -> render.
// Resolution runs AFTER the filterer, over the fully assembled + filtered tree,
// so a @[ref]/^[fn]/toc a pugneum filter emits resolves alongside the rest of the
// document — including definitions that live in the OUTER document.
function renderPipeline(source, filters, opts) {
  const options = Object.assign({filename, source, warnings: []}, opts);
  const ast = parse(lex(source, options), options);
  const assembled = link.assemble(ast, options);
  const filtered = filter(assembled, filters, options);
  const resolved = link.resolve(filtered, options);
  return render(resolved, options);
}

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
  var calls = 0;
  var receivedOptions;
  const inspecting = {
    type: 'html',
    filter: function (str, options) {
      calls += 1;
      receivedOptions = options;
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
  assert.strictEqual(calls, 1);
  assert.strictEqual(Object.getPrototypeOf(receivedOptions), null);
  assert.deepStrictEqual(Object.keys(receivedOptions), [
    '__proto__',
    'filename',
  ]);
  assert.ok(Object.hasOwn(receivedOptions, '__proto__'));
  assert.strictEqual(receivedOptions.__proto__, 'malicious');
  assert.strictEqual(receivedOptions.filename, filename);
  assert.strictEqual({}.malicious, undefined);
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

test('syntax filter emitting a blockless Filter runs its empty inner body', () => {
  const calls = {outer: [], inner: []};
  const filters = {
    outer: {
      type: 'syntax',
      filter: (text) => {
        calls.outer.push(text);
        return [{type: 'Filter', name: 'inner', attrs: []}];
      },
    },
    inner: {
      type: 'html',
      filter: (text) => {
        calls.inner.push(text);
        return 'Z';
      },
    },
  };
  const source = `
p
  :outer
    ignored
`;
  const ast = parse(lex(source, {filename}), {filename, source});
  const output = filter(ast, filters);

  assert.deepStrictEqual(calls, {outer: ['ignored'], inner: ['']});
  assert.strictEqual(output.type, 'Block');
  assert.strictEqual(output.nodes[0].type, 'Tag');
  assert.strictEqual(output.nodes[0].name, 'p');
  assert.deepStrictEqual(output.nodes[0].block.nodes, [
    {
      type: 'Block',
      line: 3,
      column: 3,
      filename,
      nodes: [{type: 'Text', val: 'Z'}],
    },
  ]);
});

test('syntax filter emitting an unknown blockless filter fails exactly', () => {
  const source = `
p
  :outer
    ignored
`;
  const ast = parse(lex(source, {filename}), {filename, source});
  const filters = {
    outer: {
      type: 'syntax',
      filter: () => [{type: 'Filter', name: 'missing', attrs: []}],
    },
  };

  assert.throws(
    () => filter(ast, filters),
    (err) => {
      assert.strictEqual(err.code, 'PUGNEUM:UNKNOWN_FILTER');
      assert.strictEqual(err.msg, "Unknown filter 'missing'");
      return true;
    },
  );
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

// --- reference/footnote/toc constructs a pugneum-type filter emits resolve over
// --- the assembled tree, because document-level resolution (link.resolve) runs
// --- AFTER the filterer (see renderPipeline / packages/pugneum).
//
// Previously a @[ref]/^[fn]/toc emitted by a pugneum filter reached the renderer
// unresolved and threw a raw, uncoded TypeError ("...is of type ReferenceLink,
// which is not supported..."); now they resolve alongside the rest of the
// document, including against definitions that live only in the outer document.

test('toc inside pugneum filter output resolves to a nav (was raw TypeError)', () => {
  // The fragment carries the heading it indexes, so the toc resolves fully.
  const filters = {
    tocgen: {type: 'pugneum', filter: () => 'h2#sec Section\ntoc'},
  };
  const html = renderPipeline('div\n  :tocgen\n    ignored', filters);
  assert.match(html, /<nav role="doc-toc"/);
  assert.match(html, /<a href="#sec">Section<\/a>/);
  assert.doesNotMatch(html, /Toc/);
});

test('@[ref] inside pugneum filter output resolves when the fragment defines it', () => {
  // A pugneum filter whose output is a self-contained fragment: it emits both
  // the reference use and a references block defining it. Resolution turns the
  // ReferenceLink into an <a href>.
  const filters = {
    reffer: {
      type: 'pugneum',
      filter: () =>
        'p see @[site here]\nreferences\n  site https://example.com',
    },
  };
  const html = renderPipeline('div\n  :reffer\n    ignored', filters);
  assert.match(html, /<a href="https:\/\/example\.com">here<\/a>/);
  assert.doesNotMatch(html, /ReferenceLink/);
});

test('^[footnote] inside pugneum filter output resolves when the fragment defines it', () => {
  const filters = {
    fngen: {
      type: 'pugneum',
      filter: () => 'p text^[n]\nfootnotes\n  n a note',
    },
  };
  const html = renderPipeline('div\n  :fngen\n    ignored', filters);
  // Forward reference marker and the rendered endnotes section both appear.
  assert.match(html, /role="doc-noteref"/);
  assert.match(html, /role="doc-endnotes"/);
  assert.match(html, /id="footnote-n"/);
  assert.doesNotMatch(html, /FootnoteRef/);
});

test('![ref] image inside pugneum filter output resolves when the fragment defines it', () => {
  const filters = {
    imggen: {
      type: 'pugneum',
      filter: () => 'p ![logo the logo]\nreferences\n  logo /logo.png',
    },
  };
  const html = renderPipeline('div\n  :imggen\n    ignored', filters);
  assert.match(html, /<img[^>]*src="\/logo\.png"/);
  assert.match(html, /alt="the logo"/);
  assert.doesNotMatch(html, /ReferenceImage/);
});

test('@[ref] in filter output resolves against an OUTER-DOCUMENT references block', () => {
  // The headline of #4: the reference definition lives ONLY in the outer
  // document. Because resolution runs after the filterer over the whole assembled
  // tree, the @[ref] a pugneum filter emits resolves against the document's
  // references block — a full resolution, not a degrade to a coded error.
  const filters = {
    reffer: {type: 'pugneum', filter: () => 'p see @[site here]'},
  };
  const source =
    'div\n  :reffer\n    ignored\nreferences\n  site https://example.com';
  const html = renderPipeline(source, filters);
  assert.match(html, /<a href="https:\/\/example\.com">here<\/a>/);
  assert.doesNotMatch(html, /ReferenceLink/);
});

test('a @[ref] defined NOWHERE still errors with a coded UNDEFINED_REFERENCE', () => {
  // Resolution is global, so "undefined" means undefined across the whole
  // document — and it is still a clean coded error, never the renderer's raw
  // TypeError leaking internal node names.
  const filters = {
    reffer: {type: 'pugneum', filter: () => 'p see @[ghost here]'},
  };
  assert.throws(
    () => renderPipeline('div\n  :reffer\n    ignored', filters),
    (err) =>
      err.code === 'PUGNEUM:UNDEFINED_REFERENCE' &&
      !/which is not supported by the pugneum compiler/.test(err.message),
  );
});

test('^[footnote] in filter output resolves against an OUTER-DOCUMENT footnotes block', () => {
  // Symmetric to the @[ref] case: a footnote a pugneum filter emits resolves
  // against the document's footnotes block and is numbered together with the
  // rest of the document's footnotes.
  const filters = {
    fnner: {type: 'pugneum', filter: () => 'p text^[n]'},
  };
  const source = 'div\n  :fnner\n    ignored\nfootnotes\n  n a note';
  const html = renderPipeline(source, filters);
  assert.match(html, /role="doc-noteref"/);
  assert.match(html, /role="doc-endnotes"/);
  assert.match(html, /id="footnote-n"/);
  assert.doesNotMatch(html, /FootnoteRef/);
});

test('a ^[footnote] defined NOWHERE still errors with a coded UNDEFINED_FOOTNOTE', () => {
  const filters = {
    fnner: {type: 'pugneum', filter: () => 'p text^[ghost]'},
  };
  assert.throws(
    () => renderPipeline('div\n  :fnner\n    ignored', filters),
    (err) =>
      err.code === 'PUGNEUM:UNDEFINED_FOOTNOTE' &&
      !/which is not supported by the pugneum compiler/.test(err.message),
  );
});

test('include/extends in pugneum filter output is a clean coded error', () => {
  // A loader construct cannot be resolved downstream: file resolution (the
  // loader) runs BEFORE filters, so the include target is never loaded. The
  // filterer rejects it up front with a coded UNSUPPORTED_FILTER_CONSTRUCT
  // pointing at the filter invocation, rather than letting an unresolved node
  // reach the renderer.
  for (const directive of ['include nope.pg', 'extends layout.pg']) {
    const filters = {bad: {type: 'pugneum', filter: () => directive}};
    assert.throws(
      () => renderPipeline('div\n  :bad\n    ignored', filters),
      (err) =>
        err.code === 'PUGNEUM:UNSUPPORTED_FILTER_CONSTRUCT' &&
        !/Cannot read properties of undefined/.test(err.message),
      'expected a coded error for: ' + directive,
    );
  }
});

test('plain pugneum filter output (no linker construct) renders unchanged', () => {
  // Ordinary filter output (the common case, e.g. the table filter emits only
  // Tag/Text) carries no reference/footnote/toc node, so the resolve pass is a
  // no-op over it and it renders byte-identically.
  const filters = {
    plain: {type: 'pugneum', filter: () => 'strong hi'},
  };
  const html = renderPipeline('p\n  :plain\n    ignored', filters);
  assert.strictEqual(html, '<p><strong>hi</strong></p>');
});

test('nested pugneum filters: the inner toc resolves over the assembled tree', () => {
  // The inner pugneum filter emits a fragment with a toc + heading; the outer
  // pugneum filter wraps it. The filterer walk processes both; the single
  // post-filter resolve pass then resolves the toc over the whole tree. (No
  // re-link recursion — the filterer no longer links anything itself.)
  const filters = {
    outer: {type: 'pugneum', filter: (s) => 'section\n  :inner\n    ' + s},
    inner: {type: 'pugneum', filter: () => 'h2#z Zed\ntoc'},
  };
  const html = renderPipeline('div\n  :outer\n    seed', filters);
  assert.match(html, /<section>/);
  assert.match(html, /<nav role="doc-toc"/);
  assert.match(html, /<a href="#z">Zed<\/a>/);
});

test('filter() leaves the Toc node unresolved; link.resolve resolves it', () => {
  // Pins the boundary: the filterer produces the parsed sub-AST with the Toc node
  // INTACT (it no longer resolves linker constructs itself); the post-filter
  // link.resolve pass turns it into a <nav>.
  const filters = {
    t: {type: 'pugneum', filter: () => 'h3#h Head\ntoc'},
  };
  const source = 'div\n  :t\n    ignored';
  const options = {filename, source, warnings: []};
  const assembled = link.assemble(
    parse(lex(source, options), options),
    options,
  );
  const filtered = filter(assembled, filters, options);

  function typesIn(tree) {
    const types = [];
    (function collect(n) {
      types.push(n.type);
      if (n.block && n.block.nodes) n.block.nodes.forEach(collect);
      if (n.nodes) n.nodes.forEach(collect);
    })(tree);
    return types;
  }

  assert.ok(
    typesIn(filtered).includes('Toc'),
    'filter() must leave the Toc node unresolved',
  );
  const resolved = link.resolve(filtered, options);
  const types = typesIn(resolved);
  assert.ok(!types.includes('Toc'), 'link.resolve must resolve the Toc away');
  assert.ok(types.includes('Tag'), 'resolved nav/ol/li/a Tag nodes present');
});
