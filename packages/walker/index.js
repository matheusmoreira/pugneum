const AST_SCHEMA_VERSION = 1;
const activeParentSeeds = new WeakMap();
const validateDependencyASTs = Symbol('validateDependencyASTs');
// The parser permits 256 nested expressions. Each nested element contributes
// a semantic node plus its Block container, so its deepest valid tree has 512
// structural edges. Generated-source boundaries use the same ceiling.
const MAX_AST_DEPTH = 512;

const knownNodeTypes = new Set([
  'Block',
  'BlockComment',
  'Comment',
  'Extends',
  'FileReference',
  'Filter',
  'FootnoteRef',
  'Footnotes',
  'Given',
  'Include',
  'IncludeFilter',
  'InterpolatedTag',
  'Mixin',
  'MixinBlock',
  'NamedBlock',
  'RawInclude',
  'ReferenceImage',
  'ReferenceLink',
  'References',
  'Tag',
  'Text',
  'Toc',
  'Variable',
  'YieldBlock',
]);

module.exports = walkAST;
walkAST.validate = validateAST;
walkAST.AST_SCHEMA_VERSION = AST_SCHEMA_VERSION;
walkAST.MAX_AST_DEPTH = MAX_AST_DEPTH;

/**
 * Depth-first traversal of a pugneum AST with before/after hooks.
 *
 * Used internally by the loader, linker, and filterer, and published as a
 * reusable utility. The AST is mutated in place (not cloned); callers that need
 * to preserve the input must clone it first.
 *
 * Arguments
 *   walkAST(ast, before, after, options)
 *   walkAST(ast, before, options)        // 3-arg form: `after` omitted
 *
 *   `before(node, replace)` runs before a node's children are walked.
 *   `after(node, replace)`  runs after a node's children have been walked.
 *   Either hook may be omitted (pass null/undefined). The return value of
 *   `after` is always ignored; `before` returning exactly `false` skips the
 *   node's children (and the `after` call) for that node.
 *   Invalid hook values are rejected before traversal or options mutation.
 *
 * The `replace` callback substitutes the current node. Passing a single node
 * replaces it; passing an array splices those nodes into the parent's node list
 * but is only permitted when `replace.arrayAllowed` is true (parent is a
 * Block/NamedBlock, or an IncludeFilter directly inside a RawInclude).
 * `replace.arrayAllowed` is a boolean evaluated once, against the node and
 * parent as they entered the walk.
 *
 * Re-walking of array replacements (three distinct, deliberate fates):
 *   - `before` calls replace([...]) and does NOT return false -> the inserted
 *     nodes ARE walked (before/after run for each).
 *   - `before` calls replace([...]) and returns false -> children are skipped,
 *     so the inserted nodes are spliced in but NOT walked. (The empty-array
 *     removal idiom `replace([]); return false` is the canonical use.)
 *   - `after` calls replace([...]) -> post-order, so the inserted nodes are
 *     spliced in but NOT re-walked (re-descending after the subtree is done
 *     would risk non-termination).
 *
 * Input contract: `ast` must be well-formed parser output (a single node, not a
 * bare array). Reachable structure and cycles are validated before hooks run.
 * The default total structural-depth budget is MAX_AST_DEPTH (512), including
 * syntax and dependency edges. Callers may select a smaller `options.maxDepth`;
 * cycles and over-budget graphs fail schema preflight before recursive walking.
 */
function walkAST(ast, before, after, options) {
  // 3-arg overload: walkAST(ast, before, options). Reject arrays explicitly so
  // an array passed where `after` was intended is not silently swallowed as
  // options (arrays are typeof 'object'), which would skip the after hook.
  if (
    after &&
    typeof after === 'object' &&
    !Array.isArray(after) &&
    typeof options === 'undefined'
  ) {
    options = after;
    after = null;
  }
  assertHook('before', before);
  assertHook('after', after);
  options = normalizeOptions(options);
  assertRootNode(ast);
  const context = createWalkContext(options);
  validateAST(ast, {
    maxDepth: context.maxDepth,
    [validateDependencyASTs]: context.includeDependencies,
  });
  if (!context.callerParents) return walkNode(ast, before, after, context);

  activeParentSeeds.set(context.callerParents, context.parentSeed);
  try {
    return walkNode(ast, before, after, context);
  } finally {
    activeParentSeeds.delete(context.callerParents);
  }
}

