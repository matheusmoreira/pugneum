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
  return fs
    .readdirSync(testCasesDir)
    .filter((f) => f.endsWith('.pg'))
    .map((f) => f.replace('.pg', ''));
}

describe('render()', () => {
  it('should render a simple tag', () => {
    assert.strictEqual(pg.render('h1 Hello'), '<!DOCTYPE html><h1>Hello</h1>');
  });

  it('should render nested tags', () => {
    var input = 'div\n  p Hello';
    assert.strictEqual(
      pg.render(input),
      '<!DOCTYPE html><div><p>Hello</p></div>',
    );
  });

  it('should render attributes', () => {
    var input = 'a(href="/home") Home';
    assert.strictEqual(
      pg.render(input),
      '<!DOCTYPE html><a href="/home">Home</a>',
    );
  });

  it('should render id shorthand', () => {
    assert.strictEqual(
      pg.render('#main'),
      '<!DOCTYPE html><div id="main"></div>',
    );
  });

  it('should render class shorthand', () => {
    assert.strictEqual(
      pg.render('.container'),
      '<!DOCTYPE html><div class="container"></div>',
    );
  });

  it('should render self-closing tags', () => {
    assert.strictEqual(pg.render('br'), '<!DOCTYPE html><br>');
    assert.strictEqual(
      pg.render('img(src="a.png")'),
      '<!DOCTYPE html><img src="a.png">',
    );
    assert.strictEqual(pg.render('hr'), '<!DOCTYPE html><hr>');
  });

  it('should render buffered comments', () => {
    assert.strictEqual(
      pg.render('// comment'),
      '<!DOCTYPE html><!-- comment-->',
    );
  });

  it('should suppress unbuffered comments', () => {
    assert.strictEqual(pg.render('//- hidden'), '<!DOCTYPE html>');
  });

  it('should render text blocks', () => {
    var input = 'p.\n  Line 1\n  Line 2';
    assert.strictEqual(
      pg.render(input),
      '<!DOCTYPE html><p>Line 1\nLine 2</p>',
    );
  });

  it('should render multiple classes', () => {
    assert.strictEqual(
      pg.render('.a.b.c'),
      '<!DOCTYPE html><div class="a b c"></div>',
    );
  });

  it('should render boolean attributes', () => {
    assert.strictEqual(
      pg.render('input(disabled)'),
      '<!DOCTYPE html><input disabled>',
    );
  });
});

