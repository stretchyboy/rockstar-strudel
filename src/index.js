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
 * The WASM engine is loaded from https://codewithrockstar.com/wasm/.
 * That origin must serve its WASM assets with
 *   Access-Control-Allow-Origin: *
 * See PLAN.md for instructions on enabling this in a rockstar fork.
 */

/** Default URL of the .NET WASM loader published by codewithrockstar.com. */
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
 * Template tag that executes a Rockstar program and returns an array of every
 * value printed by the program (via `Say` / `Shout` / `Scream` / `Whisper`).
 *
 * Values that parse as finite numbers are returned as JS `number`; everything
 * else is returned as a `string`.
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
 * @returns {Promise<Array<number|string>>}
 */
export async function rockstar(strings, ...values) {
  const code = buildSource(strings, ...values);
  const runner = await _runner();
  const outputs = [];

  await runner.Run(
    code,
    (line) => {
      const value = coerce(line);
      if (value !== undefined) outputs.push(value);
    },
    /* stdin */ '',
    /* args  */ ''
  );

  return outputs;
}
