'use strict';

var assert = require('node:assert/strict');
var {describe, test} = require('node:test');
var {createRenderer} = require('./helpers');

var renderCode = createRenderer('code.pg');
var renderFigure = createRenderer('figure.pg');

describe('figure mixin', () => {
  test('figure with caption', () => {
    var input =
      '+figure\n' +
      '  img(src="photo.jpg" alt="A photo")\n' +
      '  block caption\n' +
      '    | Photo of the sunset.';
    var html = renderFigure(input);
    assert.ok(html.includes('<figure>'));
    assert.ok(html.includes('<img src="photo.jpg" alt="A photo">'));
    assert.ok(html.includes('<figcaption>Photo of the sunset.</figcaption>'));
    assert.ok(html.includes('</figure>'));
  });

  test('figure without caption — figcaption omitted', () => {
    var input =
      '+figure\n' + '  img(src="diagram.svg" alt="Architecture diagram")';
    var html = renderFigure(input);
    assert.ok(html.includes('<figure>'));
    assert.ok(html.includes('<img src="diagram.svg"'));
    assert.ok(!html.includes('<figcaption>'));
  });
});

describe('code mixin', () => {
  test('code block with caption', () => {
    var input =
      '+code\n' +
      '  | console.log("hello");\n' +
      '  block caption\n' +
      '    | A minimal program.';
    var html = renderCode(input);
    assert.ok(html.includes('<figure>'));
    assert.ok(html.includes('<pre><code>'));
    assert.ok(html.includes('console.log("hello");'));
    assert.ok(html.includes('<figcaption>A minimal program.</figcaption>'));
  });

  test('code block without caption — figcaption omitted', () => {
    var input = '+code\n' + '  | npm install pugneum';
    var html = renderCode(input);
    assert.ok(html.includes('<figure>'));
    assert.ok(html.includes('<pre><code>'));
    assert.ok(html.includes('npm install pugneum'));
    assert.ok(!html.includes('<figcaption>'));
  });

  test('code with inline shorthands in caption', () => {
    var input =
      '+code\n' +
      '  | x = 1\n' +
      '  block caption\n' +
      '    | A *(simple) assignment.';
    var html = renderCode(input);
    assert.ok(html.includes('<strong>simple</strong>'));
  });
});
