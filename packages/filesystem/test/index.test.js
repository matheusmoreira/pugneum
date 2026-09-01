const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const {describe, test} = require('node:test');

const createRootedFilesystem = require('../');
const {ERROR_CODES} = createRootedFilesystem;

function temporaryRoot(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pugneum-fs-'));
  t.after(() => fs.rmSync(directory, {recursive: true}));
  return directory;
}

function makeSymlinkOrSkip(t, target, link, type) {
  try {
    const platformType =
      process.platform === 'win32' && type === 'dir' ? 'junction' : type;
    fs.symlinkSync(target, link, platformType);
    return true;
  } catch (error) {
    if (['EACCES', 'ENOTSUP', 'EPERM'].includes(error.code)) {
      t.skip(`symlinks are unavailable on this runner (${error.code})`);
      return false;
    }
    throw error;
  }
}

function assertPathEscape(fn) {
  assert.throws(fn, (error) => {
    assert.strictEqual(error.code, ERROR_CODES.PATH_ESCAPE);
    return true;
  });
}

function assertNotRegular(fn) {
  assert.throws(fn, (error) => {
    assert.strictEqual(error.code, ERROR_CODES.NOT_REGULAR_FILE);
    return true;
  });
}

function assertNotDirectory(fn) {
  assert.throws(fn, (error) => {
    assert.strictEqual(error.code, ERROR_CODES.NOT_DIRECTORY);
    return true;
  });
}

function assertWriteFailed(fn, requestedPath) {
  assert.throws(fn, (error) => {
    assert.strictEqual(error.code, 'PUGNEUM:FILESYSTEM_WRITE_FAILED');
    assert.strictEqual(error.path, requestedPath);
    return true;
  });
}

function failPublicationRename(t, destinationName) {
  const originalRenameSync = fs.renameSync;
  let failed = false;
  fs.renameSync = function (source, destination) {
    if (
      !failed &&
      path.basename(destination) === destinationName &&
      path.basename(source).endsWith('.temporary')
    ) {
      failed = true;
      const error = new Error('injected publication failure');
      error.code = 'EIO';
      throw error;
    }
    return Reflect.apply(originalRenameSync, this, arguments);
  };
  t.after(() => {
    fs.renameSync = originalRenameSync;
  });
  return () => failed;
}

