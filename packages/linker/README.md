# pugneum-linker

Link multiple pugneum ASTs together using include/extends

## Installation

    npm install pugneum-linker

## Usage

```js
var link = require('pugneum-linker');
```

### `link(ast, options)`

Flatten the pugneum AST of inclusion and inheritance.

This function merely links the AST together.
It doesn't read the file system to resolve
and parse included and extended files.
Thus, the main AST must already have the ASTs
of the included and extended files embedded
in the `FileReference` nodes.
`pugneum-loader` is designed to do that.

`options` can contain the following properties:

 - `source` (string): pugneum source code; used for error context
 - `maxLinkDepth` (number): maximum template inheritance/include chain depth; default `256`

## License

  MIT
