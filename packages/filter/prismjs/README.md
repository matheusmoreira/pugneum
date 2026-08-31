# pugneum-filter-prismjs

Syntax highlighting in pugneum templates with prismjs.

## Installation

    npm install pugneum-filter-prismjs

## Usage

Pugneum filters are applied with a **leading** colon (`:filtername`):

```
link(rel="stylesheet", href="/styles/prism-theme.css")
pre.language-scheme
  code.language-scheme
    :prismjs(language=scheme)
      (define (square x) (* x x))
```

The filter body is highlighted as text — pugneum never executes it.

## Output and styling

The filter returns a token-markup **fragment** only. It does not emit `pre` or
`code`, add a language class, or bundle a Prism theme. Wrap the filter as shown
above, serve a Prism-compatible stylesheet yourself, and apply matching
`language-<name>` classes to the wrapper and code element. Those classes are
the styling contract; the adapter's fragment contains only Prism's `token ...`
spans.

## Attributes

- `language` — the Prism language name (e.g. `scheme`, `javascript`). When
  supplied, it must be a nonempty known language string. Unknown and malformed
  values are hard `PUGNEUM:INVALID_HIGHLIGHT_OPTION` errors. When omitted, the
  body is HTML-escaped and emitted without token markup (no auto-detection and
  no Prism grammar bundle initialization).

Unknown attributes use the same coded error instead of silently selecting the
escape-only path.

## Prism components

This adapter uses the official `prismjs` package and its `components.json`
registry. The core and requested grammar (plus declared dependencies) load only
after an explicit language is selected; there is no generated all-language
bundle to maintain. To update Prism, bump the pinned dependency floor, review
the upstream component-registry changes, and run this package's focused tests
and the repository release check. The tests exercise aliases, dependency
loading, unknown names, token output, and the escape-only no-load boundary.

## License

  MIT
