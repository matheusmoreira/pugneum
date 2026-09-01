'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {isBuiltin} = require('node:module');
const path = require('node:path');
const {describe, test} = require('node:test');

const repositoryRoot = path.resolve(__dirname, '..');
const rootManifest = readJson(path.join(repositoryRoot, 'package.json'));
const lock = readJson(path.join(repositoryRoot, 'package-lock.json'));
const expectedWorkspaces = Object.freeze([
  'packages/error',
  'packages/lexer',
  'packages/parser',
  'packages/loader',
  'packages/loader/test/fixtures/mock-lib',
  'packages/loader/test/fixtures/unscoped-mock-lib',
  'packages/linker',
  'packages/filterer',
  'packages/renderer',
  'packages/walker',
  'packages/filesystem',
  'packages/pugneum',
  'packages/filter/highlight.js',
  'packages/filter/prismjs',
  'packages/filter/table',
  'packages/feed',
  'packages/mixins',
]);
const expectedReleaseManifests = Object.freeze({
  'packages/error': {
    name: 'pugneum-error',
    version: '1.1.0',
    files: ['index.js'],
  },
  'packages/lexer': {
    name: 'pugneum-lexer',
    version: '1.2.1',
    files: ['index.js'],
    dependencies: {'pugneum-error': '^1.1.0'},
  },
  'packages/parser': {
    name: 'pugneum-parser',
    version: '1.1.1',
    files: ['index.js'],
    dependencies: {'pugneum-error': '^1.0.0'},
    devDependencies: {'pugneum-lexer': '^1.2.1'},
  },
  'packages/loader': {
    name: 'pugneum-loader',
    version: '1.0.4',
    files: ['index.js'],
    dependencies: {
      'pugneum-error': '^1.0.0',
      'pugneum-walker': '^1.0.0',
    },
    devDependencies: {
      'pugneum-lexer': '^1.2.1',
      'pugneum-parser': '^1.1.1',
    },
  },
  'packages/linker': {
    name: 'pugneum-linker',
    version: '1.2.0',
    files: [
      'assembly.js',
      'diagnostics.js',
      'index.js',
      'mixins.js',
      'nodes.js',
    ],
    dependencies: {
      'pugneum-error': '^1.1.0',
      'pugneum-walker': '^1.0.2',
    },
    devDependencies: {
      'pugneum-lexer': '^1.2.1',
      'pugneum-loader': '^1.0.4',
      'pugneum-parser': '^1.1.1',
    },
  },
  'packages/filterer': {
    name: 'pugneum-filterer',
    version: '1.2.0',
    files: ['index.js', 'escape-text.js'],
    dependencies: {
      'pugneum-error': '^1.0.0',
      'pugneum-lexer': '^1.2.0',
      'pugneum-parser': '^1.1.0',
      'pugneum-renderer': '^1.1.0',
      'pugneum-walker': '^1.0.3',
    },
    devDependencies: {
      'pugneum-filter-highlight.js': '^1.1.1',
      'pugneum-linker': '^1.2.0',
    },
  },
  'packages/renderer': {
    name: 'pugneum-renderer',
    version: '1.1.1',
    files: ['index.js'],
    dependencies: {'pugneum-error': '^1.1.0'},
  },
  'packages/walker': {
    name: 'pugneum-walker',
    version: '1.0.3',
    files: ['index.js'],
    devDependencies: {
      'pugneum-lexer': '^1.2.1',
      'pugneum-parser': '^1.1.1',
    },
  },
  'packages/filesystem': {
    name: 'pugneum-filesystem',
    version: '1.0.0',
    files: ['index.js'],
  },
  'packages/pugneum': {
    name: 'pugneum',
    version: '1.3.0',
    files: ['index.js', 'cli.js'],
    dependencies: {
      'pugneum-error': '^1.1.0',
      'pugneum-filterer': '^1.2.0',
      'pugneum-filesystem': '^1.0.0',
      'pugneum-lexer': '^1.2.1',
      'pugneum-linker': '^1.2.0',
      'pugneum-loader': '^1.0.4',
      'pugneum-parser': '^1.1.1',
      'pugneum-renderer': '^1.1.1',
    },
    devDependencies: {
      htmlparser2: '^9.0.0',
      'pugneum-feed': '^1.0.3',
    },
    peerDependencies: {'pugneum-feed': '^1.0.0'},
    peerDependenciesMeta: {'pugneum-feed': {optional: true}},
    bin: {pugneum: 'cli.js'},
  },
  'packages/filter/highlight.js': {
    name: 'pugneum-filter-highlight.js',
    version: '1.1.1',
    files: ['index.js'],
    dependencies: {
      'highlight.js': '^11.8.0',
      'pugneum-error': '^1.0.0',
    },
    devDependencies: {
      'pugneum-filterer': '^1.2.0',
      'pugneum-lexer': '^1.2.1',
      'pugneum-parser': '^1.1.1',
    },
    peerDependencies: {'pugneum-filterer': '^1.1.0'},
  },
  'packages/filter/prismjs': {
    name: 'pugneum-filter-prismjs',
    version: '1.1.1',
    files: ['index.js'],
    dependencies: {
      prismjs: '^1.30.0',
      'pugneum-error': '^1.0.0',
    },
    devDependencies: {
      'pugneum-filterer': '^1.2.0',
      'pugneum-lexer': '^1.2.1',
      'pugneum-parser': '^1.1.1',
    },
    peerDependencies: {'pugneum-filterer': '^1.2.0'},
  },
  'packages/filter/table': {
    name: 'pugneum-filter-table',
    version: '1.0.1',
    files: ['index.js', 'lib/'],
    dependencies: {
      'pugneum-error': '^1.0.0',
      'pugneum-lexer': '^1.2.1',
    },
    devDependencies: {
      'pugneum-filterer': '^1.2.0',
      'pugneum-parser': '^1.1.1',
      'pugneum-renderer': '^1.1.1',
    },
    peerDependencies: {'pugneum-filterer': '^1.1.0'},
  },
  'packages/feed': {
    name: 'pugneum-feed',
    version: '1.0.3',
    files: ['index.js', 'lib/'],
    dependencies: {
      htmlparser2: '^9.0.0',
      'pugneum-error': '^1.1.0',
      'pugneum-filesystem': '^1.0.0',
    },
  },
  'packages/mixins': {
    name: 'pugneum-mixins',
    version: '2.0.0',
    files: ['*.pg'],
    devDependencies: {pugneum: '^1.3.0'},
    peerDependencies: {pugneum: '^1.3.0'},
  },
});
const releaseManifestFields = [
  'name',
  'version',
  'files',
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'bin',
];
const lockFields = [
  'version',
  'license',
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'engines',
  'bin',
];
function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function workspaceManifest(workspace) {
  return readJson(path.join(repositoryRoot, workspace, 'package.json'));
}

