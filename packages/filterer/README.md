# pugneum-filterer

Code for processing filters in pugneum templates

## Installation

    npm install pugneum-filterer

## Usage

```
var filter = require('pugneum-filterer');
```

### `filter(ast, filters)`

Renders all `Filter` nodes in a pugneum abstract syntax tree.

`filters` is an object mapping names to filter descriptor objects:

```
{
  custom: {
    filter: function(text, options) {
      return 'filtered' + text;
    },

    binary: false
  }
}
```

`custom` is the name of the filter as written in the pugneum template.
Every key maps a name to an object describing the filter of that name.

The filter descriptor is an object whose filter property is a function
that processes the text. This is the only strictly required property.
If `binary` is specified as true, the filter receives a raw input buffer
containing binary data instead of already decoded text.
Support for more metadata will probably be added later.

When a filter is used in a pugneum template but is not present
in the custom filters map, the filterer will require a package
named `pugneum-filter-${name}` which is expected to return the
filter descriptor object. If not found, the result is an error.

## License

  MIT
