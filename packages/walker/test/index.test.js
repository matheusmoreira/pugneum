'use strict';

var assert = require('node:assert/strict');
var {describe, test} = require('node:test');
var lex = require('pugneum-lexer');
var parse = require('pugneum-parser');
var walk = require('../');

test('simple', function () {
  var ast = walk(
    parse(lex('.my-class foo')),
    function before(node, replace) {
      if (node.type === 'Text') {
        replace({
          type: 'Text',
          val: 'bar',
          line: node.line,
          column: node.column,
        });
      }
    },
    function after(node, replace) {},
  );
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(ast)),
    JSON.parse(JSON.stringify(parse(lex('.my-class bar')))),
  );
});

describe('replace([])', function () {
  test('block flattening', function () {
    var called = [];
    var ast = walk(
      {
        type: 'Block',
        nodes: [
          {
            type: 'Block',
            nodes: [
              {
                type: 'Block',
                nodes: [
                  {
                    type: 'Text',
                    val: 'a',
                  },
                  {
                    type: 'Text',
                    val: 'b',
                  },
                ],
              },
              {
                type: 'Text',
                val: 'c',
              },
            ],
          },
          {
            type: 'Text',
            val: 'd',
          },
        ],
      },
      function (node, replace) {
        if (node.type === 'Text') {
          called.push('before ' + node.val);
          if (node.val === 'a') {
            assert(replace.arrayAllowed, 'replace.arrayAllowed set wrongly');
            replace([
              {
                type: 'Text',
                val: 'e',
              },
              {
                type: 'Text',
                val: 'f',
              },
            ]);
          }
        }
      },
      function (node, replace) {
        if (node.type === 'Block' && replace.arrayAllowed) {
          replace(node.nodes);
        } else if (node.type === 'Text') {
          called.push('after ' + node.val);
        }
      },
    );

    assert.deepStrictEqual(JSON.parse(JSON.stringify(ast)), {
      type: 'Block',
      nodes: [
        {type: 'Text', val: 'e'},
        {type: 'Text', val: 'f'},
        {type: 'Text', val: 'b'},
        {type: 'Text', val: 'c'},
        {type: 'Text', val: 'd'},
      ],
    });

    assert.deepStrictEqual(
      called,
      [
        'before a',

        'before e',
        'after e',

        'before f',
        'after f',

        'before b',
        'after b',

        'before c',
        'after c',

        'before d',
        'after d',
      ],
      'before() and after() called incorrectly: ' + JSON.stringify(called),
    );
  });

  test('adding include filters', function () {
    var ast = walk(
      parse(lex('include:filter1:filter2 file')),
      function (node, replace) {
        if (node.type === 'IncludeFilter') {
          assert(replace.arrayAllowed);
          if (node.name === 'filter1') {
            var firstFilter = 'filter3';

            replace([
              {
                type: 'IncludeFilter',
                name: firstFilter,
                attrs: [],
                line: node.line,
                column: node.column,
              },
              {
                type: 'IncludeFilter',
                name: 'filter4',
                attrs: [],
                line: node.line,
                column: node.column + firstFilter.length + 1,
              },
            ]);
          } else if (node.name === 'filter2') {
            replace([]);
          }
        }
      },
    );

    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(ast)),
      JSON.parse(JSON.stringify(parse(lex('include:filter3:filter4 file')))),
    );
  });

  test('fails when parent is not Block', function () {
    walk(parse(lex('p content')), function (node, replace) {
      if (
        node.type === 'Block' &&
        node.nodes[0] &&
        node.nodes[0].type === 'Text'
      ) {
        assert(!replace.arrayAllowed, 'replace.arrayAllowed set wrongly');
        assert.throws(function () {
          replace([]);
        });
      }
    });
  });
});

test('before returning false skips children and after', function () {
  var visited = [];
  walk(
    parse(lex('div\n  p Hello')),
    function before(node) {
      visited.push('before ' + node.type);
      if (node.type === 'Tag') {
        return false;
      }
    },
    function after(node) {
      visited.push('after ' + node.type);
    },
  );
  // Tag's children (Block containing Text) should not be visited
  assert(
    !visited.includes('before Text'),
    'Text child should not be visited when before returns false for Tag',
  );
  // after should not be called for the skipped Tag
  assert(
    !visited.includes('after Tag'),
    'after should not be called when before returns false',
  );
});

test('unknown node type throws', function () {
  assert.throws(
    function () {
      walk({type: 'UnknownNodeType', line: 1});
    },
    function (err) {
      return err.message === 'Unexpected node type UnknownNodeType';
    },
  );
});
