'use strict';

var assert = require('node:assert/strict');
var {describe, it} = require('node:test');
var fs = require('fs');
var path = require('path');
var pg = require('../');

// Load test cases from the root test-cases/ directory.
// Each .pg file has a corresponding .html file with expected output.
var testCasesDir = path.resolve(__dirname, '../../../test-cases');

function getTestCases() {
  return fs.readdirSync(testCasesDir)
    .filter(f => f.endsWith('.pg'))
    .map(f => f.replace('.pg', ''));
}

describe('render()', () => {
  it('should render a simple tag', () => {
    assert.strictEqual(pg.render('h1 Hello'), '<!DOCTYPE html><h1>Hello</h1>');
  });

  it('should render nested tags', () => {
    var input = 'div\n  p Hello';
    assert.strictEqual(pg.render(input), '<!DOCTYPE html><div><p>Hello</p></div>');
  });

  it('should render attributes', () => {
    var input = 'a(href="/home") Home';
    assert.strictEqual(pg.render(input), '<!DOCTYPE html><a href="/home">Home</a>');
  });

  it('should render id shorthand', () => {
    assert.strictEqual(pg.render('#main'), '<!DOCTYPE html><div id="main"></div>');
  });

  it('should render class shorthand', () => {
    assert.strictEqual(pg.render('.container'), '<!DOCTYPE html><div class="container"></div>');
  });

  it('should render self-closing tags', () => {
    assert.strictEqual(pg.render('br'), '<!DOCTYPE html><br>');
    assert.strictEqual(pg.render('img(src="a.png")'), '<!DOCTYPE html><img src="a.png">');
    assert.strictEqual(pg.render('hr'), '<!DOCTYPE html><hr>');
  });

  it('should render buffered comments', () => {
    assert.strictEqual(pg.render('// comment'), '<!DOCTYPE html><!-- comment-->');
  });

  it('should suppress unbuffered comments', () => {
    assert.strictEqual(pg.render('//- hidden'), '<!DOCTYPE html>');
  });

  it('should render text blocks', () => {
    var input = 'p.\n  Line 1\n  Line 2';
    assert.strictEqual(pg.render(input), '<!DOCTYPE html><p>Line 1\nLine 2</p>');
  });

  it('should render multiple classes', () => {
    assert.strictEqual(pg.render('.a.b.c'), '<!DOCTYPE html><div class="a b c"></div>');
  });

  it('should render boolean attributes', () => {
    assert.match(pg.render('input(disabled)'), /disabled/);
  });
});

