# rockstar-strudel

Run [Rockstar](https://codewithrockstar.com) programs from the
[strudel.cc](https://strudel.cc) live-coding REPL (or any browser-based JS
environment) via a simple template-tag function.

Every value printed by `Say` / `Shout` / `Scream` / `Whisper` becomes one
element of the returned array.  Values that parse as finite numbers are
returned as JS `number`; everything else is returned as a `string`.

---

## Using it in strudel.cc

```js
const { init, rockstar } = await import('https://esm.sh/rockstar-strudel')

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

### `rockstar(strings, ...values)` → `Promise<Array<number|string>>`

Tagged-template function.  Runs the Rockstar source code and resolves with an
array of every printed value.

### `init([dotnetUrl])` → `Promise<void>`

Pre-loads the WASM engine.  Optionally accepts a custom `dotnet.js` URL (see
[PLAN.md](PLAN.md) for hosting your own copy with CORS headers).

### `buildSource(strings, ...values)` → `string`

Pure helper that reconstructs the full source string from a tagged-template
call.  Exported for testing.

### `coerce(line)` → `number | string | undefined`

Pure helper that converts a raw WASM callback line to a typed JS value.
Exported for testing.

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

---

## CORS requirement

`codewithrockstar.com` must serve its `/wasm/` assets with the header

```
Access-Control-Allow-Origin: *
```

Without this, browsers will block the cross-origin `import()` of `dotnet.js`.
See [PLAN.md](PLAN.md) for the exact steps needed in the rockstar fork.

---

## Development

```bash
npm test        # run the 19 unit tests (pure JS logic, no WASM required)
```
