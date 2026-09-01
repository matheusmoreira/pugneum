'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');
const {spawnSync} = require('node:child_process');

const consumerRoot = __dirname;

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function packageDirectory(name) {
  return path.join(consumerRoot, 'node_modules', ...name.split('/'));
}

function findResolvedPackage(from, dependency) {
  const fromDirectory = packageDirectory(from);
  const request = createRequire(path.join(fromDirectory, 'package.json'));
  let current = path.dirname(request.resolve(dependency));
  for (;;) {
    const manifestPath = path.join(current, 'package.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = readJson(manifestPath);
      if (manifest.name === dependency) return {current, manifest};
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`${from} did not resolve ${dependency} to its package root`);
}

function assertExternalInstallBoundary() {
  const manifest = readJson(path.join(consumerRoot, 'package.json'));
  const nodeModules = fs.realpathSync(path.join(consumerRoot, 'node_modules'));
  for (const name of Object.keys(manifest.dependencies)) {
    const directory = packageDirectory(name);
    const relative = path.relative(nodeModules, fs.realpathSync(directory));
    assert.ok(
      relative &&
        !path.isAbsolute(relative) &&
        relative !== '..' &&
        !relative.startsWith('..' + path.sep),
      `${name} resolves beneath the external consumer`,
    );
    assert.ok(
      !fs.lstatSync(directory).isSymbolicLink(),
      `${name} was installed from a tarball or registry, not linked`,
    );
  }

  const checks = JSON.parse(process.env.PUGNEUM_RELEASE_RESOLUTIONS || '[]');
  for (const check of checks) {
    const resolved = findResolvedPackage(check.from, check.dependency);
    assert.strictEqual(
      resolved.manifest.version,
      check.version,
      `${check.from} resolves ${check.dependency}@${check.version}`,
    );
    const relative = path.relative(
      nodeModules,
      fs.realpathSync(resolved.current),
    );
    assert.ok(
      relative &&
        !path.isAbsolute(relative) &&
        relative !== '..' &&
        !relative.startsWith('..' + path.sep),
      `${check.from} resolves ${check.dependency} inside the consumer`,
    );
  }
}

function block(nodes, filename) {
  return {type: 'Block', nodes, line: 1, filename: filename || 'smoke.pg'};
}

function text(value, filename) {
  return {
    type: 'Text',
    val: value,
    line: 1,
    column: 1,
    filename: filename || 'smoke.pg',
  };
}

function tag(name, children, filename) {
  return {
    type: 'Tag',
    name,
    attrs: [],
    attributeBlocks: [],
    block: block(children || [], filename),
    isInline: false,
    line: 1,
    column: 1,
    filename: filename || 'smoke.pg',
  };
}

function collectTypes(root) {
  const types = [];
  const seen = new Set();
  function visit(value) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (typeof value.type === 'string') types.push(value.type);
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      if (key !== 'loc') visit(entry);
    }
  }
  visit(root);
  return types;
}

function captureStderr(callback) {
  const original = process.stderr.write;
  let output = '';
  process.stderr.write = function (chunk) {
    output += chunk;
    return true;
  };
  try {
    callback();
  } finally {
    process.stderr.write = original;
  }
  return output;
}

function assertErrorCode(callback, code) {
  assert.throws(callback, (error) => {
    assert.strictEqual(error.code, code);
    return true;
  });
}

