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

// Run the slice of the pipeline that exercises a pugneum-type filter end to end:
// lex -> parse -> link (document pass) -> filter -> render. The document link
// pass runs BEFORE the filterer (and consumes the document's references/
// footnotes blocks), which is exactly the condition under which a pugneum
// filter's @[ref]/^[fn]/toc output used to reach the renderer unresolved.
function renderPipeline(source, filters, opts) {
  const options = Object.assign({filename, source, warnings: []}, opts);
  const ast = parse(lex(source, options), options);
  const linked = link(ast, options);
  const filtered = filter(linked, filters, options);
  return render(filtered, options);
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

// --- pugneum-type filter output is re-linked so embedded reference/footnote/
// --- toc/include constructs resolve instead of crashing the renderer.
//
// The document linker pass runs before the filterer and consumes the document's
// references/footnotes blocks, so a @[ref]/^[fn]/toc emitted by a pugneum filter
// previously reached the renderer unresolved and threw a raw, uncoded TypeError
// ("...is of type ReferenceLink, which is not supported..."). The filterer now
// re-runs the linker on the filter sub-AST.

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
  // the reference use and a references block defining it. The re-link resolves
  // the ReferenceLink into an <a href>.
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

test('pugneum filter @[ref] with no definition gives a coded error, not a raw TypeError', () => {
  // The definition lives only in the outer document, which the re-link cannot
  // see. Graceful degradation: a coded UNDEFINED_REFERENCE diagnostic rather
  // than the renderer's raw, uncoded TypeError leaking internal node names.
  const filters = {
    reffer: {type: 'pugneum', filter: () => 'p see @[gone here]'},
  };
  const source = 'div\n  :reffer\n    ignored\nreferences\n  gone /x';
  assert.throws(
    () => renderPipeline(source, filters),
    (err) =>
      err.code === 'PUGNEUM:UNDEFINED_REFERENCE' &&
      // It must be a proper coded error, never the renderer's bare TypeError.
      err.code.startsWith('PUGNEUM:') &&
      !/which is not supported by the pugneum compiler/.test(err.message),
  );
});

test('pugneum filter ^[footnote] with no definition gives a coded error, not a raw TypeError', () => {
  // Symmetric to the @[ref] degrade above: a footnote whose definition lives
  // only in the outer document degrades to a coded UNDEFINED_FOOTNOTE, never a
  // raw TypeError leaking internal node names.
  const filters = {
    fnner: {type: 'pugneum', filter: () => 'p text^[gone]'},
  };
  const source = 'div\n  :fnner\n    ignored\nfootnotes\n  gone a note';
  assert.throws(
    () => renderPipeline(source, filters),
    (err) =>
      err.code === 'PUGNEUM:UNDEFINED_FOOTNOTE' &&
      err.code.startsWith('PUGNEUM:') &&
      !/which is not supported by the pugneum compiler/.test(err.message),
  );
});

test('include/extends in pugneum filter output is a clean coded error, not a raw re-link crash', () => {
  // A loader construct cannot be resolved by the filterer re-link: file
  // resolution runs BEFORE filters, so the include target was never loaded
  // (node.file.ast is unset) and re-running the linker on it would deref
  // undefined and crash with a raw, uncoded "Cannot read properties of
  // undefined" TypeError. The filterer must reject it up front with a coded
  // UNSUPPORTED_FILTER_CONSTRUCT pointing at the filter invocation.
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
  // The guard skips the re-link entirely when no linker-resolved node is
  // present, so ordinary filter output (the common case, e.g. the table
  // filter) is byte-identical to before — no link/lint pass runs.
  const filters = {
    plain: {type: 'pugneum', filter: () => 'strong hi'},
  };
  const html = renderPipeline('p\n  :plain\n    ignored', filters);
  assert.strictEqual(html, '<p><strong>hi</strong></p>');
});

test('pugneum filter nested in pugneum filter re-links without infinite recursion', () => {
  // The inner pugneum filter emits a fragment with a toc + heading; the outer
  // pugneum filter wraps that. The walker re-processes the inner :inner filter
  // inside the outer's output, re-entering parsePugneum. The recursion guard
  // must keep this bounded (no RangeError / stack overflow) and still resolve
  // the toc.
  const filters = {
    outer: {type: 'pugneum', filter: (s) => 'section\n  :inner\n    ' + s},
    inner: {type: 'pugneum', filter: () => 'h2#z Zed\ntoc'},
  };
  const html = renderPipeline('div\n  :outer\n    seed', filters);
  assert.match(html, /<section>/);
  assert.match(html, /<nav role="doc-toc"/);
  assert.match(html, /<a href="#z">Zed<\/a>/);
});

test('pugneum-filter unit re-link resolves toc directly via applyFilters', () => {
  // A unit-level check that does not depend on render/link wiring in the
  // pipeline helper: a pugneum filter emitting `toc` plus a heading must be
  // rewritten to a Block whose subtree contains the resolved <nav>, not a
  // surviving Toc node.
  const filters = {
    t: {type: 'pugneum', filter: () => 'h3#h Head\ntoc'},
  };
  const source = 'div\n  :t\n    ignored';
  const ast = parse(lex(source, {filename, source}), {filename, source});
  const out = filter(ast, filters, {filename, source});
  const types = [];
  (function collect(n) {
    types.push(n.type);
    if (n.block && n.block.nodes) n.block.nodes.forEach(collect);
    if (n.nodes) n.nodes.forEach(collect);
  })(out);
  assert.ok(!types.includes('Toc'), 'Toc node must be resolved away');
  assert.ok(
    types.some((tp) => tp === 'Tag'),
    'resolved nav/ol/li/a Tag nodes must be present',
  );
});
