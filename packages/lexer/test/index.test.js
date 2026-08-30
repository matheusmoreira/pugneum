'use strict';

var fs = require('fs');
var path = require('path');
var {test, describe} = require('node:test');
var assert = require('node:assert/strict');
var lex = require('../');

var dir = path.resolve(__dirname, '../../../test-cases');
var fixtureManifest = require('../../../test-cases/manifest.json');
var sharedCases = fixtureManifest.render
  .map((name) => name + '.pg')
  .concat(
    fixtureManifest.syntax,
    fixtureManifest.dependencies.filter((name) => name.endsWith('.pg')),
  )
  .sort();

function readShared(filename) {
  return fs.readFileSync(path.join(dir, filename), 'utf8');
}

function nestedInlineSource(depth) {
  return 'p ' + '*('.repeat(depth) + 'end' + ')'.repeat(depth);
}

function comparePoints(left, right) {
  return left.line - right.line || left.column - right.column;
}

function assertPhysicalTokenLocations(source, tokens, label) {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n|\r/g, '\n');
  const lines = normalized.split('\n');
  let previousEnd = {line: 1, column: 1};

  tokens.forEach((tok, index) => {
    const start = tok.loc.start;
    const end = tok.loc.end;
    const context = label + ' token ' + index + ' (' + tok.type + ')';

    assert.ok(
      start.line >= 1 && start.line <= lines.length,
      context + ' start line',
    );
    assert.ok(end.line >= 1 && end.line <= lines.length, context + ' end line');
    assert.ok(
      start.column >= 1 && start.column <= lines[start.line - 1].length + 1,
      context + ' start column',
    );
    assert.ok(
      end.column >= 1 && end.column <= lines[end.line - 1].length + 1,
      context + ' end column',
    );
    assert.ok(comparePoints(start, end) <= 0, context + ' has a reversed span');
    assert.ok(
      comparePoints(previousEnd, start) <= 0,
      context + ' moves backward in the token stream',
    );
    previousEnd = end;
  });
}

function assertDocumentedTokenStreamContract(tokens, filename) {
  const boundaryPairs = {
    'start-attributes': 'end-attributes',
    'start-pipeless-text': 'end-pipeless-text',
    'start-interpolation': 'end-interpolation',
    'start-ref-link': 'end-ref-link',
    'start-ref-image': 'end-ref-image',
    'start-footnote-ref': 'end-footnote-ref',
  };
  const boundaryEnds = new Set(Object.values(boundaryPairs));
  const expectedEnds = [];
  let indentDepth = 0;
  let eosCount = 0;

  assert.ok(Array.isArray(tokens), filename + ' returns an array');
  tokens.forEach((token, index) => {
    const context = filename + ' token ' + index;
    assert.ok(token && typeof token === 'object' && !Array.isArray(token));
    assert.strictEqual(typeof token.type, 'string', context + ' type');
    assert.ok(token.loc && typeof token.loc === 'object', context + ' loc');
    assert.strictEqual(token.loc.filename, filename, context + ' filename');

    ['start', 'end'].forEach((edge) => {
      assert.ok(token.loc[edge], context + ' ' + edge);
      assert.ok(
        Number.isInteger(token.loc[edge].line) && token.loc[edge].line >= 1,
        context + ' ' + edge + ' line',
      );
      assert.ok(
        Number.isInteger(token.loc[edge].column) && token.loc[edge].column >= 1,
        context + ' ' + edge + ' column',
      );
    });

    if (boundaryPairs[token.type]) {
      expectedEnds.push(boundaryPairs[token.type]);
    } else if (boundaryEnds.has(token.type)) {
      assert.strictEqual(token.type, expectedEnds.pop(), context + ' balance');
    }

    if (token.type === 'indent') indentDepth++;
    if (token.type === 'outdent') {
      assert.ok(indentDepth > 0, context + ' indentation underflow');
      indentDepth--;
    }
    if (token.type === 'eos') {
      eosCount++;
      assert.strictEqual(index, tokens.length - 1, context + ' terminal eos');
      assert.deepStrictEqual(token.loc.start, token.loc.end);
    }
  });

  assert.deepStrictEqual(expectedEnds, [], filename + ' boundary balance');
  assert.strictEqual(indentDepth, 0, filename + ' indentation balance');
  assert.strictEqual(eosCount, 1, filename + ' eos count');
}

test('shared streams satisfy the documented v1 envelope and balance', () => {
  sharedCases.forEach((filename) => {
    assertDocumentedTokenStreamContract(
      lex(readShared(filename), {filename}),
      filename,
    );
  });
});

sharedCases.forEach(function (testCase) {
  test(testCase, (t) => {
    var result = lex(readShared(testCase), {
      filename: testCase,
    });
    t.assert.snapshot(result);
  });
});

test('shared nested empty source emits only a located end token', () => {
  var filename = 'fixtures/empty.pg';
  assert.deepStrictEqual(lex(readShared(filename), {filename}), [
    {
      type: 'eos',
      loc: {
        start: {line: 1, column: 1},
        filename,
        end: {line: 1, column: 1},
      },
    },
  ]);
});

test('shared nested doctype keeps its canonical text and physical span', () => {
  var filename = 'auxiliary/blocks-in-blocks-layout.pg';
  var first = lex(readShared(filename), {filename})[0];
  assert.deepStrictEqual(first, {
    type: 'text',
    loc: {
      start: {line: 1, column: 1},
      filename,
      end: {line: 1, column: 13},
    },
    val: '<!DOCTYPE html>',
  });
});

describe('doctype end-of-line padding', () => {
  function assertCanonicalDoctype(source) {
    const tokens = lex(source, {filename: 'doctype-padding.pg'});
    assert.deepStrictEqual(tokens[0], {
      type: 'text',
      loc: {
        start: {line: 1, column: 1},
        filename: 'doctype-padding.pg',
        end: {line: 1, column: 13},
      },
      val: '<!DOCTYPE html>',
    });
    assertPhysicalTokenLocations(source, tokens, source);
    return tokens;
  }

  test('newline padding cannot become document text', () => {
    [
      'doctype html\np x',
      'doctype html \np x',
      'doctype html   \np x',
      'doctype html\t \np x',
    ].forEach((source) => {
      const tokens = assertCanonicalDoctype(source);
      const text = tokens.filter((tok) => tok.type === 'text');

      assert.deepStrictEqual(
        text.map((tok) => tok.val),
        ['<!DOCTYPE html>', 'x'],
      );
      assert.deepStrictEqual(text[1].loc.start, {line: 2, column: 3});
    });
  });

  test('EOF padding advances EOS without widening the doctype token', () => {
    [
      'doctype html',
      'doctype html ',
      'doctype html   ',
      'doctype html\t ',
    ].forEach((source) => {
      const tokens = assertCanonicalDoctype(source);
      const eos = tokens.at(-1);

      assert.deepStrictEqual(
        tokens.map((tok) => tok.type),
        ['text', 'eos'],
      );
      assert.deepStrictEqual(eos.loc.start, {
        line: 1,
        column: source.length + 1,
      });
    });
  });
});

test('exported attribute-name validation matches lexer boundaries', () => {
  assert.strictEqual(lex.isValidAttributeName('data-value'), true);
  ['x/y', 'x>y', 'x\0y', '', 'two words'].forEach((name) => {
    assert.strictEqual(lex.isValidAttributeName(name), false, name);
  });
});

