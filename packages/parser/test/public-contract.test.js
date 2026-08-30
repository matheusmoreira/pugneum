'use strict';

var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var {test} = require('node:test');
var lex = require('pugneum-lexer');
var parse = require('../');

var packageRoot = path.resolve(__dirname, '..');
var repositoryRoot = path.resolve(packageRoot, '../..');
var testCasesRoot = path.join(repositoryRoot, 'test-cases');
var manifest = require('../../../test-cases/manifest.json');
var readme = fs.readFileSync(path.join(packageRoot, 'README.md'), 'utf8');

var nodeShapes = {
  Block: ['filename,line,nodes,type'],
  BlockComment: ['block,buffer,column,filename,line,type,val'],
  Comment: ['buffer,column,filename,line,type,val'],
  Extends: ['column,file,filename,line,type'],
  FileReference: ['column,filename,line,path,type'],
  Filter: ['attrs,block,column,filename,line,name,type'],
  FootnoteRef: ['column,filename,line,name,type'],
  Footnotes: ['column,definitions,filename,line,type'],
  Given: ['block,column,filename,line,name,type'],
  Include: ['block,column,file,filename,line,type'],
  IncludeFilter: ['attrs,column,filename,line,name,type'],
  InterpolatedTag: [
    'attributeBlocks,attrs,block,column,expr,filename,isInline,line,type',
    'attributeBlocks,attrs,block,column,expr,filename,isInline,line,textOnly,type',
  ],
  Mixin: [
    'args,attributeBlocks,attrs,block,call,column,filename,line,name,type',
    'args,attributeBlocks,attrs,block,call,column,filename,line,name,textOnly,type',
    'args,block,call,column,filename,line,name,type,usesNamedBlocks,usesUnnamedBlock',
  ],
  MixinBlock: ['column,filename,line,type'],
  NamedBlock: ['column,filename,line,mode,name,nodes,type'],
  RawInclude: ['column,file,filename,filters,line,type'],
  ReferenceImage: ['attrs,block,column,filename,line,name,type'],
  ReferenceLink: ['attrs,block,column,filename,line,name,type'],
  References: ['column,definitions,filename,line,type'],
  Tag: [
    'attributeBlocks,attrs,block,column,filename,isInline,line,name,type',
    'attributeBlocks,attrs,block,column,filename,isInline,line,name,textOnly,type',
  ],
  Text: ['column,filename,line,type,val'],
  Toc: ['column,filename,line,type'],
  Variable: ['column,filename,line,name,type'],
  YieldBlock: ['column,filename,line,type'],
};

var recordNames = [
  'Attribute',
  'FootnoteDefinition',
  'MixinParameter',
  'ReferenceDefinition',
];

function markdownSection(startHeading, endHeading) {
  var start = readme.indexOf(startHeading);
  assert.notStrictEqual(start, -1, 'missing README heading ' + startHeading);
  var end = readme.indexOf(endHeading, start + startHeading.length);
  assert.notStrictEqual(end, -1, 'missing README heading ' + endHeading);
  return readme.slice(start, end);
}

function firstColumnNames(section) {
  return Array.from(
    section.matchAll(/^\| `([A-Za-z]+)` \|/gm),
    (match) => match[1],
  ).sort();
}

function assertLocation(value, filename, hasColumn) {
  assert.ok(
    Number.isInteger(value.line),
    value.type + '.line must be an integer',
  );
  assert.strictEqual(value.filename, filename);
  if (hasColumn) {
    assert.ok(
      Number.isInteger(value.column),
      value.type + '.column must be an integer',
    );
  } else {
    assert.ok(!Object.hasOwn(value, 'column'));
  }
}

function assertRecordLocation(value, filename) {
  assert.ok(Number.isInteger(value.line));
  assert.ok(Number.isInteger(value.column));
  assert.strictEqual(value.filename, filename);
}

function assertAttributes(attrs, filename) {
  assert.ok(Array.isArray(attrs));
  attrs.forEach((attr) => {
    assert.deepStrictEqual(Object.keys(attr).sort(), [
      'column',
      'filename',
      'line',
      'name',
      'val',
    ]);
    assert.strictEqual(typeof attr.name, 'string');
    assert.ok(typeof attr.val === 'string' || attr.val === true);
    assertRecordLocation(attr, filename);
  });
}

