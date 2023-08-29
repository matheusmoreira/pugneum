# pugneum-loader

The pugneum loader resolves the paths to
and reads the contents of the files
referenced by a pugneum abstract syntax tree.

It adds `fullPath` and `str` properties to every `Include` and `Extends` node.
It also adds an `ast` property to any `Include` or `Extends` nodes
that are currently loading pugneum and then recursively loads the dependencies
of those files.

## Installation

    npm install pugneum-loader

## Usage

```js
var load = require('pugneum-loader');
```

### `load(ast, options)`

Loads all dependencies of the pugneum AST.

`options` may contain the following properties:

 - `lex` (function): **(required)** pugneum lexer to use
 - `parse` (function): **(required)** pugneum parser to use
 - `resolve` (function): path resolution function
 - `read` (function): file reading function, defaults to synchronous reads
 - `basedir` (string): base directory of absolute file names; **required** when those references are present

The `options` object is passed to `options.resolve` and `options.read`.

#### `resolve(filename, source, options)`

Resolves the full path of an included or extended file given the path of the source file.

`filename` is the referenced file.
`source` is the file that is referencing `filename`.

#### `read(filename, options)`

Returns the contents of a file.
By default, synchronously reads the file referenced by `filename`.

## License

  MIT
