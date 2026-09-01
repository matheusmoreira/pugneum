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

describe('reference resolver-owned attributes', () => {
  for (const {source, type, name} of [
    {
      source: 'references\n  docs /canonical\n\np @[docs text]',
      type: 'ReferenceLink',
      name: 'HREF',
    },
    {
      source: 'references\n  pic /canonical.png\n\np ![pic image]',
      type: 'ReferenceImage',
      name: 'SRC',
    },
    {
      source: 'references\n  pic /canonical.png\n\np ![pic image]',
      type: 'ReferenceImage',
      name: 'Alt',
    },
  ]) {
    test(`direct ${type} AST rejects ${name} override`, () => {
      const options = {filename: 'reserved.pg', source, lex, parse, basedir};
      const loaded = load(parse(lex(source, options), options), options);
      let reference;
      walk(loaded, function (node) {
        if (node.type === type) reference = node;
      });
      reference.attrs.push({
        name,
        val: 'override',
        line: reference.line,
        column: reference.column,
        filename: reference.filename,
      });

      assert.throws(
        () => link(loaded, options),
        (err) =>
          err.code === 'PUGNEUM:DUPLICATE_ATTRIBUTE' &&
          err.filename === 'reserved.pg' &&
          err.line === reference.line &&
          err.msg ===
            'Duplicate attribute "' + name.toLowerCase() + '" is not allowed.',
      );
    });
  }
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

  ['first\nsecond\n', 'first\r\nsecond\r\n', 'first\rsecond\r'].forEach(
    (input) => {
      test('normalizes raw text line endings: ' + JSON.stringify(input), () => {
        const ast = {
          type: 'Block',
          nodes: [
            {
              type: 'RawInclude',
              filters: [],
              file: {type: 'FileReference', path: 'raw.txt', str: input},
              line: 3,
              column: 5,
              filename: 'source.pg',
            },
          ],
          line: 1,
          column: 1,
          filename: 'source.pg',
        };

        assert.deepStrictEqual(link(ast).nodes[0], {
          type: 'Text',
          val: 'first\nsecond\n',
          line: 3,
          column: 5,
          filename: 'source.pg',
        });
      });
    },
  );
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

  test('LINK_DEPTH_EXCEEDED at the inheritance edge when no edges are allowed', () => {
    var dir = __dirname + '/cases';
    var source = 'extends auxiliary/layout.pg\nblock content\n  p hello';
    var options = {
      filename: dir + '/test.pg',
      source,
      lex,
      parse,
      basedir: dir,
      maxLinkDepth: 0,
    };
    var tokens = lex(source, options);
    var ast = parse(tokens, options);
    var loaded = load(ast, options);
    assert.throws(
      () => link(loaded, options),
      (err) =>
        err.code === 'PUGNEUM:LINK_DEPTH_EXCEEDED' &&
        err.line === 1 &&
        err.column === 1,
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

describe('large flat collections', () => {
  const aboveHistoricalArgumentLimit = 130000;

  function linkReferenceWithLargeAttrs(source, referenceType, outputTag) {
    const options = {filename: 'large.pg', source, lex, parse, basedir};
    const loaded = load(parse(lex(source, options), options), options);
    let reference = null;
    walk(loaded, function (node) {
      if (node.type === referenceType) reference = node;
    });
    assert(reference);

    const attr = {
      name: 'data-large',
      val: 'value',
      line: reference.line,
      column: reference.column,
      filename: reference.filename,
    };
    reference.attrs = new Array(aboveHistoricalArgumentLimit).fill(attr);

    const linked = link(loaded, options);
    let output = null;
    walk(linked, function (node) {
      if (node.type === 'Tag' && node.name === outputTag) output = node;
    });
    assert(output);
    assert.deepStrictEqual(output.attrs.at(-1), attr);
    assert.notStrictEqual(output.attrs.at(-1), attr);
    return output.attrs.length;
  }

  test('reference links append attributes above the function-argument limit', () => {
    assert.strictEqual(
      linkReferenceWithLargeAttrs(
        'references\n  ref /target\n\np @[ref]',
        'ReferenceLink',
        'a',
      ),
      aboveHistoricalArgumentLimit + 1,
    );
  });

  test('reference images append attributes above the function-argument limit', () => {
    assert.strictEqual(
      linkReferenceWithLargeAttrs(
        'references\n  image /image.png\n\np ![image alt]',
        'ReferenceImage',
        'img',
      ),
      aboveHistoricalArgumentLimit + 2,
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

    test('id attribute identity is ASCII-case-insensitive', () => {
      const w = warningsFor('p(ID="dup") a\np(id="dup") b');
      assert.strictEqual(codes(w, 'DUPLICATE_ID').length, 1);
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

    test('mixed-case HTML headings populate the toc', () => {
      const w = warningsFor('toc\nH2#intro Introduction');
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

    test('mixed-case img and alt names use HTML identity', () => {
      const missing = warningsFor('IMG(src=/x.png)');
      const present = warningsFor('iMg(src=/x.png ALT="a cat")');
      assert.strictEqual(codes(missing, 'IMG_WITHOUT_ALT').length, 1);
      assert.strictEqual(codes(present, 'IMG_WITHOUT_ALT').length, 0);
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
function linkProject(files, entry, linker) {
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
    var linked = (linker || link)(loaded, options);
    return {linked: linked, warnings: warnings};
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

// Load an isolated linker instance whose captured walker records deterministic
// pass and node-visit counts. The package caches are restored synchronously, so
// the rest of this file continues using the ordinary linker and walker.
function instrumentLinkerWalks() {
  const walkerPath = require.resolve('pugneum-walker');
  const linkerPath = require.resolve('../');
  const walkerEntry = require.cache[walkerPath];
  const linkerEntry = require.cache[linkerPath];
  const originalWalk = walkerEntry.exports;
  const counts = {walks: 0, nodes: 0};

  function countedWalk(ast, before, after, options) {
    if (
      after &&
      typeof after === 'object' &&
      !Array.isArray(after) &&
      options === undefined
    ) {
      options = after;
      after = null;
    }
    counts.walks++;
    return originalWalk(
      ast,
      function countedBefore(node, replace, control) {
        counts.nodes++;
        if (before) return before(node, replace, control);
      },
      after,
      options,
    );
  }

  let instrumentedLinker;
  try {
    walkerEntry.exports = countedWalk;
    delete require.cache[linkerPath];
    instrumentedLinker = require('../');
  } finally {
    walkerEntry.exports = originalWalk;
    delete require.cache[linkerPath];
    if (linkerEntry) require.cache[linkerPath] = linkerEntry;
  }

  return {
    linker: instrumentedLinker,
    counts,
    reset() {
      counts.walks = 0;
      counts.nodes = 0;
    },
  };
}

function tocOutline(ast) {
  let nav;
  walk(ast, function (node) {
    if (
      node.type === 'Tag' &&
      node.name === 'nav' &&
      node.attrs.some((attr) => attr.name === 'role' && attr.val === 'doc-toc')
    ) {
      nav = node;
    }
  });
  assert(nav, 'expected a generated table of contents');

  function outlineList(list) {
    return list.block.nodes.map(function (item) {
      const linkNode = item.block.nodes[0];
      const nested = item.block.nodes.find(function (node) {
        return node.type === 'Tag' && node.name === 'ol';
      });
      return {
        href: linkNode.attrs.find((attr) => attr.name === 'href').val,
        text: linkNode.block.nodes.map((node) => node.val || '').join(''),
        children: nested ? outlineList(nested) : [],
      };
    });
  }

  return outlineList(nav.block.nodes[0]);
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

describe('linker pass and inheritance scaling', () => {
  test('feature-free resolution combines its census and lints in one walk', () => {
    const instrumented = instrumentLinkerWalks();
    const source = 'p#dup first\nimg#dup(src=/image.png)';
    const warnings = [];
    const options = {filename: 'simple.pg', source, warnings};
    const ast = parse(lex(source, options), options);

    const result = instrumented.linker.resolve(ast, options);

    assert.strictEqual(instrumented.counts.walks, 1);
    assert.strictEqual(result.nodes.length, 2);
    assert.deepStrictEqual(
      warnings.map((warning) => warning.code),
      ['PUGNEUM:DUPLICATE_ID', 'PUGNEUM:IMG_WITHOUT_ALT'],
    );
  });

  test('a reference document runs only its required resolver and final lint', () => {
    const instrumented = instrumentLinkerWalks();
    const source = 'references\n  docs /docs\n\np @[docs documentation]';
    const warnings = [];
    const options = {filename: 'reference.pg', source, warnings};
    const ast = parse(lex(source, options), options);

    const result = instrumented.linker.resolve(ast, options);

    assert.strictEqual(instrumented.counts.walks, 4);
    assert.strictEqual(result.nodes.length, 1);
    assert.strictEqual(result.nodes[0].block.nodes[0].type, 'Tag');
    assert.deepStrictEqual(warnings, []);
  });

  test('deep repeated overrides require linear walker visits', () => {
    const instrumented = instrumentLinkerWalks();
    const shallowProject = inheritanceProject(30);
    linkProject(
      shallowProject.files,
      shallowProject.entry,
      instrumented.linker,
    );
    const shallowVisits = instrumented.counts.nodes;

    instrumented.reset();
    const deepProject = inheritanceProject(60);
    linkProject(deepProject.files, deepProject.entry, instrumented.linker);
    const deepVisits = instrumented.counts.nodes;

    assert.ok(
      deepVisits < shallowVisits * 2.1,
      'doubling inheritance depth must stay linear: ' +
        shallowVisits +
        ' visits grew to ' +
        deepVisits,
    );
  });

  test('a deep extends chain overriding a shared replace-mode block stays bounded', () => {
    // Each level now retains only the current rendered slot index. There is no
    // flattened ancestry graph to recursively rebuild while the chain unwinds.
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

describe('inheritance slot scope and occurrence ownership', () => {
  test('same-name nested content does not reappear as a slot in a later inheritance level', () => {
    var files = {
      'layout.pg': 'html\n  body\n    block content\n      p default\n',
      'middle.pg':
        'extends layout.pg\nblock content\n  p middle\n  block content\n    p nested\n',
      'leaf.pg': 'extends middle.pg\nblock append content\n  p leaf\n',
    };
    var result = linkProject(files, 'leaf.pg');
    var text = [];
    walk(result.linked, function (node) {
      if (node.type === 'Text') text.push(node.val);
    });
    assert.strictEqual(text.filter((value) => value === 'leaf').length, 1);
    assert.ok(text.includes('middle'));
    assert.ok(text.includes('nested'));
    assert.ok(
      collectNamedBlocks(result.linked).every(
        (node) => !Object.hasOwn(node, 'ignore'),
      ),
    );
  });

  for (const parentMode of ['append', 'prepend']) {
    test(`a ${parentMode}-only parent occurrence is not an inheritance declaration`, () => {
      var files = {
        'layout.pg': `block ${parentMode} content\n  p parent\n`,
        'page.pg': 'extends layout.pg\nblock append content\n  p child\n',
      };
      assert.throws(
        () => linkProject(files, 'page.pg'),
        (err) =>
          err.code === 'PUGNEUM:UNEXPECTED_BLOCK' &&
          err.msg === 'Unexpected block content',
      );
    });
  }

  test('a mixin-owned named slot cannot satisfy a template override', () => {
    var files = {
      'layout.pg': 'mixin card()\n  block title\n    h2 default\n\np layout\n',
      'page.pg': 'extends layout.pg\nblock title\n  h2 page\n',
    };
    assert.throws(
      () => linkProject(files, 'page.pg'),
      (err) =>
        err.code === 'PUGNEUM:UNEXPECTED_BLOCK' &&
        err.msg === 'Unexpected block title',
    );
  });

  test('an unused mixin slot cannot override a layout block', () => {
    var files = {
      'layout.pg': 'html\n  body\n    block content\n      p default\n',
      'page.pg': [
        'extends layout.pg',
        'block content',
        '  p page',
        'mixin helper()',
        '  block content',
        '    p mixin',
      ].join('\n'),
    };
    const {linked} = linkProject(files, 'page.pg');
    let html;
    walk(linked, function (node, replace, control) {
      if (node.type === 'Tag' && node.name === 'html') {
        html = node;
        control.stop();
      }
    });
    const text = [];
    walk(html, function (node) {
      if (node.type === 'Text') text.push(node.val);
    });
    assert.deepStrictEqual(text, ['page']);
  });

  test('including an extended page preserves named slots owned by mixins', () => {
    var files = {
      'layout.pg': [
        'mixin card()',
        '  article',
        '    block title',
        '      h2 default',
        '    block body',
        '      p default',
        'html',
        '  body',
        '    block content',
      ].join('\n'),
      'page.pg': [
        'extends layout.pg',
        'block content',
        '  +card()',
        '    block title',
        '      h2 custom',
        '    block body',
        '      p custom',
      ].join('\n'),
      'main.pg': 'include page.pg\n',
    };
    const {linked} = linkProject(files, 'main.pg');
    const mixinSlotNames = [];
    walk(linked, function (node) {
      if (node.type !== 'Mixin') return;
      walk(node, function (owned) {
        if (owned.type === 'NamedBlock') mixinSlotNames.push(owned.name);
      });
      return false;
    });
    assert.deepStrictEqual(mixinSlotNames.sort(), [
      'body',
      'body',
      'title',
      'title',
    ]);
  });

  test('references declared by an extending template remain document-global', () => {
    var files = {
      'layout.pg': 'html\n  body\n    block content\n',
      'page.pg': [
        'extends layout.pg',
        'references',
        '  docs /docs',
        'block content',
        '  p @[docs read]',
      ].join('\n'),
    };
    const {linked} = linkProject(files, 'page.pg');
    let referenceLink;
    walk(linked, function (node) {
      if (node.type === 'Tag' && node.name === 'a') referenceLink = node;
      assert.notStrictEqual(node.type, 'References');
    });
    assert.equal(
      referenceLink.attrs.find((attr) => attr.name === 'href').val,
      '/docs',
    );
  });

  for (const mode of ['replace', 'append', 'prepend']) {
    test(`${mode} fan-out owns and resolves each rendered occurrence`, () => {
      var files = {
        'layout.pg': [
          'main',
          '  block slot',
          '    p main-default',
          'aside',
          '  block slot',
          '    p aside-default',
          'footnotes',
          '  x note',
        ].join('\n'),
        'page.pg': [
          'extends layout.pg',
          `block${mode === 'replace' ? '' : ' ' + mode} slot`,
          '  p Reused^[x]',
        ].join('\n'),
      };
      const {linked, warnings} = linkProject(files, 'page.pg');
      const referenceIds = [];
      let backlinkCount = 0;
      walk(linked, function (node) {
        if (node.type !== 'Tag' || !node.attrs) return;
        const role = node.attrs.find((attr) => attr.name === 'role');
        if (!role) return;
        if (role.val === 'doc-noteref') {
          referenceIds.push(node.attrs.find((attr) => attr.name === 'id').val);
        } else if (role.val === 'doc-backlink') {
          backlinkCount++;
        }
      });
      assert.deepStrictEqual(referenceIds, [
        'footnote-reference-x',
        'footnote-reference-x-2',
      ]);
      assert.strictEqual(backlinkCount, 2);
      assert.strictEqual(
        warnings.filter((warning) => warning.code === 'PUGNEUM:DUPLICATE_ID')
          .length,
        0,
      );
    });
  }
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

describe('reference reachability follows rendered footnotes', () => {
  function linkSource(source) {
    const warnings = [];
    const options = {filename: 'reachable.pg', source, lex, parse, basedir};
    const loaded = load(parse(lex(source, options), options), options);
    return {linked: link(loaded, Object.assign(options, {warnings})), warnings};
  }

  test('a missing reference inside an unreachable footnote is discarded', () => {
    const {linked, warnings} = linkSource(
      'p live\n\nfootnotes\n  dead See @[missing]',
    );
    let anchorCount = 0;
    walk(linked, function (node) {
      if (node.type === 'Tag' && node.name === 'a') anchorCount++;
    });
    assert.strictEqual(anchorCount, 0);
    assert.deepStrictEqual(
      warnings.map((warning) => warning.code),
      ['PUGNEUM:UNUSED_FOOTNOTE'],
    );
  });

  test('a global reference used only by an unreachable footnote remains unused', () => {
    const {warnings} = linkSource(
      'references\n  docs /docs\n\np live\n\nfootnotes\n  dead See @[docs]',
    );
    assert.deepStrictEqual(warnings.map((warning) => warning.code).sort(), [
      'PUGNEUM:UNUSED_FOOTNOTE',
      'PUGNEUM:UNUSED_REFERENCE',
    ]);
  });

  test('a reference declaration inside an unreachable footnote is not global', () => {
    assert.throws(
      () =>
        linkSource(
          'p @[hidden]\n\nfootnotes\n  dead\n    references\n      hidden /hidden',
        ),
      (err) =>
        err.code === 'PUGNEUM:UNDEFINED_REFERENCE' &&
        err.msg === "Undefined reference 'hidden'",
    );
  });

  test('references in transitively reachable footnotes resolve globally', () => {
    const {linked, warnings} = linkSource(
      'references\n  docs /docs\n\np live^[first]\n\nfootnotes\n  first Next^[second]\n  second See @[docs]',
    );
    let docsLink;
    walk(linked, function (node) {
      if (
        node.type === 'Tag' &&
        node.name === 'a' &&
        node.attrs.some((attr) => attr.name === 'href' && attr.val === '/docs')
      ) {
        docsLink = node;
      }
    });
    assert.ok(docsLink);
    assert.strictEqual(
      warnings.filter((warning) => warning.code === 'PUGNEUM:UNUSED_REFERENCE')
        .length,
      0,
    );
  });
});

describe('footnote transitive fixpoint and multi-reference rendering', () => {
  // The resolveFootnotes reachability queue and the toSuperscript /
  // footnoteRefId(-N) scheme need direct structural assertions. These pin
  // transitive reachability, discovery order, backlink labels, and ref-id
  // suffixing without relying only on a downstream HTML snapshot.
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
    // ONLY transitively. The queue must keep draining until d is numbered. All
    // four render in discovery order and NONE warns UNUSED_FOOTNOTE — a
    // one-level a->b chain would not pin deeper reachability.
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
    // never reached, the queue never descends into b, so c stays unreached too:
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

  test('footnote anchors share one collision-free document id namespace', () => {
    const {linked, warnings} = linkSource(
      [
        'p#footnote-x Authored definition candidate',
        'p#footnote-x-2 Authored fallback candidate',
        'p#footnote-reference-x Authored reference candidate',
        'p A^[x] B^[x] C^[x-2] D^[reference-x] E^[reference-x-2]',
        '',
        'footnotes',
        '  x X',
        '  x-2 X2',
        '  reference-x RX',
        '  reference-x-2 RX2',
      ].join('\n'),
    );
    const ids = [];
    const endnoteIds = new Set();
    const noterefIds = new Set();
    const noterefTargets = [];
    const backlinkTargets = [];

    walk(linked, function (node) {
      if (node.type !== 'Tag') return;
      const attrs = node.attrs || [];
      const id = attrs.find((attr) => attr.name === 'id');
      const href = attrs.find((attr) => attr.name === 'href');
      const role = attrs.find((attr) => attr.name === 'role');
      if (id) ids.push(id.val);
      if (!role) return;
      if (role.val === 'doc-endnote') endnoteIds.add(id.val);
      if (role.val === 'doc-noteref') {
        noterefIds.add(id.val);
        noterefTargets.push(href.val.slice(1));
      }
      if (role.val === 'doc-backlink') {
        backlinkTargets.push(href.val.slice(1));
      }
    });

    assert.strictEqual(ids.length, new Set(ids).size);
    assert.strictEqual(endnoteIds.size, 4);
    assert.strictEqual(noterefIds.size, 5);
    assert.ok(noterefTargets.every((target) => endnoteIds.has(target)));
    assert.ok(backlinkTargets.every((target) => noterefIds.has(target)));
    assert.strictEqual(
      warnings.filter((warning) => warning.code === 'PUGNEUM:DUPLICATE_ID')
        .length,
      0,
    );
  });

  test('numeric-looking names preserve first-reference queue order', () => {
    const {linked} = linkSource(
      'p first^[10] second^[2]\n\nfootnotes\n  10 reaches^[a]\n  2 reaches^[b]\n  a A\n  b B',
    );
    assert.deepStrictEqual(footnoteListItemIds(linked), [
      'footnote-10',
      'footnote-2',
      'footnote-a',
      'footnote-b',
    ]);
  });

  test('a long flat transitive chain resolves within a linear-work budget', () => {
    const count = 3000;
    const location = {line: 1, column: 1, filename: 'chain.pg'};
    const definitions = new Array(count);
    const nameAt = (index) => String(count - index);
    for (let index = 0; index < count; index++) {
      definitions[index] = Object.assign(
        {
          name: nameAt(index),
          block: Object.assign(
            {
              type: 'Block',
              nodes:
                index + 1 < count
                  ? [
                      Object.assign(
                        {type: 'FootnoteRef', name: nameAt(index + 1)},
                        location,
                      ),
                    ]
                  : [Object.assign({type: 'Text', val: 'end'}, location)],
            },
            location,
          ),
        },
        location,
      );
    }
    const ast = Object.assign(
      {
        type: 'Block',
        nodes: [
          Object.assign({type: 'FootnoteRef', name: nameAt(0)}, location),
          Object.assign({type: 'Footnotes', definitions}, location),
        ],
      },
      location,
    );

    const start = process.hrtime.bigint();
    const linked = link(ast, {warnings: []});
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.ok(ms < 5000, `resolving ${count} chained footnotes took ${ms}ms`);

    let list;
    walk(linked, function (node, replace, control) {
      if (node.type === 'Tag' && node.name === 'ol') {
        list = node;
        control.stop();
      }
    });
    assert.strictEqual(list.block.nodes.length, count);
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

  for (const value of ['', '   ', 'bad id', '\t']) {
    test(`a heading id ${JSON.stringify(value)} is not a usable target`, () => {
      const source = `toc\nh2(id=${JSON.stringify(value)}) Invalid`;
      const w = warningsFor(source);
      assert.strictEqual(
        w.filter((x) => x.code === 'PUGNEUM:EMPTY_TOC').length,
        1,
      );
    });
  }

  test('a non-ASCII id remains a usable fragment target', () => {
    const result = linkProject(
      {'main.pg': 'toc\nh2(id="章") Unicode heading'},
      'main.pg',
    );
    assert.deepStrictEqual(tocOutline(result.linked), [
      {href: '#章', text: 'Unicode heading', children: []},
    ]);
    assert.strictEqual(
      result.warnings.filter((x) => x.code === 'PUGNEUM:EMPTY_TOC').length,
      0,
    );
  });
});

describe('toc accessible text and hierarchy', () => {
  test('uses visible text introduced through an included transparent block', () => {
    const result = linkProject(
      {
        'main.pg': 'toc\nh2#sec\n  include title.pg',
        'title.pg': '| Visible title',
      },
      'main.pg',
    );
    assert.deepStrictEqual(tocOutline(result.linked), [
      {href: '#sec', text: 'Visible title', children: []},
    ]);
  });

  test('includes image alt text in mixed and image-only headings', () => {
    const result = linkProject(
      {
        'main.pg': [
          'references',
          '  pic /picture.png',
          '',
          'toc',
          'h2#mixed Prefix ![pic Brand icon] suffix',
          'h2#image ![pic Image only]',
        ].join('\n'),
      },
      'main.pg',
    );
    assert.deepStrictEqual(tocOutline(result.linked), [
      {href: '#mixed', text: 'Prefix Brand icon suffix', children: []},
      {href: '#image', text: 'Image only', children: []},
    ]);
  });

  test('recovers hierarchy after a shallower heading and skipped levels', () => {
    const result = linkProject(
      {
        'main.pg': [
          'toc',
          'h3#a A',
          'h2#b B',
          'h3#c C',
          'h5#d D',
          'h2#e E',
          'h4#f F',
        ].join('\n'),
      },
      'main.pg',
    );
    assert.deepStrictEqual(tocOutline(result.linked), [
      {href: '#a', text: 'A', children: []},
      {
        href: '#b',
        text: 'B',
        children: [
          {
            href: '#c',
            text: 'C',
            children: [{href: '#d', text: 'D', children: []}],
          },
        ],
      },
      {
        href: '#e',
        text: 'E',
        children: [{href: '#f', text: 'F', children: []}],
      },
    ]);
  });
});

describe('public boundary, depth, and ownership contracts', () => {
  const loc = {line: 1, column: 1, filename: 'entry.pg'};

  function block(nodes, filename) {
    return Object.assign(
      {
        type: 'Block',
        nodes,
        filename: filename || loc.filename,
      },
      loc,
      filename ? {filename} : null,
    );
  }

  function fileReference(ast, filename) {
    return {
      type: 'FileReference',
      path: filename,
      ast,
      line: 1,
      column: 1,
      filename: 'entry.pg',
    };
  }

  test('malformed roots consistently raise located INVALID_AST diagnostics', () => {
    for (const [label, ast] of [
      ['undefined', undefined],
      ['null', null],
      ['scalar', 42],
      ['array', []],
      ['wrong type', {type: 'Tag', name: 'div'}],
      ['missing nodes', {type: 'Block', filename: 'entry.pg'}],
      ['scalar nodes', {type: 'Block', nodes: 1, filename: 'entry.pg'}],
    ]) {
      const options = {
        filename: 'entry.pg',
        source: 'p source',
        warnings: [],
      };
      assert.throws(
        () => link(ast, options),
        (err) =>
          err.code === 'PUGNEUM:INVALID_AST' && err.source === 'p source',
        label,
      );
    }
  });

  test('options and warning collectors are validated before traversal', () => {
    const ast = block([]);
    for (const value of [null, 1, 'options', [], () => {}]) {
      assert.throws(
        () => link(ast, value),
        /options must be an object \(non-null and non-array\)/,
      );
    }
    for (const warnings of [null, {}, new Set(), Object.freeze([])]) {
      assert.throws(
        () => link(ast, {warnings}),
        /options\.warnings must be an extensible array/,
      );
    }
    assert.throws(
      () => link(ast, Object.freeze({})),
      /options must permit the warnings output property/,
    );
    assert.doesNotThrow(() =>
      link(ast, Object.freeze({warnings: [], maxLinkDepth: 0})),
    );
  });

  test('maxLinkDepth is a bounded safe integer and private-looking input is ignored', () => {
    const ast = block([]);
    for (const value of [-1, 257, 1.5, NaN, Infinity, '1']) {
      assert.throws(
        () => link(ast, {warnings: [], maxLinkDepth: value}),
        /options\.maxLinkDepth must be an integer from 0 through 256/,
      );
    }
    assert.doesNotThrow(() =>
      link(ast, {warnings: [], maxLinkDepth: 0, _linkDepth: 1000000}),
    );
  });

  test('depth counts followed edges and reports the edge that would exceed it', () => {
    const leaf = block([], 'leaf.pg');
    const middleExtends = Object.assign(
      {
        type: 'Extends',
        file: fileReference(leaf, 'leaf.pg'),
        filename: 'middle.pg',
      },
      loc,
      {line: 7, column: 3, filename: 'middle.pg'},
    );
    const middle = block([middleExtends], 'middle.pg');
    const rootExtends = Object.assign(
      {
        type: 'Extends',
        file: fileReference(middle, 'middle.pg'),
      },
      loc,
    );
    const root = block([rootExtends]);
    const before = structuredClone(root);
    const options = {
      warnings: [],
      maxLinkDepth: 1,
      sources: {'middle.pg': 'extends leaf.pg'},
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      assert.throws(
        () => link(root, options),
        (err) =>
          err.code === 'PUGNEUM:LINK_DEPTH_EXCEEDED' &&
          err.filename === 'middle.pg' &&
          err.line === 7 &&
          err.column === 3 &&
          err.source === 'extends leaf.pg',
      );
      assert.deepStrictEqual(root, before);
    }

    assert.doesNotThrow(() => link(root, {warnings: [], maxLinkDepth: 2}));
  });

  test('include depth zero rejects the include edge but permits a plain root', () => {
    const child = block([], 'child.pg');
    const include = Object.assign(
      {
        type: 'Include',
        file: fileReference(child, 'child.pg'),
        block: block([]),
      },
      loc,
      {line: 9, column: 5},
    );
    assert.throws(
      () => link(block([include]), {warnings: [], maxLinkDepth: 0}),
      (err) =>
        err.code === 'PUGNEUM:LINK_DEPTH_EXCEEDED' &&
        err.line === 9 &&
        err.column === 5,
    );
    assert.doesNotThrow(() => link(block([]), {warnings: [], maxLinkDepth: 0}));
  });

  test('the same dependency AST can be included twice with independent yields', () => {
    const child = block(
      [Object.assign({type: 'YieldBlock'}, loc, {filename: 'child.pg'})],
      'child.pg',
    );
    function includeWith(text, line) {
      return Object.assign(
        {
          type: 'Include',
          file: fileReference(child, 'child.pg'),
          block: block([Object.assign({type: 'Text', val: text}, loc)]),
        },
        loc,
        {line},
      );
    }
    const ast = block([includeWith('first', 2), includeWith('second', 3)]);
    const before = structuredClone(ast);
    const linked = link(ast, {warnings: []});
    const text = [];
    walk(linked, function (node) {
      if (node.type === 'Text') text.push(node.val);
    });
    assert.deepStrictEqual(text, ['first', 'second']);
    assert.deepStrictEqual(ast, before);
    assert.strictEqual(child.nodes[0].type, 'YieldBlock');
  });

  test('resolve returns a new tree and keeps scalar source context', () => {
    const source = 'p @[missing]';
    const options = {filename: 'direct.pg', source, warnings: []};
    const parsed = parse(lex(source, options), options);
    const before = structuredClone(parsed);
    assert.throws(
      () => link.resolve(parsed, options),
      (err) =>
        err.code === 'PUGNEUM:UNDEFINED_REFERENCE' &&
        err.filename === 'direct.pg' &&
        err.source === source,
    );
    assert.deepStrictEqual(parsed, before);

    const plain = block([Object.assign({type: 'Text', val: 'plain'}, loc)]);
    const resolved = link.resolve(plain, {warnings: []});
    assert.notStrictEqual(resolved, plain);
    assert.notStrictEqual(resolved.nodes[0], plain.nodes[0]);
    assert.deepStrictEqual(resolved, plain);
  });
});

describe('warnings option robustness', () => {
  test('a non-array warnings option is rejected at the boundary', () => {
    var source = 'img(src=/x.png)';
    var options = {
      filename: 't.pg',
      source,
      lex,
      parse,
      basedir,
    };
    var loaded = load(parse(lex(source, options), options), options);
    // Set the malformed value only at the linker boundary under test. The
    // lexer deliberately rejects a non-array collector at its own boundary.
    options.warnings = 'oops';
    assert.throws(
      () => link(loaded, options),
      (err) =>
        err instanceof TypeError &&
        err.message === 'options.warnings must be an extensible array',
    );
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