function assertDefinitions(node, filename) {
  assert.ok(Array.isArray(node.definitions));
  if (node.type === 'References') {
    node.definitions.forEach((definition) => {
      assert.deepStrictEqual(Object.keys(definition).sort(), [
        'column',
        'defaultText',
        'filename',
        'line',
        'name',
        'url',
      ]);
      assert.strictEqual(typeof definition.name, 'string');
      assert.strictEqual(typeof definition.url, 'string');
      assert.ok(
        typeof definition.defaultText === 'string' ||
          definition.defaultText === null,
      );
      assertRecordLocation(definition, filename);
    });
  } else {
    node.definitions.forEach((definition) => {
      assert.deepStrictEqual(Object.keys(definition).sort(), [
        'block',
        'column',
        'filename',
        'line',
        'name',
      ]);
      assert.strictEqual(typeof definition.name, 'string');
      assert.strictEqual(definition.block.type, 'Block');
      assertRecordLocation(definition, filename);
    });
  }
}

function assertMixinArguments(node) {
  assert.ok(Array.isArray(node.args));
  if (node.call) {
    node.args.forEach((argument) =>
      assert.strictEqual(typeof argument, 'string'),
    );
  } else {
    node.args.forEach((parameter) => {
      var keys = Object.keys(parameter).sort();
      assert.ok(
        ['name', 'default,name'].includes(keys.join(',')),
        'unexpected mixin parameter fields: ' + keys.join(', '),
      );
      assert.strictEqual(typeof parameter.name, 'string');
      if (Object.hasOwn(parameter, 'default')) {
        assert.strictEqual(typeof parameter.default, 'string');
      }
    });
  }
}

test('parse accepts only nullish or non-array object options', () => {
  var tokens = Object.freeze(lex(''));
  var emptyAst = {
    type: 'Block',
    nodes: [],
    line: 0,
    filename: undefined,
  };

  assert.deepStrictEqual(parse(tokens), emptyAst);
  assert.deepStrictEqual(parse(tokens, undefined), emptyAst);
  assert.deepStrictEqual(parse(tokens, null), emptyAst);
  assert.deepStrictEqual(parse(tokens, {}), emptyAst);
  assert.deepStrictEqual(parse(tokens, Object.create(null)), emptyAst);

  [
    false,
    true,
    0,
    1,
    NaN,
    0n,
    1n,
    '',
    'options',
    Symbol('options'),
    function options() {},
    [],
  ].forEach((options) => {
    var type = Array.isArray(options) ? 'array' : typeof options;
    assert.throws(
      () => parse(tokens, options),
      (err) =>
        err instanceof TypeError &&
        err.message ===
          'Expected "options" to be an object but got "' + type + '"',
    );
  });
});

test('parse rejects non-array token containers at the public boundary', () => {
  [
    undefined,
    null,
    false,
    0,
    '',
    'tokens',
    Symbol('tokens'),
    {},
    function tokens() {},
  ].forEach((tokens) => {
    assert.throws(
      () => parse(tokens),
      (err) =>
        err.constructor === Error &&
        err.message ===
          'Expected tokens to be an Array but got "' + typeof tokens + '"',
    );
  });
});

test('parse validates the complete token and location envelope up front', () => {
  var loc = {start: {line: 1, column: 1}};
  var eos = {type: 'eos', loc};
  var cases = [
    {tokens: [], message: 'expected at least one terminal "eos" token'},
    {tokens: [null], message: 'token at index 0 must be an object'},
    {tokens: [[]], message: 'token at index 0 must be an object'},
    {tokens: [{}], message: 'token at index 0 must have a string "type"'},
    {
      tokens: [{type: 1, loc}],
      message: 'token at index 0 must have a string "type"',
    },
    {
      tokens: [{type: 'eos'}],
      message: 'token at index 0 must have an object "loc"',
    },
    {
      tokens: [{type: 'eos', loc: []}],
      message: 'token at index 0 must have an object "loc"',
    },
    {
      tokens: [{type: 'eos', loc: {}}],
      message: 'token at index 0 must have an object "loc.start"',
    },
    {
      tokens: [{type: 'eos', loc: {start: null}}],
      message: 'token at index 0 must have an object "loc.start"',
    },
    {
      tokens: [{type: 'eos', loc: {start: {line: 0, column: 1}}}],
      message:
        'token at index 0 must have a one-based safe-integer "loc.start.line"',
    },
    {
      tokens: [{type: 'eos', loc: {start: {line: 1, column: 0}}}],
      message:
        'token at index 0 must have a one-based safe-integer "loc.start.column"',
    },
    {
      tokens: [{type: 'tag', val: 'p', loc}],
      message: 'the final token must have type "eos"',
    },
    {
      tokens: [eos, {type: 'tag', val: 'p', loc}, eos],
      message: '"eos" token at index 0 must be the final token',
    },
    {
      tokens: [eos, eos],
      message: '"eos" token at index 0 must be the final token',
    },
  ];

  cases.forEach(({tokens, message}) => {
    assert.throws(
      () => parse(tokens),
      (err) =>
        err instanceof TypeError &&
        err.message === 'Invalid token stream: ' + message,
    );
  });
});