describe('reference links', () => {
  it('should resolve @[name] to <a> with identifier as text', () => {
    var input = 'references\n  example https://example.com\n\np @[example]';
    assert.strictEqual(
      pg.render(input),
      '<!DOCTYPE html><p><a href="https://example.com">example</a></p>',
    );
  });

  it('should use explicit link text when provided', () => {
    var input =
      "references\n  gc https://example.com/gc\n\np @[gc Baby's First Garbage Collector]";
    assert.strictEqual(
      pg.render(input),
      '<!DOCTYPE html><p><a href="https://example.com/gc">Baby\'s First Garbage Collector</a></p>',
    );
  });

  it('should resolve multiple references', () => {
    var input =
      'references\n  one https://one.com\n  two https://two.com\n\np @[one] and @[two]';
    assert.strictEqual(
      pg.render(input),
      '<!DOCTYPE html><p><a href="https://one.com">one</a> and <a href="https://two.com">two</a></p>',
    );
  });

  it('should work inline in prose', () => {
    var input =
      'references\n  docs https://docs.com\n\np Read @[docs the docs] today.';
    assert.strictEqual(
      pg.render(input),
      '<!DOCTYPE html><p>Read <a href="https://docs.com">the docs</a> today.</p>',
    );
  });

  it('should support forward references', () => {
    var input =
      'p @[example click here]\n\nreferences\n  example https://example.com';
    assert.strictEqual(
      pg.render(input),
      '<!DOCTYPE html><p><a href="https://example.com">click here</a></p>',
    );
  });

  it('should work in text blocks', () => {
    var input =
      'references\n  ex https://example.com\n\np.\n  Visit @[ex the site] now.';
    assert.strictEqual(
      pg.render(input),
      '<!DOCTYPE html><p>Visit <a href="https://example.com">the site</a> now.</p>',
    );
  });

  it('should escape \\@[ as literal text', () => {
    assert.strictEqual(
      pg.render('p \\@[not a ref]'),
      '<!DOCTYPE html><p>@[not a ref]</p>',
    );
  });

  it('should support quoted URLs with spaces', () => {
    var input = "references\n  ex 'https://example.com/a b'\n\np @[ex]";
    assert.strictEqual(
      pg.render(input),
      '<!DOCTYPE html><p><a href="https://example.com/a b">ex</a></p>',
    );
  });

  it('should work inside #(...) interpolation', () => {
    var input =
      'references\n  docs https://docs.com\n\np #(em check @[docs the docs] out)';
    assert.strictEqual(
      pg.render(input),
      '<!DOCTYPE html><p><em>check <a href="https://docs.com">the docs</a> out</em></p>',
    );
  });

  it('should handle ![...] inside @[...] without premature ] close', () => {
    var input =
      'references\n  docs /docs\n  logo /logo.png\n\np @[docs click ![logo icon] here]';
    assert.strictEqual(
      pg.render(input),
      '<!DOCTYPE html><p><a href="/docs">click ![logo icon] here</a></p>',
    );
  });

  it('should handle @[...] inside ![...] without premature ] close', () => {
    var input =
      'references\n  docs /docs\n  logo /logo.png\n\np ![logo alt @[docs link] end]';
    assert.strictEqual(
      pg.render(input),
      '<!DOCTYPE html><p><img src="/logo.png" alt="alt @[docs link] end"></p>',
    );
  });

  it('should produce no output for the references block itself', () => {
    var input = 'references\n  ex https://example.com';
    assert.strictEqual(pg.render(input), '<!DOCTYPE html>');
  });

  it('should use default text when no explicit text is provided', () => {
    var input =
      'references\n  docs https://docs.com Documentation\n\np @[docs]';
    assert.strictEqual(
      pg.render(input),
      '<!DOCTYPE html><p><a href="https://docs.com">Documentation</a></p>',
    );
  });

  it('should use explicit text over default text', () => {
    var input =
      'references\n  docs https://docs.com Documentation\n\np @[docs click here]';
    assert.strictEqual(
      pg.render(input),
      '<!DOCTYPE html><p><a href="https://docs.com">click here</a></p>',
    );
  });

  it('should use default text for reference images', () => {
    var input = 'references\n  logo /logo.png Pugneum Logo\n\np ![logo]';
    assert.strictEqual(
      pg.render(input),
      '<!DOCTYPE html><p><img src="/logo.png" alt="Pugneum Logo"></p>',
    );
  });

  it('should support default text with quoted URLs', () => {
    var input =
      "references\n  ex 'https://example.com/path with spaces' Example Site\n\np @[ex]";
    assert.strictEqual(
      pg.render(input),
      '<!DOCTYPE html><p><a href="https://example.com/path with spaces">Example Site</a></p>',
    );
  });

  it('should throw for undefined reference links', () => {
    assert.throws(
      () => pg.render('p @[missing]'),
      /Undefined reference 'missing'/,
    );
  });

  it('should throw for undefined reference images', () => {
    assert.throws(
      () => pg.render('p ![missing]'),
      /Undefined reference 'missing'/,
    );
  });

  it('should support (attrs) after @[...]', () => {
    var input =
      'references\n  ex https://example.com\n\np @[ex click](class="cite")';
    assert.strictEqual(
      pg.render(input),
      '<!DOCTYPE html><p><a class="cite" href="https://example.com">click</a></p>',
    );
  });

  it('should support multiple custom attributes', () => {
    var input =
      'references\n  ex https://example.com\n\np @[ex click](target="_blank" rel="noopener")';
    assert.strictEqual(
      pg.render(input),
      '<!DOCTYPE html><p><a href="https://example.com" target="_blank" rel="noopener">click</a></p>',
    );
  });

  it('should support (attrs) with default text', () => {
    var input =
      'references\n  ex https://example.com\n\np @[ex](class="external")';
    assert.strictEqual(
      pg.render(input),
      '<!DOCTYPE html><p><a class="external" href="https://example.com">ex</a></p>',
    );
  });

  it('should treat bare [ as literal in link text', () => {
    var input =
      'references\n  mdn https://developer.mozilla.org\n\np @[mdn see [ bracket]';
    assert.strictEqual(
      pg.render(input),
      '<!DOCTYPE html><p><a href="https://developer.mozilla.org">see [ bracket</a></p>',
    );
  });

  it('should unescape \\] to literal ] in link text', () => {
    var input =
      'references\n  mdn https://developer.mozilla.org\n\np @[mdn text \\] more]';
    assert.strictEqual(
      pg.render(input),
      '<!DOCTYPE html><p><a href="https://developer.mozilla.org">text ] more</a></p>',
    );
  });

  it('should unescape \\[ and \\] in link text', () => {
    var input =
      'references\n  mdn https://developer.mozilla.org\n\np @[mdn Array\\[0\\]]';
    assert.strictEqual(
      pg.render(input),
      '<!DOCTYPE html><p><a href="https://developer.mozilla.org">Array[0]</a></p>',
    );
  });

  it('should unescape \\\\ to literal backslash before brackets', () => {
    var input = 'references\n  ex https://example.com\n\np @[ex text \\\\]';
    assert.strictEqual(
      pg.render(input),
      '<!DOCTYPE html><p><a href="https://example.com">text \\</a></p>',
    );
  });

  it('should handle #(...) interpolation inside ref link text', () => {
    var input =
      'references\n  docs https://docs.com\n\np @[docs text with #(em emphasis) end]';
    assert.strictEqual(
      pg.render(input),
      '<!DOCTYPE html><p><a href="https://docs.com">text with #(em emphasis) end</a></p>',
    );
  });
});

