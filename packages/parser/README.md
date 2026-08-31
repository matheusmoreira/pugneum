# pugneum-parser

The pugneum parser transforms an array of tokens into an abstract syntax tree.

## Installation

Install the parser and the lexer used by the source-to-AST example below:

    npm install pugneum-parser pugneum-lexer

The parser itself accepts a token array and has no runtime dependency on the
lexer. If your application already supplies a compatible token stream,
installing `pugneum-parser` alone is sufficient.

## Usage

```js
var parse = require('pugneum-parser');
```

### `parse(tokens, options)`

Convert pugneum tokens into an abstract syntax tree (AST).

`options` can contain the following properties:

 - `filename` (string): pugneum file name; included in AST nodes and used in error handling
 - `source` (string): pugneum source code before tokenization; used in error handling

```js
const lex = require('pugneum-lexer');

let filename = 'my-file.pg';
let source = 'div(data-foo="bar")';
let tokens = lex(source, {filename});

let ast = parse(tokens, {filename, source});

console.log(JSON.stringify(ast, null, '  '))
```

```json
{
  "type": "Block",
  "nodes": [
    {
      "type": "Tag",
      "name": "div",
      "block": {
        "type": "Block",
        "nodes": [],
        "line": 1,
        "filename": "my-file.pg"
      },
      "attrs": [
        {
          "name": "data-foo",
          "val": "bar",
          "line": 1,
          "column": 5,
          "filename": "my-file.pg"
        }
      ],
      "attributeBlocks": [],
      "isInline": false,
      "line": 1,
      "column": 1,
      "filename": "my-file.pg"
    }
  ],
  "line": 0,
  "filename": "my-file.pg"
}
```

### Input contract

`tokens` must be the flat array produced by a successful `pugneum-lexer`
tokenization under its Token stream contract (v1). In particular, each token
must have a string `type` and a `loc.start` with one-based safe-integer `line`
and `column` numbers; structural boundary tokens must balance; and one `eos`
token must end the array. `options` may be omitted, set to `null`, or supplied
as a non-array object. Other values throw a `TypeError`.

The parser validates that `tokens` is an array, but it does not revalidate the
lexer's complete structural balance. It does validate every token's object
shape, string `type`, and one-based safe-integer `loc.start`, and requires
exactly one `eos` as the final token. A malformed hand-built stream throws a
stable, indexed `TypeError` before parsing; a complete stream that violates the
parser grammar throws the coded diagnostic documented below. Use the lexer
contract when another producer needs to construct compatible tokens.

### AST contract (v1)

The parser returns a `Block` root. The tables below describe fields emitted by
the parser itself; later pipeline stages may deliberately extend these nodes.
Except for `Block`, every node has these location fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `type` | `string` | Node discriminator. |
| `line` | `number` | One-based start line. |
| `column` | `number` | One-based start column. |
| `filename` | `string \| undefined` | Exactly `options.filename`; token filenames are not copied. |

Locations identify starts only. Parser AST nodes have no end location and no
`loc` wrapper. A `Block` has `line` and `filename` but no `column`; the root
uses line `0`, while nested blocks use the line of their opening or owning
construct.

#### Nodes

Fields in this table are in addition to the location fields above unless the
row says otherwise. A field is always present unless marked optional.

| Node | Parser-owned fields |
| --- | --- |
| `Block` | `nodes: Node[]`, `line: number`, `filename: string \| undefined`; no `column`; optional `isFootnoteBody: true` |
| `Text` | `val: string`; optional `isFootnoteSeparator: true` |
| `Tag` | `name: string`, `block: Block`, `attrs: Attribute[]`, `attributeBlocks: []`, `isInline: boolean`, optional `textOnly: true` |
| `InterpolatedTag` | `expr: string`, `block: Block`, `attrs: Attribute[]`, `attributeBlocks: []`, `isInline: false`, optional `textOnly: true` |
| `Comment` | `val: string`, `buffer: boolean` |
| `BlockComment` | `val: string`, `buffer: boolean`, `block: Block` |
| `Filter` | `name: string`, `attrs: Attribute[]`, `block: Block` |
| `IncludeFilter` | `name: string`, `attrs: Attribute[]` |
| `Extends` | `file: FileReference` |
| `Include` | `file: FileReference`, `block: Block` |
| `RawInclude` | `file: FileReference`, `filters: IncludeFilter[]` |
| `FileReference` | `path: string` |
| `NamedBlock` | `name: string`, `mode: "replace" \| "append" \| "prepend"`, `nodes: Node[]` |
| `MixinBlock` | Location fields only. |
| `Given` | `name: string`, `block: Block` |
| `Variable` | `name: string` |
| `YieldBlock` | Location fields only. |
| `References` | `definitions: ReferenceDefinition[]` |
| `ReferenceLink` | `name: string`, `block: Block`, `attrs: Attribute[]` |
| `ReferenceImage` | `name: string`, `block: Block`, `attrs: Attribute[]` |
| `FootnoteRef` | `name: string` |
| `Footnotes` | `definitions: FootnoteDefinition[]` |
| `Toc` | Location fields only. |
| `Mixin` | Discriminated definition/call fields described below. |

