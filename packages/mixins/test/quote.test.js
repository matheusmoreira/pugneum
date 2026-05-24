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

describe('quote mixin', () => {
  test('linked source with citation', () => {
    var input =
      'include ../quote.pg\n' +
      '\n' +
      '+quote(https://example.com)\n' +
      '  | Quoted text.\n' +
      '  block source\n' +
      "    a(href='https://example.com') Author, Source";
    var html = render(input);
    assert.ok(html.includes('<figure>'));
    assert.ok(html.includes('<blockquote cite="https://example.com">'));
    assert.ok(html.includes('Quoted text.'));
    assert.ok(html.includes('<figcaption>'));
    assert.ok(html.includes('<cite>'));
    assert.ok(html.includes('<a href="https://example.com">'));
    assert.ok(html.includes('</figure>'));
  });

  test('no source — figcaption omitted', () => {
    var input =
      'include ../quote.pg\n' +
      '\n' +
      '+quote\n' +
      '  | Just a quote.';
    var html = render(input);
    assert.ok(html.includes('<blockquote>'));
    assert.ok(html.includes('Just a quote.'));
    assert.ok(!html.includes('<figcaption>'));
    assert.ok(!html.includes('<cite>'));
  });

  test('multi-paragraph quote', () => {
    var input =
      'include ../quote.pg\n' +
      '\n' +
      '+quote(https://example.com)\n' +
      '  p First paragraph.\n' +
      '  p Second paragraph.\n' +
      '  block source\n' +
      '    | Author';
    var html = render(input);
    assert.ok(html.includes('<p>First paragraph.</p>'));
    assert.ok(html.includes('<p>Second paragraph.</p>'));
    var bq = html.match(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/);
    assert.ok(bq);
    assert.ok(bq[1].includes('First paragraph'));
    assert.ok(bq[1].includes('Second paragraph'));
  });

  test('quote text supports inline shorthands', () => {
    var input =
      'include ../quote.pg\n' +
      '\n' +
      '+quote\n' +
      '  | This is *(important) text.';
    var html = render(input);
    assert.ok(html.includes('<strong>important</strong>'));
  });

  test('source with time element', () => {
    var input =
      'include ../quote.pg\n' +
      '\n' +
      '+quote(https://example.com)\n' +
      '  | Text.\n' +
      '  block source\n' +
      "    a(href='https://example.com').\n" +
      '      Author, #(time(datetime=2021-09-04) Sept 4, 2021)';
    var html = render(input);
    assert.ok(html.includes('<time datetime="2021-09-04">Sept 4, 2021</time>'));
  });

  test('unlinked source (no URL)', () => {
    var input =
      'include ../quote.pg\n' +
      '\n' +
      '+quote\n' +
      '  | Anonymous wisdom.\n' +
      '  block source\n' +
      '    | Unknown author';
    var html = render(input);
    assert.ok(html.includes('<blockquote>'));
    assert.ok(!html.includes('cite='));
    assert.ok(html.includes('Anonymous wisdom.'));
    assert.ok(html.includes('Unknown author'));
    assert.ok(html.includes('<figcaption>'));
  });
});