function effectiveLockName(workspace, entry) {
  return entry.name || path.basename(workspace);
}

function packageName(specifier) {
  const parts = specifier.split('/');
  return specifier[0] === '@' ? parts.slice(0, 2).join('/') : parts[0];
}

function javascriptFiles(directory) {
  const files = [];
  const entries = fs.readdirSync(directory, {withFileTypes: true});
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.name === 'node_modules') continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...javascriptFiles(filename));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(filename);
  }
  return files;
}

describe('release metadata', () => {
  test('declares the exact 15-package release cohort', () => {
    assert.strictEqual(rootManifest.packageManager, 'npm@10.9.9');
    assert.deepStrictEqual(rootManifest.engines, {
      node: '>=22.5.0',
      npm: '10.9.9',
    });
    assert.deepStrictEqual(rootManifest.workspaces, expectedWorkspaces);
    assert.ok(fs.statSync(path.join(repositoryRoot, 'LICENSE.MIT')).isFile());

    const publicWorkspaces = [];
    for (let i = 0; i < rootManifest.workspaces.length; i++) {
      const workspace = rootManifest.workspaces[i];
      const manifest = workspaceManifest(workspace);
      if (manifest.private) continue;

      publicWorkspaces.push(workspace);
      const expected = expectedReleaseManifests[workspace];
      assert.ok(expected, `${workspace} is in the publish allowlist`);
      for (const field of releaseManifestFields) {
        assert.deepStrictEqual(
          manifest[field],
          expected[field],
          `${workspace} ${field}`,
        );
      }
      assert.deepStrictEqual(
        manifest.engines,
        {node: '>=22'},
        `${workspace} engines`,
      );
      assert.strictEqual(manifest.license, 'MIT');
      assert.ok(
        fs
          .statSync(path.join(repositoryRoot, workspace, 'LICENSE.MIT'))
          .isFile(),
        `${workspace} ships its MIT grant`,
      );
    }

    assert.deepStrictEqual(
      publicWorkspaces.sort(),
      Object.keys(expectedReleaseManifests).sort(),
    );
  });

  test('mirrors every workspace manifest in lockfile v3', () => {
    assert.strictEqual(lock.lockfileVersion, 3);
    assert.strictEqual(lock.requires, true);
    const rootEntry = lock.packages[''];
    assert.strictEqual(rootEntry.name, rootManifest.name);
    for (const field of lockFields.slice(1)) {
      assert.deepStrictEqual(rootEntry[field], rootManifest[field], field);
    }
    assert.deepStrictEqual(rootEntry.workspaces, rootManifest.workspaces);

    const lockedWorkspaces = Object.keys(lock.packages)
      .filter((key) => key.startsWith('packages/'))
      .sort();
    assert.deepStrictEqual(
      lockedWorkspaces,
      [...rootManifest.workspaces].sort(),
    );

    for (let i = 0; i < rootManifest.workspaces.length; i++) {
      const workspace = rootManifest.workspaces[i];
      const manifest = workspaceManifest(workspace);
      const entry = lock.packages[workspace];
      assert.ok(entry, `${workspace} has a lock entry`);
      assert.strictEqual(effectiveLockName(workspace, entry), manifest.name);
      for (const field of lockFields) {
        assert.deepStrictEqual(
          entry[field],
          manifest[field],
          `${workspace} ${field}`,
        );
      }

      const link = lock.packages[`node_modules/${manifest.name}`];
      assert.deepStrictEqual(link, {resolved: workspace, link: true});
    }
  });

  test('declares every literal non-builtin require at its owning boundary', () => {
    for (let i = 0; i < rootManifest.workspaces.length; i++) {
      const workspace = rootManifest.workspaces[i];
      const manifest = workspaceManifest(workspace);
      if (manifest.private) continue;

      const packageRoot = path.join(repositoryRoot, workspace);
      const production = new Set([
        ...Object.keys(manifest.dependencies || {}),
        ...Object.keys(manifest.optionalDependencies || {}),
        ...Object.keys(manifest.peerDependencies || {}),
        manifest.name,
      ]);
      const development = new Set([
        ...production,
        ...Object.keys(manifest.devDependencies || {}),
      ]);

      for (const filename of javascriptFiles(packageRoot)) {
        const relative = path.relative(packageRoot, filename);
        const allowed =
          relative.startsWith('test' + path.sep) ||
          relative.endsWith('.test.js')
            ? development
            : production;
        const source = fs.readFileSync(filename, 'utf8');
        const requireCall = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
        for (const match of source.matchAll(requireCall)) {
          const specifier = match[1];
          if (specifier.startsWith('.') || isBuiltin(specifier)) {
            continue;
          }
          const dependency = packageName(specifier);
          assert.ok(
            allowed.has(dependency),
            `${workspace}/${relative} must declare ${dependency}`,
          );
        }
      }
    }
  });
});
