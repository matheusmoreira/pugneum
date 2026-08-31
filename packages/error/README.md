# pugneum-error

Shared error and warning diagnostic factories used by Pugneum's lexer, parser,
loader, linker, renderer, and plugins.

## Installation

```sh
npm install pugneum-error
```

## Usage

```js
var pugneumError = require('pugneum-error');
```

### `error(code, message, options)`

Creates an `Error` instance with a Pugneum diagnostic code and optional source
location.

- `code` is a required code without the `PUGNEUM:` prefix. The returned
  diagnostic adds the prefix.
- `message` is the unformatted, human-readable explanation.
- `options` is optional (and may be `null`). It can contain `filename`, `line`,
  `column`, and `source`. A string `source` enables the formatted source excerpt
  and caret.

The returned error has these public fields:

- `code`: the prefixed code, such as `PUGNEUM:MY_CODE`;
- `msg`: the original unformatted `message` argument;
- `message`: the standard `Error` message, formatted with any available
  filename, location, and source excerpt;
- `line`, `column`, `filename`, and `source`: the values supplied in `options`;
- `toJSON()`: the restricted serialization described below.

The raw explanation is stored in `err.msg` because `err.message` contains the
formatted diagnostic intended for display.

```js
var pugneumError = require('pugneum-error');

var err = pugneumError('MY_CODE', 'My message', {
  line: 3,
  column: 2,
  filename: 'myfile.pg',
  source: 'foo\nbar\nbaz',
});

console.error(err.code); // PUGNEUM:MY_CODE
throw err;
```

### `error.warning(code, message, options)`

Creates a nonthrowing diagnostic with the same code, location, source,
formatted `message`, and `toJSON()` contract as `error()`. The result is a plain
object, not an `Error` instance: it has no `Error` stack and the factory neither
throws nor logs it. Callers decide how to collect or report warnings.

```js
var pugneumError = require('pugneum-error');
var warnings = [];

warnings.push(
  pugneumError.warning('DEPRECATED_SYNTAX', 'Use the new syntax', {
    filename: 'page.pg',
    line: 4,
    column: 7,
  }),
);
```

Keeping warnings as plain values lets a compiler collect several diagnostics
without interrupting the build. Preserve whether a value came from `error()`
or `error.warning()` if that distinction matters to the consumer; serialization
does not add a severity field.

## Serialization

Both diagnostic shapes implement `toJSON()`. Calling it returns exactly these
five keys:

```js
{
  code: diagnostic.code,
  msg: diagnostic.msg,
  line: diagnostic.line,
  column: diagnostic.column,
  filename: diagnostic.filename,
}
```

`JSON.stringify()` uses that method and, following normal JSON behavior, omits
members whose values are `undefined`. The serialized form deliberately omits
`source`, the formatted `message`, an error `stack`, and the error-versus-warning
distinction. It therefore cannot reproduce the display message byte for byte;
consumers that need the source excerpt or diagnostic kind must retain them
separately.

This restriction applies only to `toJSON()` and JSON serialization. The live
error and warning objects still expose the original `source` field.

## License

MIT
