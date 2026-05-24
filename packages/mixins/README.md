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

### `+plain-quote`

Unlinked citation: no URL, no `<a>` tag.

```pugneum
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
  :prismjs(javascript)
    console.log('hello');
  block caption
    | A minimal program.
```

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

File tree visualization. Directories support an optional
`block description` annotation.

```pugneum
include @pugneum-mixins/file-system.pg

+file-system
  +directory(src)
    block description
      |  — source code
    +file(index.js)
    +file(render.js)
```

## License

MIT