var lexerDir = __dirname + '/cases/';
fs.readdirSync(lexerDir).forEach(function (testCase) {
  if (/\.pg$/.test(testCase)) {
    test(testCase, (t) => {
      var result = lex(fs.readFileSync(lexerDir + testCase, 'utf8'), {
        filename: testCase,
      });
      t.assert.snapshot(result);
    });
  }
});

var edir = __dirname + '/errors/';
fs.readdirSync(edir).forEach(function (testCase) {
  if (/\.pg$/.test(testCase)) {
    test(testCase, (t) => {
      var actual;
      try {
        lex(fs.readFileSync(edir + testCase, 'utf8'), {
          filename: testCase,
        });
        throw new Error('Expected ' + testCase + ' to throw an exception.');
      } catch (ex) {
        if (!ex || !ex.code || ex.code.indexOf('PUGNEUM:') !== 0) throw ex;
        actual = {
          msg: ex.msg,
          code: ex.code,
          line: ex.line,
          column: ex.column,
        };
      }
      t.assert.snapshot(actual);
    });
  }
});

test('inline shorthand reserves one depth level for its container', () => {
  assert.doesNotThrow(() =>
    lex(nestedInlineSource(255), {filename: 'depth.pg'}),
  );
  assert.throws(
    () => lex(nestedInlineSource(256), {filename: 'depth.pg'}),
    (err) => {
      assert.strictEqual(err.code, 'PUGNEUM:NESTING_TOO_DEEP');
      assert.strictEqual(
        err.msg,
        'Template nesting exceeds maximum depth of 256',
      );
      return true;
    },
  );
});

test('many escaped shorthands in single text node', (t) => {
  const escapes = Array(100).fill('\\*(x)').join(' ');
  const input = 'p ' + escapes + ' end';
  const tokens = lex(input, {filename: 'stress.pg'});
  const textTokens = tokens.filter((tok) => tok.type === 'text');
  const joined = textTokens.map((tok) => tok.val).join('');
  t.assert.strictEqual((joined.match(/\*\(x\)/g) || []).length, 100);
  t.assert.ok(joined.endsWith('end'));
  t.assert.ok(!joined.includes('<strong>'));
});

describe('code span escaping (unescapeCodeSpan)', () => {
  // The table filter neutralizes a live #{ by emitting \#{ into the code span it
  // generates; the lexer strips that backslash so the span shows a literal #{.
  test('\\#{ unescapes to a literal #{ inside a `(...) code span', () => {
    const tokens = lex('p `(price \\#{n})`', {filename: 'codespan.pg'});
    const content = tokens.find(
      (tok) => tok.type === 'text' && /price/.test(tok.val),
    );
    assert.ok(content);
    assert.strictEqual(content.val, 'price #{n}');
  });

  // But the \# strip is scoped to a following `{`: a bare escaped hash keeps its
  // backslash, exactly like base and every other shorthand. Regression guard — a
  // broad \#-># strip silently dropped the backslash from e.g. `\#general`.
  test('a bare \\# (not heading an interpolation) keeps its backslash', () => {
    const tokens = lex('p `(channel \\#general)`', {filename: 'codespan.pg'});
    const content = tokens.find(
      (tok) => tok.type === 'text' && /channel/.test(tok.val),
    );
    assert.ok(content);
    assert.strictEqual(content.val, 'channel \\#general');
  });
});

describe('given keyword', () => {
  test('given produces token with block name', (t) => {
    const tokens = lex('given source\n  p text', {filename: 'test'});
    const givenTok = tokens.find((t) => t.type === 'given');
    assert.ok(givenTok);
    assert.strictEqual(givenTok.val, 'source');
  });

  test('escaped given is a tag', (t) => {
    const tokens = lex('\\given', {filename: 'test'});
    const tagTok = tokens.find((t) => t.type === 'tag');
    assert.ok(tagTok);
    assert.strictEqual(tagTok.val, 'given');
  });

  test('bare given throws MALFORMED_GIVEN', (t) => {
    assert.throws(
      () => lex('given', {filename: 'test'}),
      (err) => err.code === 'PUGNEUM:MALFORMED_GIVEN',
    );
  });

  test('given with comment strips name correctly', (t) => {
    const tokens = lex('given source // optional\n  p text', {
      filename: 'test',
    });
    const givenTok = tokens.find((t) => t.type === 'given');
    assert.ok(givenTok);
    assert.strictEqual(givenTok.val, 'source');
  });
});

describe('mixin call line boundaries', () => {
  test('the call head accepts horizontal whitespace only', () => {
    const tokens = lex('+\tfoo\t(alpha\tbeta)', {filename: 'call.pg'});
    const call = tokens.find((tok) => tok.type === 'call');

    assert.ok(call);
    assert.strictEqual(call.val, 'foo');
    assert.deepStrictEqual(call.args, ['alpha', 'beta']);
  });

  test('a call head cannot cross a physical line', () => {
    [
      '+\nfoo',
      '+\rfoo',
      '+\r\nfoo',
      '+\vfoo',
      '+\ffoo',
      '+\u2028foo',
      '+\u2029foo',
      '+\u00a0foo',
    ].forEach((source) => {
      assert.throws(
        () => lex(source, {filename: 'call.pg'}),
        (err) =>
          err.code === 'PUGNEUM:UNEXPECTED_TEXT' &&
          err.line === 1 &&
          err.column === 1,
      );
    });
  });

  test('multiline arguments use whitespace separators and physical locations', () => {
    const tokens = lex('+foo(\n  alpha\n  beta\n)\np later', {
      filename: 'call.pg',
    });
    const call = tokens.find((tok) => tok.type === 'call');
    const later = tokens.find((tok) => tok.type === 'tag' && tok.val === 'p');

    assert.deepStrictEqual(call.args, ['alpha', 'beta']);
    assert.deepStrictEqual(call.loc, {
      start: {line: 1, column: 1},
      filename: 'call.pg',
      end: {line: 4, column: 2},
    });
    assert.strictEqual(later.loc.start.line, 5);
    assert.strictEqual(later.loc.start.column, 1);
  });

  test('newlines inside quoted arguments still advance physical locations', () => {
    const tokens = lex('+foo("alpha\nbeta" gamma)\np later', {
      filename: 'call.pg',
    });
    const call = tokens.find((tok) => tok.type === 'call');
    const later = tokens.find((tok) => tok.type === 'tag' && tok.val === 'p');

    assert.deepStrictEqual(call.args, ['alpha\nbeta', 'gamma']);
    assert.strictEqual(call.loc.end.line, 2);
    assert.strictEqual(call.loc.end.column, 13);
    assert.strictEqual(later.loc.start.line, 3);
  });

  test('balanced and quoted arguments preserve their documented values', () => {
    const source =
      '+apply(outer(inner(value)) \'Status (ready)\' "say \\"hi\\"")';
    const tokens = lex(source, {filename: 'call.pg'});
    const call = tokens.find((tok) => tok.type === 'call');

    assert.deepStrictEqual(call.args, [
      'outer(inner(value))',
      'Status (ready)',
      'say "hi"',
    ]);
    assertPhysicalTokenLocations(source, tokens, source);
  });

  test('an unclosed multiline argument list reports the physical EOF', () => {
    assert.throws(
      () => lex('+foo(\n alpha\n beta', {filename: 'call.pg'}),
      (err) =>
        err.code === 'PUGNEUM:NO_END_BRACKET' &&
        err.line === 3 &&
        err.column === 6,
    );
  });
});

