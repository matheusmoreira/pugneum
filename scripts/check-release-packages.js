'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {spawnSync} = require('node:child_process');

const repositoryRoot = path.resolve(__dirname, '..');
const consumerSmoke = path.join(__dirname, 'release-consumer-smoke.js');
const expectedNpmVersion = '10.9.9';
const npmExecPath = process.env.npm_execpath;

const packages = Object.freeze([
  packagePolicy('packages/error', 'pugneum-error', '2.0.0', [
    'LICENSE.MIT',
    'README.md',
    'index.js',
    'package.json',
  ]),
  packagePolicy('packages/lexer', 'pugneum-lexer', '1.2.1', [
    'LICENSE.MIT',
    'README.md',
    'index.js',
    'package.json',
  ]),
  packagePolicy('packages/parser', 'pugneum-parser', '1.1.1', [
    'LICENSE.MIT',
    'README.md',
    'index.js',
    'package.json',
  ]),
  packagePolicy('packages/loader', 'pugneum-loader', '2.0.0', [
    'LICENSE.MIT',
    'README.md',
    'index.js',
    'package.json',
  ]),
  packagePolicy('packages/linker', 'pugneum-linker', '1.2.0', [
    'LICENSE.MIT',
    'README.md',
    'assembly.js',
    'diagnostics.js',
    'index.js',
    'mixins.js',
    'nodes.js',
    'package.json',
  ]),
  packagePolicy('packages/filterer', 'pugneum-filterer', '1.2.0', [
    'LICENSE.MIT',
    'README.md',
    'escape-text.js',
    'index.js',
    'package.json',
  ]),
  packagePolicy('packages/renderer', 'pugneum-renderer', '1.1.1', [
    'LICENSE.MIT',
    'README.md',
    'index.js',
    'package.json',
  ]),
  packagePolicy('packages/walker', 'pugneum-walker', '2.0.0', [
    'LICENSE.MIT',
    'README.md',
    'index.js',
    'package.json',
  ]),
  packagePolicy('packages/filesystem', 'pugneum-filesystem', '1.0.0', [
    'LICENSE.MIT',
    'README.md',
    'index.js',
    'package.json',
  ]),
  packagePolicy(
    'packages/pugneum',
    'pugneum',
    '2.0.0',
    ['LICENSE.MIT', 'README.md', 'cli.js', 'index.js', 'package.json'],
    {'cli.js': 0o755},
  ),
  packagePolicy(
    'packages/filter/highlight.js',
    'pugneum-filter-highlight.js',
    '1.1.1',
    ['LICENSE.MIT', 'README.md', 'index.js', 'package.json'],
  ),
  packagePolicy('packages/filter/prismjs', 'pugneum-filter-prismjs', '1.1.1', [
    'LICENSE.MIT',
    'README.md',
    'index.js',
    'package.json',
  ]),
  packagePolicy('packages/filter/table', 'pugneum-filter-table', '1.0.1', [
    'LICENSE.MIT',
    'README.md',
    'index.js',
    'lib/generate.js',
    'lib/normalize.js',
    'lib/parse.js',
    'package.json',
  ]),
  packagePolicy('packages/feed', 'pugneum-feed', '1.0.3', [
    'LICENSE.MIT',
    'README.md',
    'index.js',
    'lib/atom.js',
    'lib/date.js',
    'lib/error.js',
    'lib/extract.js',
    'lib/model.js',
    'lib/rss.js',
    'lib/urls.js',
    'lib/xml.js',
    'package.json',
  ]),
  packagePolicy('packages/mixins', 'pugneum-mixins', '2.0.0', [
    'LICENSE.MIT',
    'README.md',
    'breadcrumb.pg',
    'code.pg',
    'details.pg',
    'figure.pg',
    'file-system.pg',
    'package.json',
    'quote.pg',
  ]),
]);

const versions = Object.freeze(
  Object.fromEntries(packages.map((entry) => [entry.name, entry.version])),
);

function packagePolicy(workspace, name, version, files, modes) {
  return Object.freeze({
    workspace,
    name,
    version,
    id: `${name}@${version}`,
    files: Object.freeze(files),
    modes: Object.freeze(modes || {}),
  });
}

