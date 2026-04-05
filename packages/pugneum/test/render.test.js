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
    expect(pg.render('.a.b.c')).toBe('<!DOCTYPE html><div class="a" class="b" class="c"></div>');
  });

  it('should render boolean attributes', () => {
    expect(pg.render('input(disabled)')).toContain('disabled');
  });
});

describe('renderFile()', () => {
  it('should render a file from disk', () => {
    const filePath = path.join(testCasesDir, 'basic.pg');
    if (fs.existsSync(filePath)) {
      const result = pg.renderFile(filePath);
      expect(typeof result).toBe('string');
      expect(result).toContain('<!DOCTYPE html>');
    }
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
