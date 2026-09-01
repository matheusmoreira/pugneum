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

describe('expression group boundary helper', () => {
  test('uses the lexer attribute grammar at arbitrary offsets', () => {
    const source = 'prefix(title="a)b" nested=(x)) suffix';
    const start = source.indexOf('(');

    assert.strictEqual(
      lex.scanExpressionGroup(source, start),
      source.indexOf(' suffix'),
    );
  });

  test('treats backslashes outside quotes as ordinary bytes', () => {
    const source = '(title=x\\)) suffix';

    assert.strictEqual(
      lex.scanExpressionGroup(source, 0),
      source.indexOf(')') + 1,
    );
  });

  test('returns -1 for a missing opener or closer', () => {
    assert.strictEqual(lex.scanExpressionGroup('plain text', 0), -1);
    assert.strictEqual(lex.scanExpressionGroup('(title="open', 0), -1);
  });
});

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

describe('public argument boundary', () => {
  [
    ['undefined', undefined],
    ['null', null],
    ['boolean', true],
    ['number', 1],
    ['array', []],
    ['object', {}],
    ['Buffer', Buffer.from('p text')],
    ['symbol', Symbol('source')],
    ['bigint', 1n],
  ].forEach(([label, source]) => {
    test('rejects ' + label + ' source with the stable message', () => {
      assert.throws(
        () => lex(source),
        new Error(
          'Expected source code to be a string but got "' + typeof source + '"',
        ),
      );
    });
  });

  test('omitted and null options retain the supported defaults', () => {
    [undefined, null].forEach((options) => {
      const tokens =
        options === undefined ? lex('p text') : lex('p text', options);
      assert.deepStrictEqual(
        tokens.map((token) => token.type),
        ['tag', 'text', 'eos'],
      );
      tokens.forEach((token) => {
        assert.strictEqual(token.loc.filename, undefined);
      });
    });
  });

  [
    ['false', false],
    ['true', true],
    ['zero', 0],
    ['one', 1],
    ['NaN', NaN],
    ['empty string', ''],
    ['nonempty string', 'options'],
    ['symbol', Symbol('options')],
    ['bigint', 1n],
    ['array', []],
    ['function', () => {}],
  ].forEach(([label, options]) => {
    test('rejects ' + label + ' as options', () => {
      assert.throws(
        () => lex('p text', options),
        new Error(
          'Expected "options" to be an object but got "' + typeof options + '"',
        ),
      );
    });
  });
});

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

describe('successful optional syntax forms', () => {
  test('abbreviation without expansion emits exact text and no title', () => {
    const source = 'p ?(HTML)';
    const tokens = lex(source, {filename: 'positive.pg'});

    assert.deepStrictEqual(
      tokens.map((token) => token.type),
      [
        'tag',
        'text',
        'start-interpolation',
        'tag',
        'text',
        'end-interpolation',
        'text',
        'eos',
      ],
    );
    assert.deepStrictEqual(tokens[3], {
      type: 'tag',
      loc: {
        start: {line: 1, column: 5},
        filename: 'positive.pg',
        end: {line: 1, column: 5},
      },
      val: 'abbr',
    });
    assert.deepStrictEqual(tokens[4], {
      type: 'text',
      loc: {
        start: {line: 1, column: 5},
        filename: 'positive.pg',
        end: {line: 1, column: 9},
      },
      val: 'HTML',
    });
    assert.ok(!tokens.some((token) => token.type === 'attribute'));
    assertPhysicalTokenLocations(source, tokens, source);
  });

  test('quoted spaced reference URLs preserve default text and location', () => {
    ["'", '"'].forEach((quote) => {
      const source =
        'references\n  docs ' +
        quote +
        '/path with spaces' +
        quote +
        ' default docs';
      const tokens = lex(source, {filename: 'positive.pg'});
      const definition = tokens.find((token) => token.type === 'ref-def');

      assert.deepStrictEqual(definition, {
        type: 'ref-def',
        loc: {
          start: {line: 2, column: 3},
          filename: 'positive.pg',
          end: {line: 2, column: 40},
        },
        name: 'docs',
        url: '/path with spaces',
        defaultText: 'default docs',
      });
      assertPhysicalTokenLocations(source, tokens, source);
    });
  });

  test('unquoted reference URLs retain following default text', () => {
    const source = 'references\n  docs /plain default docs';
    const tokens = lex(source, {filename: 'positive.pg'});
    const definition = tokens.find((token) => token.type === 'ref-def');

    assert.deepStrictEqual(definition, {
      type: 'ref-def',
      loc: {
        start: {line: 2, column: 3},
        filename: 'positive.pg',
        end: {line: 2, column: 27},
      },
      name: 'docs',
      url: '/plain',
      defaultText: 'default docs',
    });
    assertPhysicalTokenLocations(source, tokens, source);
  });
});

