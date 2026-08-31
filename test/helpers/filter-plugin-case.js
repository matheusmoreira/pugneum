'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');

const filter = require('pugneum-filterer');
const lex = require('pugneum-lexer');
const parse = require('pugneum-parser');
const render = require('pugneum-renderer');

function transformedFragments(ast) {
  const fragments = [];
  const pending = [ast];
  const seen = new WeakSet();

  while (pending.length > 0) {
    const value = pending.pop();
    if (value === null || typeof value !== 'object' || seen.has(value)) {
      continue;
    }
    seen.add(value);
    if (
      value.type === 'Text' &&
      typeof value.val === 'string' &&
      value.val.includes('<span')
    ) {
      fragments.push(value.val);
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) pending.push(...child);
      else if (child !== null && typeof child === 'object') pending.push(child);
    }
  }

  return fragments;
}

function runFilterCases(casesDirectory, expectations) {
  const filenames = fs
    .readdirSync(casesDirectory)
    .filter((name) => name.endsWith('.pg'))
    .sort();
  assert.deepStrictEqual(filenames, Object.keys(expectations).sort());

  for (const filename of filenames) {
    test(filename + ' resolves its public plugin package', () => {
      const source = fs.readFileSync(
        path.join(casesDirectory, filename),
        'utf8',
      );
      const options = {filename, source};
      const ast = parse(lex(source, options), options);

      // Deliberately omit a custom filter map: the public invocation name must
      // resolve the installed `pugneum-filter-*` package through the filterer.
      const filtered = filter(ast, undefined, options);
      const fragments = transformedFragments(filtered);
      assert.strictEqual(fragments.length, 1);
      for (const pattern of expectations[filename].fragment) {
        assert.match(fragments[0], pattern);
      }
      const html = render(filtered, options);
      for (const pattern of expectations[filename].document) {
        assert.match(html, pattern);
      }
    });
  }
}

module.exports = {runFilterCases};
