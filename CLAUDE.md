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
  → linker     links ASTs together (template inheritance, includes, named blocks, reference links)
  → filterer   applies text filters (highlight.js, prismjs, etc.)
  → renderer   generates HTML string from final AST
```

Orchestrated in `packages/pugneum/index.js` (38 lines — the entire pipeline in one function).

Cross-cutting packages:
- **walker** — depth-first AST traversal with before/after hooks, used by loader, linker, and filterer
- **error** — error factory attaching source context (±3 lines) and location info, used throughout

Filter plugins (`packages/filter/`) are dynamically loaded by naming convention (`pugneum-filter-*`).

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
- `@(url text)` — inline link shorthand → `<a href="url">text</a>`
- `!(src alt)` — inline image shorthand → `<img src="src" alt="alt">`
- `@[ref text]` — reference links (URLs defined in `references` block)
- `#{var}` — variable interpolation in text and attributes (mixin arguments only); names match `[a-zA-Z_?-]`
- `#[+mixin(args)]` — inline mixin calls within text
- `mixin name(arg1 arg2?)` — `?` is part of the name, referenced as `#{arg2?}`; trailing args are implicitly optional
