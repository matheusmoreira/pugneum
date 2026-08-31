'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ERROR_CODES = Object.freeze({
  PATH_ESCAPE: 'PUGNEUM:FILESYSTEM_PATH_ESCAPE',
  NOT_REGULAR_FILE: 'PUGNEUM:FILESYSTEM_NOT_REGULAR_FILE',
  NOT_DIRECTORY: 'PUGNEUM:FILESYSTEM_NOT_DIRECTORY',
  WRITE_FAILED: 'PUGNEUM:FILESYSTEM_WRITE_FAILED',
});

class RootedFilesystemError extends Error {
  constructor(code, message, requestedPath, cause) {
    super(message, cause ? {cause} : undefined);
    this.name = 'RootedFilesystemError';
    this.code = code;
    this.path = requestedPath;
  }
}

function rootedError(code, message, requestedPath, cause) {
  return new RootedFilesystemError(code, message, requestedPath, cause);
}

function pathEscaped(requestedPath, cause) {
  return rootedError(
    ERROR_CODES.PATH_ESCAPE,
    `Path escapes the rooted filesystem boundary: ${requestedPath}`,
    requestedPath,
    cause,
  );
}

function notRegularFile(requestedPath) {
  return rootedError(
    ERROR_CODES.NOT_REGULAR_FILE,
    `Expected a regular file: ${requestedPath}`,
    requestedPath,
  );
}

function notDirectory(requestedPath) {
  return rootedError(
    ERROR_CODES.NOT_DIRECTORY,
    `Expected a directory: ${requestedPath}`,
    requestedPath,
  );
}

function writeFailed(requestedPath, cause, detail) {
  return rootedError(
    ERROR_CODES.WRITE_FAILED,
    detail || `Could not publish file transaction at: ${requestedPath}`,
    requestedPath,
    cause,
  );
}

function escapesRoot(relative) {
  return (
    relative === '..' ||
    relative.startsWith('..' + path.sep) ||
    path.isAbsolute(relative)
  );
}

