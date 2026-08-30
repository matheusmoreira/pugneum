var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');
var {describe, test} = require('node:test');
var lex = require('pugneum-lexer');
var parse = require('pugneum-parser');
var load = require('pugneum-loader');
var walk = require('pugneum-walker');
var link = require('../');

// Project root for these tests = the test/ dir, which contains both cases/ and
// fixtures/. Cases reach fixtures via `extends ../fixtures/...`; default-deny
// containment allows that as long as it stays within this root.
var basedir = __dirname;

function linkFile(filename) {
  let source = fs.readFileSync(filename, 'utf8');
  let options = {filename, source, lex, parse, basedir};
  let tokens = lex(source, options);
  let ast = parse(tokens, options);
  let loaded = load(ast, options);
  let linked = link(loaded);
  return JSON.parse(
    JSON.stringify(linked, function (key, value) {
      if (
        (key === 'filename' || key === 'fullPath') &&
        typeof value === 'string'
      ) {
        return path.basename(value);
      }
      return value;
    }),
  );
}

function testDir(dir) {
  fs.readdirSync(dir).forEach(function (name) {
    if (!/\.pg$/.test(name)) return;
    test(name, function (t) {
      t.assert.snapshot(linkFile(dir + '/' + name));
    });
  });
}

describe('cases from pugneum sources', function () {
  testDir(__dirname + '/cases');
});

describe('duplicate reference definitions', () => {
  test('throws DUPLICATE_REFERENCE error', (t) => {
    var source = [
      'references',
      '  ex https://first.com',
      '  ex https://second.com',
      '',
      'p @[ex]',
    ].join('\n');
    var options = {filename: 'test.pg', source, lex, parse, basedir};
    var tokens = lex(source, options);
    var ast = parse(tokens, options);
    var loaded = load(ast, options);

    assert.throws(
      () => link(loaded),
      (err) => {
        assert.strictEqual(err.code, 'PUGNEUM:DUPLICATE_REFERENCE');
        assert.match(err.message, /Duplicate reference 'ex'/);
        return true;
      },
    );
  });
});

describe('RawInclude with filters', () => {
  test('RawInclude with filters is preserved for the filterer', () => {
    var dir = __dirname + '/cases';
    var source = 'include:markdown-it some.md';
    var options = {
      filename: dir + '/test.pg',
      source,
      lex,
      parse,
      basedir: dir,
    };
    var tokens = lex(source, options);
    var ast = parse(tokens, options);
    var loaded = load(ast, options);
    var linked = link(loaded);

    // The linker must NOT replace RawInclude nodes that have filters.
    // Those are left for the filterer to process.
    var rawInclude = linked.nodes[0];
    assert.strictEqual(rawInclude.type, 'RawInclude');
    assert.ok(rawInclude.filters.length > 0);
    assert.strictEqual(rawInclude.filters[0].name, 'markdown-it');
  });

  test('RawInclude without filters is replaced with Text', () => {
    var dir = __dirname + '/cases';
    var source = 'include some.md';
    var options = {
      filename: dir + '/test.pg',
      source,
      lex,
      parse,
      basedir: dir,
    };
    var tokens = lex(source, options);
    var ast = parse(tokens, options);
    var loaded = load(ast, options);
    var linked = link(loaded);

    // Without filters, the linker replaces RawInclude with a Text node
    var textNode = linked.nodes[0];
    assert.strictEqual(textNode.type, 'Text');
  });
});

