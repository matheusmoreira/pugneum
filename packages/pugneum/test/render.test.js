'use strict';

var assert = require('node:assert/strict');
var crypto = require('node:crypto');
var {describe, it} = require('node:test');
var fs = require('fs');
var os = require('os');
var path = require('path');
var pg = require('../');

var testCasesDir = path.resolve(__dirname, '../../../test-cases');
var fixtureManifest = require('../../../test-cases/manifest.json');
var observedDependencies = new Set();

function fixturePath(filename) {
  var absolute = path.resolve(filename);
  if (!absolute.startsWith(testCasesDir + path.sep)) return null;
  return path.relative(testCasesDir, absolute).split(path.sep).join('/');
}

function listFixtureFiles(directory) {
  var files = [];
  fs.readdirSync(directory, {withFileTypes: true}).forEach((entry) => {
    var absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFixtureFiles(absolute));
    else if (entry.isFile()) files.push(fixturePath(absolute));
  });
  return files;
}

function declaredFixtureFiles() {
  var files = ['manifest.json'];
  fixtureManifest.render.forEach((name) => {
    files.push(name + '.pg', name + '.html');
  });
  files.push(...fixtureManifest.syntax, ...fixtureManifest.dependencies);
  files.push(...Object.values(fixtureManifest.warningOracles));
  return files;
}

function assertFixtureInventory(actual, declared) {
  assert.deepStrictEqual(actual.slice().sort(), declared.slice().sort());
}

function renderAndTraceDependencies(sourcePath, options) {
  var source = fixturePath(sourcePath);
  var readFileSync = fs.readFileSync;
  fs.readFileSync = function (filename) {
    if (typeof filename === 'string') {
      var relative = fixturePath(filename);
      if (relative && relative !== source) observedDependencies.add(relative);
    }
    return readFileSync.apply(this, arguments);
  };

  try {
    return pg.renderFile(sourcePath, options);
  } finally {
    fs.readFileSync = readFileSync;
  }
}

function serializeWarning(warning) {
  var filename = fixturePath(warning.filename);
  return {
    code: warning.code,
    msg: warning.msg,
    line: warning.line,
    column: warning.column,
    filename,
    source: warning.source,
    message: warning.message.replace(warning.filename, filename),
  };
}

describe('render()', () => {
  it('should render a simple tag', () => {
    assert.strictEqual(pg.render('h1 Hello'), '<h1>Hello</h1>');
  });

  it('should render nested tags', () => {
    var input = 'div\n  p Hello';
    assert.strictEqual(pg.render(input), '<div><p>Hello</p></div>');
  });

  it('should render attributes', () => {
    var input = 'a(href="/home") Home';
    assert.strictEqual(pg.render(input), '<a href="/home">Home</a>');
  });

  it('should render id shorthand', () => {
    assert.strictEqual(pg.render('#main'), '<div id="main"></div>');
  });

  it('should render class shorthand', () => {
    assert.strictEqual(
      pg.render('.container'),
      '<div class="container"></div>',
    );
  });

  it('should render self-closing tags', () => {
    assert.strictEqual(pg.render('br'), '<br>');
    assert.strictEqual(pg.render('img(src="a.png")'), '<img src="a.png">');
    assert.strictEqual(pg.render('hr'), '<hr>');
  });

  it('should render buffered comments', () => {
    assert.strictEqual(pg.render('// comment'), '<!-- comment-->');
  });

  it('should suppress unbuffered comments', () => {
    assert.strictEqual(pg.render('//- hidden'), '');
  });

  it('should render text blocks', () => {
    var input = 'p.\n  Line 1\n  Line 2';
    assert.strictEqual(pg.render(input), '<p>Line 1\nLine 2</p>');
  });

  it('should render multiple classes', () => {
    assert.strictEqual(pg.render('.a.b.c'), '<div class="a b c"></div>');
  });

  it('should render boolean attributes', () => {
    assert.strictEqual(pg.render('input(disabled)'), '<input disabled>');
  });

  it('keeps direct mixin-variable suffixes in their source container', () => {
    var input = [
      'mixin show(x)',
      '  div',
      '    p#{x} tail',
      '    p#{x}#{x}',
      '    p#{x}tail',
      '    p #{x} tail',
      '    p#{x}*(bold)',
      '  #{x}tail',
      '+show(V)',
    ].join('\n');

    assert.strictEqual(
      pg.render(input),
      '<div>' +
        '<p>V tail</p>' +
        '<p>VV</p>' +
        '<p>Vtail</p>' +
        '<p>V tail</p>' +
        '<p>V<strong>bold</strong></p>' +
        '</div>' +
        'Vtail',
    );
  });
});

describe('documented escaping', () => {
  it('matches every escape-table row in ordinary text', () => {
    var escapeCases = [
      ['\\@(value)', '@(value)'],
      ['\\!(value)', '!(value)'],
      ['\\*(value)', '*(value)'],
      ['\\_(value)', '_(value)'],
      ['\\`(value)', '`(value)'],
      ['\\~(value)', '~(value)'],
      ['\\&(value)', '&(value)'],
      ['\\^(value)', '^(value)'],
      ['\\%(value)', '%(value)'],
      ['\\,(value)', ',(value)'],
      ['\\?(value)', '?(value)'],
      ['\\@[value]', '@[value]'],
      ['\\![value]', '![value]'],
      ['\\^[value]', '^[value]'],
      ['\\#{value}', '#{value}'],
      ['\\#(value)', '#(value)'],
    ];

    escapeCases.forEach(function (escapeCase) {
      assert.strictEqual(
        pg.render('p ' + escapeCase[0]),
        '<p>' + escapeCase[1] + '</p>',
        escapeCase[0],
      );
    });
  });

  it('defines the context boundary for the interpolation escape', () => {
    assert.strictEqual(pg.render('p.\n  \\#{name}'), '<p>#{name}</p>');
    assert.strictEqual(
      pg.render('p(data-template="\\#{name}") value'),
      '<p data-template="#{name}">value</p>',
    );
    assert.strictEqual(
      pg.render('p `(\\#{name})'),
      '<p><code>#{name}</code></p>',
    );
    assert.strictEqual(pg.render(':verbatim\n  \\#{name}'), '\\#{name}');
  });
});