describe('reference links', () => {
  it('should resolve @[name] to <a> with identifier as text', () => {
    var input = 'references\n  example https://example.com\n\np @[example]';
    assert.strictEqual(pg.render(input),
      '<!DOCTYPE html><p><a href="https://example.com">example</a></p>'
    );
  });

  it('should use explicit link text when provided', () => {
    var input = 'references\n  gc https://example.com/gc\n\np @[gc Baby\'s First Garbage Collector]';
    assert.strictEqual(pg.render(input),
      '<!DOCTYPE html><p><a href="https://example.com/gc">Baby\'s First Garbage Collector</a></p>'
    );
  });

  it('should resolve multiple references', () => {
    var input = 'references\n  one https://one.com\n  two https://two.com\n\np @[one] and @[two]';
    assert.strictEqual(pg.render(input),
      '<!DOCTYPE html><p><a href="https://one.com">one</a> and <a href="https://two.com">two</a></p>'
    );
  });

  it('should work inline in prose', () => {
    var input = 'references\n  docs https://docs.com\n\np Read @[docs the docs] today.';
    assert.strictEqual(pg.render(input),
      '<!DOCTYPE html><p>Read <a href="https://docs.com">the docs</a> today.</p>'
    );
  });

  it('should support forward references', () => {
    var input = 'p @[example click here]\n\nreferences\n  example https://example.com';
    assert.strictEqual(pg.render(input),
      '<!DOCTYPE html><p><a href="https://example.com">click here</a></p>'
    );
  });

  it('should work in text blocks', () => {
    var input = 'references\n  ex https://example.com\n\np.\n  Visit @[ex the site] now.';
    assert.strictEqual(pg.render(input),
      '<!DOCTYPE html><p>Visit <a href="https://example.com">the site</a> now.</p>'
    );
  });

  it('should escape \\@[ as literal text', () => {
    assert.strictEqual(pg.render('p \\@[not a ref]'),
      '<!DOCTYPE html><p>@[not a ref]</p>'
    );
  });

  it('should support quoted URLs with spaces', () => {
    var input = "references\n  ex 'https://example.com/a b'\n\np @[ex]";
    assert.strictEqual(pg.render(input),
      '<!DOCTYPE html><p><a href="https://example.com/a b">ex</a></p>'
    );
  });

  it('should work inside #[...] interpolation', () => {
    var input = 'references\n  docs https://docs.com\n\np #[em check @[docs the docs] out]';
    assert.strictEqual(pg.render(input),
      '<!DOCTYPE html><p><em>check <a href="https://docs.com">the docs</a> out</em></p>'
    );
  });

  it('should produce no output for the references block itself', () => {
    var input = 'references\n  ex https://example.com';
    assert.strictEqual(pg.render(input), '<!DOCTYPE html>');
  });

  it('should throw for undefined references', () => {
    assert.throws(() => pg.render('p @[missing]'), /Undefined reference 'missing'/);
  });

  it('should support (attrs) after @[...]', () => {
    var input = 'references\n  ex https://example.com\n\np @[ex click](class="cite")';
    assert.strictEqual(pg.render(input),
      '<!DOCTYPE html><p><a class="cite" href="https://example.com">click</a></p>'
    );
  });

  it('should support multiple custom attributes', () => {
    var input = 'references\n  ex https://example.com\n\np @[ex click](target="_blank" rel="noopener")';
    assert.strictEqual(pg.render(input),
      '<!DOCTYPE html><p><a href="https://example.com" target="_blank" rel="noopener">click</a></p>'
    );
  });

  it('should support (attrs) with default text', () => {
    var input = 'references\n  ex https://example.com\n\np @[ex](class="external")';
    assert.strictEqual(pg.render(input),
      '<!DOCTYPE html><p><a class="external" href="https://example.com">ex</a></p>'
    );
  });

  it('should treat bare [ as literal in link text', () => {
    var input = 'references\n  mdn https://developer.mozilla.org\n\np @[mdn see [ bracket]';
    assert.strictEqual(pg.render(input),
      '<!DOCTYPE html><p><a href="https://developer.mozilla.org">see [ bracket</a></p>'
    );
  });

  it('should unescape \\] to literal ] in link text', () => {
    var input = 'references\n  mdn https://developer.mozilla.org\n\np @[mdn text \\] more]';
    assert.strictEqual(pg.render(input),
      '<!DOCTYPE html><p><a href="https://developer.mozilla.org">text ] more</a></p>'
    );
  });

  it('should unescape \\[ and \\] in link text', () => {
    var input = 'references\n  mdn https://developer.mozilla.org\n\np @[mdn Array\\[0\\]]';
    assert.strictEqual(pg.render(input),
      '<!DOCTYPE html><p><a href="https://developer.mozilla.org">Array[0]</a></p>'
    );
  });

  it('should unescape \\\\ to literal backslash before brackets', () => {
    var input = 'references\n  ex https://example.com\n\np @[ex text \\\\]';
    assert.strictEqual(pg.render(input),
      '<!DOCTYPE html><p><a href="https://example.com">text \\</a></p>'
    );
  });
});

describe('image shorthand', () => {
  it('should render basic image', () => {
    assert.strictEqual(pg.render('p !(/photo.jpg A photo)'),
      '<!DOCTYPE html><p><img src="/photo.jpg" alt="A photo"></p>'
    );
  });

  it('should use URL as alt text when no alt provided', () => {
    assert.strictEqual(pg.render('p !(/logo.png)'),
      '<!DOCTYPE html><p><img src="/logo.png" alt="/logo.png"></p>'
    );
  });

  it('should support quoted URLs with spaces', () => {
    assert.strictEqual(pg.render("p !('/my image.jpg' Photo)"),
      "<!DOCTYPE html><p><img src=\"/my image.jpg\" alt=\"Photo\"></p>"
    );
  });

  it('should support custom attributes after shorthand', () => {
    assert.strictEqual(pg.render('p !(/hero.jpg Hero)(class="hero")'),
      '<!DOCTYPE html><p><img class="hero" src="/hero.jpg" alt="Hero"></p>'
    );
  });

  it('should support multiple custom attributes', () => {
    assert.strictEqual(pg.render('p !(/img.jpg Alt)(class="lazy" loading="lazy")'),
      '<!DOCTYPE html><p><img class="lazy" src="/img.jpg" alt="Alt" loading="lazy"></p>'
    );
  });

  it('should work inline in text', () => {
    assert.strictEqual(pg.render('p See !(/cat.jpg a cat) here.'),
      '<!DOCTYPE html><p>See <img src="/cat.jpg" alt="a cat"> here.</p>'
    );
  });

  it('should escape \\!( as literal text', () => {
    assert.strictEqual(pg.render('p \\!(not an image)'),
      '<!DOCTYPE html><p>!(not an image)</p>'
    );
  });

  it('should work inside #[...] interpolation', () => {
    assert.strictEqual(pg.render('p #[span !(/icon.png icon)]'),
      '<!DOCTYPE html><p><span><img src="/icon.png" alt="icon"></span></p>'
    );
  });

  it('should work in text blocks', () => {
    assert.strictEqual(pg.render('p.\n  Image: !(/x.png alt text)'),
      '<!DOCTYPE html><p>Image: <img src="/x.png" alt="alt text"></p>'
    );
  });

  it('should unescape \\( and \\) in unquoted content', () => {
    assert.strictEqual(pg.render('p !(photo_\\(1\\).jpg Alt)'),
      '<!DOCTYPE html><p><img src="photo_(1).jpg" alt="Alt"></p>'
    );
  });
});