describe('error handling', () => {
  test('top level must be a Block', () => {
    assert.throws(() => link({type: 'Tag', name: 'div'}), /top level.*block/i);
  });

  test('UNDEFINED_REFERENCE for unknown @[ref]', () => {
    var source = 'p @[missing]';
    var options = {filename: 'test.pg', source, lex, parse, basedir};
    var tokens = lex(source, options);
    var ast = parse(tokens, options);
    var loaded = load(ast, options);
    assert.throws(
      () => link(loaded),
      (err) => err.code === 'PUGNEUM:UNDEFINED_REFERENCE',
    );
  });

  test('MISSING_YIELD when include passes block but template has no yield', () => {
    var dir = __dirname + '/cases';
    var includer = 'include auxiliary/pet.pg\n  p Extra content';
    var options = {
      filename: dir + '/test.pg',
      source: includer,
      lex,
      parse,
      basedir: dir,
    };
    var tokens = lex(includer, options);
    var ast = parse(tokens, options);
    var loaded = load(ast, options);
    assert.throws(
      () => link(loaded),
      (err) => err.code === 'PUGNEUM:MISSING_YIELD',
    );
  });

  test('EXTENDS_NOT_FIRST when extends is not the first statement', () => {
    var dir = __dirname + '/cases';
    var source = 'p hello\nextends auxiliary/layout.pg';
    var options = {
      filename: dir + '/test.pg',
      source,
      lex,
      parse,
      basedir: dir,
    };
    var tokens = lex(source, options);
    var ast = parse(tokens, options);
    var loaded = load(ast, options);
    assert.throws(
      () => link(loaded),
      (err) => err.code === 'PUGNEUM:EXTENDS_NOT_FIRST',
    );
  });

  test('UNEXPECTED_BLOCK for block not defined in parent', () => {
    var dir = __dirname + '/cases';
    var source = 'extends auxiliary/layout.pg\nblock nonexistent\n  p hello';
    var options = {
      filename: dir + '/test.pg',
      source,
      lex,
      parse,
      basedir: dir,
    };
    var tokens = lex(source, options);
    var ast = parse(tokens, options);
    var loaded = load(ast, options);
    assert.throws(
      () => link(loaded),
      (err) => err.code === 'PUGNEUM:UNEXPECTED_BLOCK',
    );
  });

  test('LINK_DEPTH_EXCEEDED when inheritance chain exceeds limit', () => {
    var dir = __dirname + '/cases';
    var source = 'extends auxiliary/layout.pg\nblock content\n  p hello';
    var options = {
      filename: dir + '/test.pg',
      source,
      lex,
      parse,
      basedir: dir,
      maxLinkDepth: 1,
    };
    var tokens = lex(source, options);
    var ast = parse(tokens, options);
    var loaded = load(ast, options);
    assert.throws(
      () => link(loaded, options),
      (err) => err.code === 'PUGNEUM:LINK_DEPTH_EXCEEDED',
    );
  });

  test('UNEXPECTED_NODES_IN_EXTENDING_ROOT for non-block content in extending template', () => {
    var dir = __dirname + '/cases';
    var source = 'extends auxiliary/layout.pg\np this is not allowed';
    var options = {
      filename: dir + '/test.pg',
      source,
      lex,
      parse,
      basedir: dir,
    };
    var tokens = lex(source, options);
    var ast = parse(tokens, options);
    var loaded = load(ast, options);
    assert.throws(
      () => link(loaded),
      (err) => err.code === 'PUGNEUM:UNEXPECTED_NODES_IN_EXTENDING_ROOT',
    );
  });

  test('error in included file shows correct source context', () => {
    var mainPath = path.join(
      __dirname,
      'fixtures',
      'multi-file-error',
      'main.pg',
    );
    var mainSource = fs.readFileSync(mainPath, 'utf8');
    var childPath = path.join(
      __dirname,
      'fixtures',
      'multi-file-error',
      'child.pg',
    );
    var childSource = fs.readFileSync(childPath, 'utf8');

    var options = {filename: mainPath, source: mainSource, lex, parse};
    var tokens = lex(mainSource, options);
    var ast = parse(tokens, options);
    var loaded = load(ast, options);

    assert.throws(
      () => link(loaded, options),
      (err) => {
        assert.strictEqual(err.code, 'PUGNEUM:UNDEFINED_REFERENCE');
        assert.ok(
          err.message.includes('> 1|'),
          'Error should include source context line marker, got: ' +
            err.message,
        );
        assert.ok(
          err.message.includes('@[nonexistent link text]'),
          'Error context should show child file source line, got: ' +
            err.message,
        );
        assert.ok(
          !err.message.includes('include child'),
          'Error context should NOT show main file content, got: ' +
            err.message,
        );
        assert.strictEqual(err.source, childSource);
        return true;
      },
    );
  });
});