function makeDirectoryLink(target, link) {
  fs.symlinkSync(
    target,
    link,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
}

function makeFifo(filename) {
  if (process.platform === 'win32') return false;
  const result = spawnSync('mkfifo', [filename], {encoding: 'utf8'});
  if (result.error && result.error.code === 'ENOENT') return false;
  assert.ifError(result.error);
  assert.strictEqual(result.status, 0, result.stderr);
  return true;
}

function smokeLeaves() {
  const makeError = require('pugneum-error');
  const error = makeError('BROKEN', 'broken value', {
    filename: 'input.pg',
    line: 2,
    column: 3,
    source: 'first\nsecond',
  });
  assert.strictEqual(error.code, 'PUGNEUM:BROKEN');
  assert.match(error.message, /input\.pg:2:3/);
  assert.deepStrictEqual(error.toJSON(), {
    code: 'PUGNEUM:BROKEN',
    msg: 'broken value',
    line: 2,
    column: 3,
    filename: 'input.pg',
  });
  const warning = makeError.warning('NOTICE', 'notice', {});
  assert.strictEqual(warning.code, 'PUGNEUM:NOTICE');
  assert.strictEqual(warning.message, 'notice');

  const walk = require('pugneum-walker');
  const ast = block([
    text('replace-me'),
    {
      type: 'ReferenceImage',
      name: 'image',
      attrs: [],
      block: block([text('image')]),
    },
    {
      type: 'FootnoteRef',
      name: 'reference',
      block: block([text('reference')]),
    },
    {
      type: 'Footnotes',
      definitions: [{name: 'reference', block: block([text('definition')])}],
    },
    {type: 'Given', name: 'given', block: block([text('given')])},
    {type: 'Toc'},
  ]);
  const visited = [];
  const transformed = walk(ast, function (node, replace) {
    visited.push(node.type);
    if (node.type === 'Text' && node.val === 'replace-me') {
      replace.final(text('replaced'));
    }
  });
  assert.strictEqual(transformed.nodes[0].val, 'replaced');
  for (const type of [
    'ReferenceImage',
    'FootnoteRef',
    'Footnotes',
    'Given',
    'Toc',
  ]) {
    assert.ok(visited.includes(type), `walker visits ${type}`);
  }

  const createRootedFilesystem = require('pugneum-filesystem');
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pugneum-fs-consumer-'),
  );
  const root = path.join(sandbox, 'root');
  const outside = path.join(sandbox, 'outside');
  try {
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    const files = createRootedFilesystem(root);
    files.ensureDirectory('nested');
    files.writeFileAtomic('nested/page.html', '<p>ok</p>', 'utf8');
    assert.strictEqual(files.readFile('nested/page.html', 'utf8'), '<p>ok</p>');
    assertErrorCode(
      () => files.readFile('../outside', 'utf8'),
      createRootedFilesystem.ERROR_CODES.PATH_ESCAPE,
    );

    fs.mkdirSync(path.join(root, 'directory-leaf'));
    assertErrorCode(
      () => files.readFile('directory-leaf'),
      createRootedFilesystem.ERROR_CODES.NOT_REGULAR_FILE,
    );

    const outsideSentinel = path.join(outside, 'sentinel.html');
    fs.writeFileSync(outsideSentinel, 'outside sentinel');
    fs.linkSync(outsideSentinel, path.join(root, 'hard-linked.html'));
    files.writeFileAtomic('hard-linked.html', 'replacement', 'utf8');
    assert.strictEqual(
      fs.readFileSync(path.join(root, 'hard-linked.html'), 'utf8'),
      'replacement',
    );
    assert.strictEqual(
      fs.readFileSync(outsideSentinel, 'utf8'),
      'outside sentinel',
    );

    fs.writeFileSync(path.join(outside, 'secret.html'), 'outside secret');
    makeDirectoryLink(outside, path.join(root, 'redirect'));
    assertErrorCode(
      () => files.readFile('redirect/secret.html', 'utf8'),
      createRootedFilesystem.ERROR_CODES.PATH_ESCAPE,
    );
    assertErrorCode(
      () => files.writeFileAtomic('redirect/new.html', 'bad'),
      createRootedFilesystem.ERROR_CODES.PATH_ESCAPE,
    );

    const fifo = path.join(root, 'special-file');
    if (makeFifo(fifo)) {
      assertErrorCode(
        () => files.readFile('special-file'),
        createRootedFilesystem.ERROR_CODES.NOT_REGULAR_FILE,
      );
      assertErrorCode(
        () => files.writeFileAtomic('special-file', 'bad'),
        createRootedFilesystem.ERROR_CODES.NOT_REGULAR_FILE,
      );
    }
  } finally {
    fs.rmSync(sandbox, {recursive: true, force: true});
  }
}

