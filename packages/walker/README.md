# pugneum-walker

Walk and transform a pugneum abstract syntax tree

## Installation

Install only the walker when your application already supplies an AST:

    npm install pugneum-walker

To run the parser-integration examples below, install their lexer and parser
too:

    npm install pugneum-walker pugneum-parser pugneum-lexer

## Usage

```js
const walk = require('pugneum-walker');
```

### `walk(ast, before, after, options)`

Traverse and optionally transform an abstract syntax tree
returned by the pugneum parser.

By default, descendant changes are made directly on the provided `ast`. Always
use the return value (`ast = walk(ast, ...)`), however: replacing the root
changes the returned root reference and cannot update the caller's original
variable in place. Without a root replacement, the return value is the original
`ast` object. Set `options.clone` to `true` for a clone-before-walk transaction;
the returned tree then owns all changes and the input graph stays untouched.

The supported call forms are:

- `walk(ast, before, after, options)`
- `walk(ast, before, options)` (the three-argument options overload)

`before` and `after` must each be a function with the signature
`(node, replace, control)`, or exactly `null`/`undefined` when omitted.
`before` is called when a node is first seen
while `after` is called after the children of the node
have already been traversed, if any.
With exactly three arguments, a non-array object in the third position is the
options object; a function or nullish value in that position is `after`. Use
the four-argument form to supply both `after` and `options`. An array or any
other non-nullish, non-function hook value is rejected with a `TypeError`
before a callback runs, the AST changes, or the options object is touched.

The `replace` parameter is a frozen controller with two explicit operations:

- `replace.revisit(nodeOrNodes)` substitutes the current node and traverses the
  replacement. Each replacement node receives its own balanced `before` and
  `after` lifecycle, subject to ordinary pruning, stopping, or another explicit
  replacement requested by those hooks.
- `replace.final(nodeOrNodes)` substitutes the current node without invoking
  either hook on the replacement. Use this for already-final output, removals,
  and post-order rewrites that must not re-enter the transform.

Both operations accept one node or an array. An array splices its members into
the containing node list, which can remove or add adjacent nodes. Array
replacement is legal only when the read-only boolean
`replace.arrayAllowed` is `true`: in a `Block` or `NamedBlock` node list, or in
the `IncludeFilter` list of a `RawInclude`. A hook may request at most one
replacement. Replacing a node with itself (or the one-member splice `[node]`)
is a terminating no-op.

Every scalar replacement and every member of an array replacement is
recursively validated before the current tree is changed. Unknown or malformed
nodes, wrong node types for typed attachment slots, structural aliases or
cycles, and invalid collection members throw an
`ASTValidationError`; a rejected replacement leaves the original position
unchanged. A replacement also cannot insert one of the current node's ancestors
and thereby create a cycle at attachment time. Changing `replace.arrayAllowed`
cannot grant array-replacement permission because permission is held in the
walk's private traversal state.

If `before` returns `false`, the children of this node
will not be traversed and will be left unchanged
unless an explicit replacement has been requested.
The matching `after` hook is also skipped for that node; traversal continues
normally with its siblings and ancestors.
Otherwise, the returned value of `before` is ignored.
The returned value of `after` is always ignored.

A replacement request takes precedence over `before` returning `false`.
`revisit` always revisits and `final` never does, regardless of whether it was
requested by `before` or `after`. The complete event contract is:

| Hook action | Current node events | Replacement events | Result |
| --- | --- | --- | --- |
| none | `before`, descendants, `after` | — | current node |
| `before` returns `false` | `before` only | — | current node, pruned |
| `before`: `revisit(value)` | `before` only | balanced walk | visited substitution/splice |
| `before`: `final(value)` | `before` only | none | final substitution/splice |
| `after`: `revisit(value)` | `before`, descendants, `after` | balanced walk | visited substitution/splice |
| `after`: `final(value)` | `before`, descendants, `after` | none | final substitution/splice |
| either hook: self-replacement | normal current lifecycle | no second visit | unchanged node |

For an empty array, “balanced walk” and “none” both produce no replacement
events; `replace.final([])` is the clearest removal idiom.

