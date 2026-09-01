'use strict';

var assert = require('node:assert/strict');
var {describe, test} = require('node:test');
var {createRenderer} = require('./helpers');

var render = createRenderer('quote.pg');

describe('quote mixin', () => {
  test('source URL and structured linked citation have separate roles', () => {
    var input =
      '+quote(https://example.com/quotation)\n' +
      '  | Quoted text.\n' +
      '  block caption\n' +
      '    +linked-citation(https://example.com/work)\n' +
      '      block attribution\n' +
      '        | Example Author\n' +
      '      block title\n' +
      '        | Example Work';

    assert.strictEqual(
      render(input),
      '<figure><blockquote cite="https://example.com/quotation">Quoted text.</blockquote><figcaption>Example Author, <cite><a href="https://example.com/work">Example Work</a></cite></figcaption></figure>',
    );
  });

  test('source and caption are independently optional', () => {
    assert.strictEqual(
      render('+quote\n  | An unattributed quotation.'),
      '<figure><blockquote>An unattributed quotation.</blockquote></figure>',
    );

    assert.strictEqual(
      render('+quote(/source)\n  | A sourced quotation.'),
      '<figure><blockquote cite="/source">A sourced quotation.</blockquote></figure>',
    );
  });

  test('caption accepts arbitrary rich content', () => {
    var input =
      '+quote\n' +
      '  p First paragraph.\n' +
      '  p Second paragraph.\n' +
      '  block caption\n' +
      '    | Recorded #(time(datetime=2021-09-04) Sept 4, 2021).';

    assert.strictEqual(
      render(input),
      '<figure><blockquote><p>First paragraph.</p><p>Second paragraph.</p></blockquote><figcaption>Recorded <time datetime="2021-09-04">Sept 4, 2021</time>.</figcaption></figure>',
    );
  });

  test('the removed plain-quote helper is not retained as an alias', () => {
    assert.throws(
      () => render('+plain-quote\n  | Legacy call.'),
      (error) => error.code === 'PUGNEUM:UNDEFINED_MIXIN',
    );
  });
});

describe('citation helpers', () => {
  test('citation places only the title in cite', () => {
    var input =
      '+citation\n' +
      '  block attribution\n' +
      '    | Ursula K. Le Guin\n' +
      '  block title\n' +
      '    | The Dispossessed';

    assert.strictEqual(
      render(input),
      'Ursula K. Le Guin, <cite>The Dispossessed</cite>',
    );
  });

  test('linked-citation links only the cited title', () => {
    var input =
      '+linked-citation(/books/the-dispossessed)\n' +
      '  block attribution\n' +
      '    strong Ursula K. Le Guin\n' +
      '  block title\n' +
      '    em The Dispossessed';

    assert.strictEqual(
      render(input),
      '<strong>Ursula K. Le Guin</strong>, <cite><a href="/books/the-dispossessed"><em>The Dispossessed</em></a></cite>',
    );
  });

  test('attribution-only and title-only citations omit dangling structure', () => {
    assert.strictEqual(
      render('+citation\n  block attribution\n    | Anonymous'),
      'Anonymous',
    );
    assert.strictEqual(
      render('+citation\n  block title\n    | Oral tradition'),
      '<cite>Oral tradition</cite>',
    );
  });

  test('separator is configurable and appears only between populated slots', () => {
    var input =
      "+citation(' — ')\n" +
      '  block attribution\n' +
      '    | Anonymous\n' +
      '  block title\n' +
      '    | Oral tradition';
    assert.strictEqual(
      render(input),
      'Anonymous — <cite>Oral tradition</cite>',
    );

    assert.strictEqual(
      render("+citation(' — ')\n  block title\n    | Oral tradition"),
      '<cite>Oral tradition</cite>',
    );
  });
});