describe('physical shorthand source locations', () => {
  test('all shared token streams are monotonic and within physical source bounds', () => {
    sharedCases.forEach((filename) => {
      const source = readShared(filename);
      const tokens = lex(source, {filename});
      assertPhysicalTokenLocations(source, tokens, filename);
    });
  });

  test('generated shorthand structure does not displace authored text', () => {
    const source = 'p before *(x) after';
    const tokens = lex(source, {filename: 'locations.pg'});
    const generatedTag = tokens.find(
      (tok) => tok.type === 'tag' && tok.val === 'strong',
    );
    const inner = tokens.find((tok) => tok.type === 'text' && tok.val === 'x');

    assert.deepStrictEqual(generatedTag.loc.start, {line: 1, column: 12});
    assert.deepStrictEqual(generatedTag.loc.end, generatedTag.loc.start);
    assert.deepStrictEqual(inner.loc.start, {line: 1, column: 12});
    assert.deepStrictEqual(inner.loc.end, {line: 1, column: 13});
  });

  test('image attributes advance the parent cursor through the authored block', () => {
    const source = 'p !(/x alt)(class=y) tail';
    const tokens = lex(source, {filename: 'locations.pg'});
    const tail = tokens.find(
      (tok) => tok.type === 'text' && tok.val === ' tail',
    );
    const eos = tokens.at(-1);

    assert.strictEqual(tail.loc.start.column, source.indexOf(' tail') + 1);
    assert.strictEqual(eos.loc.end.column, source.length + 1);
  });

  test('reference payload normalization does not change source widths', () => {
    const imageSource = 'p ![img alt]';
    const imageTokens = lex(imageSource, {filename: 'locations.pg'});
    const alt = imageTokens.find(
      (tok) => tok.type === 'text' && tok.val === 'alt',
    );
    assert.deepStrictEqual(alt.loc.start, {line: 1, column: 9});
    assert.deepStrictEqual(alt.loc.end, {line: 1, column: 12});

    ['p @[ref label\\]] tail', 'p @[ref @[inner]] tail'].forEach((source) => {
      const eos = lex(source, {filename: 'locations.pg'}).at(-1);
      assert.strictEqual(eos.loc.end.column, source.length + 1, source);
    });

    const footnoteSource = 'p ^[ note ] tail';
    const footnoteEos = lex(footnoteSource, {filename: 'locations.pg'}).at(-1);
    assert.strictEqual(footnoteEos.loc.end.column, footnoteSource.length + 1);
  });

  test('multiline shorthand payloads retain their physical line and column', () => {
    const source = 'div.\n  alpha *(strong\n    _(em)) omega';
    const tokens = lex(source, {filename: 'locations.pg'});
    const generatedTag = tokens.find(
      (tok) => tok.type === 'tag' && tok.val === 'em',
    );
    const inner = tokens.find((tok) => tok.type === 'text' && tok.val === 'em');

    assert.deepStrictEqual(generatedTag.loc.start, {line: 3, column: 7});
    assert.deepStrictEqual(generatedTag.loc.end, generatedTag.loc.start);
    assert.deepStrictEqual(inner.loc.start, {line: 3, column: 7});
    assert.deepStrictEqual(inner.loc.end, {line: 3, column: 9});
  });

  test('warnings from appended image attributes retain root source provenance', () => {
    const source = 'p before !(/img alt)(title=‘x’) after';
    const warnings = [];

    lex(source, {filename: 'locations.pg', warnings});

    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].line, 1);
    assert.strictEqual(warnings[0].column, source.indexOf('‘') + 1);
    assert.strictEqual(warnings[0].source, source);
  });
});

describe('quoted filter name boundaries', () => {
  function assertMalformedFilter(source) {
    assert.throws(
      () => lex(source, {filename: 'quoted-filter.pg'}),
      (err) => {
        assert.strictEqual(err.code, 'PUGNEUM:MALFORMED_FILTER');
        assert.strictEqual(err.line, 1);
        assert.strictEqual(err.column, 2);
        return true;
      },
    );
  }

  test('valid quoted names retain spaces and punctuation', () => {
    const cases = [
      [":'name with spaces'\n  body", 'name with spaces'],
      [':"name.with|punctuation"\n  body', 'name.with|punctuation'],
    ];

    cases.forEach(([source, name]) => {
      const tokens = lex(source, {filename: 'quoted-filter.pg'});

      assert.strictEqual(tokens[0].type, 'filter');
      assert.strictEqual(tokens[0].val, name);
      assertPhysicalTokenLocations(source, tokens, source);
    });
  });

  test('a later-line quote cannot close a filter name', () => {
    assertMalformedFilter(":'foo\nbar'\n  text");
    assertMalformedFilter(':"foo\nbar"\n  text');
  });

  test('an EOF-unclosed quoted name fails at its opening quote', () => {
    assertMalformedFilter(":'foo");
    assertMalformedFilter(':"foo');
  });
});

describe('bare dotted filter names', () => {
  test('a block filter keeps every dotted segment in one token', () => {
    const source = ':highlight.js(language=javascript)\n  body';
    const tokens = lex(source, {filename: 'dotted-filter.pg'});

    assert.strictEqual(tokens[0].type, 'filter');
    assert.strictEqual(tokens[0].val, 'highlight.js');
    assert.ok(!tokens.some((tok) => tok.type === 'class'));
    assertPhysicalTokenLocations(source, tokens, source);
  });

  test('an include filter accepts dotted segments before its path', () => {
    const source = 'include:asset.minifier source.txt';
    const tokens = lex(source, {filename: 'dotted-include.pg'});

    assert.deepStrictEqual(
      tokens.map((tok) => [tok.type, tok.val]),
      [
        ['include', undefined],
        ['filter', 'asset.minifier'],
        ['path', 'source.txt'],
        ['eos', undefined],
      ],
    );
    assertPhysicalTokenLocations(source, tokens, source);
  });
});

describe('filter end-of-line padding', () => {
  test('plain filters ignore spaces before a pipeless body', () => {
    const source = ':verbatim   \n  hello';
    const tokens = lex(source, {filename: 'filter-padding.pg'});

    assert.deepStrictEqual(
      tokens.map((tok) => tok.type),
      ['filter', 'start-pipeless-text', 'text', 'end-pipeless-text', 'eos'],
    );
    assert.strictEqual(tokens[2].val, 'hello');
    assert.deepStrictEqual(tokens[2].loc.start, {line: 2, column: 3});
    assertPhysicalTokenLocations(source, tokens, source);
  });

  test('attributed filters ignore mixed horizontal padding', () => {
    const source = ':verbatim(option="x")\t \n\tbody';
    const tokens = lex(source, {filename: 'filter-padding.pg'});

    assert.deepStrictEqual(
      tokens.map((tok) => tok.type),
      [
        'filter',
        'start-attributes',
        'attribute',
        'end-attributes',
        'start-pipeless-text',
        'text',
        'end-pipeless-text',
        'eos',
      ],
    );
    assert.strictEqual(tokens[5].val, 'body');
    assert.deepStrictEqual(tokens[5].loc.start, {line: 2, column: 2});
    assertPhysicalTokenLocations(source, tokens, source);
  });

  test('horizontal padding at EOF does not become filter text', () => {
    const sources = [':verbatim   ', ':verbatim(option="x")\t '];

    sources.forEach((source) => {
      const tokens = lex(source, {filename: 'filter-padding.pg'});
      const eos = tokens.at(-1);

      assert.ok(!tokens.some((tok) => tok.type === 'text'), source);
      assert.strictEqual(eos.type, 'eos');
      assert.deepStrictEqual(eos.loc.start, {
        line: 1,
        column: source.length + 1,
      });
      assertPhysicalTokenLocations(source, tokens, source);
    });
  });

  test('genuine same-line filter content remains text', () => {
    const sources = [
      ':verbatim inline text',
      ':verbatim(option="x") inline text',
    ];

    sources.forEach((source) => {
      const tokens = lex(source, {filename: 'filter-padding.pg'});
      const text = tokens.find((tok) => tok.type === 'text');

      assert.strictEqual(text.val, 'inline text');
      assertPhysicalTokenLocations(source, tokens, source);
    });
  });
});

