const makeError = require('pugneum-error');
const walk = require('pugneum-walker');

function error(code, message, node, source) {
  throw makeError(code, message, {
    line: node.line,
    column: node.column,
    filename: node.filename,
    source: source,
  });
}

const DEFAULT_MAX_LINK_DEPTH = 256;

module.exports = link;

function link(ast, options) {
  options = options || {};
  const source = options.source;
  const maxDepth = options.maxLinkDepth != null ? options.maxLinkDepth : DEFAULT_MAX_LINK_DEPTH;
  const depth = options._linkDepth || 0;

  if (depth >= maxDepth) {
    error(
      'LINK_DEPTH_EXCEEDED',
      `Template inheritance/include chain exceeds maximum depth of ${maxDepth}`,
      ast,
      source,
    );
  }

  if (ast.type !== 'Block') {
    error('INVALID_AST', 'The top level element should always be a block', ast, source);
  }
  let extendsNode = null;
  if (ast.nodes.length) {
    const hasExtends = ast.nodes[0].type === 'Extends';
    checkExtendPosition(ast, hasExtends, source);
    if (hasExtends) {
      extendsNode = ast.nodes.shift();
    }
  }
  ast = applyIncludes(ast, options);
  ast = resolveReferences(ast, source);
  ast.declaredBlocks = findDeclaredBlocks(ast);
  if (extendsNode) {
    const mixins = [];
    const expectedBlocks = [];
    ast.nodes.forEach(function addNode(node) {
      if (node.type === 'NamedBlock') {
        expectedBlocks.push(node);
      } else if (node.type === 'Block') {
        node.nodes.forEach(addNode);
      } else if (node.type === 'Mixin' && node.call === false) {
        mixins.push(node);
      } else {
        error(
          'UNEXPECTED_NODES_IN_EXTENDING_ROOT',
          'Only named blocks and mixins can appear at the top level of an extending template',
          node,
          source,
        );
      }
    });

    // Validate expected blocks BEFORE mutating parent via extend()
    const parent = link(extendsNode.file.ast, Object.assign({}, options, {_linkDepth: depth + 1}));
    const parentBlockNames = [];
    walk(parent, function (node) {
      if (node.type === 'NamedBlock') {
        parentBlockNames.push(node.name);
      }
    });
    for (const expectedBlock of expectedBlocks) {
      if (!parentBlockNames.includes(expectedBlock.name)) {
        error(
          'UNEXPECTED_BLOCK',
          'Unexpected block ' + expectedBlock.name,
          expectedBlock,
          source,
        );
      }
    }

    extend(parent.declaredBlocks, ast, source);
    Object.keys(ast.declaredBlocks).forEach(function (name) {
      parent.declaredBlocks[name] = ast.declaredBlocks[name];
    });
    parent.nodes = mixins.concat(parent.nodes);
    parent.hasExtends = true;
    return parent;
  }
  return ast;
}

function findDeclaredBlocks(ast) {
  const definitions = Object.create(null);
  walk(ast, function before(node) {
    if (node.type === 'NamedBlock' && node.mode === 'replace') {
      definitions[node.name] = definitions[node.name] || [];
      definitions[node.name].push(node);
    }
  });
  return definitions;
}

function flattenParentBlocks(parentBlocks, accumulator) {
  accumulator = accumulator || [];
  parentBlocks.forEach(function (parentBlock) {
    if (parentBlock.parents) {
      flattenParentBlocks(parentBlock.parents, accumulator);
    }
    accumulator.push(parentBlock);
  });
  return accumulator;
}

