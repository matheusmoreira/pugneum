# pugneum-filterer

Code for processing filters in pugneum templates

## Installation

    npm install pugneum-filterer

## Usage

```
var filter = require('pugneum-filterer');
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

```
var ast = applyFilters(ast, filters, {filterOptions: {custom: {opt: 'x'}}});
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

`filters` is an object mapping names to filter descriptor objects:

```
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

```
{
  custom: {
    type: 'html',
    filter: function(text, options) {
      return '<strong>' + text + '</strong>';
    }
  }
}
```

If `binary` is specified as true, an include filter (`include:name`)
receives the raw file contents as a `Buffer` (`file.raw`) instead of decoded
text. Non-binary include input normalizes LF, CRLF, and CR line endings to LF
before the innermost filter runs. The `binary` flag is only consulted on the
include path; it has no effect on `:name` block filters, whose input is always
the filter body text.

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
