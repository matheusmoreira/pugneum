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

Reference (`@[name]`, `![name]`) and footnote (`^[name]`) definitions are
resolved **per file**: a `@[name]`/`^[name]` use is matched only against a
`references`/`footnotes` block in the **same** physical file. A use whose
definition lives in a parent layout (`extends`), in an included partial, or in
the including file (for a use inside an included partial) raises
`UNDEFINED_REFERENCE` / `UNDEFINED_FOOTNOTE`. Keep each `references`/`footnotes`
block in the same file as the uses it serves. (By contrast, `toc` collects
headings across `include` boundaries because includes are spliced in before the
toc is resolved.)

## License

  MIT
