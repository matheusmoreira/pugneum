'use strict';

var path = require('path');
var assert = require('node:assert/strict');
var {test} = require('node:test');

var lex = require('pugneum-lexer');
var parse = require('pugneum-parser');
var filter = require('../');

var filename = path.basename(__filename);

var customFilters = {
  custom: {
    type: 'html',
    filter: function (str, options) {
      return 'BEGIN' + str + 'END';
    },
  },
  'custom-with-options': {
    type: 'html',
    filter: function (str, options) {
      return (
        'option=' + options.option + ' number=' + options.number + ' ' + str
      );
    },
  },
};

test('filters can be used', (t) => {
  const source = `
p
  :custom
    Filters can be used.
`;

  const ast = parse(lex(source, {filename}), {filename, source});

  const output = filter(ast, customFilters);
  t.assert.snapshot(output);
});

test('__proto__ attribute does not pollute Object.prototype', () => {
  const inspecting = {
    type: 'html',
    filter: function (str, options) {
      // The __proto__ attr should be a regular property on the null-prototype
      // attrs object, not trigger prototype pollution
      assert.strictEqual(options.__proto__, 'malicious');
      // Object.prototype must remain unpolluted
      assert.strictEqual({}.malicious, undefined);
      return str;
    },
  };

  const source = `
p
  :inspecting(__proto__=malicious)
    test
`;

  const ast = parse(lex(source, {filename}), {filename, source});
  filter(ast, {inspecting});
});

test('invalid filter name throws INVALID_FILTER_NAME', () => {
  const source = `
p
  :'../../../etc/malicious'
    test
`;

  const ast = parse(lex(source, {filename}), {filename, source});
  assert.throws(
    () => filter(ast),
    (err) =>
      err.code === 'PUGNEUM:INVALID_FILTER_NAME' &&
      /Invalid filter name/.test(err.message),
  );
});

test('filter that throws raw Error is wrapped as FILTER_ERROR', () => {
  var exploding = {
    type: 'html',
    filter: function () {
      throw new Error('kaboom');
    },
  };

  const source = `
p
  :exploding
    test
`;

  const ast = parse(lex(source, {filename}), {filename, source});
  assert.throws(
    () => filter(ast, {exploding}),
    (err) => err.code === 'PUGNEUM:FILTER_ERROR' && /kaboom/.test(err.message),
  );
});

test('verbatim filter passes text through unchanged', () => {
  const source = `
p
  :verbatim
    <strong>raw html</strong>
`;

  const ast = parse(lex(source, {filename}), {filename, source});
  const output = filter(ast, {});

  const textNode = output.nodes[0].block.nodes[0];
  assert.strictEqual(textNode.type, 'Text');
  assert.strictEqual(textNode.val, '<strong>raw html</strong>');
});

test('filters can be used with options', () => {
  const source = `
p
  :custom-with-options(option=value number=2)
    Filters can be used with options.
    The values aren't parsed though.
    They're just strings.
`;

  const ast = parse(lex(source, {filename}), {filename, source});

  const output = filter(ast, customFilters);

  // find the filtered text node
  const textNode = output.nodes[0].block.nodes[0];
  assert.strictEqual(
    textNode.val,
    "option=value number=2 Filters can be used with options.\nThe values aren't parsed though.\nThey're just strings.",
  );
});

test('text type filter escapes HTML entities', () => {
  const textFilter = {
    type: 'text',
    filter: function (str) {
      return '<script>alert("xss")</script> & "quotes"';
    },
  };

  const source = `
p
  :textFilter
    input
`;

  const ast = parse(lex(source, {filename}), {filename, source});
  const output = filter(ast, {textFilter});

  const textNode = output.nodes[0].block.nodes[0];
  assert.strictEqual(textNode.type, 'Text');
  assert.strictEqual(
    textNode.val,
    '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &quot;quotes&quot;',
  );
});

test('html type filter outputs raw HTML', () => {
  const htmlFilter = {
    type: 'html',
    filter: function (str) {
      return '<strong>' + str.trim() + '</strong>';
    },
  };

  const source = `
p
  :htmlFilter
    bold text
`;

  const ast = parse(lex(source, {filename}), {filename, source});
  const output = filter(ast, {htmlFilter});

  const textNode = output.nodes[0].block.nodes[0];
  assert.strictEqual(textNode.type, 'Text');
  assert.strictEqual(textNode.val, '<strong>bold text</strong>');
});

test('pugneum type filter output is lexed and parsed into AST nodes', () => {
  const pugneumFilter = {
    type: 'pugneum',
    filter: function (str) {
      return 'strong hello';
    },
  };

  const source = `
p
  :pugneumFilter
    ignored input
`;

  const ast = parse(lex(source, {filename}), {filename, source});
  const output = filter(ast, {pugneumFilter});

  const block = output.nodes[0].block.nodes[0];
  assert.strictEqual(block.type, 'Block');
  assert.strictEqual(block.nodes[0].type, 'Tag');
  assert.strictEqual(block.nodes[0].name, 'strong');
});

