/**
 * Unit tests for the non-WASM helper logic in src/index.js.
 *
 * These tests cover `buildSource` and `coerce` — the two pure functions that
 * can be exercised without loading the .NET WASM runtime.
 *
 * Run with:  npm test
 */

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  __resetRunnerForTests,
  __setRunnerPromiseForTests,
  buildSource,
  coerce,
  isTrustedUrl,
  parsePoeticNumber,
  parseOutputLine,
  rockstar,
  rockstar_pro,
  resolveRerunValues,
} from '../src/index.js';

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

// ─── isTrustedUrl ────────────────────────────────────────────────────────────

describe('isTrustedUrl', () => {
  it('trusts codewithrockstar.com', () => {
    assert.ok(isTrustedUrl('https://codewithrockstar.com/wasm/wwwroot/_framework/dotnet.js'));
  });

  it('trusts cdn.jsdelivr.net', () => {
    assert.ok(isTrustedUrl('https://cdn.jsdelivr.net/gh/someone/rockstar@v1/wasm/dotnet.js'));
  });

  it('trusts unpkg.com', () => {
    assert.ok(isTrustedUrl('https://unpkg.com/some-package/dotnet.js'));
  });

  it('trusts any *.github.io subdomain', () => {
    assert.ok(isTrustedUrl('https://stretchyboy.github.io/rockstar/wasm/wwwroot/_framework/dotnet.js'));
    assert.ok(isTrustedUrl('https://anyone.github.io/rockstar/wasm/wwwroot/_framework/dotnet.js'));
  });

  it('trusts localhost with a port', () => {
    assert.ok(isTrustedUrl('http://localhost:8080/_framework/dotnet.js'));
  });

  it('trusts 127.0.0.1 with a port', () => {
    assert.ok(isTrustedUrl('http://127.0.0.1:3000/_framework/dotnet.js'));
  });

  it('rejects an arbitrary https URL', () => {
    assert.ok(!isTrustedUrl('https://evil.example.com/dotnet.js'));
  });

  it('rejects a bare github.io URL without a subdomain', () => {
    assert.ok(!isTrustedUrl('https://github.io/dotnet.js'));
  });

  it('rejects http (non-localhost)', () => {
    assert.ok(!isTrustedUrl('http://codewithrockstar.com/wasm/dotnet.js'));
  });
});

// ─── parsePoeticNumber ──────────────────────────────────────────────────────

describe('parsePoeticNumber', () => {
  it('maps word lengths to digits modulo 10', () => {
    assert.equal(parsePoeticNumber('My dreams'), 26);
  });

  it('ignores apostrophes and stops at statement punctuation', () => {
    assert.equal(
      parsePoeticNumber("a panther, he ain't talkin' 'bout love. Shout Tommy"),
      1724644
    );
  });

  it('treats an ellipsis as the decimal separator', () => {
    assert.equal(
      parsePoeticNumber("ice... a life unfulfilled, wakin' everybody up, taking booze and pills."),
      3.1415926535
    );
  });

  it('counts hyphens as letters', () => {
    assert.equal(parsePoeticNumber('life-long.'), 9);
  });

  it('supports the unicode ellipsis character too', () => {
    assert.equal(
      parsePoeticNumber('my… darkest nightmarish longings, my cravings, a symphony of suff\'ring that lasts life-long.'),
      2.718281828459
    );
  });

  it('returns undefined when there are no words', () => {
    assert.equal(parsePoeticNumber('!!!'), undefined);
  });
});

// ─── parseOutputLine ────────────────────────────────────────────────────────

describe('parseOutputLine', () => {
  it('returns numeric-first output while preserving words in other views', () => {
    const parsed = parseOutputLine('hello world\n');
    assert.deepEqual(parsed, {
      raw: 'hello world\n',
      output: 55,
      mixed_output: 'hello world',
      text_output: 'hello world',
    });
  });

  it('stringifies numbers in text_output', () => {
    const parsed = parseOutputLine('123\n');
    assert.deepEqual(parsed, {
      raw: '123\n',
      output: 123,
      mixed_output: 123,
      text_output: '123',
    });
  });

  it('parses JSON-style lists and converts string numerals', () => {
    const parsed = parseOutputLine('[ "012" ]\n');
    assert.deepEqual(parsed, {
      raw: '[ "012" ]\n',
      output: [12],
      mixed_output: [12],
      text_output: ['12'],
    });
  });

  it('keeps mixed and text views alongside numeric-first output', () => {
    const parsed = parseOutputLine('["3", ["my dreams", "007"]]\n');
    assert.deepEqual(parsed, {
      raw: '["3", ["my dreams", "007"]]\n',
      output: [3, [26, 7]],
      mixed_output: [3, ['my dreams', 7]],
      text_output: ['3', ['my dreams', '7']],
    });
  });

  it('returns undefined for blank output lines', () => {
    assert.equal(parseOutputLine('\n'), undefined);
    assert.equal(parseOutputLine('\r\n'), undefined);
  });

  it('falls back to text in mixed/text views when malformed JSON list is printed', () => {
    const parsed = parseOutputLine('[ nope ]\n');
    assert.deepEqual(parsed, {
      raw: '[ nope ]\n',
      output: 4,
      mixed_output: '[ nope ]',
      text_output: '[ nope ]',
    });
  });
});

