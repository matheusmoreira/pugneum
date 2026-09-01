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

This adapter uses [`prism-minmaxed`](https://github.com/matheusmoreira/prism-minmaxed),
a server-only Prism fork maintained by Pugneum's author. It removes browser
code and optional project files while putting every supported language and its
dependencies in one zero-dependency package. The bundle is loaded lazily only
when a language is explicitly selected; escape-only filtering does not load
Prism.

The fork currently incorporates the server-relevant code and grammars from
Prism 1.29. Prism 1.30 changed browser-only core code, so there is no applicable
server update to carry yet. When Prism v2 is released, review its server-side
changes and give the new version the same minmaxing treatment before updating
this dependency. The tests exercise aliases, bundled dependencies, unknown
names, token output, and the escape-only no-load boundary.

## License

  MIT
