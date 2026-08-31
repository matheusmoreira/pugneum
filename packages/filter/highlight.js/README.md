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
  It must be a nonempty known language string. When omitted, highlight.js
  auto-detects among a bounded default set: Bash, C, C++, CSS, Go, Java,
  JavaScript, JSON, Markdown, Python, Ruby, Rust, SQL, TypeScript, XML, and YAML.
- `languageSubset` — a comma-separated list of languages to restrict
  auto-detection to (only used when `language` is not given), e.g.
  `languageSubset=c,c++`. Entries are trimmed, must name installed languages,
  and are deduplicated by grammar (including aliases). The serialized option is
  limited to 1,024 characters and 32 distinct grammars.
- `ignoreIllegals` — available only with an explicit `language`. When omitted or
  `false`, illegal-token sequences abort highlighting (strict mode); set
  `ignoreIllegals` (or `ignoreIllegals=true`) to highlight permissively. The
  accepted values are boolean/string `true` and `false`.

`language` and `languageSubset` are mutually exclusive. Unknown attributes and
invalid combinations fail with `PUGNEUM:INVALID_HIGHLIGHT_OPTION` rather than
silently selecting another highlighting mode.

## License

  MIT
