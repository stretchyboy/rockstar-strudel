/**
 * rockstar-strudel
 *
 * Runs Rockstar lang programs via the Starship WebAssembly engine and returns
 * each printed value as an element of a JavaScript array, for use in the
 * strudel.cc live-coding REPL.
 *
 * Quick start in strudel.cc
 * ─────────────────────────
 *   import { rockstar } from 'https://esm.sh/rockstar-strudel'
 *
 *   const data = await rockstar`
 *     My heart is 123
 *     Let your love be 456
 *     Put 789 into the night
 *     Shout my heart. Scream your love. Whisper the night.
 *   `
 *   // data === [123, 456, 789]
 *
 * CORS requirement
 * ────────────────
 * The WASM engine is loaded from https://stretchyboy.github.io/rockstar/ as https://codewithrockstar.com/wasm/ has broken CORS.
 * That origin must serve its WASM assets with
 *   Access-Control-Allow-Origin: *
 * See PLAN.md for instructions on enabling this in a rockstar fork.
 */

/** Default URL of the .NET WASM loader published by stretchyboy.github.io. */
const DEFAULT_DOTNET_URL =
  'https://stretchyboy.github.io/rockstar/wasm/wwwroot/_framework/dotnet.js';

/**
 * URL prefixes that are considered safe for loading the dotnet.js WASM
 * runtime.  Calls to `init()` with a URL that does not start with one of
 * these prefixes (or match the github.io pattern) are rejected to prevent
 * loading arbitrary remote code.
 * Extend this list if you host the WASM yourself on a trusted CDN.
 */
export const ALLOWED_URL_PREFIXES = [
  'https://codewithrockstar.com/',
  'https://stretchyboy.github.io/rockstar/',
  'https://cdn.jsdelivr.net/',
  'https://unpkg.com/',
  'http://localhost:',
  'http://127.0.0.1:',
];

/** github.io subdomains (e.g. username.github.io) are also trusted. */
export const GITHUB_IO_PATTERN = /^https:\/\/[^.]+\.github\.io\//;

/**
 * Returns true if the given dotnetUrl is trusted for WASM loading.
 * Exported for testing.
 * @param {string} url
 * @returns {boolean}
 */
export function isTrustedUrl(url) {
  return (
    ALLOWED_URL_PREFIXES.some((prefix) => url.startsWith(prefix)) ||
    GITHUB_IO_PATTERN.test(url)
  );
}

/**
 * The single cached promise that resolves to the RockstarRunner export object.
 * Kept at module scope so the WASM runtime is initialised at most once per
 * page/worker load.
 * @type {Promise<object> | null}
 */
let _runnerPromise = null;

/**
 * Pre-load the Rockstar WASM engine.
 *
 * Called automatically on the first use of the `rockstar` tag, but you can
 * call it earlier to eliminate the cold-start delay on the first program run.
 *
 * @param {string} [dotnetUrl]
 *   Override the dotnet.js loader URL.
 *   Useful when you host the WASM assets yourself (e.g. after following the
 *   steps in PLAN.md to add CORS headers to your own rockstar fork deployment).
 *   Defaults to DEFAULT_DOTNET_URL.
 * @returns {Promise<void>}
 */
export async function init(dotnetUrl) {
  if (!_runnerPromise) {
    _runnerPromise = _loadRunner(dotnetUrl ?? DEFAULT_DOTNET_URL);
  }
  await _runnerPromise;
}

/**
 * Internal: dynamically import the dotnet.js WASM loader, initialise the
 * .NET runtime, and return the JSExport'd RockstarRunner object.
 *
 * dotnet.js resolves all sibling WASM/assembly blobs relative to its own URL,
 * so as long as the hosting origin sets CORS headers the runtime loads without
 * any additional configuration.
 *
 * @param {string} dotnetUrl
 * @returns {Promise<object>}  Resolves to `exports.Rockstar.Wasm.RockstarRunner`
 */
