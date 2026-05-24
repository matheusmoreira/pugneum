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

describe('file-system mixin', () => {
  test('basic file list', () => {
    var input =
      'include ../file-system.pg\n' +
      '\n' +
      '+file-system\n' +
      '  +file(index.js)\n' +
      '  +file(package.json)';
    var html = render(input);
    assert.ok(html.includes('<ul>'));
    assert.ok(html.includes('<li><code>index.js</code></li>'));
    assert.ok(html.includes('<li><code>package.json</code></li>'));
  });

  test('custom class on root ul', () => {
    var input =
      'include ../file-system.pg\n' +
      '\n' +
      '+file-system(tree)\n' +
      '  +file(a.js)';
    var html = render(input);
    assert.ok(html.includes('<ul class="tree">'));
  });

  test('no class when parameter omitted', () => {
    var input =
      'include ../file-system.pg\n' + '\n' + '+file-system\n' + '  +file(a.js)';
    var html = render(input);
    assert.ok(html.includes('<ul>'));
    assert.ok(!html.includes('class='));
  });

  test('nested directories', () => {
    var input =
      'include ../file-system.pg\n' +
      '\n' +
      '+file-system\n' +
      '  +directory(src)\n' +
      '    +file(main.js)\n' +
      '    +directory(lib)\n' +
      '      +file(util.js)';
    var html = render(input);
    assert.ok(html.includes('<code>src</code>'));
    assert.ok(html.includes('<code>lib</code>'));
    assert.ok(html.includes('<code>main.js</code>'));
    assert.ok(html.includes('<code>util.js</code>'));
    var uls = html.match(/<ul>/g);
    assert.strictEqual(uls.length, 3);
  });

  test('file with annotation', () => {
    var input =
      'include ../file-system.pg\n' +
      '\n' +
      '+file-system\n' +
      '  +file(index.js)\n' +
      '    |  — entry point';
    var html = render(input);
    assert.ok(html.includes('<code>index.js</code>'));
    assert.ok(html.includes('entry point'));
  });

  test('deep nesting matches original website pattern', () => {
    var input =
      'include ../file-system.pg\n' +
      '\n' +
      '+file-system\n' +
      '  +directory(~/.files)\n' +
      '    +directory(~)\n' +
      '      +file(.bash_profile)\n' +
      '      +file(.bashrc)\n' +
      '      +file(.vimrc)\n' +
      '    +file(GNUmakefile)';
    var html = render(input);
    assert.ok(html.includes('<code>~/.files</code>'));
    assert.ok(html.includes('<code>~</code>'));
    assert.ok(html.includes('<code>.bash_profile</code>'));
    assert.ok(html.includes('<code>GNUmakefile</code>'));
  });

  test('directory with description annotation', () => {
    var input =
      'include ../file-system.pg\n' +
      '\n' +
      '+file-system\n' +
      '  +directory(src)\n' +
      '    block description\n' +
      '      |  — source code\n' +
      '    +file(index.js)\n' +
      '    +file(render.js)';
    var html = render(input);
    assert.ok(html.includes('<code>src</code>'));
    assert.ok(html.includes(' — source code'));
    assert.ok(html.includes('<code>index.js</code>'));
    assert.ok(html.includes('<code>render.js</code>'));
  });

  test('directory without description still works', () => {
    var input =
      'include ../file-system.pg\n' +
      '\n' +
      '+file-system\n' +
      '  +directory(src)\n' +
      '    +file(main.js)';
    var html = render(input);
    assert.ok(html.includes('<code>src</code>'));
    assert.ok(html.includes('<code>main.js</code>'));
  });
});
