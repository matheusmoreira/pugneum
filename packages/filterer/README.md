# pugneum-filterer

Code for processing filters in pugneum templates

## Installation

    npm install pugneum-filterer

## Usage

<!-- executable-quick-start -->

```js
var applyFilters = require('pugneum-filterer');

var ast = {
  type: 'Block',
  nodes: [
    {
      type: 'Filter',
      name: 'custom',
      attrs: [],
      block: {type: 'Block', nodes: [{type: 'Text', val: 'hello'}]},
    },
  ],
};
var filters = {
  custom: {
    type: 'html',
    filter: function (text) {
      return '<strong>' + text + '</strong>';
    },
  },
};

var output = applyFilters(ast, filters);
console.log(output.nodes[0].val); // <strong>hello</strong>
```

### `applyFilters(ast, filters, options)`

Applies filters to a pugneum abstract syntax tree, mutating it in
place and also returning it. Two kinds of node are processed:

- `Filter` nodes — block filters written as `:name`. All four filter
  types (`text`, `html`, `pugneum`, `syntax`) are allowed.
- `RawInclude` nodes carrying filters — include filters written as
  `include:name path`. These are restricted to `text` and `html`
  types. A chain such as `include:a:b path` applies right-to-left:
  the rightmost filter (`b`) wraps the file contents first, then `a`
  wraps that result.

```js
output = applyFilters(ast, filters, {filterOptions: {custom: {opt: 'x'}}});
```

`options` is an optional object. Per-filter options are read from
`options.filterOptions`, an object whose keys are filter names and
whose values are objects merged into the attributes passed to that
filter. Only each option object's own enumerable properties are copied;
arrays, primitives, `null`, and collection objects are rejected with
`INVALID_FILTER_OPTIONS` instead of being coerced into attributes.
(Top-level option keys are never passed to filters.) The
`options.warnings` array, if provided, collects warnings raised while
re-lexing `pugneum`-type filter output.

The callback's second argument is assembled in a fixed precedence order:
template attributes, then `filterOptions[name]`, then the reserved `filename`
field. For a block filter, `filename` is the invocation's source filename. For
an include filter, it is the included file's full path. User attributes and
per-filter options cannot override this reserved value.

`filters` is an object mapping names to filter descriptor objects:

```js
{
  custom: {
    type: 'html',
    filter: function(text, options) {
      return 'filtered' + text;
    },

    binary: false
  }
}
```

`custom` is the name of the filter as written in the pugneum template.
Every key maps a name to an object describing the filter of that name.
Descriptors are read once before execution. `filter` must be callable and
`binary`, when present, must be a boolean; malformed or accessor-throwing
descriptors fail with `INVALID_FILTER_DESCRIPTOR` at the invocation.

Every filter must declare a `type` property:

- `text` — plain text output, HTML-escaped by the filterer
- `html` — raw HTML output, passed through as-is
- `pugneum` — Pugneum source output, re-lexed/re-parsed into AST nodes
- `syntax` — direct AST node array, inserted into the tree

Both structured forms pass through the versioned `pugneum-walker` AST schema
before insertion. The graph must be a single-owner, acyclic tree, cannot reuse
a node already owned by the surrounding document, and cannot make the complete
document deeper than the parser can produce. A generated node cannot introduce
`include`, `extends`, raw-include, file-reference, include-filter, or `yield`
work because loading and template assembly have already run. A `NamedBlock`
remains valid only when it belongs to a generated mixin definition or call.
Invalid shape is reported as `INVALID_FILTER_OUTPUT`; a construct owned by an
earlier phase is reported as `UNSUPPORTED_FILTER_CONSTRUCT`. Missing
node/attribute/definition locations in `syntax` output inherit the filter
invocation's filename, line, and column.

```js
{
  custom: {
    type: 'html',
    filter: function(text, options) {
      return '<strong>' + text + '</strong>';
    }
  }
}
```

### Pipeline phase and nested filters

The normal facade runs the relevant phases in this order:

```text
load and assemble -> apply filters -> resolve links/footnotes/TOC -> render
```

A top-level `pugneum` or `syntax` result stays structured, so references,
footnotes, and TOC nodes it emits participate in the later document-wide
resolution pass. Loading and template assembly have already finished, which is
why generated include, extends, raw-include, file-reference, include-filter,
and yield nodes are rejected at the filter invocation.

Nested block filters such as `:outer:inner` run from the inside out. When an
inner `pugneum` or `syntax` filter feeds a string-consuming `text` or `html`
outer filter, the inner subtree is serialized to HTML before the outer callback
runs. That early serialization precedes document-wide resolution, so the inner
result cannot depend on references, footnotes, or TOC facts defined elsewhere
in the document. Keep document-global constructs in a structured result that
remains in the AST until the later resolve phase.

If `binary` is specified as true on the rightmost (innermost) include filter,
that callback receives the exact raw file `Buffer` (`file.raw`) instead of
decoded text. Non-binary initial input normalizes LF, CRLF, and CR line endings
to LF. Every include filter must return a string, including the binary filter;
each outer filter consumes that preceding string result. A `binary` flag on an
outer filter does not select the file bytes again. The flag is ignored for
`:name` block filters, whose input is always the filter body text.

```js
var binaryFilter = {
  type: 'html',
  binary: true,
  filter: function (raw) {
    if (!Buffer.isBuffer(raw)) throw new TypeError('expected file bytes');
    return raw.toString('base64');
  },
};
```

The built-in `verbatim` filter passes text through unchanged.
It is always available without any configuration.

When a filter is used in a pugneum template but is not present
in the custom filters map or built-in filters, the filterer will
require a package named `pugneum-filter-${name}` which is expected
to return the filter descriptor object. If not found, the result
is `UNKNOWN_FILTER`. Resolution is probed separately from loading: if the
package is present but one of its dependencies is missing, or its initialization
throws, that load error is preserved rather than being mislabeled as absence.

A callback-thrown diagnostic whose code begins with `PUGNEUM:` is preserved.
Other callback failures, including primitive and otherwise unprintable thrown
values, become `FILTER_ERROR` diagnostics with the invocation's filename,
source frame, and original value as `cause`.

## License

  MIT