describe('pipeless text terminal locations', () => {
  function assertTerminalLocation(source, expected) {
    const tokens = lex(source, {filename: 'pipeless-eof.pg'});
    const end = tokens.find((tok) => tok.type === 'end-pipeless-text');
    const eos = tokens.at(-1);

    assert.deepStrictEqual(end.loc.start, expected, source);
    assert.deepStrictEqual(end.loc.end, expected, source);
    assert.strictEqual(eos.type, 'eos');
    assert.deepStrictEqual(eos.loc.start, expected, source);
    assert.deepStrictEqual(eos.loc.end, expected, source);
    assertPhysicalTokenLocations(source, tokens, source);
  }

  test('every pipeless caller counts a consumed newline at EOF', () => {
    ['p.\n  x\n', ':verbatim\n  x\n', '//-\n  x\n'].forEach((source) => {
      assertTerminalLocation(source, {line: 3, column: 1});
    });
  });

  test('each consumed terminal blank line advances the EOF location', () => {
    assertTerminalLocation('p.\n  x\n\n', {line: 4, column: 1});
  });

  test('a non-EOF delimiter remains for the ordinary newline scanner', () => {
    const source = 'p.\n  x\np y';
    const tokens = lex(source, {filename: 'pipeless-followed.pg'});
    const end = tokens.find((tok) => tok.type === 'end-pipeless-text');
    const tags = tokens.filter((tok) => tok.type === 'tag');

    assert.deepStrictEqual(end.loc.end, {line: 2, column: 4});
    assert.deepStrictEqual(tags[1].loc.start, {line: 3, column: 1});
    assertPhysicalTokenLocations(source, tokens, source);
  });
});

describe('context-aware multiline pipeless text', () => {
  function contentLines(tokens) {
    return tokens
      .filter((tok) => tok.type === 'text' && tok.val)
      .map((tok) => ({val: tok.val, loc: tok.loc}));
  }

  test('raw filter bodies preserve shorthand-looking lines through EOF', () => {
    const source = ':verbatim\n  first *(\n  second line';
    const tokens = lex(source, {filename: 'literal.pg'});

    assert.deepStrictEqual(contentLines(tokens), [
      {
        val: 'first *(',
        loc: {
          start: {line: 2, column: 3},
          filename: 'literal.pg',
          end: {line: 2, column: 11},
        },
      },
      {
        val: 'second line',
        loc: {
          start: {line: 3, column: 3},
          filename: 'literal.pg',
          end: {line: 3, column: 14},
        },
      },
    ]);
    assert.strictEqual(
      tokens.filter((tok) => tok.type === 'newline').length,
      1,
    );
  });

  test('unbuffered comments preserve shorthand-looking lines through EOF', () => {
    const source = '//-\n  first @[\n  second line';
    const tokens = lex(source, {filename: 'literal.pg'});

    assert.deepStrictEqual(
      contentLines(tokens).map((tok) => tok.val),
      ['first @[', 'second line'],
    );
    const newline = tokens.find((tok) => tok.type === 'newline');
    assert.deepStrictEqual(newline.loc, {
      start: {line: 3, column: 1},
      filename: 'literal.pg',
      end: {line: 3, column: 3},
    });
  });

  test('code-span delimiters remain literal to the continuation scanner', () => {
    const source = 'p.\n  `(literal @[text)\n  next line';
    const tokens = lex(source, {filename: 'literal.pg'});
    const lines = contentLines(tokens);

    assert.deepStrictEqual(
      lines.map((tok) => tok.val),
      ['literal @[text', 'next line'],
    );
    assert.deepStrictEqual(lines[1].loc.start, {line: 3, column: 3});
    assert.strictEqual(
      tokens.filter((tok) => tok.type === 'newline').length,
      1,
    );
  });

  test('shorthand-looking image URLs do not consume the following line', () => {
    const source = 'p.\n  !(@[)\n  next line';
    const tokens = lex(source, {filename: 'literal.pg'});
    const src = tokens.find(
      (tok) => tok.type === 'attribute' && tok.name === 'src',
    );
    const lines = contentLines(tokens);

    assert.strictEqual(src.val, '@[');
    assert.deepStrictEqual(
      lines.map((tok) => tok.val),
      ['next line'],
    );
    assert.deepStrictEqual(lines[0].loc.start, {line: 3, column: 3});
    assert.strictEqual(
      tokens.filter((tok) => tok.type === 'newline').length,
      1,
    );
  });

  test('multiline image attributes are grouped with their shorthand', () => {
    const source = 'p.\n  !(x alt)(\n    class=y)\n  next line';
    const tokens = lex(source, {filename: 'literal.pg'});
    const classAttr = tokens.find(
      (tok) => tok.type === 'attribute' && tok.name === 'class',
    );
    const next = contentLines(tokens).find((tok) => tok.val === 'next line');

    assert.ok(classAttr);
    assert.strictEqual(classAttr.val, 'y');
    assert.deepStrictEqual(classAttr.loc.start, {line: 3, column: 5});
    assert.deepStrictEqual(next.loc.start, {line: 4, column: 3});
    assert.strictEqual(
      tokens.filter((tok) => tok.type === 'newline').length,
      1,
    );
  });

  test('quoted attribute delimiters do not join the following line', () => {
    const source = 'p.\n  #(span(title="(") text) tail\n  next line';
    const tokens = lex(source, {filename: 'literal.pg'});
    const lines = contentLines(tokens);

    assert.deepStrictEqual(
      lines.map((tok) => tok.val),
      ['text', ' tail', 'next line'],
    );
    assert.deepStrictEqual(lines[2].loc.start, {line: 3, column: 3});
    assert.strictEqual(
      tokens.filter((tok) => tok.type === 'newline').length,
      1,
    );
  });

  test('quotes in ordinary interpolation text remain literal delimiters', () => {
    const source = 'p.\n  #(span text (quoted "x)\n  y") tail\n  next line';
    const tokens = lex(source, {filename: 'literal.pg'});
    const lines = contentLines(tokens);

    assert.deepStrictEqual(
      lines.map((tok) => tok.val),
      ['text (quoted "x) y"', ' tail', 'next line'],
    );
    assert.deepStrictEqual(lines[2].loc.start, {line: 4, column: 3});
    assert.strictEqual(
      tokens.filter((tok) => tok.type === 'newline').length,
      1,
    );
  });
});

