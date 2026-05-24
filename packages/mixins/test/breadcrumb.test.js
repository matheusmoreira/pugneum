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

describe('breadcrumb mixins', () => {
  test('basic breadcrumb trail', () => {
    var input =
      'include ../breadcrumb.pg\n' +
      '\n' +
      '+breadcrumbs\n' +
      '  +breadcrumb(/) Home\n' +
      '  +breadcrumb(/articles) Articles\n' +
      '  +breadcrumb-current This Article';
    var html = render(input);
    assert.ok(html.includes('<nav aria-label="Breadcrumb">'));
    assert.ok(html.includes('<ol>'));
    assert.ok(html.includes('<li><a href="/">Home</a></li>'));
    assert.ok(html.includes('<li><a href="/articles">Articles</a></li>'));
    assert.ok(
      html.includes('<li><a aria-current="page">This Article</a></li>'),
    );
  });

  test('single item breadcrumb (just current page)', () => {
    var input =
      'include ../breadcrumb.pg\n' +
      '\n' +
      '+breadcrumbs\n' +
      '  +breadcrumb-current Home';
    var html = render(input);
    assert.ok(html.includes('<nav aria-label="Breadcrumb">'));
    assert.ok(html.includes('<li><a aria-current="page">Home</a></li>'));
  });

  test('breadcrumb with inline shorthands', () => {
    var input =
      'include ../breadcrumb.pg\n' +
      '\n' +
      '+breadcrumbs\n' +
      '  +breadcrumb(/) *(Home)';
    var html = render(input);
    assert.ok(html.includes('<a href="/"><strong>Home</strong></a>'));
  });
});
