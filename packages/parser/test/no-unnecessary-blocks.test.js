'use strict';

var {test} = require('node:test');
var lex = require('pugneum-lexer');
var parse = require('../');

const input = `
div
  | Hello
  | World
`;

test('no unnecessary blocks should be added', (t) => {
  t.assert.snapshot(parse(lex(input)));
});