describe('image shorthand', () => {
  it('should render basic image', () => {
    assert.strictEqual(
      pg.render('p !(/photo.jpg A photo)'),
      '<!DOCTYPE html><p><img src="/photo.jpg" alt="A photo"></p>',
    );
  });

  it('should use empty alt for decorative image when no alt provided', () => {
    assert.strictEqual(
      pg.render('p !(/logo.png)'),
      '<!DOCTYPE html><p><img src="/logo.png" alt=""></p>',
    );
  });

  it('should support quoted URLs with spaces', () => {
    assert.strictEqual(
      pg.render("p !('/my image.jpg' Photo)"),
      '<!DOCTYPE html><p><img src="/my image.jpg" alt="Photo"></p>',
    );
  });

  it('should support custom attributes after shorthand', () => {
    assert.strictEqual(
      pg.render('p !(/hero.jpg Hero)(class="hero")'),
      '<!DOCTYPE html><p><img class="hero" src="/hero.jpg" alt="Hero"></p>',
    );
  });

  it('should support multiple custom attributes', () => {
    assert.strictEqual(
      pg.render('p !(/img.jpg Alt)(class="lazy" loading="lazy")'),
      '<!DOCTYPE html><p><img class="lazy" src="/img.jpg" alt="Alt" loading="lazy"></p>',
    );
  });

  it('should work inline in text', () => {
    assert.strictEqual(
      pg.render('p See !(/cat.jpg a cat) here.'),
      '<!DOCTYPE html><p>See <img src="/cat.jpg" alt="a cat"> here.</p>',
    );
  });

  it('should escape \\!( as literal text', () => {
    assert.strictEqual(
      pg.render('p \\!(not an image)'),
      '<!DOCTYPE html><p>!(not an image)</p>',
    );
  });

  it('should work inside #(...) interpolation', () => {
    assert.strictEqual(
      pg.render('p #(span !(/icon.png icon))'),
      '<!DOCTYPE html><p><span><img src="/icon.png" alt="icon"></span></p>',
    );
  });

  it('should work in text blocks', () => {
    assert.strictEqual(
      pg.render('p.\n  Image: !(/x.png alt text)'),
      '<!DOCTYPE html><p>Image: <img src="/x.png" alt="alt text"></p>',
    );
  });

  it('should unescape \\( and \\) in unquoted content', () => {
    assert.strictEqual(
      pg.render('p !(photo_\\(1\\).jpg Alt)'),
      '<!DOCTYPE html><p><img src="photo_(1).jpg" alt="Alt"></p>',
    );
  });
});

