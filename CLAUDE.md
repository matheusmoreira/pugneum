# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Pugneum is a static HTML template engine forked from Pug. All dynamic/JavaScript features have been removed — templates are pure structure, never code. This is a core design principle: never propose conditionals, loops, expressions, or anything requiring runtime evaluation. New syntax must desugar to existing HTML primitives.

## Commands

```bash
npm install              # Install all workspace dependencies
npm test                 # Run all tests (node:test across all packages)
npm run test:update-snapshots  # Regenerate all snapshot files after intentional output changes
npm run format           # Format all JS files with prettier
npm run prettier:check   # Check formatting without writing

# Run a single package's tests
node --test packages/lexer/test/index.test.js

# Run all tests in one package
node --test 'packages/renderer/test/*.test.js'
```

## Architecture

npm workspaces monorepo. The compilation pipeline is a strict linear sequence — each stage takes an AST (or tokens) and returns a transformed version:

```
source string
  → lexer      tokenizes into token array
  → parser     builds AST from tokens
  → loader     resolves file dependencies (include/extends), recursively lexing+parsing them
  → linker     links ASTs together (template inheritance, includes, named blocks, reference links/images)
  → filterer   applies filters (highlight.js, prismjs, table, etc.) with typed dispatch
  → renderer   generates HTML string from final AST
```

Orchestrated in `packages/pugneum/index.js` (38 lines — the entire pipeline in one function).

Cross-cutting packages:
- **walker** — depth-first AST traversal with before/after hooks, used by loader, linker, and filterer
- **error** — error factory attaching source context (±3 lines) and location info, used throughout

Filter plugins (`packages/filter/`) are dynamically loaded by naming convention (`pugneum-filter-*`). Every filter must declare `exports.type` as one of:
- `text` — plain text output, HTML-escaped by the filterer
- `html` — raw HTML output, passed through as-is (used by prismjs, highlight.js, verbatim)
- `pugneum` — Pugneum source output, re-lexed/re-parsed into AST nodes (used by table filter; enables inline shorthands in filter output)
- `syntax` — direct AST node array, inserted into the tree

Filters used with `include:filter` are restricted to `text` and `html` types.

## Testing

Uses Node.js native test runner (`node:test`) with `node:assert/strict`. No external test framework.

**Shared test cases** live in `/test-cases/` — `.pg` input files shared across package tests. Some have paired `.html` files for expected output.

**Snapshot testing** via `t.assert.snapshot()` — most packages snapshot their output (tokens, AST, HTML). Snapshot files are `*.test.js.snapshot` alongside test files.

**Error tests** — packages have `test/errors/*.pg` files that are snapshot-tested for expected error codes, messages, and locations.

**Renderer tests** build AST nodes directly with helper functions rather than running the full pipeline.

## Code Style

Prettier with: `singleQuote: true`, `bracketSpacing: false`, `trailingComma: 'all'`. Node.js >=18, CommonJS (`require`/`exports`).

## Template Syntax (unique to pugneum)

Beyond standard Pug syntax, pugneum adds:

### Inline shorthands

Pugneum's inline shorthands use three delimiter types, each signaling when content is resolved:

- `()` — self-contained / immediate: content desugars at lex time
- `[]` — reference / deferred: content is a name resolved by the linker against a `references` block
- `{}` — substitution / binding: variable name resolved from mixin scope during rendering

Self-contained shorthands (`sigil(content)`):
- `@(url text)` — inline link → `<a href="url">text</a>`
- `!(src alt)` — inline image → `<img src="src" alt="alt">`; supports extra attributes via `!(src alt)(attrs)`
- `*(text)` — inline strong → `<strong>text</strong>`
- `_(text)` — inline emphasis → `<em>text</em>`
- `~(text)` — inline del → `<del>text</del>`
- `^(text)` — inline sup → `<sup>text</sup>`
- `%(text)` — inline kbd → `<kbd>text</kbd>`
- `,(text)` — inline sub → `<sub>text</sub>`
- `` `(code) `` — inline code → `<code>code</code>`; content is literal (no inner shorthand processing)
- `?(abbr expansion)` — inline abbr → `<abbr title="expansion">abbr</abbr>`; without expansion: `<abbr>abbr</abbr>`
- `#(tag text)` — inline tag interpolation → `<tag>text</tag>`
- `#(+mixin(args))` — inline mixin call

Reference shorthands (`sigil[name content]`):
- `@[ref text]` — reference link (URL defined in `references` block)
- `![ref alt]` — reference image (URL defined in `references` block); supports extra attributes via `![ref alt](attrs)`
- `^[name]` — footnote reference (content defined in `footnotes` block); generates numbered markers with bidirectional anchors and DPUB-ARIA roles

Substitution:
- `#{var}` — variable interpolation in text and attributes (mixin arguments only); names match `[a-zA-Z_?-]`

Shorthands nest: `*(strongly _(emphasized `(code)))` works. Balanced parentheses in content are handled by depth tracking. Escaped sigils (`\*(`, `\_(`, etc.) produce literal text.

### Other syntax
- `mixin name(arg1 arg2?)` — `?` is part of the name, referenced as `#{arg2?}`; trailing args are implicitly optional
- Named mixin blocks — `block name` inside a mixin defines a named slot; callers fill slots with `block name`, `append name`, or `prepend name`; a mixin uses either one unnamed `block` or named blocks, never both
