# pugneum-renderer

Renders pugneum abstract syntax trees into HTML.

## Installation

Install only the renderer when your application already supplies a
renderer-ready AST:

    npm install pugneum-renderer

To run the source-to-AST example below, install its lexer and parser too:

    npm install pugneum-renderer pugneum-parser pugneum-lexer

## Usage

```js
var render = require('pugneum-renderer');
```

### `render(ast, options)`

Compile the given pugneum abstract syntax tree,
rendering it into an HTML string.

`ast` must be a renderer-ready pugneum abstract syntax tree. The complete
source pipeline used by the `pugneum` facade is:

`lex` -> `parse` -> `load` -> `link.assemble` -> `filter` -> `link.resolve` -> `render`

Each pre-render stage removes or rewrites node families the renderer does not
consume:

| Required work before render | Parser node types |
| --- | --- |
| Direct renderer | `Block`, `BlockComment`, `Comment`, `Given`, `InterpolatedTag`, `Mixin`, `MixinBlock`, `NamedBlock`, `Tag`, `Text`, `Variable`, `YieldBlock` |
| Load and assemble files/templates | `Extends`, `Include`, `RawInclude`, `FileReference` |
| Apply filters | `Filter`, `IncludeFilter`, and a filtered `RawInclude` |
| Resolve after filtering | `References`, `ReferenceLink`, `ReferenceImage`, `Footnotes`, `FootnoteRef`, `Toc` |

Direct rendering of parser output is safe only when the entire tree contains
nodes from the `Direct renderer` row and satisfies their normal structural
requirements. Merely omitting includes, extends, and filters is not sufficient:
references, footnotes, and TOC nodes also require `link.resolve`. Prefer the
`pugneum` facade for general source templates. The deliberately primitive
example below contains only `Block`, `Tag`, and `Text` nodes, so it can be
rendered directly.

`Tag.name` and `InterpolatedTag.expr` must use the lexer-supported name syntax:
an ASCII-letter start, followed by ASCII letters, digits, underscores, hyphens,
or colons, with a hyphen or colon only between word characters. The renderer
checks this again for direct and generated AST callers and throws a located
`PUGNEUM:INVALID_TAG_NAME` before writing malformed markup.

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

HTML void-element identity is ASCII-case-insensitive, while output retains the
tag name's authored spelling. SVG self-closing names remain case-sensitive.
Class attributes are coalesced with the same HTML identity: string
contributions are space-joined into one canonical `class="..."`, and a lone
valueless contribution is preserved as `class`.

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
