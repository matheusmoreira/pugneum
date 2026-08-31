'use strict';

var assert = require('node:assert/strict');
var {describe, test} = require('node:test');
var {createRenderer} = require('./helpers');

var render = createRenderer('breadcrumb.pg');

describe('breadcrumb mixins', () => {
  test('basic breadcrumb trail', () => {
    var input =
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
    var input = '+breadcrumbs\n' + '  +breadcrumb-current Home';
    var html = render(input);
    assert.ok(html.includes('<nav aria-label="Breadcrumb">'));
    assert.ok(html.includes('<li><a aria-current="page">Home</a></li>'));
  });

  test('breadcrumb with inline shorthands', () => {
    var input = '+breadcrumbs\n' + '  +breadcrumb(/) *(Home)';
    var html = render(input);
    assert.ok(html.includes('<a href="/"><strong>Home</strong></a>'));
  });
});
