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
when the parent is a Block and when the parent is a Include
and the node is an IncludeFilter.

If `before` returns `false`, the children of this node
will not be traversed and will be left unchanged
unless `replace` has been called.
Otherwise, the returned value of `before` is ignored.
The returned value of `after` is always ignored.
If `replace()` is called in `before()` with an array,
and `before()` does not return `false`,
the nodes in the array are still traversed.

`options` can contain the following properties:

 - `includeDependencies` (boolean): walk the syntax trees of dependencies (includes and extends); default `false`
 - `parents` (array<Node>): nodes that are ancestors to the current `ast`; this option is used mainly internally, and users usually do not have to specify it; defaults to `[]`

```js
var lex = require('pugneum-lexer');
var parse = require('pugneum-parser');

// Changing content of all Text nodes
// ==================================

var source = '.my-class foo';
var dest = '.my-class bar';

var ast = parse(lex(source));

ast = walk(ast, function before(node, replace) {
  if (node.type === 'Text') {
    node.val = 'bar';

    // Alternatively, you can replace the entire node
    // rather than just the text.
    // replace({ type: 'Text', val: 'bar', line: node.line });
  }
}, {
  includeDependencies: true
});

assert.deepEqual(parse(lex(dest)), ast);

// Convert all simple <strong> elements to text
// ============================================

var source = 'p abc #[strong NO]\nstrong on its own line';
var dest = 'p abc #[| NO]\n| on its own line';

var ast = parse(lex(source));

ast = walk(ast, function before(node, replace) {
  // Find all <strong> tags
  if (node.type === 'Tag' && node.name === 'strong') {
    var children = node.block.nodes;

    // Make sure that the Tag only has one child -- the text
    if (children.length === 1 && children[0].type === 'Text') {
      // Replace the Tag with the Text
      replace({ type: 'Text', val: children[0].val, line: node.line });
    }
  }
}, {
  includeDependencies: true
});

assert.deepEqual(parse(lex(dest)), ast);

// Flatten blocks
// ==============

var ast = {
  type: 'Block',
  nodes: [
    { type: 'Text', val: 'a' },
    {
      type: 'Block',
      nodes: [
        { type: 'Text', val: 'b' },
        {
          type: 'Block',
          nodes: [ { type: 'Text', val: 'c' } ]
        },
        { type: 'Text', val: 'd' }
      ]
    },
    { type: 'Text', val: 'e' }
  ]
};

var dest = {
  type: 'Block',
  nodes: [
    { type: 'Text', val: 'a' },
    { type: 'Text', val: 'b' },
    { type: 'Text', val: 'c' },
    { type: 'Text', val: 'd' },
    { type: 'Text', val: 'e' }
  ]
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
