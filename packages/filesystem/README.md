# pugneum-filesystem

Rooted regular-file reads and atomic publication for Pugneum packages.

```js
const rootedFilesystem = require('pugneum-filesystem');

const files = rootedFilesystem('site');
const index = files.readFile('index.html', 'utf8');
files.ensureDirectory('feeds/archive');
files.writeFileAtomic('atom.xml', xml, 'utf8');
files.writeFilesTransaction([
  {path: 'atom.xml', data: atomXml, options: 'utf8'},
  {path: 'rss.xml', data: rssXml, options: 'utf8'},
]);
```

The returned frozen object exposes:

- `root`, the canonical configured root for diagnostics only;
- `readFile(relative, options)`, which returns the same values as
  `fs.readFileSync`;
- `ensureDirectory(relative)`, which creates checked descendant directories;
- `assertWritableFile(relative)`, which validates a destination without
  publishing; and
- `writeFileAtomic(relative, data, options)`, which publishes one regular file;
  and
- `writeFilesTransaction(files)`, which stages and publishes a set of distinct
  regular files with rollback on failure.

The module also exports `ERROR_CODES` and `RootedFilesystemError`. Callers
should route failures by the stable codes `PATH_ESCAPE`, `NOT_REGULAR_FILE`,
`NOT_DIRECTORY`, and `WRITE_FAILED`; error-message text and the canonical
`root` string are not containment APIs. Transaction write/commit failures use
`WRITE_FAILED` and expose the affected requested path as `error.path`.

The configured root is a trusted boundary and may itself be a symlink. Its
canonical identity is recorded and verified for every operation. Requested
paths are relative names and must be strict descendants of that root; absolute
paths are rejected even when they spell an in-root file. Reads and writes
reject lexical escapes, symlink components, and non-regular leaf entries. The
read and write operations do not create missing parent directories
automatically.

`readFile` records the expected file identity, opens with `O_NOFOLLOW` and
`O_NONBLOCK` where available, verifies the opened descriptor with `fstat`, and
reads from that descriptor. Nonblocking open prevents a regular file swapped
to a FIFO from hanging before the descriptor type check. On systems exposing
descriptors through `/proc/self/fd` or `/dev/fd`, the opened object's canonical
location must still be inside the root. `ensureDirectory` creates descendant
directories one component at a time through the same checked parent boundary.

`writeFileAtomic` opens an exclusive temporary regular file in the destination
directory, writes and syncs it, atomically renames it over the final name, and
syncs the containing directory where the platform permits directory handles.
Existing symlinks and non-regular destinations are rejected. Replacing an
existing hard-linked file changes only the destination name; it does not
truncate the other link's inode. `assertWritableFile` performs the same static
destination checks without publishing.

`writeFilesTransaction` validates every distinct destination before creating a
temporary file, then writes and syncs all temporary siblings before changing a
final name. Existing destinations are preserved with private same-directory
rollback links. If a later final rename fails, already-published fresh files
are removed and prior files are restored before the error returns. Known
temporary and rollback names are cleaned up on both success and failure.

## Concurrency and platform boundary

Linux and other systems with a descriptor pathname namespace resolve temporary
and final names through a held parent-directory descriptor. This keeps
publication tied to the directory that was checked. Node does not expose a
portable `openat`/`renameat` API, and Windows does not expose a pathname for an
open directory handle through `node:fs`. On those platforms the fallback
rechecks canonical parent identity immediately before publication. It rejects
static links and ordinary replacements, but it cannot promise protection from
an attacker continuously swapping ancestor directories during the operation.
Callers needing that hostile-concurrent-mutation guarantee must isolate the
build root with operating-system permissions or a sandbox.

Each final rename is atomic. No portable filesystem primitive swaps multiple
independent names at the same instant, so a reader racing a successful
multi-file commit can observe the short transition between renames. The
transaction guarantee is that a failed call restores the prior complete set
(or removes every fresh destination); it never returns with a knowingly mixed
set. An unrecoverable rollback failure is reported as `WRITE_FAILED`, retains
any surviving rollback link for manual recovery, and names the affected path.

Regular hard links are allowed for reads because a filesystem inode has no
portable canonical "original pathname." The configured root and permission to
create entries inside it are therefore part of the trust boundary. Atomic
publication is safe for a hard-linked destination: renaming replaces only the
destination name and never truncates the inode referenced by its other names.

## License

MIT