describe('warnings', () => {
  function warningsFor(source, extra) {
    const warnings = [];
    const options = Object.assign(
      {filename: 't.pg', source, lex, parse, basedir, warnings},
      extra,
    );
    const tokens = lex(source, options);
    const ast = parse(tokens, options);
    const loaded = load(ast, options);
    link(loaded, options);
    return warnings;
  }

  function codes(warnings, code) {
    return warnings.filter((w) => w.code === 'PUGNEUM:' + code);
  }

  describe('duplicate id', () => {
    test('two elements with the same id warn once', () => {
      const w = warningsFor('p#dup a\np#dup b');
      assert.strictEqual(codes(w, 'DUPLICATE_ID').length, 1);
    });

    test('id from #shorthand collides with id= attribute', () => {
      const w = warningsFor('p#x a\np(id="x") b');
      assert.strictEqual(codes(w, 'DUPLICATE_ID').length, 1);
    });

    test('unique ids do not warn', () => {
      const w = warningsFor('p#a x\np#b y\np(id="c") z');
      assert.strictEqual(codes(w, 'DUPLICATE_ID').length, 0);
    });

    test('the warning points at the duplicate occurrence', () => {
      const w = codes(warningsFor('p#dup a\np#dup b'), 'DUPLICATE_ID');
      assert.strictEqual(w[0].line, 2);
    });
  });

  describe('unused references and footnotes', () => {
    test('a reference defined but never used warns', () => {
      const w = warningsFor('references\n  foo https://x.com\n\np hello');
      assert.strictEqual(codes(w, 'UNUSED_REFERENCE').length, 1);
    });

    test('a reference used as a link does not warn', () => {
      const w = warningsFor('references\n  foo https://x.com\n\np @[foo]');
      assert.strictEqual(codes(w, 'UNUSED_REFERENCE').length, 0);
    });

    test('a reference used as an image does not warn', () => {
      const w = warningsFor('references\n  foo /img.png\n\np ![foo alt]');
      assert.strictEqual(codes(w, 'UNUSED_REFERENCE').length, 0);
    });

    test('a footnote defined but never used warns', () => {
      const w = warningsFor('p hello\n\nfootnotes\n  note Some text');
      assert.strictEqual(codes(w, 'UNUSED_FOOTNOTE').length, 1);
    });

    test('a referenced footnote does not warn', () => {
      const w = warningsFor('p text^[note]\n\nfootnotes\n  note Some text');
      assert.strictEqual(codes(w, 'UNUSED_FOOTNOTE').length, 0);
    });
  });

  describe('empty toc', () => {
    test('a toc with no id-bearing headings warns', () => {
      const w = warningsFor('toc\nh2 No id here\np text');
      assert.strictEqual(codes(w, 'EMPTY_TOC').length, 1);
    });

    test('a toc with id-bearing headings does not warn', () => {
      const w = warningsFor('toc\nh2#a One\nh2#b Two');
      assert.strictEqual(codes(w, 'EMPTY_TOC').length, 0);
    });

    test('no toc keyword means no warning even without ids', () => {
      const w = warningsFor('h2 No id\np text');
      assert.strictEqual(codes(w, 'EMPTY_TOC').length, 0);
    });
  });

  describe('img without alt', () => {
    test('an img with no alt attribute warns', () => {
      const w = warningsFor('img(src=/x.png)');
      assert.strictEqual(codes(w, 'IMG_WITHOUT_ALT').length, 1);
    });

    test('an img with alt text does not warn', () => {
      const w = warningsFor('img(src=/x.png alt="a cat")');
      assert.strictEqual(codes(w, 'IMG_WITHOUT_ALT').length, 0);
    });

    test('an img with empty alt (decorative) does not warn', () => {
      const w = warningsFor('img(src=/x.png alt="")');
      assert.strictEqual(codes(w, 'IMG_WITHOUT_ALT').length, 0);
    });

    test('a reference image (which always emits alt) does not warn', () => {
      const w = warningsFor('references\n  pic /x.png\n\np ![pic a cat]');
      assert.strictEqual(codes(w, 'IMG_WITHOUT_ALT').length, 0);
    });
  });

  describe('document lints run once across includes', () => {
    test('img-without-alt is counted once per occurrence, not multiplied by include depth', () => {
      const dir = __dirname + '/fixtures';
      const source = 'div\n  include /img-no-alt.pg\n  img(src=/main.png)';
      const warnings = [];
      const options = {
        filename: dir + '/main.pg',
        source,
        lex,
        parse,
        basedir: dir,
        warnings,
      };
      const loaded = load(parse(lex(source, options), options), options);
      link(loaded, options);
      // One img in the included file + one in the main file = exactly two.
      assert.strictEqual(codes(warnings, 'IMG_WITHOUT_ALT').length, 2);
    });
  });
});