describe('nested inline parenthesis depth', () => {
  function nonEmptyText(tokens) {
    return tokens
      .filter((tok) => tok.type === 'text' && tok.val)
      .map((tok) => tok.val);
  }

  test('a nested shorthand cannot close its enclosing literal group', () => {
    const tokens = lex('p *(outer (prefix _(inner) suffix) tail)', {
      filename: 'depth.pg',
    });

    assert.deepStrictEqual(nonEmptyText(tokens), [
      'outer (prefix ',
      'inner',
      ' suffix) tail',
    ]);
  });

  test('a variable candidate preserves the enclosing literal group', () => {
    const tokens = lex('p *(outer (prefix #{name} suffix) tail)', {
      filename: 'depth.pg',
    });

    assert.deepStrictEqual(nonEmptyText(tokens), [
      'outer (prefix ',
      ' suffix) tail',
    ]);
    assert.strictEqual(
      tokens.filter((tok) => tok.type === 'variable').at(0).val,
      'name',
    );
  });

  test('an escaped opener and a live shorthand retain both depths', () => {
    const tokens = lex(
      'p *(outer (prefix \\_(literal) and _(inner) suffix) tail)',
      {filename: 'depth.pg'},
    );

    assert.deepStrictEqual(nonEmptyText(tokens), [
      'outer (prefix _(literal) and ',
      'inner',
      ' suffix) tail',
    ]);
  });
});

describe('context-aware reference shorthand boundaries', () => {
  const families = [
    {open: '@[', start: 'start-ref-link'},
    {open: '![', start: 'start-ref-image'},
    {open: '^[', start: 'start-footnote-ref'},
  ];

  function assertBoundedPayload(payload) {
    families.forEach(({open, start}) => {
      const source = 'p ' + open + 'ref ' + payload + '] tail';
      const tokens = lex(source, {filename: 'boundary.pg'});

      assert.ok(
        tokens.some((tok) => tok.type === start),
        source,
      );
      assert.ok(
        tokens.some((tok) => tok.type === 'text' && tok.val === ' tail'),
        source,
      );
      assertPhysicalTokenLocations(source, tokens, source);
    });
  }

  test('quoted interpolation attributes protect literal parentheses', () => {
    assertBoundedPayload('#(span(title="(") ok)');
  });

  test('code spans protect shorthand-looking brackets', () => {
    assertBoundedPayload('`(literal @[x)');
  });

  test('escaped bracket openers retain their matching literal close', () => {
    assertBoundedPayload('\\@[literal] end');

    const tokens = lex('p @[ref \\@[literal] end] tail', {
      filename: 'boundary.pg',
    });
    assert.strictEqual(
      tokens.filter((tok) => tok.type === 'start-ref-link').length,
      1,
    );
    assert.ok(
      tokens.some((tok) => tok.type === 'text' && tok.val === '@[literal] end'),
    );
  });

  test('parenthesized shorthands protect literal closing brackets', () => {
    assertBoundedPayload('*(literal ] text) end');
  });

  test('multiline escaped brackets do not end the outer shorthand early', () => {
    const source = 'p.\n  @[ref \\@[literal\n  ] end\n  ]\n  next line';
    const tokens = lex(source, {filename: 'boundary.pg'});
    const next = tokens.find(
      (tok) => tok.type === 'text' && tok.val === 'next line',
    );

    assert.ok(tokens.some((tok) => tok.type === 'start-ref-link'));
    assert.deepStrictEqual(next.loc.start, {line: 5, column: 3});
    assertPhysicalTokenLocations(source, tokens, source);
  });

  test('deep nested bracket boundaries use an explicit stack', () => {
    const depth = 5000;
    const source =
      'p @[ref ' + '@['.repeat(depth) + 'x' + ']'.repeat(depth) + ']';
    const tokens = lex(source, {filename: 'boundary.pg'});

    assert.strictEqual(
      tokens.filter((tok) => tok.type === 'start-ref-link').length,
      1,
    );
    assert.strictEqual(tokens.at(-1).type, 'eos');
    assertPhysicalTokenLocations(source, tokens, source);
  });
});

describe('quoted reference-definition URLs', () => {
  const quoteCases = [
    {name: 'single', quote: "'"},
    {name: 'double', quote: '"'},
  ];

  function definition(source) {
    const tokens = lex(source, {filename: 'references.pg'});
    assertPhysicalTokenLocations(source, tokens, source);
    return tokens.find((tok) => tok.type === 'ref-def');
  }

  function assertUnclosedAt(source, column) {
    assert.throws(
      () => lex(source, {filename: 'references.pg'}),
      (err) => {
        assert.strictEqual(err.code, 'PUGNEUM:INVALID_REF_DEF');
        assert.match(err.msg, /Unclosed quote/);
        assert.deepStrictEqual(
          {line: err.line, column: err.column},
          {line: 2, column},
        );
        return true;
      },
    );
  }

  test('escaped matching quotes stay in the URL', () => {
    quoteCases.forEach(({name, quote}) => {
      const url = 'https://example.test/a' + '\\' + quote + 'b';
      const source =
        'references\n  ' + name + ' ' + quote + url + quote + ' fallback';
      const tok = definition(source);

      assert.strictEqual(tok.url, 'https://example.test/a' + quote + 'b');
      assert.strictEqual(tok.defaultText, 'fallback');
    });
  });

  test('a doubled trailing backslash decodes before the closing quote', () => {
    quoteCases.forEach(({name, quote}) => {
      const url = 'https://example.test/tail' + '\\\\';
      const source =
        'references\n  ' + name + ' ' + quote + url + quote + ' fallback';
      const tok = definition(source);

      assert.strictEqual(tok.url, 'https://example.test/tail' + '\\');
      assert.strictEqual(tok.defaultText, 'fallback');
    });
  });

  test('an unclosed quote at EOF fails at its opening delimiter', () => {
    quoteCases.forEach(({name, quote}) => {
      const source =
        'references\n  ' + name + '   ' + quote + 'https://example.test/eof';
      assertUnclosedAt(source, 12);
    });
  });

  test('an unclosed quote with a trailing backslash fails locally', () => {
    quoteCases.forEach(({name, quote}) => {
      const source =
        'references\n  ' +
        name +
        ' ' +
        quote +
        'https://example.test/tail' +
        '\\';
      assertUnclosedAt(source, 10);
    });
  });
});