function smokeLexer() {
  const lex = require('pugneum-lexer');
  const ordinary = lex('p Hello', {filename: 'ordinary.pg'});
  assert.deepStrictEqual(
    ordinary.map((token) => token.type),
    ['tag', 'text', 'eos'],
  );
  const warnings = [];
  const smart = lex('a(href=‘/smart’) link', {
    filename: 'smart.pg',
    warnings,
  });
  assert.ok(smart.some((token) => token.type === 'attribute'));
  assert.strictEqual(warnings.length, 1);
  assert.strictEqual(warnings[0].code, 'PUGNEUM:TYPOGRAPHIC_QUOTE_DELIMITER');
  assert.strictEqual(warnings[0].filename, 'smart.pg');
}

function smokeParser() {
  const lex = require('pugneum-lexer');
  const parse = require('pugneum-parser');
  const filename = 'parser-readme.pg';
  const source = 'div(data-foo="bar")';
  const ast = parse(lex(source, {filename}), {filename, source});
  assert.strictEqual(ast.type, 'Block');
  assert.strictEqual(ast.nodes[0].type, 'Tag');
  assert.strictEqual(ast.nodes[0].name, 'div');
  assert.deepStrictEqual(ast.nodes[0].attrs[0], {
    name: 'data-foo',
    val: 'bar',
    line: 1,
    column: 5,
    filename,
  });
}

function smokeLoader() {
  const lex = require('pugneum-lexer');
  const parse = require('pugneum-parser');
  const load = require('pugneum-loader');
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pugneum-loader-consumer-'),
  );
  try {
    const filename = path.join(root, 'entry.pg');
    const source = 'include partial.pg';
    fs.writeFileSync(filename, source);
    fs.writeFileSync(path.join(root, 'partial.pg'), 'strong included');
    const ast = parse(lex(source, {filename}), {filename, source});
    const options = {
      basedir: root,
      filename,
      lex,
      parse,
      source,
      warnings: [],
    };
    const loaded = load(ast, options);
    const include = loaded.nodes[0];
    assert.strictEqual(include.type, 'Include');
    assert.ok(Buffer.isBuffer(include.file.raw));
    assert.strictEqual(include.file.str, 'strong included');
    assert.strictEqual(include.file.ast.type, 'Block');
    assert.strictEqual(include.file.ast.nodes[0].name, 'strong');
    assert.strictEqual(
      options.sources[include.file.fullPath],
      'strong included',
    );
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
}

function smokeLinker() {
  const lex = require('pugneum-lexer');
  const parse = require('pugneum-parser');
  const link = require('pugneum-linker');
  assert.strictEqual(typeof link.assemble, 'function');
  assert.strictEqual(typeof link.resolve, 'function');
  const filename = 'linker.pg';
  const source = [
    'p See @[site the site]',
    'references',
    '  site https://example.test/',
    'h2#heading Heading',
    'toc',
    'p Note^[note]',
    'footnotes',
    '  note Footnote body',
    'img',
  ].join('\n');
  const options = {
    filename,
    source,
    sources: {[filename]: source},
    warnings: [],
  };
  const ast = parse(lex(source, options), options);
  const assembled = link.assemble(ast, options);
  assert.ok(collectTypes(assembled).includes('ReferenceLink'));
  const resolved = link.resolve(assembled, options);
  const types = collectTypes(resolved);
  assert.ok(!types.includes('ReferenceLink'));
  assert.ok(!types.includes('FootnoteRef'));
  assert.ok(!types.includes('Toc'));
  assert.ok(types.includes('Tag'));
  assert.ok(
    options.warnings.some(
      (warning) => warning.code === 'PUGNEUM:IMG_WITHOUT_ALT',
    ),
  );
}

function smokeRenderer() {
  const render = require('pugneum-renderer');
  assert.strictEqual(
    render(block([tag('p', [text('rendered')])])),
    '<p>rendered</p>',
  );
  const declaration = {
    type: 'Mixin',
    name: 'unused',
    call: false,
    args: [],
    block: block([tag('p', [text('body')])]),
    line: 1,
    column: 1,
    filename: 'entry.pg',
  };
  const warnings = [];
  const html = render(block([declaration, tag('p', [text('visible')])]), {
    filename: 'entry.pg',
    warnings,
  });
  assert.strictEqual(html, '<p>visible</p>');
  assert.strictEqual(warnings.length, 1);
  assert.strictEqual(warnings[0].code, 'PUGNEUM:UNUSED_MIXIN');
}

