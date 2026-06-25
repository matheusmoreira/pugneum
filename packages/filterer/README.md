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
filter. (Top-level option keys are never passed to filters.) The
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

Every filter must declare a `type` property:

- `text` — plain text output, HTML-escaped by the filterer
- `html` — raw HTML output, passed through as-is
- `pugneum` — Pugneum source output, re-lexed/re-parsed into AST nodes
- `syntax` — direct AST node array, inserted into the tree

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
receives the raw file contents (`file.raw`) instead of the decoded
string. The `binary` flag is only consulted on the include path; it
has no effect on `:name` block filters, whose input is always the
filter body text. Whether the raw contents are a `Buffer` or a string
depends on the configured loader `read()` function.

The built-in `verbatim` filter passes text through unchanged.
It is always available without any configuration.

When a filter is used in a pugneum template but is not present
in the custom filters map or built-in filters, the filterer will
require a package named `pugneum-filter-${name}` which is expected
to return the filter descriptor object. If not found, the result
is an error.

## License

  MIT
