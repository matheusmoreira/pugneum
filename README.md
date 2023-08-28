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

## API

For full API, see [pugjs.org/api/reference.html](https://pugjs.org/api/reference.html)

```js
var pug = require('pug');

// compile
var fn = pug.compile('string of pug', options);
var html = fn(locals);

// render
var html = pug.render('string of pug', merge(options, locals));

// renderFile
var html = pug.renderFile('filename.pug', merge(options, locals));
```

### Options

 - `filename`  Used in exceptions, and required when using includes
 - `compileDebug`  When `false` no debug instrumentation is compiled
 - `pretty`    Add pretty-indentation whitespace to output _(`false` by default)_

## License

MIT

[pug]: https://pugjs.org
