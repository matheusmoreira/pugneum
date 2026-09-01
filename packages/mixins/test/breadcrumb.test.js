'use strict';

var assert = require('node:assert/strict');
var {describe, test} = require('node:test');
var {createRenderer} = require('./helpers');

var render = createRenderer('breadcrumb.pg');

describe('breadcrumb mixins', () => {
  test('default trail uses a non-link current item', () => {
    var input =
      '+breadcrumbs\n' +
      '  +breadcrumb(/) Home\n' +
      '  +breadcrumb(/articles) Articles\n' +
      '  +breadcrumb-current This Article';

    assert.strictEqual(
      render(input),
      '<nav aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li><a href="/articles">Articles</a></li><li><span aria-current="page">This Article</span></li></ol></nav>',
    );
  });

  test('landmark label is customizable', () => {
    assert.strictEqual(
      render("+breadcrumbs('Fil d Ariane')\n  +breadcrumb-current Accueil"),
      '<nav aria-label="Fil d Ariane"><ol><li><span aria-current="page">Accueil</span></li></ol></nav>',
    );
  });

  test('labelledby form references an authored accessible name', () => {
    var input =
      '+breadcrumbs-labelledby(trail-heading)\n' +
      '  +breadcrumb-current Current';
    assert.strictEqual(
      render(input),
      '<nav aria-labelledby="trail-heading"><ol><li><span aria-current="page">Current</span></li></ol></nav>',
    );
  });

  test('current item can be an explicit self-link', () => {
    var input =
      '+breadcrumbs\n' +
      '  +breadcrumb-current-link(/articles/current) Current';
    assert.strictEqual(
      render(input),
      '<nav aria-label="Breadcrumb"><ol><li><a href="/articles/current" aria-current="page">Current</a></li></ol></nav>',
    );
  });

  test('breadcrumb content supports inline shorthand', () => {
    assert.strictEqual(
      render('+breadcrumbs\n  +breadcrumb(/) *(Home)'),
      '<nav aria-label="Breadcrumb"><ol><li><a href="/"><strong>Home</strong></a></li></ol></nav>',
    );
  });
});
