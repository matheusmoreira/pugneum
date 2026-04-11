var path = require('path');
var fs = require('fs');
var assert = require('node:assert/strict');
var {describe, test} = require('node:test');
var generateFeeds = require('../');

var fixturesDir = path.join(__dirname, 'fixtures');
var outputDir = path.join(__dirname, 'output');

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
    assert.ok(atom.includes('https://override.com/'));
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