describe('variables in attributes', () => {
  it('should resolve #{var} in attribute values', () => {
    assert.strictEqual(
      pg.render('mixin link(url)\n  a(href="#{url}") Click\n+link(/home)'),
      '<!DOCTYPE html><a href="/home">Click</a>'
    );
  });

  it('should resolve multiple variables in one value', () => {
    assert.strictEqual(
      pg.render('mixin tag(cls id)\n  div(class="#{cls}" id="#{id}")\n+tag(main header)'),
      '<!DOCTYPE html><div class="main" id="header"></div>'
    );
  });

  it('should mix literal text with variables', () => {
    assert.strictEqual(
      pg.render('mixin item(name)\n  div(class="item-#{name}") #{name}\n+item(active)'),
      '<!DOCTYPE html><div class="item-active">active</div>'
    );
  });

  it('should resolve variables from parent mixin scope', () => {
    assert.strictEqual(
      pg.render('mixin inner()\n  span(data-x="#{x}")\nmixin outer(x)\n  +inner()\n+outer(hello)'),
      '<!DOCTYPE html><span data-x="hello"></span>'
    );
  });

  it('should escape \\#{var} as literal text', () => {
    assert.strictEqual(
      pg.render('mixin test(x)\n  div(data-template="\\\\#{x}") Hi\n+test(val)'),
      '<!DOCTYPE html><div data-template="#{x}">Hi</div>'
    );
  });

  it('should error on #{var} outside mixin', () => {
    assert.throws(
      () => pg.render('div(data-x="#{oops}")'),
      (err) => err.code === 'PUGNEUM:CALL_STACK_UNDERFLOW'
    );
  });

  it('should error on undefined variable in attribute', () => {
    assert.throws(
      () => pg.render('mixin test(a)\n  div(data-x="#{b}")\n+test(val)'),
      (err) => err.code === 'PUGNEUM:UNDEFINED_VARIABLE'
    );
  });

  it('should pass through #{...} with non-word chars unchanged', () => {
    assert.strictEqual(
      pg.render('mixin test(x)\n  div(data-x="#{x}") #{ }\n+test(val)'),
      '<!DOCTYPE html><div data-x="val">#{ }</div>'
    );
  });
});

describe('inline mixin calls', () => {
  it('should render mixin inline in text', () => {
    assert.strictEqual(
      pg.render('mixin b(text)\n  strong #{text}\n\np I am #[+b(very)] happy.'),
      '<!DOCTYPE html><p>I am <strong>very</strong> happy.</p>'
    );
  });

  it('should support multiple inline calls in one line', () => {
    assert.strictEqual(
      pg.render('mixin b(t)\n  strong #{t}\n\np #[+b(a)] and #[+b(b)]'),
      '<!DOCTYPE html><p><strong>a</strong> and <strong>b</strong></p>'
    );
  });

  it('should support inline mixin with no args', () => {
    assert.strictEqual(
      pg.render('mixin sep()\n  span |\n\np A #[+sep()] B'),
      '<!DOCTYPE html><p>A <span>|</span> B</p>'
    );
  });

  it('should support inline mixin with block content', () => {
    assert.strictEqual(
      pg.render('mixin wrap()\n  span.w\n    block\n\np #[+wrap() #[em hi]] end'),
      '<!DOCTYPE html><p><span class="w"><em>hi</em></span> end</p>'
    );
  });

  it('should work in text blocks', () => {
    assert.strictEqual(
      pg.render('mixin code(name)\n  code #{name}\n\np.\n  Use #[+code(div)] elements.'),
      '<!DOCTYPE html><p>Use <code>div</code> elements.</p>'
    );
  });

  it('should work with #{var} in attributes', () => {
    assert.strictEqual(
      pg.render('mixin link(url text)\n  a(href="#{url}") #{text}\n\np Go #[+link(/x here)]'),
      '<!DOCTYPE html><p>Go <a href="/x">here</a></p>'
    );
  });
});

