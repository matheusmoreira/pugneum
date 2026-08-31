'use strict';

var assert = require('node:assert/strict');
var {describe, test} = require('node:test');
var lex = require('pugneum-lexer');
var parse = require('pugneum-parser');
var walk = require('../');

function plainAST(ast) {
  return JSON.parse(JSON.stringify(ast));
}

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
  assert.deepStrictEqual(plainAST(ast), plainAST(parse(lex('.my-class bar'))));
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

    assert.deepStrictEqual(plainAST(ast), {
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
      plainAST(ast),
      plainAST(parse(lex('include:filter3:filter4 file'))),
    );
  });

  test('rejects an array in a non-list child without mutating it', function () {
    var text = {type: 'Text', val: 'content'};
    var block = {type: 'Block', nodes: [text]};
    var tag = {type: 'Tag', name: 'p', attrs: [], block: block};
    var callbackHits = 0;

    assert.throws(
      function () {
        walk(tag, function (node, replace) {
          if (node !== block) return;
          callbackHits++;
          assert.strictEqual(replace.arrayAllowed, false);
          replace([]);
        });
      },
      {
        name: 'Error',
        message:
          'replace() can only be called with an array if the last parent is a Block or NamedBlock',
      },
    );
    assert.strictEqual(callbackHits, 1);
    assert.strictEqual(tag.block, block);
    assert.strictEqual(block.nodes[0], text);
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
  var tag = {type: 'Tag', name: 'p', attrs: [], block: innerBlock};
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

test('a shared dependency is walked once per reference with local ancestry', function () {
  var dependencyText = {type: 'Text', val: 'shared'};
  var dependency = {type: 'Block', nodes: [dependencyText]};
  var left = {type: 'FileReference', path: 'left.pg', ast: dependency};
  var right = {type: 'FileReference', path: 'right.pg', ast: dependency};
  var root = {type: 'Block', nodes: [left, right]};
  var parents = [];
  var options = {includeDependencies: true, parents: parents};
  var dependencyParents = [];

  walk(
    root,
    function before(node) {
      if (node !== dependencyText) return;
      dependencyParents.push(
        parents.map(function (parent) {
          return parent.path || parent.type;
        }),
      );
    },
    options,
  );

  assert.deepStrictEqual(dependencyParents, [
    ['Block', 'left.pg', 'Block'],
    ['Block', 'right.pg', 'Block'],
  ]);
  assert.deepStrictEqual(parents, []);
});

test('dependency hook failures restore the caller parent seed', function () {
  var dependencyText = {type: 'Text', val: 'dependency'};
  var dependency = {type: 'Block', nodes: [dependencyText]};
  var file = {type: 'FileReference', path: 'dependency.pg', ast: dependency};
  var root = {type: 'Block', nodes: [file]};
  var seed = {type: 'Comment', val: 'seed', buffer: false};
  var parents = [seed];
  var options = {includeDependencies: true, parents: parents};
  var callbackHits = 0;

  assert.throws(
    function () {
      walk(
        root,
        function before(node) {
          if (node !== dependencyText) return;
          callbackHits++;
          assert.deepStrictEqual(parents, [dependency, file, root, seed]);
          throw new Error('dependency hook failure');
        },
        options,
      );
    },
    {message: 'dependency hook failure'},
  );
  assert.strictEqual(callbackHits, 1);
  assert.deepStrictEqual(parents, [seed]);
});

describe('child dispatch coverage', function () {
  function text(value) {
    return {type: 'Text', val: value};
  }

  function block(value) {
    return {type: 'Block', nodes: [text(value)]};
  }

  function label(node) {
    if (node.val) return node.type + ':' + node.val;
    if (node.name) return node.type + ':' + node.name;
    return node.type;
  }

  var cases = [
    {
      name: 'ReferenceLink.block',
      node: {
        type: 'ReferenceLink',
        name: 'docs',
        attrs: [],
        block: block('link text'),
      },
      events: [
        'before ReferenceLink:docs',
        'before Block',
        'before Text:link text',
        'after Text:link text',
        'after Block',
        'after ReferenceLink:docs',
      ],
    },
    {
      name: 'ReferenceImage.block',
      node: {
        type: 'ReferenceImage',
        name: 'logo',
        attrs: [],
        block: block('alt text'),
      },
      events: [
        'before ReferenceImage:logo',
        'before Block',
        'before Text:alt text',
        'after Text:alt text',
        'after Block',
        'after ReferenceImage:logo',
      ],
    },
    {
      name: 'FootnoteRef.block when present',
      node: {type: 'FootnoteRef', name: 'note', block: block('fallback')},
      events: [
        'before FootnoteRef:note',
        'before Block',
        'before Text:fallback',
        'after Text:fallback',
        'after Block',
        'after FootnoteRef:note',
      ],
    },
    {
      name: 'FootnoteRef.block when absent',
      node: {type: 'FootnoteRef', name: 'note'},
      events: ['before FootnoteRef:note', 'after FootnoteRef:note'],
    },
    {
      name: 'Footnotes definition blocks in source order',
      node: {
        type: 'Footnotes',
        definitions: [
          {name: 'one', block: block('first')},
          {name: 'two', block: block('second')},
        ],
      },
      events: [
        'before Footnotes',
        'before Block',
        'before Text:first',
        'after Text:first',
        'after Block',
        'before Block',
        'before Text:second',
        'after Text:second',
        'after Block',
        'after Footnotes',
      ],
    },
    {
      name: 'Given.block',
      node: {type: 'Given', name: 'sidebar', block: block('given text')},
      events: [
        'before Given:sidebar',
        'before Block',
        'before Text:given text',
        'after Text:given text',
        'after Block',
        'after Given:sidebar',
      ],
    },
  ];

  cases.forEach(function (testCase) {
    test(testCase.name, function () {
      var events = [];
      var childBlocks = [];
      if (testCase.node.block) childBlocks.push(testCase.node.block);
      if (testCase.node.definitions) {
        childBlocks.push(
          ...testCase.node.definitions.map(function (definition) {
            return definition.block;
          }),
        );
      }

      var result = walk(
        testCase.node,
        function before(node) {
          events.push('before ' + label(node));
        },
        function after(node) {
          events.push('after ' + label(node));
        },
      );

      assert.strictEqual(result, testCase.node);
      assert.deepStrictEqual(events, testCase.events);
      if (testCase.node.block) {
        assert.strictEqual(testCase.node.block, childBlocks[0]);
      }
      if (testCase.node.definitions) {
        testCase.node.definitions.forEach(function (definition, index) {
          assert.strictEqual(definition.block, childBlocks[index]);
        });
      }
    });
  });
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
  var beforeRan = false;
  assert.throws(
    function () {
      walk({type: 'UnknownNodeType', line: 1}, function before() {
        beforeRan = true;
      });
    },
    function (err) {
      return (
        err.name === 'ASTValidationError' &&
        err.code === 'INVALID_AST' &&
        err.kind === 'unknown-type' &&
        err.path === '$' &&
        err.line === 1 &&
        err.message.includes("unknown node type 'UnknownNodeType'")
      );
    },
  );
  assert.strictEqual(beforeRan, false);
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

    [-1, 1.5, Infinity, '2', walk.MAX_AST_DEPTH + 1].forEach(
      function (maxDepth) {
        assert.throws(() => walk({type: 'Text', val: 'x'}, null, {maxDepth}), {
          name: 'TypeError',
          message:
            'options.maxDepth must be an integer from 0 through ' +
            walk.MAX_AST_DEPTH,
        });
      },
    );
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
      arrayAllowedFor(
        {type: 'NamedBlock', name: 'n', mode: 'replace', nodes: [child]},
        child,
      ),
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
          file: {type: 'FileReference', path: 'file.pg'},
        },
        child,
      ),
      true,
    );
  });

  test('non-IncludeFilter child of a RawInclude is not array-allowed', function () {
    // RawInclude.file is a FileReference, which is not an IncludeFilter.
    var file = {type: 'FileReference', path: 'file.pg'};
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

describe('malformed known nodes fail before hooks with exact location', function () {
  function block() {
    return {type: 'Block', nodes: []};
  }

  function file() {
    return {type: 'FileReference', path: 'file.pg'};
  }

  var cases = [
    ['Block.nodes', {type: 'Block', nodes: null}, '$.nodes'],
    [
      'BlockComment.block',
      {type: 'BlockComment', val: '', buffer: false, block: null},
      '$.block',
    ],
    ['Comment.buffer', {type: 'Comment', val: '', buffer: 'yes'}, '$.buffer'],
    ['Extends.file', {type: 'Extends', file: null}, '$.file'],
    ['FileReference.path', {type: 'FileReference', path: null}, '$.path'],
    [
      'Filter.block',
      {type: 'Filter', name: 'x', attrs: [], block: 1},
      '$.block',
    ],
    ['FootnoteRef.name', {type: 'FootnoteRef', name: null}, '$.name'],
    [
      'Footnotes.definitions member',
      {type: 'Footnotes', definitions: [null]},
      '$.definitions[0]',
    ],
    ['Given.block', {type: 'Given', name: 'x', block: null}, '$.block'],
    [
      'Include.block type',
      {type: 'Include', block: {type: 'Text', val: ''}, file: file()},
      '$.block',
    ],
    [
      'IncludeFilter.attrs',
      {type: 'IncludeFilter', name: 'x', attrs: null},
      '$.attrs',
    ],
    [
      'InterpolatedTag.expr',
      {type: 'InterpolatedTag', expr: null, attrs: [], block: block()},
      '$.expr',
    ],
    [
      'Mixin definition block',
      {type: 'Mixin', name: 'x', call: false, args: [], block: null},
      '$.block',
    ],
    [
      'NamedBlock.mode',
      {type: 'NamedBlock', name: 'x', mode: 'bad', nodes: []},
      '$.mode',
    ],
    [
      'RawInclude.filters member',
      {type: 'RawInclude', filters: [null], file: file()},
      '$.filters[0]',
    ],
    [
      'ReferenceImage.block',
      {type: 'ReferenceImage', name: 'x', attrs: [], block: null},
      '$.block',
    ],
    [
      'ReferenceLink.attrs',
      {type: 'ReferenceLink', name: 'x', attrs: null, block: block()},
      '$.attrs',
    ],
    [
      'References.definitions member',
      {type: 'References', definitions: [null]},
      '$.definitions[0]',
    ],
    ['Tag.block', {type: 'Tag', name: 'p', attrs: [], block: null}, '$.block'],
    [
      'Block.isFootnoteBody',
      {type: 'Block', nodes: [], isFootnoteBody: 'yes'},
      '$.isFootnoteBody',
    ],
    ['Text.val', {type: 'Text', val: null}, '$.val'],
    [
      'Text.isFootnoteSeparator',
      {type: 'Text', val: ' ', isFootnoteSeparator: 1},
      '$.isFootnoteSeparator',
    ],
    ['Variable.name', {type: 'Variable', name: null}, '$.name'],
  ];
  cases.forEach(function (entry) {
    test(entry[0], function () {
      var node = Object.assign(entry[1], {
        filename: 'bad.pg',
        line: 12,
        column: 7,
      });
      var beforeRan = false;
      var options = {};
      assert.throws(
        () =>
          walk(
            node,
            function before() {
              beforeRan = true;
              return false;
            },
            null,
            options,
          ),
        function (err) {
          assert.strictEqual(err.name, 'ASTValidationError');
          assert.strictEqual(err.code, 'INVALID_AST');
          assert.strictEqual(err.kind, 'shape');
          assert.strictEqual(err.path, entry[2]);
          assert.strictEqual(err.filename, 'bad.pg');
          assert.strictEqual(err.line, 12);
          assert.strictEqual(err.column, 7);
          assert.ok(err.message.includes('bad.pg:12:7'));
          assert.ok(err.message.includes(entry[2]));
          return true;
        },
      );
      assert.strictEqual(beforeRan, false);
      assert.deepStrictEqual(options, {});
    });
  });

  test('marker-only node types remain valid', function () {
    ['MixinBlock', 'Toc', 'YieldBlock'].forEach(function (type) {
      var ast = {type};
      assert.strictEqual(walk(ast), ast);
    });
  });
});

test('preflight follows only dependency ASTs selected for traversal', function () {
  var invalidDependency = {type: 'Block', nodes: [null]};
  var root = {
    type: 'Block',
    nodes: [
      {type: 'FileReference', path: 'dependency.pg', ast: invalidDependency},
    ],
  };

  assert.strictEqual(walk(root), root);
  assert.throws(
    () => walk(root, null, {includeDependencies: true}),
    (err) =>
      err.code === 'INVALID_AST' &&
      err.kind === 'shape' &&
      err.path === '$.nodes[0].ast.nodes[0]',
  );
});

describe('traversal depth and cycles', function () {
  function nestedBlocks(depth) {
    var ast = {type: 'Text', val: 'end'};
    while (depth-- > 0) ast = {type: 'Block', nodes: [ast]};
    return ast;
  }

  test('a configurable total edge boundary passes at the limit and fails one deeper', function () {
    assert.strictEqual(
      walk(nestedBlocks(2), null, {maxDepth: 2}).type,
      'Block',
    );

    var parents = [{type: 'Comment', val: 'seed', buffer: false}];
    var options = {maxDepth: 2, parents};
    var beforeRan = false;
    var tooDeep = nestedBlocks(3);
    Object.assign(tooDeep.nodes[0].nodes[0].nodes[0], {
      filename: 'deep.pg',
      line: 9,
      column: 4,
    });
    assert.throws(
      () =>
        walk(
          tooDeep,
          function before() {
            beforeRan = true;
          },
          options,
        ),
      function (err) {
        assert.strictEqual(err.code, 'INVALID_AST');
        assert.strictEqual(err.kind, 'depth');
        assert.strictEqual(err.path, '$.nodes[0].nodes[0].nodes[0]');
        assert.strictEqual(err.filename, 'deep.pg');
        assert.strictEqual(err.line, 9);
        assert.strictEqual(err.column, 4);
        assert.ok(err.message.includes('deep.pg:9:4'));
        return true;
      },
    );
    assert.strictEqual(beforeRan, false);
    assert.deepStrictEqual(parents, [
      {type: 'Comment', val: 'seed', buffer: false},
    ]);
  });

  test('syntax and dependency edges share one depth budget', function () {
    var dependency = nestedBlocks(1);
    var root = {
      type: 'Block',
      nodes: [
        {
          type: 'Tag',
          name: 'p',
          attrs: [],
          block: {
            type: 'Block',
            nodes: [
              {
                type: 'FileReference',
                path: 'dependency.pg',
                ast: dependency,
              },
            ],
          },
        },
      ],
    };

    assert.throws(
      () =>
        walk(root, null, {
          includeDependencies: true,
          maxDepth: 4,
        }),
      (err) => err.code === 'INVALID_AST' && err.kind === 'depth',
    );
  });

  test('a two-root dependency cycle is rejected before hooks', function () {
    var a = {
      type: 'Block',
      nodes: [],
      filename: 'a.pg',
      line: 1,
      column: 1,
    };
    var b = {type: 'Block', nodes: []};
    a.nodes.push({type: 'FileReference', path: 'b.pg', ast: b});
    b.nodes.push({type: 'FileReference', path: 'a.pg', ast: a});
    var beforeRan = false;

    assert.strictEqual(walk(a), a);
    assert.throws(
      () =>
        walk(
          a,
          function before() {
            beforeRan = true;
          },
          {includeDependencies: true},
        ),
      function (err) {
        assert.strictEqual(err.code, 'INVALID_AST');
        assert.strictEqual(err.kind, 'cycle');
        assert.strictEqual(err.path, '$.nodes[0].ast.nodes[0].ast');
        assert.strictEqual(err.filename, 'a.pg');
        assert.strictEqual(err.line, 1);
        assert.strictEqual(err.column, 1);
        assert.ok(err.message.includes('a.pg:1:1'));
        return true;
      },
    );
    assert.strictEqual(beforeRan, false);
  });

  test('replacement depth is charged from its current attachment point', function () {
    var original = {type: 'Text', val: 'original'};
    var ast = {type: 'Block', nodes: [original]};
    var replacement = {
      type: 'Tag',
      name: 'p',
      attrs: [],
      block: nestedBlocks(1),
    };

    assert.throws(
      () =>
        walk(
          ast,
          function before(node, replace) {
            if (node === original) replace(replacement);
          },
          {maxDepth: 2},
        ),
      (err) => err.code === 'INVALID_AST' && err.kind === 'depth',
    );
    assert.strictEqual(ast.nodes[0], original);
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
    var original = {type: 'Text', val: 'x'};
    var first = {type: 'Text', val: 'y'};
    var second = {type: 'Text', val: 'z'};
    var ast = {type: 'Block', nodes: [original]};
    var seen = [];
    var result = walk(
      ast,
      function before(node) {
        seen.push('before ' + (node.val || node.type));
      },
      function after(node, replace) {
        seen.push('after ' + (node.val || node.type));
        if (node.val === 'x') {
          replace([first, second]);
        }
      },
    );

    assert.strictEqual(result, ast);
    assert.deepStrictEqual(ast.nodes, [first, second]);
    assert.strictEqual(ast.nodes[0], first);
    assert.strictEqual(ast.nodes[1], second);
    assert.deepStrictEqual(seen, [
      'before Block',
      'before x',
      'after x',
      'after Block',
    ]);
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
