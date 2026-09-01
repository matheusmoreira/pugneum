# Pugneum

Clean HTML templates for static sites.

## Installation

    npm install pugneum

Pugneum requires Node.js 22 or newer. Contributors running this repository's
test and release tooling need Node.js 22.5 or newer and npm 10.9.9.

## Syntax

Pugneum is a clean, whitespace sensitive syntax for writing HTML.
Here is a simple example:

```pugneum
html(lang="en")
  head
    title Example
    script(type='text/javascript').
      if (foo) {
        bar(1 + 5);
      }
  body
    h1 Pugneum
    #container.centered
      p.
        Pugneum is a terse and simple templating language
        with a focus on static pure HTML web sites.
```

That code compiles to:

```html
<html lang="en">
  <head>
    <title>Example</title>
    <script type="text/javascript">
      if (foo) {
        bar(1 + 5);
      }
    </script>
  </head>
  <body>
    <h1>Pugneum</h1>
    <div class="centered" id="container">
      <p>
        Pugneum is a terse and simple templating language
        with a focus on static pure HTML web sites.
      </p>
    </div>
  </body>
</html>
```

> The HTML output blocks throughout this document are indented and wrapped for
> readability. Pugneum does not add indentation or whitespace between elements,
> but it preserves newlines that are part of authored text, raw includes, and
> filter output. The tags, attributes, escaping, and ordering shown are exact;
> presentation-only indentation and wrapping are not byte-for-byte.

Pugneum is a variant of [pug],
modified to be fully static.
All dynamic features have been removed.
Only the clean language remains.

Structural whitespace—indentation, separators, and spacing within attribute
lists—uses ASCII spaces, tabs, or physical line breaks. Non-ASCII whitespace is
preserved in authored text and quoted attribute values, but rejected at a
structural boundary with `PUGNEUM:NON_ASCII_WHITESPACE`.

## Text

### Piped text

Use `|` at the start of a line to add text content:

```pugneum
p
  | This is a paragraph
  | with two lines.
```

```html
<p>This is a paragraph
with two lines.</p>
```

### Block text

A trailing `.` after a tag makes all indented content text:

```pugneum
p.
  This entire block is text.
  No tags are parsed here.
```

```html
<p>This entire block is text.
No tags are parsed here.</p>
```

This is useful for preserving content in `script` or `style` tags:

```pugneum
script(type='text/javascript').
  if (foo) {
    bar();
  }
```

```html
<script type="text/javascript">if (foo) {
  bar();
}</script>
```

## Inline tag shorthand

Use `#(tag content)` to insert tags inline within text:

```pugneum
p This is #(strong very) important.
p Click #(a(href="/help") here) for help.
```

```html
<p>This is <strong>very</strong> important.</p>
<p>Click <a href="/help">here</a> for help.</p>
```

The first word is the tag name and the rest is its content. Attributes are
supported, as in `#(a(href="/help") click here)`, and a mixin call can be
inserted with `#(+mixin(args))`. Escape `#(` as `\#(` for literal output.

All block and inline tag names must begin with an ASCII letter. Their remaining
characters may be ASCII letters, digits, underscores, hyphens, or colons, with
a hyphen or colon only between word characters. Names such as `x-card` and
`svg:path` are valid; digit- or underscore-led names fail with
`PUGNEUM:INVALID_TAG_NAME` instead of producing markup that browsers do not
parse as the requested element.

## Comments

Buffered comments appear in the HTML output:

```pugneum
// This comment is visible.
p Hello
```

```html
<!-- This comment is visible.-->
<p>Hello</p>
```

Unbuffered comments (with `-`) are removed as opaque source; their contents are
not evaluated:

```pugneum
//- This is only in the source.
p Hello
```

```html
<p>Hello</p>
```

Block comments indent their content:

```pugneum
//
  This is a
  block comment.
```

```html
<!--This is a
block comment.-->
```

## Doctype

Use `doctype html` to emit an HTML5 doctype declaration:

```pugneum
doctype html
html
  head
    title Page
  body
    p Hello
```

```html
<!DOCTYPE html><html><head><title>Page</title></head><body><p>Hello</p></body></html>
```

Place it at the top of your root template.
Templates that extend a layout with `doctype html`
inherit the declaration automatically.

## Usage

The command line utility requires a `pugneum.json` file to work:

```json
{
    "inputDirectory": "pg/files",
    "outputDirectory": "example.com",
    "baseDirectory": "pg"
}
```

`baseDirectory` is the include/extends confinement root. The CLI defaults it
to `inputDirectory`, so both relative and `/`-prefixed template references stay
inside the input project unless an explicit broader root is configured.

The same boundary is named `basedir` in the JavaScript API and loader options.
In other words, CLI configuration `baseDirectory` is passed to the compiler as
`basedir`; `inputDirectory` and `outputDirectory` remain traversal/input and
publication roots, respectively. These spellings are retained for compatibility,
not separate security boundaries.

Committing this file to version control is recommended.

Once it exists, the pugneum templates can be compiled to HTML
with a command line tool:

```shell
pugneum
```

All configured paths are interpreted relative to the directory where the
command runs. `inputDirectory` and `outputDirectory` are required non-empty
strings. `baseDirectory` is optional; an omitted or empty value defaults to
`inputDirectory`. A `feeds` object enables feed generation unless its
`enabled` property is `false`; this requires the optional `pugneum-feed`
package.

The command recursively visits the input tree in deterministic name order and
compiles files whose names end in the case-sensitive `.pg` extension. It
mirrors their relative directories under `outputDirectory` and changes the
extension to `.html`. Nested symlink entries are skipped, as are files without
the `.pg` extension. A configured symlinked input root itself is followed. If
the output directory is inside the input tree, that output subtree is excluded
from traversal. A `.pg` entry must be a regular file; a special file such as a
FIFO is rejected without being opened. Existing regular output files are
replaced atomically; stale files for removed templates are not deleted.

`pugneum --help` (or `-h`) prints usage, and `pugneum --version` (or `-v`)
prints the installed version. Successful compilation is silent except for
warnings. Warnings and errors go to stderr; warnings collected from earlier
files are still emitted if a later file fails. When feeds are configured but
`pugneum-feed` is not installed, the CLI warns, skips feed generation, and
still succeeds.

The CLI uses these exit statuses:

| Status | Meaning |
| ---: | --- |
| `0` | Successful build, help, or version output |
| `1` | Invalid argument, configuration, or input/output boundary |
| `2` | Path not found |
| `3` | Permission denied |
| `4` | A directory was required |
| `5` | A file was required |
| `6` | Pugneum template error |
| `7` | Feed generation error |

## Link shorthand

The `@()` shorthand generates `<a>` tags inline:

```pugneum
p Visit @(https://example.com our site) for details.
p @(/contact Contact us)
```

```html
<p>Visit <a href="https://example.com">our site</a> for details.</p>
<p><a href="/contact">Contact us</a></p>
```

If no text is provided, the URL is used as literal link text: shorthand-looking
characters inside that fallback label are not parsed as markup. Supplying text
after the URL explicitly opts that label into ordinary inline parsing. The URL
must be nonempty.
Escape with `\@(` to output a literal `@(`.

## Image shorthand

The `!()` shorthand generates `<img>` tags inline:

```pugneum
p See !(/photo.jpg a lovely photo) below.
p !(/logo.png Logo)(class="logo" loading="lazy")
```

```html
<p>See <img src="/photo.jpg" alt="a lovely photo"> below.</p>
<p><img class="logo" src="/logo.png" alt="Logo" loading="lazy"></p>
```

The image source must be nonempty. If no alt text is provided, an empty
`alt=""` is used (decorative image).
Custom attributes can be appended after the shorthand in parentheses.
Escape with `\!(` to output a literal `!(`.

## Reference links

Define URLs once and reference them throughout the template:

```pugneum
references
  docs https://docs.example.com
  repo https://github.com/example/project

p Read @[docs the documentation] or browse @[repo the source].
p @[docs](class="external" target="_blank")
```

```html
<p>Read <a href="https://docs.example.com">the documentation</a>
   or browse <a href="https://github.com/example/project">the source</a>.</p>
<p><a class="external" href="https://docs.example.com" target="_blank">docs</a></p>
```

If no link text is given, the default text from the definition
is used. If no default text was defined, the reference name is
used. Define default text after the URL:

```pugneum
references
  docs https://docs.com Documentation
```