describe('doctype end-of-line padding', () => {
  it('does not render spaces or tabs accepted before newline or EOF', () => {
    const cases = [
      ['doctype html', '<!DOCTYPE html>'],
      ['doctype html   ', '<!DOCTYPE html>'],
      ['doctype html\t ', '<!DOCTYPE html>'],
      ['doctype html\np x', '<!DOCTYPE html><p>x</p>'],
      ['doctype html   \np x', '<!DOCTYPE html><p>x</p>'],
      ['doctype html\t \np x', '<!DOCTYPE html><p>x</p>'],
    ];

    cases.forEach(([source, expected]) => {
      assert.strictEqual(pg.render(source), expected, source);
    });
  });
});

describe('reference links', () => {
  it('should resolve @[name] to <a> with identifier as text', () => {
    var input = 'references\n  example https://example.com\n\np @[example]';
    assert.strictEqual(
      pg.render(input),
      '<p><a href="https://example.com">example</a></p>',
    );
  });

  it('should use explicit link text when provided', () => {
    var input =
      "references\n  gc https://example.com/gc\n\np @[gc Baby's First Garbage Collector]";
    assert.strictEqual(
      pg.render(input),
      '<p><a href="https://example.com/gc">Baby\'s First Garbage Collector</a></p>',
    );
  });

  it('should resolve multiple references', () => {
    var input =
      'references\n  one https://one.com\n  two https://two.com\n\np @[one] and @[two]';
    assert.strictEqual(
      pg.render(input),
      '<p><a href="https://one.com">one</a> and <a href="https://two.com">two</a></p>',
    );
  });

  it('should work inline in prose', () => {
    var input =
      'references\n  docs https://docs.com\n\np Read @[docs the docs] today.';
    assert.strictEqual(
      pg.render(input),
      '<p>Read <a href="https://docs.com">the docs</a> today.</p>',
    );
  });

  it('should support forward references', () => {
    var input =
      'p @[example click here]\n\nreferences\n  example https://example.com';
    assert.strictEqual(
      pg.render(input),
      '<p><a href="https://example.com">click here</a></p>',
    );
  });

  it('should work in text blocks', () => {
    var input =
      'references\n  ex https://example.com\n\np.\n  Visit @[ex the site] now.';
    assert.strictEqual(
      pg.render(input),
      '<p>Visit <a href="https://example.com">the site</a> now.</p>',
    );
  });

  it('should escape \\@[ as literal text', () => {
    assert.strictEqual(pg.render('p \\@[not a ref]'), '<p>@[not a ref]</p>');
  });

  it('should support quoted URLs with spaces', () => {
    var input = "references\n  ex 'https://example.com/a b'\n\np @[ex]";
    assert.strictEqual(
      pg.render(input),
      '<p><a href="https://example.com/a b">ex</a></p>',
    );
  });

  it('should work inside #(...) interpolation', () => {
    var input =
      'references\n  docs https://docs.com\n\np #(em check @[docs the docs] out)';
    assert.strictEqual(
      pg.render(input),
      '<p><em>check <a href="https://docs.com">the docs</a> out</em></p>',
    );
  });

  it('should handle ![...] inside @[...] without premature ] close', () => {
    var input =
      'references\n  docs /docs\n  logo /logo.png\n\np @[docs click ![logo icon] here]';
    assert.strictEqual(
      pg.render(input),
      '<p><a href="/docs">click ![logo icon] here</a></p>',
    );
  });

  it('should handle @[...] inside ![...] without premature ] close', () => {
    var input =
      'references\n  docs /docs\n  logo /logo.png\n\np ![logo alt @[docs link] end]';
    assert.strictEqual(
      pg.render(input),
      '<p><img src="/logo.png" alt="alt @[docs link] end"></p>',
    );
  });

  it('should handle ^[...] inside @[...] without premature ] close', () => {
    // Define `note` as a real footnote and thread a warnings collector (so the
    // UNUSED_FOOTNOTE diagnostic does not leak to stderr). The footnote ref must
    // stay literal inside link text — proven by the literal output AND by the
    // footnote remaining unused (it was never actually expanded as a reference).
    var warnings = [];
    var input =
      'references\n  docs /docs\nfootnotes\n  note A note.\n\np @[docs text ^[note] end]';
    assert.strictEqual(
      pg.render(input, {filename: 't.pg', warnings: warnings}),
      '<p><a href="/docs">text ^[note] end</a></p>',
    );
    assert.ok(
      warnings.some((w) => w.code === 'PUGNEUM:UNUSED_FOOTNOTE'),
      'footnote ref inside link text must stay literal (footnote unused)',
    );
  });

  it('should produce no output for the references block itself', () => {
    var input = 'references\n  ex https://example.com';
    assert.strictEqual(pg.render(input), '');
  });

  it('should use default text when no explicit text is provided', () => {
    var input =
      'references\n  docs https://docs.com Documentation\n\np @[docs]';
    assert.strictEqual(
      pg.render(input),
      '<p><a href="https://docs.com">Documentation</a></p>',
    );
  });

  it('should use explicit text over default text', () => {
    var input =
      'references\n  docs https://docs.com Documentation\n\np @[docs click here]';
    assert.strictEqual(
      pg.render(input),
      '<p><a href="https://docs.com">click here</a></p>',
    );
  });

  it('should use default text for reference images', () => {
    var input = 'references\n  logo /logo.png Pugneum Logo\n\np ![logo]';
    assert.strictEqual(
      pg.render(input),
      '<p><img src="/logo.png" alt="Pugneum Logo"></p>',
    );
  });

  it('should support default text with quoted URLs', () => {
    var input =
      "references\n  ex 'https://example.com/path with spaces' Example Site\n\np @[ex]";
    assert.strictEqual(
      pg.render(input),
      '<p><a href="https://example.com/path with spaces">Example Site</a></p>',
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
      '<p><a class="cite" href="https://example.com">click</a></p>',
    );
  });

  it('should support multiple custom attributes', () => {
    var input =
      'references\n  ex https://example.com\n\np @[ex click](target="_blank" rel="noopener")';
    assert.strictEqual(
      pg.render(input),
      '<p><a href="https://example.com" target="_blank" rel="noopener">click</a></p>',
    );
  });

  it('should support (attrs) with default text', () => {
    var input =
      'references\n  ex https://example.com\n\np @[ex](class="external")';
    assert.strictEqual(
      pg.render(input),
      '<p><a class="external" href="https://example.com">ex</a></p>',
    );
  });

  it('should treat bare [ as literal in link text', () => {
    var input =
      'references\n  mdn https://developer.mozilla.org\n\np @[mdn see [ bracket]';
    assert.strictEqual(
      pg.render(input),
      '<p><a href="https://developer.mozilla.org">see [ bracket</a></p>',
    );
  });

  it('should unescape \\] to literal ] in link text', () => {
    var input =
      'references\n  mdn https://developer.mozilla.org\n\np @[mdn text \\] more]';
    assert.strictEqual(
      pg.render(input),
      '<p><a href="https://developer.mozilla.org">text ] more</a></p>',
    );
  });

  it('should unescape \\[ and \\] in link text', () => {
    var input =
      'references\n  mdn https://developer.mozilla.org\n\np @[mdn Array\\[0\\]]';
    assert.strictEqual(
      pg.render(input),
      '<p><a href="https://developer.mozilla.org">Array[0]</a></p>',
    );
  });

  it('should unescape \\\\ to literal backslash before brackets', () => {
    var input = 'references\n  ex https://example.com\n\np @[ex text \\\\]';
    assert.strictEqual(
      pg.render(input),
      '<p><a href="https://example.com">text \\</a></p>',
    );
  });

  it('should handle #(...) interpolation inside ref link text', () => {
    var input =
      'references\n  docs https://docs.com\n\np @[docs text with #(em emphasis) end]';
    assert.strictEqual(
      pg.render(input),
      '<p><a href="https://docs.com">text with <em>emphasis</em> end</a></p>',
    );
  });
});

