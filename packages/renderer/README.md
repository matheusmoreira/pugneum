# pugneum-renderer

Renders pugneum abstract syntax trees into HTML.

Pugneum packages require Node.js 22 or newer.

## Installation

Install only the renderer when your application already supplies a
renderer-ready AST:

    npm install pugneum-renderer

For ordinary source-to-HTML compilation, install the facade that owns the
complete pipeline:

    npm install pugneum

To run the deliberately limited direct-render example below, install its lexer
and parser too:

    npm install pugneum-renderer pugneum-parser pugneum-lexer

## Usage

Use the facade for general templates, especially ones containing includes,
inheritance, filters, references, footnotes, or a table of contents:

```js
var pugneum = require('pugneum');

let html = pugneum.render('p Hello, world!');
//=> '<p>Hello, world!</p>'
```

Use this package directly only when the input is already renderer-ready:

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

Before emitting bytes, the renderer iteratively validates the complete direct
AST against `pugneum-walker`'s schema and 512-edge structural-depth ceiling.
Malformed, cyclic, over-deep, or unknown-node trees fail with a located
`PUGNEUM:INVALID_AST` instead of reaching recursive dispatch as a raw native
error. Established specialized diagnostics such as `INVALID_TAG_NAME` and
`UNKNOWN_BLOCK_MODE` remain specialized.

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

### Output and trust model

The renderer is an HTML generator for trusted templates, not an HTML sanitizer.
`Text` and resolved `Variable` values are emitted verbatim, including preserved
physical newlines and any authored markup. Do not interpolate untrusted data
into text without applying an application-appropriate escaping or sanitization
policy first.

Attribute values are always double-quoted. After mixin-variable substitution,
the renderer escapes `&` as `&amp;` and `"` as `&quot;`; `<` and `>` remain
literal because they are valid inside a quoted HTML attribute. Boolean
attributes use the value `true` and render without `="..."`. Other attribute
value types are outside the renderer contract.

Buffered `Comment` and `BlockComment` nodes render one HTML comment envelope.
The renderer makes forbidden comment byte patterns safe by separating repeated
hyphens and padding disallowed leading or trailing characters. Unbuffered
comments produce no output, and unbuffered block descendants are not evaluated.
Source newlines inside buffered content remain source newlines; “verbatim” does
not mean single-line.

The renderer has no doctype logic of its own. A `<!DOCTYPE html>`
only appears when the source contains an explicit `doctype html`
line, which the lexer pre-renders into a text token the renderer
buffers verbatim.

HTML void-element identity is ASCII-case-insensitive, while output retains the
tag name's authored spelling. Only void elements in the HTML namespace reject
substantive content, using `PUGNEUM:VOID_ELEMENT_WITH_CONTENT`; whitespace-only
source formatting is ignored. Empty common shapes inside `svg` retain compact
` />` spelling, but SVG elements with children use explicit end tags. Children
of SVG `foreignObject`, `desc`, and `title` return to HTML parsing, and a nested
`svg` enters SVG again. SVG-like names outside SVG are ordinary paired HTML
elements. Because HTML has no self-closing custom elements, a direct AST
`selfClosing` flag never suppresses the end tag of a non-void HTML element.

Class attributes are coalesced with the same HTML identity: string
contributions are space-joined into one canonical `class="..."`, and a lone
valueless contribution is preserved as `class`.

`Given` tests whether a caller supplied a named block, not whether that block
eventually emits bytes. It therefore renders for an explicitly supplied empty
named block and skips when the caller did not name the block at all.

Each mixin invocation has an own, null-prototype parameter environment. A
callee cannot capture an undeclared caller parameter; a nested call forwards a
caller value explicitly with `#{name}` in its argument. Mixin declarations bind
in source order and declarations evaluated inside an invocation are scoped to
that invocation. Recursion, use tracking, and `UNUSED_MIXIN` warnings follow
declaration identity, so same-name shadowing and redefinition do not conflate
distinct declarations.

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
- `compilationLimits` / `compilationContext` — a local limit override object or
  the build-wide context created by `pugneum-error`. Direct-AST validation,
  rendered AST visits, UTF-8 output bytes, mixin calls, and warnings consume
  the shared budget.

Located template/AST diagnostics throw `Error` instances whose `code` begins
with `PUGNEUM:` and which carry available `filename`, `line`, `column`, and
source context. Invalid public argument types throw `TypeError`. Warnings use
the located diagnostic shape and are appended to the caller-supplied `warnings`
array; the renderer never prints them itself.

## License

  MIT