describe('variables in attributes', () => {
  it('should resolve #{var} in attribute values', () => {
    assert.strictEqual(
      pg.render('mixin link(url)\n  a(href="#{url}") Click\n+link(/home)'),
      '<!DOCTYPE html><a href="/home">Click</a>',
    );
  });

  it('should resolve multiple variables in one value', () => {
    assert.strictEqual(
      pg.render(
        'mixin tag(cls id)\n  div(class="#{cls}" id="#{id}")\n+tag(main header)',
      ),
      '<!DOCTYPE html><div class="main" id="header"></div>',
    );
  });

  it('should mix literal text with variables', () => {
    assert.strictEqual(
      pg.render(
        'mixin item(name)\n  div(class="item-#{name}") #{name}\n+item(active)',
      ),
      '<!DOCTYPE html><div class="item-active">active</div>',
    );
  });

  it('should resolve variables from parent mixin scope', () => {
    assert.strictEqual(
      pg.render(
        'mixin inner()\n  span(data-x="#{x}")\nmixin outer(x)\n  +inner()\n+outer(hello)',
      ),
      '<!DOCTYPE html><span data-x="hello"></span>',
    );
  });

  it('should escape \\#{var} as literal text', () => {
    assert.strictEqual(
      pg.render(
        'mixin test(x)\n  div(data-template="\\\\#{x}") Hi\n+test(val)',
      ),
      '<!DOCTYPE html><div data-template="#{x}">Hi</div>',
    );
  });

  it('should error on #{var} outside mixin', () => {
    assert.throws(
      () => pg.render('div(data-x="#{oops}")'),
      (err) => err.code === 'PUGNEUM:CALL_STACK_UNDERFLOW',
    );
  });

  it('should error on undefined variable in attribute', () => {
    assert.throws(
      () => pg.render('mixin test(a)\n  div(data-x="#{b}")\n+test(val)'),
      (err) => err.code === 'PUGNEUM:UNDEFINED_VARIABLE',
    );
  });

  it('should pass through #{...} with non-word chars unchanged', () => {
    assert.strictEqual(
      pg.render('mixin test(x)\n  div(data-x="#{x}") #{ }\n+test(val)'),
      '<!DOCTYPE html><div data-x="val">#{ }</div>',
    );
  });
});

describe('inline mixin calls', () => {
  it('should render mixin inline in text', () => {
    assert.strictEqual(
      pg.render('mixin b(text)\n  strong #{text}\n\np I am #(+b(very)) happy.'),
      '<!DOCTYPE html><p>I am <strong>very</strong> happy.</p>',
    );
  });

  it('should support multiple inline calls in one line', () => {
    assert.strictEqual(
      pg.render('mixin b(t)\n  strong #{t}\n\np #(+b(a)) and #(+b(b))'),
      '<!DOCTYPE html><p><strong>a</strong> and <strong>b</strong></p>',
    );
  });

  it('should support inline mixin with no args', () => {
    assert.strictEqual(
      pg.render('mixin sep()\n  span |\n\np A #(+sep()) B'),
      '<!DOCTYPE html><p>A <span>|</span> B</p>',
    );
  });

  it('should support inline mixin with block content', () => {
    assert.strictEqual(
      pg.render(
        'mixin wrap()\n  span.w\n    block\n\np #(+wrap() #(em hi)) end',
      ),
      '<!DOCTYPE html><p><span class="w"><em>hi</em></span> end</p>',
    );
  });

  it('should work in text blocks', () => {
    assert.strictEqual(
      pg.render(
        'mixin code(name)\n  code #{name}\n\np.\n  Use #(+code(div)) elements.',
      ),
      '<!DOCTYPE html><p>Use <code>div</code> elements.</p>',
    );
  });

  it('should work with #{var} in attributes', () => {
    assert.strictEqual(
      pg.render(
        'mixin link(url text)\n  a(href="#{url}") #{text}\n\np Go #(+link(/x here))',
      ),
      '<!DOCTYPE html><p>Go <a href="/x">here</a></p>',
    );
  });
});

