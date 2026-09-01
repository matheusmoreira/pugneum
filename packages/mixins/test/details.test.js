'use strict';

var assert = require('node:assert/strict');
var {describe, test} = require('node:test');
var {createRenderer} = require('./helpers');

var render = createRenderer('details.pg');

describe('details mixin', () => {
  test('scalar summary remains the simple fallback', () => {
    assert.strictEqual(
      render('+details(Requirements)\n  p A computer with memory.'),
      '<details><summary>Requirements</summary><p>A computer with memory.</p></details>',
    );
  });

  test('a rich summary slot works without a scalar argument', () => {
    var input =
      '+details\n' +
      '  block summary\n' +
      '    | System *(Requirements)\n' +
      '  p Content here.';

    assert.strictEqual(
      render(input),
      '<details><summary>System <strong>Requirements</strong></summary><p>Content here.</p></details>',
    );
  });

  test('the summary slot takes precedence over the scalar fallback', () => {
    var input =
      '+details(Ignored)\n' +
      '  block summary\n' +
      '    code npm install\n' +
      '  p Content here.';

    assert.strictEqual(
      render(input),
      '<details><summary><code>npm install</code></summary><p>Content here.</p></details>',
    );
  });

  test('an omitted scalar and slot produce an explicit empty summary', () => {
    assert.strictEqual(
      render('+details\n  p Content here.'),
      '<details><summary></summary><p>Content here.</p></details>',
    );
  });

  test('unquoted multi-word scalar is still too many arguments', () => {
    var input = '+details(System Requirements)\n  p Content here.';
    assert.throws(
      () => render(input),
      (error) => error.code === 'PUGNEUM:MIXIN_ARGUMENT_COUNT_MISMATCH',
    );
  });
});