function syntaxNode(value) {
  return tag('b', [text(value)]);
}

function smokeFilterer() {
  const lex = require('pugneum-lexer');
  const parse = require('pugneum-parser');
  const filter = require('pugneum-filterer');
  const escapeText = require('pugneum-filterer/escape-text');
  const render = require('pugneum-renderer');
  assert.strictEqual(
    escapeText('<literal> & "text"'),
    '&lt;literal&gt; &amp; &quot;text&quot;',
  );
  const filename = 'filters.pg';
  const source = [
    'div',
    '  :textual',
    '    ignored',
    '  :htmlish',
    '    ignored',
    '  :generated',
    '    ignored',
    '  :syntax',
    '    ignored',
  ].join('\n');
  const options = {filename, source, warnings: []};
  const filters = {
    textual: {type: 'text', filter: () => '<unsafe> & "quoted"'},
    htmlish: {type: 'html', filter: () => '<strong>raw</strong>'},
    generated: {type: 'pugneum', filter: () => 'em generated'},
    syntax: {type: 'syntax', filter: () => [syntaxNode('syntax')]},
  };
  const ast = parse(lex(source, options), options);
  const html = render(filter(ast, filters, options), options);
  assert.match(html, /&lt;unsafe&gt; &amp; &quot;quoted&quot;/);
  assert.match(html, /<strong>raw<\/strong>/);
  assert.match(html, /<em>generated<\/em>/);
  assert.match(html, /<b>syntax<\/b>/);

  const nestedSource = 'p\n  :outer:inner\n    ignored';
  const nestedOptions = {
    filename,
    source: nestedSource,
    warnings: [],
  };
  const nested = parse(lex(nestedSource, nestedOptions), nestedOptions);
  filter(
    nested,
    {
      outer: {type: 'html', filter: (input) => '[' + input + ']'},
      inner: {type: 'pugneum', filter: () => 'strong nested'},
    },
    nestedOptions,
  );
  assert.strictEqual(
    nested.nodes[0].block.nodes[0].val,
    '[<strong>nested</strong>]',
  );

  const includeAst = block([
    {
      type: 'RawInclude',
      filters: [
        {type: 'IncludeFilter', name: 'outer', attrs: []},
        {type: 'IncludeFilter', name: 'inner', attrs: []},
      ],
      file: {
        type: 'FileReference',
        path: 'raw.txt',
        fullPath: 'raw.txt',
        raw: Buffer.from('raw'),
        str: 'raw',
      },
    },
  ]);
  filter(includeAst, {
    outer: {type: 'html', filter: (input) => 'O(' + input + ')'},
    inner: {type: 'html', filter: (input) => 'I(' + input + ')'},
  });
  assert.strictEqual(includeAst.nodes[0].val, 'O(I(raw))');

  const badSource = ':bad\n  ignored';
  const badOptions = {filename, source: badSource};
  const bad = parse(lex(badSource, badOptions), badOptions);
  assert.throws(
    () =>
      filter(
        bad,
        {bad: {type: 'pugneum', filter: () => 'include missing.pg'}},
        badOptions,
      ),
    (error) => error.code === 'PUGNEUM:UNSUPPORTED_FILTER_CONSTRUCT',
  );
}

function smokePlugins() {
  const highlight = require('pugneum-filter-highlight.js');
  const prism = require('pugneum-filter-prismjs');
  assert.strictEqual(highlight.type, 'html');
  assert.strictEqual(prism.type, 'html');
  assert.match(
    highlight.filter('const answer = 42;', {language: 'javascript'}),
    /hljs-/,
  );
  assert.match(
    prism.filter('const answer = 42;', {language: 'javascript'}),
    /token /,
  );

  const lex = require('pugneum-lexer');
  const parse = require('pugneum-parser');
  const filter = require('pugneum-filterer');
  for (const [name, invocation, marker] of [
    ['highlight.js', ":'highlight.js'", /hljs-/],
    ['prismjs', ':prismjs', /token /],
  ]) {
    const source = `${invocation}(language=javascript)\n  const value = 1;`;
    const options = {filename: `${name}.pg`, source};
    const ast = parse(lex(source, options), options);
    const result = filter(ast, undefined, options);
    assert.match(result.nodes[0].val, marker);
  }
}