`Text.val` is nonempty in parser output. Zero-length lexer boundary fragments
are discarded, while explicit structural separators such as preserved text
block newlines remain ordinary `Text` nodes. A footnote definition's `Block`
has `isFootnoteBody: true`; its physical line joins are `Text(" ")` nodes with
`isFootnoteSeparator: true`. Those joins remain semantic boundaries until the
renderer resolves nullable mixin variables, so they never become leading or
terminal output.

The parser retains `InterpolatedTag` support for compatible token producers
that emit a direct `interpolation` token. The current lexer v1 stream lowers
ordinary inline interpolation through boundary tokens instead.

#### Supporting records

These records do not have a `type` discriminator:

| Record | Fields |
| --- | --- |
| `Attribute` | `name: string`, `val: string \| true`, `line: number`, `column: number`, `filename: string \| undefined` |
| `MixinParameter` | `name: string`, optional `default: string`; definition parameters only |
| `ReferenceDefinition` | `name: string`, `url: string`, `defaultText: string \| null`, `line: number`, `column: number`, `filename: string \| undefined` |
| `FootnoteDefinition` | `name: string`, `block: Block`, `line: number`, `column: number`, `filename: string \| undefined` |

#### Mixin and control fields

A `Mixin` definition has `name: string`, `args: MixinParameter[]`,
`block: Block`, `call: false`, `usesNamedBlocks: boolean`, and
`usesUnnamedBlock: boolean`. A `Mixin` call has `name: string`,
`args: string[]`, `block: Block | null`, `call: true`, `attrs: Attribute[]`,
`attributeBlocks: []`, and optional `textOnly: true`. The call's `block` is
`null` when it has no body or inline content.

`attributeBlocks` is a reserved downstream compatibility slot and is always an
empty array at the parser boundary. `isInline` is the parser's fixed tag-name
classification. `textOnly` is absent unless immediate dot/pipeless syntax sets
it to `true`. The two `uses*Block` flags inspect a mixin definition's own body
and stop at nested mixins. The parser does not emit downstream fields such as
`selfClosing` or a loaded `FileReference.ast`.

The only parser-emitted `null` values are an empty mixin call's `block` and a
reference definition without `defaultText`. Optional fields are absent rather
than set to `undefined`; `filename` is always present, but its value is
`undefined` when no filename option was supplied.

### Errors and limits

Supported token streams that violate parser grammar throw Pugneum diagnostics.
Their `code` values and conditions are:

| Code | Condition |
| --- | --- |
| `PUGNEUM:BLOCK_OUTSIDE_MIXIN` | An anonymous mixin block appears outside a mixin. |
| `PUGNEUM:DUPLICATE_ATTRIBUTE` | A non-class, non-`id` attribute name is repeated. |
| `PUGNEUM:DUPLICATE_FILTER_OPTION` | A block or include filter repeats an exact option name. |
| `PUGNEUM:DUPLICATE_ID` | An `id` is repeated, using shorthand, a parenthesized attribute, or both. |
| `PUGNEUM:DUPLICATE_MIXIN_PARAMETER` | A mixin declaration repeats an exact parameter name. |
| `PUGNEUM:GIVEN_OUTSIDE_MIXIN` | `given` is outside a mixin definition or inside a mixin call body. |
| `PUGNEUM:INVALID_TOKEN` | A well-formed token is not valid in the current grammar position. |
| `PUGNEUM:MIXIN_WITHOUT_BODY` | A mixin definition has no indented body. |
| `PUGNEUM:MULTIPLE_ATTRIBUTES` | A tag or mixin call has more than one parenthesized attribute block. |
| `PUGNEUM:NESTING_TOO_DEEP` | Expression parsing would exceed 256 nested dispatches. |
| `PUGNEUM:RAW_INCLUDE_BLOCK` | A raw include has an indented block. |
| `PUGNEUM:RESERVED_FILTER_OPTION` | A filter uses the infrastructure-owned `filename` option. |
| `PUGNEUM:VARIABLE_OUTSIDE_MIXIN` | A mixin variable appears outside a mixin definition. |

Coded diagnostics use the current token's start location plus
`options.filename` and `options.source`. The fixed parser nesting limit is 256;
the lexer reserves one level for an inline chain's containing expression and
therefore accepts up to 255 nested inline elements. Invalid API argument types
and malformed streams are not grammar diagnostics, so callers must not rely on
them having a `PUGNEUM:*` code.

## License

  MIT
