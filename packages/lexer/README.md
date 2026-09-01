# pugneum-lexer

This module is responsible for transforming a pugneum string into an array of tokens.

## Installation

    npm install pugneum-lexer

## Usage

```js
var lex = require('pugneum-lexer');
```

### `lex(str, options)`

Convert pugneum string to array of tokens.

`str` must be a string. `options` may be omitted or `null`; any supplied value
must otherwise be a non-array object. Invalid public arguments fail before
lexing with a stable argument error.

`options` can contain the following properties:

 - `filename` (string): name of the pugneum file; used in error reporting.
 - `warnings` (array): optional shared sink for non-fatal diagnostics. The lexer
   pushes warning objects (as produced by `pugneum-error`'s `warning()`) into this
   array — for example when a typographic "smart" quote is used where a straight
   attribute delimiter was expected. The same array is threaded through included
   files and nested inline content so all warnings are collected in one place. If
   omitted, warnings are still collected internally but discarded.

```js
console.log(JSON.stringify(lex('div(data-foo="bar")\n  p Hello', {filename: 'my-file.pg'}), null, 2))
```

```json
[
  {
    "type": "tag",
    "loc": {
      "start": { "line": 1, "column": 1 },
      "filename": "my-file.pg",
      "end": { "line": 1, "column": 4 }
    },
    "val": "div"
  },
  {
    "type": "start-attributes",
    "loc": {
      "start": { "line": 1, "column": 4 },
      "filename": "my-file.pg",
      "end": { "line": 1, "column": 5 }
    }
  },
  {
    "type": "attribute",
    "loc": {
      "start": { "line": 1, "column": 5 },
      "filename": "my-file.pg",
      "end": { "line": 1, "column": 19 }
    },
    "name": "data-foo",
    "val": "bar"
  },
  {
    "type": "end-attributes",
    "loc": {
      "start": { "line": 1, "column": 19 },
      "filename": "my-file.pg",
      "end": { "line": 1, "column": 20 }
    }
  },
  {
    "type": "indent",
    "loc": {
      "start": { "line": 2, "column": 1 },
      "filename": "my-file.pg",
      "end": { "line": 2, "column": 3 }
    },
    "val": 2
  },
  {
    "type": "tag",
    "loc": {
      "start": { "line": 2, "column": 3 },
      "filename": "my-file.pg",
      "end": { "line": 2, "column": 4 }
    },
    "val": "p"
  },
  {
    "type": "text",
    "loc": {
      "start": { "line": 2, "column": 5 },
      "filename": "my-file.pg",
      "end": { "line": 2, "column": 10 }
    },
    "val": "Hello"
  },
  {
    "type": "outdent",
    "loc": {
      "start": { "line": 2, "column": 10 },
      "filename": "my-file.pg",
      "end": { "line": 2, "column": 10 }
    }
  },
  {
    "type": "eos",
    "loc": {
      "start": { "line": 2, "column": 10 },
      "filename": "my-file.pg",
      "end": { "line": 2, "column": 10 }
    }
  }
]
```

### Token stream contract (v1)

`lex()` returns a flat array of tokens. Every token has a string `type` and a
`loc` object containing `start`, `end`, and the supplied `filename` (or
`undefined` when none was supplied). Token-specific fields such as `val`,
`name`, or `args` are added where applicable. Lines and columns are one-based,
and `loc.end` is end-exclusive. Locations always refer to the normalized
physical input, remain in source order, and stay within physical source bounds.

A successful stream has these balance and termination guarantees:

- `indent` and `outdent` tokens balance without an underflow.
- `start-attributes`, `start-pipeless-text`, `start-interpolation`,
  `start-ref-link`, `start-ref-image`, `start-footnote-ref`, and
  `start-footnote-def` are properly nested with their corresponding `end-*`
  tokens.
- Exactly one zero-width `eos` token terminates the array. Empty input therefore
  returns an array containing only `eos`.

Inline constructs at the start/end of a text span or immediately beside another
construct do not create zero-length padding tokens. A zero-length text token is
reserved for an explicitly authored empty text line, where it preserves the
line boundary for downstream consumers.

Inline constructs are scanned by nested lexers internally, but their tokens are
flattened into the one returned array between the applicable boundary tokens;
no child `eos` token is exposed. The total template nesting budget is 256. Since
every inline chain belongs to a containing expression, up to 255 nested inline
elements are accepted; adding a 256th throws `PUGNEUM:NESTING_TOO_DEEP` instead
of returning a stream that would exceed the parser's budget.

Inline shorthand is lowered to ordinary tag and attribute tokens. Structure
that has no literal spelling in the input uses a zero-width location at the
corresponding shorthand payload boundary, while authored payload text keeps its
physical span across escapes and multiline folding. Consumers must therefore
use `loc`, rather than the length of a transformed token value, for source
mapping. The final `eos` token is also zero-width.

Every `tag` token value begins with an ASCII letter. Later characters may be
ASCII letters, digits, underscores, hyphens, or colons, with a hyphen or colon
only between word characters. The same rule applies inside `#(...)` and after
the keyword-escape backslash. A digit- or underscore-led candidate throws the
located `PUGNEUM:INVALID_TAG_NAME` diagnostic.

### Generated-source grammar helpers

Packages that generate Pugneum source can use two lexer-owned predicates rather
than maintaining parallel grammar fragments:

- `lex.isValidAttributeName(name)` reports whether `name` is one complete HTML
  attribute-name token accepted by the lexer.
- `lex.scanExpressionGroup(source, start)` scans a `(` at the zero-based
  `start` offset with the lexer's attribute/expression rules. It returns the
  offset just past the matching `)`, or `-1` when the offset is not an opener or
  the group is incomplete. Parentheses nest, quotes protect parentheses, and a
  backslash escapes the next byte only inside a quoted value.
- `lex.hasLiveInterpolation(source)` reports whether generated source contains
  a live `#{` opener. An even-length run of preceding backslashes leaves an
  opener live; an odd-length run escapes it.
- `lex.escapeLiveInterpolations(source)` inserts one backslash before each live
  `#{` opener. It is idempotent and is the supported way for source generators
  to preserve literal interpolation text through re-lexing, including inside
  inline code spans.

## License

  MIT
