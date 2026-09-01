'use strict';

const makeError = require('pugneum-error');
const walk = require('pugneum-walker');

const attributeInterpolationSource = Symbol.for(
  'pugneum.attributeInterpolationSource',
);
const attributeInterpolationResolved = Symbol.for(
  'pugneum.attributeInterpolationResolved',
);
const generatedSourceOrigins = Symbol.for('pugneum.generatedSourceOrigins');
const mixinCallStack = Symbol.for('pugneum.mixinCallStack');
const mixinEnvironment = Symbol.for('pugneum.mixinEnvironment');
const attributeVariableNameCharacter = /[-a-zA-Z_?]/;
const MAX_MIXIN_DEPTH = 256;

module.exports = expandMixinInstances;
expandMixinInstances.resolveRetainedInterpolation =
  resolveRetainedInterpolation;

// Lower renderer-time mixin declarations and calls into the concrete AST that
// the document-global resolver will actually see. The caller supplies an owned
// tree; declaration and caller fragments are cloned at every rendered slot so
// repeated calls and repeated yields never share mutable output nodes.
function expandMixinInstances(ast, options, isolateCommentBlock) {
  const expander = new MixinExpander(options || {}, isolateCommentBlock);
  expander.expandBlock(ast);
  expander.expandReachableFootnotes(ast);
  return {
    ast,
    finish() {
      expander.warnUnusedMixins();
    },
  };
}

class MixinExpander {
  constructor(options, isolateCommentBlock) {
    this.options = options;
    this.isolateCommentBlock = isolateCommentBlock;
    this.mixins = Object.create(null);
    this.mixinSlots = new WeakMap();
    this.usedMixins = new Set();
    this.callStack = [];
    this.footnoteDefinitions = Object.create(null);
    this.expandedFootnotes = new WeakSet();
    this.finished = false;
  }

  locate(node) {
    const sources = this.options.sources;
    const filename = node && node.filename;
    const hasMappedSource =
      sources && Object.prototype.hasOwnProperty.call(sources, filename);
    return {
      line: node && node.line,
      column: node && node.column,
      filename,
      source: hasMappedSource ? sources[filename] : this.options.source || '',
    };
  }

  error(code, message, node) {
    throw makeError(code, message, this.locate(node));
  }

  warn(code, message, node) {
    this.options.warnings.push(
      makeError.warning(code, message, this.locate(node)),
    );
  }

  warnUnusedMixins() {
    if (this.finished) return;
    this.finished = true;
    const entry = this.options.filename;
    const sources = this.options.sources;
    for (const name in this.mixins) {
      const mixin = this.mixins[name];
      if (
        !this.usedMixins.has(name) &&
        sourceOrigin(sources, mixin.filename) === sourceOrigin(sources, entry)
      ) {
        this.warn(
          'UNUSED_MIXIN',
          "Mixin '" + name + "' is defined but never called",
          mixin,
        );
      }
    }
  }

  expandBlock(block) {
    block.nodes = this.expandNodes(block.nodes);
    return block;
  }

  expandNodes(nodes) {
    const expanded = [];
    for (const node of nodes) appendItems(expanded, this.expandNode(node));
    return expanded;
  }

  expandNode(node) {
    if (node.type === 'Mixin') {
      return node.call ? this.expandMixinCall(node) : this.declareMixin(node);
    }
    if (node.attrs) node.attrs = this.resolveAttributes(node.attrs);

    switch (node.type) {
      case 'Block':
        this.expandBlock(node);
        break;
      case 'Tag':
      case 'InterpolatedTag':
      case 'Filter':
        this.expandBlock(node.block);
        break;
      case 'ReferenceLink':
      case 'ReferenceImage':
        this.expandBlock(node.block);
        if (this.callStack.length > 0) {
          setHidden(node, mixinEnvironment, this.callStack.at(-1).environment);
        }
        break;
      case 'BlockComment':
        // Comment-local references, footnotes, and TOCs are not part of the
        // document tree. Make them opaque before this traversal can register
        // definitions or calls from the hidden subtree.
        node.block = this.isolateCommentBlock(node.block);
        // An unbuffered comment is discarded without visiting its body. A
        // buffered comment uses the ordinary compiler state while producing
        // its local string, so preserve that behavior before semantic isolation.
        if (node.buffer) this.expandBlock(node.block);
        break;
      case 'NamedBlock':
        return this.expandNamedBlock(node);
      case 'MixinBlock':
        return this.expandMixinBlock(node);
      case 'Given':
        return this.expandGiven(node);
      case 'Variable':
        return this.expandVariable(node);
      case 'Footnotes':
        // Definition bodies render only when a reachable FootnoteRef selects
        // them. Register now and expand those bodies in first-reference order.
        for (const definition of node.definitions) {
          if (this.callStack.length > 0) {
            setHidden(definition, mixinCallStack, this.callStack.slice());
          }
          if (!(definition.name in this.footnoteDefinitions)) {
            this.footnoteDefinitions[definition.name] = definition;
          }
        }
        break;
    }

    return [node];
  }

