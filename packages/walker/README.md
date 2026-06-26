# pugneum-walker

Walk and transform a pugneum abstract syntax tree

## Installation

    npm install pugneum-walker

## Usage

```js
const walk = require('pugneum-walker');
```

### `walk(ast, before, after, options)`

Traverse and optionally transform an abstract syntax tree
returned by the pugneum parser.

`ast` is not cloned so any changes done to it
will be done directly on the provided object.

`before` and `after` are functions with the signature `(node, replace)`.
`before` is called when a node is first seen
while `after` is called after the children of the node
have already been traversed, if any.
Either hook may be omitted by passing `null` or `undefined`.
The `after` argument may also be omitted entirely,
in which case `options` takes its place: `walk(ast, before, options)`.
An array passed where `after` is expected is rejected
(it is not silently treated as `options`).

The `replace` parameter is a function that can be used
to replace the node in the AST. It takes either an object
or an array as its only parameter. If an object is specified,
the current node is replaced by the parameter in the AST.
If an array is specified and the ancestor of the current node
allows such an operation, the node is replaced by all of the
nodes in the specified array. This way, you can remove and add
new nodes adjacent to the current node.
Whether the parent node allows array operation is indicated
by the property `replace.arrayAllowed`, which is set to true
when the parent is a Block and when the parent is a RawInclude
and the node is an IncludeFilter.

If `before` returns `false`, the children of this node
will not be traversed and will be left unchanged
unless `replace` has been called.
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
- `parents` (array<Node>): nodes that are ancestors to the current `ast`; this option is used mainly internally, and users usually do not have to specify it; defaults to `[]`. Note that `parents` reflects in-AST nesting and is **not** reset when crossing into a dependency's tree under `includeDependencies`, so ancestors from the including file remain visible at the file boundary.

### Input contract

The walker assumes well-formed pugneum parser output:

- `ast` must be a single node, not a bare array.
  A bare array at the root is rejected with an error.
- The traversal is fully recursive with no depth limit.
  The normal pipeline is safe because the parser caps
  nesting at 256 before the AST reaches the walker.
  A hand-built AST deeper than the native call stack
  throws a `RangeError`.
- Under `includeDependencies`, the dependency graph must be
  acyclic. The loader enforces this in the pipeline; a cyclic
  `FileReference.ast` walked directly throws a `RangeError`.

Known node types whose required fields are missing or of the
wrong shape (for example an `Include` with no `block`) throw a
located `Malformed <type> node` error rather than a bare
`TypeError` from a deeper frame.

```js
var lex = require('pugneum-lexer');
var parse = require('pugneum-parser');

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
      // rather than just the text.
      // replace({ type: 'Text', val: 'bar', line: node.line });
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
var dest = 'p abc #(| NO)\n| on its own line';

var ast = parse(lex(source));

ast = walk(
  ast,
  function before(node, replace) {
    // Find all <strong> tags
    if (node.type === 'Tag' && node.name === 'strong') {
      var children = node.block.nodes;

      // Make sure that the Tag only has one child -- the text
      if (children.length === 1 && children[0].type === 'Text') {
        // Replace the Tag with the Text
        replace({type: 'Text', val: children[0].val, line: node.line});
      }
    }
  },
  {
    includeDependencies: true,
  },
);

assert.deepEqual(parse(lex(dest)), ast);

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
