module.exports = walkAST;

function walkAST(ast, before, after, options) {
  if (after && typeof after === 'object' && typeof options === 'undefined') {
    options = after;
    after = null;
  }
  options = options || {includeDependencies: false};
  const parents = (options.parents = options.parents || []);

  const replace = function replace(replacement) {
    if (Array.isArray(replacement) && !replace.arrayAllowed) {
      throw new Error(
        'replace() can only be called with an array if the last parent is a Block or NamedBlock',
      );
    }
    ast = replacement;
  };
  replace.arrayAllowed =
    parents[0] &&
    (/^(Named)?Block$/.test(parents[0].type) ||
      (parents[0].type === 'RawInclude' && ast.type === 'IncludeFilter'));

  if (before) {
    const result = before(ast, replace);
    if (result === false) {
      return ast;
    } else if (Array.isArray(ast)) {
      // return right here to skip after() call on array
      return walkAndMergeNodes(ast);
    }
  }

  parents.unshift(ast);

  switch (ast.type) {
    case 'NamedBlock':
    case 'Block':
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
      ast.block = walkAST(ast.block, before, after, options);
      ast.file = walkAST(ast.file, before, after, options);
      break;
    case 'Extends':
      ast.file = walkAST(ast.file, before, after, options);
      break;
    case 'RawInclude':
      ast.filters = walkAndMergeNodes(ast.filters);
      ast.file = walkAST(ast.file, before, after, options);
      break;
    case 'ReferenceLink':
    case 'ReferenceImage':
      if (ast.block) {
        ast.block = walkAST(ast.block, before, after, options);
      }
      break;
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

  parents.shift();

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