describe('mixin definition parameter boundaries', () => {
  const quoteCases = ["'", '"'];

  function mixinToken(source) {
    const tokens = lex(source, {filename: 'mixin.pg'});
    assertPhysicalTokenLocations(source, tokens, source);
    return tokens.find((tok) => tok.type === 'mixin');
  }

  function assertParameterError(source, code, column) {
    assert.throws(
      () => lex(source, {filename: 'mixin.pg'}),
      (err) => {
        assert.strictEqual(err.code, 'PUGNEUM:' + code);
        assert.deepStrictEqual(
          {line: err.line, column: err.column},
          {line: 1, column},
        );
        return true;
      },
    );
  }

  test('escaped matching quotes decode in defaults before later parameters', () => {
    quoteCases.forEach((quote) => {
      const escaped = 'a' + '\\' + quote + 'b';
      const source =
        'mixin sample(first=' + quote + escaped + quote + ' second=tail)';

      assert.deepStrictEqual(mixinToken(source).args, [
        {name: 'first', default: 'a' + quote + 'b'},
        {name: 'second', default: 'tail'},
      ]);
    });
  });

  test('parentheses inside quoted defaults do not close the parameter list', () => {
    quoteCases.forEach((quote) => {
      const source =
        'mixin sample(first=' + quote + 'a)b(c' + quote + ' second=tail)';

      assert.deepStrictEqual(mixinToken(source).args, [
        {name: 'first', default: 'a)b(c'},
        {name: 'second', default: 'tail'},
      ]);
    });
  });

  test('unclosed quoted defaults fail at their opening delimiter', () => {
    quoteCases.forEach((quote) => {
      const source = 'mixin sample(first=' + quote + 'unterminated)';
      assertParameterError(
        source,
        'INVALID_MIXIN_PARAM',
        source.indexOf(quote) + 1,
      );
    });
  });

  test('an unclosed later default with a trailing escape fails locally', () => {
    quoteCases.forEach((quote) => {
      const source =
        'mixin sample(first=ok second=' + quote + 'unterminated' + '\\' + ')';
      assertParameterError(
        source,
        'INVALID_MIXIN_PARAM',
        source.indexOf(quote) + 1,
      );
    });
  });

  test('a balanced default still requires the parameter-list close', () => {
    const source = "mixin sample(first='ok' second=tail";
    assertParameterError(source, 'NO_END_BRACKET', source.length + 1);
  });
});

describe('multiline attribute error locations', () => {
  function assertEofLocation(source, line, column) {
    assert.throws(
      () => lex(source, {filename: 'attributes.pg'}),
      (err) => {
        assert.strictEqual(err.code, 'PUGNEUM:NO_END_BRACKET');
        assert.deepStrictEqual(
          {line: err.line, column: err.column},
          {line, column},
        );
        return true;
      },
    );
  }

  test('one continuation line reports its physical EOF', () => {
    assertEofLocation('div(a=1\n b=2', 2, 5);
  });

  test('two continuation lines report the last line and column', () => {
    assertEofLocation('div(\n  a0=x\n  a1=x', 3, 7);
  });

  test('three continuation lines do not produce an impossible position', () => {
    assertEofLocation('div(\n  a0=x\n  a1=x\n  a2=x', 4, 7);
  });

  test('CRLF input uses the same normalized physical EOF', () => {
    assertEofLocation('div(\r\n  a0=x\r\n  a1=x', 3, 7);
  });
});

describe('escaped physical newlines in quoted attributes', () => {
  const escapedNewline = '\\' + '\n';

  function attribute(tokens, name) {
    return tokens.find((tok) => tok.type === 'attribute' && tok.name === name);
  }

  test('the value and following attribute retain physical locations', () => {
    const source = 'div(title="a' + escapedNewline + 'b" id=x)\np after';
    const tokens = lex(source, {filename: 'attributes.pg'});
    const title = attribute(tokens, 'title');
    const id = attribute(tokens, 'id');
    const after = tokens.find((tok) => tok.type === 'tag' && tok.val === 'p');

    assert.strictEqual(title.val, 'a' + escapedNewline + 'b');
    assert.deepStrictEqual(title.loc.end, {line: 2, column: 3});
    assert.deepStrictEqual(id.loc.start, {line: 2, column: 4});
    assert.deepStrictEqual(after.loc.start, {line: 3, column: 1});
    assertPhysicalTokenLocations(source, tokens, source);
  });

  test('multiple escaped physical newlines advance cumulatively', () => {
    const source =
      'div(title="a' +
      escapedNewline +
      'b' +
      escapedNewline +
      'c" id=x)\np after';
    const tokens = lex(source, {filename: 'attributes.pg'});
    const id = attribute(tokens, 'id');
    const after = tokens.find((tok) => tok.type === 'tag' && tok.val === 'p');

    assert.deepStrictEqual(id.loc.start, {line: 3, column: 4});
    assert.deepStrictEqual(after.loc.start, {line: 4, column: 1});
    assertPhysicalTokenLocations(source, tokens, source);
  });

  test('a later diagnostic uses its physical line', () => {
    const source = 'div(title="a' + escapedNewline + 'b")\n#';

    assert.throws(
      () => lex(source, {filename: 'attributes.pg'}),
      (err) =>
        err.code === 'PUGNEUM:INVALID_ID' && err.line === 3 && err.column === 1,
    );
  });

  test('a textual backslash-n decodes without advancing a source line', () => {
    const source = 'div(title="a\\nb" id=x)\np after';
    const tokens = lex(source, {filename: 'attributes.pg'});
    const title = attribute(tokens, 'title');
    const id = attribute(tokens, 'id');
    const after = tokens.find((tok) => tok.type === 'tag' && tok.val === 'p');

    assert.strictEqual(title.val, 'a\nb');
    assert.strictEqual(id.loc.start.line, 1);
    assert.deepStrictEqual(after.loc.start, {line: 2, column: 1});
    assertPhysicalTokenLocations(source, tokens, source);
  });
});

describe('variable interpolation validation', () => {
  function assertVariableError(source, code, line, column) {
    assert.throws(
      () => lex(source, {filename: 'variables.pg'}),
      (err) => {
        assert.strictEqual(err.code, 'PUGNEUM:' + code);
        assert.deepStrictEqual(
          {line: err.line, column: err.column},
          {line, column},
        );
        return true;
      },
    );
  }

  test('valid names remain variables in bare, inline, and pipeless forms', () => {
    const sources = ['#{name}', 'p x #{name} y', 'p.\n  before #{name} after'];

    sources.forEach((source) => {
      const tokens = lex(source, {filename: 'variables.pg'});
      assert.ok(
        tokens.some((tok) => tok.type === 'variable' && tok.val === 'name'),
        source,
      );
      assertPhysicalTokenLocations(source, tokens, source);
    });
  });

  test('a bare variable keeps its same-line suffix in inline text context', () => {
    [
      {
        source: 'p#{x} tail',
        types: ['tag', 'variable', 'text', 'eos'],
        text: [' tail'],
      },
      {
        source: 'p#{x}tail',
        types: ['tag', 'variable', 'text', 'eos'],
        text: ['tail'],
      },
      {
        source: 'p#{x}#{y}',
        types: [
          'tag',
          'variable',
          'start-interpolation',
          'variable',
          'end-interpolation',
          'eos',
        ],
        text: [],
      },
    ].forEach(({source, types, text}) => {
      const tokens = lex(source, {filename: 'variables.pg'});
      const meaningful = tokens.filter(
        (tok) => tok.type !== 'text' || tok.val !== '',
      );

      assert.deepStrictEqual(
        meaningful.map((tok) => tok.type),
        types,
      );
      assert.deepStrictEqual(
        meaningful.filter((tok) => tok.type === 'text').map((tok) => tok.val),
        text,
      );
      assertPhysicalTokenLocations(source, tokens, source);
    });
  });

  test('invalid names use the boundary error in every text form', () => {
    const cases = [
      {source: '#{123}', line: 1, column: 1},
      {source: 'p x #{123} y', line: 1, column: 5},
      {source: 'p.\n  before #{bad!} after', line: 2, column: 10},
    ];

    cases.forEach(({source, line, column}) => {
      assertVariableError(source, 'INVALID_VARIABLE_NAME', line, column);
    });
  });

  test('empty names are rejected inline and in pipeless text', () => {
    assertVariableError('p x #{} y', 'INVALID_VARIABLE_NAME', 1, 5);
    assertVariableError(
      'p.\n  before #{} after',
      'INVALID_VARIABLE_NAME',
      2,
      10,
    );
  });

  test('unclosed variables report their opener in every text form', () => {
    const cases = [
      {source: '#{open', line: 1, column: 1},
      {source: 'p x #{open', line: 1, column: 5},
      {source: 'p.\n  x #{open', line: 2, column: 5},
    ];

    cases.forEach(({source, line, column}) => {
      assertVariableError(source, 'NO_END_BRACKET', line, column);
    });
  });

  test('one backslash keeps malformed variable syntax literal', () => {
    const sources = ['p x \\#{123} y', 'p.\n  \\#{open'];

    sources.forEach((source) => {
      const tokens = lex(source, {filename: 'variables.pg'});
      const text = tokens
        .filter((tok) => tok.type === 'text')
        .map((tok) => tok.val)
        .join('');

      assert.ok(!text.includes('\\#{'), source);
      assert.ok(text.includes('#{'), source);
      assert.ok(!tokens.some((tok) => tok.type === 'variable'), source);
      assertPhysicalTokenLocations(source, tokens, source);
    });
  });

  test('literal filter data does not activate variable validation', () => {
    const source = ':verbatim\n  #{123}\n  \\#{open';
    const tokens = lex(source, {filename: 'variables.pg'});
    const text = tokens
      .filter((tok) => tok.type === 'text')
      .map((tok) => tok.val);

    assert.deepStrictEqual(text, ['#{123}', '\\#{open']);
    assert.ok(!tokens.some((tok) => tok.type === 'variable'));
    assertPhysicalTokenLocations(source, tokens, source);
  });
});

