var path = require('path');
var assert = require('node:assert/strict');
var Module = require('node:module');
var {test} = require('node:test');
var filename = path.basename(__filename);

var lex = require('pugneum-lexer');
var parse = require('pugneum-parser');
var filter = require('../');

function installedFilterAst() {
  const source = ':highlight.js(language=ruby)\n  puts "hello"\n';
  const options = {filename, source};
  return {ast: parse(lex(source, options), options), options};
}

function interceptInstalledFilterLoad(t, thrown) {
  const specifier = 'pugneum-filter-highlight.js';
  const resolved = require.resolve(specifier);
  const originalLoad = Module._load;
  Module._load = function (request) {
    if (request === specifier || request === resolved) throw thrown;
    return Reflect.apply(originalLoad, this, arguments);
  };
  t.after(() => {
    Module._load = originalLoad;
  });
}

function interceptInstalledFilterResolution(t, thrown) {
  const specifier = 'pugneum-filter-highlight.js';
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function (request) {
    if (request === specifier) throw thrown;
    return Reflect.apply(originalResolveFilename, this, arguments);
  };
  t.after(() => {
    Module._resolveFilename = originalResolveFilename;
  });
}

test('installed filter packages can be used implicitly', (t) => {
  const source = `
pre
  code
    :highlight.js(language=ruby)
      puts 'This should be', :syntax_highlighted
`;

  const tokens = lex(source, {filename});
  const ast = parse(tokens, {filename, source});
  const filtered = filter(ast);

  t.assert.snapshot(filtered);
});

test('a present filter missing a transitive dependency is not unknown', (t) => {
  const failure = new Error(
    "Cannot find module 'filter-transitive-dependency'",
  );
  failure.code = 'MODULE_NOT_FOUND';
  interceptInstalledFilterLoad(t, failure);
  const fixture = installedFilterAst();

  assert.throws(
    () => filter(fixture.ast, undefined, fixture.options),
    (err) => {
      assert.strictEqual(err, failure);
      assert.match(err.message, /filter-transitive-dependency/);
      return true;
    },
  );
});

test('a present filter initialization error retains its identity', (t) => {
  const failure = new Error('filter initialization failed');
  interceptInstalledFilterLoad(t, failure);
  const fixture = installedFilterAst();

  assert.throws(
    () => filter(fixture.ast, undefined, fixture.options),
    (err) => err === failure,
  );
});

test('a primitive filter load failure becomes a coded diagnostic', (t) => {
  interceptInstalledFilterLoad(t, null);
  const fixture = installedFilterAst();

  assert.throws(
    () => filter(fixture.ast, undefined, fixture.options),
    (err) =>
      err.code === 'PUGNEUM:FILTER_LOAD_ERROR' &&
      /Filter 'highlight\.js' failed to load: null/.test(err.message),
  );
});

test('a primitive filter resolution failure becomes a coded diagnostic', (t) => {
  interceptInstalledFilterResolution(t, null);
  const fixture = installedFilterAst();

  assert.throws(
    () => filter(fixture.ast, undefined, fixture.options),
    (err) =>
      err.code === 'PUGNEUM:FILTER_LOAD_ERROR' &&
      /Filter 'highlight\.js' failed to resolve: null/.test(err.message),
  );
});