// ─── resolveRerunValues ────────────────────────────────────────────────────

describe('resolveRerunValues', () => {
  it('repeats the previous values when no args are provided', () => {
    assert.deepEqual(resolveRerunValues([1, 'two', 3]), [1, 'two', 3]);
  });

  it('replaces values positionally from variadic args', () => {
    assert.deepEqual(resolveRerunValues([1, 2, 3], 9, 8), [9, 8]);
  });

  it('replaces values from an array argument', () => {
    assert.deepEqual(resolveRerunValues([1, 2, 3], [7, 6]), [7, 6]);
  });

  it('derives next values from a function', () => {
    const next = resolveRerunValues([2, 4, 6], (prev) => prev.map((n) => n * 10));
    assert.deepEqual(next, [20, 40, 60]);
  });

  it('wraps a non-array function result as a single interpolation value', () => {
    const next = resolveRerunValues([2, 4, 6], () => 99);
    assert.deepEqual(next, [99]);
  });
});

// ─── example-program output shaping (non-WASM) ────────────────────────────

describe('example Rockstar program outputs (non-WASM shaping)', () => {
  const collectViews = (rawLines) => {
    const output = [];
    const mixed_output = [];
    const text_output = [];

    for (const line of rawLines) {
      const parsed = parseOutputLine(line);
      if (!parsed) continue;
      output.push(parsed.output);
      mixed_output.push(parsed.mixed_output);
      text_output.push(parsed.text_output);
    }

    return { output, mixed_output, text_output };
  };

  it('matches the two-line numeric output shape from the Papa + Scream example', () => {
    const parsed = collectViews(['175\n', '179\n']);
    assert.deepEqual(parsed.output, [175, 179]);
  });

  it('matches rockstar numeric output for a single Say line', () => {
    const parsed = collectViews(['175\n']);
    assert.deepEqual(parsed.output, [175]);
  });

  it('matches rockstar_pro numeric output for a single Say line', () => {
    const parsed = collectViews(['175\n']);
    assert.deepEqual(parsed.output, [175]);
  });

  it('matches successive numeric updates from the He was with him example', () => {
    const parsed = collectViews(['175\n', '350\n']);
    assert.deepEqual(parsed.output, [175, 350]);
  });

  it('keeps AC/DC-like output text in mixed/text views', () => {
    const parsed = collectViews(['AD/DC\n']);
    assert.deepEqual(parsed.mixed_output, ['AD/DC']);
    assert.deepEqual(parsed.text_output, ['AD/DC']);
  });

  it('produces empty parallel views when no lines are emitted', () => {
    const parsed = collectViews([]);
    assert.deepEqual(parsed.output, []);
    assert.deepEqual(parsed.mixed_output, []);
    assert.deepEqual(parsed.text_output, []);
  });
});

// ─── rockstar / rockstar_pro wrappers via mocked runner ───────────────────

describe('rockstar wrappers (mocked runner)', () => {
  beforeEach(() => {
    __resetRunnerForTests();
  });

  it('rockstar returns numeric-first output values', async () => {
    const fakeRunner = {
      async Run(_code, onLine) {
        onLine('175\n');
      },
    };
    __setRunnerPromiseForTests(Promise.resolve(fakeRunner));

    const out = await rockstar`
      Papa was a rolling stone
      Say Papa
    `;

    assert.deepEqual(out, [175]);
  });

  it('rockstar_pro returns parallel output views', async () => {
    const fakeRunner = {
      async Run(_code, onLine) {
        onLine('175\n');
        onLine('350\n');
      },
    };
    __setRunnerPromiseForTests(Promise.resolve(fakeRunner));

    const out = await rockstar_pro`
      Papa was a rolling stone
      Say Papa
      He was with him
      Say Papa
    `;

    assert.deepEqual(out.output, [175, 350]);
    assert.deepEqual(out.mixed_output, [175, 350]);
    assert.deepEqual(out.text_output, ['175', '350']);
    assert.equal(out.error, null);
  });

  it('rockstar_pro preserves [] outputs and exposes an error field on runtime failure', async () => {
    const fakeRunner = {
      async Run() {
        throw new Error('Parse error near "pri nt"');
      },
    };
    __setRunnerPromiseForTests(Promise.resolve(fakeRunner));

    const out = await rockstar_pro`
      pri nt "Hello, World"
    `;

    assert.deepEqual(out.output, []);
    assert.deepEqual(out.mixed_output, []);
    assert.deepEqual(out.text_output, []);
    assert.deepEqual(out.error, {
      name: 'Error',
      message: 'Parse error near "pri nt"',
    });
  });
});
