'use strict';

// Characterization tests pinning the documented behavior of the mixin
// library on edge-case / author-mistake input. These mixins are pure
// structure (no runtime), so the behaviors below are inherent language
// properties — raw text output, optional trailing arguments, whitespace
// argument splitting, and presence-based `given`. The tests exist so the
// chosen behavior is intentional and any future change is deliberate. See
// the "Notes" section of README.md.

var assert = require('node:assert/strict');
var {describe, test} = require('node:test');
var path = require('path');
var pg = require('pugneum');

function render(input) {
  return pg.render(input, {
    filename: path.join(__dirname, 'test.pg'),
  });
}

describe('mixin text arguments are emitted raw (not HTML-escaped)', () => {
  test('+file name with markup characters passes through verbatim', () => {
    var input = "include ../file-system.pg\n\n+file('a<b>.js')";
    var html = render(input);
    assert.ok(html.includes('<code>a<b>.js</code>'));
    assert.ok(!html.includes('&lt;'));
  });

  test('+details summary with markup characters passes through verbatim', () => {
    var input = "include ../details.pg\n\n+details('a < b & c')\n  p x";
    var html = render(input);
    assert.ok(html.includes('<summary>a < b & c</summary>'));
    assert.ok(!html.includes('&lt;'));
    assert.ok(!html.includes('&amp;'));
  });

  test('+code content with angle brackets and ampersands passes through verbatim', () => {
    var input = 'include ../code.pg\n\n+code\n  | if (a < b && c > d) {}';
    var html = render(input);
    assert.ok(html.includes('<code>if (a < b && c > d) {}</code>'));
    assert.ok(!html.includes('&lt;'));
    assert.ok(!html.includes('&amp;'));
  });

  test('name is substituted single-pass: a nested #{...} stays literal', () => {
    var input = "include ../file-system.pg\n\n+file('a#{x}.js')";
    var html = render(input);
    assert.ok(html.includes('<code>a#{x}.js</code>'));
  });
});

describe('mixin attribute arguments ARE escaped (no breakout)', () => {
  test('breadcrumb href with a double quote is attribute-escaped', () => {
    var attack = '/x" onmouseover=alert(1) x="';
    var input =
      'include ../breadcrumb.pg\n' +
      '\n' +
      '+breadcrumbs\n' +
      "  +breadcrumb('" +
      attack +
      "') Evil";
    var html = render(input);
    assert.ok(html.includes('&quot;'));
    assert.ok(!html.includes('" onmouseover=alert(1)'));
  });

  test('quote url with an ampersand is escaped in cite and href', () => {
    var input =
      'include ../quote.pg\n' +
      '\n' +
      "+quote('https://e.com/?a=1&b=2')\n" +
      '  | t\n' +
      '  block source\n' +
      '    | Auth';
    var html = render(input);
    assert.ok(html.includes('cite="https://e.com/?a=1&amp;b=2"'));
    assert.ok(html.includes('href="https://e.com/?a=1&amp;b=2"'));
  });
});

describe('multi-word arguments require quoting', () => {
  test('+file-system(tree wide) splits and errors on argument count', () => {
    var input =
      'include ../file-system.pg\n\n+file-system(tree wide)\n  +file(a.js)';
    assert.throws(
      () => render(input),
      (err) => err.code === 'PUGNEUM:MIXIN_ARGUMENT_COUNT_MISMATCH',
    );
  });

  test("+file-system('tree wide') quoted keeps both classes", () => {
    var input =
      "include ../file-system.pg\n\n+file-system('tree wide')\n  +file(a.js)";
    var html = render(input);
    assert.ok(html.includes('<ul class="tree wide">'));
  });
});

describe('omitted vs empty-string class on +file-system', () => {
  test('omitted class renders no class attribute', () => {
    var input = 'include ../file-system.pg\n\n+file-system\n  +file(a.js)';
    var html = render(input);
    assert.ok(html.includes('<ul>'));
    assert.ok(!html.includes('class='));
  });

  test('empty-string class still renders an empty class attribute', () => {
    var input = "include ../file-system.pg\n\n+file-system('')\n  +file(a.js)";
    var html = render(input);
    assert.ok(html.includes('<ul class="">'));
  });
});

describe('required-looking arguments are optional and degrade silently', () => {
  test('+file with no name renders an empty <code>', () => {
    var input = 'include ../file-system.pg\n\n+file-system\n  +file';
    var html = render(input);
    assert.ok(html.includes('<li><code></code></li>'));
  });

  test('+breadcrumb with no href renders a non-link <a> (href dropped)', () => {
    var input = 'include ../breadcrumb.pg\n\n+breadcrumbs\n  +breadcrumb Home';
    var html = render(input);
    assert.ok(html.includes('<li><a>Home</a></li>'));
    assert.ok(!html.includes('href='));
  });

  test('+quote with a source slot but no url renders an href-less <a>', () => {
    var input =
      'include ../quote.pg\n' +
      '\n' +
      '+quote\n' +
      '  | t\n' +
      '  block source\n' +
      '    | Auth';
    var html = render(input);
    assert.ok(html.includes('<blockquote>'));
    assert.ok(!html.includes('cite='));
    assert.ok(html.includes('<cite><a>Auth</a></cite>'));
  });
});

describe('directory child list (leaf directory)', () => {
  // A directory drawn with no child entries still emits the wrapping <ul>,
  // because the children fill the mixin's UNNAMED block and `given` keys
  // only off NAMED blocks. This pins the current shape so any change to it
  // is intentional.
  test('leaf directory emits an empty child <ul>', () => {
    var input = 'include ../file-system.pg\n\n+file-system\n  +directory(src)';
    var html = render(input);
    assert.ok(html.includes('<li><code>src</code><ul></ul></li>'));
  });

  test('directory with children fills the child <ul>', () => {
    var input =
      'include ../file-system.pg\n' +
      '\n' +
      '+file-system\n' +
      '  +directory(src)\n' +
      '    +file(a.js)';
    var html = render(input);
    assert.ok(
      html.includes('<code>src</code><ul><li><code>a.js</code></li></ul>'),
    );
  });
});

describe('degenerate figure/code output (content slot empty)', () => {
  test('caption-only +figure emits figcaption but no body', () => {
    var input =
      'include ../figure.pg\n' +
      '\n' +
      '+figure\n' +
      '  block caption\n' +
      '    | Caption only';
    var html = render(input);
    assert.strictEqual(
      html,
      '<figure><figcaption>Caption only</figcaption></figure>',
    );
  });

  test('caption-only +code emits an empty <pre><code>', () => {
    var input =
      'include ../code.pg\n' +
      '\n' +
      '+code\n' +
      '  block caption\n' +
      '    | Just a caption';
    var html = render(input);
    assert.ok(html.includes('<pre><code></code></pre>'));
    assert.ok(html.includes('<figcaption>Just a caption</figcaption>'));
  });
});