describe('rooted regular-file reads', () => {
  test('requires a directory as the configured root', (t) => {
    const sandbox = temporaryRoot(t);
    const file = path.join(sandbox, 'file.txt');
    fs.writeFileSync(file, 'not a directory');

    assertNotDirectory(() => createRootedFilesystem(file));
  });

  test('reads the opened regular-file descriptor', (t) => {
    const root = temporaryRoot(t);
    fs.writeFileSync(path.join(root, 'index.html'), 'hello');
    const files = createRootedFilesystem(root);

    assert.strictEqual(files.readFile('index.html', 'utf8'), 'hello');
    assert.deepStrictEqual(files.readFile('index.html'), Buffer.from('hello'));
  });

  test('rejects an oversized regular file before allocating its contents', (t) => {
    const root = temporaryRoot(t);
    fs.writeFileSync(path.join(root, 'large.txt'), '12345');
    const files = createRootedFilesystem(root);
    const originalReadFileSync = fs.readFileSync;
    let reads = 0;
    fs.readFileSync = function () {
      reads++;
      return Reflect.apply(originalReadFileSync, this, arguments);
    };
    t.after(() => {
      fs.readFileSync = originalReadFileSync;
    });

    assert.throws(
      () => files.readFile('large.txt', {encoding: 'utf8', maxBytes: 4}),
      (failure) => {
        assert.strictEqual(failure.code, ERROR_CODES.LIMIT_EXCEEDED);
        assert.strictEqual(failure.path, 'large.txt');
        assert.strictEqual(failure.size, 5);
        assert.strictEqual(failure.maxBytes, 4);
        return true;
      },
    );
    assert.strictEqual(reads, 0);
    assert.strictEqual(
      files.readFile('large.txt', {encoding: 'utf8', maxBytes: 5}),
      '12345',
    );
    assert.strictEqual(reads, 1);
  });

  test('rechecks the opened file size before reading across a growth race', (t) => {
    const root = temporaryRoot(t);
    const target = path.join(root, 'growing.txt');
    fs.writeFileSync(target, '1234');
    const files = createRootedFilesystem(root);
    const originalOpenSync = fs.openSync;
    const originalReadFileSync = fs.readFileSync;
    let opens = 0;
    let reads = 0;
    fs.openSync = function () {
      opens++;
      if (opens === 2) {
        const appendDescriptor = originalOpenSync(target, 'a');
        try {
          fs.writeSync(appendDescriptor, '5');
        } finally {
          fs.closeSync(appendDescriptor);
        }
      }
      return Reflect.apply(originalOpenSync, this, arguments);
    };
    fs.readFileSync = function () {
      reads++;
      return Reflect.apply(originalReadFileSync, this, arguments);
    };
    t.after(() => {
      fs.openSync = originalOpenSync;
      fs.readFileSync = originalReadFileSync;
    });

    assert.throws(
      () => files.readFile('growing.txt', {encoding: 'utf8', maxBytes: 4}),
      (failure) => {
        assert.strictEqual(failure.code, ERROR_CODES.LIMIT_EXCEEDED);
        assert.strictEqual(failure.size, 5);
        assert.strictEqual(failure.maxBytes, 4);
        return true;
      },
    );
    assert.strictEqual(reads, 0);
  });

  test('validates maxBytes without touching the filesystem', (t) => {
    const root = temporaryRoot(t);
    const files = createRootedFilesystem(root);

    for (const maxBytes of [-1, 1.5, '1']) {
      assert.throws(
        () => files.readFile('missing.txt', {maxBytes}),
        /options\.maxBytes must be a non-negative integer/,
      );
    }
  });

  test('contains descendants when the configured root is a filesystem root', (t) => {
    const sandbox = temporaryRoot(t);
    const systemRoot = path.parse(sandbox).root;
    const target = path.join(sandbox, 'inside.txt');
    const relative = path.relative(systemRoot, target);
    fs.writeFileSync(target, 'inside');
    const files = createRootedFilesystem(systemRoot);

    assert.strictEqual(files.readFile(relative, 'utf8'), 'inside');
  });

  test('rejects lexical escapes and the root itself', (t) => {
    const root = temporaryRoot(t);
    const files = createRootedFilesystem(root);

    assertPathEscape(() => files.readFile('../outside'));
    assertPathEscape(() => files.readFile('.'));
    assertPathEscape(() => files.readFile(path.join(root, 'inside')));
  });

  test('preserves ENOENT for an ordinary missing descendant', (t) => {
    const root = temporaryRoot(t);
    const files = createRootedFilesystem(root);

    assert.throws(
      () => files.readFile('missing.html'),
      (error) => error.code === 'ENOENT',
    );
  });

  test('accepts a symlink as the configured root identity', (t) => {
    const sandbox = temporaryRoot(t);
    const actual = path.join(sandbox, 'actual');
    const alias = path.join(sandbox, 'alias');
    fs.mkdirSync(actual);
    fs.writeFileSync(path.join(actual, 'index.html'), 'inside');
    if (!makeSymlinkOrSkip(t, actual, alias, 'dir')) return;
    const files = createRootedFilesystem(alias);

    assert.strictEqual(files.readFile('index.html', 'utf8'), 'inside');
    files.writeFileAtomic('atom.xml', 'feed', 'utf8');
    assert.strictEqual(
      fs.readFileSync(path.join(actual, 'atom.xml'), 'utf8'),
      'feed',
    );
  });

  test('rejects replacement of the configured root identity', (t) => {
    const sandbox = temporaryRoot(t);
    const root = path.join(sandbox, 'root');
    const parked = path.join(sandbox, 'parked');
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'index.html'), 'trusted');
    const files = createRootedFilesystem(root);

    fs.renameSync(root, parked);
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'index.html'), 'replacement');

    assertPathEscape(() => files.readFile('index.html', 'utf8'));
    assertPathEscape(() => files.ensureDirectory('nested'));
    assertPathEscape(() => files.writeFileAtomic('atom.xml', 'bad'));
    assert.strictEqual(
      fs.readFileSync(path.join(root, 'index.html'), 'utf8'),
      'replacement',
    );
    assert.ok(!fs.existsSync(path.join(root, 'atom.xml')));
  });

  test('rejects a leaf symlink', (t) => {
    const sandbox = temporaryRoot(t);
    const root = path.join(sandbox, 'root');
    const outside = path.join(sandbox, 'outside');
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret'), 'secret');

    if (
      !makeSymlinkOrSkip(
        t,
        path.join(outside, 'secret'),
        path.join(root, 'leaf'),
        'file',
      )
    ) {
      return;
    }

    const files = createRootedFilesystem(root);
    assertPathEscape(() => files.readFile('leaf'));
  });

  test('rejects an ancestor symlink', (t) => {
    const sandbox = temporaryRoot(t);
    const root = path.join(sandbox, 'root');
    const outside = path.join(sandbox, 'outside');
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret'), 'secret');
    if (!makeSymlinkOrSkip(t, outside, path.join(root, 'ancestor'), 'dir')) {
      return;
    }

    const files = createRootedFilesystem(root);
    assertPathEscape(() => files.readFile('ancestor/secret'));
  });

  test('rejects a socket leaf before a read or write can block', async (t) => {
    if (process.platform === 'win32') {
      t.skip('Windows named pipes are not filesystem socket entries');
      return;
    }

    const root = temporaryRoot(t);
    const socketPath = path.join(root, 'special');
    const server = net.createServer();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });

    try {
      const files = createRootedFilesystem(root);
      assertNotRegular(() => files.readFile('special'));
      assertNotRegular(() => files.writeFileAtomic('special', 'content'));
    } finally {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  test('a regular leaf swapped to a FIFO cannot block before fstat', (t) => {
    if (process.platform === 'win32') {
      t.skip('Windows named pipes are not filesystem FIFO entries');
      return;
    }

    const root = temporaryRoot(t);
    const probe = path.join(root, 'mkfifo-probe');
    const mkfifo = spawnSync('mkfifo', [probe], {encoding: 'utf8'});
    if (mkfifo.error && mkfifo.error.code === 'ENOENT') {
      t.skip('mkfifo is unavailable on this runner');
      return;
    }
    assert.strictEqual(mkfifo.status, 0, mkfifo.stderr);
    fs.unlinkSync(probe);

    const fixture = path.join(__dirname, 'fixtures', 'fifo-race.js');
    const result = spawnSync(process.execPath, [fixture, root], {
      encoding: 'utf8',
      timeout: 2000,
    });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, result.stderr);
  });

  test('a leaf swapped to a symlink at open time is not followed', (t) => {
    const sandbox = temporaryRoot(t);
    const root = path.join(sandbox, 'root');
    fs.mkdirSync(root);
    const target = path.join(root, 'page.html');
    const outside = path.join(sandbox, 'outside.html');
    const probe = path.join(root, 'probe');
    fs.writeFileSync(target, 'inside');
    fs.writeFileSync(outside, 'outside');
    if (!makeSymlinkOrSkip(t, outside, probe, 'file')) return;
    fs.unlinkSync(probe);

    const originalOpenSync = fs.openSync;
    let swapped = false;
    fs.openSync = function (filename) {
      if (!swapped && path.basename(filename) === path.basename(target)) {
        swapped = true;
        fs.unlinkSync(target);
        fs.symlinkSync(outside, target, 'file');
      }
      return Reflect.apply(originalOpenSync, this, arguments);
    };

    try {
      const files = createRootedFilesystem(root);
      assertPathEscape(() => files.readFile('page.html', 'utf8'));
      assert.ok(swapped);
    } finally {
      fs.openSync = originalOpenSync;
    }
  });

  test('an ancestor swapped at open time fails descriptor containment', (t) => {
    const sandbox = temporaryRoot(t);
    const root = path.join(sandbox, 'root');
    const section = path.join(root, 'section');
    const parked = path.join(root, 'parked');
    const outside = path.join(sandbox, 'outside');
    fs.mkdirSync(section, {recursive: true});
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(section, 'page.html'), 'inside');
    fs.writeFileSync(path.join(outside, 'page.html'), 'outside');

    const probe = path.join(root, 'probe');
    if (!makeSymlinkOrSkip(t, outside, probe, 'dir')) return;
    fs.unlinkSync(probe);

    const target = path.join(section, 'page.html');
    const originalOpenSync = fs.openSync;
    let swapped = false;
    fs.openSync = function (filename) {
      if (!swapped && path.basename(filename) === path.basename(target)) {
        swapped = true;
        fs.renameSync(section, parked);
        fs.symlinkSync(
          outside,
          section,
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      }
      return Reflect.apply(originalOpenSync, this, arguments);
    };

    try {
      const files = createRootedFilesystem(root);
      assertPathEscape(() => files.readFile('section/page.html', 'utf8'));
      assert.ok(swapped);
    } finally {
      fs.openSync = originalOpenSync;
    }
  });
});

