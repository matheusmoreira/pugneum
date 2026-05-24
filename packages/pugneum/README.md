# Pugneum

Clean HTML templates for static sites.

## Installation

    npm install pugneum

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
    <div id="container" class="centered">
      <p>
        Pugneum is a terse and simple templating language
        with a focus on static pure HTML web sites.
      </p>
    </div>
  </body>
</html>
```

Pugneum is a variant of [pug],
modified to be fully static.
All dynamic features have been removed.
Only the clean language remains.

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

## Tag interpolation

Use `#(tag content)` to insert tags inline within text:

```pugneum
p This is #(strong very) important.
p Click #(a(href="/help") here) for help.
```

```html
<p>This is <strong>very</strong> important.</p>
<p>Click <a href="/help">here</a> for help.</p>
```

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

Unbuffered comments (with `-`) are removed:

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

## Usage

The command line utility requires a `pugneum.json` file to work:

```json
{
    "inputDirectory": "pg/files",
    "outputDirectory": "example.com",
    "baseDirectory": "pg"
}
```

Committing this file to version control is recommended.

Once it exists, the pugneum templates can be compiled to HTML
with a command line tool:

```shell
pugneum
```

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

If no text is provided, the URL is used as the link text.
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

If no alt text is provided, an empty `alt=""` is used (decorative image).
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
footnotes
  gc-tricolor Short note.
  gc-history
    McCarthy's original Lisp used mark-and-sweep.
    See @[mccarthy] for the original paper.
```

Repeated references show the same number with multiple
back-links. Footnote content supports all inline shorthands.

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

See the table filter package for full syntax documentation.

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

The ToC appears where the `toc` keyword is placed.
Only headings with `#id` are included — you control
exactly which sections appear.

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
//- page.pg
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

append title
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

Include with a filter to transform the content:

```pugneum
head
  style
    include:verbatim styles.css
```

Paths starting with `/` are resolved from `basedir`.
Relative paths resolve from the including file's directory.

## Filters

Filters transform blocks of text within templates.
Apply a filter with `:filtername`:

```pugneum
:highlight.js(language=javascript)
  function hello() {
    console.log('Hello!');
  }
```

Built-in filters:

| Filter | Package | Description |
|---|---|---|
| `:highlight.js` | `pugneum-filter-highlight.js` | Syntax highlighting via highlight.js |
| `:prismjs` | `pugneum-filter-prismjs` | Syntax highlighting via Prism |
| `:table` | `pugneum-filter-table` | Pipe-delimited table syntax |
| `:verbatim` | built-in | Pass-through, no transformation |

Install filter packages separately:
`npm install pugneum-filter-highlight.js`

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
<a href="/home" class="btn">Home</a>
<a href="/about" class="btn">About</a>
```

Variables can be used in both text content and attribute values
with the `#{name}` syntax. Escape with `\#{` for literal output.

Mixins can be called inline within text using `#(+mixin(args))`:

```pugneum
p Click the #(+icon(settings)) button to open preferences.
p I am #(+b(very)) #(+b(happy)) today.
```

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
mixin citation
  figure
    blockquote
      block quote
    figcaption
      cite
        block source
          | Anonymous

+citation
  block quote
    p To be or not to be.
  block source
    | Shakespeare,
    |  
    time(datetime="1600") circa 1600
```

```html
<figure>
  <blockquote>
    <p>To be or not to be.</p>
  </blockquote>
  <figcaption>
    <cite>Shakespeare, <time datetime="1600">circa 1600</time></cite>
  </figcaption>
</figure>
```

Each slot can have default content.
Omitted slots use their defaults;
the `source` slot above defaults to "Anonymous".

A mixin uses either one unnamed `block`
or named blocks, never both.

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

## Programming interface

```js
const pg = require('pugneum');

let html = pg.render('h1 Hello, world!');
let html = pg.renderFile('page.pg');
```

### Options

| Option | Default | Description |
| --- | --- | --- |
| `filename` | | Path to source file, required for includes and extends |
| `basedir` | | Base directory for absolute include/extends paths |
| `filters` | | Object mapping filter names to filter functions |

## License

MIT

[pug]: https://pugjs.org