function extend(parentBlocks, ast, source) {
  const stack = new Set();
  walk(
    ast,
    function before(node) {
      if (node.type === 'NamedBlock') {
        if (stack.has(node.name)) {
          return (node.ignore = true);
        }
        stack.add(node.name);
        const parentBlockList = parentBlocks[node.name]
          ? flattenParentBlocks(parentBlocks[node.name])
          : [];
        if (parentBlockList.length) {
          node.parents = parentBlockList;
          parentBlockList.forEach(function (parentBlock) {
            switch (node.mode) {
              case 'append':
                parentBlock.nodes = parentBlock.nodes.concat(node.nodes);
                break;
              case 'prepend':
                parentBlock.nodes = node.nodes.concat(parentBlock.nodes);
                break;
              case 'replace':
                parentBlock.nodes = node.nodes;
                break;
              default:
                error(
                  'UNKNOWN_BLOCK_MODE',
                  "Unknown block mode '" + node.mode + "'",
                  node,
                  source,
                );
            }
          });
        }
      }
    },
    function after(node) {
      if (node.type === 'NamedBlock' && !node.ignore) {
        stack.delete(node.name);
      }
    },
  );
}

function applyIncludes(ast, options) {
  return walk(
    ast,
    function before(node, replace) {
      if (node.type === 'RawInclude') {
        replace({type: 'Text', val: node.file.str.replace(/\r/g, '')});
      }
    },
    function after(node, replace) {
      if (node.type === 'Include') {
        const depth = options._linkDepth || 0;
        let childAST = link(node.file.ast, Object.assign({}, options, {_linkDepth: depth + 1}));
        if (childAST.hasExtends) {
          childAST = removeBlocks(childAST);
        }
        replace(applyYield(childAST, node.block, node, options));
      }
    },
  );
}

function removeBlocks(ast) {
  return walk(ast, function (node, replace) {
    if (node.type === 'NamedBlock') {
      replace({
        type: 'Block',
        nodes: node.nodes,
        line: node.line,
        column: node.column,
        filename: node.filename,
      });
    }
  });
}

function applyYield(ast, block, includeNode, options) {
  if (!block || !block.nodes.length) return ast;
  let replaced = false;
  ast = walk(ast, null, function (node, replace) {
    if (node.type === 'YieldBlock') {
      replaced = true;
      node.type = 'Block';
      node.nodes = [block];
    }
  });
  if (!replaced) {
    error(
      'MISSING_YIELD',
      'Included template has no yield block but the include passes a block into it',
      includeNode,
      options && options.source,
    );
  }
  return ast;
}

function resolveReferences(ast, source) {
  const definitions = Object.create(null);
  walk(ast, function (node) {
    if (node.type === 'References') {
      for (const def of node.definitions) {
        if (def.name in definitions) {
          error(
            'DUPLICATE_REFERENCE',
            `Duplicate reference '${def.name}'`,
            def,
            source,
          );
        }
        definitions[def.name] = def.url;
      }
    }
  });

  return walk(ast, function before(node, replace) {
    if (node.type === 'References') {
      replace([]);
      return false;
    }
    if (node.type === 'ReferenceLink') {
      const url = definitions[node.name];
      if (url === undefined) {
        error(
          'UNDEFINED_REFERENCE',
          "Undefined reference '" + node.name + "'",
          node,
          source,
        );
      }

      let block = node.block;
      if (!block || block.nodes.length === 0) {
        block = {
          type: 'Block',
          nodes: [
            {
              type: 'Text',
              val: node.name,
              line: node.line,
              column: node.column,
              filename: node.filename,
            },
          ],
          line: node.line,
          column: node.column,
          filename: node.filename,
        };
      }

      const attrs = [
        {
          name: 'href',
          val: url,
          line: node.line,
          column: node.column,
          filename: node.filename,
        },
      ];
      if (node.attrs) {
        attrs.push.apply(attrs, node.attrs);
      }

      replace({
        type: 'Tag',
        name: 'a',
        attrs: attrs,
        attributeBlocks: [],
        block: block,
        isInline: true,
        line: node.line,
        column: node.column,
        filename: node.filename,
      });
    }
  });
}

function checkExtendPosition(ast, hasExtends, source) {
  let legitExtendsReached = false;
  walk(ast, function (node) {
    if (node.type === 'Extends') {
      if (hasExtends && !legitExtendsReached) {
        legitExtendsReached = true;
      } else {
        error(
          'EXTENDS_NOT_FIRST',
          'Declaration of template inheritance ("extends") should be the first thing in the file. There can only be one extends statement per file.',
          node,
          source,
        );
      }
    }
  });
}
