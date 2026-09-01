# Feed Generation for Pugneum

> **Status: historical design proposal (non-normative).** This document records
> the original feed design and its planned inventory; it is not the current API,
> schema, algorithm, or test specification. The authoritative user contract is
> [`packages/feed/README.md`](../../packages/feed/README.md), while current code
> and tests under `packages/feed/` define implementation behavior. In particular,
> configurable output names, activation order, metadata validation, date policy,
> and the package/test inventory have evolved since this proposal.

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
    xml.js          — shared XML utilities (escaping, serialization)
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

All fields except `enabled` are optional. JSON config values take priority over values extracted from HTML.

```json
{
  "feeds": {
    "enabled": true,
    "url": "https://matheusmoreira.com",
    "title": "Override Title",
    "author": "Override Author",
    "buildDate": "2026-04-02T12:00:00Z",
    "index": "articles.html",
    "selector": "article",
    "atom": "feeds/site.atom.xml",
    "rss": "feeds/site.rss.xml"
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `true` (if `feeds` key present) | Toggle feed generation on/off |
| `url` | Extracted from `<base href>` | Site base URL (required — error if unresolvable) |
| `title` | Extracted from `<title>` | Non-empty feed title required by both formats |
| `author` | Extracted from `<meta name="author">` | Default Atom entry author; optional when every entry supplies one |
| `index` | `index.html` | Index page to parse for article discovery |
| `description` | Extracted from `<meta name="description">` | Feed description (required for RSS) |
| `buildDate` | One captured build-start instant | Exact ISO-8601 build timestamp when configured |
| `selector` | `article` | Element tag name for article content extraction (not CSS syntax); a missing element produces empty content |
| `atom` | `atom.xml` | Output filename for Atom feed |
| `rss` | `rss.xml` | Output filename for RSS feed |

### Metadata Resolution Order

Each piece of metadata follows the same pattern: use JSON config if present, fall back to HTML extraction.

**Base URL:**
1. `feeds.url` in `pugneum.json`
2. `<base href="...">` in the index page
3. Error with guidance if neither found

**Feed title:**
1. `feeds.title` in `pugneum.json`
2. `<title>` of the index page
3. Error if the resolved string is empty or whitespace

**Feed author:**
1. `feeds.author` in `pugneum.json`
2. `<meta name="author">` on the index page
3. Per Atom entry, use the article author first and this feed author second;
   error if neither is non-empty

**Feed description:**
1. `feeds.description` in `pugneum.json`
2. `<meta name="description">` on the index page

An explicitly present JSON metadata property is the override even when blank;
required metadata validation does not silently fall back to the HTML value.
Every entry title resolves from its article `<title>` and then its index-link
text, and must be non-empty. RSS authors are optional: `<dc:creator>` is emitted
only when the resolved article/feed author is non-empty. An Atom feed-level
author is omitted when every entry has its own author (and may therefore also
be absent from an empty feed).

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
6. Parse each supported ISO-8601 `data-published-at` value once to a numeric
   instant and sort valid instants descending (newest first)

### Phase 2: Article Page Enrichment

For each discovered entry:

1. Resolve the `href` once into a canonical same-site public URL and a separate
   file path in the output directory. The public URL retains query/fragment;
   only its decoded, validated pathname participates in file lookup.
2. Read and parse the article HTML
3. Extract from `<meta>` tags: `description`, `author`, `keywords`
4. Resolve relative URLs on the selected subtree against the first article
   `<base href>` when usable, falling back to the canonical entry URL
5. Extract innerHTML of the configured element tag (default `<article>`) for full content; a missing element produces an empty body
6. Extract `<title>` as authoritative title (falling back to link text from index)

### Extracted Entry Data Structure

```js
{
  url: 'https://matheusmoreira.com/articles/example',
  title: 'Example Article',
  published: '2026-04-01',  // from data-published-at
  publishedEpoch: 1775001600000, // parsed once for ordering/serialization
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
  <link href="{public URL of configured atom output name}" rel="self"/>
  <id>{base url}/</id>
  <updated>{newest valid entry instant, or build instant, ISO 8601}</updated>
  <author> <!-- omitted when no feed-level author is needed -->
    <name>{feed author}</name>
  </author>
  <generator>pugneum-feed</generator>

  <entry>
    <title>{entry title}</title>
    <link href="{entry url}" rel="alternate"/>
    <id>{entry url}</id>
    <published>{parsed publication instant, or build instant, ISO 8601}</published>
    <updated>{same instant as published, ISO 8601}</updated>
    <summary>{meta description}</summary>
    <content type="html">{article innerHTML, XML-escaped}</content>
    <author>
      <name>{entry author or feed author}</name>
    </author>
  </entry>
</feed>
```

- Content uses XML character escaping for embedded HTML.
- A date-only value such as `2026-04-01` normalizes to
  `2026-04-01T00:00:00.000Z`; a zoneless datetime is also interpreted as UTC.
- When no valid publication exists, including an empty feed, `<updated>` uses
  the exact configured build instant or the one captured at build start.
- `<updated>` reuses the published date. Future enhancement: support a separate `data-updated-at` attribute for articles that have been modified after publication.

### RSS 2.0

```xml
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>{feed title}</title>
    <link>{base url}</link>
    <description>{feed description}</description>
    <language>{html lang}</language>
    <lastBuildDate>{exact build instant, RFC 822}</lastBuildDate>
    <generator>pugneum-feed</generator>
    <atom:link href="{public URL of configured rss output name}" rel="self" type="application/rss+xml"/>

    <item>
      <title>{entry title}</title>
      <link>{entry url}</link>
      <guid isPermaLink="true">{entry url}</guid>
      <pubDate>{parsed publication instant, or build instant, RFC 822}</pubDate>
      <description>{meta description}</description>
      <content:encoded><![CDATA[{article innerHTML}]]></content:encoded>
      <dc:creator>{resolved entry/feed author; element omitted if absent}</dc:creator>
    </item>
  </channel>
</rss>
```

- Full content uses `content:encoded` with CDATA sections (standard RSS extension, universally supported).
- Includes `atom:link rel="self"` for feed autodiscovery (RSS Advisory Board best practice).
- Dates use RFC 822 output. `lastBuildDate` is the exact configured
  `feeds.buildDate`, or the single instant captured when the build starts.

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
     f. Write the configured `feeds.atom` and `feeds.rss` names to the output
        directory and advertise those same names in the feed self links
```

### Error Behavior

| Condition | Behavior |
|-----------|----------|
| `pugneum-feed` not installed, `feeds` config present | Warning, skip feed generation |
| Base URL unresolvable (no `<base>`, no `feeds.url`) | Error with guidance on what to add |
| Article page not found for a discovered link | Error identifying the missing file |
| No `data-published-at` entries found on index page | Empty feed (valid XML, zero entries) |
| RSS description missing (no `<meta name="description">`, no config) | Error with guidance |
| Feed or entry title resolves to blank text | Coded metadata error before output setup |
| Atom entry has neither an article nor feed author | Coded metadata error before output setup |
| `feeds.buildDate` is not a supported ISO-8601 instant | `FEED_INVALID_BUILD_DATE` before filesystem access |

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
5. **Config priority** — JSON config values take precedence over HTML-extracted values.
6. **Error cases** — No base URL, missing article files, no entries found, missing RSS description.

No integration with the full pugneum compilation pipeline. The feed tool reads HTML, so fixtures are just HTML files. Clean separation.

## Future Enhancements

- `data-updated-at` attribute support for articles modified after publication, populating the Atom `<updated>` and RSS `<lastBuildDate>` per-entry fields with a date distinct from publication.
- Selective feed inclusion/exclusion via a `data-pugneum-feed` boolean attribute.
