# rockstar-strudel

Run [Rockstar](https://codewithrockstar.com) programs from the
[strudel.cc](https://strudel.cc) live-coding REPL (or any browser-based JS
environment) via a simple template-tag function.

Every value printed by `Say` / `Shout` / `Scream` / `Whisper` becomes one
element of the returned array. The default `rockstar` view is now
numeric-first, so printed text is converted using Rockstar's poetic numeric
literal rules when needed.

For richer workflows (lyrics/text + numeric pipelines), use `rockstar_pro`.

---

## Using it in strudel.cc

```js
const { init, rockstar, rockstar_pro } = await import('https://esm.sh/rockstar-strudel')

// Pre-warm the WASM engine while other code loads (optional but recommended)
await init()

// Run a Rockstar program
const notes = await rockstar`
  Tommy was 60
  Say Tommy
  Build Tommy up, up, up, up
  Say Tommy
  Build Tommy up
  Shout Tommy
  Build Tommy up, up
  Scream Tommy
`
//notes === [60, 64, 65, 67]

note(seq(notes)).sound("piano")

// Rich result with parallel views
const pro = await rockstar_pro`
  Say hello world
  Shout [ "012", ["my dreams", "007"] ]
`

// Default numeric-first values for number-based Strudel functions
// pro.output === [55, [12, [26, 7]]]

// Mixed typed values with words preserved where possible
// pro.mixed_output === ["hello world", [12, ["my dreams", 7]]]

// Fully stringified values for speech/text workflows
// pro.text_output === ["hello world", ["12", ["my dreams", "7"]]]

// Raw callback lines from WASM
// pro.raw_output keeps trailing newlines exactly as emitted

// Exact source text executed (after template interpolation)
// pro.sourceText is available for lyric reuse

const root = 60
const melody = await rockstar_pro`
  Tommy was ${root}
  Build Tommy up, up, up, up
  Shout Tommy
`

// Run the same template again with new interpolation values
const shifted = await melody.rerun(62)
// or derive from the previous interpolation array
const shiftedAgain = await shifted.rerun(([prevRoot]) => [prevRoot + 2])
```


### Template interpolations

JavaScript values can be spliced into the source, letting you parameterise
programs from strudel patterns:

```js
const root = 60
const data = await rockstar`
  Tommy was ${root}
  Build Tommy up, up, up, up
  Shout Tommy
`
// data === [64]
```

---

## API

### `rockstar(strings, ...values)` → `Promise<Array<number|Array>>`

Tagged-template function. Runs the Rockstar source code and resolves with the
numeric-first output view, ready for number-based Strudel functions.

### `rockstar_pro(strings, ...values)` → `Promise<object>`

Tagged-template function with richer parallel output views:

- `sourceText`: exact Rockstar code that was executed.
- `raw_output`: raw callback lines from WASM (verbatim, including trailing newlines).
- `output`: numeric-first values (`number` or nested numeric arrays).
- `mixed_output`: mixed typed values with words preserved.
- `text_output`: fully stringified values for text/speech use.
- `templateValues`: the interpolation values used for this run.
- `rerun(...values)`: run the same template again, replacing interpolation
  values positionally. Calling `rerun()` with no arguments repeats the same run.

`output[i]`, `mixed_output[i]`, and `text_output[i]` always refer to the same
emitted line.

For JSON-style list output (for example `[ "012" ]`), all views parse the same
structure, and `output` resolves that case to `[12]`.

### `init([dotnetUrl])` → `Promise<void>`

Pre-loads the WASM engine.  Optionally accepts a custom `dotnet.js` URL (see
[PLAN.md](PLAN.md) for hosting your own copy with CORS headers).

### `buildSource(strings, ...values)` → `string`

Pure helper that reconstructs the full source string from a tagged-template
call.  Exported for testing.

### `coerce(line)` → `number | string | undefined`

Pure helper that converts a raw WASM callback line to a typed JS value.
Exported for testing.

### `parsePoeticNumber(text)` → `number | undefined`

Converts text using the Rockstar poetic numeric literal algorithm:
each word contributes one digit using its length modulo 10, hyphens count as
letters, apostrophes do not, statement-ending punctuation stops parsing, and
an ellipsis (`...` or `…`) introduces the decimal separator.

### `parseOutputLine(line)` → `object | undefined`

Parses one raw callback line into a dual-view structure used by
`rockstar_pro` (`raw`, `output`, `poetic`). Exported for testing.

---

## How it works

The Rockstar **Starship** engine is a .NET 9 application compiled to
WebAssembly.  The built WASM is hosted at `https://stretchyboy.github.io/rockstar/wasm` instead of
`https://codewithrockstar.com/wasm/`.  This package dynamically imports
`dotnet.js` from that URL, initialises the runtime, and calls
`RockstarRunner.Run(source, outputCallback, stdin, args)`, which is
`[JSExport]`'d from C#.

Each call to `Say`/`Shout`/`Scream`/`Whisper` in the Rockstar program triggers
the callback with the printed string (plus a trailing newline added by
`WasmIO.WriteLine` in C#).  The tag strips whitespace and coerces numeric
strings to `number`.

`rockstar_pro` adds a parsing layer on top of that callback stream:

- JSON-style lists are parsed when possible.
- List members are converted recursively.
- `output` is numeric-ready for sequence/math pipelines.
- `mixed_output` preserves words while keeping numbers typed.
- `text_output` keeps everything stringified for speech/lyrics workflows.

---

## CORS requirement

`codewithrockstar.com` must serve its `/wasm/` assets with the header

```
Access-Control-Allow-Origin: *
```

Without this, browsers will block the cross-origin `import()` of `dotnet.js`.

---

## Development

```bash
npm test        # run the 19 unit tests (pure JS logic, no WASM required)
```
