# pugneum-linker

Link multiple pugneum ASTs together using include/extends

## Installation

    npm install pugneum-linker

## Usage

```js
var link = require('pugneum-linker');
```

### `link(ast, options)`

Flatten the pugneum AST of inclusion and inheritance.

This function merely links the AST together.
It doesn't read the file system to resolve
and parse included and extended files.
Thus, the main AST must already have the ASTs
of the included and extended files embedded
in the `FileReference` nodes.
`pugneum-loader` is designed to do that.

`options` can contain the following properties:

 - `sources` (object): a map from filename to that file's pugneum source
   string, used to attach source context (`±3` lines and a caret) to errors and
   warnings. This map is normally populated by `pugneum-loader`, which seeds it
   from the entry file's `source`/`filename` and adds an entry for every
   included/extended file. A caller driving the linker standalone must supply
   `sources` to get source context; passing only a singular `source` has no
   effect on linker diagnostics.
 - `warnings` (array): non-fatal diagnostics are pushed here. If omitted, the
   linker establishes an empty array on `options.warnings` so a direct caller
   can still read them back; the array is shared with the included/extended
   subtrees so each diagnostic is collected once on the assembled tree.
 - `maxLinkDepth` (number): maximum template inheritance/include chain depth; default `256`

### Diagnostics

The linker throws `PUGNEUM:`-coded errors (e.g. `UNDEFINED_REFERENCE`,
`DUPLICATE_REFERENCE`, `UNDEFINED_FOOTNOTE`, `DUPLICATE_FOOTNOTE`,
`UNEXPECTED_BLOCK`, `LINK_DEPTH_EXCEEDED`, `MISSING_YIELD`) for fatal problems,
and pushes the following non-fatal warnings into `options.warnings`:

 - `DUPLICATE_ID` — two elements share the same `id`.
 - `IMG_WITHOUT_ALT` — an `img` has no `alt` attribute.
 - `UNUSED_REFERENCE` — a `references` entry is defined but never used.
 - `UNUSED_FOOTNOTE` — a `footnotes` entry is defined but never referenced.
 - `EMPTY_TOC` — a `toc` produced nothing (no headings with an explicit `id`).

HTML tag and attribute names used by these lints and by table-of-contents
discovery have ASCII-case-insensitive identity. Their authored spelling in the
AST is preserved.

The linker also resolves:

 - **Reference links/images** — `@[name]` and `![name]` nodes are
   resolved against a `references` block. Definitions can include
   optional default display text: `name url Default Text`.
 - **Footnotes** — `^[name]` nodes are resolved against a `footnotes`
   block. Three-pass architecture: collect definitions, resolve all
   references (including nested refs in definition content), then
   generate the `<section role="doc-endnotes">` structure with
   numbered markers and DPUB-ARIA accessibility roles.
 - **Table of contents** — `toc` nodes are replaced with a
   `<nav role="doc-toc">` containing nested `<ol>` lists
   linking to headings with explicit `id` attributes.

### Scope of references and footnotes

Reference (`@[name]`, `![name]`), footnote (`^[name]`), and `toc` resolution
runs as a single pass over the **fully assembled document** — after `extends`
and `include` are spliced in and filters have run. Resolution is therefore
**document-global**: a `@[name]`/`^[name]` use matches any
`references`/`footnotes` block in the assembled tree, regardless of which
physical file the use or the definition came from (a use in an included partial
resolves against a block in the including file, and vice versa). A use with no
matching definition anywhere in the document raises `UNDEFINED_REFERENCE` /
`UNDEFINED_FOOTNOTE`; because the namespace is document-wide, duplicate names
collide across files (`DUPLICATE_REFERENCE` / `DUPLICATE_FOOTNOTE`), and only
one `footnotes` block is allowed per document (`DUPLICATE_FOOTNOTES_BLOCK`).
Running after the filterer is also what lets references, footnotes, and `toc`
emitted by a `pugneum`-type filter (e.g. a `:table` cell) resolve against the
document's blocks.

## License

  MIT