function walkNode(ast, before, after, context) {
  const parents = context.parents;
  const currentDepth = Math.max(0, parents.length - context.parentSeedLength);
  const parent = context.parentsAreNearestFirst
    ? parents[0]
    : parents[parents.length - 1];

  // String compares rather than a per-call RegExp: arrayAllowed is recomputed
  // on every node and the walker is the linker's hottest inner loop. Equivalent
  // to the previous /^(Named)?Block$/ test.
  const parentType = parent && parent.type;
  const arrayAllowed = Boolean(
    parent &&
      (parentType === 'Block' ||
        parentType === 'NamedBlock' ||
        (parentType === 'RawInclude' && ast.type === 'IncludeFilter')),
  );
  // Capture ancestry at callback creation. The public `parents` array is a
  // traversal aid and may be shared by callers, but replacement safety must
  // not depend on its later contents. Installing an ancestor at this position
  // would create a cycle only after the replacement was attached.
  const forbiddenReplacementNodes = new WeakSet();
  for (const parent of parents) {
    if (isNode(parent)) forbiddenReplacementNodes.add(parent);
  }

  const replace = function replace(replacement) {
    if (Array.isArray(replacement) && !arrayAllowed) {
      throw new Error(
        'replace() can only be called with an array if the last parent is a Block or NamedBlock',
      );
    }
    validateAST(replacement, {
      allowRootArray: Array.isArray(replacement),
      forbiddenNodes: forbiddenReplacementNodes,
      maxDepth: context.maxDepth - currentDepth,
    });
    ast = replacement;
  };
  Object.defineProperty(replace, 'arrayAllowed', {
    enumerable: true,
    value: arrayAllowed,
  });

  if (before) {
    const result = before(ast, replace);
    if (result === false) {
      // Children are skipped. If `before` replaced the node with an array, it
      // is spliced into the parent by the caller's walkAndMergeNodes but is NOT
      // re-walked (see the contract above); the empty-array removal idiom is the
      // canonical use of this path.
      return ast;
    } else if (Array.isArray(ast)) {
      // `before` replaced this node with an array of nodes: re-walk them so the
      // hooks run for each, then return right here to skip the after() call on
      // an array (after() only runs for single nodes).
      return walkAndMergeNodes(ast);
    }
  }

  if (context.parentsAreNearestFirst) parents.unshift(ast);
  else parents.push(ast);

  try {
    switch (ast.type) {
      case 'NamedBlock':
      case 'Block':
        assertField(ast, 'nodes', Array.isArray(ast.nodes), 'an array');
        ast.nodes = walkAndMergeNodes(ast.nodes);
        break;
      case 'Filter':
      case 'Mixin':
      case 'Tag':
      case 'InterpolatedTag':
      case 'BlockComment':
        if (ast.block) {
          ast.block = walkNode(ast.block, before, after, context);
        }
        break;
      case 'Include':
        assertField(ast, 'block', isNode(ast.block), 'a node object');
        assertField(ast, 'file', isNode(ast.file), 'a node object');
        ast.block = walkNode(ast.block, before, after, context);
        ast.file = walkNode(ast.file, before, after, context);
        break;
      case 'Extends':
        assertField(ast, 'file', isNode(ast.file), 'a node object');
        ast.file = walkNode(ast.file, before, after, context);
        break;
      case 'RawInclude':
        assertField(ast, 'filters', Array.isArray(ast.filters), 'an array');
        assertField(ast, 'file', isNode(ast.file), 'a node object');
        ast.filters = walkAndMergeNodes(ast.filters);
        ast.file = walkNode(ast.file, before, after, context);
        break;
      case 'ReferenceLink':
      case 'ReferenceImage':
      case 'FootnoteRef':
        if (ast.block) {
          ast.block = walkNode(ast.block, before, after, context);
        }
        break;
      case 'Footnotes':
        assertField(
          ast,
          'definitions',
          Array.isArray(ast.definitions),
          'an array',
        );
        for (const def of ast.definitions) {
          if (def.block) {
            def.block = walkNode(def.block, before, after, context);
          }
        }
        break;
      case 'Given':
        if (ast.block) {
          ast.block = walkNode(ast.block, before, after, context);
        }
        break;
      case 'Toc':
      case 'References':
      case 'Comment':
      case 'IncludeFilter':
      case 'MixinBlock':
      case 'YieldBlock':
      case 'Text':
      case 'Variable':
        break;
      case 'FileReference':
        if (context.includeDependencies && ast.ast) {
          ast.ast = walkNode(ast.ast, before, after, context);
        }
        break;
      default:
        throw invalidAST(
          'unknown-type',
          '$',
          "unknown node type '" + String(ast.type) + "'",
          ast,
        );
    }
  } finally {
    if (context.parentsAreNearestFirst) parents.shift();
    else parents.pop();
  }

  after && after(ast, replace);
  return ast;

  function walkAndMergeNodes(nodes) {
    let merged;
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      const result = walkNode(node, before, after, context);
      if (Array.isArray(result)) {
        if (!merged) merged = nodes.slice(0, index);
        for (const replacement of result) {
          merged.push(replacement);
        }
      } else if (merged) {
        merged.push(result);
      } else if (result !== node) {
        merged = nodes.slice(0, index);
        merged.push(result);
      }
    }
    return merged || nodes;
  }
}

