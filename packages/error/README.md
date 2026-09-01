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
- `message` is the unformatted, human-readable explanation. It is converted to
  a string once; an omitted message becomes the empty string, and a value whose
  string conversion throws becomes `[unprintable diagnostic message]`.
- `options` is optional (and may be `null`). It can contain `filename`, `line`,
  `column`, and `source`. Each option is read once. `filename` must be a
  non-empty string, and `source` must be a string. An empty string is retained
  as the source value but means that source context is unavailable.
- `line` and `column` are normalized to one-based safe integers. Numbers,
  numeric strings, and safely representable BigInts are accepted; malformed,
  fractional, non-positive, non-finite, and unsafe values become `undefined`.
  A column is unavailable when its line is unavailable.

The returned error has these public fields:

- `code`: the prefixed code, such as `PUGNEUM:MY_CODE`;
- `severity`: `error`;
- `msg`: the normalized, unformatted message string;
- `message`: the standard `Error` message, formatted with any available
  filename, location, and source excerpt;
- `line`, `column`, and `filename`: the normalized location values;
- `source`: the normalized raw source string as a non-enumerable property;
- `toJSON()`: the versioned serialization described below.

The normalized, unformatted explanation is stored in `err.msg` because
`err.message` contains the formatted diagnostic intended for display.

Formatted diagnostics use one line model for LF, CRLF, and CR source. Tabs are
expanded to eight-column stops, wide and combining Unicode characters use
terminal display-cell widths, and the line-number gutter remains aligned across
decimal boundaries. Terminal controls in filenames, source excerpts, and
messages are rendered as visible escapes. Source lines are shown through a
bounded 120-cell excerpt; displayed filenames and messages are likewise bounded
and use `…` to mark truncation. The full normalized `msg`, `filename`, and
`source` fields remain available to programmatic consumers.

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
throws nor logs it. Its `severity` is `warning`. Callers decide how to collect
or report warnings.

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
without interrupting the build. The live and serialized `severity` fields
preserve whether a value came from `error()` or `error.warning()`.

### `error.clearSourceCache()`

Clears the bounded internal source-line index used to format repeated
diagnostics efficiently. Long-lived compilers should call this after a
synchronous compilation finishes so completed work does not retain source text.
Clearing changes only formatter performance; existing diagnostic values and
future formatted output are unchanged. The `pugneum` facade does this after
every successful or failed render.

## Serialization

Both diagnostic shapes implement a versioned `toJSON()` record. The current
schema is `schemaVersion: 1`, also exported as
`error.DIAGNOSTIC_JSON_VERSION`. Its stable shape is:

```js
{
  schemaVersion: 1,
  code: diagnostic.code,
  severity: diagnostic.severity, // "error" or "warning"
  message: diagnostic.msg, // short, unformatted explanation
  displayMessage: diagnostic.message, // formatted display text
  location: {
    filename: diagnostic.filename,
    line: diagnostic.line,
    column: diagnostic.column,
  },
}
```

`JSON.stringify()` uses that method and, following normal JSON behavior, omits
location members whose values are `undefined`. Accepted BigInt coordinates have
already been normalized to JSON-safe numbers. Default JSON omits the raw
`source` and an error `stack`; the bounded, terminal-safe formatted text is
already present as `displayMessage`.

The live diagnostic still exposes its original `source`, but that property is
non-enumerable. Object spread and default object inspection therefore do not
copy or print the full input document accidentally. A trusted caller that
deliberately needs raw source can opt in explicitly:

```js
var recordWithSource = diagnostic.toJSON({includeSource: true});
```

Do not use the source-bearing form for untrusted telemetry or remote logs: it
can contain the complete authored document, not merely the bounded excerpt in
`displayMessage`. `JSON.stringify(diagnostic)` always uses the safe default;
JavaScript's property-key argument to `toJSON` never enables source export.

## License

MIT