describe('rooted atomic publication', () => {
  test('publishes beneath a configured filesystem root', (t) => {
    const sandbox = temporaryRoot(t);
    const systemRoot = path.parse(sandbox).root;
    const target = path.join(sandbox, 'rooted-output.html');
    const relative = path.relative(systemRoot, target);
    const files = createRootedFilesystem(systemRoot);

    files.writeFileAtomic(relative, 'inside', 'utf8');

    assert.strictEqual(fs.readFileSync(target, 'utf8'), 'inside');
  });

  test('creates descendant directories without following links', (t) => {
    const sandbox = temporaryRoot(t);
    const root = path.join(sandbox, 'root');
    const outside = path.join(sandbox, 'outside');
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    const files = createRootedFilesystem(root);

    files.ensureDirectory('articles/2026');
    assert.ok(fs.statSync(path.join(root, 'articles', '2026')).isDirectory());

    if (!makeSymlinkOrSkip(t, outside, path.join(root, 'redirect'), 'dir')) {
      return;
    }
    assertPathEscape(() => files.ensureDirectory('redirect/nested'));
    assert.ok(!fs.existsSync(path.join(outside, 'nested')));
  });

  test('reports an existing file where a parent directory is required', (t) => {
    const root = temporaryRoot(t);
    fs.writeFileSync(path.join(root, 'blocked'), 'file');
    const files = createRootedFilesystem(root);

    assertNotDirectory(() => files.ensureDirectory('blocked/nested'));
  });

  test('atomically replaces a regular destination', (t) => {
    const root = temporaryRoot(t);
    const target = path.join(root, 'atom.xml');
    fs.writeFileSync(target, 'old');
    const files = createRootedFilesystem(root);

    files.writeFileAtomic('atom.xml', 'new', 'utf8');

    assert.strictEqual(fs.readFileSync(target, 'utf8'), 'new');
    assert.deepStrictEqual(fs.readdirSync(root), ['atom.xml']);
  });

  test('syncs each published file and its containing directory', (t) => {
    if (process.platform === 'win32') {
      t.skip('Node does not expose writable Windows directory handles');
      return;
    }

    const root = temporaryRoot(t);
    fs.mkdirSync(path.join(root, 'nested'));
    const files = createRootedFilesystem(root);
    const originalFsyncSync = fs.fsyncSync;
    const stages = [];
    fs.fsyncSync = function (fd) {
      const stat = fs.fstatSync(fd);
      stages.push(stat.isDirectory() ? 'directory' : 'file');
    };

    try {
      files.writeFileAtomic('atom.xml', 'root feed', 'utf8');
      assert.deepStrictEqual(stages, ['file', 'directory']);

      stages.length = 0;
      files.writeFileAtomic('nested/rss.xml', 'nested feed', 'utf8');
      assert.deepStrictEqual(stages, ['file', 'directory']);
    } finally {
      fs.fsyncSync = originalFsyncSync;
    }
  });

  test('replacing a hard-linked destination does not truncate its other name', (t) => {
    const sandbox = temporaryRoot(t);
    const root = path.join(sandbox, 'root');
    const outside = path.join(sandbox, 'outside');
    fs.mkdirSync(root);
    fs.writeFileSync(outside, 'outside sentinel');
    fs.linkSync(outside, path.join(root, 'rss.xml'));
    const files = createRootedFilesystem(root);

    files.writeFileAtomic('rss.xml', 'new feed', 'utf8');

    assert.strictEqual(
      fs.readFileSync(path.join(root, 'rss.xml'), 'utf8'),
      'new feed',
    );
    assert.strictEqual(fs.readFileSync(outside, 'utf8'), 'outside sentinel');
  });

  test('a failed write preserves the old file and removes its temporary file', (t) => {
    const root = temporaryRoot(t);
    fs.writeFileSync(path.join(root, 'atom.xml'), 'old');
    const files = createRootedFilesystem(root);

    assert.throws(() => files.writeFileAtomic('atom.xml', Symbol('invalid')));

    assert.strictEqual(
      fs.readFileSync(path.join(root, 'atom.xml'), 'utf8'),
      'old',
    );
    assert.deepStrictEqual(fs.readdirSync(root), ['atom.xml']);
  });

  test('rejects a symlinked leaf destination', (t) => {
    const sandbox = temporaryRoot(t);
    const root = path.join(sandbox, 'root');
    const outside = path.join(sandbox, 'outside');
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'sentinel'), 'outside sentinel');

    if (
      !makeSymlinkOrSkip(
        t,
        path.join(outside, 'sentinel'),
        path.join(root, 'atom.xml'),
        'file',
      )
    ) {
      return;
    }

    const files = createRootedFilesystem(root);
    assertPathEscape(() => files.writeFileAtomic('atom.xml', 'bad'));
    assert.strictEqual(
      fs.readFileSync(path.join(outside, 'sentinel'), 'utf8'),
      'outside sentinel',
    );
  });

  test('rejects a symlinked ancestor destination', (t) => {
    const sandbox = temporaryRoot(t);
    const root = path.join(sandbox, 'root');
    const outside = path.join(sandbox, 'outside');
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    if (!makeSymlinkOrSkip(t, outside, path.join(root, 'redirect'), 'dir')) {
      return;
    }

    const files = createRootedFilesystem(root);
    assertPathEscape(() => files.writeFileAtomic('redirect/rss.xml', 'bad'));
    assert.ok(!fs.existsSync(path.join(outside, 'rss.xml')));
  });

  test('a parent swapped while it is opened cannot redirect publication', (t) => {
    if (process.platform === 'win32') {
      t.skip('Node cannot open a Windows directory handle through node:fs');
      return;
    }

    const sandbox = temporaryRoot(t);
    const root = path.join(sandbox, 'root');
    const feeds = path.join(root, 'feeds');
    const parked = path.join(root, 'parked');
    const outside = path.join(sandbox, 'outside');
    fs.mkdirSync(feeds, {recursive: true});
    fs.mkdirSync(outside);

    const probe = path.join(root, 'probe');
    if (!makeSymlinkOrSkip(t, outside, probe, 'dir')) return;
    fs.unlinkSync(probe);

    const originalOpenSync = fs.openSync;
    let swapped = false;
    fs.openSync = function (filename) {
      if (!swapped && path.basename(filename) === path.basename(feeds)) {
        swapped = true;
        fs.renameSync(feeds, parked);
        fs.symlinkSync(outside, feeds, 'dir');
      }
      return Reflect.apply(originalOpenSync, this, arguments);
    };

    try {
      const files = createRootedFilesystem(root);
      assertPathEscape(() => files.writeFileAtomic('feeds/atom.xml', 'bad'));
      assert.ok(swapped);
      assert.ok(!fs.existsSync(path.join(outside, 'atom.xml')));
    } finally {
      fs.openSync = originalOpenSync;
    }
  });

  test('a parent swapped after temporary-file creation cannot redirect rename', (t) => {
    if (process.platform === 'win32') {
      t.skip('Node cannot open a Windows directory handle through node:fs');
      return;
    }

    const sandbox = temporaryRoot(t);
    const root = path.join(sandbox, 'root');
    const feeds = path.join(root, 'feeds');
    const parked = path.join(root, 'parked');
    const outside = path.join(sandbox, 'outside');
    fs.mkdirSync(feeds, {recursive: true});
    fs.mkdirSync(outside);

    const probe = path.join(root, 'probe');
    if (!makeSymlinkOrSkip(t, outside, probe, 'dir')) return;
    fs.unlinkSync(probe);

    const originalOpenSync = fs.openSync;
    let swapped = false;
    fs.openSync = function (filename) {
      const fd = Reflect.apply(originalOpenSync, this, arguments);
      const basename = path.basename(filename);
      if (
        !swapped &&
        basename.startsWith('.atom.xml.') &&
        basename.endsWith('.temporary')
      ) {
        swapped = true;
        fs.renameSync(feeds, parked);
        fs.symlinkSync(outside, feeds, 'dir');
      }
      return fd;
    };

    try {
      const files = createRootedFilesystem(root);
      files.writeFileAtomic('feeds/atom.xml', 'inside feed', 'utf8');
      assert.ok(swapped);
      assert.ok(!fs.existsSync(path.join(outside, 'atom.xml')));
      assert.strictEqual(
        fs.readFileSync(path.join(parked, 'atom.xml'), 'utf8'),
        'inside feed',
      );
    } finally {
      fs.openSync = originalOpenSync;
    }
  });
});