The same frozen `control` object is passed to every hook in one walk. Calling
`control.stop()` ends the whole traversal: no remaining descendants, siblings,
or unfinished ancestor `after` hooks run. A final replacement requested by the
hook that stops traversal is still committed. `replace.revisit()` and
`control.stop()` are incompatible in one hook because a stopped walk cannot
deliver the requested balanced lifecycle; that combination throws. The
read-only boolean
`control.stopped` reports whether a hook has requested a stop. Complete graph
validation still happens before the first hook, so stopping affects traversal,
not schema preflight.

`options` can contain the following properties:

- `aliasMode` (`'reject'` or `'per-edge'`): reject shared node/record objects
  before mutation by default. Use `'per-edge'` only when the caller deliberately
  owns graph semantics and wants a shared object visited once for every incoming
  structural edge; a non-idempotent hook will then affect that object repeatedly.
- `clone` (boolean): clone the complete reachable AST value graph before hooks
  run and return the transformed clone; default `false`. Prototypes, property
  descriptors, symbol fields, aliases, and `Buffer` bytes are preserved.
- `includeDependencies` (boolean): walk the syntax trees of dependencies (includes and extends); default `false`
- `maxDepth` (integer): maximum total structural edge depth across syntax and
  traversed dependencies; defaults to `walk.MAX_AST_DEPTH` (`512`) and may be
  lowered but not raised.
- `parents` (array<Node>): a caller-owned ancestor stack used mainly
  internally; defaults to `[]`. During each callback, index `0` is the nearest
  parent and the current node is not included. A mutable supplied array is
  updated in place as traversal descends and ascends, so treat its callback-time
  contents as read-only; its initial entries and order are restored before
  `walk` returns or throws. A frozen, sealed, or otherwise non-extensible array
  is instead treated as an immutable ancestry seed and remains unchanged while
  a private copy drives traversal. A reentrant `walk` using the same mutable
  array likewise starts from that array's outer entry-time seed, so the inner
  traversal cannot corrupt or inherit the outer traversal's live frames. The
  stack is **not** reset when crossing into a dependency under
  `includeDependencies`, so ancestors from the including file remain visible
  at the file boundary.

When supplied, `options` must be a non-null, non-array object.
`aliasMode` must be `'reject'`, `'per-edge'`, or `undefined`; `clone` and
`includeDependencies` must be booleans or `undefined`; and `parents` must be an
array or `undefined`. `maxDepth` must be an integer from `0` through `512`.
Invalid option shapes throw a `TypeError` before any hook runs or caller-owned
state changes. The walker never adds properties to or otherwise writes the
options object itself, so frozen and sealed options are supported.

### `walk.validate(ast, options)`

Validate a complete AST graph without mutating it or recursively consuming the
JavaScript call stack. The return value is the original `ast` on success. On
failure it throws an `ASTValidationError` with `code === 'INVALID_AST'` plus
`kind` and `path` fields identifying the violated contract.

The validator recognizes schema version `walk.AST_SCHEMA_VERSION` (currently
`1`). `walk.MAX_AST_DEPTH` is `512`, the maximum structural depth reachable
from the parser's 256-expression limit; callers decide whether to apply it.
Validator options are:

- `allowRootArray`: accept an array of nodes at the root; default `false`.
- `allowAliases`: permit the same node object at multiple structural positions;
  default `true`. Cycles are always rejected.
- `maxDepth`: maximum structural edge depth; default unbounded.
- `allowedTypes`: a set-like object whose `has(type)` selects node types legal
  at a caller-defined pipeline stage.
- `forbiddenNodes`: a set-like object identifying nodes already owned by a
  surrounding tree and therefore invalid at this ingress.

### Input contract

The walker requires well-formed pugneum parser output and checks the complete
reachable AST graph before the first hook runs:

- `ast` must be a non-null, non-array node object whose `type` is a string.
  Invalid root shapes are rejected with a `TypeError` before hooks or options
  are touched.
- `includeDependencies` only follows an already populated `FileReference.ast`.
  It does not read or parse files; run the loader first (or attach a valid AST
  explicitly). A file reference without `ast` remains a leaf even when the
  option is enabled. When the option is `false`, a populated dependency root
  must still be a `Block`, but its descendants are neither traversed nor
  recursively preflighted.
- Traversal has one total structural-depth budget, defaulting to 512 edges.
  Syntax and followed dependency edges consume the same budget, so their
  composition cannot bypass it. An over-budget graph or replacement throws an
  `ASTValidationError` with `kind === 'depth'` before recursive traversal.
