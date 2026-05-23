# pugneum-filterer

Code for processing filters in pugneum templates

## Installation

    npm install pugneum-filterer

## Usage

```
var filter = require('pugneum-filterer');
```

### `applyFilters(ast, filters, options)`

Renders all `Filter` nodes in a pugneum abstract syntax tree.

`options` is an optional object whose keys are filter names
and whose values are objects merged into the attributes
passed to that filter.

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

If `binary` is specified as true, the filter receives a raw input buffer
containing binary data instead of already decoded text.

The built-in `verbatim` filter passes text through unchanged.
It is always available without any configuration.

When a filter is used in a pugneum template but is not present
in the custom filters map or built-in filters, the filterer will
require a package named `pugneum-filter-${name}` which is expected
to return the filter descriptor object. If not found, the result
is an error.

## License

  MIT
