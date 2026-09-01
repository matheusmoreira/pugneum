const walk = require('pugneum-walker');
const diagnostics = require('./diagnostics');
const nodes = require('./nodes');

const DEFAULT_MAX_DEPTH = 256;

function assemble(ast, options) {
  return linkInner(ast, options, createState(options), 0);
}

function validateRoot(ast, sources) {
  if (
    ast === null ||
    typeof ast !== 'object' ||
    Array.isArray(ast) ||
    ast.type !== 'Block'
  ) {
    diagnostics.error(
      'INVALID_AST',
      'The top level element should always be a block',
      ast,
      sources,
    );
  }
  if (!Array.isArray(ast.nodes)) {
    diagnostics.error(
      'INVALID_AST',
      'The top level block should always contain a nodes array',
      ast,
      sources,
    );
  }
}

// Inheritance bookkeeping is needed only while one tree is being assembled.
// Keep it off public AST nodes so the linked result remains a serializable tree
// instead of exposing a repeated ancestry graph through enumerable metadata.
function createState(options) {
  return {
    compilation: options.compilationContext,
    declaredBlocks: new WeakMap(),
    extendedTrees: new WeakSet(),
    maxDepth:
      options.maxLinkDepth === undefined
        ? DEFAULT_MAX_DEPTH
        : options.maxLinkDepth,
  };
}

function linkInner(ast, options, state, depth) {
  const sources = diagnostics.sources(options);
  validateRoot(ast, sources);
  // Each physical AST is copied at its ownership boundary. FileReference.ast
  // values stay deferred until their own linkInner call, so the same child AST
  // can safely be used at multiple include/extends sites without preserving an
  // alias between rendered occurrences.
  ast = cloneOwnedAst(ast, state, diagnostics.context(ast, sources));
  let extendsNode = null;
  if (ast.nodes.length) {
    const hasExtends = ast.nodes[0].type === 'Extends';
    checkExtendPosition(ast, hasExtends, sources);
    if (hasExtends) {
      extendsNode = ast.nodes[0];
      assertLinkEdge(depth, state.maxDepth, extendsNode, sources);
      ast.nodes.shift();
    }
  }
  ast = applyIncludes(ast, options, state, depth);
  const declaredBlocks = findDeclaredBlocks(ast);
  state.declaredBlocks.set(ast, declaredBlocks);
  if (extendsNode) {
    const declarations = [];
    const expectedBlocks = [];
    ast.nodes.forEach(function addNode(node) {
      if (node.type === 'NamedBlock') {
        expectedBlocks.push(node);
      } else if (node.type === 'Block') {
        node.nodes.forEach(addNode);
      } else if (node.type === 'Mixin' && node.call === false) {
        declarations.push(node);
      } else if (node.type === 'References') {
        declarations.push(node);
      } else {
        diagnostics.error(
          'UNEXPECTED_NODES_IN_EXTENDING_ROOT',
          'Only named blocks, mixins, and references can appear at the top level of an extending template',
          node,
          sources,
        );
      }
    });

    // Validate expected blocks BEFORE mutating parent via extend()
    const parent = linkInner(extendsNode.file.ast, options, state, depth + 1);
    const parentDeclaredBlocks = state.declaredBlocks.get(parent);
    for (const expectedBlock of expectedBlocks) {
      if (
        !Object.prototype.hasOwnProperty.call(
          parentDeclaredBlocks,
          expectedBlock.name,
        )
      ) {
        diagnostics.error(
          'UNEXPECTED_BLOCK',
          'Unexpected block ' + expectedBlock.name,
          expectedBlock,
          sources,
        );
      }
    }

    extend(parentDeclaredBlocks, ast, sources, state);
    parent.nodes = declarations.concat(parent.nodes);
    // Composition cloned payloads into the actual parent slots. Recompute the
    // authoritative map from that output tree so a later inheritance level
    // targets rendered occurrences, including newly introduced nested slots,
    // rather than detached override nodes or ancestry aliases.
    state.declaredBlocks.set(parent, findDeclaredBlocks(parent));
    state.extendedTrees.add(parent);
    return parent;
  }
  return ast;
}

