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

describe('figure mixin', () => {
  test('figure with caption', () => {
    var input =
      'include ../figure.pg\n' +
      '\n' +
      '+figure\n' +
      '  img(src="photo.jpg" alt="A photo")\n' +
      '  block caption\n' +
      '    | Photo of the sunset.';
    var html = render(input);
    assert.ok(html.includes('<figure>'));
    assert.ok(html.includes('<img src="photo.jpg" alt="A photo">'));
    assert.ok(html.includes('<figcaption>Photo of the sunset.</figcaption>'));
    assert.ok(html.includes('</figure>'));
  });

  test('figure without caption — figcaption omitted', () => {
    var input =
      'include ../figure.pg\n' +
      '\n' +
      '+figure\n' +
      '  img(src="diagram.svg" alt="Architecture diagram")';
    var html = render(input);
    assert.ok(html.includes('<figure>'));
    assert.ok(html.includes('<img src="diagram.svg"'));
    assert.ok(!html.includes('<figcaption>'));
  });
});

describe('code mixin', () => {
  test('code block with caption', () => {
    var input =
      'include ../figure.pg\n' +
      '\n' +
      '+code\n' +
      '  | console.log("hello");\n' +
      '  block caption\n' +
      '    | A minimal program.';
    var html = render(input);
    assert.ok(html.includes('<figure>'));
    assert.ok(html.includes('<pre><code>'));
    assert.ok(html.includes('console.log("hello");'));
    assert.ok(html.includes('<figcaption>A minimal program.</figcaption>'));
  });

  test('code block without caption — figcaption omitted', () => {
    var input =
      'include ../figure.pg\n' + '\n' + '+code\n' + '  | npm install pugneum';
    var html = render(input);
    assert.ok(html.includes('<figure>'));
    assert.ok(html.includes('<pre><code>'));
    assert.ok(html.includes('npm install pugneum'));
    assert.ok(!html.includes('<figcaption>'));
  });

  test('code with inline shorthands in caption', () => {
    var input =
      'include ../figure.pg\n' +
      '\n' +
      '+code\n' +
      '  | x = 1\n' +
      '  block caption\n' +
      '    | A *(simple) assignment.';
    var html = render(input);
    assert.ok(html.includes('<strong>simple</strong>'));
  });
});
