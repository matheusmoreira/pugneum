'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');

const escapeText = require('../escape-text');

test('shared filter text escaping covers the raw-HTML text boundary', () => {
  assert.strictEqual(
    escapeText(`<code title="example">Tom & Jerry's</code>`),
    "&lt;code title=&quot;example&quot;&gt;Tom &amp; Jerry's&lt;/code&gt;",
  );
});