describe('image shorthand', () => {
  it('should render basic image', () => {
    assert.strictEqual(
      pg.render('p !(/photo.jpg A photo)'),
      '<p><img src="/photo.jpg" alt="A photo"></p>',
    );
  });

  it('should use empty alt for decorative image when no alt provided', () => {
    assert.strictEqual(
      pg.render('p !(/logo.png)'),
      '<p><img src="/logo.png" alt=""></p>',
    );
  });

  it('should support quoted URLs with spaces', () => {
    assert.strictEqual(
      pg.render("p !('/my image.jpg' Photo)"),
      '<p><img src="/my image.jpg" alt="Photo"></p>',
    );
  });

  it('should support custom attributes after shorthand', () => {
    assert.strictEqual(
      pg.render('p !(/hero.jpg Hero)(class="hero")'),
      '<p><img class="hero" src="/hero.jpg" alt="Hero"></p>',
    );
  });

  it('should support multiple custom attributes', () => {
    assert.strictEqual(
      pg.render('p !(/img.jpg Alt)(class="lazy" loading="lazy")'),
      '<p><img class="lazy" src="/img.jpg" alt="Alt" loading="lazy"></p>',
    );
  });

  it('should work inline in text', () => {
    assert.strictEqual(
      pg.render('p See !(/cat.jpg a cat) here.'),
      '<p>See <img src="/cat.jpg" alt="a cat"> here.</p>',
    );
  });

  it('should escape \\!( as literal text', () => {
    assert.strictEqual(
      pg.render('p \\!(not an image)'),
      '<p>!(not an image)</p>',
    );
  });

  it('should work inside #(...) interpolation', () => {
    assert.strictEqual(
      pg.render('p #(span !(/icon.png icon))'),
      '<p><span><img src="/icon.png" alt="icon"></span></p>',
    );
  });

  it('should work in text blocks', () => {
    assert.strictEqual(
      pg.render('p.\n  Image: !(/x.png alt text)'),
      '<p>Image: <img src="/x.png" alt="alt text"></p>',
    );
  });

  it('should unescape \\( and \\) in unquoted content', () => {
    assert.strictEqual(
      pg.render('p !(photo_\\(1\\).jpg Alt)'),
      '<p><img src="photo_(1).jpg" alt="Alt"></p>',
    );
  });
});

describe('mixin parameter bindings', () => {
  it('keeps case-distinct parameter names and positions independent', () => {
    assert.strictEqual(
      pg.render(
        'mixin pair(value Value)\n  p #{value} #{Value}\n+pair(lower upper)',
      ),
      '<p>lower upper</p>',
    );
  });
});

describe('filter option validation', () => {
  it('rejects a source filename option before invoking the filter', () => {
    var calls = 0;
    assert.throws(
      () =>
        pg.render(':probe(filename=claimed.pg)\n  body', {
          filename: 'main.pg',
          warnings: [],
          filters: {
            probe: {
              type: 'html',
              filter() {
                calls++;
                return '';
              },
            },
          },
        }),
      (err) =>
        err.code === 'PUGNEUM:RESERVED_FILTER_OPTION' &&
        err.filename === 'main.pg' &&
        err.line === 1 &&
        err.column === 8,
    );
    assert.strictEqual(calls, 0);
  });
});

