var assert = require('node:assert/strict');
var {describe, test} = require('node:test');
var {parseDate} = require('../lib/date');

var fallback = '2000-01-01T00:00:00.000Z';

describe('strict ISO date components', () => {
  [
    '2026-02-30',
    '2025-02-29',
    '2026-04-31T12:00:00Z',
    '2026-01-01T24:00:00Z',
    '2026-01-01T23:60:00Z',
    '2026-01-01T23:59:60Z',
    '2026-01-01T12:00:00+24:00',
    '2026-01-01T12:00:00-03:60',
  ].forEach((value) => {
    test('falls back for ' + value, () => {
      assert.strictEqual(parseDate(value, fallback).toISOString(), fallback);
    });
  });

  test('accepts a leap day with time, fraction, and offset', () => {
    assert.strictEqual(
      parseDate('2024-02-29T23:59:59.123-03:30', fallback).toISOString(),
      '2024-03-01T03:29:59.123Z',
    );
  });

  test('accepts the last second of an ordinary date', () => {
    assert.strictEqual(
      parseDate('2026-12-31T23:59:59Z', fallback).toISOString(),
      '2026-12-31T23:59:59.000Z',
    );
  });

  test('accepts a pre-parsed Unix epoch value', () => {
    assert.strictEqual(
      parseDate(0, fallback).toISOString(),
      '1970-01-01T00:00:00.000Z',
    );
  });
});