function smokeTable() {
  const table = require('pugneum-filter-table');
  const lex = require('pugneum-lexer');
  const parse = require('pugneum-parser');
  const filter = require('pugneum-filterer');
  const render = require('pugneum-renderer');
  const input = '| Name | Count |\n| --- | --- |\n| Alice | 42 |';
  const generated = table.filter(input, {});
  assert.strictEqual(table.type, 'pugneum');
  assert.match(generated, /thead/);
  assert.match(generated, /th\(scope="col"\) Name/);
  const generatedOptions = {
    filename: 'generated-table.pg',
    source: generated,
    warnings: [],
  };
  assert.match(
    render(
      parse(lex(generated, generatedOptions), generatedOptions),
      generatedOptions,
    ),
    /<table>/,
  );

  const source =
    ':table\n  | Name | Count |\n  | --- | --- |\n  | Alice | 42 |';
  const options = {filename: 'table.pg', source, warnings: []};
  const ast = parse(lex(source, options), options);
  const html = render(filter(ast, {table}, options), options);
  assert.match(html, /<th scope="col">Name<\/th>/);
  assert.match(html, /<td>Alice<\/td>/);
}

function makeCliProject(withFeed) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pugneum-cli-consumer-'));
  const sourceDirectory = path.join(root, 'src');
  const outputDirectory = path.join(root, 'out');
  fs.mkdirSync(path.join(sourceDirectory, 'articles'), {recursive: true});
  fs.mkdirSync(outputDirectory);
  fs.writeFileSync(
    path.join(sourceDirectory, 'index.pg'),
    withFeed
      ? [
          'doctype html',
          'html(lang="en")',
          '  head',
          '    base(href="https://example.test/")',
          '    title Example Journal',
          '    meta(name="description" content="Example description")',
          '    meta(name="author" content="Example Author")',
          '  body',
          '    article(data-published-at="2026-01-02")',
          '      a(href="articles/post.html") First Post',
        ].join('\n')
      : 'p CLI output',
  );
  if (withFeed) {
    fs.writeFileSync(
      path.join(sourceDirectory, 'articles', 'post.pg'),
      [
        'doctype html',
        'html',
        '  head',
        '    title First Post',
        '    meta(name="description" content="Post summary")',
        '    meta(name="author" content="Example Author")',
        '  body',
        '    article',
        '      p Feed body',
      ].join('\n'),
    );
  }
  const config = {inputDirectory: 'src', outputDirectory: 'out'};
  if (withFeed) config.feeds = {url: 'https://example.test/'};
  fs.writeFileSync(path.join(root, 'pugneum.json'), JSON.stringify(config));
  return {root, sourceDirectory, outputDirectory};
}

function runCli(project, timeout) {
  const cli = path.join(packageDirectory('pugneum'), 'cli.js');
  return spawnSync(process.execPath, [cli], {
    cwd: project.root,
    encoding: 'utf8',
    env: {...process.env, HOME: os.tmpdir()},
    timeout: timeout || 15000,
  });
}