test('exported attribute-name validation matches lexer boundaries', () => {
  const accepted = ['data-value', 'foo.bar', 'data:x', '@x', '_x', '-x'];
  const rejected = ['x/y', 'x>y', 'x\0y', '', 'two words'];

  accepted.forEach((name) => {
    assert.strictEqual(lex.isValidAttributeName(name), true, name);
    const attribute = lex('div(' + name + '=value)').find(
      (token) => token.type === 'attribute',
    );
    assert.deepStrictEqual(
      {name: attribute.name, val: attribute.val},
      {name, val: 'value'},
    );
  });
  rejected.forEach((name) => {
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

function captureLexerError(source, filename) {
  try {
    lex(source, {filename});
  } catch (error) {
    if (
      !error ||
      typeof error.code !== 'string' ||
      !error.code.startsWith('PUGNEUM:')
    ) {
      throw error;
    }
    return error;
  }
  assert.fail('Expected ' + filename + ' to throw a PUGNEUM error.');
}

function assertLexerErrorEnvelope(error, source, filename) {
  var json = {
    code: error.code,
    msg: error.msg,
    line: error.line,
    column: error.column,
    filename,
  };

  assert.ok(error instanceof Error);
  assert.strictEqual(error.filename, filename);
  assert.strictEqual(error.source, source);
  assert.deepStrictEqual(error.toJSON(), json);
  assert.strictEqual(JSON.stringify(error), JSON.stringify(json));
  assert.ok(
    error.message.startsWith(
      filename + ':' + error.line + ':' + error.column + '\n',
    ),
  );
  assert.ok(
    error.message
      .split('\n')
      .some((line) => line.includes('> ' + error.line + '|')),
  );
  assert.ok(error.message.split('\n').some((line) => line.endsWith('^')));
  assert.ok(error.message.endsWith('\n\n' + error.msg));
}

function assertLexerDiagnostic(source, expected) {
  var filename = expected.filename || 'diagnostic.pg';
  var error = captureLexerError(source, filename);

  assertLexerErrorEnvelope(error, source, filename);
  assert.deepStrictEqual(
    {
      code: error.code,
      msg: error.msg,
      line: error.line,
      column: error.column,
    },
    {
      code: 'PUGNEUM:' + expected.code,
      msg: expected.msg,
      line: expected.line,
      column: expected.column,
    },
  );
  return error;
}

fs.readdirSync(edir).forEach(function (testCase) {
  if (/\.pg$/.test(testCase)) {
    test(testCase, (t) => {
      var source = fs.readFileSync(edir + testCase, 'utf8');
      var error = captureLexerError(source, testCase);
      assertLexerErrorEnvelope(error, source, testCase);
      var actual = {
        msg: error.msg,
        code: error.code,
        line: error.line,
        column: error.column,
      };
      t.assert.snapshot(actual);
    });
  }
});

describe('complete diagnostic contract', () => {
  test('one public error has an independently pinned full message', () => {
    var error = assertLexerDiagnostic('#ä', {
      filename: 'invalid-id-non-ascii.pg',
      code: 'INVALID_ID',
      msg: '"ä" is not a valid ID.',
      line: 1,
      column: 1,
    });

    assert.strictEqual(
      error.message,
      'invalid-id-non-ascii.pg:1:1\n  > 1| #ä\n-------^\n\n"ä" is not a valid ID.',
    );
  });

  [
    {
      name: 'mismatched attribute nesting',
      source: 'div(foo=[bar})',
      code: 'INCORRECT_NESTING',
      msg: 'Nesting must match on expression `foo=[bar}`',
      line: 1,
      column: 5,
    },
    {
      name: 'mixed indentation',
      source: 'ul\n  li one\n \tli two',
      code: 'INVALID_INDENTATION',
      msg: 'Invalid indentation, you can use tabs or spaces but not both',
      line: 3,
      column: 1,
    },
    {
      name: 'text after a quoted attribute value',
      source: 'div(foo="bar"x)',
      code: 'MALFORMED_ATTRIBUTE',
      msg: 'Invalid code point after attribute value: `x`',
      line: 1,
      column: 14,
    },
    {
      name: 'attribute-shaped extends syntax',
      source: 'extends(foo)',
      code: 'MALFORMED_EXTENDS',
      msg: 'malformed extends',
      line: 1,
      column: 8,
    },
    {
      name: 'reference definition missing its URL',
      source: 'references\n  docs',
      code: 'INVALID_REF_DEF',
      msg: 'Reference definition requires both a name and a URL: docs',
      line: 2,
      column: 3,
    },
    {
      name: 'reference definition with an empty quoted URL',
      source: 'references\n  docs ""',
      code: 'INVALID_REF_DEF',
      msg: 'Reference definition requires a non-empty URL: docs ""',
      line: 2,
      column: 3,
    },
    {
      name: 'unclosed tag attributes',
      source: 'div(foo=bar',
      code: 'NO_END_BRACKET',
      msg: 'The end of the string reached with no closing bracket ) found.',
      line: 1,
      column: 12,
    },
    {
      name: 'unclosed link shorthand',
      source: 'p @(url',
      code: 'NO_END_BRACKET',
      msg: 'End of line reached with no closing ) for @() link shorthand.',
      line: 1,
      column: 3,
    },
    {
      name: 'unclosed image shorthand',
      source: 'p !(url',
      code: 'NO_END_BRACKET',
      msg: 'End of line reached with no closing ) for !() image shorthand.',
      line: 1,
      column: 3,
    },
    {
      name: 'unclosed image attributes',
      source: 'p !(url)(class=x',
      code: 'NO_END_BRACKET',
      msg: 'End of line reached with no closing ) for !() image attributes.',
      line: 1,
      column: 3,
    },
    {
      name: 'unclosed simple inline shorthand',
      source: 'p *(text',
      code: 'NO_END_BRACKET',
      msg: 'End of line reached with no closing ) for *() strong shorthand.',
      line: 1,
      column: 3,
    },
    {
      name: 'unclosed code shorthand',
      source: 'p `(text',
      code: 'NO_END_BRACKET',
      msg: 'End of line reached with no closing ) for `() code shorthand.',
      line: 1,
      column: 3,
    },
    {
      name: 'unclosed reference link',
      source: 'p @[docs',
      code: 'NO_END_BRACKET',
      msg: 'End of line reached with no closing ] for @[] reference link.',
      line: 1,
      column: 3,
    },
    {
      name: 'unclosed reference image',
      source: 'p ![logo',
      code: 'NO_END_BRACKET',
      msg: 'End of line reached with no closing ] for ![] reference image.',
      line: 1,
      column: 3,
    },
    {
      name: 'unclosed footnote reference',
      source: 'p ^[note',
      code: 'NO_END_BRACKET',
      msg: 'End of line reached with no closing ] for ^[] footnote reference.',
      line: 1,
      column: 3,
    },
    {
      name: 'unclosed reference-link attributes',
      source: 'p @[docs](class=x',
      code: 'NO_END_BRACKET',
      msg: 'The end of the string reached with no closing bracket ) found.',
      line: 1,
      column: 18,
    },
    {
      name: 'unclosed reference-image attributes',
      source: 'p ![logo](class=x',
      code: 'NO_END_BRACKET',
      msg: 'The end of the string reached with no closing bracket ) found.',
      line: 1,
      column: 18,
    },
    {
      name: 'unclosed mixin call arguments',
      source: '+thing(arg',
      code: 'NO_END_BRACKET',
      msg: 'End of source reached with no closing ) for mixin call arguments.',
      line: 1,
      column: 11,
    },
  ].forEach((diagnostic) => {
    test(diagnostic.name, () => {
      assertLexerDiagnostic(diagnostic.source, diagnostic);
    });
  });
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

describe('tag-name boundary', () => {
  for (const [source, column] of [
    ['1card Hello', 1],
    ['_panel Hello', 1],
    ['\\1card Hello', 2],
    ['p #(1shape Hello)', 5],
  ]) {
    test('rejects a non-letter start in ' + JSON.stringify(source), () => {
      assertLexerDiagnostic(source, {
        code: 'INVALID_TAG_NAME',
        msg: 'Tag names must start with an ASCII letter',
        line: 1,
        column,
      });
    });
  }

  test('keeps supported custom-element and namespace-style names', () => {
    for (const name of ['x-card', 'svg:path', 'A1_b']) {
      const token = lex(name, {filename: 'tag-name.pg'}).find(
        (candidate) => candidate.type === 'tag',
      );
      assert.strictEqual(token.val, name);
    }
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

describe('attribute interpolation escape provenance', () => {
  const interpolationSource = Symbol.for(
    'pugneum.attributeInterpolationSource',
  );

  function attributeToken(source) {
    return lex(source, {filename: 'attributes.pg'}).find(
      (tok) => tok.type === 'attribute',
    );
  }

  test('keeps cooked values public while retaining raw slash parity privately', () => {
    for (let count = 0; count <= 4; count++) {
      const slashes = '\\'.repeat(count);
      const token = attributeToken('div(data-x="' + slashes + '#{x}")');
      const retained = token[interpolationSource];

      assert.strictEqual(
        token.val,
        '\\'.repeat(Math.ceil(count / 2)) + '#{x}',
        count + ' cooked source backslashes',
      );
      assert.strictEqual(
        retained === undefined ? token.val : retained,
        slashes + '#{x}',
        count + ' retained source backslashes',
      );
      if (retained !== undefined) {
        assert.strictEqual(
          Object.getOwnPropertyDescriptor(token, interpolationSource)
            .enumerable,
          false,
        );
      }
    }
  });

  test('retains parity for generated shorthand attributes', () => {
    const slashes = '\\\\';
    const tokens = lex(
      'p @(' +
        slashes +
        '#{x} label) !(' +
        slashes +
        '#{x} ' +
        slashes +
        '#{x}) ?(abbr ' +
        slashes +
        '#{x})',
      {filename: 'attributes.pg'},
    );
    const attributes = tokens.filter((tok) => tok.type === 'attribute');

    assert.deepStrictEqual(
      attributes.map((token) => token.val),
      ['\\#{x}', '\\#{x}', '\\#{x}', '\\#{x}'],
    );
    assert.deepStrictEqual(
      attributes.map((token) => token[interpolationSource]),
      [slashes + '#{x}', slashes + '#{x}', slashes + '#{x}', slashes + '#{x}'],
    );
  });

  test('decodes a long non-interpolating slash run in linear time', () => {
    const slashes = '\\'.repeat(40000);
    const start = process.hrtime.bigint();
    const token = attributeToken('div(data-x="' + slashes + 'tail")');
    const ms = Number(process.hrtime.bigint() - start) / 1e6;

    assert.ok(ms < 2000, 'lexing 40k slashes took ' + ms.toFixed(0) + 'ms');
    assert.strictEqual(token.val, '\\'.repeat(20000) + 'tail');
    assert.strictEqual(token[interpolationSource], undefined);
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

  test('NBSP inside text content is preserved byte-for-byte', () => {
    const tokens = lex('p hello' + NBSP + 'world', {filename: 't.pg'});
    const text = tokens.filter((token) => token.type === 'text');

    assert.deepStrictEqual(text, [
      {
        type: 'text',
        loc: {
          start: {line: 1, column: 3},
          filename: 't.pg',
          end: {line: 1, column: 14},
        },
        val: 'hello' + NBSP + 'world',
      },
    ]);
  });
});

describe('id and dot/class shorthand boundaries', () => {
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

  test('a bare dot is the pipeless-text marker, not an empty class', () => {
    const tokens = lex('.', {filename: 'dot.pg'});
    assert.deepStrictEqual(
      tokens.map((token) => ({
        type: token.type,
        val: token.val,
        start: token.loc.start,
        end: token.loc.end,
      })),
      [
        {
          type: 'dot',
          val: undefined,
          start: {line: 1, column: 1},
          end: {line: 1, column: 2},
        },
        {
          type: 'eos',
          val: undefined,
          start: {line: 1, column: 2},
          end: {line: 1, column: 2},
        },
      ],
    );
  });

  test('a dot followed by a valid name is a class shorthand', () => {
    const tokens = lex('.card', {filename: 'dot.pg'});
    assert.deepStrictEqual(
      tokens.map((token) => [token.type, token.val]),
      [
        ['class', 'card'],
        ['eos', undefined],
      ],
    );
  });

  [
    ['leading digit', '.95'],
    ['lone hyphen', '.-'],
    ['non-ASCII letter', '.ä'],
  ].forEach(([label, source]) => {
    test('rejects class shorthand with ' + label, () => {
      assert.throws(
        () => lex(source, {filename: 'dot.pg'}),
        (err) => err.code === 'PUGNEUM:INVALID_CLASS_NAME',
      );
    });
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

describe('successful shorthand scaling', () => {
  function normalizedSourceWork(source) {
    const originalReplace = String.prototype.replace;
    let normalizedUnits = 0;
    let tokens;

    String.prototype.replace = function (pattern, replacement) {
      if (
        pattern instanceof RegExp &&
        pattern.source === '\\r\\n|\\r' &&
        pattern.flags === 'g' &&
        replacement === '\n'
      ) {
        normalizedUnits += String(this).length;
      }
      return Reflect.apply(originalReplace, this, arguments);
    };
    try {
      tokens = lex(source, {filename: 'scaling.pg'});
    } finally {
      String.prototype.replace = originalReplace;
    }
    return {normalizedUnits, tokens};
  }

  test('dense direct inline tags normalize only linear source volume', () => {
    function measure(count) {
      const source = 'p ' + '#(em x)'.repeat(count);
      const result = normalizedSourceWork(source);

      assert.strictEqual(
        result.tokens.filter(
          (token) => token.type === 'tag' && token.val === 'em',
        ).length,
        count,
      );
      return result.normalizedUnits;
    }

    const small = measure(200);
    const large = measure(400);
    assert.ok(
      large <= small * 2.2,
      'doubling input normalized ' + large + ' units after ' + small,
    );
  });
});

test('ordinary tag lines skip impossible recognizer families', () => {
  const originalExec = RegExp.prototype.exec;
  const lineCount = 100;
  let regexpCalls = 0;
  let tokens;

  RegExp.prototype.exec = function (input) {
    regexpCalls++;
    return Reflect.apply(originalExec, this, arguments);
  };
  try {
    tokens = lex('p x\n'.repeat(lineCount), {filename: 'dispatch.pg'});
  } finally {
    RegExp.prototype.exec = originalExec;
  }

  assert.strictEqual(tokens.length, lineCount * 3 + 1);
  assert.ok(
    regexpCalls <= lineCount * 10,
    lineCount + ' simple lines ran ' + regexpCalls + ' regular expressions',
  );
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
