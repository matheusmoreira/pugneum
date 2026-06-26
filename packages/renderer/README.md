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
any includes, extends and filters must already be resolved
(by the loader, linker and filterer). Templates that use none of
those, like the example below, may be rendered straight from the parser.

```js
var lex = require('pugneum-lexer');
var parse = require('pugneum-parser');
var render = require('pugneum-renderer');

let html = render(parse(lex('p Hello, world!')));
//=> '<p>Hello, world!</p>'
```

The renderer has no doctype logic of its own. A `<!DOCTYPE html>`
only appears when the source contains an explicit `doctype html`
line, which the lexer pre-renders into a text token the renderer
buffers verbatim.

### `options`

- `warnings` — an array the caller supplies to collect compiler
  warnings (currently `UNUSED_MIXIN`). When omitted, warnings are
  collected into an internal throwaway array and discarded.
- `filename` — the entry filename. Only mixins defined in this file
  are eligible for the `UNUSED_MIXIN` warning; mixins from included
  files are treated as reusable library definitions and never flagged.
- `source` / `sources` — source text used to attach ±3 lines of
  context to thrown errors and collected warnings. `sources` is a
  map keyed by filename (populated by the loader); `source` is the
  single-source fallback.

## License

  MIT
