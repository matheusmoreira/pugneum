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