test('parse accepts and does not mutate a frozen complete token stream', () => {
  var loc = Object.freeze({
    start: Object.freeze({line: 1, column: 1}),
  });
  var tokens = Object.freeze([Object.freeze({type: 'eos', loc})]);

  assert.deepStrictEqual(parse(tokens), {
    type: 'Block',
    nodes: [],
    line: 0,
    filename: undefined,
  });
});

function tagTokensAt(line, middle) {
  var loc = {
    start: {line, column: 7},
    end: {line, column: 7},
  };
  return [{type: 'tag', val: 'p', loc}, ...(middle || []), {type: 'eos', loc}];
}

test('Block lines accept the complete non-negative safe-integer range', () => {
  [1, 2147483647, 2147483648, Number.MAX_SAFE_INTEGER].forEach((line) => {
    var ast = parse(tagTokensAt(line));
    assert.strictEqual(ast.nodes[0].line, line);
    assert.strictEqual(ast.nodes[0].block.line, line);
  });
});

test('token locations reject values outside the one-based safe-integer range', () => {
  ['line', 'column'].forEach((field) => {
    [
      -1,
      0,
      Number.MIN_SAFE_INTEGER,
      0.5,
      NaN,
      Infinity,
      -Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      '1',
      1n,
      null,
      undefined,
      Symbol(field),
    ].forEach((value) => {
      var start = {line: 1, column: 1};
      start[field] = value;
      assert.throws(
        () => parse([{type: 'eos', loc: {start}}]),
        (err) =>
          err instanceof TypeError &&
          err.message ===
            'Invalid token stream: token at index 0 must have a ' +
              'one-based safe-integer "loc.start.' +
              field +
              '"',
      );
    });
  });
});

test('parser diagnostics preserve safe integer lines above signed 32-bit', () => {
  var line = 2147483648;
  var loc = {
    start: {line, column: 7},
    end: {line, column: 7},
  };

  assert.throws(
    () =>
      parse(tagTokensAt(line, [{type: 'bogus', loc}]), {
        filename: 'high-line.pg',
      }),
    (err) =>
      err.code === 'PUGNEUM:INVALID_TOKEN' &&
      err.line === line &&
      err.column === 7 &&
      err.filename === 'high-line.pg',
  );
});

test('parse reads accessor-backed options without modifying them', () => {
  var reads = [];
  var options = Object.freeze(
    Object.defineProperties(
      {},
      {
        filename: {
          get() {
            reads.push('filename');
            return 'accessor.pg';
          },
        },
        source: {
          get() {
            reads.push('source');
            return 'p text';
          },
        },
      },
    ),
  );

  var ast = parse(lex('p text', {filename: 'token.pg'}), options);

  assert.strictEqual(ast.filename, 'accessor.pg');
  assert.strictEqual(ast.nodes[0].filename, 'accessor.pg');
  assert.deepStrictEqual(reads, ['filename', 'source']);
});

