module.exports = walkAST;

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
 * bare array). Recursion is unbounded; the normal pipeline is safe because the
 * parser caps nesting at MAX_PARSE_DEPTH (256) before the AST reaches the walker
 * and the loader rejects cyclic dependency graphs (CIRCULAR_DEPENDENCY). A
 * hand-built AST that is deeper than the native stack, or a cyclic
 * FileReference.ast under `includeDependencies`, will throw a raw RangeError.
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
  options = options || {includeDependencies: false};
  const parents = (options.parents = options.parents || []);

  if (Array.isArray(ast)) {
    throw new Error(
      'walkAST expects a single AST node, not an array (got an array at the root)',
    );
  }

  const replace = function replace(replacement) {
    if (Array.isArray(replacement) && !replace.arrayAllowed) {
      throw new Error(
        'replace() can only be called with an array if the last parent is a Block or NamedBlock',
      );
    }
    ast = replacement;
  };
  // String compares rather than a per-call RegExp: arrayAllowed is recomputed
  // on every node and the walker is the linker's hottest inner loop. Equivalent
  // to the previous /^(Named)?Block$/ test.
  const parentType = parents[0] && parents[0].type;
  replace.arrayAllowed = Boolean(
    parents[0] &&
      (parentType === 'Block' ||
        parentType === 'NamedBlock' ||
        (parentType === 'RawInclude' && ast.type === 'IncludeFilter')),
  );

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

  parents.unshift(ast);

  try {
    switch (ast.type) {
      case 'NamedBlock':
      case 'Block':
        assertField(ast, 'nodes', Array.isArray(ast.nodes));
        ast.nodes = walkAndMergeNodes(ast.nodes);
        break;
      case 'Filter':
      case 'Mixin':
      case 'Tag':
      case 'InterpolatedTag':
      case 'BlockComment':
        if (ast.block) {
          ast.block = walkAST(ast.block, before, after, options);
        }
        break;
      case 'Include':
        assertField(ast, 'block', isNode(ast.block));
        assertField(ast, 'file', isNode(ast.file));
        ast.block = walkAST(ast.block, before, after, options);
        ast.file = walkAST(ast.file, before, after, options);
        break;
      case 'Extends':
        assertField(ast, 'file', isNode(ast.file));
        ast.file = walkAST(ast.file, before, after, options);
        break;
      case 'RawInclude':
        assertField(ast, 'filters', Array.isArray(ast.filters));
        assertField(ast, 'file', isNode(ast.file));
        ast.filters = walkAndMergeNodes(ast.filters);
        ast.file = walkAST(ast.file, before, after, options);
        break;
      case 'ReferenceLink':
      case 'ReferenceImage':
      case 'FootnoteRef':
        if (ast.block) {
          ast.block = walkAST(ast.block, before, after, options);
        }
        break;
      case 'Footnotes':
        assertField(ast, 'definitions', Array.isArray(ast.definitions));
        for (const def of ast.definitions) {
          if (def.block) {
            def.block = walkAST(def.block, before, after, options);
          }
        }
        break;
      case 'Given':
        if (ast.block) {
          ast.block = walkAST(ast.block, before, after, options);
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
        if (options.includeDependencies && ast.ast) {
          ast.ast = walkAST(ast.ast, before, after, options);
        }
        break;
      default:
        throw new Error('Unexpected node type ' + ast.type);
    }
  } finally {
    parents.shift();
  }

  after && after(ast, replace);
  return ast;

  function walkAndMergeNodes(nodes) {
    const merged = [];
    for (const node of nodes) {
      const result = walkAST(node, before, after, options);
      if (Array.isArray(result)) {
        merged.push(...result);
      } else {
        merged.push(result);
      }
    }
    return merged;
  }
}

function isNode(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

// Turn a malformed known node into the same friendly, located error style as
// the `Unexpected node type` default branch, rather than a cryptic TypeError
// raised several frames deeper when a missing field is dereferenced.
function assertField(node, field, ok) {
  if (!ok) {
    throw new Error(
      'Malformed ' + node.type + ' node: invalid or missing ' + field,
    );
  }
}
