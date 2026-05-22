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

## License

  MIT