  resolveAttributes(attrs) {
    const resolved = [];
    for (const attr of attrs) {
      if (attr.val === true) {
        resolved.push(attr);
        continue;
      }
      const value = this.resolveInterpolatedValue(String(attr.val), attr);
      Reflect.deleteProperty(attr, attributeInterpolationSource);
      if (value !== null) {
        attr.val = value;
        setHidden(attr, attributeInterpolationResolved, true);
        resolved.push(attr);
      }
    }
    return resolved;
  }

  resolveInterpolatedValue(value, record) {
    return resolveRetainedInterpolation(value, record, (name) =>
      this.resolveVariable(name, record),
    );
  }

  resolveVariable(name, node) {
    if (this.callStack.length === 0) {
      this.error(
        'VARIABLE_OUTSIDE_MIXIN',
        `Variable '${name}' used outside mixin`,
        node,
      );
    }
    const value = this.callStack.at(-1).environment[name];
    if (value === undefined) {
      this.error('UNDEFINED_VARIABLE', `Variable '${name}' is undefined`, node);
    }
    return value;
  }

  expandVariable(variable) {
    const value = this.resolveVariable(variable.name, variable);
    if (value === null) return [];
    return [
      {
        type: 'Text',
        val: value,
        line: variable.line,
        column: variable.column,
        filename: variable.filename,
      },
    ];
  }

  declareMixin(mixin) {
    this.mixins[mixin.name] = mixin;
    this.mixinSlots.set(mixin, this.inspectMixinSlots(mixin.block));
    return [];
  }

  expandMixinCall(mixin) {
    const declared = this.mixins[mixin.name];
    if (!declared) {
      this.error('UNDEFINED_MIXIN', `Undefined mixin '${mixin.name}'`, mixin);
    }
    this.usedMixins.add(mixin.name);

    if (
      (mixin.attrs && mixin.attrs.length > 0) ||
      (mixin.attributeBlocks && mixin.attributeBlocks.length > 0)
    ) {
      this.error(
        'UNSUPPORTED_MIXIN_CALL_ATTRIBUTES',
        `Attributes on a call to mixin '${mixin.name}' are not supported; ` +
          'apply classes, ids and attributes to an element inside the mixin instead',
        mixin,
      );
    }

    const args = mixin.args;
    const parameterCount = declared.args.length;
    if (args.length > parameterCount) {
      this.error(
        'MIXIN_ARGUMENT_COUNT_MISMATCH',
        `Too many arguments: mixin '${mixin.name}' declared ${parameterCount} called ${args.length}`,
        mixin,
      );
    }
    for (const frame of this.callStack) {
      if (frame.name === mixin.name) {
        this.error(
          'RECURSIVE_MIXIN',
          `Recursive call to mixin '${mixin.name}' detected`,
          mixin,
        );
      }
    }
    if (this.callStack.length >= MAX_MIXIN_DEPTH) {
      this.error(
        'MIXIN_STACK_OVERFLOW',
        `Mixin call stack depth exceeded ${MAX_MIXIN_DEPTH}`,
        mixin,
      );
    }

    const parentFrame = this.callStack.at(-1);
    const environment = Object.create(
      (parentFrame && parentFrame.environment) || null,
    );
    for (let index = 0; index < parameterCount; index++) {
      const parameter = declared.args[index];
      if (index < args.length) {
        environment[parameter.name] = args[index];
      } else if ('default' in parameter) {
        environment[parameter.name] = parameter.default;
      } else {
        environment[parameter.name] = null;
      }
    }

    const slots = this.mixinSlots.get(declared);
    let namedBlocks = null;
    let unnamedBlock = null;
    if (slots.usesNamedBlocks) {
      namedBlocks = Object.create(null);
      const unnamedNodes = [];
      if (mixin.block && mixin.block.nodes) {
        for (const node of mixin.block.nodes) {
          if (node.type === 'NamedBlock') {
            if (!(node.name in namedBlocks)) namedBlocks[node.name] = [];
            namedBlocks[node.name].push(node);
          } else if (slots.usesUnnamedBlock) {
            unnamedNodes.push(node);
          } else {
            this.error(
              'UNEXPECTED_CONTENT_IN_NAMED_BLOCK_CALL',
              `Content outside named blocks in call to mixin '${mixin.name}' which uses named blocks`,
              node,
            );
          }
        }
      }
      if (unnamedNodes.length > 0) {
        unnamedBlock = {type: 'Block', nodes: unnamedNodes};
      }
      this.validateNamedBlocks(declared, namedBlocks, slots.namedBlockNames);
    }

    this.callStack.push({
      name: mixin.name,
      environment,
      block: mixin.block,
      namedBlocks,
      unnamedBlock,
    });
    try {
      return this.expandBlock(cloneAst(declared.block)).nodes;
    } finally {
      this.callStack.pop();
    }
  }

