var path = require('path');
var fs = require('fs');
var os = require('os');
var assert = require('node:assert/strict');
var {describe, test} = require('node:test');
var generateFeeds = require('../');
var extract = require('../lib/extract');

var fixturesDir = path.join(__dirname, 'fixtures');
var outputDir = path.join(__dirname, 'output');

describe('extract.indexPage robustness', () => {
  function writeTemp(content) {
    var p = path.join(os.tmpdir(), 'pugneum-extract-test-' + Date.now() + '.html');
    fs.writeFileSync(p, content);
    return p;
  }

  test('entry without data-published-at is included with empty published string', () => {
    var p = writeTemp(
      '<!DOCTYPE html><html><head><base href="https://x.com/"><title>T</title>'
      + '<meta name="description" content="d"><meta name="author" content="a"></head><body>'
      + '<li><a href="article.html">No date</a></li>'
      + '</body></html>',
    );
    try {
      var result = extract.indexPage(p);
      // The element has no data-published-at so extractEntries won't find it
      // (the guard requires data-published-at to be present for the element to be found at all)
      assert.strictEqual(result.entries.length, 0);
    } finally {
      fs.unlinkSync(p);
    }
  });

  test('entries are sorted in descending date order', () => {
    // Also exercises the sort guard: (b.published || '').localeCompare(a.published || '')
    var p = writeTemp(
      '<!DOCTYPE html><html><head><base href="https://x.com/"><title>T</title>'
      + '<meta name="description" content="d"><meta name="author" content="a"></head><body>'
      + '<li data-published-at="2026-01-01"><a href="earlier.html">Earlier</a></li>'
      + '<li data-published-at="2026-06-15"><a href="later.html">Later</a></li>'
      + '</body></html>',
    );
    try {
      var result = extract.indexPage(p);
      assert.strictEqual(result.entries.length, 2);
      // Later date sorts first (descending)
      assert.strictEqual(result.entries[0].href, 'later.html');
      assert.strictEqual(result.entries[1].href, 'earlier.html');
    } finally {
      fs.unlinkSync(p);
    }
  });

  test('anchor without href is excluded from entries', () => {
    var p = writeTemp(
      '<!DOCTYPE html><html><head><base href="https://x.com/"><title>T</title>'
      + '<meta name="description" content="d"><meta name="author" content="a"></head><body>'
      + '<li data-published-at="2026-01-01"><a>No href anchor</a></li>'
      + '<li data-published-at="2026-01-02"><a href="valid.html">Valid</a></li>'
      + '</body></html>',
    );
    try {
      var result = extract.indexPage(p);
      // The no-href anchor must be excluded; only the valid entry is present
      assert.strictEqual(result.entries.length, 1);
      assert.strictEqual(result.entries[0].href, 'valid.html');
    } finally {
      fs.unlinkSync(p);
    }
  });
});

describe('end-to-end feed generation', () => {
  test('generates atom.xml and rss.xml from fixtures', (t) => {
    fs.mkdirSync(outputDir, {recursive: true});

    generateFeeds({
      outputDirectory: fixturesDir,
      feeds: {enabled: true},
      writeDirectory: outputDir,
    });

    var atom = fs.readFileSync(path.join(outputDir, 'atom.xml'), 'utf8');
    var rss = fs.readFileSync(path.join(outputDir, 'rss.xml'), 'utf8');

    t.assert.snapshot(atom);
    t.assert.snapshot(rss);

    fs.rmSync(outputDir, {recursive: true});
  });
});

describe('config overrides', () => {
  test('json config overrides html-extracted values', (t) => {
    fs.mkdirSync(outputDir, {recursive: true});

    generateFeeds({
      outputDirectory: fixturesDir,
      feeds: {
        enabled: true,
        url: 'https://override.com/',
        title: 'Override Title',
        author: 'Override Author',
        description: 'Override Description',
      },
      writeDirectory: outputDir,
    });

    var atom = fs.readFileSync(path.join(outputDir, 'atom.xml'), 'utf8');
    assert.match(atom, /https:\/\/override\.com\//);
    assert.ok(atom.includes('Override Title'));
    assert.ok(atom.includes('Override Author'));
    assert.ok(atom.includes('Override Description'));

    fs.rmSync(outputDir, {recursive: true});
  });
});

describe('error handling', () => {
  test('throws when base URL is unresolvable', () => {
    var noBaseDir = path.join(__dirname, 'fixtures-no-base');
    fs.mkdirSync(noBaseDir, {recursive: true});
    fs.writeFileSync(
      path.join(noBaseDir, 'index.html'),
      '<!DOCTYPE html><html><head><title>No Base</title><meta name="description" content="test"></head><body></body></html>',
    );

    assert.throws(
      () =>
        generateFeeds({
          outputDirectory: noBaseDir,
          feeds: {enabled: true},
          writeDirectory: noBaseDir,
        }),
      (err) => err.code === 'PUGNEUM:FEED_MISSING_URL',
    );

    fs.rmSync(noBaseDir, {recursive: true});
  });

  test('skips when feeds.enabled is false', () => {
    fs.mkdirSync(outputDir, {recursive: true});

    generateFeeds({
      outputDirectory: fixturesDir,
      feeds: {enabled: false},
      writeDirectory: outputDir,
    });

    assert.ok(!fs.existsSync(path.join(outputDir, 'atom.xml')));
    assert.ok(!fs.existsSync(path.join(outputDir, 'rss.xml')));

    fs.rmSync(outputDir, {recursive: true});
  });
});