function smokeCliFilesystemBoundaries() {
  let project = makeCliProject(false);
  try {
    fs.rmSync(path.join(project.sourceDirectory, 'index.pg'));
    fs.mkdirSync(path.join(project.sourceDirectory, 'redirect'));
    fs.writeFileSync(
      path.join(project.sourceDirectory, 'redirect', 'page.pg'),
      'p redirected',
    );
    const outside = path.join(project.root, 'outside-output');
    fs.mkdirSync(outside);
    makeDirectoryLink(outside, path.join(project.outputDirectory, 'redirect'));

    const result = runCli(project);
    assert.ifError(result.error);
    assert.notStrictEqual(
      result.status,
      0,
      'CLI rejects a linked output parent',
    );
    assert.ok(!fs.existsSync(path.join(outside, 'page.html')));
  } finally {
    fs.rmSync(project.root, {recursive: true, force: true});
  }

  project = makeCliProject(false);
  try {
    const outside = path.join(project.root, 'outside-sentinel.html');
    const output = path.join(project.outputDirectory, 'index.html');
    fs.writeFileSync(outside, 'outside sentinel');
    fs.linkSync(outside, output);

    const result = runCli(project);
    assert.ifError(result.error);
    assert.strictEqual(
      result.status,
      0,
      `CLI failed: ${result.stdout || ''}${result.stderr || ''}`,
    );
    assert.strictEqual(fs.readFileSync(outside, 'utf8'), 'outside sentinel');
    assert.strictEqual(fs.readFileSync(output, 'utf8'), '<p>CLI output</p>');
  } finally {
    fs.rmSync(project.root, {recursive: true, force: true});
  }

  if (process.platform !== 'win32') {
    project = makeCliProject(false);
    try {
      fs.rmSync(path.join(project.sourceDirectory, 'index.pg'));
      const fifo = path.join(project.sourceDirectory, 'special.pg');
      if (makeFifo(fifo)) {
        const result = runCli(project, 3000);
        assert.ifError(result.error);
        assert.notStrictEqual(
          result.status,
          0,
          'CLI rejects a FIFO page without blocking',
        );
        assert.ok(
          !fs.existsSync(path.join(project.outputDirectory, 'special.html')),
        );
      }
    } finally {
      fs.rmSync(project.root, {recursive: true, force: true});
    }
  }
}

function smokeFacade(feedPresent) {
  const pg = require('pugneum');
  assert.strictEqual(pg.render('p Hello'), '<p>Hello</p>');
  const warnings = [];
  const warned = pg.render('a(href=‘/smart’) link', {
    filename: 'warning.pg',
    warnings,
  });
  assert.match(warned, /smart/);
  assert.strictEqual(warnings.length, 1);
  const emitted = captureStderr(() => pg.emitWarnings(warnings));
  assert.match(emitted, /TYPOGRAPHIC_QUOTE_DELIMITER/);

  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pugneum-facade-consumer-'),
  );
  try {
    const filename = path.join(root, 'entry.pg');
    fs.writeFileSync(path.join(root, 'partial.pg'), 'strong included');
    fs.writeFileSync(filename, 'p\n  include partial.pg');
    assert.strictEqual(
      pg.renderFile(filename, {basedir: root, warnings: []}),
      '<p><strong>included</strong></p>',
    );
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }

  const source = [
    'div',
    '  :fragment',
    '    ignored',
    'references',
    '  site https://example.test/',
  ].join('\n');
  const html = pg.render(source, {
    filename: 'fragment.pg',
    filters: {
      fragment: {type: 'pugneum', filter: () => 'p @[site linked]'},
    },
    warnings: [],
  });
  assert.match(html, /<a href="https:\/\/example\.test\/">linked<\/a>/);

  const project = makeCliProject(feedPresent);
  try {
    const result = runCli(project);
    assert.strictEqual(
      result.status,
      0,
      `CLI failed: ${result.stdout || ''}${result.stderr || ''}`,
    );
    assert.ok(fs.existsSync(path.join(project.outputDirectory, 'index.html')));
    if (feedPresent) {
      assert.ok(fs.existsSync(path.join(project.outputDirectory, 'atom.xml')));
      assert.ok(fs.existsSync(path.join(project.outputDirectory, 'rss.xml')));
    } else {
      assert.ok(!fs.existsSync(path.join(project.outputDirectory, 'atom.xml')));
      assert.ok(!fs.existsSync(path.join(project.outputDirectory, 'rss.xml')));
    }
  } finally {
    fs.rmSync(project.root, {recursive: true, force: true});
  }

  smokeCliFilesystemBoundaries();
}

function feedIndex() {
  return (
    '<!doctype html><html lang="en"><head>' +
    '<base href="https://example.test/"><title>Journal</title>' +
    '<meta name="description" content="Description">' +
    '<meta name="author" content="Author"></head><body>' +
    '<article data-published-at="2026-01-02">' +
    '<a href="articles/post.html">Post</a></article></body></html>'
  );
}

