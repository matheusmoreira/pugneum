# pugneum-feed

Atom and RSS feed generator for pugneum sites.

Reads compiled HTML output and generates standard feed files.
It extracts article metadata from index and article pages,
then serializes it into Atom (RFC 4287) and RSS 2.0 formats.

This is a post-compilation step.
It operates on HTML files, not `.pg` templates.

## Installation

    npm install pugneum-feed

## Configuration

Add a `feeds` key to `pugneum.json`:

```json
{
  "feeds": {
    "url": "https://example.com"
  }
}
```

All `feeds.*` fields are optional. Values are extracted from HTML first,
with JSON config serving as override.

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `true` | Toggle feed generation on/off |
| `url` | From `<base href>` | Site base URL (required; must be absolute, e.g. `https://example.com/`) |
| `title` | From `<title>` | Feed title |
| `author` | From `<meta name="author">` | Feed author |
| `description` | From `<meta name="description">` | Feed description (required for RSS) |
| `index` | `index.html` | Index page to parse |
| `selector` | `article` | Element (tag) name for content extraction — not a CSS selector |
| `atom` | `atom.xml` | Atom output filename |
| `rss` | `rss.xml` | RSS output filename |

`index`, `atom`, and `rss` are rooted relative names, not operating-system
paths. `index` is resolved beneath `outputDirectory`; `atom` and `rss` are
resolved beneath `writeDirectory`. Absolute names, `..` escapes, symlinked
components, and non-regular files are rejected. Article `href` values have a
separate URL-to-file mapping; this path rule does not imply that query,
fragment, or percent-encoded URL forms are filesystem names.

The base `url` must be absolute — it must include a scheme and host
(`https://example.com/`). A path-only or protocol-relative value such as
`/blog/` or `//cdn/` would produce feeds whose identifiers and links are not
absolute, which feed readers cannot resolve, so it is rejected with a
`FEED_INVALID_URL` error.

## HTML conventions

### Index page

The index page provides feed metadata via standard HTML elements
and lists articles via elements with a `data-published-at` attribute.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <base href="https://example.com/">
  <title>My Site</title>
  <meta name="author" content="Author Name">
  <meta name="description" content="Site description">
</head>
<body>
  <ul>
    <li data-published-at="2025-01-15">
      <a href="articles/first.html">First Article</a>
    </li>
    <li data-published-at="2025-02-20">
      <a href="articles/second.html">Second Article</a>
    </li>
  </ul>
</body>
</html>
```

`data-published-at` accepts real ISO-8601 calendar dates or datetimes. Invalid
or overflowing values (for example `2026-02-30` or an hour of `24`) use the
feed build time instead of being normalized to a different instant.

### Article pages

Each article page provides per-entry metadata via `<meta>` tags.
The content of the configured selector element
(default `<article>`) becomes the feed entry content.
Metadata `name` values are matched ASCII-case-insensitively, as in HTML; when
the same name appears more than once, the first element supplies the value.
`<meta name="keywords">` (a comma-separated list) is emitted as feed
categories: `<category term="...">` in Atom and `<category>` in RSS.

Root-relative URLs (`/path`) in entry content are rewritten to absolute URLs
against the feed base, so `href`/`src`/`poster`/`srcset` on
`a`/`img`/`source`/`video`/`audio`/`iframe` resolve in a reader. Already-absolute
(`https://…`) and protocol-relative (`//host/…`) URLs are left unchanged;
document-relative URLs (`path` with no leading slash) are not rewritten.

```html
<!DOCTYPE html>
<html>
<head>
  <title>First Article</title>
  <meta name="description" content="Summary of the article">
  <meta name="author" content="Author Name">
  <meta name="keywords" content="topic, example">
</head>
<body>
  <article>
    <p>Full article content goes here.</p>
  </article>
</body>
</html>
```

## Programming interface

```js
const generateFeeds = require('pugneum-feed');

generateFeeds({
  outputDirectory: 'site',
  feeds: {
    url: 'https://example.com',
  },
});
```

This reads `site/index.html`, discovers articles,
and writes `site/atom.xml` and `site/rss.xml`.

The top-level options (siblings of `feeds`) are:

| Option | Default | Description |
|--------|---------|-------------|
| `outputDirectory` | — (required) | Directory of compiled HTML to read from |
| `writeDirectory` | `outputDirectory` | Directory to write the feed files to |
| `feeds` | `{}` | The `feeds.*` configuration above |

`outputDirectory`/`writeDirectory` are top-level options, distinct from the
`feeds.*` keys (which live under the `"feeds"` object in `pugneum.json`).
`writeDirectory` defaults to `outputDirectory`, so feeds are written back into
the directory they were read from unless a separate destination is given; feed
filenames (`atom`/`rss`) are resolved against it.

## License

MIT