async function _loadRunner(dotnetUrl) {
  if (!isTrustedUrl(dotnetUrl)) {
    throw new Error(
      `Untrusted dotnet.js URL: "${dotnetUrl}". ` +
        `Must start with one of: ${ALLOWED_URL_PREFIXES.join(', ')} ` +
        `or be a *.github.io URL. ` +
        `Add your CDN prefix to ALLOWED_URL_PREFIXES in src/index.js if needed.`
    );
  }
  const dotnetOrigin = new URL(dotnetUrl).origin;
  // eslint-disable-next-line no-eval -- dynamic import from a runtime URL
  const { dotnet } = await import(/* webpackIgnore: true */ dotnetUrl);
  const { getAssemblyExports, getConfig } = await dotnet
    .withDiagnosticTracing(false)
    .withResourceLoader((type, name, defaultUri, integrity) => {
      const resourceUrl = new URL(defaultUri, dotnetUrl);

      if (type === 'dotnetjs') {
        return resourceUrl.href;
      }

      if (resourceUrl.origin === window.location.origin) {
        return undefined;
      }

      if (resourceUrl.origin !== dotnetOrigin) {
        throw new Error(
          `Unexpected runtime asset origin for ${name}: "${resourceUrl.origin}".`
        );
      }

      return fetch(resourceUrl, {
        credentials: 'omit',
        integrity,
      });
    })
    .create();
  const config = getConfig();
  const exports = await getAssemblyExports(config.mainAssemblyName);
  return exports.Rockstar.Wasm.RockstarRunner;
}

/**
 * Return the cached runner promise, initialising with the default URL if
 * `init()` has not been called yet.
 * @returns {Promise<object>}
 */
function _runner() {
  if (!_runnerPromise) _runnerPromise = _loadRunner(DEFAULT_DOTNET_URL);
  return _runnerPromise;
}

/**
 * Coerce a single raw output line (as delivered by the WASM callback) to a
 * typed JavaScript value.
 *
 * - Trailing `\r\n` / `\n` (added by `WasmIO.WriteLine` in C#) is stripped.
 * - Blank lines after stripping are ignored (returns `undefined`).
 * - Finite numbers are returned as JS `number`.
 * - Everything else is returned as a `string`.
 *
 * @param {string} line  Raw callback argument from the WASM engine.
 * @returns {number | string | undefined}
 */
export function coerce(line) {
  const trimmed = line.trimEnd();
  if (trimmed === '') return undefined;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : trimmed;
}

/**
 * Convert text to a Rockstar-style poetic numeric literal.
 *
 * Rockstar counts each word's length modulo 10. Hyphens count as letters,
 * apostrophes do not. Parsing stops at the end of the current statement
 * (`.`, `!`, `?`, `;`, or a newline). An ellipsis (`...` or `…`) acts as the
 * decimal separator.
 *
 * Examples:
 * - "a panther, he ain't talkin' 'bout love." -> 1724644
 * - "ice... a life unfulfilled" -> 3.141
 *
 * @param {string} text
 * @returns {number | undefined}
 */