describe('interpolated tags', () => {
  it('should handle balanced parentheses in text content', () => {
    assert.strictEqual(
      pg.render('p #(strong text (with parens) more)'),
      '<!DOCTYPE html><p><strong>text (with parens) more</strong></p>',
    );
  });

  it('should handle escaped shorthands with parens inside interpolation', () => {
    assert.strictEqual(
      pg.render('p *(text \\#(em inner) end)'),
      '<!DOCTYPE html><p><strong>text #(em inner) end</strong></p>',
    );
  });

  it('should handle escaped shorthands inside link shorthand', () => {
    assert.strictEqual(
      pg.render('p @(url text \\#(not interp) end)'),
      '<!DOCTYPE html><p><a href="url">text #(not interp) end</a></p>',
    );
  });

  it('should handle multiple escaped shorthands inside interpolation', () => {
    assert.strictEqual(
      pg.render('p #(em \\@(a) \\@(b) text)'),
      '<!DOCTYPE html><p><em>@(a) @(b) text</em></p>',
    );
  });

  it('should handle escaped shorthands with balanced parens between them', () => {
    assert.strictEqual(
      pg.render('p #(em \\@(a) (parens) \\@(b) text)'),
      '<!DOCTYPE html><p><em>@(a) (parens) @(b) text</em></p>',
    );
  });

  it('should handle escaped shorthands inside balanced parens', () => {
    assert.strictEqual(
      pg.render('p #(em (before \\@(inner) after) text)'),
      '<!DOCTYPE html><p><em>(before @(inner) after) text</em></p>',
    );
  });

  it('should handle mixed real and escaped shorthands', () => {
    assert.strictEqual(
      pg.render('p #(em *(real) \\@(escaped) text)'),
      '<!DOCTYPE html><p><em><strong>real</strong> @(escaped) text</em></p>',
    );
  });

  it('should handle multiple escaped shorthands inside interpolation', () => {
    assert.strictEqual(
      pg.render('p #(em \\@(a) \\@(b) text)'),
      '<!DOCTYPE html><p><em>@(a) @(b) text</em></p>',
    );
  });

  it('should handle three escaped shorthands of different types', () => {
    assert.strictEqual(
      pg.render('p #(em \\@(a) \\*(b) \\_(c) text)'),
      '<!DOCTYPE html><p><em>@(a) *(b) _(c) text</em></p>',
    );
  });

  it('should handle escaped shorthand with nested parens in content', () => {
    assert.strictEqual(
      pg.render('p #(em \\@(fn()) text)'),
      '<!DOCTYPE html><p><em>@(fn()) text</em></p>',
    );
  });

  it('should handle escaped shorthand as only content before close', () => {
    assert.strictEqual(
      pg.render('p #(em \\@(only))'),
      '<!DOCTYPE html><p><em>@(only)</em></p>',
    );
  });

  it('should handle adjacent escaped shorthands with no space', () => {
    assert.strictEqual(
      pg.render('p #(em \\@(a)\\*(b) text)'),
      '<!DOCTYPE html><p><em>@(a)*(b) text</em></p>',
    );
  });

  it('should handle escaped shorthands in strong child lexer', () => {
    assert.strictEqual(
      pg.render('p *(bold \\@(escaped) end)'),
      '<!DOCTYPE html><p><strong>bold @(escaped) end</strong></p>',
    );
  });

  it('should handle multiple escaped shorthands in emphasis child lexer', () => {
    assert.strictEqual(
      pg.render('p _(\\@(a) \\@(b) \\@(c))'),
      '<!DOCTYPE html><p><em>@(a) @(b) @(c)</em></p>',
    );
  });

  it('should handle deeply nested escaped shorthand', () => {
    assert.strictEqual(
      pg.render('p #(strong *(text \\@(x) end))'),
      '<!DOCTYPE html><p><strong><strong>text @(x) end</strong></strong></p>',
    );
  });
});

