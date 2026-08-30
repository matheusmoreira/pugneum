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

test('README strong-to-text example preserves complete parser nodes', function () {
  var ast = parse(lex('p abc #(strong NO)\nstrong on its own line'));

  ast = walk(ast, function before(node, replace) {
    if (node.type === 'Tag' && node.name === 'strong') {
      var children = node.block.nodes;
      if (children.length === 1 && children[0].type === 'Text') {
        replace(children[0]);
      }
    }
  });

  var strongTags = 0;
  var textValues = [];
  walk(ast, function inspect(node) {
    if (node.type === 'Tag' && node.name === 'strong') strongTags++;
    if (node.type === 'Text' && node.val) textValues.push(node.val);
  });
  assert.strictEqual(strongTags, 0);
  assert.deepStrictEqual(textValues, ['abc ', 'NO', 'on its own line']);
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

test('before returning false prunes only that node and suppresses its after', function () {
  var visited = [];
  walk(
    parse(lex('div\n  p Hidden\nspan Visible')),
    function before(node) {
      visited.push('before ' + node.type + ':' + (node.name || node.val || ''));
      if (node.type === 'Tag' && node.name === 'div') {
        return false;
      }
    },
    function after(node) {
      visited.push('after ' + node.type + ':' + (node.name || node.val || ''));
    },
  );
  assert(!visited.includes('before Text:Hidden'));
  assert(!visited.includes('after Tag:div'));
  assert(
    visited.includes('before Tag:span'),
    'the sibling must still be walked',
  );
  assert(visited.includes('before Text:Visible'));
  assert(visited.includes('after Tag:span'));
});

test('all non-false before returns and every after return are ignored', function () {
  [undefined, null, true, 0, '', {}, []].forEach(function (beforeReturn) {
    var ast = {type: 'Block', nodes: [{type: 'Text', val: 'x'}]};
    var events = [];
    var result = walk(
      ast,
      function before(node) {
        events.push('before ' + node.type);
        return beforeReturn;
      },
      function after(node) {
        events.push('after ' + node.type);
        return {type: 'Text', val: 'ignored'};
      },
    );
    assert.strictEqual(result, ast);
    assert.deepStrictEqual(events, [
      'before Block',
      'before Text',
      'after Text',
      'after Block',
    ]);
  });
});

test('the return value preserves identity unless the root is replaced', function () {
  var original = {type: 'Text', val: 'original'};
  assert.strictEqual(walk(original), original);

  var replacement = {type: 'Text', val: 'replacement'};
  var result = walk(original, function before(node, replace) {
    if (node === original) {
      replace(replacement);
      return false;
    }
  });
  assert.strictEqual(result, replacement);
  assert.deepStrictEqual(original, {type: 'Text', val: 'original'});
});

test('parents is nearest-first during hooks and restored afterward', function () {
  var text = {type: 'Text', val: 'x'};
  var innerBlock = {type: 'Block', nodes: [text]};
  var tag = {type: 'Tag', name: 'p', block: innerBlock};
  var root = {type: 'Block', nodes: [tag]};
  var seed = {type: 'Comment', val: 'seed', buffer: false};
  var parents = [seed];
  var options = {parents: parents};

  walk(
    root,
    function before(node) {
      if (node === text) {
        assert.deepStrictEqual(options.parents, [innerBlock, tag, root, seed]);
      }
    },
    function after(node) {
      if (node === text) {
        assert.deepStrictEqual(options.parents, [innerBlock, tag, root, seed]);
      }
      if (node === tag) assert.deepStrictEqual(options.parents, [root, seed]);
    },
    options,
  );

  assert.strictEqual(options.parents, parents);
  assert.deepStrictEqual(parents, [seed]);
});

test('frozen and non-extensible options preserve parent-sensitive replacement', function () {
  var optionFactories = [Object.freeze, Object.seal, Object.preventExtensions];

  optionFactories.forEach(function (makeImmutable) {
    var options = makeImmutable({});
    var text = {type: 'Text', val: 'x'};
    var ast = {type: 'Block', nodes: [text]};

    walk(
      ast,
      function before(node, replace) {
        if (node === text) {
          assert.strictEqual(replace.arrayAllowed, true);
          replace([]);
          return false;
        }
      },
      options,
    );

    assert.deepStrictEqual(ast.nodes, []);
    assert.strictEqual(Object.hasOwn(options, 'parents'), false);
  });
});

test('immutable parent arrays are read-only ancestry seeds', function () {
  var arrayFactories = [Object.freeze, Object.seal, Object.preventExtensions];

  arrayFactories.forEach(function (makeImmutable) {
    var seed = {type: 'Comment', val: 'seed', buffer: false};
    var parents = makeImmutable([seed]);
    var options = Object.freeze({parents});
    var text = {type: 'Text', val: 'x'};
    var ast = {type: 'Block', nodes: [text]};

    walk(
      ast,
      function before(node, replace) {
        if (node === text) {
          assert.strictEqual(replace.arrayAllowed, true);
          replace([]);
          return false;
        }
      },
      options,
    );

    assert.deepStrictEqual(ast.nodes, []);
    assert.deepStrictEqual(parents, [seed]);
  });
});

test('reentrant walks sharing options keep their parent stacks isolated', function () {
  var seed = {type: 'Comment', val: 'seed', buffer: false};
  var parents = [seed];
  var options = {parents};
  var outerText = {type: 'Text', val: 'outer'};
  var outer = {type: 'Block', nodes: [outerText]};
  var inner = {type: 'Text', val: 'inner'};

  walk(
    outer,
    function outerBefore(node) {
      if (node !== outerText) return;
      assert.deepStrictEqual(parents, [outer, seed]);
      walk(
        inner,
        function innerBefore(innerNode, replace) {
          if (innerNode === inner) {
            assert.strictEqual(replace.arrayAllowed, false);
          }
        },
        options,
      );
      assert.deepStrictEqual(parents, [outer, seed]);
    },
    options,
  );

  assert.deepStrictEqual(parents, [seed]);
});

test('includeDependencies follows only a preloaded FileReference.ast', function () {
  var unloaded = {type: 'FileReference', path: 'unloaded.pg'};
  var dependencyText = {type: 'Text', val: 'dependency'};
  var dependency = {type: 'Block', nodes: [dependencyText]};
  var loaded = {type: 'FileReference', path: 'loaded.pg', ast: dependency};
  var root = {type: 'Block', nodes: [unloaded, loaded]};
  var sawDependency = false;

  walk(root, function before(node) {
    if (node === dependencyText) sawDependency = true;
  });
  assert.strictEqual(sawDependency, false);

  var options = {includeDependencies: true, parents: []};
  walk(
    root,
    function before(node) {
      if (node === dependencyText) {
        sawDependency = true;
        assert.deepStrictEqual(options.parents, [dependency, loaded, root]);
      }
    },
    options,
  );
  assert.strictEqual(sawDependency, true);
  assert.ok(!Object.hasOwn(unloaded, 'ast'));
  assert.deepStrictEqual(options.parents, []);
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
  test('an array in the three-argument after slot is rejected before pruning', function () {
    var beforeRan = false;
    assert.throws(
      function () {
        walk(
          {type: 'Text', val: 'x'},
          function before() {
            beforeRan = true;
            return false;
          },
          [function after() {}],
        );
      },
      {
        name: 'TypeError',
        message: 'after must be a function, null, or undefined',
      },
    );
    assert.strictEqual(beforeRan, false);
  });

  test('invalid hooks fail before traversal or options mutation', function () {
    var invalidHooks = [false, 0, '', {}, []];

    invalidHooks.forEach(function (invalidBefore) {
      var ast = {type: 'Text', val: 'original'};
      var options = {};
      assert.throws(() => walk(ast, invalidBefore, options), {
        name: 'TypeError',
        message: 'before must be a function, null, or undefined',
      });
      assert.deepStrictEqual(ast, {type: 'Text', val: 'original'});
      assert.deepStrictEqual(options, {});
    });

    invalidHooks.forEach(function (invalidAfter) {
      var ast = {type: 'Text', val: 'original'};
      var options = {};
      var beforeRan = false;
      assert.throws(
        () =>
          walk(
            ast,
            function before(node) {
              beforeRan = true;
              node.val = 'mutated';
            },
            invalidAfter,
            options,
          ),
        {
          name: 'TypeError',
          message: 'after must be a function, null, or undefined',
        },
      );
      assert.strictEqual(beforeRan, false);
      assert.deepStrictEqual(ast, {type: 'Text', val: 'original'});
      assert.deepStrictEqual(options, {});
    });
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
  test('invalid roots fail before hooks or options mutation', function () {
    var invalidRoots = [
      null,
      undefined,
      false,
      0,
      'Text',
      {},
      {type: null},
      {type: 1},
      [{type: 'Text', val: 'x'}],
    ];

    invalidRoots.forEach(function (invalidRoot) {
      var beforeRan = false;
      var options = {};
      assert.throws(
        () =>
          walk(
            invalidRoot,
            function before() {
              beforeRan = true;
            },
            null,
            options,
          ),
        {
          name: 'TypeError',
          message: 'ast must be a single node object with a string type',
        },
      );
      assert.strictEqual(beforeRan, false);
      assert.deepStrictEqual(options, {});
    });
  });

  test('invalid options containers fail before traversal', function () {
    var invalidOptions = [null, false, 0, '', [], function options() {}];

    invalidOptions.forEach(function (invalidOption) {
      var ast = {type: 'Text', val: 'original'};
      var beforeRan = false;
      assert.throws(
        () =>
          walk(
            ast,
            function before(node) {
              beforeRan = true;
              node.val = 'mutated';
            },
            null,
            invalidOption,
          ),
        {
          name: 'TypeError',
          message: 'options must be a non-null, non-array object or undefined',
        },
      );
      assert.strictEqual(beforeRan, false);
      assert.deepStrictEqual(ast, {type: 'Text', val: 'original'});
    });

    var ast = {type: 'Text', val: 'x'};
    assert.strictEqual(walk(ast, null, null, undefined), ast);
  });

  test('option fields have exact public types', function () {
    [null, 0, 1, 'false', {}, []].forEach(function (includeDependencies) {
      var options = Object.freeze({includeDependencies});
      assert.throws(() => walk({type: 'Text', val: 'x'}, null, options), {
        name: 'TypeError',
        message: 'options.includeDependencies must be a boolean or undefined',
      });
    });

    [false, true].forEach(function (includeDependencies) {
      var ast = {type: 'Text', val: 'x'};
      assert.strictEqual(walk(ast, null, {includeDependencies}), ast);
    });

    [null, false, 0, '', {}].forEach(function (parents) {
      var options = Object.freeze({parents});
      assert.throws(() => walk({type: 'Text', val: 'x'}, null, options), {
        name: 'TypeError',
        message: 'options.parents must be an array or undefined',
      });
    });
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

describe('replacement validation', function () {
  test('rejects a malformed scalar before a pruned replacement mutates the tree', function () {
    var original = {type: 'Text', val: 'x'};
    var ast = {type: 'Block', nodes: [original]};

    assert.throws(function () {
      walk(ast, function before(node, replace) {
        if (node === original) {
          replace({type: 'Block', nodes: [null]});
          return false;
        }
      });
    }, /invalid AST|expected a node|nodes\[0\]/i);
    assert.strictEqual(ast.nodes[0], original);
  });

  test('rejects a mixed array atomically when after replacements are not re-walked', function () {
    var original = {type: 'Text', val: 'x'};
    var ast = {type: 'Block', nodes: [original]};

    assert.throws(function () {
      walk(ast, null, function after(node, replace) {
        if (node === original) {
          replace([{type: 'Text', val: 'valid'}, null]);
        }
      });
    }, /invalid AST|expected a node|\[1\]/i);
    assert.deepStrictEqual(ast.nodes, [original]);
  });

  test('a caller cannot make a root array replacement legal by rewriting the public flag', function () {
    var root = {type: 'Text', val: 'x'};
    var result = walk(root, function before(node, replace) {
      if (node !== root) return;
      try {
        replace.arrayAllowed = true;
      } catch (_err) {
        // A read-only property may reject the assignment in strict mode.
      }
      assert.throws(
        () => replace([{type: 'Text', val: 'bypass'}]),
        /array.*Block|array replacement/i,
      );
      return false;
    });
    assert.strictEqual(result, root);
  });

  test('rejects a cyclic replacement before it becomes observable', function () {
    var original = {type: 'Text', val: 'x'};
    var ast = {type: 'Block', nodes: [original]};
    var cyclic = {type: 'Block', nodes: []};
    cyclic.nodes.push(cyclic);

    assert.throws(function () {
      walk(ast, function before(node, replace) {
        if (node === original) {
          replace(cyclic);
          return false;
        }
      });
    }, /cycle|cyclic/i);
    assert.strictEqual(ast.nodes[0], original);
  });

  test('rejects an ancestor replacement that would create a cycle on insertion', function () {
    var original = {type: 'Text', val: 'x'};
    var ast = {type: 'Block', nodes: [original]};

    assert.throws(function () {
      walk(ast, function before(node, replace) {
        if (node === original) {
          replace(ast);
          return false;
        }
      });
    }, /owned|ancestor|cycle/i);
    assert.strictEqual(ast.nodes[0], original);
  });

  test('valid scalar replacement at the root remains supported', function () {
    var root = {type: 'Text', val: 'x'};
    var replacement = {type: 'Text', val: 'y'};
    var result = walk(root, function before(node, replace) {
      if (node === root) {
        replace(replacement);
        return false;
      }
    });
    assert.strictEqual(result, replacement);
  });
});

describe('validate()', function () {
  test('publishes a versioned schema and validates parser output', function () {
    var ast = parse(lex('p valid'));
    assert.strictEqual(walk.AST_SCHEMA_VERSION, 1);
    assert.strictEqual(walk.MAX_AST_DEPTH, 512);
    assert.strictEqual(walk.validate(ast), ast);
  });

  test('accepts aliases by default and can enforce single-owner tree data', function () {
    var shared = {type: 'Text', val: 'x'};
    var ast = {type: 'Block', nodes: [shared, shared]};
    assert.strictEqual(walk.validate(ast), ast);
    assert.throws(
      () => walk.validate(ast, {allowAliases: false}),
      (err) => err.code === 'INVALID_AST' && err.kind === 'alias',
    );
  });

  test('enforces an explicit structural depth without recursive validation', function () {
    var ast = {type: 'Text', val: 'end'};
    for (var i = 0; i < walk.MAX_AST_DEPTH + 1; i++) {
      ast = {type: 'Block', nodes: [ast]};
    }
    assert.throws(
      () => walk.validate(ast, {maxDepth: walk.MAX_AST_DEPTH}),
      (err) => err.code === 'INVALID_AST' && err.kind === 'depth',
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
  test('a large replacement array is spliced without an argument-count ceiling', function () {
    var original = {type: 'Text', val: 'original'};
    var replacements = Array.from({length: 150000}, function (_, index) {
      return {type: 'Text', val: String(index)};
    });
    var ast = walk(
      {type: 'Block', nodes: [original]},
      function before(node, replace) {
        if (node === original) {
          replace(replacements);
          return false;
        }
      },
    );

    assert.strictEqual(ast.nodes.length, replacements.length);
    assert.strictEqual(ast.nodes[0], replacements[0]);
    assert.strictEqual(ast.nodes[74999], replacements[74999]);
    assert.strictEqual(ast.nodes[149999], replacements[149999]);
  });

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