  expandMixinBlock(mixinBlock) {
    if (this.callStack.length === 0) {
      this.error(
        'CALL_STACK_UNDERFLOW',
        'MixinBlock used outside mixin call',
        mixinBlock,
      );
    }
    const current = this.callStack.pop();
    try {
      const target =
        current.namedBlocks !== null ? current.unnamedBlock : current.block;
      return target && target.nodes
        ? this.expandNodes(cloneAst(target.nodes))
        : [];
    } finally {
      this.callStack.push(current);
    }
  }

  expandGiven(given) {
    if (this.callStack.length === 0) {
      this.error('GIVEN_OUTSIDE_CALL', 'Given used outside mixin call', given);
    }
    const frame = this.callStack.at(-1);
    return frame.namedBlocks && frame.namedBlocks[given.name]
      ? this.expandNodes(cloneAst(given.block.nodes))
      : [];
  }

  expandNamedBlock(namedBlock) {
    if (this.callStack.length === 0) {
      namedBlock.nodes = this.expandNodes(namedBlock.nodes);
      return [namedBlock];
    }

    const frame = this.callStack.at(-1);
    if (!frame.namedBlocks) {
      return this.expandNodes(namedBlock.nodes);
    }
    const callerBlocks = frame.namedBlocks[namedBlock.name];
    if (!callerBlocks) return this.expandNodes(namedBlock.nodes);

    delete frame.namedBlocks[namedBlock.name];
    let base = {nodes: namedBlock.nodes, scope: 'callee'};
    const prepends = [];
    const appends = [];
    try {
      for (const callerBlock of callerBlocks) {
        const fragment = {nodes: callerBlock.nodes, scope: 'caller'};
        switch (callerBlock.mode) {
          case 'replace':
            base = fragment;
            prepends.length = 0;
            appends.length = 0;
            break;
          case 'append':
            appends.push(fragment);
            break;
          case 'prepend':
            prepends.push(fragment);
            break;
          default:
            this.error(
              'UNKNOWN_BLOCK_MODE',
              `Unknown block mode '${callerBlock.mode}'`,
              callerBlock,
            );
        }
      }

      const result = [];
      for (let index = prepends.length - 1; index >= 0; index--) {
        appendItems(result, this.expandFragment(prepends[index]));
      }
      appendItems(result, this.expandFragment(base));
      for (const fragment of appends) {
        appendItems(result, this.expandFragment(fragment));
      }
      return result;
    } finally {
      frame.namedBlocks[namedBlock.name] = callerBlocks;
    }
  }

  expandFragment(fragment) {
    const nodes = cloneAst(fragment.nodes);
    if (fragment.scope !== 'caller') return this.expandNodes(nodes);
    const current = this.callStack.pop();
    try {
      return this.expandNodes(nodes);
    } finally {
      this.callStack.push(current);
    }
  }

  validateNamedBlocks(declared, callerBlocks, declaredNames) {
    for (const name of Object.keys(callerBlocks)) {
      if (!declaredNames.has(name)) {
        this.error(
          'UNEXPECTED_NAMED_BLOCK',
          `Mixin '${declared.name}' does not define named block '${name}'`,
          callerBlocks[name][0],
        );
      }
    }
  }

  inspectMixinSlots(block) {
    const namedBlockNames = new Set();
    this.collectNamedBlockNames(block, namedBlockNames);
    return {
      namedBlockNames,
      usesNamedBlocks: namedBlockNames.size > 0,
      usesUnnamedBlock: this.containsUnnamedSlot(block),
    };
  }

