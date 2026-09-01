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
 - `str` — the file contents decoded as strictly valid UTF-8 text

For a filtered `RawInclude`, `str` is a lazy view: it is decoded on first
access. An innermost binary include filter can therefore consume `raw` without
allocating or validating a UTF-8 string. If that text view is requested,
malformed UTF-8 and disallowed controls are rejected like any other text
source. Unfiltered raw includes and structured Pugneum dependencies are
decoded and validated immediately.

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
 - `dependencyCache` (Map): optional build-scoped cache keyed by canonical
   dependency identity. Stable file bytes and pre-load parsed ASTs are reused;
   every attachment receives its own bytes and AST clone. Reuse a cache only
   while `resolve`, `read`, `canonicalize`, `lex`, parser options, and on-disk
   inputs and warning-collection behavior remain stable. Cached dependency
   warnings are replayed into each caller's sink; a deduplicating sink can
   collapse them across a build
 - `canonicalize` (function): returns the stable identity used for cycle
   detection. Filesystem loading uses real paths by default; a custom resolver
   under an explicit or inferred containment root does too. A trusted custom
   resolver using the uncontained opt-out defaults to its returned string
   unchanged, so virtual loaders can provide this hook when aliases need to
   share an identity
 - `basedir` (string): the project root. **Required** for absolute references,
   and an explicit containment boundary for relative references. When omitted,
   the entry file's directory is the relative-reference boundary (see "Path
   containment" below)
 - `allowUncontainedPathsForTrustedInput` (boolean): explicit opt-out from the
   inferred entry-directory boundary. It defaults to `false`, may be `true`
   only when `basedir` is omitted, and is appropriate only when every template
   path and custom resolver result is trusted
 - `maxLoadDepth` (number): maximum include/extends recursion depth
   (an integer from `0` through `256`, default `256`); a deeper non-cyclic
   chain throws `LOAD_DEPTH_EXCEEDED` before resolving or reading that edge
 - `compilationLimits` (object) or `compilationContext` (created by
   `pugneum-error`): a local budget or a build-wide shared budget. The loader
   charges pre-clone/schema work, traversed AST nodes, dependency edges, and
   source bytes. Default filesystem reads preflight remaining bytes before
   allocation; custom readers are charged immediately after returning and
   before their result is decoded or parsed
 - `filename` (string) / `source` (string): the entry file's path and source
   text; used to seed error context
 - `mixinContext` (`Array<'def' | 'call'>`): inherited lexical context for an
   entry fragment. The loader extends it from each include's AST ancestry
   before parsing that dependency
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

### `load.loadOwned(ast, options)`

Loads a fresh, single-owner AST in place and returns it. This is intended for
pipeline orchestrators that created the AST immediately before loading and can
prove that no caller can observe it. General callers should use `load()`, which
retains its input-preserving clone contract.

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

### `load.decodeSource(value, filename?)`

Decodes a `Buffer` or `Uint8Array` as fatal UTF-8, or validates an existing
string, and returns the source string. `filename` is optional diagnostic
context. The function rejects malformed byte sequences with
`PUGNEUM:INVALID_UTF8` and rejects C0 controls other than tab, LF, and CR, plus
DEL, with `PUGNEUM:DISALLOWED_SOURCE_CONTROL`.

These diagnostics expose a zero-based `byteOffset` in addition to their
one-based `line` and `column`; the byte offset also appears in the versioned
JSON location. Invalid UTF-8 is never converted to U+FFFD. Tabs and LF/CR/CRLF,
a leading UTF-8 BOM, and ordinary Unicode text remain valid.

## Path containment

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

When `basedir` is omitted, an absolute reference is still rejected and the
entry file's directory becomes the stable boundary for every relative load in
that compilation. A relative path may descend within that directory but may
not use `..`, a symlink, or a custom resolver result to leave it. Installed
`@`-prefixed libraries remain available through their independently checked
package roots.

The only opt-out is
`allowUncontainedPathsForTrustedInput: true`. Its name is intentionally
explicit: it restores unrestricted relative/custom resolution only for callers
that trust all authored paths and resolver results. It cannot be combined with
`basedir`. Containment is path-based protection for ordinary local builds, not
a descriptor-based sandbox against another process changing the canonical
target or one of its ancestors during compilation.

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
 - `INVALID_UTF8` — a text source contains a malformed UTF-8 byte sequence
 - `DISALLOWED_SOURCE_CONTROL` — a text source contains a forbidden C0/DEL
   control; tab and line-ending controls remain valid
 - `COMPILATION_LIMIT_EXCEEDED` — cumulative loader work exceeded its shared
   resource limit (`resource`, `attempted`, and `limit` identify the boundary)
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