function inspect(value, filename, seen) {
  if (Array.isArray(value)) {
    value.forEach((item) => inspect(item, filename, seen));
    return;
  }
  if (!value || typeof value !== 'object') return;

  if (typeof value.type === 'string') {
    var shapes = nodeShapes[value.type];
    assert.ok(shapes, 'undocumented parser node type ' + value.type);
    var actualShape = Object.keys(value).sort().join(',');
    assert.ok(
      shapes.includes(actualShape),
      value.type + ' has undocumented fields: ' + actualShape,
    );
    assertLocation(value, filename, value.type !== 'Block');
    seen.add(value.type);

    if (Object.hasOwn(value, 'name'))
      assert.strictEqual(typeof value.name, 'string');
    if (Object.hasOwn(value, 'expr'))
      assert.strictEqual(typeof value.expr, 'string');
    if (Object.hasOwn(value, 'val'))
      assert.strictEqual(typeof value.val, 'string');
    if (Object.hasOwn(value, 'nodes')) assert.ok(Array.isArray(value.nodes));
    if (Object.hasOwn(value, 'attrs')) assertAttributes(value.attrs, filename);
    if (Object.hasOwn(value, 'attributeBlocks')) {
      assert.deepStrictEqual(value.attributeBlocks, []);
    }
    if (Object.hasOwn(value, 'textOnly'))
      assert.strictEqual(value.textOnly, true);
    if (Object.hasOwn(value, 'isInline')) {
      assert.strictEqual(typeof value.isInline, 'boolean');
    }
    if (Object.hasOwn(value, 'buffer')) {
      assert.strictEqual(typeof value.buffer, 'boolean');
    }
    if (Object.hasOwn(value, 'block')) {
      assert.ok(
        value.block === null || value.block.type === 'Block',
        value.type + '.block must be a Block or null',
      );
      if (value.block === null) {
        assert.strictEqual(value.type, 'Mixin');
        assert.strictEqual(value.call, true);
      }
    }
    if (Object.hasOwn(value, 'file')) {
      assert.strictEqual(value.file.type, 'FileReference');
    }
    if (Object.hasOwn(value, 'definitions')) assertDefinitions(value, filename);
    if (value.type === 'FileReference')
      assert.strictEqual(typeof value.path, 'string');
    if (value.type === 'NamedBlock') {
      assert.ok(['replace', 'append', 'prepend'].includes(value.mode));
    }
    if (value.type === 'Mixin') {
      assert.strictEqual(typeof value.call, 'boolean');
      assertMixinArguments(value);
      if (!value.call) {
        assert.strictEqual(typeof value.usesNamedBlocks, 'boolean');
        assert.strictEqual(typeof value.usesUnnamedBlock, 'boolean');
      }
    }
    if (value.type === 'RawInclude') {
      assert.ok(Array.isArray(value.filters));
      value.filters.forEach((filter) =>
        assert.strictEqual(filter.type, 'IncludeFilter'),
      );
    }
  }

  Object.values(value).forEach((child) => inspect(child, filename, seen));
}

test('README AST contract covers every parser-emitted node and record shape', () => {
  var nodeSection = markdownSection('#### Nodes', '#### Supporting records');
  var recordSection = markdownSection(
    '#### Supporting records',
    '#### Mixin and control fields',
  );
  assert.deepStrictEqual(
    firstColumnNames(nodeSection),
    Object.keys(nodeShapes).sort(),
  );
  assert.deepStrictEqual(firstColumnNames(recordSection), recordNames);

  var filenames = manifest.render
    .map((name) => name + '.pg')
    .concat(
      manifest.syntax,
      manifest.dependencies.filter((name) => name.endsWith('.pg')),
    )
    .sort();
  var seen = new Set();
  filenames.forEach((filename) => {
    var source = fs.readFileSync(path.join(testCasesRoot, filename), 'utf8');
    inspect(parse(lex(source, {filename}), {filename}), filename, seen);
  });

  var loc = {
    start: {line: 1, column: 1},
    end: {line: 1, column: 1},
  };
  ['plain', 'textOnly'].forEach((variant) => {
    var filename = 'direct-' + variant + '.pg';
    var tokens = [{type: 'interpolation', val: 'elementName', loc}];
    if (variant === 'textOnly') tokens.push({type: 'dot', loc});
    tokens.push({type: 'eos', loc});
    inspect(parse(tokens, {filename}), filename, seen);
  });

  assert.deepStrictEqual(
    Array.from(seen).sort(),
    Object.keys(nodeShapes).sort(),
  );
});

test('README error table matches parser-coded error sites and names the limit', () => {
  var implementation = fs.readFileSync(
    path.join(packageRoot, 'index.js'),
    'utf8',
  );
  var emittedCodes = Array.from(
    new Set(
      Array.from(
        implementation.matchAll(/this\.error\(\s*['"]([A-Z_]+)['"]/g),
        (match) => match[1],
      ),
    ),
  ).sort();
  var errorSection = markdownSection('### Errors and limits', '## License');
  var documentedCodes = Array.from(
    errorSection.matchAll(/^\| `PUGNEUM:([A-Z_]+)` \|/gm),
    (match) => match[1],
  ).sort();

  assert.deepStrictEqual(documentedCodes, emittedCodes);
  assert.match(errorSection, /fixed parser nesting limit is 256/);
  assert.match(errorSection, /malformed streams are not grammar diagnostics/);
});
