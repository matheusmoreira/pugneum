const attributeInterpolationResolved = Symbol.for(
  'pugneum.attributeInterpolationResolved',
);

function at(origin, value) {
  value.line = origin.line;
  value.column = origin.column;
  value.filename = origin.filename;
  return value;
}

function block(origin, children) {
  return at(origin, {
    type: 'Block',
    nodes: children,
  });
}

function text(origin, value) {
  return at(origin, {
    type: 'Text',
    val: value,
  });
}

function attribute(origin, name, value) {
  return at(origin, {
    name,
    val: value,
  });
}

function resolvedAttribute(origin, name, value) {
  const result = attribute(origin, name, value);
  Object.defineProperty(result, attributeInterpolationResolved, {
    configurable: true,
    value: true,
    writable: true,
  });
  return result;
}

function tag(origin, properties) {
  const result = {
    type: 'Tag',
    name: properties.name,
    block:
      properties.block === undefined
        ? block(origin, properties.nodes || [])
        : properties.block,
    attrs: properties.attrs || [],
    attributeBlocks: [],
    isInline: properties.isInline === true,
  };
  if (properties.selfClosing !== undefined) {
    result.selfClosing = properties.selfClosing;
  }
  return at(origin, result);
}

module.exports = {
  at,
  attribute,
  block,
  resolvedAttribute,
  tag,
  text,
};
