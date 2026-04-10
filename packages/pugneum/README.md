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
<!DOCTYPE html>
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

If no alt text is provided, the URL is used as alt text.
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

If no link text is given, the reference name is used.
References can be defined anywhere in the file, including via `include`.

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
| `doctype` | `true` | Set to `false` to omit the `<!DOCTYPE html>` declaration |
| `filters` | | Object mapping filter names to filter functions |

Render a fragment without the doctype:

```js
let fragment = pg.render('p Hello', {doctype: false});
// => '<p>Hello</p>'
```

## License

MIT

[pug]: https://pugjs.org
