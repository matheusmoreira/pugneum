# pugneum-mixins

Reusable mixin library for pugneum templates.

## Installation

    npm install pugneum-mixins

## Quotation

### `+quote(source?)`

Figure-wrapped quotation. The optional source URL is used only for the
`blockquote cite=` attribute. A supplied `block caption` becomes the
`figcaption`; without it, the caption is omitted.

```pugneum
include @pugneum-mixins/quote.pg

+quote(https://example.com/quotation)
  | Quoted text here.
  block caption
    +linked-citation(https://example.com/work)
      block attribution
        | Example Author
      block title
        | Example Work
```

```html
<figure>
  <blockquote cite="https://example.com/quotation">Quoted text here.</blockquote>
  <figcaption>Example Author, <cite><a href="https://example.com/work">Example Work</a></cite></figcaption>
</figure>
```

### `+citation(separator?)`, `+linked-citation(href separator?)`

Structured citation fragments for use in a quote caption or any other phrasing
content. Both accept rich `attribution` and `title` slots. Only the title is
wrapped in `<cite>`; the linked form additionally wraps that title in an anchor.
The separator defaults to `", "` and appears only when both slots are supplied.

```pugneum
include @pugneum-mixins/quote.pg

+quote
  | An anonymous quote.
  block caption
    +citation(' — ')
      block attribution
        | Anonymous
      block title
        | Oral tradition
```

The linked helper's `href` is required by its public contract. Attribution-only
and title-only citations are valid and do not emit dangling punctuation or
empty semantic wrappers.

## Figure

### `+figure`

General-purpose figure wrapper with optional caption.

```pugneum
include @pugneum-mixins/figure.pg

+figure
  img(src="photo.jpg" alt="A sunset")
  block caption
    | A sunset over the mountains.
```

### `+code`

Code block wrapped in a figure with optional caption.

```pugneum
include @pugneum-mixins/code.pg

+code
  :prismjs(language=javascript)
    console.log('hello');
  block caption
    | A minimal program.
```

The Prism filter is a separate optional package. Install it alongside the mixin
library before using this example:

    npm install pugneum-mixins pugneum-filter-prismjs

## Disclosure

### `+details(summary?)`

Disclosure widget. A scalar summary is the simple fallback. A rich
`block summary` may be supplied instead and takes precedence when both exist.

```pugneum
include @pugneum-mixins/details.pg

+details('System Requirements')
  p Requires a computer with memory.

+details
  block summary
    | Frequently Asked *(Questions)
  p Rich phrasing is allowed in the summary.
```

## Navigation

### Breadcrumb helpers

`+breadcrumbs(label?)` creates an `aria-label` landmark and defaults to
`"Breadcrumb"`. `+breadcrumbs-labelledby(id)` instead references an authored
accessible name. `+breadcrumb-current` renders an honest non-link span;
`+breadcrumb-current-link(href)` is the explicit self-link form.

```pugneum
include @pugneum-mixins/breadcrumb.pg

+breadcrumbs('Fil d Ariane')
  +breadcrumb(/) Home
  +breadcrumb(/articles) Articles
  +breadcrumb-current-link(/articles/current) Current article
```

## File System

### `+file-system`, `+file(name)`, `+directory(name)`

File tree visualization. A file's unnamed body is rendered immediately after
its `<code>` name and can be used for an annotation. Directories instead use an
optional `block description` annotation; their unnamed body contains child
entries.

`+file-system` takes an optional CSS class. Multiple classes
must be quoted, since an unquoted argument list splits on
whitespace: write `+file-system('tree wide')`, not
`+file-system(tree wide)`.

```pugneum
include @pugneum-mixins/file-system.pg

+file-system
  +directory(src)
    block description
      |  — source code
    +file(index.js)
      |  — entry point
    +file(render.js)
```

## Notes

These mixins follow pugneum's core model: the template author
is the HTML author. A few consequences are worth calling out.

**Text arguments and slot text are emitted raw.** The `name`
in `+file`/`+directory`, a scalar `summary` in `+details`, the code
fed to `+code`, and any text in breadcrumb, quote, or citation slots are
written to the output verbatim — `<`, `>` and `&` are not
escaped. (Attribute values such as `href`/`cite`/`class` *are*
escaped.) If a value may contain HTML metacharacters or is not
fully trusted, pre-escape it or pass it through an escaping
filter (`+code` content is typically produced by
`:prismjs`/`:highlight.js`, which escape). Do not feed
untrusted data straight into these text positions.

**Multi-word arguments must be quoted.** An unquoted argument
list splits on whitespace, so `+details(System Requirements)`
and `+file-system(tree wide)` raise
`PUGNEUM:MIXIN_ARGUMENT_COUNT_MISMATCH`. Quote them:
`+details('System Requirements')`, `+file-system('tree wide')`.

**Core trailing arguments can be omitted.** Pugneum permits callers to omit
trailing mixin arguments even when their declaration has no `?` or default.
The helper contracts remain stricter: supply the `href` required by
`+breadcrumb`, `+breadcrumb-current-link`, and `+linked-citation`. A missing
required href would otherwise produce an href-less anchor. The `source` for
`+quote` and scalar `summary` for `+details` are explicitly optional.

## License

MIT