  containsUnnamedSlot(node) {
    if (!node) return false;
    if (node.type === 'MixinBlock') return true;
    if (node.type === 'Mixin' && node.call === false) return false;
    if (node.nodes) {
      for (const child of node.nodes) {
        if (this.containsUnnamedSlot(child)) return true;
      }
    }
    return node.block ? this.containsUnnamedSlot(node.block) : false;
  }

  collectNamedBlockNames(node, names) {
    if (!node) return;
    if (node.type === 'NamedBlock' || node.type === 'Given') {
      names.add(node.name);
    }
    if (node.type === 'Mixin') return;
    if (node.nodes) {
      for (const child of node.nodes) this.collectNamedBlockNames(child, names);
    }
    if (node.block) this.collectNamedBlockNames(node.block, names);
  }

  expandReachableFootnotes(ast) {
    const names = [];
    const enqueued = Object.create(null);
    const enqueue = (node) => {
      if (node.type === 'FootnoteRef' && !(node.name in enqueued)) {
        enqueued[node.name] = true;
        names.push(node.name);
      }
    };
    collectFootnoteRefs(ast, enqueue);

    for (let index = 0; index < names.length; index++) {
      const definition = this.footnoteDefinitions[names[index]];
      if (!definition || this.expandedFootnotes.has(definition)) continue;
      this.expandedFootnotes.add(definition);
      const savedStack = this.callStack;
      this.callStack = definition[mixinCallStack]
        ? definition[mixinCallStack].slice()
        : [];
      try {
        this.expandBlock(definition.block);
      } finally {
        this.callStack = savedStack;
      }
      collectFootnoteRefs(definition.block, enqueue);
    }
  }
}

function collectFootnoteRefs(ast, enqueue) {
  walk(ast, function (node) {
    if (node.type === 'BlockComment' || node.type === 'Footnotes') return false;
    enqueue(node);
  });
}

function appendItems(target, items) {
  for (const item of items) target.push(item);
}

function setHidden(target, key, value) {
  Object.defineProperty(target, key, {
    configurable: true,
    value,
    writable: true,
  });
}

function attributeVariableAt(str, start) {
  if (str[start] !== '#' || str[start + 1] !== '{') return null;
  let end = start + 2;
  while (end < str.length && attributeVariableNameCharacter.test(str[end])) {
    end++;
  }
  if (end === start + 2 || str[end] !== '}') return null;
  return {end: end + 1, name: str.substring(start + 2, end)};
}

function resolveRetainedInterpolation(value, record, resolveVariable) {
  const retained = record[attributeInterpolationSource];
  const source = typeof retained === 'string' ? retained : value;
  if (!source.includes('#{')) return source;

  const pieces = [];
  let hasNull = false;
  let index = 0;
  while (index < source.length) {
    let marker = index;
    while (source[marker] === '\\') marker++;
    const variable = attributeVariableAt(source, marker);

    if (variable) {
      const backslashes = marker - index;
      pieces.push('\\'.repeat(Math.floor(backslashes / 2)));
      if (backslashes % 2 !== 0) {
        pieces.push(source.slice(marker, variable.end));
      } else {
        const variableValue = resolveVariable(variable.name);
        if (variableValue === null) {
          hasNull = true;
        } else {
          pieces.push(variableValue);
        }
      }
      index = variable.end;
      continue;
    }

    if (marker !== index) {
      pieces.push(source.slice(index, marker));
      index = marker;
    } else {
      let literalEnd = index + 1;
      while (
        literalEnd < source.length &&
        source[literalEnd] !== '\\' &&
        (source[literalEnd] !== '#' || source[literalEnd + 1] !== '{')
      ) {
        literalEnd++;
      }
      pieces.push(source.slice(index, literalEnd));
      index = literalEnd;
    }
  }

  return hasNull ? null : pieces.join('');
}

function sourceOrigin(sources, filename) {
  const origins = sources && sources[generatedSourceOrigins];
  return origins && Object.prototype.hasOwnProperty.call(origins, filename)
    ? origins[filename]
    : filename;
}

function cloneAst(value, copies) {
  if (value === null || typeof value !== 'object') return value;
  copies = copies || new Map();
  if (copies.has(value)) return copies.get(value);
  if (Buffer.isBuffer(value)) {
    const copy = Buffer.from(value);
    copies.set(value, copy);
    return copy;
  }

  const copy = Array.isArray(value)
    ? []
    : Object.create(Object.getPrototypeOf(value));
  copies.set(value, copy);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      descriptor.value = cloneAst(descriptor.value, copies);
    }
    Object.defineProperty(copy, key, descriptor);
  }
  return copy;
}