// Link a project laid out as {filename: source} in a fresh temp directory so
// the loader's basedir is the temp root (relative includes/extends stay inside
// it). Returns the linked AST; the caller passes the entry filename.
function linkProject(files, entry) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pugneum-linker-'));
  try {
    Object.keys(files).forEach(function (name) {
      var full = path.join(dir, name);
      fs.mkdirSync(path.dirname(full), {recursive: true});
      fs.writeFileSync(full, files[name]);
    });
    var filename = path.join(dir, entry);
    var source = fs.readFileSync(filename, 'utf8');
    var warnings = [];
    var options = {filename, source, lex, parse, basedir: dir, warnings};
    var loaded = load(parse(lex(source, options), options), options);
    var linked = link(loaded, options);
    return {linked: linked, warnings: warnings};
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

function collectNamedBlocks(ast) {
  var blocks = [];
  walk(ast, function (node) {
    if (node.type === 'NamedBlock') blocks.push(node);
  });
  return blocks;
}

function inheritanceProject(depth) {
  var files = {};
  files['level0.pg'] = 'html\n  body\n    block content\n      p default\n';
  for (var i = 1; i <= depth; i++) {
    files['level' + i + '.pg'] =
      'extends level' + (i - 1) + '.pg\nblock content\n  p override' + i + '\n';
  }
  return {files: files, entry: 'level' + depth + '.pg'};
}

describe('flattenParentBlocks deduplication (exponential blowup guard)', () => {
  test('a deep extends chain overriding a shared replace-mode block links in linear time', () => {
    // Without deduping visited blocks in flattenParentBlocks this fan-out DAG
    // pushes shared block objects exponentially and crashes with
    // "RangeError: Invalid array length" around depth ~18.
    var depth = 60;
    var project = inheritanceProject(depth);
    var result = linkProject(project.files, project.entry);
    // The last override wins (replace mode) and exactly one content block remains.
    var contentText = [];
    walk(result.linked, function (node) {
      if (node.type === 'Text') contentText.push(node.val);
    });
    assert.ok(
      contentText.includes('override' + depth),
      'final override should win, got: ' + JSON.stringify(contentText),
    );
  });

  test('the public linked tree serializes without inheritance ancestry growth', () => {
    var shallowProject = inheritanceProject(5);
    var deepProject = inheritanceProject(9);
    var shallow = linkProject(
      shallowProject.files,
      shallowProject.entry,
    ).linked;
    var deep = linkProject(deepProject.files, deepProject.entry).linked;
    var shallowJson = JSON.stringify(shallow);
    var deepJson = JSON.stringify(deep);

    assert.ok(
      deepJson.length < shallowJson.length * 3,
      'serialization must stay linear: ' +
        shallowJson.length +
        ' bytes grew to ' +
        deepJson.length,
    );
    assert.doesNotMatch(deepJson, /"(?:declaredBlocks|parents)"/);
  });
});

describe('extend() prunes a same-name nested block instead of descending', () => {
  test('a triple-nested same-name block leaves only the immediate child ignored', () => {
    // The guard marks an inner same-name NamedBlock with `ignore` and must
    // prune its subtree; otherwise the walker descends and marks every deeper
    // same-name block too. With the prune, only the immediate child is marked.
    var files = {
      'layout.pg': 'html\n  body\n    block content\n      p default\n',
      'page.pg':
        'extends layout.pg\nblock content\n  block content\n    block content\n      p deep\n',
    };
    var result = linkProject(files, 'page.pg');
    var named = collectNamedBlocks(result.linked);
    var ignored = named.filter(function (n) {
      return n.ignore;
    });
    assert.strictEqual(named.length, 3);
    assert.strictEqual(
      ignored.length,
      1,
      'only the immediate same-name child should be ignored (subtree pruned)',
    );
  });
});

describe('applyYield clones the passed block per yield site', () => {
  test('two yields receive independent block objects (no shared mutable subtree)', () => {
    var files = {
      'twoyield.pg': 'div.a\n  yield\ndiv.b\n  yield\n',
      'main.pg': 'include twoyield.pg\n  p shared\n',
    };
    var result = linkProject(files, 'main.pg');
    // Each yield rewrites in place to a Block whose single child is the passed
    // block. The rewritten YieldBlock wrappers are always distinct AST nodes;
    // the aliasing hazard is the SHARED passed block underneath, so assert on
    // that inner node (div > Block(former yield) > Block(passed content)).
    var passedBlocks = [];
    walk(result.linked, function (node) {
      if (
        node.type === 'Tag' &&
        node.name === 'div' &&
        node.block &&
        node.block.nodes.length === 1 &&
        node.block.nodes[0].type === 'Block' &&
        node.block.nodes[0].nodes.length === 1 &&
        node.block.nodes[0].nodes[0].type === 'Block'
      ) {
        passedBlocks.push(node.block.nodes[0].nodes[0]);
      }
    });
    assert.strictEqual(passedBlocks.length, 2);
    assert.notStrictEqual(
      passedBlocks[0],
      passedBlocks[1],
      'each yield site must get its own copy of the passed block, not a shared alias',
    );
  });

  test('a footnote ref in doubly-yielded content gets distinct anchor ids and two backlinks', () => {
    var files = {
      'twoyield.pg': 'div.a\n  yield\ndiv.b\n  yield\n',
      'main.pg':
        'include twoyield.pg\n  p note^[x]\n\nfootnotes\n  x the note\n',
    };
    var result = linkProject(files, 'main.pg');
    // Two noteref anchors with DISTINCT ids, and the footnote <li> has two backlinks.
    var refIds = [];
    var backlinkHrefs = [];
    walk(result.linked, function (node) {
      if (node.type === 'Tag' && node.attrs) {
        var role = node.attrs.find(function (a) {
          return a.name === 'role';
        });
        var id = node.attrs.find(function (a) {
          return a.name === 'id' && typeof a.val === 'string';
        });
        var href = node.attrs.find(function (a) {
          return a.name === 'href';
        });
        if (role && role.val === 'doc-noteref' && id) refIds.push(id.val);
        if (role && role.val === 'doc-backlink' && href)
          backlinkHrefs.push(href.val);
      }
    });
    assert.strictEqual(refIds.length, 2);
    assert.notStrictEqual(
      refIds[0],
      refIds[1],
      'the two references must get distinct ids, not a collision',
    );
    assert.strictEqual(
      backlinkHrefs.length,
      2,
      'the footnote list item must carry one backlink per reference',
    );
    // No DUPLICATE_ID warning from the (previously aliased) ref anchors.
    var dup = result.warnings.filter(function (w) {
      return w.code === 'PUGNEUM:DUPLICATE_ID';
    });
    assert.strictEqual(dup.length, 0);
  });

  test('raw include bytes remain independent Buffers at every yield site', () => {
    var payload = Buffer.from([0x00, 0x26, 0x3c, 0xff]);
    var files = {
      'twoyield.pg': 'div.a\n  yield\ndiv.b\n  yield\n',
      'main.pg': 'include twoyield.pg\n  include:binary payload.bin\n',
      'payload.bin': payload,
    };
    var result = linkProject(files, 'main.pg');
    var rawCopies = [];
    walk(result.linked, function (node) {
      if (node.type === 'RawInclude') rawCopies.push(node.file.raw);
    });

    assert.strictEqual(rawCopies.length, 2);
    for (const raw of rawCopies) {
      assert.ok(Buffer.isBuffer(raw), 'yield clone preserves Buffer bytes');
      assert.deepStrictEqual(raw, payload);
    }
    assert.notStrictEqual(rawCopies[0], rawCopies[1]);
    rawCopies[0][0] = 0xaa;
    assert.strictEqual(rawCopies[1][0], payload[0]);
  });
});

describe('footnote error paths', () => {
  function linkSource(source) {
    var options = {filename: 'fn.pg', source, lex, parse, basedir};
    var loaded = load(parse(lex(source, options), options), options);
    return link(loaded, options);
  }

  test('UNDEFINED_FOOTNOTE for a ref with no matching definition', () => {
    assert.throws(
      () => linkSource('p text^[missing]\n\nfootnotes\n  other note'),
      (err) => err.code === 'PUGNEUM:UNDEFINED_FOOTNOTE',
    );
  });

  test('DUPLICATE_FOOTNOTE for two definitions with the same name', () => {
    assert.throws(
      () => linkSource('p a^[x]\n\nfootnotes\n  x one\n  x two'),
      (err) => err.code === 'PUGNEUM:DUPLICATE_FOOTNOTE',
    );
  });

  test('DUPLICATE_FOOTNOTES_BLOCK for two footnotes blocks', () => {
    assert.throws(
      () => linkSource('footnotes\n  a one\n\nfootnotes\n  b two'),
      (err) => err.code === 'PUGNEUM:DUPLICATE_FOOTNOTES_BLOCK',
    );
  });

  test('INVALID_FOOTNOTE_NAME for a name with illegal characters', () => {
    assert.throws(
      () => linkSource('p a^[x]\n\nfootnotes\n  a.b bad name'),
      (err) => err.code === 'PUGNEUM:INVALID_FOOTNOTE_NAME',
    );
  });
});

describe('footnote transitive fixpoint and multi-reference rendering', () => {
  // The resolveFootnotes pass-2 while-loop (the file's most algorithmically risky
  // code) and the toSuperscript / footnoteRefId(-N) scheme had no direct structural
  // assertions. These pin the observed (correct) behavior so a regression in the
  // fixpoint reachability, the backlink superscript labels, or the ref-id suffixing
  // is caught here rather than only via a downstream HTML snapshot.
  function linkSource(source) {
    const warnings = [];
    const options = {filename: 'fn.pg', source, lex, parse, basedir, warnings};
    const loaded = load(parse(lex(source, options), options), options);
    const linked = link(loaded, options);
    return {linked, warnings};
  }

  function footnoteListItemIds(ast) {
    const ids = [];
    walk(ast, function (node) {
      if (node.type === 'Tag' && node.name === 'li' && node.attrs) {
        const id = node.attrs.find((a) => a.name === 'id');
        if (id) ids.push(id.val);
      }
    });
    return ids;
  }

  function unusedFootnotes(warnings) {
    return warnings.filter((w) => w.code === 'PUGNEUM:UNUSED_FOOTNOTE');
  }

  test('a footnote reachable only through a CHAIN of footnotes is numbered and rendered (fixpoint)', () => {
    // Body refs `a`; a refs b; b refs c; c refs d — so b, c and d are reachable
    // ONLY transitively, each a further iteration deep. The fixpoint while-loop
    // must RE-ITERATE until d is numbered: a single pass would discover only b
    // (the keys added mid-iteration are not re-enumerated) and silently drop c
    // and d. All four render in def order and NONE warns UNUSED_FOOTNOTE — a
    // one-level a->b chain (the prior fixture) passes even single-pass, so it
    // could not pin this; the depth-3 chain does.
    const {linked, warnings} = linkSource(
      'p Body text^[a]\n\nfootnotes\n  a See^[b]\n  b also^[c]\n  c deeper^[d]\n  d The deep note',
    );
    assert.deepStrictEqual(footnoteListItemIds(linked), [
      'footnote-a',
      'footnote-b',
      'footnote-c',
      'footnote-d',
    ]);
    assert.strictEqual(unusedFootnotes(warnings).length, 0);
  });

  test('a footnote reachable only through an UNREACHED footnote is dropped and warns', () => {
    // a is referenced (plain); b is never referenced and only b refs c. Because b is
    // never reached, the fixpoint never descends into b, so c stays unreached too:
    // only `a` renders, and BOTH b and c warn UNUSED_FOOTNOTE.
    const {linked, warnings} = linkSource(
      'p a^[a]\n\nfootnotes\n  a plain\n  b refs^[c]\n  c deep',
    );
    assert.deepStrictEqual(footnoteListItemIds(linked), ['footnote-a']);
    const unusedNames = unusedFootnotes(warnings)
      .map((w) => /Footnote '([^']+)'/.exec(w.message)[1])
      .sort();
    assert.deepStrictEqual(unusedNames, ['b', 'c']);
  });

  test('one footnote referenced three times: distinct -N ref ids and ↩/↩²/↩³ backlinks', () => {
    const {linked} = linkSource(
      'p a^[n] b^[n] c^[n]\n\nfootnotes\n  n the note',
    );

    const refIds = [];
    const backlinkLabels = [];
    walk(linked, function (node) {
      if (node.type !== 'Tag' || !node.attrs) return;
      const role = node.attrs.find((a) => a.name === 'role');
      if (!role) return;
      if (role.val === 'doc-noteref') {
        const id = node.attrs.find(
          (a) => a.name === 'id' && typeof a.val === 'string',
        );
        if (id) refIds.push(id.val);
      }
      if (role.val === 'doc-backlink' && node.block) {
        const text = node.block.nodes[0];
        if (text && text.type === 'Text') backlinkLabels.push(text.val);
      }
    });

    // Forward-ref anchor ids: first is unsuffixed, the rest carry the 1-based index.
    assert.deepStrictEqual(refIds, [
      'footnote-reference-n',
      'footnote-reference-n-2',
      'footnote-reference-n-3',
    ]);
    // One backlink per reference, the 2nd/3rd superscripted.
    assert.deepStrictEqual(backlinkLabels, ['↩', '↩²', '↩³']);
  });
});