function isWithinRoot(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || !escapesRoot(relative);
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function descriptorPath(fd) {
  if (process.platform === 'win32') return null;
  const candidates = [`/proc/self/fd/${fd}`, `/dev/fd/${fd}`];
  for (let i = 0; i < candidates.length; i++) {
    try {
      return {
        path: candidates[i],
        realpath: fs.realpathSync(candidates[i]),
      };
    } catch (error) {
      if (
        error.code !== 'ENOENT' &&
        error.code !== 'ENOTDIR' &&
        error.code !== 'EINVAL'
      ) {
        throw error;
      }
    }
  }
  return null;
}

function openFlags(base, extras) {
  return base | extras.reduce((flags, value) => flags | (value || 0), 0);
}

module.exports = function createRootedFilesystem(root) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new TypeError('root must be a non-empty string');
  }

  const lexicalRoot = path.resolve(root);
  const realRoot = fs.realpathSync(lexicalRoot);
  const rootStat = fs.statSync(realRoot);
  if (!rootStat.isDirectory()) {
    throw rootedError(
      ERROR_CODES.NOT_DIRECTORY,
      `Expected a directory root: ${root}`,
      root,
    );
  }

  function verifyRootByName(requestedPath) {
    let currentRealpath, currentStat;
    try {
      currentRealpath = fs.realpathSync(realRoot);
      currentStat = fs.statSync(currentRealpath);
    } catch (error) {
      throw pathEscaped(requestedPath, error);
    }
    if (!currentStat.isDirectory() || !sameIdentity(rootStat, currentStat)) {
      throw pathEscaped(requestedPath);
    }
    return currentRealpath;
  }

  function openRoot(requestedPath) {
    let fd;
    let descriptor;
    try {
      if (process.platform !== 'win32') {
        fd = fs.openSync(
          realRoot,
          openFlags(fs.constants.O_RDONLY, [
            fs.constants.O_DIRECTORY,
            fs.constants.O_NOFOLLOW,
          ]),
        );
        const openedStat = fs.fstatSync(fd);
        if (!openedStat.isDirectory() || !sameIdentity(rootStat, openedStat)) {
          throw pathEscaped(requestedPath);
        }
        descriptor = descriptorPath(fd);
        if (
          descriptor &&
          !sameIdentity(openedStat, fs.statSync(descriptor.realpath))
        ) {
          throw pathEscaped(requestedPath);
        }
      }

      const currentRealpath = descriptor
        ? descriptor.realpath
        : verifyRootByName(requestedPath);
      return {
        fd,
        basePath: descriptor ? descriptor.path : realRoot,
        realpath: currentRealpath,
        stat: rootStat,
        descriptorBacked: Boolean(descriptor),
      };
    } catch (error) {
      if (fd !== undefined) fs.closeSync(fd);
      if (['ELOOP', 'EMLINK', 'ENOENT', 'ENOTDIR'].includes(error.code)) {
        throw pathEscaped(requestedPath, error);
      }
      throw error;
    }
  }

  function closeRoot(handle) {
    if (handle && handle.fd !== undefined) fs.closeSync(handle.fd);
  }

  function resolveRequest(requestedPath, allowRoot) {
    if (typeof requestedPath !== 'string' || requestedPath.length === 0) {
      throw new TypeError('path must be a non-empty string');
    }

    if (path.isAbsolute(requestedPath)) {
      throw pathEscaped(requestedPath);
    }

    const lexicalPath = path.resolve(lexicalRoot, requestedPath);
    const relative = path.relative(lexicalRoot, lexicalPath);
    if ((!allowRoot && relative === '') || escapesRoot(relative)) {
      throw pathEscaped(requestedPath);
    }

    return {
      requestedPath,
      relative,
      physicalPath: path.join(realRoot, relative),
    };
  }

  function inspectExisting(resolved, leafKind, rootHandle) {
    const components = resolved.relative.split(path.sep);
    let current = rootHandle.basePath;
    let currentStat = rootHandle.stat;

    for (let i = 0; i < components.length; i++) {
      current = path.join(current, components[i]);
      currentStat = fs.lstatSync(current);
      if (currentStat.isSymbolicLink()) {
        throw pathEscaped(resolved.requestedPath);
      }
      if (i < components.length - 1 && !currentStat.isDirectory()) {
        throw notDirectory(resolved.requestedPath);
      }
    }

    if (leafKind === 'file' && !currentStat.isFile()) {
      throw notRegularFile(resolved.requestedPath);
    }
    if (leafKind === 'directory' && !currentStat.isDirectory()) {
      throw notDirectory(resolved.requestedPath);
    }
    return currentStat;
  }

  function expectedFile(resolved, rootHandle) {
    const inspectedStat = inspectExisting(resolved, 'file', rootHandle);
    const expectedPath = path.join(rootHandle.basePath, resolved.relative);
    const expectedRealpath = fs.realpathSync(expectedPath);
    if (!isWithinRoot(expectedRealpath, rootHandle.realpath)) {
      throw pathEscaped(resolved.requestedPath);
    }
    const expectedStat = fs.statSync(expectedRealpath);
    if (!expectedStat.isFile()) {
      throw notRegularFile(resolved.requestedPath);
    }
    if (!sameIdentity(inspectedStat, expectedStat)) {
      throw pathEscaped(resolved.requestedPath);
    }
    return {expectedRealpath, expectedStat};
  }

  function verifyOpenedFile(fd, resolved, expected, rootHandle) {
    const openedStat = fs.fstatSync(fd);
    if (!openedStat.isFile()) {
      throw notRegularFile(resolved.requestedPath);
    }
    if (!sameIdentity(openedStat, expected.expectedStat)) {
      throw pathEscaped(resolved.requestedPath);
    }

    const descriptor = descriptorPath(fd);
    if (descriptor) {
      if (!isWithinRoot(descriptor.realpath, rootHandle.realpath)) {
        throw pathEscaped(resolved.requestedPath);
      }
      return;
    }

    // Windows does not expose a portable /proc-style pathname for an open
    // handle. Re-resolve the name and require it still to identify the opened
    // object. This rejects static links and ordinary swaps; see the README for
    // the narrower hostile-race guarantee on platforms without openat/handle-
    // relative traversal in Node's public fs API.
    let currentRealpath, currentStat;
    try {
      currentRealpath = fs.realpathSync(
        path.join(rootHandle.basePath, resolved.relative),
      );
      currentStat = fs.statSync(currentRealpath);
    } catch (error) {
      throw pathEscaped(resolved.requestedPath, error);
    }
    if (
      !isWithinRoot(currentRealpath, rootHandle.realpath) ||
      !sameIdentity(openedStat, currentStat)
    ) {
      throw pathEscaped(resolved.requestedPath);
    }
  }

  function readFile(requestedPath, options) {
    const resolved = resolveRequest(requestedPath);
    let rootHandle;
    let fd;
    let expectedReady = false;
    try {
      rootHandle = openRoot(requestedPath);
      const expected = expectedFile(resolved, rootHandle);
      expectedReady = true;
      fd = fs.openSync(
        path.join(rootHandle.basePath, resolved.relative),
        openFlags(fs.constants.O_RDONLY, [
          fs.constants.O_NOFOLLOW,
          fs.constants.O_NONBLOCK,
        ]),
      );
      verifyOpenedFile(fd, resolved, expected, rootHandle);
      return fs.readFileSync(fd, options);
    } catch (error) {
      if (
        ['ELOOP', 'EMLINK'].includes(error.code) ||
        (expectedReady && ['ENOENT', 'ENOTDIR'].includes(error.code))
      ) {
        throw pathEscaped(requestedPath, error);
      }
      throw error;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      closeRoot(rootHandle);
    }
  }

  function prepareParent(resolved, rootHandle) {
    const parentRelative = path.dirname(resolved.relative);
    const parentPath = path.join(rootHandle.basePath, parentRelative);
    const parentRequest =
      parentRelative === '.' ? '.' : parentRelative.split(path.sep).join('/');
    const parentResolved = {
      requestedPath: parentRequest,
      relative: parentRelative,
      physicalPath: parentPath,
    };

    let inspectedStat;
    if (parentRelative === '.') {
      inspectedStat = rootHandle.stat;
    } else {
      inspectedStat = inspectExisting(parentResolved, 'directory', rootHandle);
    }
    const expectedRealpath = fs.realpathSync(parentPath);
    if (!isWithinRoot(expectedRealpath, rootHandle.realpath)) {
      throw pathEscaped(resolved.requestedPath);
    }
    const expectedStat = fs.statSync(expectedRealpath);
    if (
      !expectedStat.isDirectory() ||
      !sameIdentity(inspectedStat, expectedStat)
    ) {
      throw pathEscaped(resolved.requestedPath);
    }

    return {parentPath, expectedRealpath, expectedStat};
  }

  function verifyParentByName(resolved, parent, rootHandle) {
    let currentRealpath, currentStat;
    try {
      currentRealpath = fs.realpathSync(parent.parentPath);
      currentStat = fs.statSync(currentRealpath);
    } catch (error) {
      throw pathEscaped(resolved.requestedPath, error);
    }
    if (
      !isWithinRoot(currentRealpath, rootHandle.realpath) ||
      !sameIdentity(parent.expectedStat, currentStat)
    ) {
      throw pathEscaped(resolved.requestedPath);
    }
  }

  function openParent(resolved, parent, rootHandle) {
    let fd;
    let descriptor;

    // A descriptor pathname is itself a symlink in procfs/devfs. When the
    // requested parent is the root, reuse the already-verified root handle
    // instead of trying to reopen that pseudo-link with O_NOFOLLOW.
    if (
      rootHandle.descriptorBacked &&
      sameIdentity(parent.expectedStat, rootHandle.stat)
    ) {
      return {
        fd: undefined,
        basePath: rootHandle.basePath,
        descriptorBacked: true,
      };
    }

    // Opening directory handles is not supported by Node's fs.open on Windows.
    // Other platforms get an O_NOFOLLOW directory descriptor and, where the OS
    // exposes it, all subsequent names are resolved through that stable handle.
    if (process.platform !== 'win32') {
      try {
        fd = fs.openSync(
          parent.parentPath,
          openFlags(fs.constants.O_RDONLY, [
            fs.constants.O_DIRECTORY,
            fs.constants.O_NOFOLLOW,
          ]),
        );
      } catch (error) {
        if (['ELOOP', 'EMLINK', 'ENOENT', 'ENOTDIR'].includes(error.code)) {
          throw pathEscaped(resolved.requestedPath, error);
        }
        throw error;
      }

      try {
        const openedStat = fs.fstatSync(fd);
        if (
          !openedStat.isDirectory() ||
          !sameIdentity(openedStat, parent.expectedStat)
        ) {
          throw pathEscaped(resolved.requestedPath);
        }
        descriptor = descriptorPath(fd);
        if (
          descriptor &&
          (!isWithinRoot(descriptor.realpath, rootHandle.realpath) ||
            !sameIdentity(openedStat, fs.statSync(descriptor.realpath)))
        ) {
          throw pathEscaped(resolved.requestedPath);
        }
      } catch (error) {
        fs.closeSync(fd);
        throw error;
      }
    } else {
      verifyParentByName(resolved, parent, rootHandle);
    }

    return {
      fd,
      basePath: descriptor ? descriptor.path : parent.parentPath,
      descriptorBacked: Boolean(descriptor),
    };
  }

  function destinationStat(resolved, targetPath) {
    try {
      const stat = fs.lstatSync(targetPath);
      if (stat.isSymbolicLink()) {
        throw pathEscaped(resolved.requestedPath);
      }
      if (!stat.isFile()) {
        throw notRegularFile(resolved.requestedPath);
      }
      return stat;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  function closeParent(handle) {
    if (handle.fd !== undefined) fs.closeSync(handle.fd);
  }

  function ensureDirectory(requestedPath) {
    const resolved = resolveRequest(requestedPath, true);
    if (resolved.relative === '') return;

    let rootHandle;
    try {
      rootHandle = openRoot(requestedPath);
      const components = resolved.relative.split(path.sep);
      let currentRelative = '';
      for (let i = 0; i < components.length; i++) {
        currentRelative = path.join(currentRelative, components[i]);
        const childResolved = {
          requestedPath,
          relative: currentRelative,
          physicalPath: path.join(rootHandle.basePath, currentRelative),
        };
        const parent = prepareParent(childResolved, rootHandle);
        const handle = openParent(childResolved, parent, rootHandle);
        const childPath = path.join(handle.basePath, components[i]);

        try {
          let childStat;
          try {
            childStat = fs.lstatSync(childPath);
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            if (!handle.descriptorBacked) {
              verifyParentByName(childResolved, parent, rootHandle);
            }
            try {
              fs.mkdirSync(childPath);
            } catch (mkdirError) {
              if (mkdirError.code !== 'EEXIST') throw mkdirError;
            }
            childStat = fs.lstatSync(childPath);
          }

          if (childStat.isSymbolicLink()) {
            throw pathEscaped(requestedPath);
          }
          if (!childStat.isDirectory()) {
            throw notDirectory(requestedPath);
          }
          if (!handle.descriptorBacked) {
            verifyParentByName(childResolved, parent, rootHandle);
          }

          const childRealpath = fs.realpathSync(childResolved.physicalPath);
          const childRealStat = fs.statSync(childRealpath);
          if (
            !isWithinRoot(childRealpath, rootHandle.realpath) ||
            !childRealStat.isDirectory() ||
            !sameIdentity(childStat, childRealStat)
          ) {
            throw pathEscaped(requestedPath);
          }
        } finally {
          closeParent(handle);
        }
      }
    } finally {
      closeRoot(rootHandle);
    }
  }

  function assertWritableFile(requestedPath) {
    const resolved = resolveRequest(requestedPath);
    let rootHandle;
    let handle;
    try {
      rootHandle = openRoot(requestedPath);
      const parent = prepareParent(resolved, rootHandle);
      handle = openParent(resolved, parent, rootHandle);
      destinationStat(
        resolved,
        path.join(handle.basePath, path.basename(resolved.relative)),
      );
      if (!handle.descriptorBacked) {
        verifyParentByName(resolved, parent, rootHandle);
      }
    } finally {
      if (handle) closeParent(handle);
      closeRoot(rootHandle);
    }
  }

  function writeFileAtomic(requestedPath, data, options) {
    const resolved = resolveRequest(requestedPath);
    let rootHandle;
    let handle;
    let parent;
    const basename = path.basename(resolved.relative);
    let targetPath;
    let tempPath;
    let tempFd;

    try {
      rootHandle = openRoot(requestedPath);
      parent = prepareParent(resolved, rootHandle);
      handle = openParent(resolved, parent, rootHandle);
      targetPath = path.join(handle.basePath, basename);
      const existing = destinationStat(resolved, targetPath);
      const mode = existing ? existing.mode & 0o777 : 0o666;
      const tempName = `.${basename}.${
        process.pid
      }.${crypto.randomUUID()}.temporary`;
      tempPath = path.join(handle.basePath, tempName);
      tempFd = fs.openSync(
        tempPath,
        openFlags(fs.constants.O_WRONLY, [
          fs.constants.O_CREAT,
          fs.constants.O_EXCL,
          fs.constants.O_NOFOLLOW,
        ]),
        mode,
      );
      if (!fs.fstatSync(tempFd).isFile()) {
        throw notRegularFile(requestedPath);
      }
      fs.writeFileSync(tempFd, data, options);
      fs.fsyncSync(tempFd);
      fs.closeSync(tempFd);
      tempFd = undefined;

      if (!handle.descriptorBacked) {
        verifyParentByName(resolved, parent, rootHandle);
      }
      destinationStat(resolved, targetPath);
      fs.renameSync(tempPath, targetPath);
      tempPath = undefined;

      const directoryFd = handle.fd !== undefined ? handle.fd : rootHandle.fd;
      if (directoryFd !== undefined) {
        try {
          fs.fsyncSync(directoryFd);
        } catch (error) {
          if (!['EBADF', 'EINVAL', 'ENOTSUP'].includes(error.code)) throw error;
        }
      }
    } finally {
      if (tempFd !== undefined) fs.closeSync(tempFd);
      if (tempPath !== undefined) {
        try {
          fs.unlinkSync(tempPath);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      if (handle) closeParent(handle);
      closeRoot(rootHandle);
    }
  }

  function transactionFiles(files) {
    if (!Array.isArray(files) || files.length === 0) {
      throw new TypeError('files must be a non-empty array');
    }

    const destinations = new Set();
    return files.map((file, index) => {
      if (file === null || typeof file !== 'object' || Array.isArray(file)) {
        throw new TypeError(`files[${index}] must be an object`);
      }

      const requestedPath = file.path;
      const data = file.data;
      const options = file.options;
      const resolved = resolveRequest(requestedPath);
      const destinationKey =
        process.platform === 'win32'
          ? resolved.relative.toLowerCase()
          : resolved.relative;
      if (destinations.has(destinationKey)) {
        throw new TypeError(
          `files[${index}].path resolves to a duplicate destination`,
        );
      }
      destinations.add(destinationKey);

      return {
        requestedPath,
        data,
        options,
        resolved,
        rootHandle: undefined,
        parent: undefined,
        handle: undefined,
        targetPath: undefined,
        existing: undefined,
        tempFd: undefined,
        tempPath: undefined,
        backupPath: undefined,
        backupStat: undefined,
        published: false,
        keepBackup: false,
      };
    });
  }

  function asWriteFailure(error, record) {
    if (error instanceof RootedFilesystemError) return error;
    return writeFailed(record.requestedPath, error);
  }

  function runTransactionOperation(record, operation) {
    try {
      return operation();
    } catch (error) {
      throw asWriteFailure(error, record);
    }
  }

  function changedDestination() {
    const error = new Error('Destination changed during file transaction');
    error.code = 'EBUSY';
    return error;
  }

  function prepareTransactionFile(record) {
    runTransactionOperation(record, () => {
      record.rootHandle = openRoot(record.requestedPath);
      record.parent = prepareParent(record.resolved, record.rootHandle);
      record.handle = openParent(
        record.resolved,
        record.parent,
        record.rootHandle,
      );
      record.targetPath = path.join(
        record.handle.basePath,
        path.basename(record.resolved.relative),
      );
      record.existing = destinationStat(record.resolved, record.targetPath);
      if (!record.handle.descriptorBacked) {
        verifyParentByName(record.resolved, record.parent, record.rootHandle);
      }
    });
  }

  function stageTransactionFile(record) {
    runTransactionOperation(record, () => {
      const basename = path.basename(record.resolved.relative);
      const tempName = `.${basename}.${
        process.pid
      }.${crypto.randomUUID()}.temporary`;
      const tempPath = path.join(record.handle.basePath, tempName);
      const mode = record.existing ? record.existing.mode & 0o777 : 0o666;
      const tempFd = fs.openSync(
        tempPath,
        openFlags(fs.constants.O_WRONLY, [
          fs.constants.O_CREAT,
          fs.constants.O_EXCL,
          fs.constants.O_NOFOLLOW,
        ]),
        mode,
      );
      record.tempPath = tempPath;
      record.tempFd = tempFd;
      if (!fs.fstatSync(tempFd).isFile()) {
        throw notRegularFile(record.requestedPath);
      }
      fs.writeFileSync(tempFd, record.data, record.options);
      fs.fsyncSync(tempFd);
      fs.closeSync(tempFd);
      record.tempFd = undefined;
      record.data = undefined;

      if (!record.handle.descriptorBacked) {
        verifyParentByName(record.resolved, record.parent, record.rootHandle);
      }
    });
  }

  function verifyTransactionDestination(record) {
    runTransactionOperation(record, () => {
      if (!record.handle.descriptorBacked) {
        verifyParentByName(record.resolved, record.parent, record.rootHandle);
      }
      const current = destinationStat(record.resolved, record.targetPath);
      if (record.existing === null) {
        if (current !== null) throw changedDestination();
        return;
      }
      if (current === null || !sameIdentity(current, record.existing)) {
        throw changedDestination();
      }
    });
  }

  function backupTransactionFile(record) {
    verifyTransactionDestination(record);
    if (record.existing === null) return;

    runTransactionOperation(record, () => {
      const basename = path.basename(record.resolved.relative);
      const backupName = `.${basename}.${
        process.pid
      }.${crypto.randomUUID()}.rollback`;
      const backupPath = path.join(record.handle.basePath, backupName);
      fs.linkSync(record.targetPath, backupPath);
      record.backupPath = backupPath;
      record.backupStat = fs.lstatSync(backupPath);
      if (
        !record.backupStat.isFile() ||
        !sameIdentity(record.existing, record.backupStat)
      ) {
        throw changedDestination();
      }
    });
  }

  function publishTransactionFile(record) {
    verifyTransactionDestination(record);
    runTransactionOperation(record, () => {
      fs.renameSync(record.tempPath, record.targetPath);
      record.tempPath = undefined;
      record.published = true;
    });
  }

  function syncTransactionDirectories(records) {
    const synced = new Set();
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      if (!record.handle || !record.rootHandle || !record.parent) continue;
      const directoryFd =
        record.handle.fd !== undefined
          ? record.handle.fd
          : record.rootHandle.fd;
      if (directoryFd === undefined) continue;

      const key = `${record.parent.expectedStat.dev}:${record.parent.expectedStat.ino}`;
      if (synced.has(key)) continue;
      synced.add(key);
      runTransactionOperation(record, () => {
        try {
          fs.fsyncSync(directoryFd);
        } catch (error) {
          if (!['EBADF', 'EINVAL', 'ENOTSUP'].includes(error.code)) throw error;
        }
      });
    }
  }

  function mergeTransactionFailures(primary, secondary) {
    if (!secondary) return primary;
    if (!primary) return secondary;
    const requestedPath = primary.path || secondary.path;
    return writeFailed(
      requestedPath,
      new AggregateError(
        [primary, secondary],
        'File transaction and recovery both failed',
      ),
      `File transaction failed and recovery was incomplete at: ${requestedPath}`,
    );
  }

  function rollbackTransaction(records) {
    let failure;
    for (let i = records.length - 1; i >= 0; i--) {
      const record = records[i];
      if (!record.published) continue;

      try {
        runTransactionOperation(record, () => {
          if (record.existing !== null) {
            if (!record.backupPath) throw changedDestination();
            fs.renameSync(record.backupPath, record.targetPath);
            record.backupPath = undefined;
          } else {
            fs.unlinkSync(record.targetPath);
          }
          record.published = false;
        });
      } catch (error) {
        record.keepBackup = Boolean(record.backupPath);
        failure = mergeTransactionFailures(failure, error);
      }
    }
    return failure;
  }

  function cleanupTransactionArtifacts(records) {
    let failure;
    for (let i = 0; i < records.length; i++) {
      const record = records[i];

      if (record.tempFd !== undefined) {
        try {
          fs.closeSync(record.tempFd);
          record.tempFd = undefined;
        } catch (error) {
          failure = mergeTransactionFailures(
            failure,
            asWriteFailure(error, record),
          );
        }
      }

      if (record.tempPath !== undefined) {
        try {
          fs.unlinkSync(record.tempPath);
          record.tempPath = undefined;
        } catch (error) {
          if (error.code !== 'ENOENT') {
            failure = mergeTransactionFailures(
              failure,
              asWriteFailure(error, record),
            );
          } else {
            record.tempPath = undefined;
          }
        }
      }

      if (record.backupPath !== undefined && !record.keepBackup) {
        try {
          fs.unlinkSync(record.backupPath);
          record.backupPath = undefined;
        } catch (error) {
          if (error.code !== 'ENOENT') {
            failure = mergeTransactionFailures(
              failure,
              asWriteFailure(error, record),
            );
          } else {
            record.backupPath = undefined;
          }
        }
      }
    }
    return failure;
  }

  function closeTransactionHandles(records) {
    let failure;
    for (let i = records.length - 1; i >= 0; i--) {
      const record = records[i];
      if (record.handle) {
        try {
          closeParent(record.handle);
        } catch (error) {
          failure = mergeTransactionFailures(
            failure,
            asWriteFailure(error, record),
          );
        }
        record.handle = undefined;
      }
      if (record.rootHandle) {
        try {
          closeRoot(record.rootHandle);
        } catch (error) {
          failure = mergeTransactionFailures(
            failure,
            asWriteFailure(error, record),
          );
        }
        record.rootHandle = undefined;
      }
    }
    return failure;
  }

  function writeFilesTransaction(files) {
    const records = transactionFiles(files);
    let publicationComplete = false;
    let failure;

    try {
      for (let i = 0; i < records.length; i++) {
        prepareTransactionFile(records[i]);
      }
      for (let i = 0; i < records.length; i++) {
        stageTransactionFile(records[i]);
      }
      for (let i = 0; i < records.length; i++) {
        backupTransactionFile(records[i]);
      }
      for (let i = 0; i < records.length; i++) {
        publishTransactionFile(records[i]);
      }

      // Keep rollback links until every rename is durable. Once this sync
      // succeeds, the complete new set is the committed state.
      syncTransactionDirectories(records);
      publicationComplete = true;

      const cleanupFailure = cleanupTransactionArtifacts(records);
      if (cleanupFailure) throw cleanupFailure;
      syncTransactionDirectories(records);
    } catch (error) {
      failure = error;
    }

    if (failure && !publicationComplete) {
      failure = mergeTransactionFailures(failure, rollbackTransaction(records));
    }
    failure = mergeTransactionFailures(
      failure,
      cleanupTransactionArtifacts(records),
    );
    if (failure && !publicationComplete) {
      try {
        syncTransactionDirectories(records);
      } catch (error) {
        failure = mergeTransactionFailures(failure, error);
      }
    }
    failure = mergeTransactionFailures(
      failure,
      closeTransactionHandles(records),
    );

    if (failure) throw failure;
  }

  return Object.freeze({
    root: realRoot,
    readFile,
    ensureDirectory,
    assertWritableFile,
    writeFileAtomic,
    writeFilesTransaction,
  });
};

module.exports.ERROR_CODES = ERROR_CODES;
module.exports.RootedFilesystemError = RootedFilesystemError;
