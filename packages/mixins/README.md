# pugneum-mixins

Reusable mixin library for pugneum templates.

## Installation

    npm install pugneum-mixins

## Quotation

### `+quote(url)`

Linked citation: URL powers both `blockquote cite=` and wraps
source content in an `<a>` tag.

```pugneum
include @pugneum-mixins/quote.pg

+quote(https://example.com)
  | Quoted text here.
  block source
    | Author, Source
```

```html
<figure>
  <blockquote cite="https://example.com">Quoted text here.</blockquote>
  <figcaption><cite><a href="https://example.com">Author, Source</a></cite></figcaption>
</figure>
```

Without `block source`, the `<figcaption>` is omitted entirely.

`+quote` is the variant *with* a URL: the `source` content is
wrapped in an `<a href>`. Use `+plain-quote` when there is no
URL — calling `+quote` without one produces a `source` link
(`<a>`) that has no `href` and is therefore not a real link.
Source content given to `+quote` must not itself be
interactive (e.g. another link), since it nests inside the
outer `<a>`.

### `+plain-quote`

Unlinked citation: no URL, no `<a>` tag.

```pugneum
include @pugneum-mixins/quote.pg

+plain-quote
  | An anonymous quote.
  block source
    | Unknown author
```

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

### `+details(summary)`

Disclosure widget. Summary text with spaces requires quoting.

```pugneum
include @pugneum-mixins/details.pg

+details('System Requirements')
  p Requires a computer with memory.
```

## Navigation

### `+breadcrumbs`, `+breadcrumb(href)`, `+breadcrumb-current`

Breadcrumb trail with correct ARIA attributes.

```pugneum
include @pugneum-mixins/breadcrumb.pg

+breadcrumbs
  +breadcrumb(/) Home
  +breadcrumb(/articles) Articles
  +breadcrumb-current This Article
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
in `+file`/`+directory`, the `summary` in `+details`, the code
fed to `+code`, and any text in a breadcrumb or quote slot are
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

**Required-looking arguments are optional.** Per pugneum,
trailing mixin arguments may be omitted. Omitting `name`,
`href` or a quote `url` does not error; it renders an empty or
attribute-less element (e.g. `+breadcrumb` with no href yields
a non-link `<a>`). Supply these arguments unless an empty
element is intended.

## License

MIT
