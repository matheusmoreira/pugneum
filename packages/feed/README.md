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

All fields are optional. Values are extracted from HTML first,
with JSON config serving as override.

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `true` | Toggle feed generation on/off |
| `url` | From `<base href>` | Site base URL (required) |
| `title` | From `<title>` | Feed title |
| `author` | From `<meta name="author">` | Feed author |
| `description` | From `<meta name="description">` | Feed description (required for RSS) |
| `index` | `index.html` | Index page to parse |
| `selector` | `article` | Tag name for content extraction |
| `atom` | `atom.xml` | Atom output filename |
| `rss` | `rss.xml` | RSS output filename |

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

### Article pages

Each article page provides per-entry metadata via `<meta>` tags.
The content of the configured selector element
(default `<article>`) becomes the feed entry content.

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

## License

MIT
