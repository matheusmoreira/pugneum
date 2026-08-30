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

`ast` is not cloned, so descendant changes are made directly on the provided
object. Always use the return value (`ast = walk(ast, ...)`), however: replacing
the root changes the returned root reference and cannot update the caller's
original variable in place. Without a root replacement, the return value is
the original `ast` object.

The supported call forms are:

- `walk(ast, before, after, options)`
- `walk(ast, before, options)` (the three-argument options overload)

`before` and `after` must each be a function with the signature
`(node, replace)`, or exactly `null`/`undefined` when omitted.
`before` is called when a node is first seen
while `after` is called after the children of the node
have already been traversed, if any.
With exactly three arguments, a non-array object in the third position is the
options object; a function or nullish value in that position is `after`. Use
the four-argument form to supply both `after` and `options`. An array or any
other non-nullish, non-function hook value is rejected with a `TypeError`
before a callback runs, the AST changes, or the options object is touched.

The `replace` parameter is a function that can be used
to replace the node in the AST. It takes either an object
or an array as its only parameter. If an object is specified,
the current node is replaced by the parameter in the AST.
If an array is specified and the ancestor of the current node
allows such an operation, the node is replaced by all of the
nodes in the specified array. This way, you can remove and add
new nodes adjacent to the current node.
Whether the parent node allows array operation is indicated
by the read-only property `replace.arrayAllowed`, which is set to true
when the parent is a Block or NamedBlock and when the parent is a RawInclude
and the node is an IncludeFilter.

Every scalar replacement and every member of an array replacement is
recursively validated before the current tree is changed. Unknown or malformed
nodes, structural cycles, and invalid collection members throw an
`ASTValidationError`; a rejected replacement leaves the original position
unchanged. A replacement also cannot insert one of the current node's ancestors
and thereby create a cycle at attachment time. Changing `replace.arrayAllowed`
cannot grant array-replacement permission because permission is held in the
walk's private traversal state.

If `before` returns `false`, the children of this node
will not be traversed and will be left unchanged
unless `replace` has been called.
The matching `after` hook is also skipped for that node; traversal continues
normally with its siblings and ancestors.
Otherwise, the returned value of `before` is ignored.
The returned value of `after` is always ignored.

Whether the nodes of an array replacement are themselves
traversed depends on where and how `replace` is called.
There are three distinct cases:

- `replace([...])` in `before` without returning `false`:
  the inserted nodes **are** traversed
  (`before`/`after` run for each of them).
- `replace([...])` in `before` followed by `return false`:
  the inserted nodes are spliced in but **not** traversed,
  because returning `false` skips this node's children.
  The empty-array removal idiom `replace([]); return false`
  is the canonical use of this case.
- `replace([...])` in `after`:
  the inserted nodes are spliced in but **not** re-traversed,
  because `after` runs after the subtree is already done
  and re-descending could fail to terminate.

`options` can contain the following properties:

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
`includeDependencies` must be a boolean or `undefined`, and `parents` must be
an array or `undefined`. `maxDepth` must be an integer from `0` through `512`.
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

Unknown node types and known nodes whose fields or collection members have the
wrong shape throw an `ASTValidationError` before hooks can prune or mutate the
tree. The error has `code === 'INVALID_AST'`, a stable `kind` and structural
`path`, the offending `node`, and any valid `filename`, `line`, and `column`
available from that node or its containing record. Its message includes both
the source location and structural path. A rejected input leaves the AST and
options untouched.

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
      // replace(Object.assign({}, node, {val: 'bar'}));
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
        replace(children[0]);
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
    replace(node.nodes);
  }
});

assert.deepEqual(dest, ast);
```

## License

MIT
