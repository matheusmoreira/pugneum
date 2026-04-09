const walk = require('pugneum-walker');

function error(code, message, node) {
  throw require('pugneum-error')(code, message, {
    line: node.line,
    column: node.column,
    filename: node.filename,
  });
}

module.exports = link;

function link(ast) {
  if (ast.type !== 'Block') {
    throw new Error('The top level element should always be a block');
  }
  let extendsNode = null;
  if (ast.nodes.length) {
    const hasExtends = ast.nodes[0].type === 'Extends';
    checkExtendPosition(ast, hasExtends);
    if (hasExtends) {
      extendsNode = ast.nodes.shift();
    }
  }
  ast = applyIncludes(ast);
  ast = resolveReferences(ast);
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
          node
        );
      }
    });
    const parent = link(extendsNode.file.ast);
    extend(parent.declaredBlocks, ast);
    const foundBlockNames = [];
    walk(parent, function(node) {
      if (node.type === 'NamedBlock') {
        foundBlockNames.push(node.name);
      }
    });
    expectedBlocks.forEach(function(expectedBlock) {
      if (foundBlockNames.indexOf(expectedBlock.name) === -1) {
        error(
          'UNEXPECTED_BLOCK',
          'Unexpected block ' + expectedBlock.name,
          expectedBlock
        );
      }
    });
    Object.keys(ast.declaredBlocks).forEach(function(name) {
      parent.declaredBlocks[name] = ast.declaredBlocks[name];
    });
    parent.nodes = mixins.concat(parent.nodes);
    parent.hasExtends = true;
    return parent;
  }
  return ast;
}

function findDeclaredBlocks(ast) /*: {[name: string]: Array<BlockNode>}*/ {
  const definitions = {};
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
  parentBlocks.forEach(function(parentBlock) {
    if (parentBlock.parents) {
      flattenParentBlocks(parentBlock.parents, accumulator);
    }
    accumulator.push(parentBlock);
  });
  return accumulator;
}

function extend(parentBlocks, ast) {
  const stack = {};
  walk(
    ast,
    function before(node) {
      if (node.type === 'NamedBlock') {
        if (stack[node.name] === node.name) {
          return (node.ignore = true);
        }
        stack[node.name] = node.name;
        const parentBlockList = parentBlocks[node.name]
          ? flattenParentBlocks(parentBlocks[node.name])
          : [];
        if (parentBlockList.length) {
          node.parents = parentBlockList;
          parentBlockList.forEach(function(parentBlock) {
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
            }
          });
        }
      }
    },
    function after(node) {
      if (node.type === 'NamedBlock' && !node.ignore) {
        delete stack[node.name];
      }
    }
  );
}

function applyIncludes(ast, child) {
  return walk(
    ast,
    function before(node, replace) {
      if (node.type === 'RawInclude') {
        replace({type: 'Text', val: node.file.str.replace(/\r/g, '')});
      }
    },
    function after(node, replace) {
      if (node.type === 'Include') {
        let childAST = link(node.file.ast);
        if (childAST.hasExtends) {
          childAST = removeBlocks(childAST);
        }
        replace(applyYield(childAST, node.block));
      }
    }
  );
}
function removeBlocks(ast) {
  return walk(ast, function(node, replace) {
    if (node.type === 'NamedBlock') {
      replace({
        type: 'Block',
        nodes: node.nodes,
      });
    }
  });
}

function applyYield(ast, block) {
  if (!block || !block.nodes.length) return ast;
  let replaced = false;
  ast = walk(ast, null, function(node, replace) {
    if (node.type === 'YieldBlock') {
      replaced = true;
      node.type = 'Block';
      node.nodes = [block];
    }
  });
  function defaultYieldLocation(node) {
    let res = node;
    for (let i = 0; i < node.nodes.length; i++) {
      if (node.nodes[i].textOnly) continue;
      if (node.nodes[i].type === 'Block') {
        res = defaultYieldLocation(node.nodes[i]);
      } else if (node.nodes[i].block && node.nodes[i].block.nodes.length) {
        res = defaultYieldLocation(node.nodes[i].block);
      }
    }
    return res;
  }
  if (!replaced) {
    // todo: probably should deprecate this with a warning
    defaultYieldLocation(ast).nodes.push(block);
  }
  return ast;
}

function resolveReferences(ast) {
  // First pass: collect all reference definitions
  const definitions = {};
  walk(ast, function(node) {
    if (node.type === 'References') {
      for (const def of node.definitions) {
        definitions[def.name] = def.url;
      }
    }
  });

  // Second pass: replace ReferenceLink nodes with Tag nodes, remove References nodes
  return walk(
    ast,
    function before(node, replace) {
      if (node.type === 'References') {
        // Remove definitions from AST — they produce no output
        replace([]);
        return false;
      }
      if (node.type === 'ReferenceLink') {
        const url = definitions[node.name];
        if (url === undefined) {
          error(
            'UNDEFINED_REFERENCE',
            "Undefined reference '" + node.name + "'",
            node
          );
        }

        // If the block is empty, generate default text from the reference name
        let block = node.block;
        if (!block || block.nodes.length === 0) {
          block = {
            type: 'Block',
            nodes: [{
              type: 'Text',
              val: node.name,
              line: node.line,
              column: node.column,
              filename: node.filename,
            }],
            line: node.line,
            filename: node.filename,
          };
        }

        const attrs = [{
          name: 'href',
          val: url,
          line: node.line,
          column: node.column,
          filename: node.filename,
          mustEscape: false,
        }];
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
    }
  );
}

function checkExtendPosition(ast, hasExtends) {
  let legitExtendsReached = false;
  walk(ast, function(node) {
    if (node.type === 'Extends') {
      if (hasExtends && !legitExtendsReached) {
        legitExtendsReached = true;
      } else {
        error(
          'EXTENDS_NOT_FIRST',
          'Declaration of template inheritance ("extends") should be the first thing in the file. There can only be one extends statement per file.',
          node
        );
      }
    }
  });
}