describe('toc id-value handling', () => {
  function warningsFor(source) {
    const warnings = [];
    const options = {filename: 't.pg', source, lex, parse, basedir, warnings};
    const loaded = load(parse(lex(source, options), options), options);
    link(loaded, options);
    return warnings;
  }

  test('a heading with a valueless (boolean) id is not used as a toc entry', () => {
    // A valueless id (val === true) must not produce href="#true"; matching
    // lintDocument's string-id contract, resolveToc skips it. With only such a
    // heading present, the toc has no usable entries and warns EMPTY_TOC.
    const w = warningsFor('toc\nh2(id) No usable id\np text');
    assert.strictEqual(
      w.filter((x) => x.code === 'PUGNEUM:EMPTY_TOC').length,
      1,
    );
  });
});

describe('warnings option robustness', () => {
  test('a non-array warnings option does not throw', () => {
    var source = 'img(src=/x.png)';
    var options = {
      filename: 't.pg',
      source,
      lex,
      parse,
      basedir,
      warnings: 'oops',
    };
    var loaded = load(parse(lex(source, options), options), options);
    assert.doesNotThrow(() => link(loaded, options));
  });

  test('warnings are reachable when the caller omits the option', () => {
    // link() establishes options.warnings so a bare caller can read diagnostics
    // back rather than having them computed into a discarded throwaway array.
    var source = 'references\n  foo https://x.com\n\np#dup a\np#dup b';
    var options = {filename: 't.pg', source, lex, parse, basedir};
    var loaded = load(parse(lex(source, options), options), options);
    link(loaded, options);
    assert.ok(Array.isArray(options.warnings));
    assert.ok(
      options.warnings.some((w) => w.code === 'PUGNEUM:UNUSED_REFERENCE'),
    );
    assert.ok(options.warnings.some((w) => w.code === 'PUGNEUM:DUPLICATE_ID'));
  });
});
