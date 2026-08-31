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
`FEED_INVALID_URL` error. The base is a directory URL and cannot contain a
query or fragment; its pathname is canonicalized with a trailing slash.
Configured Atom/RSS output names remain literal filesystem paths, while
URL-delimiter characters in those names are percent-encoded in public self
links.

Atom and RSS are published as one rollback-protected transaction. Serializer
setup, including eager format validation, completes before output setup. Each
document is then generated and staged in header/entry/footer chunks before
either final name changes, so the two complete XML documents never need to
coexist in memory. If a later write or rename fails, prior outputs are restored
(or both fresh outputs are removed), temporary artifacts are cleaned up, and
generation fails with `PUGNEUM:FEED_WRITE_FAILED` naming the affected output.

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

`data-published-at` accepts a real ISO-8601 calendar date (`YYYY-MM-DD`) or a
datetime with hours and minutes, optional seconds (and fractional seconds), and
an optional `Z` or `+HH:MM`/`-HH:MM` offset. Date-only values mean midnight UTC.
Datetimes with no zone also mean UTC, so output is independent of the build
machine's timezone.
Invalid or overflowing values (for example `2026-02-30`, an hour of `24`, or a
non-date string) use the one feed build timestamp for serialization instead of
being normalized to another instant. Empty attributes are not entries. Valid
entries are ordered by their UTC instant regardless of authored offset; equal
instants retain document order, and invalid values remain stable after valid
entries. With no valid newest entry—including an empty feed—the Atom `updated`
and RSS `lastBuildDate` values use that same build timestamp.

The index `<html lang>` value is copied to `xml:lang` on the Atom `<feed>` root
and to RSS `<channel><language>`. Both are omitted when the HTML has no language.

Article `href` values must resolve to the configured site's scheme, host, and
credentials. Document-relative paths map directly beneath `outputDirectory`;
root-relative and same-site absolute URLs map their pathname beneath that root.
The pathname is percent-decoded for file lookup, while its query and fragment
remain only in the canonical public entry URL. External origins, non-local
schemes, malformed escapes, parent segments, backslashes, and encoded path
separators are rejected before filesystem access.

### Article pages

Each article page provides per-entry metadata via `<meta>` tags.
The content of the configured `selector` element (default `<article>`) becomes
the feed entry content. Despite its historical option name, `selector` accepts
one element tag name, not CSS selector syntax; CSS-like values are rejected as
invalid options. A valid tag name that does not occur in an article page
produces an empty entry body.
Metadata `name` values are matched ASCII-case-insensitively, as in HTML; when
the same name appears more than once, the first element supplies the value.
`<meta name="keywords">` (a comma-separated list) is emitted as feed
categories: `<category term="...">` in Atom and `<category>` in RSS.

Relative URLs in entry content are rewritten to absolute URLs against the
article's effective document base: the first `<base href>` in that page when
usable, or its canonical public entry URL otherwise. This keeps root-relative,
document-relative, parent-relative, and query-only `href`/`src`/`poster`/`srcset`
values on `a`/`img`/`source`/`video`/`audio`/`iframe` meaningful in a feed reader.
Fragment-only, already-absolute, protocol-relative, and explicit-scheme values
are left unchanged. An invalid or non-hierarchical article base falls back to
the entry URL.
`srcset` candidate tokenization preserves comma-bearing data URLs and paths,
empty candidates, descriptors, and spacing; only relative URL tokens are
rewritten according to the same relative-URL policy.

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

The CommonJS package exports this one generation function. URL rewriting,
extractors, and individual serializers are implementation details rather than
additional package-root exports.

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

The complete option object is validated before any input is read or output is
created, including when `feeds.enabled` is `false`. `outputDirectory` is a
required non-empty string; `writeDirectory` must be a non-empty string when
provided; `feeds` must be an object; `enabled` must be a boolean; and every
other supported `feeds.*` value must be a string. `index`, `atom`, and `rss`
must be non-empty, and `selector` must be one element tag name. Atom and RSS names must
also resolve to different destinations after path normalization. Invalid
configuration fails consistently with the `PUGNEUM:FEED_INVALID_OPTIONS` error
code before filesystem access.

## License

MIT
