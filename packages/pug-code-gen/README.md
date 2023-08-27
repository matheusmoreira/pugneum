# pugneum-renderer

Renders pugneum abstract syntax trees into HTML.

## Installation

    npm install pugneum-renderer

## Usage

```js
var render = require('pugneum-renderer');
```

### `render(ast, options)`

Compile the given pugneum abstract syntax tree,
rendering it into an HTML string.

`ast` is a fully loaded and linked pugneum abstract syntax tree:
all includes, extends and filters must be resolved.

```js
var lex = require('pugneum-lexer');
var parse = require('pugneum-parser');
var render = require('pugneum-renderer');

let html = render(parse(lex('p Hello, world!')));
//=> '<p>Hello, world!</p>'
```

## License

  MIT