function cleanEnvironment(extra) {
  const env = {...process.env, ...(extra || {})};
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  delete env.INIT_CWD;
  delete env.npm_config_include_workspace_root;
  delete env.npm_config_local_prefix;
  delete env.npm_config_workspace;
  delete env.npm_config_workspaces;
  delete env.npm_package_json;
  delete env.npm_package_name;
  delete env.npm_lifecycle_event;
  env.NO_UPDATE_NOTIFIER = '1';
  env.npm_config_update_notifier = 'false';
  return env;
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options && options.cwd,
    encoding: 'utf8',
    env: cleanEnvironment(options && options.env),
    maxBuffer: 64 * 1024 * 1024,
    timeout: (options && options.timeout) || 180000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const invocation = [command, ...args].join(' ');
    throw new Error(
      `${invocation} exited ${result.status}\n${result.stdout || ''}${
        result.stderr || ''
      }`,
    );
  }
  return result;
}

function runNpm(args, options) {
  return run(process.execPath, [npmExecPath, ...args], options);
}

function parseJsonOutput(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label} did not emit JSON: ${error.message}`);
  }
}

function assertPinnedNpm() {
  assert.ok(
    npmExecPath && path.isAbsolute(npmExecPath),
    'run through npm 10.9.9 so npm_execpath identifies the pinned CLI',
  );
  const version = run(process.execPath, [npmExecPath, '--version'], {
    cwd: repositoryRoot,
  }).stdout.trim();
  assert.strictEqual(
    version,
    expectedNpmVersion,
    `release checks require npm ${expectedNpmVersion}`,
  );
}

function assertOutsideRepository(directory) {
  const relative = path.relative(repositoryRoot, directory);
  assert.ok(
    path.isAbsolute(relative) ||
      relative === '..' ||
      relative.startsWith('..' + path.sep),
    `${directory} must be outside the repository`,
  );
}

function packRelease(tempRoot) {
  const tarballDirectory = path.join(tempRoot, 'tarballs');
  fs.mkdirSync(tarballDirectory);
  const result = runNpm(
    [
      'pack',
      '--json',
      '--ignore-scripts',
      '--pack-destination',
      tarballDirectory,
      ...packages.map((entry) => './' + entry.workspace),
    ],
    {cwd: repositoryRoot},
  );
  const records = parseJsonOutput(result, 'npm pack');
  assert.ok(Array.isArray(records), 'npm pack returns an array');
  assert.strictEqual(records.length, packages.length);

  const byName = new Map(records.map((record) => [record.name, record]));
  const tarballs = Object.create(null);
  for (const expected of packages) {
    const record = byName.get(expected.name);
    assert.ok(record, `${expected.name} has a pack record`);
    assert.strictEqual(record.id, expected.id);
    assert.strictEqual(record.version, expected.version);
    assert.strictEqual(record.entryCount, expected.files.length);
    assert.deepStrictEqual(record.bundled, []);
    assert.deepStrictEqual(
      record.files.map((file) => file.path),
      expected.files,
      `${expected.name} pack inventory`,
    );
    for (const file of record.files) {
      const mode = expected.modes[file.path] || 0o644;
      assert.strictEqual(file.mode, mode, `${expected.name} ${file.path} mode`);
    }

    const tarball = path.resolve(tarballDirectory, record.filename);
    assert.strictEqual(path.dirname(tarball), tarballDirectory);
    assert.ok(fs.statSync(tarball).isFile(), `${record.filename} was created`);
    tarballs[expected.name] = tarball;
  }
  return tarballs;
}

function localSpec(tarballs, name) {
  assert.ok(tarballs[name], `missing tarball for ${name}`);
  return pathToFileURL(tarballs[name]).href;
}

function localDependencies(tarballs, names) {
  return Object.fromEntries(
    names.map((name) => [name, localSpec(tarballs, name)]),
  );
}

function resolution(from, dependency, version) {
  return {from, dependency, version};
}

function localResolution(from, dependency) {
  return resolution(from, dependency, versions[dependency]);
}

function coreCohortDependencies(tarballs) {
  return localDependencies(tarballs, [
    'pugneum',
    'pugneum-error',
    'pugneum-filesystem',
    'pugneum-filterer',
    'pugneum-lexer',
    'pugneum-linker',
    'pugneum-loader',
    'pugneum-parser',
    'pugneum-renderer',
    'pugneum-walker',
  ]);
}

function allCohortDependencies(tarballs) {
  return localDependencies(
    tarballs,
    packages.map((entry) => entry.name),
  );
}

function cohortResolutions() {
  return [
    localResolution('pugneum-lexer', 'pugneum-error'),
    localResolution('pugneum-parser', 'pugneum-error'),
    localResolution('pugneum-loader', 'pugneum-error'),
    localResolution('pugneum-loader', 'pugneum-walker'),
    localResolution('pugneum-linker', 'pugneum-error'),
    localResolution('pugneum-linker', 'pugneum-walker'),
    localResolution('pugneum-filterer', 'pugneum-error'),
    localResolution('pugneum-filterer', 'pugneum-lexer'),
    localResolution('pugneum-filterer', 'pugneum-parser'),
    localResolution('pugneum-filterer', 'pugneum-renderer'),
    localResolution('pugneum-filterer', 'pugneum-walker'),
    localResolution('pugneum-renderer', 'pugneum-error'),
    localResolution('pugneum-renderer', 'pugneum-walker'),
    localResolution('pugneum', 'pugneum-filesystem'),
    localResolution('pugneum', 'pugneum-filterer'),
    localResolution('pugneum', 'pugneum-lexer'),
    localResolution('pugneum', 'pugneum-linker'),
    localResolution('pugneum', 'pugneum-loader'),
    localResolution('pugneum', 'pugneum-parser'),
    localResolution('pugneum', 'pugneum-renderer'),
    localResolution('pugneum', 'pugneum-feed'),
    localResolution('pugneum-feed', 'pugneum-error'),
    localResolution('pugneum-feed', 'pugneum-filesystem'),
    localResolution('pugneum-mixins', 'pugneum'),
    localResolution('pugneum-filter-highlight.js', 'pugneum-filterer'),
    localResolution('pugneum-filter-prismjs', 'pugneum-filterer'),
    localResolution('pugneum-filter-table', 'pugneum-filterer'),
    localResolution('pugneum-filter-table', 'pugneum-error'),
    localResolution('pugneum-filter-table', 'pugneum-lexer'),
  ];
}

function exactExternalDependencies() {
  return {
    'highlight.js': '11.8.0',
    htmlparser2: '9.0.0',
    'prism-minmaxed': '1.0.0',
  };
}

function scenarios(tarballs) {
  const lexerErrorOverride = {
    'pugneum-lexer': {
      'pugneum-error': localSpec(tarballs, 'pugneum-error'),
    },
  };
  const tableErrorOverrides = {
    ...lexerErrorOverride,
    'pugneum-renderer': {
      'pugneum-error': localSpec(tarballs, 'pugneum-error'),
      'pugneum-walker': localSpec(tarballs, 'pugneum-walker'),
    },
  };
  const cohort = allCohortDependencies(tarballs);
  const core = coreCohortDependencies(tarballs);
  const pluginRuntime = localDependencies(tarballs, [
    'pugneum-error',
    'pugneum-filterer',
    'pugneum-lexer',
    'pugneum-parser',
    'pugneum-renderer',
    'pugneum-walker',
  ]);

  return [
    {
      name: 'leaves',
      smoke: 'leaves',
      dependencies: localDependencies(tarballs, [
        'pugneum-error',
        'pugneum-filesystem',
        'pugneum-walker',
      ]),
    },
    {
      name: 'lexer-minimum',
      smoke: 'lexer',
      dependencies: localDependencies(tarballs, [
        'pugneum-error',
        'pugneum-lexer',
      ]),
      resolutions: [localResolution('pugneum-lexer', 'pugneum-error')],
    },
    {
      name: 'parser-minimum',
      smoke: 'parser',
      dependencies: {
        'pugneum-error': localSpec(tarballs, 'pugneum-error'),
        'pugneum-lexer': localSpec(tarballs, 'pugneum-lexer'),
        'pugneum-parser': localSpec(tarballs, 'pugneum-parser'),
      },
      overrides: lexerErrorOverride,
      resolutions: [
        localResolution('pugneum-parser', 'pugneum-error'),
        localResolution('pugneum-lexer', 'pugneum-error'),
      ],
    },
    {
      name: 'loader-minimum',
      smoke: 'loader',
      dependencies: {
        'pugneum-error': localSpec(tarballs, 'pugneum-error'),
        'pugneum-lexer': localSpec(tarballs, 'pugneum-lexer'),
        'pugneum-loader': localSpec(tarballs, 'pugneum-loader'),
        'pugneum-parser': localSpec(tarballs, 'pugneum-parser'),
        'pugneum-walker': localSpec(tarballs, 'pugneum-walker'),
      },
      overrides: lexerErrorOverride,
      resolutions: [
        localResolution('pugneum-loader', 'pugneum-error'),
        localResolution('pugneum-loader', 'pugneum-walker'),
      ],
    },
    {
      name: 'linker-minimum',
      smoke: 'linker',
      dependencies: {
        'pugneum-error': localSpec(tarballs, 'pugneum-error'),
        'pugneum-lexer': localSpec(tarballs, 'pugneum-lexer'),
        'pugneum-linker': localSpec(tarballs, 'pugneum-linker'),
        'pugneum-parser': localSpec(tarballs, 'pugneum-parser'),
        'pugneum-walker': localSpec(tarballs, 'pugneum-walker'),
      },
      resolutions: [
        localResolution('pugneum-linker', 'pugneum-error'),
        localResolution('pugneum-linker', 'pugneum-walker'),
      ],
    },
    {
      name: 'renderer-minimum',
      smoke: 'renderer',
      dependencies: localDependencies(tarballs, [
        'pugneum-error',
        'pugneum-renderer',
        'pugneum-walker',
      ]),
      resolutions: [
        localResolution('pugneum-renderer', 'pugneum-error'),
        localResolution('pugneum-renderer', 'pugneum-walker'),
      ],
    },
    {
      name: 'filterer-minimum',
      smoke: 'filterer',
      dependencies: {
        'pugneum-error': localSpec(tarballs, 'pugneum-error'),
        'pugneum-filterer': localSpec(tarballs, 'pugneum-filterer'),
        'pugneum-lexer': '1.2.0',
        'pugneum-parser': '1.1.0',
        'pugneum-renderer': '1.1.0',
        'pugneum-walker': localSpec(tarballs, 'pugneum-walker'),
      },
      resolutions: [
        localResolution('pugneum-filterer', 'pugneum-error'),
        resolution('pugneum-filterer', 'pugneum-lexer', '1.2.0'),
        resolution('pugneum-filterer', 'pugneum-parser', '1.1.0'),
        resolution('pugneum-filterer', 'pugneum-renderer', '1.1.0'),
        localResolution('pugneum-filterer', 'pugneum-walker'),
      ],
    },
    {
      name: 'plugins-current-peer',
      smoke: 'plugins',
      dependencies: {
        'highlight.js': '11.8.0',
        'prism-minmaxed': '1.0.0',
        ...pluginRuntime,
        'pugneum-filter-highlight.js': localSpec(
          tarballs,
          'pugneum-filter-highlight.js',
        ),
        'pugneum-filter-prismjs': localSpec(tarballs, 'pugneum-filter-prismjs'),
      },
      resolutions: [
        ...cohortResolutions().filter(
          (entry) =>
            pluginRuntime[entry.from] && pluginRuntime[entry.dependency],
        ),
        localResolution('pugneum-filter-highlight.js', 'pugneum-filterer'),
        localResolution('pugneum-filter-prismjs', 'pugneum-filterer'),
        resolution('pugneum-filter-highlight.js', 'highlight.js', '11.8.0'),
        resolution('pugneum-filter-prismjs', 'prism-minmaxed', '1.0.0'),
      ],
    },
    {
      name: 'table-peer-minimum',
      smoke: 'table',
      dependencies: {
        'pugneum-error': localSpec(tarballs, 'pugneum-error'),
        'pugneum-filter-table': localSpec(tarballs, 'pugneum-filter-table'),
        'pugneum-filterer': '1.1.0',
        'pugneum-lexer': localSpec(tarballs, 'pugneum-lexer'),
        'pugneum-parser': localSpec(tarballs, 'pugneum-parser'),
        'pugneum-renderer': localSpec(tarballs, 'pugneum-renderer'),
        'pugneum-walker': '1.0.2',
      },
      overrides: tableErrorOverrides,
      resolutions: [
        localResolution('pugneum-filter-table', 'pugneum-error'),
        localResolution('pugneum-filter-table', 'pugneum-lexer'),
        resolution('pugneum-filter-table', 'pugneum-filterer', '1.1.0'),
        resolution('pugneum-filterer', 'pugneum-walker', '1.0.2'),
        localResolution('pugneum-renderer', 'pugneum-walker'),
      ],
    },
    {
      name: 'feed-minimum',
      smoke: 'feed',
      dependencies: {
        htmlparser2: '9.0.0',
        ...localDependencies(tarballs, [
          'pugneum-error',
          'pugneum-feed',
          'pugneum-filesystem',
        ]),
      },
      resolutions: [
        resolution('pugneum-feed', 'htmlparser2', '9.0.0'),
        localResolution('pugneum-feed', 'pugneum-error'),
        localResolution('pugneum-feed', 'pugneum-filesystem'),
      ],
    },
    {
      name: 'facade-feed-absent',
      smoke: 'facade-absent',
      dependencies: core,
      installOptions: ['--omit=optional'],
      absent: ['pugneum-feed'],
      resolutions: cohortResolutions().filter((entry) =>
        core[entry.from] && core[entry.dependency] ? true : false,
      ),
    },
    {
      name: 'facade-feed-peer-minimum',
      smoke: 'facade-present',
      dependencies: {...core, 'pugneum-feed': '1.0.0'},
      resolutions: [
        ...cohortResolutions().filter((entry) =>
          core[entry.from] && core[entry.dependency] ? true : false,
        ),
        resolution('pugneum', 'pugneum-feed', '1.0.0'),
      ],
    },
    {
      name: 'coordinated-cohort',
      smoke: 'cohort',
      dependencies: {...cohort, ...exactExternalDependencies()},
      resolutions: [
        ...cohortResolutions(),
        resolution('pugneum-filter-highlight.js', 'highlight.js', '11.8.0'),
        resolution('pugneum-filter-prismjs', 'prism-minmaxed', '1.0.0'),
        resolution('pugneum-feed', 'htmlparser2', '9.0.0'),
      ],
    },
    {
      name: 'latest-compatible',
      smoke: 'cohort',
      dependencies: cohort,
      resolutions: cohortResolutions(),
      freshCache: true,
      preferOnline: true,
      reportVersions: ['highlight.js', 'htmlparser2', 'prism-minmaxed'],
    },
  ];
}

function assertGraphIsolation(tree) {
  const seen = new Set();
  function visit(node) {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    assert.notStrictEqual(node.link, true, 'consumer graph contains no links');
    if (typeof node.resolved === 'string') {
      assert.ok(
        !node.resolved.includes(repositoryRoot),
        `consumer resolution escaped into repository: ${node.resolved}`,
      );
    }
    for (const child of Object.values(node.dependencies || {})) visit(child);
  }
  visit(tree);
}

function assertTopLevelGraph(tree, dependencies) {
  for (const name of Object.keys(dependencies)) {
    const node = tree.dependencies && tree.dependencies[name];
    assert.ok(node, `${name} is installed as a direct dependency`);
    const localVersion = versions[name];
    if (localVersion && dependencies[name].startsWith('file:')) {
      assert.strictEqual(node.version, localVersion, `${name} tarball version`);
    } else if (/^\d+\.\d+\.\d+$/.test(dependencies[name])) {
      assert.strictEqual(node.version, dependencies[name], `${name} version`);
    }
  }
}

function graphContains(tree, packageName) {
  const seen = new Set();
  function visit(node) {
    if (!node || typeof node !== 'object' || seen.has(node)) return false;
    seen.add(node);
    const match = node.dependencies && node.dependencies[packageName];
    if (match && typeof match.version === 'string') return true;
    return Object.values(node.dependencies || {}).some(visit);
  }
  return visit(tree);
}

function graphVersions(tree, packageName) {
  const seen = new Set();
  const found = new Set();
  function visit(node) {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    for (const [name, child] of Object.entries(node.dependencies || {})) {
      if (name === packageName && typeof child.version === 'string') {
        found.add(child.version);
      }
      visit(child);
    }
  }
  visit(tree);
  return [...found].sort();
}

function installConsumer(tempRoot, scenario) {
  const consumerDirectory = path.join(tempRoot, 'consumers', scenario.name);
  fs.mkdirSync(consumerDirectory, {recursive: true});
  assertOutsideRepository(consumerDirectory);
  const manifest = {
    name: `pugneum-release-${scenario.name}`,
    version: '1.0.0',
    private: true,
    dependencies: scenario.dependencies,
  };
  if (scenario.overrides) manifest.overrides = scenario.overrides;
  fs.writeFileSync(
    path.join(consumerDirectory, 'package.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  fs.copyFileSync(consumerSmoke, path.join(consumerDirectory, 'smoke.js'));

  process.stdout.write(`[release-check] install ${scenario.name}\n`);
  const cacheDirectory = scenario.freshCache
    ? path.join(tempRoot, 'npm-cache', scenario.name)
    : null;
  runNpm(
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      scenario.preferOnline ? '--prefer-online' : '--prefer-offline',
      ...(cacheDirectory ? ['--cache', cacheDirectory] : []),
      ...(scenario.installOptions || []),
    ],
    {cwd: consumerDirectory},
  );
  const tree = parseJsonOutput(
    runNpm(['ls', '--all', '--json'], {cwd: consumerDirectory}),
    `npm ls (${scenario.name})`,
  );
  assertTopLevelGraph(tree, scenario.dependencies);
  assertGraphIsolation(tree);
  for (const name of scenario.reportVersions || []) {
    const found = graphVersions(tree, name);
    assert.strictEqual(
      found.length,
      1,
      `${scenario.name} resolves one ${name} version`,
    );
    process.stdout.write(
      `[release-check] ${scenario.name} resolved ${name}@${found[0]}\n`,
    );
  }
  for (const absent of scenario.absent || []) {
    assert.ok(!graphContains(tree, absent), `${absent} is absent`);
    assert.ok(
      !fs.existsSync(
        path.join(consumerDirectory, 'node_modules', ...absent.split('/')),
      ),
      `${absent} has no installed package directory`,
    );
  }

  run(process.execPath, ['smoke.js'], {
    cwd: consumerDirectory,
    env: {
      PUGNEUM_RELEASE_SCENARIO: scenario.smoke,
      PUGNEUM_RELEASE_RESOLUTIONS: JSON.stringify(scenario.resolutions || []),
    },
    timeout: 30000,
  });
}

function main() {
  assertPinnedNpm();
  assert.ok(fs.statSync(consumerSmoke).isFile());
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pugneum-release-check-'),
  );
  let succeeded = false;
  try {
    assertOutsideRepository(tempRoot);
    process.stdout.write(
      `[release-check] Node ${process.version}, npm ${expectedNpmVersion}\n`,
    );
    const tarballs = packRelease(tempRoot);
    process.stdout.write(
      `[release-check] packed ${packages.length} release tarballs\n`,
    );
    const checks = scenarios(tarballs);
    for (const scenario of checks) installConsumer(tempRoot, scenario);
    succeeded = true;
    process.stdout.write(
      `[release-check] verified ${packages.length} tarballs in ${checks.length} external consumer graphs\n`,
    );
  } finally {
    if (process.env.PUGNEUM_RELEASE_KEEP_TEMP === '1') {
      process.stderr.write(`[release-check] preserved ${tempRoot}\n`);
    } else {
      fs.rmSync(tempRoot, {recursive: true, force: true});
    }
    if (!succeeded) process.exitCode = 1;
  }
}

main();
