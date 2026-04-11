# Feed Generation for Pugneum

## Overview

A separate build tool that reads compiled HTML output and generates Atom and RSS 2.0 feed files. It extracts article metadata from index pages and article pages, then serializes it into standard feed formats.

This is a post-compilation step — it operates on HTML files, not `.pg` templates. It lives in the monorepo as an optional dependency, following the same pattern as filter packages like `pugneum-filter-prismjs`.

## Package

**Name:** `pugneum-feed`
**Location:** `packages/feed/`
**Dependencies:** `htmlparser2` (HTML parsing), `pugneum-error` (error reporting)

```
packages/feed/
  index.js          — main entry: orchestrates extraction + generation
  lib/
    extract.js      — HTML parsing and metadata extraction
    atom.js         — Atom XML generation
    rss.js          — RSS 2.0 XML generation
  test/
    index.test.js   — snapshot tests for generated feeds
    fixtures/       — mock HTML files for testing
  package.json
```

Exports a single function that takes a config object (output directory, feed settings) and produces feed files.

## Configuration

### Activation

Feed generation is controlled by the `feeds` key in `pugneum.json`:

- `feeds` key absent: feed generation skipped entirely.
- `feeds.enabled: true`: generate feeds.
- `feeds.enabled: false`: skip feed generation, config preserved for later.
- `feeds.enabled` not set but `feeds` key present: defaults to `true`.

### Schema

All fields except `enabled` are optional. Values are extracted from HTML first, with JSON config serving as fallback/override.

```json
{
  "feeds": {
    "enabled": true,
    "url": "https://matheusmoreira.com",
    "title": "Override Title",
    "author": "Override Author",
    "index": "articles.html",
    "selector": "article",
    "atom": "atom.xml",
    "rss": "rss.xml"
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `true` (if `feeds` key present) | Toggle feed generation on/off |
| `url` | Extracted from `<base href>` | Site base URL (required — error if unresolvable) |
| `title` | Extracted from `<title>` | Feed title |
| `author` | Extracted from `<meta name="author">` | Feed author name |
| `index` | `index.html` | Index page to parse for article discovery |
| `description` | Extracted from `<meta name="description">` | Feed description (required for RSS) |
| `selector` | `article` | Tag name for article content extraction |
| `atom` | `atom.xml` | Output filename for Atom feed |
| `rss` | `rss.xml` | Output filename for RSS feed |

### Metadata Resolution Order

Each piece of metadata follows the same pattern: extract from HTML first, fall back to JSON config.

**Base URL:**
1. `<base href="...">` in the index page
2. `feeds.url` in `pugneum.json`
3. Error with guidance if neither found

**Feed title:**
1. `<title>` of the index page
2. `feeds.title` in `pugneum.json`

**Feed author:**
1. `<meta name="author">` on the index page
2. `feeds.author` in `pugneum.json`

**Feed description:**
1. `<meta name="description">` on the index page
2. `feeds.description` in `pugneum.json`

**Language:**
1. `<html lang="...">` attribute
2. No JSON override (language belongs in the HTML)

## HTML Extraction Pipeline

### Phase 1: Index Page Discovery

1. Read `{outputDirectory}/{index}` (default `index.html`)
2. Parse with `htmlparser2`
3. Extract feed-level metadata: `<base href>`, `<title>`, `<meta name="description">`, `<meta name="author">`, `<html lang>`
4. Find all elements with a `data-published-at` attribute
5. For each, find the `<a>` inside it — extract `href` (article URL) and text content (article title)
6. Sort entries by `data-published-at` descending (newest first)

### Phase 2: Article Page Enrichment

For each discovered entry:

1. Resolve the `href` to a file path in the output directory
2. Read and parse the article HTML
3. Extract from `<meta>` tags: `description`, `author`, `keywords`
4. Extract innerHTML of `<article>` element (or configured selector) for full content
5. Extract `<title>` as authoritative title (falling back to link text from index)

### Extracted Entry Data Structure

```js
{
  url: 'https://matheusmoreira.com/articles/example',
  title: 'Example Article',
  published: '2026-04-01',  // from data-published-at
  summary: '...',            // from meta description
  author: '...',             // from meta author, falls back to feed-level
  content: '...',            // innerHTML of <article>
  keywords: ['...']          // from meta keywords
}
```

## Feed Output Formats

### Atom (RFC 4287)

```xml
<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>{feed title}</title>
  <subtitle>{feed description}</subtitle>
  <link href="{base url}" rel="alternate"/>
  <link href="{base url}/atom.xml" rel="self"/>
  <id>{base url}/</id>
  <updated>{most recent entry date, ISO 8601}</updated>
  <author>
    <name>{feed author}</name>
  </author>
  <generator>pugneum-feed</generator>

  <entry>
    <title>{entry title}</title>
    <link href="{entry url}" rel="alternate"/>
    <id>{entry url}</id>
    <published>{data-published-at, ISO 8601}</published>
    <updated>{data-published-at, ISO 8601}</updated>
    <summary>{meta description}</summary>
    <content type="html">{article innerHTML, XML-escaped}</content>
    <author>
      <name>{entry author or feed author}</name>
    </author>
  </entry>