`@[docs]` renders as "Documentation". Explicit text overrides:
`@[docs click here]` renders as "click here".
References can be defined anywhere in the file, including via `include`.
Custom reference-link attributes cannot set `href`; that value always comes
from the matching reference definition. Conflicts, including case variants
such as `HREF`, are rejected as duplicate attributes.

## Reference images

Like reference links, but for images. Uses `![ref alt]` with URLs from a `references` block:

```pugneum
references
  logo /images/logo.png
  photo /images/sunset.jpg

p Our logo: ![logo Pugneum logo]
p ![photo sunset](loading="lazy" class="hero")
```

```html
<p>Our logo: <img src="/images/logo.png" alt="Pugneum logo"></p>
<p><img class="hero" src="/images/sunset.jpg" alt="sunset" loading="lazy"></p>
```

If no alt text is given, the default text from the definition
is used. If no default text was defined, an empty `alt=""`
is used (decorative image).
Custom attributes can be appended after the shorthand in parentheses.
They cannot set `src` or `alt`, which are owned by reference resolution;
case variants such as `SRC` and `ALT` are rejected as duplicate attributes.
Escape with `\![` to output a literal `![`.

## Strong shorthand

The `*()` shorthand generates `<strong>` tags inline:

```pugneum
p This is *(important) information.
p Nested: *(click @(/url here) now)
```

```html
<p>This is <strong>important</strong> information.</p>
<p>Nested: <strong>click <a href="/url">here</a> now</strong></p>
```

Balanced parentheses in content are handled by depth tracking.
Escape with `\*(` to output a literal `*(`.

## Emphasis shorthand

The `_()` shorthand generates `<em>` tags inline:

```pugneum
p Please use _(caution) here.
p Combined: *(really _(very) important)
```

```html
<p>Please use <em>caution</em> here.</p>
<p>Combined: <strong>really <em>very</em> important</strong></p>
```

Escape with `\_(` to output a literal `_(`.

## Code shorthand

