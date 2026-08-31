'use strict';

var assert = require('node:assert/strict');
var {describe, test} = require('node:test');
var {createRenderer} = require('./helpers');

var render = createRenderer('details.pg');

describe('details mixin', () => {
  test('basic disclosure widget', () => {
    var input = '+details(Requirements)\n' + '  p A computer with memory.';
    var html = render(input);
    assert.ok(html.includes('<details>'));
    assert.ok(html.includes('<summary>Requirements</summary>'));
    assert.ok(html.includes('<p>A computer with memory.</p>'));
    assert.ok(html.includes('</details>'));
  });

  test('unquoted multi-word arg is split — too many arguments', () => {
    var input = '+details(System Requirements)\n' + '  p Content here.';
    // Unquoted whitespace separates mixin arguments. details declares exactly
    // one parameter, so this two-argument author error must keep the language's
    // normalized argument-count diagnostic rather than render partial text.
    assert.throws(
      () => render(input),
      (err) => err.code === 'PUGNEUM:MIXIN_ARGUMENT_COUNT_MISMATCH',
    );
  });

  test('single-quoted summary with spaces', () => {
    var input = "+details('System Requirements')\n" + '  p Content here.';
    var html = render(input);
    assert.ok(html.includes('<summary>System Requirements</summary>'));
  });

  test('double-quoted summary with spaces', () => {
    var input =
      '+details("Frequently Asked Questions")\n' +
      '  p Answer to first question.';
    var html = render(input);
    assert.ok(html.includes('<summary>Frequently Asked Questions</summary>'));
  });

  test('multi-line content', () => {
    var input =
      '+details(Installation)\n' +
      '  ol\n' +
      '    li Download\n' +
      '    li Extract\n' +
      '    li Run';
    var html = render(input);
    assert.ok(html.includes('<summary>Installation</summary>'));
    assert.ok(html.includes('<ol>'));
    assert.ok(html.includes('<li>Download</li>'));
  });
});