describe('variables in attributes', () => {
  it('should resolve #{var} in attribute values', () => {
    assert.strictEqual(
      pg.render('mixin link(url)\n  a(href="#{url}") Click\n+link(/home)'),
      '<a href="/home">Click</a>',
    );
  });

  it('should resolve multiple variables in one value', () => {
    assert.strictEqual(
      pg.render(
        'mixin tag(cls id)\n  div(class="#{cls}" id="#{id}")\n+tag(main header)',
      ),
      '<div class="main" id="header"></div>',
    );
  });

  it('should mix literal text with variables', () => {
    assert.strictEqual(
      pg.render(
        'mixin item(name)\n  div(class="item-#{name}") #{name}\n+item(active)',
      ),
      '<div class="item-active">active</div>',
    );
  });

  it('should resolve variables from parent mixin scope', () => {
    assert.strictEqual(
      pg.render(
        'mixin inner()\n  span(data-x="#{x}")\nmixin outer(x)\n  +inner()\n+outer(hello)',
      ),
      '<span data-x="hello"></span>',
    );
  });

  it('should escape \\#{var} as literal text', () => {
    assert.strictEqual(
      pg.render(
        'mixin test(x)\n  div(data-template="\\\\#{x}") Hi\n+test(val)',
      ),
      '<div data-template="#{x}">Hi</div>',
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

  it('should pass through explicitly escaped #{...} with non-name chars', () => {
    assert.strictEqual(
      pg.render('mixin test(x)\n  div(data-x="#{x}") \\#{ }\n+test(val)'),
      '<div data-x="val">#{ }</div>',
    );
  });
});

describe('inline mixin calls', () => {
  it('should render mixin inline in text', () => {
    assert.strictEqual(
      pg.render('mixin b(text)\n  strong #{text}\n\np I am #(+b(very)) happy.'),
      '<p>I am <strong>very</strong> happy.</p>',
    );
  });

  it('should support multiple inline calls in one line', () => {
    assert.strictEqual(
      pg.render('mixin b(t)\n  strong #{t}\n\np #(+b(a)) and #(+b(b))'),
      '<p><strong>a</strong> and <strong>b</strong></p>',
    );
  });

  it('should support inline mixin with no args', () => {
    assert.strictEqual(
      pg.render('mixin sep()\n  span |\n\np A #(+sep()) B'),
      '<p>A <span>|</span> B</p>',
    );
  });

  it('should support inline mixin with block content', () => {
    assert.strictEqual(
      pg.render(
        'mixin wrap()\n  span.w\n    block\n\np #(+wrap() #(em hi)) end',
      ),
      '<p><span class="w"><em>hi</em></span> end</p>',
    );
  });

  it('should work in text blocks', () => {
    assert.strictEqual(
      pg.render(
        'mixin code(name)\n  code #{name}\n\np.\n  Use #(+code(div)) elements.',
      ),
      '<p>Use <code>div</code> elements.</p>',
    );
  });

  it('should work with #{var} in attributes', () => {
    assert.strictEqual(
      pg.render(
        'mixin link(url text)\n  a(href="#{url}") #{text}\n\np Go #(+link(/x here))',
      ),
      '<p>Go <a href="/x">here</a></p>',
    );
  });
});

describe('interpolated tags', () => {
  it('should handle balanced parentheses in text content', () => {
    assert.strictEqual(
      pg.render('p #(strong text (with parens) more)'),
      '<p><strong>text (with parens) more</strong></p>',
    );
  });

  it('should handle escaped shorthands with parens inside interpolation', () => {
    assert.strictEqual(
      pg.render('p *(text \\#(em inner) end)'),
      '<p><strong>text #(em inner) end</strong></p>',
    );
  });

  it('should handle escaped shorthands inside link shorthand', () => {
    assert.strictEqual(
      pg.render('p @(url text \\#(not interp) end)'),
      '<p><a href="url">text #(not interp) end</a></p>',
    );
  });

  it('should handle multiple escaped shorthands inside interpolation', () => {
    assert.strictEqual(
      pg.render('p #(em \\@(a) \\@(b) text)'),
      '<p><em>@(a) @(b) text</em></p>',
    );
  });

  it('should handle escaped shorthands with balanced parens between them', () => {
    assert.strictEqual(
      pg.render('p #(em \\@(a) (parens) \\@(b) text)'),
      '<p><em>@(a) (parens) @(b) text</em></p>',
    );
  });

  it('should handle escaped shorthands inside balanced parens', () => {
    assert.strictEqual(
      pg.render('p #(em (before \\@(inner) after) text)'),
      '<p><em>(before @(inner) after) text</em></p>',
    );
  });

  it('should handle mixed real and escaped shorthands', () => {
    assert.strictEqual(
      pg.render('p #(em *(real) \\@(escaped) text)'),
      '<p><em><strong>real</strong> @(escaped) text</em></p>',
    );
  });

  it('should handle three escaped shorthands of different types', () => {
    assert.strictEqual(
      pg.render('p #(em \\@(a) \\*(b) \\_(c) text)'),
      '<p><em>@(a) *(b) _(c) text</em></p>',
    );
  });

  it('should handle escaped shorthand with nested parens in content', () => {
    assert.strictEqual(
      pg.render('p #(em \\@(fn()) text)'),
      '<p><em>@(fn()) text</em></p>',
    );
  });

  it('should handle escaped shorthand as only content before close', () => {
    assert.strictEqual(
      pg.render('p #(em \\@(only))'),
      '<p><em>@(only)</em></p>',
    );
  });

  it('should handle adjacent escaped shorthands with no space', () => {
    assert.strictEqual(
      pg.render('p #(em \\@(a)\\*(b) text)'),
      '<p><em>@(a)*(b) text</em></p>',
    );
  });

  it('should handle escaped shorthands in strong child lexer', () => {
    assert.strictEqual(
      pg.render('p *(bold \\@(escaped) end)'),
      '<p><strong>bold @(escaped) end</strong></p>',
    );
  });

  it('should handle multiple escaped shorthands in emphasis child lexer', () => {
    assert.strictEqual(
      pg.render('p _(\\@(a) \\@(b) \\@(c))'),
      '<p><em>@(a) @(b) @(c)</em></p>',
    );
  });

  it('should handle deeply nested escaped shorthand', () => {
    assert.strictEqual(
      pg.render('p #(strong *(text \\@(x) end))'),
      '<p><strong><strong>text @(x) end</strong></strong></p>',
    );
  });
});

describe('del/ins/sup/kbd/sub shorthands', () => {
  it('should render ~(del) shorthand', () => {
    assert.strictEqual(pg.render('p ~(deleted)'), '<p><del>deleted</del></p>');
  });

  it('should render &(ins) shorthand', () => {
    assert.strictEqual(
      pg.render('p &(inserted)'),
      '<p><ins>inserted</ins></p>',
    );
  });

  it('should render ~(del) and &(ins) together', () => {
    assert.strictEqual(
      pg.render('p Returns ~(NULL) &(nullptr).'),
      '<p>Returns <del>NULL</del> <ins>nullptr</ins>.</p>',
    );
  });

  it('should render escaped \\&( as literal', () => {
    assert.strictEqual(pg.render('p \\&(not ins)'), '<p>&(not ins)</p>');
  });

  it('should render ^(sup) shorthand', () => {
    assert.strictEqual(pg.render('p x^(2)'), '<p>x<sup>2</sup></p>');
  });

  it('should render %(kbd) shorthand', () => {
    assert.strictEqual(pg.render('p %(Ctrl+C)'), '<p><kbd>Ctrl+C</kbd></p>');
  });

  it('should render ,(sub) shorthand', () => {
    assert.strictEqual(pg.render('p H,(2)O'), '<p>H<sub>2</sub>O</p>');
  });

  it('should render escaped \\~( \\^( \\%( \\,( as literal', () => {
    assert.strictEqual(
      pg.render('p \\~(not del) \\^(not sup) \\%(not kbd)'),
      '<p>~(not del) ^(not sup) %(not kbd)</p>',
    );
    assert.strictEqual(pg.render('p \\,(not sub)'), '<p>,(not sub)</p>');
  });

  it('should render nested sup and sub', () => {
    assert.strictEqual(
      pg.render('p x^(2),(i)'),
      '<p>x<sup>2</sup><sub>i</sub></p>',
    );
  });

  it('should render nested del/sup/kbd shorthands', () => {
    assert.strictEqual(
      pg.render('p *(strong ~(deleted))'),
      '<p><strong>strong <del>deleted</del></strong></p>',
    );
  });

  it('should render adjacent shorthands without boundary padding', () => {
    assert.strictEqual(
      pg.render('p *(one)*(two)*(three)'),
      '<p><strong>one</strong><strong>two</strong><strong>three</strong></p>',
    );
  });

  it('should render escaped \\^[ as literal text', () => {
    assert.strictEqual(
      pg.render('p \\^[not a footnote]'),
      '<p>^[not a footnote]</p>',
    );
  });
});

describe('variable edge cases', () => {
  it('should render #{var} followed by @[ref] without space', () => {
    assert.strictEqual(
      pg.render(
        'references\n  ex https://example.com\nmixin foo(v)\n  p #{v}@[ex]\n+foo(test)',
      ),
      '<p>test<a href="https://example.com">ex</a></p>',
    );
  });

  it('should render #{var} followed by @[ref] with space', () => {
    assert.strictEqual(
      pg.render(
        'references\n  ex https://example.com\nmixin foo(v)\n  p #{v} @[ex click]\n+foo(test)',
      ),
      '<p>test <a href="https://example.com">click</a></p>',
    );
  });

  it('should render #{var} followed by @() link shorthand', () => {
    assert.strictEqual(
      pg.render('mixin foo(v)\n  p #{v} @(/url link)\n+foo(test)'),
      '<p>test <a href="/url">link</a></p>',
    );
  });

  it('should resolve hyphenated variable names in text', () => {
    assert.strictEqual(
      pg.render('mixin foo(my-var)\n  p #{my-var}\n+foo(hello)'),
      '<p>hello</p>',
    );
  });

  it('should resolve hyphenated variable names in attributes', () => {
    assert.strictEqual(
      pg.render('mixin foo(my-var)\n  a(href="#{my-var}") link\n+foo(/url)'),
      '<a href="/url">link</a>',
    );
  });

  it('should handle quoted mixin arg with spaces', () => {
    assert.strictEqual(
      pg.render('mixin foo(a)\n  p #{a}\n+foo("hello, world")'),
      '<p>hello, world</p>',
    );
  });

  it('should handle escaped quotes in mixin args', () => {
    assert.strictEqual(
      pg.render('mixin foo(a)\n  p #{a}\n+foo("say \\"hi\\"")'),
      '<p>say "hi"</p>',
    );
  });

  it('should handle escaped quotes in mixin default values', () => {
    assert.strictEqual(
      pg.render('mixin foo(a="it\\"s")\n  p #{a}\n+foo'),
      '<p>it"s</p>',
    );
  });
});

describe('link shorthand', () => {
  it('should render basic link', () => {
    assert.strictEqual(
      pg.render('p @(/contact contact us)'),
      '<p><a href="/contact">contact us</a></p>',
    );
  });

  it('should use URL as text when no text provided', () => {
    assert.strictEqual(
      pg.render('p @(https://example.com)'),
      '<p><a href="https://example.com">https://example.com</a></p>',
    );
  });

  it('should work inline in text', () => {
    assert.strictEqual(
      pg.render('p Visit @(https://example.com our site) today.'),
      '<p>Visit <a href="https://example.com">our site</a> today.</p>',
    );
  });

  it('should escape \\@( as literal text', () => {
    assert.strictEqual(pg.render('p \\@(not a link)'), '<p>@(not a link)</p>');
  });

  it('should unescape \\( and \\) in unquoted content', () => {
    assert.strictEqual(
      pg.render('p @(https://example.com/Rust_\\(language\\) Rust)'),
      '<p><a href="https://example.com/Rust_(language)">Rust</a></p>',
    );
  });
});

describe('footnotes', () => {
  function renderedFootnoteBody(result, name) {
    const bodyMarker = '<li id="footnote-' + name + '" role="doc-endnote">';
    const bodyStart = result.indexOf(bodyMarker);
    const contentStart = bodyStart + bodyMarker.length;
    const backlinkStart = result.indexOf(
      '<a href="#footnote-reference-' + name + '"',
      contentStart,
    );
    assert.notStrictEqual(bodyStart, -1);
    assert.notStrictEqual(backlinkStart, -1);
    return result.slice(contentStart, backlinkStart);
  }

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

  it('should resolve attributed references in continued footnote content', () => {
    const warnings = [];
    const result = pg.render(
      [
        'references',
        '  doc https://example.test/doc',
        '  logo https://example.test/logo.png',
        '',
        'p Cite^[one].',
        '',
        'footnotes',
        '  one See @[doc documentation](class=source) and ![logo diagram](class=icon).',
        '    Continue ^[two].',
        '  two Next.',
      ].join('\n'),
      {filename: 'footnote.pg', warnings: warnings},
    );

    assert.strictEqual(
      renderedFootnoteBody(result, 'one'),
      'See <a class="source" href="https://example.test/doc">documentation</a> and ' +
        '<img class="icon" src="https://example.test/logo.png" alt="diagram">. Continue ' +
        '<sup><a href="#footnote-two" id="footnote-reference-two" role="doc-noteref">[2]</a></sup>.',
    );
    assert.strictEqual(renderedFootnoteBody(result, 'two'), 'Next.');
    assert.deepStrictEqual(warnings, []);
  });

  it('should render reference images and footnote refs in pipeless text', () => {
    const warnings = [];
    const result = pg.render(
      [
        'references',
        '  logo /logo.png',
        '',
        'p.',
        '  Before ![logo alt](class=hero)',
        '  after ^[note].',
        '',
        'footnotes',
        '  note Note.',
      ].join('\n'),
      {filename: 'pipeless.pg', warnings: warnings},
    );
    const sectionStart = result.indexOf('<section role="doc-endnotes">');

    assert.notStrictEqual(sectionStart, -1);
    assert.strictEqual(
      result.slice(0, sectionStart),
      '<p>Before <img class="hero" src="/logo.png" alt="alt">\n' +
        'after <sup><a href="#footnote-note" id="footnote-reference-note" ' +
        'role="doc-noteref">[1]</a></sup>.\n</p>',
    );
    assert.strictEqual(renderedFootnoteBody(result, 'note'), 'Note.');
    assert.deepStrictEqual(warnings, []);
  });

  it('should ignore name-line separator whitespace before a continuation', () => {
    for (const definitionHead of ['n', 'n ', 'n   ']) {
      const result = pg.render(
        'p Note^[n].\nfootnotes\n  ' + definitionHead + '\n    continuation',
      );
      assert.strictEqual(renderedFootnoteBody(result, 'n'), 'continuation');
    }
  });

  it('should join around omitted and provided optional variables', () => {
    const definition = [
      'mixin note(value)',
      '  p Note^[n].',
      '  footnotes',
      '    n #{value}',
      '      continuation',
    ].join('\n');

    assert.strictEqual(
      renderedFootnoteBody(pg.render(definition + '\n+note'), 'n'),
      'continuation',
    );
    assert.strictEqual(
      renderedFootnoteBody(pg.render(definition + '\n+note(first)'), 'n'),
      'first continuation',
    );
  });

  it('should not carry an empty terminal line into generated backlinks', () => {
    const definition = [
      'mixin note(value)',
      '  p Note^[n].',
      '  footnotes',
      '    n first',
      '      #{value}',
    ].join('\n');

    assert.strictEqual(
      renderedFootnoteBody(pg.render(definition + '\n+note'), 'n'),
      'first',
    );
    assert.strictEqual(
      renderedFootnoteBody(pg.render(definition + '\n+note(last)'), 'n'),
      'first last',
    );
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
      /<nav role="doc-toc" aria-label="Table of contents"><ol>/,
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

  it('should not include footnote markers in toc text', () => {
    const result = pg.render(
      'toc\n\nh2#intro Introduction^[fn1]\np Text.\n\nfootnotes\n  fn1 A note.',
    );
    // ToC link should have clean text without [1]
    assert.match(result, /<a href="#intro">Introduction<\/a>/);
    assert.doesNotMatch(result, /<a href="#intro">Introduction\[1\]<\/a>/);
    // Heading itself should have the footnote marker
    assert.match(result, /<h2 id="intro">Introduction<sup>/);
    // Footnote section should still render
    assert.match(result, /role="doc-endnotes"/);
  });

  it('should work with footnotes block before toc', () => {
    const result = pg.render(
      'footnotes\n  fn1 A note.\n\ntoc\n\nh2#sec Section^[fn1]',
    );
    assert.match(result, /<a href="#sec">Section<\/a>/);
    assert.match(result, /\[1\]<\/a><\/sup>/);
  });
});

describe('abbr shorthand', () => {
  it('should render ?(abbr expansion) as <abbr>', () => {
    assert.strictEqual(
      pg.render('p ?(HTML Hypertext Markup Language)'),
      '<p><abbr title="Hypertext Markup Language">HTML</abbr></p>',
    );
  });

  it('should render ?(abbr) without expansion', () => {
    assert.strictEqual(pg.render('p ?(CPU)'), '<p><abbr>CPU</abbr></p>');
  });

  it('should render escaped \\?( as literal', () => {
    assert.strictEqual(pg.render('p \\?(not abbr)'), '<p>?(not abbr)</p>');
  });

  it('should nest inside other shorthands', () => {
    assert.strictEqual(
      pg.render('p The *(?(API Application Programming Interface)) is stable.'),
      '<p>The <strong><abbr title="Application Programming Interface">API</abbr></strong> is stable.</p>',
    );
  });
});

describe('renderFile()', () => {
  var filePath = path.join(testCasesDir, 'basic.pg');

  it('should render a file from disk', () => {
    var result = pg.renderFile(filePath);
    assert.strictEqual(typeof result, 'string');
    assert.match(result, /^<html>/);
  });

  it('passes yielded raw-include bytes to a binary filter as a Buffer', (t) => {
    var root = fs.mkdtempSync(path.join(os.tmpdir(), 'pugneum-binary-yield-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    var entry = path.join(root, 'entry.pg');
    var payload = Buffer.from([0x00, 0x26, 0x3c, 0xff]);
    fs.writeFileSync(path.join(root, 'wrapper.pg'), 'yield\n');
    fs.writeFileSync(
      entry,
      'include wrapper.pg\n  include:binary payload.bin\n',
    );
    fs.writeFileSync(path.join(root, 'payload.bin'), payload);
    var received;

    var html = pg.renderFile(entry, {
      basedir: root,
      warnings: [],
      filters: {
        binary: {
          binary: true,
          type: 'text',
          filter(value) {
            received = value;
            return Buffer.from(value).toString('hex');
          },
        },
      },
    });

    assert.ok(Buffer.isBuffer(received));
    assert.strictEqual(html, '00263cff');
  });
});

describe('test-case manifest', () => {
  it('declares every fixture exactly once', () => {
    var declared = declaredFixtureFiles();
    assert.strictEqual(
      new Set(declared).size,
      declared.length,
      'fixture roles must not overlap',
    );
    assertFixtureInventory(listFixtureFiles(testCasesDir), declared);

    Object.keys(fixtureManifest.warningOracles).forEach((name) => {
      assert.ok(
        fixtureManifest.render.includes(name),
        `${name} has a warning oracle but is not a render case`,
      );
    });
  });

  it('fails closed when a declared oracle disappears', () => {
    var declared = declaredFixtureFiles();
    var missingOracle = listFixtureFiles(testCasesDir).filter(
      (relativePath) => relativePath !== 'basic.html',
    );
    assert.throws(() => assertFixtureInventory(missingOracle, declared));
  });

  it('preserves intentional byte-sensitive fixtures', () => {
    Object.entries(fixtureManifest.integrity).forEach(
      ([relativePath, expected]) => {
        var contents = fs.readFileSync(path.join(testCasesDir, relativePath));
        var actual = crypto.createHash('sha256').update(contents).digest('hex');
        assert.strictEqual(actual, expected, relativePath);
      },
    );
  });
});

describe('test-cases/', () => {
  var cases = fixtureManifest.render;

  cases.forEach((name) => {
    var htmlPath = path.join(testCasesDir, name + '.html');

    it(name, () => {
      var pgPath = path.join(testCasesDir, name + '.pg');
      var expected = fs.readFileSync(htmlPath, 'utf8');
      var warningOracle = fixtureManifest.warningOracles[name];
      var expectedWarnings = warningOracle
        ? JSON.parse(
            fs.readFileSync(path.join(testCasesDir, warningOracle), 'utf8'),
          )
        : [];
      var warnings = [];
      // test-cases/ is the build root; layout cases reach their layouts via
      // the in-tree absolute path /fixtures/... Default-deny contains here.
      var options = {filename: pgPath, basedir: testCasesDir, warnings};
      var actual = renderAndTraceDependencies(pgPath, options);
      assert.strictEqual(actual, expected);
      assert.deepStrictEqual(warnings.map(serializeWarning), expectedWarnings);
    });
  });

  it('opens every declared dependency from a render case', () => {
    fixtureManifest.dependencies.forEach((relativePath) => {
      assert.ok(observedDependencies.has(relativePath), relativePath);
    });
  });
});

describe('attribute value quoting', () => {
  // Regression for the BUG.txt report: the three quote forms must be equivalent.
  it('treats unquoted, single-quoted, and double-quoted values identically', () => {
    var url = '/articles/babys-second-garbage-collector';
    var expected = '<a href="' + url + '">T</a>';
    assert.strictEqual(pg.render('a(href=' + url + ') T'), expected);
    assert.strictEqual(pg.render("a(href='" + url + "') T"), expected);
    assert.strictEqual(pg.render('a(href="' + url + '") T'), expected);
  });

  it('strips quotes from values containing reserved characters', () => {
    assert.strictEqual(
      pg.render("a(href='/a, b' title='x=y') T"),
      '<a href="/a, b" title="x=y">T</a>',
    );
  });
});

describe('warnings', () => {
  var LSQUO = '‘';
  var RSQUO = '’';

  function captureStderr(fn) {
    var original = process.stderr.write;
    var output = '';
    process.stderr.write = function (chunk) {
      output += chunk;
      return true;
    };
    try {
      fn();
    } finally {
      process.stderr.write = original;
    }
    return output;
  }

  it('collects typographic-quote warnings into a provided array and keeps the value literal', () => {
    var warnings = [];
    var html = pg.render('a(href=' + LSQUO + '/x' + RSQUO + ') T', {
      filename: 'p.pg',
      warnings: warnings,
    });
    assert.strictEqual(html, '<a href="' + LSQUO + '/x' + RSQUO + '">T</a>');
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].code, 'PUGNEUM:TYPOGRAPHIC_QUOTE_DELIMITER');
  });

  it('does not print when the caller provides its own warnings array', () => {
    var warnings = [];
    var out = captureStderr(function () {
      pg.render('a(href=' + LSQUO + '/x' + RSQUO + ') T', {
        filename: 'p.pg',
        warnings: warnings,
      });
    });
    assert.strictEqual(out, '');
  });

  it('prints the warning to stderr when no collector is provided', () => {
    var out = captureStderr(function () {
      pg.render('a(href=' + LSQUO + '/x' + RSQUO + ') T', {filename: 'p.pg'});
    });
    assert.match(out, /TYPOGRAPHIC_QUOTE_DELIMITER/);
    assert.match(out, /p\.pg:1/);
  });

  it('clean source produces no warnings and no stderr output', () => {
    var warnings = [];
    var out = captureStderr(function () {
      pg.render('a(href="/x") T', {filename: 'clean.pg', warnings: warnings});
    });
    assert.strictEqual(warnings.length, 0);
    assert.strictEqual(out, '');
  });

  function unusedMixinWarnings(source) {
    var warnings = [];
    pg.render(source, {filename: 'p.pg', warnings: warnings});
    return warnings.filter((w) => w.code === 'PUGNEUM:UNUSED_MIXIN');
  }

  it('warns when a mixin defined in the entry file is never called', () => {
    assert.strictEqual(
      unusedMixinWarnings('mixin unused()\n  p x\np hello').length,
      1,
    );
  });

  it('does not warn when a defined mixin is called', () => {
    assert.strictEqual(
      unusedMixinWarnings('mixin used()\n  p x\n+used()').length,
      0,
    );
  });

  it('emitWarnings collapses duplicate warnings to a single line', () => {
    var dup = {
      code: 'PUGNEUM:DUP',
      message: 'f.pg:1:1\n\nmsg',
      filename: 'f.pg',
      line: 1,
      column: 1,
    };
    var out = captureStderr(function () {
      pg.emitWarnings([Object.assign({}, dup), Object.assign({}, dup)]);
    });
    assert.strictEqual((out.match(/warning DUP/g) || []).length, 1);
  });

  it('emitWarnings keeps warnings that differ in location', () => {
    var a = {
      code: 'PUGNEUM:X',
      message: 'f.pg:1:1\n\nm',
      filename: 'f.pg',
      line: 1,
      column: 1,
    };
    var b = {
      code: 'PUGNEUM:X',
      message: 'f.pg:2:1\n\nm',
      filename: 'f.pg',
      line: 2,
      column: 1,
    };
    var out = captureStderr(function () {
      pg.emitWarnings([a, b]);
    });
    assert.strictEqual((out.match(/warning X/g) || []).length, 2);
  });

  it('emitWarnings keeps warnings sharing a code+location but differing in message', () => {
    // The dedup key now includes the message, so two diagnostics at the same
    // code+location but with different detail are both emitted instead of one
    // silently swallowing the other.
    var a = {
      code: 'PUGNEUM:X',
      message: 'f.pg:1:1\n\ndetail A',
      filename: 'f.pg',
      line: 1,
      column: 1,
    };
    var b = {
      code: 'PUGNEUM:X',
      message: 'f.pg:1:1\n\ndetail B',
      filename: 'f.pg',
      line: 1,
      column: 1,
    };
    var out = captureStderr(function () {
      pg.emitWarnings([a, b]);
    });
    assert.match(out, /detail A/);
    assert.match(out, /detail B/);
    assert.strictEqual((out.match(/warning X/g) || []).length, 2);
  });

  it('emitWarnings strips the internal PUGNEUM: prefix from the header', () => {
    // The error path treats PUGNEUM: as an internal routing token never shown
    // to users; the warning header must match that convention.
    var w = {
      code: 'PUGNEUM:TYPOGRAPHIC_QUOTE_DELIMITER',
      message: 'f.pg:1:1\n\nmsg',
      filename: 'f.pg',
      line: 1,
      column: 1,
    };
    var out = captureStderr(function () {
      pg.emitWarnings([w]);
    });
    assert.match(out, /warning TYPOGRAPHIC_QUOTE_DELIMITER/);
    assert.doesNotMatch(out, /warning PUGNEUM:/);
  });

  it('emitWarnings tolerates a null entry in the warnings array', () => {
    // A junk null entry must be skipped, not crash warningKey with a TypeError.
    var w = {
      code: 'PUGNEUM:X',
      message: 'f.pg:1:1\n\nm',
      filename: 'f.pg',
      line: 1,
      column: 1,
    };
    var out = captureStderr(function () {
      assert.doesNotThrow(function () {
        pg.emitWarnings([null, w]);
      });
    });
    assert.match(out, /warning X/);
  });

  it('emits collected warnings even when a later stage throws', () => {
    // When render() owns the warnings array, diagnostics collected before a
    // hard error must still reach stderr (finally), not be discarded.
    var out = captureStderr(function () {
      assert.throws(function () {
        // Typographic quote (warning) on line 1, undefined reference (hard
        // error) on line 2.
        pg.render('a(href=' + LSQUO + '/x' + RSQUO + ') T\np @[missing]', {
          filename: 'h.pg',
        });
      });
    });
    assert.match(out, /TYPOGRAPHIC_QUOTE_DELIMITER/);
  });
});