function findDeclaredBlocks(ast) {
  const definitions = Object.create(null);
  forEachInheritanceBlock(ast, function (node) {
    if (node.mode === 'replace') {
      definitions[node.name] = definitions[node.name] || [];
      definitions[node.name].push(node);
    }
  });
  return definitions;
}

// NamedBlock is shared by template inheritance and mixin slots. Only blocks in
// document structure belong to inheritance: a Mixin owns its entire subtree.
// Within document structure, a same-named nested block is content of the outer
// override rather than another target. Discovery and merging both route through
// this helper so validation cannot accept a slot that composition will ignore.
function forEachInheritanceBlock(ast, visit) {
  const activeNames = new Set();
  const enteredNames = new WeakMap();
  walk(
    ast,
    function before(node) {
      if (node.type === 'Mixin') return false;
      if (node.type !== 'NamedBlock') return;
      if (activeNames.has(node.name)) return false;
      activeNames.add(node.name);
      enteredNames.set(node, node.name);
      visit(node);
    },
    function after(node) {
      const name = enteredNames.get(node);
      if (name !== undefined) activeNames.delete(name);
    },
  );
}

// Merge the child template's effective inheritance overrides into the parent's
// slots. `parentBlocks` maps each name directly to the current rendered block
// occurrences. forEachInheritanceBlock applies the same mixin-scope and
// nested-name rules used to construct that map.
function extend(parentBlocks, ast, sources, state) {
  forEachInheritanceBlock(ast, function (node) {
    const parentBlockList = parentBlocks[node.name] || [];
    if (!parentBlockList.length) return;
    parentBlockList.forEach(function (parentBlock) {
      // Every effective slot owns its occurrence. Later filters and document
      // resolution mutate subtrees, so sharing node.nodes here would process
      // one occurrence and merely alias the already-resolved result elsewhere.
      const children = cloneAst(
        node.nodes,
        undefined,
        false,
        state.compilation,
        diagnostics.context(node, sources),
        'materializing inheritance block ' + node.name,
      );
      switch (node.mode) {
        case 'append':
          parentBlock.nodes = parentBlock.nodes.concat(children);
          break;
        case 'prepend':
          parentBlock.nodes = children.concat(parentBlock.nodes);
          break;
        case 'replace':
          parentBlock.nodes = children;
          break;
        default:
          diagnostics.error(
            'UNKNOWN_BLOCK_MODE',
            "Unknown block mode '" + node.mode + "'",
            node,
            sources,
          );
      }
    });
  });
}

function assertLinkEdge(depth, maxDepth, node, sources) {
  if (depth >= maxDepth) {
    diagnostics.error(
      'LINK_DEPTH_EXCEEDED',
      `Template inheritance/include chain exceeds maximum depth of ${maxDepth}`,
      node,
      sources,
    );
  }
}

function normalizeTextNewlines(value) {
  return value.replace(/\r\n|\r/g, '\n');
}

function applyIncludes(ast, options, state, depth) {
  // RawInclude is handled in `before` (its content is a leaf string, nothing
  // below it to descend into). Include is handled in `after` so the includer's
  // passed-in `node.block` is fully walked before being yielded into the linked
  // child subtree.
  return walk(
    ast,
    function before(node, replace) {
      if (node.type === 'RawInclude' && node.filters.length === 0) {
        replace.final(nodes.text(node, normalizeTextNewlines(node.file.str)));
      }
    },
    function after(node, replace) {
      if (node.type === 'Include') {
        assertLinkEdge(
          depth,
          state.maxDepth,
          node,
          diagnostics.sources(options),
        );
        // linkInner, not the public entry: the included subtree is linted as
        // part of the final assembled tree, not once per include depth.
        let childAST = linkInner(node.file.ast, options, state, depth + 1);
        if (state.extendedTrees.has(childAST)) {
          childAST = removeBlocks(childAST);
        }
        replace.final(applyYield(childAST, node.block, node, options));
      }
    },
  );
}

