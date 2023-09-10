# pugneum-error

Standard pugneum error object factory function.
This module is intended for useby the lexer, parser,
loader, linker, renderer and any plugins.

## Installation

    npm install pugneum-error

## Usage

```js
var error = require('pugneum-error');
```

### `error(code, message, options)`

Create a pugneum error object.

`code` is a required unique code for the error type that can be used to pinpoint a certain error.

`message` is a human-readable explanation of the error.

`options` can contain any of the following properties:

 - `filename`: the name of the file causing the error
 - `line`: the offending line
 - `column`: the offending column
 - `source`: the pugneum source, if available, for pretty-printing the error context

The resulting error object is a simple Error object with additional properties given in the arguments.

**Caveat:** the `message` argument is stored in `err.msg`, not `err.message`, which is occupied with a better-formatted message.

```js
var error = require('pugneum-error');

var err = error('MY_CODE', 'My message', {line: 3, filename: 'myfile', source: 'foo\nbar\nbaz\nbash\nbing'});
// { code: 'PUGNEUM:MY_CODE',
//   msg: 'My message',
//   line: 3,
//   column: undefined,
//   filename: 'myfile',
//   source: 'foo\nbar\nbaz\nbash\nbing',
//   message: 'myfile:3\n    1| foo\n    2| bar\n  > 3| baz\n    4| bash\n    5| bing\n\nMy message' }

throw err;
```

## License

  MIT