describe('del/ins/sup/kbd/sub shorthands', () => {
  it('should render ~(del) shorthand', () => {
    assert.strictEqual(
      pg.render('p ~(deleted)'),
      '<!DOCTYPE html><p><del>deleted</del></p>',
    );
  });

  it('should render &(ins) shorthand', () => {
    assert.strictEqual(
      pg.render('p &(inserted)'),
      '<!DOCTYPE html><p><ins>inserted</ins></p>',
    );
  });

  it('should render ~(del) and &(ins) together', () => {
    assert.strictEqual(
      pg.render('p Returns ~(NULL) &(nullptr).'),
      '<!DOCTYPE html><p>Returns <del>NULL</del> <ins>nullptr</ins>.</p>',
    );
  });

  it('should render escaped \\&( as literal', () => {
    assert.strictEqual(
      pg.render('p \\&(not ins)'),
      '<!DOCTYPE html><p>&(not ins)</p>',
    );
  });

  it('should render ^(sup) shorthand', () => {
    assert.strictEqual(
      pg.render('p x^(2)'),
      '<!DOCTYPE html><p>x<sup>2</sup></p>',
    );
  });

  it('should render %(kbd) shorthand', () => {
    assert.strictEqual(
      pg.render('p %(Ctrl+C)'),
      '<!DOCTYPE html><p><kbd>Ctrl+C</kbd></p>',
    );
  });

  it('should render ,(sub) shorthand', () => {
    assert.strictEqual(
      pg.render('p H,(2)O'),
      '<!DOCTYPE html><p>H<sub>2</sub>O</p>',
    );
  });

  it('should render escaped \\~( \\^( \\%( \\,( as literal', () => {
    assert.strictEqual(
      pg.render('p \\~(not del) \\^(not sup) \\%(not kbd)'),
      '<!DOCTYPE html><p>~(not del) ^(not sup) %(not kbd)</p>',
    );
    assert.strictEqual(
      pg.render('p \\,(not sub)'),
      '<!DOCTYPE html><p>,(not sub)</p>',
    );
  });

  it('should render nested sup and sub', () => {
    assert.strictEqual(
      pg.render('p x^(2),(i)'),
      '<!DOCTYPE html><p>x<sup>2</sup><sub>i</sub></p>',
    );
  });

  it('should render nested del/sup/kbd shorthands', () => {
    assert.strictEqual(
      pg.render('p *(strong ~(deleted))'),
      '<!DOCTYPE html><p><strong>strong <del>deleted</del></strong></p>',
    );
  });

  it('should render escaped \\^[ as literal text', () => {
    assert.strictEqual(
      pg.render('p \\^[not a footnote]'),
      '<!DOCTYPE html><p>^[not a footnote]</p>',
    );
  });
});

describe('variable edge cases', () => {
  it('should render #{var} followed by @[ref] without space', () => {
    assert.strictEqual(
      pg.render(
        'references\n  ex https://example.com\nmixin foo(v)\n  p #{v}@[ex]\n+foo(test)',
      ),
      '<!DOCTYPE html><p>test<a href="https://example.com">ex</a></p>',
    );
  });

  it('should render #{var} followed by @[ref] with space', () => {
    assert.strictEqual(
      pg.render(
        'references\n  ex https://example.com\nmixin foo(v)\n  p #{v} @[ex click]\n+foo(test)',
      ),
      '<!DOCTYPE html><p>test <a href="https://example.com">click</a></p>',
    );
  });

  it('should render #{var} followed by @() link shorthand', () => {
    assert.strictEqual(
      pg.render('mixin foo(v)\n  p #{v} @(/url link)\n+foo(test)'),
      '<!DOCTYPE html><p>test <a href="/url">link</a></p>',
    );
  });

  it('should resolve hyphenated variable names in text', () => {
    assert.strictEqual(
      pg.render('mixin foo(my-var)\n  p #{my-var}\n+foo(hello)'),
      '<!DOCTYPE html><p>hello</p>',
    );
  });

  it('should resolve hyphenated variable names in attributes', () => {
    assert.strictEqual(
      pg.render('mixin foo(my-var)\n  a(href="#{my-var}") link\n+foo(/url)'),
      '<!DOCTYPE html><a href="/url">link</a>',
    );
  });

  it('should handle quoted mixin arg with spaces', () => {
    assert.strictEqual(
      pg.render('mixin foo(a)\n  p #{a}\n+foo("hello, world")'),
      '<!DOCTYPE html><p>hello, world</p>',
    );
  });

  it('should handle escaped quotes in mixin args', () => {
    assert.strictEqual(
      pg.render('mixin foo(a)\n  p #{a}\n+foo("say \\"hi\\"")'),
      '<!DOCTYPE html><p>say "hi"</p>',
    );
  });

  it('should handle escaped quotes in mixin default values', () => {
    assert.strictEqual(
      pg.render('mixin foo(a="it\\"s")\n  p #{a}\n+foo'),
      '<!DOCTYPE html><p>it"s</p>',
    );
  });
});