function feedArticle() {
  return (
    '<!doctype html><html><head><title>Post</title>' +
    '<meta name="description" content="Summary">' +
    '<meta name="author" content="Author"></head><body>' +
    '<article><p>Feed body</p></article></body></html>'
  );
}

function makeFeedFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pugneum-feed-consumer-'));
  const input = path.join(root, 'input');
  const output = path.join(root, 'output');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(path.join(input, 'articles'), {recursive: true});
  fs.mkdirSync(output);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(input, 'index.html'), feedIndex());
  fs.writeFileSync(path.join(input, 'articles', 'post.html'), feedArticle());
  return {root, input, output, outside};
}

function generateFixtureFeeds(generateFeeds, fixture, feeds) {
  return generateFeeds({
    outputDirectory: fixture.input,
    writeDirectory: fixture.output,
    feeds: {url: 'https://example.test/', ...(feeds || {})},
  });
}

function assertNoGeneratedFeeds(fixture) {
  assert.ok(!fs.existsSync(path.join(fixture.output, 'atom.xml')));
  assert.ok(!fs.existsSync(path.join(fixture.output, 'rss.xml')));
}

function smokeFeedFilesystemBoundaries(generateFeeds) {
  let fixture = makeFeedFixture();
  try {
    const linked = path.join(fixture.outside, 'index-role');
    fs.mkdirSync(linked);
    fs.writeFileSync(path.join(linked, 'index.html'), feedIndex());
    makeDirectoryLink(linked, path.join(fixture.input, 'redirect'));
    assertErrorCode(
      () =>
        generateFixtureFeeds(generateFeeds, fixture, {
          index: 'redirect/index.html',
        }),
      'PUGNEUM:FEED_PATH_TRAVERSAL',
    );
    assertNoGeneratedFeeds(fixture);
  } finally {
    fs.rmSync(fixture.root, {recursive: true, force: true});
  }

  fixture = makeFeedFixture();
  try {
    fs.rmSync(path.join(fixture.input, 'articles'), {recursive: true});
    const linked = path.join(fixture.outside, 'article-role');
    fs.mkdirSync(linked);
    fs.writeFileSync(path.join(linked, 'post.html'), feedArticle());
    makeDirectoryLink(linked, path.join(fixture.input, 'articles'));
    assertErrorCode(
      () => generateFixtureFeeds(generateFeeds, fixture),
      'PUGNEUM:FEED_PATH_TRAVERSAL',
    );
    assertNoGeneratedFeeds(fixture);
  } finally {
    fs.rmSync(fixture.root, {recursive: true, force: true});
  }

  for (const role of ['atom', 'rss']) {
    fixture = makeFeedFixture();
    try {
      const linked = path.join(fixture.outside, `${role}-role`);
      fs.mkdirSync(linked);
      makeDirectoryLink(linked, path.join(fixture.output, 'redirect'));
      assertErrorCode(
        () =>
          generateFixtureFeeds(generateFeeds, fixture, {
            [role]: `redirect/${role}.xml`,
          }),
        'PUGNEUM:FEED_PATH_TRAVERSAL',
      );
      assertNoGeneratedFeeds(fixture);
      assert.ok(!fs.existsSync(path.join(linked, `${role}.xml`)));
    } finally {
      fs.rmSync(fixture.root, {recursive: true, force: true});
    }
  }
}

function smokeFeed() {
  const generateFeeds = require('pugneum-feed');
  const fixture = makeFeedFixture();
  try {
    generateFixtureFeeds(generateFeeds, fixture);
    const atom = fs.readFileSync(path.join(fixture.output, 'atom.xml'), 'utf8');
    const rss = fs.readFileSync(path.join(fixture.output, 'rss.xml'), 'utf8');
    assert.match(atom, /<feed/);
    assert.match(atom, /Feed body/);
    assert.match(rss, /<rss/);
    assert.match(rss, /Feed body/);
  } finally {
    fs.rmSync(fixture.root, {recursive: true, force: true});
  }

  smokeFeedFilesystemBoundaries(generateFeeds);
}