- Under `includeDependencies`, the dependency graph must be
  acyclic. The loader enforces this in the pipeline, and walker preflight
  rejects a direct cycle before hooks run with `kind === 'cycle'`.
- Mutating walks require a single-owner input tree by default. A shared-node or
  shared-record diamond fails preflight with `kind === 'alias'`, before any hook
  can apply a non-idempotent transform twice. `aliasMode: 'per-edge'` is the
  explicit graph-walking opt-in.

Unknown node types and known nodes whose fields or collection members have the
wrong shape throw an `ASTValidationError` before hooks can prune or mutate the
tree. The error has `code === 'INVALID_AST'`, a stable `kind` and structural
`path`, the offending `node`, and any valid `filename`, `line`, and `column`
available from that node or its containing record. Its message includes both
the source location and structural path. A rejected input leaves the AST and
options untouched.

The walker can preflight package-detectable input and replacement failures, but
it cannot predict an arbitrary exception thrown by user hook code. Because the
default contract preserves in-place identity, treat an input AST as
**discard-only** after such a failure: earlier hook mutations may already be
visible. Use `clone: true` when the caller needs transactional publication. If
the walk throws, the original AST graph then remains unchanged; publish only a
successfully returned clone. This isolation covers the AST value graph, not
unrelated external state that a hook mutates through its own closure.

In particular, `Tag.name` and `InterpolatedTag.expr` must begin with an ASCII
letter. Later characters may be ASCII letters, digits, underscores, hyphens,
or colons, with a hyphen or colon only between word characters. This matches
the lexer boundary and prevents direct syntax-filter ASTs from bypassing the
markup-name contract.

```js
var assert = require('node:assert/strict');
var lex = require('pugneum-lexer');
var parse = require('pugneum-parser');
var walk = require('pugneum-walker');

// Changing content of all Text nodes
// ==================================

var source = '.my-class foo';
var dest = '.my-class bar';

var ast = parse(lex(source));

ast = walk(
  ast,
  function before(node, replace) {
    if (node.type === 'Text') {
      node.val = 'bar';

      // Alternatively, you can replace the entire node
      // while preserving all parser-owned fields.
      // replace.final(Object.assign({}, node, {val: 'bar'}));
    }
  },
  {
    includeDependencies: true,
  },
);

assert.deepEqual(parse(lex(dest)), ast);

// Convert all simple <strong> elements to text
// ============================================

var source = 'p abc #(strong NO)\nstrong on its own line';

var ast = parse(lex(source));

ast = walk(
  ast,
  function before(node, replace) {
    // Find all <strong> tags
    if (node.type === 'Tag' && node.name === 'strong') {
      var children = node.block.nodes;

      // Make sure that the Tag only has one child -- the text
      if (children.length === 1 && children[0].type === 'Text') {
        // Reuse the complete parser-produced Text node, including location.
        replace.revisit(children[0]);
      }
    }
  },
  {
    includeDependencies: true,
  },
);

var strongTags = 0;
var textValues = [];
walk(ast, function inspect(node) {
  if (node.type === 'Tag' && node.name === 'strong') strongTags++;
  if (node.type === 'Text' && node.val) textValues.push(node.val);
});
assert.equal(strongTags, 0);
assert.deepEqual(textValues, ['abc ', 'NO', 'on its own line']);

// Flatten blocks
// ==============

var ast = {
  type: 'Block',
  nodes: [
    {type: 'Text', val: 'a'},
    {
      type: 'Block',
      nodes: [
        {type: 'Text', val: 'b'},
        {
          type: 'Block',
          nodes: [{type: 'Text', val: 'c'}],
        },
        {type: 'Text', val: 'd'},
      ],
    },
    {type: 'Text', val: 'e'},
  ],
};

var dest = {
  type: 'Block',
  nodes: [
    {type: 'Text', val: 'a'},
    {type: 'Text', val: 'b'},
    {type: 'Text', val: 'c'},
    {type: 'Text', val: 'd'},
    {type: 'Text', val: 'e'},
  ],
};

// We need to use `after` handler instead of `before`
// handler because we want to flatten the innermost
// blocks first before proceeding onto outer blocks.

ast = walk(ast, null, function after(node, replace) {
  if (node.type === 'Block' && replace.arrayAllowed) {
    // Replace the block with its contents
    replace.final(node.nodes);
  }
});

assert.deepEqual(dest, ast);
```

## License

MIT