describe('link shorthand', () => {
  it('should render basic link', () => {
    assert.strictEqual(
      pg.render('p @(/contact contact us)'),
      '<!DOCTYPE html><p><a href="/contact">contact us</a></p>',
    );
  });

  it('should use URL as text when no text provided', () => {
    assert.strictEqual(
      pg.render('p @(https://example.com)'),
      '<!DOCTYPE html><p><a href="https://example.com">https://example.com</a></p>',
    );
  });

  it('should work inline in text', () => {
    assert.strictEqual(
      pg.render('p Visit @(https://example.com our site) today.'),
      '<!DOCTYPE html><p>Visit <a href="https://example.com">our site</a> today.</p>',
    );
  });

  it('should escape \\@( as literal text', () => {
    assert.strictEqual(
      pg.render('p \\@(not a link)'),
      '<!DOCTYPE html><p>@(not a link)</p>',
    );
  });

  it('should unescape \\( and \\) in unquoted content', () => {
    assert.strictEqual(
      pg.render('p @(https://example.com/Rust_\\(language\\) Rust)'),
      '<!DOCTYPE html><p><a href="https://example.com/Rust_(language)">Rust</a></p>',
    );
  });
});

describe('footnotes', () => {
  it('should render a basic footnote', () => {
    const result = pg.render('p Note^[fn1].\n\nfootnotes\n  fn1 Content.');
    assert.match(result, /<sup><a href="#footnote-fn1"/);
    assert.match(result, /id="footnote-reference-fn1"/);
    assert.match(result, /role="doc-noteref"/);
    assert.match(result, /\[1\]<\/a><\/sup>/);
    assert.match(result, /<section role="doc-endnotes">/);
    assert.match(result, /<li id="footnote-fn1" role="doc-endnote">/);
    assert.match(result, /Content\./);
    assert.match(result, /role="doc-backlink"/);
    assert.match(result, /↩<\/a>/);
  });

  it('should throw UNDEFINED_FOOTNOTE for unknown reference', () => {
    assert.throws(
      () => pg.render('p ^[unknown]\n\nfootnotes\n  other Content.'),
      (err) => err.code === 'PUGNEUM:UNDEFINED_FOOTNOTE',
    );
  });

  it('should throw DUPLICATE_FOOTNOTE for duplicate definitions', () => {
    assert.throws(
      () => pg.render('p ^[dup]\n\nfootnotes\n  dup First.\n  dup Second.'),
      (err) => err.code === 'PUGNEUM:DUPLICATE_FOOTNOTE',
    );
  });

  it('should number footnotes by order of appearance', () => {
    const result = pg.render(
      'p First^[beta] then^[alpha].\n\nfootnotes\n  alpha Alpha.\n  beta Beta.',
    );
    assert.match(result, /First<sup><a[^>]*>\[1\]/);
    assert.match(result, /then<sup><a[^>]*>\[2\]/);
  });

  it('should render repeated references with same number and multiple back-links', () => {
    const result = pg.render('p A^[x] and B^[x].\n\nfootnotes\n  x Shared.');
    var markers = result.match(/\[1\]/g);
    assert.strictEqual(markers.length, 2);
    assert.match(result, /↩<\/a>/);
    assert.match(result, /↩²<\/a>/);
    assert.match(result, /id="footnote-reference-x"/);
    assert.match(result, /id="footnote-reference-x-2"/);
  });

  it('should support inline shorthands in footnote content', () => {
    const result = pg.render(
      'p Note^[fn1].\n\nfootnotes\n  fn1 This is *(important).',
    );
    assert.match(result, /<strong>important<\/strong>/);
  });

  it('should work with footnotes block before call sites', () => {
    const result = pg.render('footnotes\n  fn1 Content.\n\np Note^[fn1].');
    assert.match(result, /\[1\]<\/a><\/sup>/);
    assert.match(result, /<li id="footnote-fn1"/);
    assert.match(result, /Content\./);
  });

  it('should handle empty footnotes block without crashing', () => {
    const result = pg.render('p Text.\n\nfootnotes');
    assert.doesNotMatch(result, /section/);
    assert.match(result, /<p>Text.<\/p>/);
  });

  it('should throw UNDEFINED_FOOTNOTE when no footnotes block exists', () => {
    assert.throws(
      () => pg.render('p ^[missing].'),
      (err) => err.code === 'PUGNEUM:UNDEFINED_FOOTNOTE',
    );
  });

  it('should throw DUPLICATE_FOOTNOTES_BLOCK for multiple blocks', () => {
    assert.throws(
      () =>
        pg.render('p ^[a].\n\nfootnotes\n  a First.\n\nfootnotes\n  b Second.'),
      (err) => err.code === 'PUGNEUM:DUPLICATE_FOOTNOTES_BLOCK',
    );
  });

  it('should suppress section when no footnotes are referenced', () => {
    const result = pg.render('p No refs.\n\nfootnotes\n  unused Content.');
    assert.doesNotMatch(result, /section/);
    assert.doesNotMatch(result, /footnote/);
  });

  it('should resolve footnote refs inside definition content', () => {
    const result = pg.render(
      'p Start^[fn1].\n\nfootnotes\n  fn1 See also^[fn2].\n  fn2 Second.',
    );
    assert.match(result, /\[1\]/);
    assert.match(result, /\[2\]/);
    assert.match(result, /<li id="footnote-fn1"/);
    assert.match(result, /<li id="footnote-fn2"/);
  });

  it('should not render orphan footnotes with internal cross-refs', () => {
    const result = pg.render(
      'p Clean text.\n\nfootnotes\n  orphan1 See^[orphan2].\n  orphan2 Content.',
    );
    assert.doesNotMatch(result, /section/);
    assert.doesNotMatch(result, /footnote/);
  });
});

