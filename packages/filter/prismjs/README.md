# pugneum-filter-prismjs

Syntax highlighting in pugneum templates with prismjs.

## Installation

    npm install pugneum-filter-prismjs

## Usage

Pugneum filters are applied with a **leading** colon (`:filtername`):

```
pre
  code
    :prismjs(language=scheme)
      (define (square x) (* x x))
```

The filter body is highlighted as text — pugneum never executes it.

## Attributes

- `language` — the Prism language name (e.g. `scheme`, `javascript`). When
  supplied, it must be a nonempty known language string. Unknown and malformed
  values are hard `PUGNEUM:INVALID_HIGHLIGHT_OPTION` errors. When omitted, the
  body is HTML-escaped and emitted without token markup (no auto-detection and
  no Prism grammar bundle initialization).

Unknown attributes use the same coded error instead of silently selecting the
escape-only path.

## License

  MIT
