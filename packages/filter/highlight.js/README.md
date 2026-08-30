# pugneum-filter-highlight.js

Syntax highlighting in pugneum templates with highlight.js.

## Installation

    npm install pugneum-filter-highlight.js

## Usage

Pugneum filters are applied with a **leading** colon (`:filtername`). The
auto-resolved name for this package is `highlight.js` (the filterer requires
`pugneum-filter-<name>`), so invoke it as `:highlight.js`:

```
pre
  code
    :highlight.js(language=scheme)
      (define (square x) (* x x))
```

The filter body is highlighted as text — pugneum never executes it.

## Attributes

- `language` — the highlight.js language name (e.g. `scheme`, `javascript`).
  When omitted, highlight.js auto-detects the language.
- `languageSubset` — a comma-separated list of languages to restrict
  auto-detection to (only used when `language` is not given), e.g.
  `languageSubset=c,c++`.
- `ignoreIllegals` — when omitted or `false`, illegal-token sequences abort
  highlighting (strict mode); set `ignoreIllegals` (or `ignoreIllegals=true`) to
  highlight permissively. A bare flag and the string `true` enable it; every
  other value (including `false`) disables it.

## License

  MIT