describe('warnings option validation', () => {
  const warningSource = 'a(href=‘/x’)';

  function invalidCollectors() {
    const fixedLength = [];
    Object.defineProperty(fixedLength, 'length', {writable: false});
    return [{}, {push() {}}, new Set(), Object.freeze([]), fixedLength];
  }

  function assertInvalidCollector(source, warnings) {
    assert.throws(
      () => lex(source, {filename: 'warnings.pg', warnings}),
      (err) =>
        err.code === undefined &&
        err.message === 'Expected "options.warnings" to be a mutable array',
    );
  }

  test('invalid collectors fail before warning-free source is lexed', () => {
    invalidCollectors().forEach((warnings) => {
      assertInvalidCollector('p clean', warnings);
    });
  });

  test('warning-producing source gets the same construction error', () => {
    invalidCollectors().forEach((warnings) => {
      assertInvalidCollector(warningSource, warnings);
    });
  });

  test('an extensible array remains the caller-owned collector', () => {
    const warnings = [];

    lex(warningSource, {filename: 'warnings.pg', warnings});

    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].code, 'PUGNEUM:TYPOGRAPHIC_QUOTE_DELIMITER');
  });
});

describe('typographic quote warnings in attributes', () => {
  const LSQUO = '‘';
  const RSQUO = '’';
  const LDQUO = '“';
  const RDQUO = '”';
  const VALUE_WARNING =
    'Unicode typographic quote ‘ (U+2018) is not an attribute value delimiter; ' +
    'the value is used literally, which usually produces broken output. Use a ' +
    'straight quote (\' or ") or remove the quotes — your editor may have ' +
    'auto-replaced them.';
  const NAME_WARNING =
    'Unicode typographic quote ‘ (U+2018) is not an attribute name delimiter; ' +
    'the name is used literally, which usually produces broken output. Use a ' +
    'straight quote (\' or ") or remove the quotes — your editor may have ' +
    'auto-replaced them.';

  function attr(tokens, name) {
    return tokens.find((tok) => tok.type === 'attribute' && tok.name === name);
  }

  test('smart single quotes around a value warn and keep the value literal', () => {
    const warnings = [];
    const tokens = lex('a(href=' + LSQUO + '/x' + RSQUO + ')', {
      filename: 'smart.pg',
      warnings,
    });
    assert.strictEqual(attr(tokens, 'href').val, LSQUO + '/x' + RSQUO);
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].code, 'PUGNEUM:TYPOGRAPHIC_QUOTE_DELIMITER');
    assert.strictEqual(warnings[0].msg, VALUE_WARNING);
    assert.strictEqual(warnings[0].line, 1);
    assert.strictEqual(warnings[0].filename, 'smart.pg');
  });

  test('smart double quotes around a value warn and keep the value literal', () => {
    const warnings = [];
    const tokens = lex('a(href=' + LDQUO + '/x' + RDQUO + ')', {
      filename: 'smart.pg',
      warnings,
    });
    assert.strictEqual(attr(tokens, 'href').val, LDQUO + '/x' + RDQUO);
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].code, 'PUGNEUM:TYPOGRAPHIC_QUOTE_DELIMITER');
  });

  test('a lone right single quote on both sides still warns', () => {
    const warnings = [];
    lex('a(href=' + RSQUO + '/x' + RSQUO + ')', {
      filename: 'smart.pg',
      warnings,
    });
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].code, 'PUGNEUM:TYPOGRAPHIC_QUOTE_DELIMITER');
  });

  test('ASCII straight quotes produce no warning', () => {
    const warnings = [];
    lex('a(href=\'/x\' class="y")', {filename: 'ascii.pg', warnings});
    assert.strictEqual(warnings.length, 0);
  });

  test('a smart quote inside an ASCII-quoted value is content, not a delimiter, and does not warn', () => {
    const warnings = [];
    const tokens = lex('a(title="Baby' + RSQUO + 's GC")', {
      filename: 'content.pg',
      warnings,
    });
    assert.strictEqual(attr(tokens, 'title').val, 'Baby' + RSQUO + 's GC');
    assert.strictEqual(warnings.length, 0);
  });

  test('warnings collector is optional (no throw when omitted)', () => {
    assert.doesNotThrow(() =>
      lex('a(href=' + LSQUO + '/x' + RSQUO + ')', {filename: 'smart.pg'}),
    );
  });

  test('warnings from nested inline content propagate to the shared collector', () => {
    const warnings = [];
    lex('p text !(/img.png alt)(title=' + LSQUO + 'x' + RSQUO + ') more', {
      filename: 'inline.pg',
      warnings,
    });
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].code, 'PUGNEUM:TYPOGRAPHIC_QUOTE_DELIMITER');
  });

  test('smart quotes around an attribute name warn (the broken name is otherwise silent)', () => {
    const warnings = [];
    const tokens = lex('a(' + LSQUO + 'data-x' + RSQUO + '=y)', {
      filename: 'key.pg',
      warnings,
    });
    // The smart quotes survive as part of the (broken) attribute name.
    assert.ok(attr(tokens, LSQUO + 'data-x' + RSQUO));
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].code, 'PUGNEUM:TYPOGRAPHIC_QUOTE_DELIMITER');
    assert.strictEqual(warnings[0].msg, NAME_WARNING);
  });
});