export function parsePoeticNumber(text) {
  const source = String(text).replace(/…/g, '...');
  const intDigits = [];
  const fracDigits = [];
  let currentWord = '';
  let sawDecimal = false;

  const pushWord = () => {
    if (!currentWord) return;

    const normalized = currentWord.replace(/'/g, '');
    currentWord = '';
    if (!normalized) return;

    const digit = normalized.length % 10;
    if (sawDecimal) {
      fracDigits.push(String(digit));
    } else {
      intDigits.push(String(digit));
    }
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (source.slice(i, i + 3) === '...') {
      pushWord();
      sawDecimal = true;
      i += 2;
      continue;
    }

    if (char === '\n' || char === '.' || char === '!' || char === '?' || char === ';') {
      pushWord();
      break;
    }

    if (/[\p{L}'-]/u.test(char)) {
      currentWord += char;
      continue;
    }

    pushWord();
  }

  pushWord();

  if (intDigits.length === 0 && fracDigits.length === 0) return undefined;

  const intPart = intDigits.length > 0 ? intDigits.join('') : '0';
  const value =
    fracDigits.length > 0
      ? Number(`${intPart}.${fracDigits.join('')}`)
      : Number(intPart);

  return Number.isFinite(value) ? value : undefined;
}

/**
 * Parse a single output line into the parallel views used by `rockstar_pro`.
 *
 * - `output` is numeric-first for Strudel number pipelines.
 * - `mixed_output` preserves words while keeping numeric values typed.
 * - `text_output` keeps the same shape but stringifies all values.
 *
 * @param {string} line
 * @returns {{
 *   raw: string,
 *   output: number|Array<number|Array<unknown>>,
 *   mixed_output: number|string|Array<unknown>,
 *   text_output: string|Array<unknown>
 * } | undefined}
 */
export function parseOutputLine(line) {
  const raw = line;
  const trimmed = line.trimEnd();
  if (trimmed === '') return undefined;

  const parsedArray = _parseJsonArray(trimmed);
  if (parsedArray !== undefined) {
    const mixed_output = _toMixedArray(parsedArray);
    const text_output = _toTextArray(mixed_output);
    const output = _toPoeticArray(parsedArray);
    return { raw, output, mixed_output, text_output };
  }

  const mixed_output = coerce(trimmed);
  const text_output = _toTextValue(mixed_output);
  const output = _toPoeticNumber(mixed_output);
  return { raw, output, mixed_output, text_output };
}

/**
 * Attempt to parse a JSON-style array string, otherwise return undefined.
 * @param {string} text
 * @returns {Array<unknown> | undefined}
 */
function _parseJsonArray(text) {
  const startsLikeArray = text.startsWith('[') && text.endsWith(']');
  if (!startsLikeArray) return undefined;

  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Convert any parsed array value into mixed output values.
 * Numeric-looking strings become numbers; other strings stay as text.
 *
 * @param {Array<unknown>} value
 * @returns {Array<unknown>}
 */
function _toMixedArray(value) {
  return value.map((item) => {
    if (Array.isArray(item)) return _toMixedArray(item);
    if (typeof item === 'string') {
      const numeric = _parseNumberish(item);
      return numeric !== undefined ? numeric : item;
    }
    return item;
  });
}

/**
 * Convert a value tree to text output values.
 * Numbers and other scalars are stringified while preserving array shape.
 *
 * @param {unknown} value
 * @returns {string|Array<unknown>}
 */
function _toTextValue(value) {
  if (Array.isArray(value)) return _toTextArray(value);
  if (typeof value === 'string') return value;
  return String(value);
}

/**
 * Convert any parsed array value into text output values.
 *
 * @param {Array<unknown>} value
 * @returns {Array<unknown>}
 */
function _toTextArray(value) {
  return value.map((item) => _toTextValue(item));
}

/**
 * Convert any parsed array value into numeric-first output values.
 * Output is strictly numbers or nested arrays of numbers.
 *
 * @param {Array<unknown>} value
 * @returns {Array<number|Array<unknown>>}
 */
function _toPoeticArray(value) {
  return value.map((item) => {
    if (Array.isArray(item)) return _toPoeticArray(item);
    return _toPoeticNumber(item);
  });
}

/**
 * Convert a single scalar value to a number using numeric parse first,
 * then Rockstar poetic numeric literal parsing.
 *
 * @param {unknown} value
 * @returns {number}
 */
function _toPoeticNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === null) return 0;

  if (typeof value === 'string') {
    const numeric = _parseNumberish(value);
    if (numeric !== undefined) return numeric;

    const poetic = parsePoeticNumber(value);
    return poetic !== undefined ? poetic : 0;
  }

  return 0;
}

/**
 * Parse text as a finite JS number.
 * @param {string} text
 * @returns {number | undefined}
 */
function _parseNumberish(text) {
  const num = Number(String(text));
  return Number.isFinite(num) ? num : undefined;
}

/**
 * Resolve the interpolation values for a rerun of `rockstar_pro`.
 *
 * - `rerun()` repeats the previous interpolation set.
 * - `rerun(v1, v2, ...)` replaces values positionally.
 * - `rerun([v1, v2, ...])` replaces from an array.
 * - `rerun(fn)` derives the next values from the previous array.
 *
 * @param {Array<unknown>} previousValues
 * @param {...unknown} nextArgs
 * @returns {Array<unknown>}
 */
export function resolveRerunValues(previousValues, ...nextArgs) {
  if (nextArgs.length === 0) return [...previousValues];

  if (nextArgs.length === 1) {
    const [arg] = nextArgs;

    if (typeof arg === 'function') {
      const result = arg([...previousValues]);
      return Array.isArray(result) ? [...result] : [result];
    }

    if (Array.isArray(arg)) {
      return [...arg];
    }
  }

  return [...nextArgs];
}

/**
 * Build the full Rockstar source string from a tagged-template call's parts.
 *
 * Template interpolations are stringified and spliced in, so you can
 * parameterise programs:
 *
 *   const n = 10;
 *   await rockstar`Tommy was ${n}\nShout Tommy`
 *   // equivalent to running:  Tommy was 10 \n Shout Tommy
 *
 * @param {TemplateStringsArray} strings
 * @param {...*} values
 * @returns {string}
 */
export function buildSource(strings, ...values) {
  return strings.reduce((acc, str, i) => {
    const interpolated = values[i - 1];
    return acc + (interpolated !== undefined ? String(interpolated) : '') + str;
  });
}

/**
 * Template tag that executes a Rockstar program and returns a numeric-first
 * array of every printed value (via `Say` / `Shout` / `Scream` / `Whisper`).
 *
 * Plain numeric strings stay numeric, and other printed text is converted
 * using Rockstar poetic numeric literal rules. JSON-style lists are converted
 * recursively to nested numeric arrays.
 *
 * The WASM engine is loaded lazily on the first call and cached for subsequent
 * calls.  You can call `init()` first to pre-warm the engine if desired.
 *
 * @example
 * const data = await rockstar`
 *   My heart is 123
 *   Let your love be 456
 *   Put 789 into the night
 *   Shout my heart. Scream your love. Whisper the night.
 * `
 * // data === [123, 456, 789]
 *
 * @param {TemplateStringsArray} strings
 * @param {...*} values
 * @returns {Promise<Array<number|Array<unknown>>>}
 */
export async function rockstar(strings, ...values) {
  const result = await rockstar_pro(strings, ...values);
  return result.output;
}

/**
 * Template tag that executes Rockstar and returns richer parallel output views:
 *
 * - `output`: numeric-first values for Strudel sequence/math use.
 * - `mixed_output`: mixed typed values with words preserved.
 * - `text_output`: all values stringified for speech/text workflows.
 * - `raw_output`: unmodified callback lines from WASM.
 * - `sourceText`: exact source string that was executed.
 *
 * @param {TemplateStringsArray} strings
 * @param {...*} values
 * @returns {Promise<{
 *   sourceText: string,
 *   templateValues: Array<unknown>,
 *   raw_output: Array<string>,
 *   output: Array<number|Array<unknown>>,
 *   mixed_output: Array<number|string|Array<unknown>>,
 *   text_output: Array<string|Array<unknown>>,
 *   speech: Array<string>, // samples('shabda/speech:'+prog.speech.join(','))
 *   rerun: (...values: Array<unknown>) => Promise<object>,
 *   getVariables: () => never,
 *   callFunction: (name: string, ...args: Array<unknown>) => never,
 *   listFunctions: () => never
 * }>}
 */
export async function rockstar_pro(strings, ...values) {
  const code = buildSource(strings, ...values);
  const runner = await _runner();
  const raw_output = [];
  const output = [];
  const mixed_output = [];
  const text_output = [];
  const lines = code.split('\n')
  const speech = lines.map((x) => x.toLowerCase()
  .trim()
  .replaceAll(' ', '_')
  .replace(/\W/g, ''))
  .filter((x)=> x.length);

  //console.log(`samples('shabda/speech:'+prog.speech.join(','))`)

  await runner.Run(
    code,
    (line) => {
      raw_output.push(line);

      const parsed = parseOutputLine(line);
      if (!parsed) return;

      output.push(parsed.output);
      mixed_output.push(parsed.mixed_output);
      text_output.push(parsed.text_output);
    },
    /* stdin */ '',
    /* args  */ ''
  );

  const unsupported = (featureName) => {
    throw new Error(
      `${featureName} is not available in the current JS-only wrapper. ` +
        `It requires new JSExport methods in the WASM RockstarRunner.`
    );
  };

  return {
    sourceText: code,
    templateValues: [...values],
    raw_output,
    output,
    mixed_output,
    text_output,
    speech,
    rerun: (...nextArgs) => {
      const nextValues = resolveRerunValues(values, ...nextArgs);
      return rockstar_pro(strings, ...nextValues);
    },
    getVariables: () => unsupported('getVariables()'),
    callFunction: () => unsupported('callFunction()'),
    listFunctions: () => unsupported('listFunctions()'),
  };
}

export const to_base = function (number, base) {
    const convertOne = function (value) {
        let digit = [];
        while (value > 0) {
            digit.unshift(value % base);
            value = Math.floor(value / base);
        }
        return digit;
    };

    if (Array.isArray(number)) {
        return number.map(convertOne);
    }

    return convertOne(number);
}