function removeBlocks(ast) {
  return walk(ast, function (node, replace) {
    // Mixin declarations/calls own their NamedBlock slots. Only flatten the
    // inheritance wrappers of the included, already-extended document.
    if (node.type === 'Mixin') return false;
    if (node.type === 'NamedBlock') {
      replace.revisit(nodes.block(node, node.nodes));
    }
  });
}

// ASTs are arrays/plain records plus Buffer payloads attached to RawInclude
// nodes. structuredClone preserves the graph, but converts those Buffers to
// Uint8Arrays. Clone the AST graph explicitly so binary filters keep receiving
// the loader's Buffer contract while aliases within one copy stay aliases.
function cloneAst(
  value,
  copies,
  deferDependencies,
  compilation,
  location,
  detail,
) {
  if (value === null || typeof value !== 'object') return value;
  copies = copies || new Map();
  if (copies.has(value)) return copies.get(value);

  if (Buffer.isBuffer(value)) {
    if (compilation) {
      compilation.charge(
        'generatedBytes',
        value.length,
        location,
        detail || 'cloning binary AST data',
      );
    }
    const copy = Buffer.from(value);
    copies.set(value, copy);
    return copy;
  }

  if (compilation) {
    compilation.charge(
      'materializedNodes',
      1,
      location,
      detail || 'cloning AST structure',
    );
  }

  const copy = Array.isArray(value)
    ? []
    : Object.create(Object.getPrototypeOf(value));
  copies.set(value, copy);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      descriptor.value =
        deferDependencies && value.type === 'FileReference' && key === 'ast'
          ? descriptor.value
          : cloneAst(
              descriptor.value,
              copies,
              deferDependencies,
              compilation,
              location,
              detail,
            );
    }
    Object.defineProperty(copy, key, descriptor);
  }
  return copy;
}

// Clone one physical syntax tree while retaining dependency ASTs as deferred
// inputs. Each dependency is copied independently when its include/extends edge
// is followed, which gives every rendered occurrence single ownership even if
// a direct API caller reuses the same FileReference.ast object.
function cloneOwnedAst(value, state, location) {
  return cloneAst(
    value,
    undefined,
    true,
    state.compilation,
    location,
    'taking ownership of an assembled AST',
  );
}

function applyYield(ast, block, includeNode, options) {
  if (!block || !block.nodes.length) return ast;
  let replaced = false;
  ast = walk(ast, null, function (node) {
    if (node.type === 'YieldBlock') {
      // Clone per yield site: an included template may contain more than one
      // `yield`; every position gets an independent mutable occurrence.
      replaced = true;
      node.type = 'Block';
      node.nodes = [
        cloneAst(
          block,
          undefined,
          false,
          options.compilationContext,
          diagnostics.context(includeNode, diagnostics.sources(options)),
          'materializing an include yield',
        ),
      ];
    }
  });
  if (!replaced) {
    diagnostics.error(
      'MISSING_YIELD',
      'Included template has no yield block but the include passes a block into it',
      includeNode,
      diagnostics.sources(options),
    );
  }
  return ast;
}

function checkExtendPosition(ast, hasExtends, sources) {
  let legitExtendsReached = false;
  walk(ast, function (node) {
    if (node.type === 'Extends') {
      if (hasExtends && !legitExtendsReached) {
        legitExtendsReached = true;
      } else {
        diagnostics.error(
          'EXTENDS_NOT_FIRST',
          'Declaration of template inheritance ("extends") should be the first thing in the file. There can only be one extends statement per file.',
          node,
          sources,
        );
      }
    }
  });
}

assemble.cloneAst = cloneAst;
assemble.DEFAULT_MAX_DEPTH = DEFAULT_MAX_DEPTH;
assemble.validateRoot = validateRoot;

module.exports = assemble;