function assertHook(name, hook) {
  if (hook != null && typeof hook !== 'function') {
    throw new TypeError(name + ' must be a function, null, or undefined');
  }
}

function normalizeOptions(options) {
  if (options === undefined) return {includeDependencies: false};
  if (
    options === null ||
    typeof options !== 'object' ||
    Array.isArray(options)
  ) {
    throw new TypeError(
      'options must be a non-null, non-array object or undefined',
    );
  }
  if (
    options.includeDependencies !== undefined &&
    typeof options.includeDependencies !== 'boolean'
  ) {
    throw new TypeError(
      'options.includeDependencies must be a boolean or undefined',
    );
  }
  if (options.parents !== undefined && !Array.isArray(options.parents)) {
    throw new TypeError('options.parents must be an array or undefined');
  }
  if (
    options.maxDepth !== undefined &&
    (!Number.isSafeInteger(options.maxDepth) ||
      options.maxDepth < 0 ||
      options.maxDepth > MAX_AST_DEPTH)
  ) {
    throw new TypeError(
      'options.maxDepth must be an integer from 0 through ' + MAX_AST_DEPTH,
    );
  }
  return options;
}

function createWalkContext(options) {
  const includeDependencies = options.includeDependencies === true;
  const maxDepth =
    options.maxDepth === undefined ? MAX_AST_DEPTH : options.maxDepth;
  const callerParents = options.parents;
  if (callerParents === undefined) {
    return {
      includeDependencies,
      maxDepth,
      parentSeedLength: 0,
      parents: [],
      parentsAreNearestFirst: false,
    };
  }

  // Immutable arrays are read-only seeds. Reentrant walks sharing a mutable
  // array also get a private copy of its entry-time seed, not the outer walk's
  // live frames. Private stacks are stored outermost-first so traversal can use
  // constant-time push/pop. A first, mutable use remains the public,
  // nearest-first callback-time ancestry view for compatibility.
  if (!Object.isExtensible(callerParents)) {
    return {
      includeDependencies,
      maxDepth,
      parentSeedLength: callerParents.length,
      parents: callerParents.slice().reverse(),
      parentsAreNearestFirst: false,
    };
  }
  const activeSeed = activeParentSeeds.get(callerParents);
  if (activeSeed) {
    return {
      includeDependencies,
      maxDepth,
      parentSeedLength: activeSeed.length,
      parents: activeSeed.slice().reverse(),
      parentsAreNearestFirst: false,
    };
  }
  return {
    callerParents,
    includeDependencies,
    maxDepth,
    parents: callerParents,
    parentsAreNearestFirst: true,
    parentSeed: callerParents.slice(),
    parentSeedLength: callerParents.length,
  };
}

function assertRootNode(ast) {
  if (!isNode(ast) || typeof ast.type !== 'string') {
    throw new TypeError('ast must be a single node object with a string type');
  }
}