</feed>
```

- Content uses XML character escaping for embedded HTML.
- `<updated>` reuses the published date. Future enhancement: support a separate `data-updated-at` attribute for articles that have been modified after publication.

### RSS 2.0

```xml
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>{feed title}</title>
    <link>{base url}</link>
    <description>{feed description}</description>
    <language>{html lang}</language>
    <lastBuildDate>{most recent entry date, RFC 822}</lastBuildDate>
    <generator>pugneum-feed</generator>
    <atom:link href="{base url}/rss.xml" rel="self" type="application/rss+xml"/>

    <item>
      <title>{entry title}</title>
      <link>{entry url}</link>
      <guid isPermaLink="true">{entry url}</guid>
      <pubDate>{data-published-at, RFC 822}</pubDate>
      <description>{meta description}</description>
      <content:encoded><![CDATA[{article innerHTML}]]></content:encoded>
      <author>{entry author}</author>
    </item>
  </channel>
</rss>
```

- Full content uses `content:encoded` with CDATA sections (standard RSS extension, universally supported).
- Includes `atom:link rel="self"` for feed autodiscovery (RSS Advisory Board best practice).
- Dates in RFC 822 format.

## CLI Integration

Feed generation hooks into the existing CLI after HTML compilation:

```
1. Read pugneum.json
2. Compile all .pg → .html
3. Write HTML to outputDirectory
── new ──
4. If feeds key exists in config:
     a. Check feeds.enabled (default true)
     b. If disabled, skip
     c. Try to require('pugneum-feed')
     d. If not installed, warn: "pugneum-feed is not installed, skipping feed generation"
     e. If installed, run feed generation against outputDirectory
     f. Write atom.xml and rss.xml to outputDirectory
```

### Error Behavior

| Condition | Behavior |
|-----------|----------|
| `pugneum-feed` not installed, `feeds` config present | Warning, skip feed generation |
| Base URL unresolvable (no `<base>`, no `feeds.url`) | Error with guidance on what to add |
| Article page not found for a discovered link | Warning, skip that entry, continue |
| No `data-published-at` entries found on index page | Empty feed (valid XML, zero entries) |
| RSS description missing (no `<meta name="description">`, no config) | Error with guidance |

## Testing

Uses `node:test` with `node:assert/strict` and snapshot testing, consistent with all other pugneum packages.

### Fixtures

A small set of HTML files simulating compiled pugneum output:
- `fixtures/index.html` — index page with `<base>`, metadata, `<li data-published-at="...">` entries
- `fixtures/articles/first.html`, `second.html` — article pages with meta tags and `<article>` content

### Test Cases

1. **Extraction** — Verify extracted data structure from fixture HTML. Snapshot.
2. **Atom generation** — Verify Atom XML output from extracted data. Snapshot.
3. **RSS generation** — Verify RSS XML output from extracted data. Snapshot.
4. **End-to-end** — Full pipeline from fixtures directory + config to feed files. Snapshot both outputs.
5. **Config overrides** — JSON config values take precedence over HTML-extracted values.
6. **Error cases** — No base URL, missing article files, no entries found, missing RSS description.

No integration with the full pugneum compilation pipeline. The feed tool reads HTML, so fixtures are just HTML files. Clean separation.

## Future Enhancements

- `data-updated-at` attribute support for articles modified after publication, populating the Atom `<updated>` and RSS `<lastBuildDate>` per-entry fields with a date distinct from publication.
- Selective feed inclusion/exclusion via a `data-pugneum-feed` boolean attribute.
