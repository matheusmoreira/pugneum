'use strict';

var lex = require('pugneum-lexer');
var parse = require('../');

const input = `
div
  | Hello
  | World
`;

test('no uncessessary blocks should be added', () => {
  expect(parse(lex(input))).toMatchSnapshot();
});