function isNode(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

// Hooks can mutate nodes directly after the initial graph preflight. Keep the
// remaining dispatch guards on the same stable, located schema-error path.
function assertField(node, field, ok, expected) {
  if (!ok) {
    throw invalidField(node, field, '$', expected);
  }
}

// Validate a complete AST graph without recursively consuming the JavaScript
// call stack. This is shared by replacement validation and by generated-AST
// boundaries such as syntax filters. Structural aliases are accepted by
// default, but cycles never are; callers that require single-owner tree data
// can set allowAliases to false.
function validateAST(ast, options) {
  options = options || {};
  const allowRootArray = options.allowRootArray === true;
  const allowAliases = options.allowAliases !== false;
  const allowedTypes = options.allowedTypes;
  const forbiddenNodes = options.forbiddenNodes;
  const maxDepth = options.maxDepth === undefined ? Infinity : options.maxDepth;

  if (
    maxDepth !== Infinity &&
    (!Number.isSafeInteger(maxDepth) || maxDepth < 0)
  ) {
    throw new TypeError('validateAST maxDepth must be a non-negative integer');
  }
  if (allowedTypes !== undefined && typeof allowedTypes.has !== 'function') {
    throw new TypeError('validateAST allowedTypes must provide has(type)');
  }
  if (
    forbiddenNodes !== undefined &&
    typeof forbiddenNodes.has !== 'function'
  ) {
    throw new TypeError('validateAST forbiddenNodes must provide has(node)');
  }

  const roots = Array.isArray(ast) ? ast : [ast];
  if (Array.isArray(ast) && !allowRootArray) {
    throw invalidAST(
      'shape',
      '$',
      'expected one node, but received a root array',
      ast,
    );
  }

  const active = new WeakSet();
  const completed = new WeakSet();
  const recordObjects = new WeakSet();
  const validationState = {
    active,
    allowAliases,
    completed,
    forbiddenNodes,
    validateDependencyASTs: options[validateDependencyASTs] !== false,
    recordObjects,
  };
  const stack = [];
  for (let index = roots.length - 1; index >= 0; index--) {
    stack.push({
      depth: 0,
      node: roots[index],
      path: Array.isArray(ast) ? '$[' + index + ']' : '$',
    });
  }

  while (stack.length > 0) {
    const entry = stack.pop();
    const node = entry.node;
    if (entry.exit) {
      active.delete(node);
      completed.add(node);
      continue;
    }

    if (!isNode(node)) {
      throw invalidAST('shape', entry.path, 'expected a node object', node);
    }
    if (forbiddenNodes && forbiddenNodes.has(node)) {
      throw invalidAST(
        'ownership',
        entry.path,
        'node is already owned by the surrounding AST',
        node,
      );
    }
    if (entry.depth > maxDepth) {
      throw invalidAST(
        'depth',
        entry.path,
        'structural depth exceeds maximum of ' + maxDepth,
        node,
      );
    }
    if (active.has(node)) {
      throw invalidAST(
        'cycle',
        entry.path,
        'structural cycle reaches an ancestor node',
        node,
      );
    }
    if (recordObjects.has(node) && !allowAliases) {
      throw invalidAST(
        'alias',
        entry.path,
        'object is shared by structural and record positions',
        node,
      );
    }
    if (completed.has(node)) {
      if (!allowAliases) {
        throw invalidAST(
          'alias',
          entry.path,
          'node object is shared by more than one structural position',
          node,
        );
      }
      continue;
    }
    if (typeof node.type !== 'string' || !knownNodeTypes.has(node.type)) {
      throw invalidAST(
        'unknown-type',
        entry.path,
        "unknown node type '" + String(node.type) + "'",
        node,
      );
    }
    if (allowedTypes && !allowedTypes.has(node.type)) {
      const err = invalidAST(
        'disallowed-type',
        entry.path,
        "node type '" + node.type + "' is not allowed at this stage",
        node,
      );
      err.nodeType = node.type;
      throw err;
    }

    active.add(node);
    const children = validateNodeShape(node, entry.path, validationState);
    stack.push({exit: true, node});
    for (let index = children.length - 1; index >= 0; index--) {
      const child = children[index];
      stack.push({
        depth: entry.depth + 1,
        node: child.node,
        path: child.path,
      });
    }
  }

  return ast;
}

function validateNodeShape(node, path, state) {
  const children = [];
  validateLocation(node, path);
  switch (node.type) {
    case 'Block':
      expectOptionalBoolean(node, 'isFootnoteBody', path);
      addNodeArray(node, 'nodes', path, children);
      break;
    case 'NamedBlock':
      expectString(node, 'name', path);
      if (!['replace', 'append', 'prepend'].includes(node.mode)) {
        throw invalidField(node, 'mode', path, 'replace, append, or prepend');
      }
      addNodeArray(node, 'nodes', path, children);
      break;
    case 'Filter':
      expectString(node, 'name', path);
      validateAttributes(node, 'attrs', path, state);
      addOptionalNode(node, 'block', path, children);
      break;
    case 'Mixin':
      expectString(node, 'name', path);
      if (typeof node.call !== 'boolean') {
        throw invalidField(node, 'call', path, 'a boolean');
      }
      validateMixinArguments(node, path, state);
      if (node.block == null) {
        if (!node.call) {
          throw invalidField(node, 'block', path, 'a node object');
        }
      } else {
        addNode(node, 'block', path, children);
      }
      validateOptionalAttributes(node, 'attrs', path, state);
      expectOptionalArray(node, 'attributeBlocks', path);
      expectOptionalBoolean(node, 'usesNamedBlocks', path);
      expectOptionalBoolean(node, 'usesUnnamedBlock', path);
      break;
    case 'Tag':
      expectString(node, 'name', path);
      validateAttributes(node, 'attrs', path, state);
      expectOptionalArray(node, 'attributeBlocks', path);
      expectOptionalBoolean(node, 'isInline', path);
      expectOptionalBoolean(node, 'selfClosing', path);
      addNode(node, 'block', path, children);
      break;
    case 'InterpolatedTag':
      expectString(node, 'expr', path);
      validateAttributes(node, 'attrs', path, state);
      expectOptionalArray(node, 'attributeBlocks', path);
      expectOptionalBoolean(node, 'isInline', path);
      expectOptionalBoolean(node, 'selfClosing', path);
      addNode(node, 'block', path, children);
      break;
    case 'BlockComment':
      expectOptionalStringOrNull(node, 'val', path);
      expectOptionalBoolean(node, 'buffer', path);
      addNode(node, 'block', path, children);
      break;
    case 'Comment':
      expectOptionalStringOrNull(node, 'val', path);
      expectOptionalBoolean(node, 'buffer', path);
      break;
    case 'Include':
      addTypedNode(node, 'block', 'Block', path, children);
      addTypedNode(node, 'file', 'FileReference', path, children);
      break;
    case 'Extends':
      addTypedNode(node, 'file', 'FileReference', path, children);
      break;
    case 'RawInclude':
      addTypedNodeArray(node, 'filters', 'IncludeFilter', path, children);
      addTypedNode(node, 'file', 'FileReference', path, children);
      break;
    case 'IncludeFilter':
      expectString(node, 'name', path);
      validateAttributes(node, 'attrs', path, state);
      break;
    case 'ReferenceLink':
    case 'ReferenceImage':
      expectString(node, 'name', path);
      validateAttributes(node, 'attrs', path, state);
      addTypedNode(node, 'block', 'Block', path, children);
      break;
    case 'FootnoteRef':
      expectString(node, 'name', path);
      addOptionalNode(node, 'block', path, children);
      break;
    case 'Footnotes':
      validateFootnoteDefinitions(node, path, children, state);
      break;
    case 'References':
      validateReferenceDefinitions(node, path, state);
      break;
    case 'Given':
      expectString(node, 'name', path);
      addTypedNode(node, 'block', 'Block', path, children);
      break;
    case 'Text':
      expectString(node, 'val', path);
      expectOptionalBoolean(node, 'isFootnoteSeparator', path);
      break;
    case 'Variable':
      expectString(node, 'name', path);
      break;
    case 'FileReference':
      expectString(node, 'path', path);
      if (node.ast != null) {
        if (!isNode(node.ast) || node.ast.type !== 'Block') {
          throw invalidField(node, 'ast', path, 'a Block node');
        }
        if (state.validateDependencyASTs) {
          children.push({node: node.ast, path: path + '.ast'});
        }
      }
      break;
    case 'MixinBlock':
    case 'Toc':
    case 'YieldBlock':
      break;
  }
  return children;
}

function addNode(node, field, path, children) {
  if (!isNode(node[field])) {
    throw invalidField(node, field, path, 'a node object');
  }
  children.push({node: node[field], path: path + '.' + field});
}

function addTypedNode(node, field, type, path, children) {
  addNode(node, field, path, children);
  if (node[field].type !== type) {
    throw invalidField(node, field, path, 'a ' + type + ' node');
  }
}

function addOptionalNode(node, field, path, children) {
  if (node[field] != null) addNode(node, field, path, children);
}

function addNodeArray(node, field, path, children) {
  const values = expectArray(node, field, path);
  for (let index = 0; index < values.length; index++) {
    if (!isNode(values[index])) {
      throw invalidAST(
        'shape',
        path + '.' + field + '[' + index + ']',
        'expected a node object',
        values[index],
        node,
      );
    }
    children.push({
      node: values[index],
      path: path + '.' + field + '[' + index + ']',
    });
  }
}

function addTypedNodeArray(node, field, type, path, children) {
  const values = expectArray(node, field, path);
  for (let index = 0; index < values.length; index++) {
    if (!isNode(values[index]) || values[index].type !== type) {
      throw invalidAST(
        'shape',
        path + '.' + field + '[' + index + ']',
        'expected a ' + type + ' node',
        values[index],
        node,
      );
    }
    children.push({
      node: values[index],
      path: path + '.' + field + '[' + index + ']',
    });
  }
}

function validateAttributes(node, field, path, state) {
  const attrs = expectArray(node, field, path);
  for (let index = 0; index < attrs.length; index++) {
    const attr = attrs[index];
    const attrPath = path + '.' + field + '[' + index + ']';
    validateRecord(attr, attrPath, 'an attribute object', state, node);
    validateLocation(attr, attrPath);
    if (typeof attr.name !== 'string') {
      throw invalidAST('shape', attrPath + '.name', 'expected a string', attr);
    }
    if (typeof attr.val !== 'string' && attr.val !== true) {
      throw invalidAST(
        'shape',
        attrPath + '.val',
        'expected a string or true',
        attr,
      );
    }
  }
}

function validateOptionalAttributes(node, field, path, state) {
  if (node[field] !== undefined) validateAttributes(node, field, path, state);
}

function validateMixinArguments(node, path, state) {
  const args = expectArray(node, 'args', path);
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    const argumentPath = path + '.args[' + index + ']';
    if (node.call) {
      if (typeof argument !== 'string') {
        throw invalidAST(
          'shape',
          argumentPath,
          'expected a string mixin argument',
          argument,
        );
      }
      continue;
    }

    validateRecord(
      argument,
      argumentPath,
      'a mixin parameter object',
      state,
      node,
    );
    if (typeof argument.name !== 'string') {
      throw invalidAST(
        'shape',
        argumentPath + '.name',
        'expected a string',
        argument,
      );
    }
    if (
      argument.default !== undefined &&
      typeof argument.default !== 'string'
    ) {
      throw invalidAST(
        'shape',
        argumentPath + '.default',
        'expected a string',
        argument,
      );
    }
  }
}