test('syntax type filter inserts AST nodes directly', () => {
  const syntaxFilter = {
    type: 'syntax',
    filter: function (str) {
      return [
        {
          type: 'Tag',
          name: 'em',
          attrs: [],
          attributeBlocks: [],
          isInline: true,
          block: {
            type: 'Block',
            nodes: [
              {
                type: 'Text',
                val: 'direct',
                line: 1,
                column: 1,
                filename: '',
              },
            ],
            line: 1,
            filename: '',
          },
          line: 1,
          column: 1,
          filename: '',
        },
      ];
    },
  };

  const source = `
p
  :syntaxFilter
    ignored
`;

  const ast = parse(lex(source, {filename}), {filename, source});
  const output = filter(ast, {syntaxFilter});

  const block = output.nodes[0].block.nodes[0];
  assert.strictEqual(block.type, 'Block');
  assert.strictEqual(block.nodes[0].type, 'Tag');
  assert.strictEqual(block.nodes[0].name, 'em');
});

test('MISSING_FILTER_TYPE when filter has no type', () => {
  const untyped = {
    filter: function (str) {
      return str;
    },
  };

  const source = `
p
  :untyped
    test
`;

  const ast = parse(lex(source, {filename}), {filename, source});
  assert.throws(
    () => filter(ast, {untyped}),
    (err) =>
      err.code === 'PUGNEUM:MISSING_FILTER_TYPE' &&
      /must declare a type/.test(err.message),
  );
});

test('INVALID_FILTER_TYPE when filter has unknown type', () => {
  const badType = {
    type: 'markdown',
    filter: function (str) {
      return str;
    },
  };

  const source = `
p
  :badType
    test
`;

  const ast = parse(lex(source, {filename}), {filename, source});
  assert.throws(
    () => filter(ast, {badType}),
    (err) =>
      err.code === 'PUGNEUM:INVALID_FILTER_TYPE' &&
      /unknown type/.test(err.message),
  );
});

test('INVALID_FILTER_OUTPUT when syntax filter returns non-array', () => {
  const badSyntax = {
    type: 'syntax',
    filter: function (str) {
      return 'not an array';
    },
  };

  const source = `
p
  :badSyntax
    test
`;

  const ast = parse(lex(source, {filename}), {filename, source});
  assert.throws(
    () => filter(ast, {badSyntax}),
    (err) =>
      err.code === 'PUGNEUM:INVALID_FILTER_OUTPUT' &&
      /must return an array/.test(err.message),
  );
});

test('INVALID_FILTER_OUTPUT when pugneum filter returns non-string', () => {
  const badPugneum = {
    type: 'pugneum',
    filter: function (str) {
      return 42;
    },
  };

  const source = `
p
  :badPugneum
    test
`;

  const ast = parse(lex(source, {filename}), {filename, source});
  assert.throws(
    () => filter(ast, {badPugneum}),
    (err) =>
      err.code === 'PUGNEUM:INVALID_FILTER_OUTPUT' &&
      /must return a string/.test(err.message),
  );
});

test('pugneum type filter supports inline shorthands in output', () => {
  const pugneumFilter = {
    type: 'pugneum',
    filter: function (str) {
      return 'p This is *(bold) and _(italic) text.';
    },
  };

  const source = `
div
  :pugneumFilter
    ignored
`;

  const ast = parse(lex(source, {filename}), {filename, source});
  const output = filter(ast, {pugneumFilter});

  const block = output.nodes[0].block.nodes[0];
  assert.strictEqual(block.type, 'Block');
  const pTag = block.nodes[0];
  assert.strictEqual(pTag.type, 'Tag');
  assert.strictEqual(pTag.name, 'p');
});

test('INVALID_FILTER_TYPE when include uses pugneum type filter', () => {
  const pugneumInclude = {
    type: 'pugneum',
    filter: function (str) {
      return 'p hello';
    },
  };

  const ast = {
    type: 'Block',
    nodes: [
      {
        type: 'RawInclude',
        filters: [{name: 'pugneumInclude', attrs: []}],
        file: {fullPath: 'test.txt', str: 'test content'},
        line: 1,
        column: 1,
        filename: filename,
      },
    ],
    line: 1,
    filename: filename,
  };

  assert.throws(
    () => filter(ast, {pugneumInclude}),
    (err) =>
      err.code === 'PUGNEUM:INVALID_FILTER_TYPE' &&
      /cannot be used with include/.test(err.message),
  );
});