describe('variable edge cases', () => {
  it('should render #{var} followed by @[ref] without space', () => {
    assert.strictEqual(
      pg.render('references\n  ex https://example.com\nmixin foo(v)\n  p #{v}@[ex]\n+foo(test)'),
      '<!DOCTYPE html><p>test<a href="https://example.com">ex</a></p>'
    );
  });

  it('should render #{var} followed by @[ref] with space', () => {
    assert.strictEqual(
      pg.render('references\n  ex https://example.com\nmixin foo(v)\n  p #{v} @[ex click]\n+foo(test)'),
      '<!DOCTYPE html><p>test <a href="https://example.com">click</a></p>'
    );
  });

  it('should render #{var} followed by @() link shorthand', () => {
    assert.strictEqual(
      pg.render('mixin foo(v)\n  p #{v} @(/url link)\n+foo(test)'),
      '<!DOCTYPE html><p>test <a href="/url">link</a></p>'
    );
  });

  it('should resolve hyphenated variable names in text', () => {
    assert.strictEqual(
      pg.render('mixin foo(my-var)\n  p #{my-var}\n+foo(hello)'),
      '<!DOCTYPE html><p>hello</p>'
    );
  });

  it('should resolve hyphenated variable names in attributes', () => {
    assert.strictEqual(
      pg.render('mixin foo(my-var)\n  a(href="#{my-var}") link\n+foo(/url)'),
      '<!DOCTYPE html><a href="/url">link</a>'
    );
  });

  it('should handle quoted mixin arg with spaces', () => {
    assert.strictEqual(
      pg.render('mixin foo(a)\n  p #{a}\n+foo("hello, world")'),
      '<!DOCTYPE html><p>hello, world</p>'
    );
  });

  it('should handle escaped quotes in mixin args', () => {
    assert.strictEqual(
      pg.render('mixin foo(a)\n  p #{a}\n+foo("say \\"hi\\"")'),
      '<!DOCTYPE html><p>say "hi"</p>'
    );
  });

  it('should handle escaped quotes in mixin default values', () => {
    assert.strictEqual(
      pg.render('mixin foo(a="it\\"s")\n  p #{a}\n+foo'),
      '<!DOCTYPE html><p>it"s</p>'
    );
  });
});

describe('link shorthand', () => {
  it('should render basic link', () => {
    assert.strictEqual(pg.render('p @(/contact contact us)'),
      '<!DOCTYPE html><p><a href="/contact">contact us</a></p>'
    );
  });

  it('should use URL as text when no text provided', () => {
    assert.strictEqual(pg.render('p @(https://example.com)'),
      '<!DOCTYPE html><p><a href="https://example.com">https://example.com</a></p>'
    );
  });

  it('should work inline in text', () => {
    assert.strictEqual(pg.render('p Visit @(https://example.com our site) today.'),
      '<!DOCTYPE html><p>Visit <a href="https://example.com">our site</a> today.</p>'
    );
  });

  it('should escape \\@( as literal text', () => {
    assert.strictEqual(pg.render('p \\@(not a link)'),
      '<!DOCTYPE html><p>@(not a link)</p>'
    );
  });

  it('should unescape \\( and \\) in unquoted content', () => {
    assert.strictEqual(
      pg.render('p @(https://example.com/Rust_\\(language\\) Rust)'),
      '<!DOCTYPE html><p><a href="https://example.com/Rust_(language)">Rust</a></p>'
    );
  });
});

describe('renderFile()', () => {
  var filePath = path.join(testCasesDir, 'basic.pg');

  it('should render a file from disk', () => {
    var result = pg.renderFile(filePath);
    assert.strictEqual(typeof result, 'string');
    assert.match(result, /<!DOCTYPE html>/);
  });
});

// Run each .pg test case from test-cases/ that has a matching .html file
describe('test-cases/', () => {
  var cases = getTestCases();

  cases.forEach(name => {
    var htmlPath = path.join(testCasesDir, name + '.html');

    // Only test cases that have an expected .html output file
    if (!fs.existsSync(htmlPath)) return;

    it(name, () => {
      var pgPath = path.join(testCasesDir, name + '.pg');
      var expected = fs.readFileSync(htmlPath, 'utf8').trim().replace(/\r/g, '');
      var options = {filename: pgPath, basedir: testCasesDir};
      var actual = pg.renderFile(pgPath, options);
      assert.strictEqual(actual.trim(), expected);
    });
  });
});
