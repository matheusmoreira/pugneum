'use strict';

var assert = require('node:assert/strict');
var {describe, test} = require('node:test');
var path = require('path');
var pg = require('pugneum');

function render(input) {
  return pg.render(input, {
    filename: path.join(__dirname, 'test.pg'),
  });
}

describe('details mixin', () => {
  test('basic disclosure widget', () => {
    var input =
      'include ../details.pg\n' +
      '\n' +
      '+details(Requirements)\n' +
      '  p A computer with memory.';
    var html = render(input);
    assert.ok(html.includes('<details>'));
    assert.ok(html.includes('<summary>Requirements</summary>'));
    assert.ok(html.includes('<p>A computer with memory.</p>'));
    assert.ok(html.includes('</details>'));
  });

  test('unquoted multi-word arg is split — too many arguments', () => {
    var input =
      'include ../details.pg\n' +
      '\n' +
      '+details(System Requirements)\n' +
      '  p Content here.';
    assert.throws(
      () => render(input),
      (err) => err.code === 'PUGNEUM:MIXIN_ARGUMENT_COUNT_MISMATCH',
    );
  });

  test('single-quoted summary with spaces', () => {
    var input =
      'include ../details.pg\n' +
      '\n' +
      "+details('System Requirements')\n" +
      '  p Content here.';
    var html = render(input);
    assert.ok(html.includes('<summary>System Requirements</summary>'));
  });

  test('double-quoted summary with spaces', () => {
    var input =
      'include ../details.pg\n' +
      '\n' +
      '+details("Frequently Asked Questions")\n' +
      '  p Answer to first question.';
    var html = render(input);
    assert.ok(html.includes('<summary>Frequently Asked Questions</summary>'));
  });

  test('multi-line content', () => {
    var input =
      'include ../details.pg\n' +
      '\n' +
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