describe('non-ASCII whitespace in indentation', () => {
  const NBSP = ' ';

  [
    ['NEXT LINE', '\u0085', 'U+0085'],
    ['LINE SEPARATOR', '\u2028', 'U+2028'],
    ['PARAGRAPH SEPARATOR', '\u2029', 'U+2029'],
  ].forEach(([name, separator, codepoint]) => {
    test(name + ' in indentation names its codepoint', () => {
      assert.throws(
        () => lex('ul\n' + separator + 'li x', {filename: 't.pg'}),
        (err) => {
          assert.strictEqual(err.code, 'PUGNEUM:NON_ASCII_WHITESPACE');
          assert.match(err.msg, /Unexpected non-ASCII whitespace/);
          assert.ok(err.msg.includes(codepoint));
          return true;
        },
      );
    });
  });

  test('NBSP used as indentation throws a clear NON_ASCII_WHITESPACE error', () => {
    assert.throws(
      () => lex('ul\n' + NBSP + NBSP + 'li x', {filename: 't.pg'}),
      (err) => err.code === 'PUGNEUM:NON_ASCII_WHITESPACE',
    );
  });

  test('NBSP after a leading space also throws NON_ASCII_WHITESPACE', () => {
    assert.throws(
      () => lex('ul\n ' + NBSP + 'li x', {filename: 't.pg'}),
      (err) => err.code === 'PUGNEUM:NON_ASCII_WHITESPACE',
    );
  });

  test('the error message names the offending codepoint', () => {
    assert.throws(
      () => lex('ul\n' + NBSP + 'li x', {filename: 't.pg'}),
      (err) => /U\+00A0/.test(err.msg),
    );
  });

  test('NBSP inside text content is left alone (no error)', () => {
    assert.doesNotThrow(() =>
      lex('p hello' + NBSP + 'world', {filename: 't.pg'}),
    );
  });
});

describe('bare # / . error contract', () => {
  // Regression: a bare '#' at end of line/input used to throw an uncaught
  // V8 TypeError (null[0]) instead of a PUGNEUM-coded error, breaking the
  // error contract the pipeline and the error-test harness rely on.
  test('bare # at end of input throws PUGNEUM:INVALID_ID, not a TypeError', () => {
    assert.throws(
      () => lex('#', {filename: 't.pg'}),
      (err) => err.code === 'PUGNEUM:INVALID_ID',
    );
  });

  test('tag followed by empty id (div#) throws PUGNEUM:INVALID_ID', () => {
    assert.throws(
      () => lex('div#', {filename: 't.pg'}),
      (err) => err.code === 'PUGNEUM:INVALID_ID',
    );
  });

  test('# then newline throws PUGNEUM:INVALID_ID', () => {
    assert.throws(
      () => lex('#\np x', {filename: 't.pg'}),
      (err) => err.code === 'PUGNEUM:INVALID_ID',
    );
  });
});

describe('addText escaped-run performance', () => {
  // Regression: N adjacent escaped sequences on one line scanned O(N^2) bytes
  // because findEarliestCandidate ran a separate full-tail indexOf per
  // construct and was re-invoked once per escape. ~40 KB of '\\' previously
  // took tens of seconds; the single-pass scanner must make it near-instant.
  test('a long run of escaped backslashes lexes in linear time', () => {
    const input = 'p ' + '\\\\'.repeat(40000);
    const start = process.hrtime.bigint();
    const tokens = lex(input, {filename: 'stress.pg'});
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    // Generous budget: the quadratic version blew past this by orders of
    // magnitude (>>1s at this size), while the linear version is a few ms.
    assert.ok(ms < 2000, 'lexing 40k escapes took ' + ms.toFixed(0) + 'ms');
    const text = tokens
      .filter((t) => t.type === 'text')
      .map((t) => t.val)
      .join('');
    // 40000 literal backslashes survive (no doubling, no shorthand firing).
    assert.strictEqual((text.match(/\\/g) || []).length, 40000);
  });
});

describe('footnote reference bracket parsing', () => {
  // Regression: interpolationsAreClosed treated a bare '[' inside an open ^[
  // as a nested bracket (needing a second ']'), while parseBracketContent (the
  // real parser) closes ^[...] at the first ']'. That made a footnote with bare
  // brackets merge the following pipeless line, diverging from the inline form.
  test('inline ^[ with a bare bracket closes at the first ]', () => {
    const tokens = lex('p ^[note [x] tail]', {filename: 't.pg'});
    const ref = tokens.find((t) => t.type === 'start-footnote-ref');
    assert.ok(ref);
    assert.strictEqual(ref.val, 'note [x');
  });

  test('pipeless ^[ with a bare bracket does NOT swallow the next line', () => {
    // Line 1 contains a ']' that closes the footnote at the first bracket.
    // With the old merge detector the bare '[' bumped a nested-bracket counter,
    // so the ']' only balanced that counter and the footnote looked unclosed,
    // wrongly merging line 2 (and its newline) into the footnote line.
    const src = 'div.\n  pre ^[note [x] more\n  next line';
    const tokens = lex(src, {filename: 't.pg'});
    const ref = tokens.find((t) => t.type === 'start-footnote-ref');
    assert.ok(ref);
    // Same footnote name as the inline form (closes at the first ']').
    assert.strictEqual(ref.val, 'note [x');
    // The two pipeless lines stay separate: a newline token sits between them
    // and the second line survives as its own text token. (Under the bug the
    // lines were merged, so there was no separating newline.)
    const texts = tokens.filter((t) => t.type === 'text').map((t) => t.val);
    assert.ok(texts.includes('next line'));
    const newlines = tokens.filter((t) => t.type === 'newline');
    assert.strictEqual(newlines.length, 1);
  });
});

describe('footnote definition source locations', () => {
  // Regression: footnotesBlock emitted def tokens lazily after incrementLine
  // had already advanced, tagging every footnote-def-start/text with the
  // FOLLOWING line and column 1. They must carry the line/column they
  // physically occupy (same discipline as referencesBlock).
  test('footnote-def tokens carry their physical line and column', () => {
    const src = 'footnotes\n  fn1 first\n  fn2 second';
    const tokens = lex(src, {filename: 't.pg'});
    const defs = tokens.filter((t) => t.type === 'footnote-def-start');
    assert.strictEqual(defs.length, 2);
    // 'fn1' is on source line 2, starting at column 3 (after two-space indent).
    assert.strictEqual(defs[0].val, 'fn1');
    assert.strictEqual(defs[0].loc.start.line, 2);
    assert.strictEqual(defs[0].loc.start.column, 3);
    // 'fn2' is on source line 3, column 3.
    assert.strictEqual(defs[1].val, 'fn2');
    assert.strictEqual(defs[1].loc.start.line, 3);
    assert.strictEqual(defs[1].loc.start.column, 3);
  });
});

describe('given keyword column accounting', () => {
  // Regression: given() hard-coded len = 'given '.length + name.length, so
  // extra spaces between the keyword and the name gave a short loc.end.column.
  test('extra spaces before the name yield an accurate end column', () => {
    const tokens = lex('given   source\n  p text', {filename: 't.pg'});
    const givenTok = tokens.find((t) => t.type === 'given');
    assert.ok(givenTok);
    // 'given' (5) + 3 spaces + 'source' (6): name ends one past col 14 => 15.
    assert.strictEqual(givenTok.loc.end.column, 15);
  });

  test('single space still ends right after the name', () => {
    const tokens = lex('given source\n  p text', {filename: 't.pg'});
    const givenTok = tokens.find((t) => t.type === 'given');
    assert.strictEqual(givenTok.loc.end.column, 13);
  });
});
