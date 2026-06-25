# pugneum-loader

The pugneum loader resolves the paths to
and reads the contents of the files
referenced by a pugneum abstract syntax tree.

For every `Include`, `RawInclude`, and `Extends` node it populates the node's
`file` (a `FileReference`) with:

 - `fullPath` — the resolved absolute path of the referenced file
 - `raw` — the file contents as a `Buffer` (genuine bytes)
 - `str` — the file contents decoded as UTF-8 text (`raw.toString('utf8')`)

For `Include` and `Extends` (pugneum source files, as opposed to `RawInclude`,
which is verbatim text) it also lexes and parses the file and recursively loads
*its* dependencies, attaching the result as `file.ast`. `RawInclude` targets are
read but never lexed/parsed, so they have no `file.ast`.

## Installation

    npm install pugneum-loader

## Usage

```js
var load = require('pugneum-loader');
```

### `load(ast, options)`

Loads all dependencies of the pugneum AST. Returns a new AST (the input is
cloned, so callers must use the return value).

`options` may contain the following properties:

 - `lex` (function): **(required)** pugneum lexer to use
 - `parse` (function): **(required)** pugneum parser to use
 - `resolve` (function): path resolution function (defaults to `load.resolve`)
 - `read` (function): file reading function (defaults to a synchronous read
   returning a `Buffer`)
 - `basedir` (string): the project root. **Required** for absolute references,
   and it is the containment boundary for relative references (see
   "Path containment" below)
 - `maxLoadDepth` (number): maximum include/extends recursion depth
   (default `256`); a deeper non-cyclic chain throws `LOAD_DEPTH_EXCEEDED`
 - `filename` (string) / `source` (string): the entry file's path and source
   text; used to seed error context
 - `warnings` (array): a shared diagnostics array threaded through to the
   lexer/parser of included files
 - `sources` (object): **output** — a map of resolved path → source text that
   the loader populates (on the passed `options` object) and that the linker
   and renderer read to attach source context to their own diagnostics

The `options` object is passed to `options.resolve` and `options.read`.

#### `resolve(filename, source, options)`

Resolves the full path of an included or extended file given the path of the
source file. Also exported as `load.resolve` for reuse.

`filename` is the referenced file.
`source` is the file that is referencing `filename`.

#### `read(filename, options)`

Returns the contents of a file as a `Buffer`. By default, synchronously reads
the file referenced by `filename`. The loader derives the decoded `str` view via
`raw.toString('utf8')`; binary include-filters receive the `Buffer` as
`file.raw`, so a custom `read` should also return a `Buffer` (a returned string
is accepted and wrapped, but loses byte fidelity for non-UTF-8 data).

## Path containment (default-deny)

Relative and absolute `include`/`extends` references are contained to the
project root and may not escape it:

 - **Absolute** references (`/foo.pg`) resolve against `basedir` and must stay
   within it.
 - **Relative** references resolve against the including file's directory and
   must stay within `basedir` (or, when no `basedir` is configured, within the
   including file's own directory).

A reference that resolves outside the boundary is a hard
`PUGNEUM:PATH_ESCAPE` error. Containment is checked against **real** paths
(`fs.realpathSync`), so a symlink located inside the root that points outside it
cannot be used to escape.

The only supported way to reference content outside the project is a **library
include**: install the content as an npm package and reference it with an
`@`-prefixed path (see below). Such references are contained to the resolved
package directory.

## Library includes (`@`-prefixed)

A reference beginning with `@` is resolved from `node_modules` instead of the
filesystem:

 - `@pkg/file.pg` → the file `file.pg` inside the installed package `pkg`.
 - `@@scope/pkg/file.pg` → the file inside the scoped package `@scope/pkg`
   (the doubled `@` distinguishes a scoped package).

The resolved file must stay within the package directory (checked with
realpath), otherwise `PATH_ESCAPE` is thrown.

## Circular dependencies

`Include`/`Extends` cycles are detected and throw `PUGNEUM:CIRCULAR_DEPENDENCY`.
The detector keys on each file's real (symlink-resolved) path, so a cycle is
caught regardless of how the same physical file is spelled. A *diamond*
dependency (the same file reached via two independent, non-cyclic branches) is
permitted and loaded on each branch.

## Errors

The loader throws coded `PUGNEUM:` errors that callers may discriminate on via
`err.code`:

 - `FILENAME_REQUIRED` — a relative reference with no `filename`/`source`
 - `BASEDIR_REQUIRED` — an absolute reference with no `basedir`
 - `PATH_ESCAPE` — a reference that escapes the project root or package dir
 - `CIRCULAR_DEPENDENCY` — an `include`/`extends` cycle
 - `LOAD_DEPTH_EXCEEDED` — the include/extends chain exceeds `maxLoadDepth`
 - `INVALID_LIBRARY_PATH` — a malformed `@`-prefixed library reference
 - `PACKAGE_NOT_FOUND` — an `@`-prefixed package that is not installed
 - `INVALID_AST` — a node whose `file` is not a `FileReference`
   (internal invariant; only reachable via a hand-built AST)
 - `LOAD_ERROR` — any other read/resolve failure (e.g. a missing file);
   a `PUGNEUM:`-prefixed code thrown by a custom `read`/`resolve` is preserved

## License

  MIT
