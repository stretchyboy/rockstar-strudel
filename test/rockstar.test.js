/**
 * Unit tests for the non-WASM helper logic in src/index.js.
 *
 * These tests cover `buildSource` and `coerce` — the two pure functions that
 * can be exercised without loading the .NET WASM runtime.
 *
 * Run with:  npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSource, coerce } from '../src/index.js';

// ─── buildSource ────────────────────────────────────────────────────────────

describe('buildSource', () => {
  it('returns the raw template string when there are no interpolations', () => {
    const src = buildSource`My heart is 123`;
    assert.equal(src, 'My heart is 123');
  });

  it('splices a single string interpolation', () => {
    const name = 'Alice';
    const src = buildSource`Let ${name} be 42`;
    assert.equal(src, 'Let Alice be 42');
  });

  it('stringifies a numeric interpolation', () => {
    const n = 99;
    const src = buildSource`Tommy was ${n}`;
    assert.equal(src, 'Tommy was 99');
  });

  it('handles multiple interpolations in the correct order', () => {
    const a = 'my heart';
    const b = 123;
    const src = buildSource`${a} is ${b}`;
    assert.equal(src, 'my heart is 123');
  });

  it('preserves leading and trailing whitespace / newlines in the template', () => {
    const src = buildSource`
  Shout "hello"
`;
    assert.equal(src, '\n  Shout "hello"\n');
  });

  it('treats undefined interpolation values as empty strings', () => {
    // Simulates calling buildSource(['a', 'b'], undefined)
    const src = buildSource(['a', 'b'], undefined);
    assert.equal(src, 'ab');
  });
});

// ─── coerce ─────────────────────────────────────────────────────────────────

describe('coerce', () => {
  it('converts an integer string to a JS number', () => {
    assert.equal(coerce('123\n'), 123);
    assert.strictEqual(typeof coerce('123\n'), 'number');
  });

  it('converts a decimal string to a JS number', () => {
    assert.equal(coerce('3.14\n'), 3.14);
  });

  it('converts a negative number string', () => {
    assert.equal(coerce('-7\n'), -7);
  });

  it('handles Windows-style CRLF line endings', () => {
    assert.equal(coerce('42\r\n'), 42);
  });

  it('converts zero', () => {
    assert.equal(coerce('0\n'), 0);
    assert.strictEqual(typeof coerce('0\n'), 'number');
  });

  it('returns a string for non-numeric output', () => {
    assert.equal(coerce('hello\n'), 'hello');
    assert.strictEqual(typeof coerce('hello\n'), 'string');
  });

  it('returns a string for boolean-like output', () => {
    assert.equal(coerce('true\n'), 'true');
    assert.equal(coerce('false\n'), 'false');
  });

  it('returns a string for null-like output', () => {
    assert.equal(coerce('null\n'), 'null');
    assert.equal(coerce('mysterious\n'), 'mysterious');
  });

  it('returns undefined for an empty line', () => {
    assert.equal(coerce(''), undefined);
  });

  it('returns undefined for a line containing only a newline', () => {
    assert.equal(coerce('\n'), undefined);
    assert.equal(coerce('\r\n'), undefined);
  });

  it('does not coerce Infinity to a number (not finite)', () => {
    assert.equal(coerce('Infinity\n'), 'Infinity');
    assert.strictEqual(typeof coerce('Infinity\n'), 'string');
  });

  it('does not coerce NaN to a number', () => {
    assert.equal(coerce('NaN\n'), 'NaN');
    assert.strictEqual(typeof coerce('NaN\n'), 'string');
  });

  it('strips multiple trailing newlines', () => {
    assert.equal(coerce('42\n\n'), 42);
    assert.equal(coerce('hi\n\n'), 'hi');
  });
});