function validateFootnoteDefinitions(node, path, children, state) {
  const definitions = expectArray(node, 'definitions', path);
  for (let index = 0; index < definitions.length; index++) {
    const definition = definitions[index];
    const definitionPath = path + '.definitions[' + index + ']';
    validateRecord(
      definition,
      definitionPath,
      'a footnote definition object',
      state,
      node,
    );
    validateLocation(definition, definitionPath);
    if (typeof definition.name !== 'string') {
      throw invalidAST(
        'shape',
        definitionPath + '.name',
        'expected a string',
        definition,
      );
    }
    if (!isNode(definition.block) || definition.block.type !== 'Block') {
      throw invalidAST(
        'shape',
        definitionPath + '.block',
        'expected a Block node',
        definition.block,
        definition,
      );
    }
    children.push({
      node: definition.block,
      path: definitionPath + '.block',
    });
  }
}

function validateReferenceDefinitions(node, path, state) {
  const definitions = expectArray(node, 'definitions', path);
  for (let index = 0; index < definitions.length; index++) {
    const definition = definitions[index];
    const definitionPath = path + '.definitions[' + index + ']';
    validateRecord(
      definition,
      definitionPath,
      'a reference definition object',
      state,
      node,
    );
    validateLocation(definition, definitionPath);
    if (typeof definition.name !== 'string') {
      throw invalidAST(
        'shape',
        definitionPath + '.name',
        'expected a string',
        definition,
      );
    }
    if (typeof definition.url !== 'string') {
      throw invalidAST(
        'shape',
        definitionPath + '.url',
        'expected a string',
        definition,
      );
    }
    if (
      definition.defaultText !== undefined &&
      definition.defaultText !== null &&
      typeof definition.defaultText !== 'string'
    ) {
      throw invalidAST(
        'shape',
        definitionPath + '.defaultText',
        'expected a string or null',
        definition,
      );
    }
  }
}

