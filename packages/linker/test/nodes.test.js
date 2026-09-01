const assert = require('node:assert/strict');
const test = require('node:test');
const nodes = require('../nodes');

const origin = {
  line: 7,
  column: 11,
  filename: 'generated.pg',
};

test('generated-node builders own the canonical parser-compatible shape', () => {
  const child = nodes.text(origin, 'content');
  const attr = nodes.attribute(origin, 'class', 'notice');
  const tag = nodes.tag(origin, {
    name: 'span',
    attrs: [attr],
    isInline: true,
    nodes: [child],
  });

  assert.deepStrictEqual(tag, {
    type: 'Tag',
    name: 'span',
    block: {
      type: 'Block',
      nodes: [
        {
          type: 'Text',
          val: 'content',
          line: 7,
          column: 11,
          filename: 'generated.pg',
        },
      ],
      line: 7,
      column: 11,
      filename: 'generated.pg',
    },
    attrs: [
      {
        name: 'class',
        val: 'notice',
        line: 7,
        column: 11,
        filename: 'generated.pg',
      },
    ],
    attributeBlocks: [],
    isInline: true,
    line: 7,
    column: 11,
    filename: 'generated.pg',
  });
  assert.deepStrictEqual(origin, {
    line: 7,
    column: 11,
    filename: 'generated.pg',
  });
});

test('tag defaults are independent and optional fields remain explicit', () => {
  const first = nodes.tag(origin, {name: 'img', selfClosing: true});
  const second = nodes.tag(origin, {name: 'div'});

  first.attrs.push(nodes.attribute(origin, 'alt', ''));
  first.block.nodes.push(nodes.text(origin, 'ignored'));
  assert.deepStrictEqual(second.attrs, []);
  assert.deepStrictEqual(second.block.nodes, []);
  assert.strictEqual(first.selfClosing, true);
  assert.strictEqual('selfClosing' in second, false);
});

test('resolved attributes retain non-enumerable interpolation provenance', () => {
  const marker = Symbol.for('pugneum.attributeInterpolationResolved');
  const attr = nodes.resolvedAttribute(origin, 'href', '/docs');

  assert.strictEqual(attr[marker], true);
  assert.deepStrictEqual(Object.keys(attr), [
    'name',
    'val',
    'line',
    'column',
    'filename',
  ]);
});
