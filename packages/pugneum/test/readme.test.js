'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {describe, test} = require('node:test');

const pg = require('../');

const readmePath = path.join(__dirname, '..', 'README.md');
const readme = fs.readFileSync(readmePath, 'utf8');
const exampleFilename = path.join(
  path.dirname(readmePath),
  'README-example.pg',
);

function fencedExamples(language) {
  const lines = readme.split('\n');
  const examples = [];
  let heading;

  for (let line = 0; line < lines.length; line++) {
    const headingMatch = /^(#{2,3}) (.+)$/.exec(lines[line]);
    if (headingMatch) heading = headingMatch[2];
    if (lines[line] !== '```' + language) continue;

    const start = line + 2;
    const source = [];
    for (line++; line < lines.length && lines[line] !== '```'; line++) {
      source.push(lines[line]);
    }
    assert.ok(
      line < lines.length,
      `unterminated ${language} fence at ${start}`,
    );
    examples.push({heading, line: start, source: source.join('\n')});
  }

  return examples;
}

const pugneumExamples = fencedExamples('pugneum');
const javascriptExamples = fencedExamples('js');
const jsonExamples = fencedExamples('json');
const layoutExample = pugneumExamples.find((example) =>
  example.source.startsWith('//- layout.pg\n'),
);
const wrapperExample = pugneumExamples.find((example) =>
  example.source.startsWith('//- wrapper.pg\n'),
);
assert.ok(layoutExample, 'README must retain its documented layout.pg example');
assert.ok(
  wrapperExample,
  'README must retain its documented wrapper.pg example',
);
const virtualFiles = {
  'layout.pg': layoutExample.source,
  'wrapper.pg': wrapperExample.source,
  'partials/head.pg': 'meta(name="viewport" content="width=device-width")',
  'styles.css': 'body { color: black; }',
};

function renderExample(example) {
  const warnings = [];
  const options = {
    basedir: path.dirname(readmePath),
    filename: exampleFilename,
    warnings,
  };
  const virtualDependencies =
    example.source.includes('extends layout.pg') ||
    example.source.includes('include wrapper.pg') ||
    example.source.includes('include partials/head.pg') ||
    example.source.includes('include:verbatim styles.css');

  if (virtualDependencies) {
    delete options.basedir;
    options.resolve = (requestedPath) => requestedPath;
    options.read = (resolvedPath) => {
      assert.ok(
        Object.hasOwn(virtualFiles, resolvedPath),
        `README example requested unknown virtual file ${resolvedPath}`,
      );
      return virtualFiles[resolvedPath];
    };
    options.canonicalize = (resolvedPath) => resolvedPath;
  }

  return pg.render(example.source, options);
}

describe('README examples', () => {
  test('every Pugneum fence compiles', () => {
    assert.strictEqual(pugneumExamples.length, 41);
    for (const example of pugneumExamples) {
      assert.doesNotThrow(
        () => renderExample(example),
        `${example.heading} example at README.md:${example.line}`,
      );
    }
  });

  test('corrected cross-feature examples reach their advertised behavior', () => {
    const multilineFootnote = pugneumExamples.find((example) =>
      example.source.includes('gc-history'),
    );
    const appendedTitle = pugneumExamples.find((example) =>
      example.source.includes('block append title'),
    );
    const inlineMixins = pugneumExamples.find((example) =>
      example.source.includes('#(+icon(settings))'),
    );
    const yieldedBlock = pugneumExamples.find((example) =>
      example.source.includes('include wrapper.pg'),
    );

    assert.match(
      renderExample(multilineFootnote),
      /href="https:\/\/example\.com\/mccarthy">McCarthy's paper<\/a>/,
    );
    assert.match(
      renderExample(appendedTitle),
      /<title>Default Title<\/title><meta name="description" content="My page">/,
    );
    assert.strictEqual(
      renderExample(inlineMixins),
      '<p>Click the <span class="icon icon-settings" aria-hidden="true"></span> button to open preferences.</p>' +
        '<p>I am <strong>very</strong> <strong>happy</strong> today.</p>',
    );
    assert.strictEqual(
      renderExample(yieldedBlock),
      '<article><p>Included content.</p></article>',
    );
  });

  test('every JavaScript fence parses', () => {
    assert.strictEqual(javascriptExamples.length, 2);
    for (const example of javascriptExamples) {
      assert.doesNotThrow(
        () => new vm.Script(example.source),
        `${example.heading} example at README.md:${example.line}`,
      );
    }
  });

  test('every JSON fence parses', () => {
    assert.strictEqual(jsonExamples.length, 2);
    for (const example of jsonExamples) {
      assert.doesNotThrow(
        () => JSON.parse(example.source),
        `${example.heading} example at README.md:${example.line}`,
      );
    }
  });
});