function validateRecord(record, path, expected, state, locationNode) {
  if (!isNode(record)) {
    throw invalidAST(
      'shape',
      path,
      'expected ' + expected,
      record,
      locationNode,
    );
  }
  if (state.forbiddenNodes && state.forbiddenNodes.has(record)) {
    throw invalidAST(
      'ownership',
      path,
      'record is already owned by the surrounding AST',
      record,
    );
  }
  if (
    !state.allowAliases &&
    (state.active.has(record) ||
      state.completed.has(record) ||
      state.recordObjects.has(record))
  ) {
    throw invalidAST(
      'alias',
      path,
      'record object is shared by more than one AST position',
      record,
    );
  }
  state.recordObjects.add(record);
}

function validateLocation(record, path) {
  if (record.filename !== undefined && typeof record.filename !== 'string') {
    throw invalidAST('shape', path + '.filename', 'expected a string', record);
  }
  for (const field of ['line', 'column']) {
    if (
      record[field] !== undefined &&
      (!Number.isSafeInteger(record[field]) || record[field] < 0)
    ) {
      throw invalidAST(
        'shape',
        path + '.' + field,
        'expected a non-negative integer',
        record,
      );
    }
  }
}

function expectArray(node, field, path) {
  if (!Array.isArray(node[field])) {
    throw invalidField(node, field, path, 'an array');
  }
  return node[field];
}