describe('table of contents', () => {
  it('should generate nav with links to headings that have IDs', () => {
    const result = pg.render(
      'toc\n\nh2#intro Introduction\np Text.\nh2#design Design',
    );
    assert.match(
      result,
      /<nav role="doc-toc"><ol><li><a href="#intro">Introduction<\/a><\/li><li><a href="#design">Design<\/a><\/li><\/ol><\/nav>/,
    );
  });

  it('should exclude headings without IDs', () => {
    const result = pg.render(
      'toc\n\nh2#included Included\nh2 Excluded\nh2#also Also',
    );
    assert.match(result, /href="#included"/);
    assert.match(result, /href="#also"/);
    // "Excluded" appears in the body but must not appear as a nav link
    assert.doesNotMatch(result, /href="#excluded"/);
    assert.doesNotMatch(result, /<a[^>]*>Excluded<\/a>/);
  });

  it('should nest deeper headings', () => {
    const result = pg.render(
      'toc\n\nh2#a Section\nh3#b Subsection\nh2#c Another',
    );
    assert.match(
      result,
      /<li><a href="#a">Section<\/a><ol><li><a href="#b">Subsection<\/a><\/li><\/ol><\/li>/,
    );
  });

  it('should produce empty output when no headings have IDs', () => {
    const result = pg.render('toc\n\nh2 No ID\np Text.');
    assert.doesNotMatch(result, /nav/);
  });

  it('should work with toc placed after headings', () => {
    const result = pg.render('h2#first First\np Text.\n\ntoc');
    assert.match(result, /href="#first"/);
  });
});

describe('abbr shorthand', () => {
  it('should render ?(abbr expansion) as <abbr>', () => {
    assert.strictEqual(
      pg.render('p ?(HTML Hypertext Markup Language)'),
      '<!DOCTYPE html><p><abbr title="Hypertext Markup Language">HTML</abbr></p>',
    );
  });

  it('should render ?(abbr) without expansion', () => {
    assert.strictEqual(
      pg.render('p ?(CPU)'),
      '<!DOCTYPE html><p><abbr>CPU</abbr></p>',
    );
  });

  it('should render escaped \\?( as literal', () => {
    assert.strictEqual(
      pg.render('p \\?(not abbr)'),
      '<!DOCTYPE html><p>?(not abbr)</p>',
    );
  });

  it('should nest inside other shorthands', () => {
    assert.strictEqual(
      pg.render('p The *(?(API Application Programming Interface)) is stable.'),
      '<!DOCTYPE html><p>The <strong><abbr title="Application Programming Interface">API</abbr></strong> is stable.</p>',
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

  cases.forEach((name) => {
    var htmlPath = path.join(testCasesDir, name + '.html');

    // Only test cases that have an expected .html output file
    if (!fs.existsSync(htmlPath)) return;

    it(name, () => {
      var pgPath = path.join(testCasesDir, name + '.pg');
      var expected = fs
        .readFileSync(htmlPath, 'utf8')
        .trim()
        .replace(/\r/g, '');
      var options = {filename: pgPath, basedir: testCasesDir};
      var actual = pg.renderFile(pgPath, options);
      assert.strictEqual(actual.trim(), expected);
    });
  });
});
