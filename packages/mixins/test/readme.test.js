'use strict';

var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var {describe, test} = require('node:test');
var {render} = require('./helpers');

var readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
var examples = Array.from(
  readme.matchAll(/```pugneum\n([\s\S]*?)```/g),
  (match) => match[1].trimEnd(),
);

describe('README Pugneum examples', () => {
  test('the public guide keeps its seven executable examples', () => {
    assert.strictEqual(examples.length, 7);
  });

  examples.forEach((source, index) => {
    test('example ' + (index + 1) + ' renders exact HTML', (t) => {
      var html = render(source, 'readme-example-' + (index + 1) + '.pg');
      assert.notStrictEqual(html, '');
      t.assert.snapshot(html);
    });
  });
});