function expectOptionalArray(node, field, path) {
  if (node[field] !== undefined) expectArray(node, field, path);
}

function expectString(node, field, path) {
  if (typeof node[field] !== 'string') {
    throw invalidField(node, field, path, 'a string');
  }
}

function expectOptionalBoolean(node, field, path) {
  if (node[field] !== undefined && typeof node[field] !== 'boolean') {
    throw invalidField(node, field, path, 'a boolean');
  }
}

function expectOptionalStringOrNull(node, field, path) {
  if (
    node[field] !== undefined &&
    node[field] !== null &&
    typeof node[field] !== 'string'
  ) {
    throw invalidField(node, field, path, 'a string or null');
  }
}

function invalidField(node, field, path, expected) {
  return invalidAST(
    'shape',
    path + '.' + field,
    'expected ' + expected + ' on ' + node.type,
    node,
  );
}

function invalidAST(kind, path, message, node, locationNode) {
  const location = isNode(locationNode) ? locationNode : node;
  const sourceLocation = formatSourceLocation(location);
  const where = sourceLocation ? sourceLocation + ' (' + path + ')' : path;
  const err = new Error('Invalid AST at ' + where + ': ' + message);
  err.name = 'ASTValidationError';
  err.code = 'INVALID_AST';
  err.kind = kind;
  err.path = path;
  err.node = node;
  if (isNode(location)) {
    if (typeof location.filename === 'string') {
      err.filename = location.filename;
    }
    if (Number.isSafeInteger(location.line) && location.line >= 0) {
      err.line = location.line;
    }
    if (Number.isSafeInteger(location.column) && location.column >= 0) {
      err.column = location.column;
    }
  }
  return err;
}

function formatSourceLocation(node) {
  if (!isNode(node)) return '';
  const filename = typeof node.filename === 'string' ? node.filename : '';
  const line =
    Number.isSafeInteger(node.line) && node.line >= 0 ? node.line : '';
  const column =
    Number.isSafeInteger(node.column) && node.column >= 0 ? node.column : '';
  if (!filename && line === '' && column === '') return '';
  if (filename) {
    return (
      filename +
      (line === '' ? '' : ':' + line + (column === '' ? '' : ':' + column))
    );
  }
  if (line !== '') {
    return 'line ' + line + (column === '' ? '' : ', column ' + column);
  }
  return 'column ' + column;
}
