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
 - `plugins` (array): array of plugins in the order they should be applied.

```js
console.log(JSON.stringify(lex('div(data-foo="bar")', {filename: 'my-file.pg'}), null, '  '))
```

```json
[
  {
    "type": "tag",
    "line": 1,
    "val": "div",
    "selfClosing": false
  },
  {
    "type": "attrs",
    "line": 1,
    "attrs": [
      {
        "name": "data-foo",
        "val": "\"bar\"",
        "escaped": true
      }
    ]
  },
  {
    "type": "eos",
    "line": 1
  }
]
```

## License

  MIT