The `` `() `` shorthand generates `<code>` tags inline.
Content is literal — no inner shorthand processing:

```pugneum
p Use `(git status) to check.
p Call `(printf("hello")) carefully.
```

```html
<p>Use <code>git status</code> to check.</p>
<p>Call <code>printf("hello")</code> carefully.</p>
```

Balanced parentheses in code work via depth tracking.
Escape with `` \`( `` to output a literal `` `( ``.

## Del shorthand

The `~()` shorthand generates `<del>` tags for deleted/struck text:

```pugneum
p This feature is ~(deprecated).
```

```html
<p>This feature is <del>deprecated</del>.</p>
```

Escape with `\~(` to output a literal `~(`.

## Ins shorthand

The `&()` shorthand generates `<ins>` tags for inserted text,
complementing `~()` for deletions:

```pugneum
p Returns ~(NULL) &(nullptr) now.
```

```html
<p>Returns <del>NULL</del> <ins>nullptr</ins> now.</p>
```

Escape with `\&(` to output a literal `&(`.

## Abbr shorthand

The `?()` shorthand generates `<abbr>` tags with title expansion:

```pugneum
p The ?(HTML Hypertext Markup Language) standard.
p Uses ?(CSS) for styling.
```

```html
<p>The <abbr title="Hypertext Markup Language">HTML</abbr> standard.</p>
<p>Uses <abbr>CSS</abbr> for styling.</p>
```

First word is the visible abbreviation, rest is the title.
Without expansion text, generates `<abbr>` with no title.
Escape with `\?(` to output a literal `?(`.

## Sup and sub shorthands

`^()` generates `<sup>`, `,()` generates `<sub>`:

```pugneum
p Footnote^(1) and x^(2) + H,(2)O.
```

```html
<p>Footnote<sup>1</sup> and x<sup>2</sup> + H<sub>2</sub>O.</p>
```

Escape with `\^(`, `\,(` to output literal `^(`, `,(`.

## Kbd shorthand

The `%()` shorthand generates `<kbd>` tags for keyboard input:

```pugneum
p Press %(Ctrl+C) to copy.
```

```html
<p>Press <kbd>Ctrl+C</kbd> to copy.</p>
```

Escape with `\%(` to output a literal `%(`.

## Footnotes

Define footnotes in a `footnotes` block and reference them
with `^[name]`. Footnotes are numbered by order of first
appearance and generate bidirectional anchors with DPUB-ARIA
accessibility roles:

```pugneum
p The tricolor algorithm^[gc] is fundamental.

footnotes
  gc Introduced by Dijkstra in 1978.
```

```html
<p>The tricolor algorithm<sup><a href="#footnote-gc"
  id="footnote-reference-gc" role="doc-noteref">[1]</a></sup>
  is fundamental.</p>
<section role="doc-endnotes">
  <ol>
    <li id="footnote-gc" role="doc-endnote">
      Introduced by Dijkstra in 1978.
      <a href="#footnote-reference-gc" role="doc-backlink">↩</a>
    </li>
  </ol>
</section>
```

Multi-line definitions use indented content:

```pugneum
references
  mccarthy https://example.com/mccarthy McCarthy's paper

p Details^[gc-tricolor] and history^[gc-history].

footnotes
  gc-tricolor Short note.
  gc-history
    McCarthy's original Lisp used mark-and-sweep.
    See @[mccarthy] for the original paper.
```

Repeated references show the same number with multiple
back-links. Footnote content supports all inline shorthands. A footnote name is
one or more ASCII letters, digits, hyphens, or underscores; definitions and
references use exactly the same grammar, without surrounding or internal
whitespace.

## Table filter

The `:table` filter parses pipe-delimited table syntax and
generates full HTML tables with support for alignment,
attributes, captions, colgroups, and structural sections:

```pugneum
:table(class="data")
  caption System calls
  | Name  | Count | Description     |
  | :---  | ----: | :---:           |
  | read  |   100 | Read from fd    |
  | write |    50 | Write to fd     |
```

Install it with `npm install pugneum-filter-table`. See the table filter package
for full syntax documentation.

## Table of contents

The `toc` keyword generates a table of contents from headings
that have explicit `id` attributes. Headings without IDs are
excluded — you opt in per heading:

```pugneum
h1 My Article

toc

h2#background Background
p Some text.
h3#prior-work Prior work
p More text.
h2#design Design
```

```html
<nav role="doc-toc" aria-label="Table of contents">
  <ol>
    <li><a href="#background">Background</a>
      <ol>
        <li><a href="#prior-work">Prior work</a></li>
      </ol>
    </li>
    <li><a href="#design">Design</a></li>
  </ol>
</nav>
```

The ToC appears where the `toc` keyword is placed. A heading is included when
it has an explicit, usable string `id`, whether written with `#id` shorthand or
an `id="..."` attribute. Empty IDs and IDs made only of ASCII whitespace are
excluded.

## Template inheritance

Templates can extend a layout and override named blocks.

A layout defines replaceable regions with `block`:

```pugneum
//- layout.pg
doctype html
html
  head
    block title
      title Default Title
  body
    block content
```

A page extends it and fills the blocks:

```pugneum
extends layout.pg

block title
  title My Page

block content
  h1 Hello
  p Welcome.
```

Compiling `page.pg` produces:

```html
<!DOCTYPE html>
<html>
  <head>
    <title>My Page</title>
  </head>
  <body>
    <h1>Hello</h1>
    <p>Welcome.</p>
  </body>
</html>
```

Blocks can be appended or prepended instead of replaced:

```pugneum
extends layout.pg

block append title
  meta(name="description" content="My page")

block content
  p Hello
```

`extends` must be the first statement in the file.
Blocks not overridden keep their default content.

## Includes

Insert the contents of another file with `include`:

```pugneum
html
  head
    include partials/head.pg
  body
    h1 My Page
```

Included `.pg` files are parsed as pugneum.
Non-`.pg` files are included as raw text.
Textual raw includes normalize LF, CRLF, and CR line endings to LF before
insertion or non-binary filtering; binary include filters receive exact bytes.

An included Pugneum template can use `yield` to choose where a block supplied
by the caller is inserted:

```pugneum
//- wrapper.pg
article
  yield
```

```pugneum
include wrapper.pg
  p Included content.
```

Supplying a block to a template with no `yield` is an error. If the included
template has several `yield` sites, each receives an independent copy of the
caller block.

Include with a filter to transform the content:

```pugneum
head
  style
    include:verbatim styles.css
```

Include filters may have only `text` or `html` output types and must return a
string. Chained include filters such as `include:outer:inner file.txt` run from
right to left. If the innermost descriptor declares `binary: true`, it receives
the exact file `Buffer`; every outer filter receives the preceding string
result. Ordinary block filters additionally support `pugneum` and `syntax`
output types.

Paths starting with `/` are resolved from `basedir`.
Relative paths resolve from the including file's directory and, when
`basedir` is set, must remain inside it. The CLI always supplies that boundary.
Programmatic `render`/`renderFile` calls should set `basedir` explicitly when
templates are not fully trusted: without it, relative paths are unconfined and
may traverse above the entry file's directory.

Include from npm packages with `@`:

```pugneum
include @pugneum-mixins/quote.pg

+quote(https://example.com/quotation)
  | To be or not to be.
  block caption
    +citation
      block attribution
        | Example Author
      block title
        | Example Work
```

Install the package first: `npm install pugneum-mixins`.
The spelling `@pkg/file.pg` addresses an unscoped package; use a doubled prefix
for a scoped package, as in `@@scope/pkg/file.pg` for `@scope/pkg`.
Lookup begins in the including project's `node_modules`. If the package has an
`exports` map, the requested `.pg` subpath must be exported; the package
manifest itself does not need to be exported. The resolved target is contained
to the package root.

## Filters

Filters transform blocks of text within templates.
Apply a filter with `:filtername`:

```pugneum
:highlight.js(language=javascript)
  function hello() {
    console.log('Hello!');
  }
```

Only `:verbatim` is bundled with Pugneum. The other filters in this table are
optional packages:

| Filter | Availability | Description |
|---|---|---|
| `:highlight.js` | `pugneum-filter-highlight.js` | Syntax highlighting via highlight.js |
| `:prismjs` | `pugneum-filter-prismjs` | Syntax highlighting via Prism |
| `:table` | `pugneum-filter-table` | Pipe-delimited table syntax |
| `:verbatim` | bundled | Pass-through, no transformation |

Install the optional filter packages you use, for example:

```shell
npm install pugneum-filter-highlight.js pugneum-filter-prismjs pugneum-filter-table
```

Custom filters can be registered via the `filters` option
in the programming interface.

## Mixins

Mixins define reusable template fragments with parameters:

```pugneum
mixin button(url text)
  a(href="#{url}" class="btn") #{text}

+button(/home Home)
+button(/about About)
```

```html
<a class="btn" href="/home">Home</a>
<a class="btn" href="/about">About</a>
```

Inside a mixin, variables can be used in both text content and
attribute values with the `#{name}` syntax; the names refer to the
mixin's arguments. Outside a mixin there is no variable scope, so
`#{name}` is an error. Escape with `\#{` for literal output.

Each invocation has only its own parameter bindings: a callee does not
implicitly capture variables from its caller. Forward a value explicitly by
using `#{name}` in a nested call argument:

```pugneum
mixin label(text)
  strong #{text}

mixin button(text)
  button
    +label(#{text})

+button(Save)
```

Call-argument substitution is single-pass. Escape the marker as `\#{name}`
when a nested call should receive the literal text `#{name}`.

Mixins can be called inline within text using `#(+mixin(args))`:

```pugneum
mixin icon(name)
  span(class="icon icon-#{name}" aria-hidden="true")

mixin b(text)
  strong #{text}

p Click the #(+icon(settings)) button to open preferences.
p I am #(+b(very)) #(+b(happy)) today.
```

Mixin call arguments are separated by ASCII spaces, tabs, or newlines.
Balanced parentheses can be nested inside an unquoted argument that contains
no separator whitespace, for example `+transform(calc(1+2))`. Quote an
argument to preserve whitespace; the outer quotes are removed and a backslash
escapes the next quoted character, as in `+label('Status (ready)')`.

Declarations take effect in source order. A declaration evaluated inside a
mixin invocation may shadow an outer declaration, but that local binding ends
when the invocation returns. Unused-mixin warnings are tracked per declaration,
including same-name redefinitions.

Mixins can also receive block content from the caller:

```pugneum
mixin card(title)
  .card
    h2 #{title}
    .card-body
      block

+card(Welcome)
  p This is the card body content.
```

```html
<div class="card">
  <h2>Welcome</h2>
  <div class="card-body">
    <p>This is the card body content.</p>
  </div>
</div>
```

### Named blocks

When a mixin needs multiple content areas,
named blocks provide multiple slots
that callers fill independently:

```pugneum
mixin quotation
  figure
    blockquote
      block quote
    figcaption
      block attribution
        | Anonymous
      | ,&#32;
      cite
        block title
          | Untitled

+quotation
  block quote
    p To be or not to be.
  block attribution
    | William Shakespeare
  block title
    | Hamlet
```

```html
<figure>
  <blockquote>
    <p>To be or not to be.</p>
  </blockquote>
  <figcaption>
    William Shakespeare, <cite>Hamlet</cite>
  </figcaption>
</figure>
```

Each slot can have default content.
Omitted slots use their defaults; the `attribution` and `title` slots above
default to "Anonymous" and "Untitled".

A mixin may use both an unnamed `block` and named blocks.
Caller content not inside a named block fills the unnamed slot.

At the call site, `block name` replaces the slot's default content.
`append name` adds after it and `prepend name` adds before it,
mirroring template inheritance:

```pugneum
mixin nav
  nav
    block links
      a(href="/") Home

+nav
  append links
    a(href="/about") About
```

```html
<nav><a href="/">Home</a><a href="/about">About</a></nav>
```

### Conditional rendering with `given`

`given name` renders its subtree only if the caller provides a block with that
name. Presence is what matters: an explicitly provided but empty `block name`
still counts. This enables wrapper elements that disappear when a slot is
omitted:

```pugneum
mixin quote(source?)
  figure
    blockquote(cite="#{source?}")
      block
    given caption
      figcaption
        block caption

+quote(https://example.com/quotation)
  | Quoted text.
  block caption
    | Example Author,&#32;
    cite
      a(href='https://example.com/work') Example Work

+quote
  | No attribution needed.
```

```html
<figure><blockquote cite="https://example.com/quotation">Quoted text.</blockquote><figcaption>Example Author, <cite><a href="https://example.com/work">Example Work</a></cite></figcaption></figure>
<figure><blockquote>No attribution needed.</blockquote></figure>
```

The second quote has no `<figcaption>` — `given caption` suppressed
the entire subtree because the caller didn't provide `block caption`.

Use `\given` to create an HTML element named `given`.

## Feeds

Generate Atom and RSS feeds from compiled HTML.
Install the optional feed package:

    npm install pugneum-feed

Add a `feeds` key to `pugneum.json`:

```json
{
  "inputDirectory": "pg",
  "outputDirectory": "site",
  "feeds": {
    "url": "https://example.com"
  }
}
```

The feed generator reads compiled HTML to extract article metadata.
Articles are discovered from elements with `data-published-at`
attributes on the index page. Feed title, author, and description
are extracted from standard HTML meta elements.

See the `pugneum-feed` package for full configuration.

## Escaping

In ordinary or pipeless Pugneum text, prefix a shorthand sigil with `\` to
output it literally:

| Escape | Output |
|---|---|
| `\@(` | `@(` |
| `\!(` | `!(` |
| `\*(` | `*(` |
| `\_(` | `_(` |
| `` \`( `` | `` `( `` |
| `\~(` | `~(` |
| `\&(` | `&(` |
| `\^(` | `^(` |
| `\%(` | `%(` |
| `\,(` | `,(` |
| `\?(` | `?(` |
| `\@[` | `@[` |
| `\![` | `![` |
| `\^[` | `^[` |
| `\#{` | `#{` |
| `\#(` | `#(` |

The `\#{` escape is also recognized in attribute values and literal code
shorthand. In those contexts it suppresses variable interpolation and outputs
`#{` without the backslash.

Filter bodies are literal input to the selected filter, rather than Pugneum
text. The lexer passes `\#{` through unchanged there; any further handling is
defined by that filter.

Tag names that collide with keywords can be escaped:
`\extends` produces a literal `<extends>` tag.

## Programming interface

```js
const pg = require('pugneum');

const html = pg.render('h1 Hello, world!');
const fileHtml = pg.renderFile('page.pg');
```

`render(source, options)` and `renderFile(filename, options)` synchronously
return an HTML string. `renderFile` reads the entry file as UTF-8 and supplies
its absolute filename to the compiler. Compiler failures use coded Pugneum
errors, invalid public argument types use `TypeError`, and an entry-file read
retains its Node.js filesystem error.

### Options

| Option | Default | Description |
| --- | --- | --- |
| `filename` | | Entry source path, used for diagnostics and required by the default resolver for relative includes and extends; `renderFile` sets it automatically |
| `basedir` | | Confinement root for absolute and relative filesystem includes/extends; required for absolute paths and strongly recommended for programmatic builds |
| `filters` | | Object mapping filter names to filter objects `{type, filter}`, where `type` is one of `text`/`html`/`pugneum`/`syntax` and `filter(input, attrs)` returns the transformed output |
| `filterOptions` | | Per-filter options object, keyed by filter name |
| `resolve` | Default filesystem/package resolver | Synchronous hook `(requestedPath, includingFilename, options) => resolvedPath` for dependency resolution |
| `read` | `fs.readFileSync` | Synchronous hook `(resolvedPath, options) => Buffer \| Uint8Array \| string` for dependency reads |
| `canonicalize` | Real path or resolved virtual name | Hook `(resolvedPath, options) => identity` that gives aliases a stable identity for cycle detection |
| `dependencyCache` | | A `Map` scoped to one immutable multi-render build; reuses canonical dependency bytes and pre-load parsed ASTs while cloning each attachment. Reuse only with stable hooks, parser options, and inputs |
| `maxLoadDepth` | `256` | Maximum include/extends dependency depth; an integer from `0` through `256` |
| `maxLinkDepth` | `256` | Maximum linker composition depth; an integer from `0` through `256` |
| `warnings` | Automatic stderr emission | Mutable array to collect non-fatal diagnostics. If supplied, the caller owns emission and Pugneum does not write warnings to stderr |

Relative filesystem dependencies first resolve from the including file and,
when `basedir` is set, must remain within that root. Without `basedir`, relative
paths are unconfined and may traverse above the entry directory, so that mode is
appropriate only for trusted templates. Absolute dependencies require
`basedir`. Installed `@`-prefixed library includes use package resolution and do
not require an entry filename; their targets are confined to the package root.

### Diagnostics

Template and compiler failures are thrown with a `PUGNEUM:`-prefixed `code` and
a formatted `message`. When source information is available, diagnostics also
expose `filename`, `line`, `column`, the plain `msg`, and `source`; `toJSON()`
returns their serializable fields. Public boundary violations instead use
`TypeError`, and direct entry-file I/O retains standard Node.js error codes.

When `warnings` is omitted, `render` and `renderFile` collect warnings, remove
duplicates, and print them to stderr automatically. They also print warnings
collected before a later hard failure. Supplying a mutable array transfers
ownership to the caller and keeps the library silent:

```js
const pg = require('pugneum');
const warnings = [];

const html = pg.render('a(href=‘/docs’) Docs', {
  filename: 'page.pg',
  warnings,
});

pg.emitWarnings(warnings);
```

`emitWarnings(warnings)` is the stable formatter used by the CLI. It validates
the complete array before writing anything, deduplicates records by `code`,
`filename`, `line`, `column`, and formatted `message`, and writes each distinct
warning to stderr. It removes a leading `PUGNEUM:` from the displayed header,
but does not mutate the records. A record requires non-empty string `code` and
string `message` fields; `filename`, `line`, and `column` are optional.

For a multi-page build, `createWarningCollector()` returns a mutable array that
keeps only the first occurrence of each warning identity as records are pushed.
It can be passed as `warnings` and later to `emitWarnings`, avoiding retention
of duplicate formatted diagnostics while preserving first-seen order.

Compiler warnings currently use these codes:

| Code | Meaning |
| --- | --- |
| `PUGNEUM:TYPOGRAPHIC_QUOTE_DELIMITER` | A typographic quote was used literally where an ASCII attribute quote was likely intended |
| `PUGNEUM:DUPLICATE_ID` | The final document contains the same string ID more than once |
| `PUGNEUM:IMG_WITHOUT_ALT` | An `img` element has no `alt` attribute |
| `PUGNEUM:UNUSED_REFERENCE` | A reference definition is not used |
| `PUGNEUM:UNUSED_FOOTNOTE` | A footnote definition is not referenced |
| `PUGNEUM:EMPTY_TOC` | A `toc` has no eligible headings |
| `PUGNEUM:UNUSED_MIXIN` | An entry-file mixin is never called |

## License

MIT

[pug]: https://pugjs.org
