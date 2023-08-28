# Pugneum

Clean HTML templating language geared for static sites.

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

```js
const pg = require('pugneum');

let html = pg.render('h1 Hello, world!');
let html = pg.renderFile('page.pg');
```

## License

MIT

[pug]: https://pugjs.org
