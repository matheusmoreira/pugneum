# pugneum-parser

The pugneum parser transforms an array of tokens into an abstract syntax tree.

## Installation

    npm install pugneum-parser

## Usage

```js
var parse = require('pugneum-parser');
```

### `parse(tokens, options)`

Convert pugneum tokens into an abstract syntax tree (AST).

`options` can contain the following properties:

 - `filename` (string): pugneum file name; included in AST nodes and used in error handling
 - `plugins` (array): array of plugins in the order they should be applied
 - `src` (string): pugneum source code before tokenization; used in error handling

```js
const lex = require('pugneum-lexer');

let filename = 'my-file.pg';
let src = 'div(data-foo="bar")';
let tokens = lex(src, {filename});

let ast = parse(tokens, {filename, src});

console.log(JSON.stringify(ast, null, '  '))
```

```json
{
  "type": "Block",
  "nodes": [
    {
      "type": "Tag",
      "name": "div",
      "selfClosing": false,
      "block": {
        "type": "Block",
        "nodes": [],
        "line": 1,
        "filename": "my-file.pg"
      },
      "attrs": [
        {
          "name": "data-foo",
          "val": "bar",
          "line": 1,
          "column": 5,
          "filename": "my-file.pg",
          "mustEscape": true
        }
      ],
      "attributeBlocks": [],
      "isInline": false,
      "line": 1,
      "column": 1,
      "filename": "my-file.pg"
    }
  ],
  "line": 0,
  "filename": "my-file.pg"
}
```

## License

  MIT
