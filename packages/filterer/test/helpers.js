'use strict';

const lex = require('pugneum-lexer');
const parse = require('pugneum-parser');

function parseSource(source, options) {
  const parseOptions = Object.assign({}, options, {source});
  return parse(lex(source, parseOptions), parseOptions);
}

function inlineTagNode(name, text, filename) {
  filename = filename || '';
  return {
    type: 'Tag',
    name,
    attrs: [],
    attributeBlocks: [],
    isInline: true,
    block: {
      type: 'Block',
      nodes: [{type: 'Text', val: text, line: 1, column: 1, filename}],
      line: 1,
      filename,
    },
    line: 1,
    column: 1,
    filename,
  };
}

module.exports = {inlineTagNode, parseSource};
