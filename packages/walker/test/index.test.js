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

test('parents array is cleaned up when before hook throws', (t) => {
  const walk = require('../');
  const ast = {
    type: 'Block',
    nodes: [
      {
        type: 'Tag',
        name: 'div',
        attrs: [],
        attributeBlocks: [],
        isInline: false,
        block: {type: 'Block', nodes: [], line: 1, column: 1, filename: 'test'},
        line: 1,
        column: 1,
        filename: 'test',
      },
    ],
    line: 1,
    column: 1,
    filename: 'test',
  };
  const options = {parents: []};
  t.assert.throws(
    () => {
      walk(
        ast,
        (node) => {
          if (node.type === 'Tag') throw new Error('hook error');
        },
        options,
      );
    },
    {message: 'hook error'},
  );
  t.assert.deepStrictEqual(options.parents, []);
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

describe('argument overload detection', function () {
  test('an array passed where after is expected is rejected, not swallowed as options', function () {
    // Before the fix, the array (typeof 'object') was silently taken as
    // `options`, so the after hook never ran and no error was raised.
    var afterRan = false;
    assert.throws(function () {
      walk(
        {type: 'Block', nodes: [{type: 'Text', val: 'x'}]},
        function before() {},
        // intended as `after` but mistyped as an array
        [
          function after() {
            afterRan = true;
          },
        ],
      );
    });
    assert(!afterRan, 'after hook should not have run');
  });

  test('3-arg form (ast, before, options) still seeds parents from options', function () {
    var sawArrayAllowed;
    walk(
      {type: 'Text', val: 'x'},
      function before(node, replace) {
        if (node.type === 'Text') sawArrayAllowed = replace.arrayAllowed;
      },
      {parents: [{type: 'Block'}]},
    );
    assert.strictEqual(
      sawArrayAllowed,
      true,
      'options object passed as 3rd arg should still be honored',
    );
  });
});

describe('input contract', function () {
  test('a bare array at the root is rejected', function () {
    // Previously this called before() with the array as `node` (when a before
    // hook was given) or fell through to the `Unexpected node type undefined`
    // default branch (when before was null) -- two different fates for the
    // same input. Now it is rejected up front, consistently.
    assert.throws(function () {
      walk([{type: 'Text', val: 'x'}], function before() {});
    }, /single AST node, not an array/);
    assert.throws(function () {
      walk([{type: 'Text', val: 'x'}], null, function after() {});
    }, /single AST node, not an array/);
  });

  test('replace.arrayAllowed is a strict boolean at the root', function () {
    walk({type: 'Text', val: 'x'}, function before(node, replace) {
      assert.strictEqual(
        replace.arrayAllowed,
        false,
        'arrayAllowed should be false (not undefined) when there is no parent',
      );
    });
  });
});

describe('replace.arrayAllowed truth table', function () {
  // Pins the string-compare logic that replaced the /^(Named)?Block$/ RegExp.
  function arrayAllowedFor(parent, child) {
    var seen;
    walk(parent, function before(node, replace) {
      if (node === child) seen = replace.arrayAllowed;
    });
    return seen;
  }

  test('child of a Block', function () {
    var child = {type: 'Text', val: 'x'};
    assert.strictEqual(
      arrayAllowedFor({type: 'Block', nodes: [child]}, child),
      true,
    );
  });

  test('child of a NamedBlock', function () {
    var child = {type: 'Text', val: 'x'};
    assert.strictEqual(
      arrayAllowedFor({type: 'NamedBlock', name: 'n', nodes: [child]}, child),
      true,
    );
  });

  test('IncludeFilter directly inside a RawInclude', function () {
    var child = {type: 'IncludeFilter', name: 'f', attrs: []};
    assert.strictEqual(
      arrayAllowedFor(
        {
          type: 'RawInclude',
          filters: [child],
          file: {type: 'FileReference'},
        },
        child,
      ),
      true,
    );
  });

  test('non-IncludeFilter child of a RawInclude is not array-allowed', function () {
    // RawInclude.file is a FileReference, which is not an IncludeFilter.
    var file = {type: 'FileReference'};
    assert.strictEqual(
      arrayAllowedFor({type: 'RawInclude', filters: [], file: file}, file),
      false,
    );
  });

  test('child of a Tag block is not array-allowed', function () {
    var child = {type: 'Text', val: 'x'};
    assert.strictEqual(
      arrayAllowedFor(
        {
          type: 'Tag',
          name: 'p',
          attrs: [],
          attributeBlocks: [],
          block: {type: 'Block', nodes: [child]},
        },
        child,
      ),
      // parent is the Block, so this is true; assert the grandparent Tag did
      // not leak through by checking the Block itself is not array-allowed.
      true,
    );
    var block = {type: 'Block', nodes: [child]};
    assert.strictEqual(
      arrayAllowedFor(
        {
          type: 'Tag',
          name: 'p',
          attrs: [],
          attributeBlocks: [],
          block: block,
        },
        block,
      ),
      false,
    );
  });
});

describe('malformed known nodes throw a located error, not a raw TypeError', function () {
  var cases = [
    [{type: 'Block', nodes: null}, /Malformed Block node/],
    [{type: 'NamedBlock', name: 'x', nodes: null}, /Malformed NamedBlock node/],
    [
      {type: 'Include', block: null, file: {type: 'FileReference'}},
      /Malformed Include node/,
    ],
    [
      {type: 'Include', block: {type: 'Block', nodes: []}, file: null},
      /Malformed Include node/,
    ],
    [{type: 'Extends', file: null}, /Malformed Extends node/],
    [
      {type: 'RawInclude', filters: null, file: {type: 'FileReference'}},
      /Malformed RawInclude node/,
    ],
    [{type: 'Footnotes', definitions: null}, /Malformed Footnotes node/],
  ];
  cases.forEach(function (entry) {
    var node = entry[0];
    var pattern = entry[1];
    test(node.type + ' with a malformed field', function () {
      var err;
      try {
        walk(node, function before() {});
      } catch (e) {
        err = e;
      }
      assert(err, 'expected an error to be thrown');
      assert(
        pattern.test(err.message),
        'expected ' + pattern + ' but got: ' + err.message,
      );
      // It must be the friendly located error, never a bare TypeError.
      assert(
        !(err instanceof TypeError),
        'should not surface a raw TypeError, got: ' + err.message,
      );
    });
  });
});

describe('array replacement re-walk fates (documented contract)', function () {
  test('replace([...]) in after inserts nodes but does NOT re-walk them', function () {
    var seen = [];
    walk(
      {type: 'Block', nodes: [{type: 'Text', val: 'x'}]},
      function before(node) {
        seen.push('before ' + (node.val || node.type));
      },
      function after(node, replace) {
        seen.push('after ' + (node.val || node.type));
        if (node.val === 'x') {
          replace([
            {type: 'Text', val: 'y'},
            {type: 'Text', val: 'z'},
          ]);
        }
      },
    );
    // y and z are spliced in but never visited by before/after.
    assert(
      !seen.includes('before y') && !seen.includes('before z'),
      'after-inserted nodes must not be re-walked: ' + JSON.stringify(seen),
    );
  });

  test('replace([...]) in before followed by return false inserts nodes un-walked', function () {
    var seen = [];
    var ast = walk(
      {type: 'Block', nodes: [{type: 'Text', val: 'x'}]},
      function before(node, replace) {
        seen.push('before ' + (node.val || node.type));
        if (node.val === 'x') {
          replace([
            {type: 'Text', val: 'y'},
            {type: 'Text', val: 'z'},
          ]);
          return false;
        }
      },
    );
    assert.deepStrictEqual(ast.nodes, [
      {type: 'Text', val: 'y'},
      {type: 'Text', val: 'z'},
    ]);
    // y and z must NOT be walked because before returned false.
    assert(
      !seen.includes('before y') && !seen.includes('before z'),
      'before+return false must not re-walk the inserted array: ' +
        JSON.stringify(seen),
    );
  });
});
