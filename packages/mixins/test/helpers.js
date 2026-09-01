'use strict';

var path = require('node:path');
var pg = require('pugneum');

function render(source, filename, options) {
  return pg.render(
    source,
    Object.assign(
      {
        basedir: path.join(__dirname, '..'),
        filename: path.join(__dirname, filename || 'test.pg'),
        warnings: [],
      },
      options,
    ),
  );
}

function renderMixin(filename, body, options) {
  return render(
    'include ../' + filename + '\n\n' + body,
    'test-' + filename,
    options,
  );
}

function createRenderer(filename) {
  return function renderBody(body, options) {
    return renderMixin(filename, body, options);
  };
}

module.exports = {createRenderer, render, renderMixin};
