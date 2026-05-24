# pugneum-mixins

Reusable mixin library for pugneum templates.

## Installation

    npm install pugneum-mixins

## Quotation

The `quote` mixin produces a semantically correct HTML5 citation
using `figure`, `blockquote`, `figcaption`, and `cite`.

```pugneum
include @pugneum-mixins/quote.pg

+quote(https://example.com)
  block text
    | Quoted text here.
  block source
    a(href='https://example.com').
      Author, Source, #(time(datetime=2024-01-15) Jan 15, 2024)
```

```html
<figure>
  <blockquote cite="https://example.com">
    Quoted text here.
  </blockquote>
  <figcaption>
    <cite>
      <a href="https://example.com">
        Author, Source, <time datetime="2024-01-15">Jan 15, 2024</time>
      </a>
    </cite>
  </figcaption>
</figure>
```

### Parameters

- `url?` — optional source URL for the `blockquote cite` attribute

### Named blocks

- `text` — the quoted content (paragraphs, code, shorthands)
- `source` — the attribution (link, plain text, time element)

### Without a URL

```pugneum
+quote
  block text
    | An anonymous quote.
  block source
    | Unknown author
```

### Multi-paragraph quotes

Use `append text` to add paragraphs to the same blockquote:

```pugneum
+quote(https://example.com)
  block text
    p First paragraph of the quote.
  append text
    p Second paragraph.
    p Third paragraph.
  block source
    a(href='https://example.com') Author, Source
```

## License

MIT