function smokeMixins() {
  const mixinDirectory = packageDirectory('pugneum-mixins');
  for (const filename of [
    'breadcrumb.pg',
    'code.pg',
    'details.pg',
    'figure.pg',
    'file-system.pg',
    'quote.pg',
  ]) {
    assert.ok(fs.statSync(path.join(mixinDirectory, filename)).isFile());
  }

  const pg = require('pugneum');
  const root = fs.mkdtempSync(path.join(consumerRoot, 'mixin-consumer-'));
  try {
    const quote = path.join(root, 'quote.pg');
    fs.writeFileSync(
      quote,
      [
        'include @pugneum-mixins/quote.pg',
        '+quote(https://example.test/quotation)',
        '  | Quoted text.',
        '  block caption',
        '    +linked-citation(https://example.test/work)',
        '      block attribution',
        '        | Author',
        '      block title',
        '        | Work',
      ].join('\n'),
    );
    const quoteHtml = pg.renderFile(quote, {basedir: root, warnings: []});
    assert.match(
      quoteHtml,
      /<blockquote cite="https:\/\/example\.test\/quotation">/,
    );
    assert.match(
      quoteHtml,
      /<figcaption>Author, <cite><a href="https:\/\/example\.test\/work">Work<\/a><\/cite><\/figcaption>/,
    );

    const code = path.join(root, 'code.pg');
    fs.writeFileSync(
      code,
      [
        'include @pugneum-mixins/code.pg',
        '+code',
        '  :prismjs(language=javascript)',
        '    const value = 1;',
        '  block caption',
        '    | Example',
      ].join('\n'),
    );
    const codeHtml = pg.renderFile(code, {basedir: root, warnings: []});
    assert.match(codeHtml, /<figure>/);
    assert.match(codeHtml, /token /);
    assert.match(codeHtml, /<figcaption>Example<\/figcaption>/);

    const allMixins = path.join(root, 'all-mixins.pg');
    fs.writeFileSync(
      allMixins,
      [
        'include @pugneum-mixins/breadcrumb.pg',
        'include @pugneum-mixins/code.pg',
        'include @pugneum-mixins/details.pg',
        'include @pugneum-mixins/figure.pg',
        'include @pugneum-mixins/file-system.pg',
        'include @pugneum-mixins/quote.pg',
        '+breadcrumbs',
        '  +breadcrumb(/) Home',
        '  +breadcrumb-current Here',
        '+code',
        '  | const answer = 42;',
        '+details(Summary)',
        '  p Details',
        '+figure',
        '  img(src=/image.png alt=Image)',
        '+file-system',
        '  +file(index.js)',
        '+quote',
        '  | Quote',
      ].join('\n'),
    );
    const allHtml = pg.renderFile(allMixins, {
      basedir: root,
      warnings: [],
    });
    assert.match(allHtml, /<nav aria-label="Breadcrumb"><ol>/);
    assert.match(allHtml, /<pre><code>const answer = 42;<\/code><\/pre>/);
    assert.match(allHtml, /<details><summary>Summary<\/summary>/);
    assert.match(
      allHtml,
      /<figure><img src="\/image.png" alt="Image"><\/figure>/,
    );
    assert.match(allHtml, /<ul><li><code>index.js<\/code><\/li><\/ul>/);
    assert.match(allHtml, /<figure><blockquote>Quote<\/blockquote><\/figure>/);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
}

function smokeCohort() {
  smokeLeaves();
  smokeLexer();
  smokeParser();
  smokeLoader();
  smokeLinker();
  smokeRenderer();
  smokeFilterer();
  smokePlugins();
  smokeTable();
  smokeFacade(true);
  smokeFeed();
  smokeMixins();
}

const scenario = process.env.PUGNEUM_RELEASE_SCENARIO;
const smoke = {
  cohort: smokeCohort,
  'facade-absent': () => smokeFacade(false),
  'facade-present': () => smokeFacade(true),
  feed: smokeFeed,
  filterer: smokeFilterer,
  leaves: smokeLeaves,
  lexer: smokeLexer,
  linker: smokeLinker,
  loader: smokeLoader,
  parser: smokeParser,
  plugins: smokePlugins,
  renderer: smokeRenderer,
  table: smokeTable,
}[scenario];

assert.ok(smoke, `unknown release smoke scenario: ${scenario}`);
assertExternalInstallBoundary();
smoke();