describe('rooted transactional publication', () => {
  test('rejects normalized duplicate destinations before publication', (t) => {
    const root = temporaryRoot(t);
    const files = createRootedFilesystem(root);

    assert.throws(
      () =>
        files.writeFilesTransaction([
          {path: 'feeds/../feed.xml', data: 'atom'},
          {path: 'feed.xml', data: 'rss'},
        ]),
      /duplicate destination/,
    );

    assert.deepStrictEqual(fs.readdirSync(root), []);
  });

  test('publishes a complete set and removes transaction artifacts', (t) => {
    const root = temporaryRoot(t);
    fs.writeFileSync(path.join(root, 'atom.xml'), 'old atom');
    const files = createRootedFilesystem(root);

    files.writeFilesTransaction([
      {path: 'atom.xml', data: 'new atom', options: 'utf8'},
      {path: 'rss.xml', data: 'new rss', options: 'utf8'},
    ]);

    assert.strictEqual(
      fs.readFileSync(path.join(root, 'atom.xml'), 'utf8'),
      'new atom',
    );
    assert.strictEqual(
      fs.readFileSync(path.join(root, 'rss.xml'), 'utf8'),
      'new rss',
    );
    assert.deepStrictEqual(fs.readdirSync(root).sort(), [
      'atom.xml',
      'rss.xml',
    ]);
  });

  test('syncs both staged files before committing directory metadata', (t) => {
    if (process.platform === 'win32') {
      t.skip('Node does not expose writable Windows directory handles');
      return;
    }

    const root = temporaryRoot(t);
    const files = createRootedFilesystem(root);
    const originalFsyncSync = fs.fsyncSync;
    const stages = [];
    fs.fsyncSync = function (fd) {
      const stat = fs.fstatSync(fd);
      stages.push(stat.isDirectory() ? 'directory' : 'file');
    };
    t.after(() => {
      fs.fsyncSync = originalFsyncSync;
    });

    files.writeFilesTransaction([
      {path: 'atom.xml', data: 'new atom'},
      {path: 'rss.xml', data: 'new rss'},
    ]);

    assert.deepStrictEqual(stages, ['file', 'file', 'directory', 'directory']);
  });

  test('stages chunk iterables sequentially without whole-file data', (t) => {
    const root = temporaryRoot(t);
    const files = createRootedFilesystem(root);
    const events = [];

    function* chunks(name) {
      events.push(name + ':start');
      yield name + ' one';
      yield ' two';
      events.push(name + ':end');
    }

    files.writeFilesTransaction([
      {path: 'atom.xml', chunks: chunks('atom'), options: 'utf8'},
      {path: 'rss.xml', chunks: chunks('rss'), options: 'utf8'},
    ]);

    assert.deepStrictEqual(events, [
      'atom:start',
      'atom:end',
      'rss:start',
      'rss:end',
    ]);
    assert.strictEqual(
      fs.readFileSync(path.join(root, 'atom.xml'), 'utf8'),
      'atom one two',
    );
    assert.strictEqual(
      fs.readFileSync(path.join(root, 'rss.xml'), 'utf8'),
      'rss one two',
    );
  });

  test('a chunk producer failure leaves every final destination untouched', (t) => {
    const root = temporaryRoot(t);
    fs.writeFileSync(path.join(root, 'atom.xml'), 'old atom');
    fs.writeFileSync(path.join(root, 'rss.xml'), 'old rss');
    const files = createRootedFilesystem(root);

    function* failedRss() {
      yield 'partial rss';
      throw new Error('serializer failed');
    }

    assertWriteFailed(
      () =>
        files.writeFilesTransaction([
          {path: 'atom.xml', chunks: ['new atom']},
          {path: 'rss.xml', chunks: failedRss()},
        ]),
      'rss.xml',
    );

    assert.strictEqual(
      fs.readFileSync(path.join(root, 'atom.xml'), 'utf8'),
      'old atom',
    );
    assert.strictEqual(
      fs.readFileSync(path.join(root, 'rss.xml'), 'utf8'),
      'old rss',
    );
    assert.deepStrictEqual(fs.readdirSync(root).sort(), [
      'atom.xml',
      'rss.xml',
    ]);
  });

  test('a staging failure preserves all prior destinations', (t) => {
    const root = temporaryRoot(t);
    fs.writeFileSync(path.join(root, 'atom.xml'), 'old atom');
    fs.writeFileSync(path.join(root, 'rss.xml'), 'old rss');
    const files = createRootedFilesystem(root);

    assertWriteFailed(
      () =>
        files.writeFilesTransaction([
          {path: 'atom.xml', data: 'new atom'},
          {path: 'rss.xml', data: Symbol('invalid')},
        ]),
      'rss.xml',
    );

    assert.strictEqual(
      fs.readFileSync(path.join(root, 'atom.xml'), 'utf8'),
      'old atom',
    );
    assert.strictEqual(
      fs.readFileSync(path.join(root, 'rss.xml'), 'utf8'),
      'old rss',
    );
    assert.deepStrictEqual(fs.readdirSync(root).sort(), [
      'atom.xml',
      'rss.xml',
    ]);
  });

  test('a later commit failure removes every fresh destination', (t) => {
    const root = temporaryRoot(t);
    const files = createRootedFilesystem(root);
    const didFail = failPublicationRename(t, 'rss.xml');

    assertWriteFailed(
      () =>
        files.writeFilesTransaction([
          {path: 'atom.xml', data: 'new atom'},
          {path: 'rss.xml', data: 'new rss'},
        ]),
      'rss.xml',
    );

    assert.ok(didFail());
    assert.deepStrictEqual(fs.readdirSync(root), []);
  });

  test('a later commit failure restores every prior destination', (t) => {
    const root = temporaryRoot(t);
    fs.writeFileSync(path.join(root, 'atom.xml'), 'old atom');
    fs.writeFileSync(path.join(root, 'rss.xml'), 'old rss');
    const files = createRootedFilesystem(root);
    const didFail = failPublicationRename(t, 'rss.xml');

    assertWriteFailed(
      () =>
        files.writeFilesTransaction([
          {path: 'atom.xml', data: 'new atom'},
          {path: 'rss.xml', data: 'new rss'},
        ]),
      'rss.xml',
    );

    assert.ok(didFail());
    assert.strictEqual(
      fs.readFileSync(path.join(root, 'atom.xml'), 'utf8'),
      'old atom',
    );
    assert.strictEqual(
      fs.readFileSync(path.join(root, 'rss.xml'), 'utf8'),
      'old rss',
    );
    assert.deepStrictEqual(fs.readdirSync(root).sort(), [
      'atom.xml',
      'rss.xml',
    ]);
  });

  test('preflights every destination before creating a temporary file', (t) => {
    const root = temporaryRoot(t);
    fs.mkdirSync(path.join(root, 'rss.xml'));
    const files = createRootedFilesystem(root);

    assertNotRegular(() =>
      files.writeFilesTransaction([
        {path: 'atom.xml', data: 'new atom'},
        {path: 'rss.xml', data: 'new rss'},
      ]),
    );

    assert.deepStrictEqual(fs.readdirSync(root), ['rss.xml']);
  });
});
