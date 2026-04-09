'use strict';

const fs = require('fs');
const path = require('path');
const pg = require('../');

// Load test cases from the root test-cases/ directory.
// Each .pg file has a corresponding .html file with expected output.
const testCasesDir = path.resolve(__dirname, '../../../test-cases');

function getTestCases() {
  return fs.readdirSync(testCasesDir)
    .filter(f => f.endsWith('.pg'))
    .map(f => f.replace('.pg', ''));
}

describe('render()', () => {
  it('should render a simple tag', () => {
    expect(pg.render('h1 Hello')).toBe('<!DOCTYPE html><h1>Hello</h1>');
  });

  it('should render nested tags', () => {
    const input = 'div\n  p Hello';
    expect(pg.render(input)).toBe('<!DOCTYPE html><div><p>Hello</p></div>');
  });

  it('should render attributes', () => {
    const input = 'a(href="/home") Home';
    expect(pg.render(input)).toBe('<!DOCTYPE html><a href="/home">Home</a>');
  });

  it('should render id shorthand', () => {
    expect(pg.render('#main')).toBe('<!DOCTYPE html><div id="main"></div>');
  });

  it('should render class shorthand', () => {
    expect(pg.render('.container')).toBe('<!DOCTYPE html><div class="container"></div>');
  });

  it('should render self-closing tags', () => {
    expect(pg.render('br')).toBe('<!DOCTYPE html><br>');
    expect(pg.render('img(src="a.png")')).toBe('<!DOCTYPE html><img src="a.png">');
    expect(pg.render('hr')).toBe('<!DOCTYPE html><hr>');
  });

  it('should render buffered comments', () => {
    expect(pg.render('// comment')).toBe('<!DOCTYPE html><!-- comment-->');
  });

  it('should suppress unbuffered comments', () => {
    expect(pg.render('//- hidden')).toBe('<!DOCTYPE html>');
  });

  it('should render text blocks', () => {
    const input = 'p.\n  Line 1\n  Line 2';
    expect(pg.render(input)).toBe('<!DOCTYPE html><p>Line 1\nLine 2</p>');
  });

  it('should render multiple classes', () => {
    expect(pg.render('.a.b.c')).toBe('<!DOCTYPE html><div class="a b c"></div>');
  });

  it('should render boolean attributes', () => {
    expect(pg.render('input(disabled)')).toContain('disabled');
  });
});

describe('reference links', () => {
  it('should resolve @[name] to <a> with identifier as text', () => {
    const input = 'references\n  example https://example.com\n\np @[example]';
    expect(pg.render(input)).toBe(
      '<!DOCTYPE html><p><a href="https://example.com">example</a></p>'
    );
  });

  it('should use explicit link text when provided', () => {
    const input = 'references\n  gc https://example.com/gc\n\np @[gc Baby\'s First Garbage Collector]';
    expect(pg.render(input)).toBe(
      '<!DOCTYPE html><p><a href="https://example.com/gc">Baby\'s First Garbage Collector</a></p>'
    );
  });

  it('should resolve multiple references', () => {
    const input = 'references\n  one https://one.com\n  two https://two.com\n\np @[one] and @[two]';
    expect(pg.render(input)).toBe(
      '<!DOCTYPE html><p><a href="https://one.com">one</a> and <a href="https://two.com">two</a></p>'
    );
  });

  it('should work inline in prose', () => {
    const input = 'references\n  docs https://docs.com\n\np Read @[docs the docs] today.';
    expect(pg.render(input)).toBe(
      '<!DOCTYPE html><p>Read <a href="https://docs.com">the docs</a> today.</p>'
    );
  });

  it('should support forward references', () => {
    const input = 'p @[example click here]\n\nreferences\n  example https://example.com';
    expect(pg.render(input)).toBe(
      '<!DOCTYPE html><p><a href="https://example.com">click here</a></p>'
    );
  });

  it('should work in text blocks', () => {
    const input = 'references\n  ex https://example.com\n\np.\n  Visit @[ex the site] now.';
    expect(pg.render(input)).toBe(
      '<!DOCTYPE html><p>Visit <a href="https://example.com">the site</a> now.</p>'
    );
  });

  it('should escape \\@[ as literal text', () => {
    expect(pg.render('p \\@[not a ref]')).toBe(
      '<!DOCTYPE html><p>@[not a ref]</p>'
    );
  });

  it('should support quoted URLs with spaces', () => {
    const input = "references\n  ex 'https://example.com/a b'\n\np @[ex]";
    expect(pg.render(input)).toBe(
      '<!DOCTYPE html><p><a href="https://example.com/a b">ex</a></p>'
    );
  });

  it('should work inside #[...] interpolation', () => {
    const input = 'references\n  docs https://docs.com\n\np #[em check @[docs the docs] out]';
    expect(pg.render(input)).toBe(
      '<!DOCTYPE html><p><em>check <a href="https://docs.com">the docs</a> out</em></p>'
    );
  });

  it('should produce no output for the references block itself', () => {
    const input = 'references\n  ex https://example.com';
    expect(pg.render(input)).toBe('<!DOCTYPE html>');
  });

  it('should throw for undefined references', () => {
    expect(() => pg.render('p @[missing]')).toThrow(/Undefined reference 'missing'/);
  });
});

describe('renderFile()', () => {
  const filePath = path.join(testCasesDir, 'basic.pg');

  it('should render a file from disk', () => {
    const result = pg.renderFile(filePath);
    expect(typeof result).toBe('string');
    expect(result).toContain('<!DOCTYPE html>');
  });
});

// Run each .pg test case from test-cases/ that has a matching .html file
describe('test-cases/', () => {
  const cases = getTestCases();

  cases.forEach(name => {
    const htmlPath = path.join(testCasesDir, name + '.html');

    // Only test cases that have an expected .html output file
    if (!fs.existsSync(htmlPath)) return;

    it(name, () => {
      const pgPath = path.join(testCasesDir, name + '.pg');
      const expected = fs.readFileSync(htmlPath, 'utf8').trim().replace(/\r/g, '');
      const options = {filename: pgPath, basedir: testCasesDir};
      const actual = pg.renderFile(pgPath, options);
      expect(actual.trim()).toBe(expected);
    });
  });
});
