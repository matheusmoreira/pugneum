# pugneum-lexer

This module is responsible for transforming a pugneum string into an array of tokens.

## Installation

    npm install pugneum-lexer

## Usage

```js
var lex = require('pugneum-lexer');
```

### `lex(str, options)`

Convert pugneum string to array of tokens.

`options` can contain the following properties:

 - `filename` (string): name of the pugneum file; used in error reporting.
 - `warnings` (array): optional shared sink for non-fatal diagnostics. The lexer
   pushes warning objects (as produced by `pugneum-error`'s `warning()`) into this
   array — for example when a typographic "smart" quote is used where a straight
   attribute delimiter was expected. The same array is threaded through included
   files and nested inline content so all warnings are collected in one place. If
   omitted, warnings are still collected internally but discarded.

```js
console.log(JSON.stringify(lex('div(data-foo="bar")\n  p Hello', {filename: 'my-file.pg'}), null, 2))
```

```json
[
  {
    "type": "tag",
    "loc": {
      "start": { "line": 1, "column": 1 },
      "filename": "my-file.pg",
      "end": { "line": 1, "column": 4 }
    },
    "val": "div"
  },
  {
    "type": "start-attributes",
    "loc": {
      "start": { "line": 1, "column": 4 },
      "filename": "my-file.pg",
      "end": { "line": 1, "column": 5 }
    }
  },
  {
    "type": "attribute",
    "loc": {
      "start": { "line": 1, "column": 5 },
      "filename": "my-file.pg",
      "end": { "line": 1, "column": 19 }
    },
    "name": "data-foo",
    "val": "bar"
  },
  {
    "type": "end-attributes",
    "loc": {
      "start": { "line": 1, "column": 19 },
      "filename": "my-file.pg",
      "end": { "line": 1, "column": 20 }
    }
  },
  {
    "type": "indent",
    "loc": {
      "start": { "line": 2, "column": 1 },
      "filename": "my-file.pg",
      "end": { "line": 2, "column": 3 }
    },
    "val": 2
  },
  {
    "type": "tag",
    "loc": {
      "start": { "line": 2, "column": 3 },
      "filename": "my-file.pg",
      "end": { "line": 2, "column": 4 }
    },
    "val": "p"
  },
  {
    "type": "text",
    "loc": {
      "start": { "line": 2, "column": 5 },
      "filename": "my-file.pg",
      "end": { "line": 2, "column": 10 }
    },
    "val": "Hello"
  },
  {
    "type": "outdent",
    "loc": {
      "start": { "line": 2, "column": 10 },
      "filename": "my-file.pg",
      "end": { "line": 2, "column": 10 }
    }
  },
  {
    "type": "eos",
    "loc": {
      "start": { "line": 2, "column": 10 },
      "filename": "my-file.pg",
      "end": { "line": 2, "column": 10 }
    }
  }
]
```

Every token has a `type` and a `loc`; token-specific fields such as `val`,
`name`, or `args` are added where applicable. Lines and columns are one-based,
and `loc.end` is end-exclusive. Locations always refer to the normalized
physical input, remain in source order, and stay within physical source bounds.

Inline shorthand is lowered to ordinary tag and attribute tokens. Structure
that has no literal spelling in the input uses a zero-width location at the
corresponding shorthand payload boundary, while authored payload text keeps its
physical span across escapes and multiline folding. Consumers must therefore
use `loc`, rather than the length of a transformed token value, for source
mapping. The final `eos` token is also zero-width.

## License

  MIT
