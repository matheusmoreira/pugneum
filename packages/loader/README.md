# pugneum-loader

The pugneum loader resolves the paths to
and reads the contents of the files
referenced by a pugneum abstract syntax tree.

For every `Include`, `RawInclude`, and `Extends` node it populates the node's
`file` (a `FileReference`) with:

 - `fullPath` — the resolved path of the referenced file (an absolute path
   with the default resolver; when `basedir` checks a default or custom
   non-library result, this is the checked, symlink-resolved target)
 - `raw` — the file contents as a `Buffer` (genuine bytes)
 - `str` — the file contents decoded as UTF-8 text (`raw.toString('utf8')`)

For a filtered `RawInclude`, `str` is a lazy view: it is decoded on first
access. An innermost binary include filter can therefore consume `raw` without
allocating a duplicate UTF-8 string. Unfiltered raw includes and structured
Pugneum dependencies are decoded immediately.

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
 - `canonicalize` (function): returns the stable identity used for cycle
   detection. Filesystem loading uses real paths by default; a custom resolver
   without `basedir` defaults to its returned string unchanged, so virtual
   loaders can provide this hook when aliases need to share an identity
 - `basedir` (string): the project root. **Required** for absolute references,
   and it is the containment boundary for relative references (see
   "Path containment" below)
 - `maxLoadDepth` (number): maximum include/extends recursion depth
   (an integer from `0` through `256`, default `256`); a deeper non-cyclic
   chain throws `LOAD_DEPTH_EXCEEDED` before resolving or reading that edge
 - `filename` (string) / `source` (string): the entry file's path and source
   text; used to seed error context
 - `warnings` (array): a shared diagnostics array threaded through to the
   lexer/parser of included files
 - `sources` (object): **output** — a map of resolved path → source text that
   the loader populates (on the passed `options` object) and that the linker
   and renderer read to attach source context to their own diagnostics. A
   supplied map is preserved, and its entry-file value is refreshed. A
   filtered binary raw include is added only if its lazy `str` view is read

The normalized `options` object is passed to `resolve`, `read`, and
`canonicalize` hooks. Hook failures retain their original value as `err.cause`;
arbitrary thrown values are normalized to located Pugneum diagnostics.

#### `resolve(filename, source, options)`

Resolves the full path of an included or extended file given the path of the
source file. Also exported as `load.resolve` for reuse.

`filename` is the referenced file.
`source` is the file that is referencing `filename`.

#### `read(filename, options)`

Returns the contents of a file. By default, synchronously reads the file as a
`Buffer`. A custom reader may return a `Buffer`, `Uint8Array`, or string; the
loader normalizes every accepted result to the `Buffer` exposed as `file.raw`.
Use a `Buffer` or `Uint8Array` when byte fidelity matters. A returned string is
UTF-8 encoded and cannot recover bytes that were already decoded incorrectly.

## Path containment (`basedir`)

When `basedir` is supplied, relative and absolute `include`/`extends`
references are contained to that project root and may not escape it:

 - **Absolute** references (`/foo.pg`) resolve against `basedir` and must stay
   within it.
 - **Relative** references resolve against the including file's directory and
   must stay within `basedir`.

A reference that resolves outside the boundary is a hard
`PUGNEUM:PATH_ESCAPE` error. Containment is checked against **real** paths
(`fs.realpathSync`), so a symlink located inside the root that points outside it
cannot be used to escape. The checked canonical target is the path passed to
`read`, preventing a later swap of the original symlink from redirecting that
read.

When `basedir` is omitted, an absolute reference is rejected, but relative
references have **no containment boundary** and may use `..` beyond the entry
file's directory. That mode is suitable only for trusted templates. Set
`basedir` for project confinement. This is path-based protection for ordinary
local builds, not a descriptor-based sandbox against another process changing
the canonical target or one of its ancestors during compilation.

The same `basedir` check is applied after a custom resolver returns a
non-library path. A custom resolver's `@`-prefixed library results are treated
as resolver-managed, trusted locations instead; the default library resolver
applies its own package-root boundary.

When the project boundary is enabled, the supported way to reference content
outside it is a **library include**: install the content as an npm package and
reference it with an `@`-prefixed path (see below). Such references are
contained to the resolved package directory.

## Library includes (`@`-prefixed)

A reference beginning with `@` is resolved from `node_modules` instead of the
filesystem:

 - `@pkg/file.pg` → the file `file.pg` inside the installed package `pkg`.
 - `@@scope/pkg/file.pg` → the file inside the scoped package `@scope/pkg`
   (the doubled `@` distinguishes a scoped package).

Lookup starts beside the including source file, then uses `basedir` and the
normal process/loader fallbacks. This makes a project's installed version take
precedence over a dependency installed beside the loader.

The requested file is resolved as a package subpath, so packages may hide
their `package.json`. If a package declares `exports`, the requested template
subpath must be exported. An installed package with a missing, blocked, or
otherwise unavailable subpath throws `LIBRARY_PATH_UNAVAILABLE`; only an
absent package throws `PACKAGE_NOT_FOUND`. The resolved file must stay within
the discovered package directory (checked with realpath), otherwise
`PATH_ESCAPE` is thrown.

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
 - `LIBRARY_PATH_UNAVAILABLE` — the package exists but its requested subpath
   cannot be resolved or is not exported
 - `INVALID_AST` — a malformed known AST node or field (normally only reachable
   through a hand-built or third-party AST)
 - `LOAD_ERROR` — any other read/resolve failure (e.g. a missing file);
   a `PUGNEUM:`-prefixed code thrown by a custom `read`, `resolve`, or
   `canonicalize` hook is preserved

## License

  MIT
