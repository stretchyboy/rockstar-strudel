# Plan: shipping `rockstar-strudel` from a RockstarLang/rockstar fork

This document describes every step needed to wire the existing Starship WASM
engine up to the `rockstar` template-tag module in this repo so that
strudel.cc users can simply write:

```js
import { rockstar } from 'https://esm.sh/rockstar-strudel'
const data = await rockstar`Shout 42`
// data === [42]
```

---

## Background: why anything needs to change

The Starship engine is already built and running at
`https://codewithrockstar.com/wasm/`.  The issue is that browsers enforce the
**Same-Origin Policy**: a page on `strudel.cc` cannot load a JS/WASM module
from `codewithrockstar.com` unless that server explicitly opts in via a CORS
header.

Two things are therefore needed:

1. **CORS headers** on the WASM assets at `codewithrockstar.com`.
2. **An npm-published JS package** (`rockstar-strudel`) that dynamically loads
   those WASM assets and exposes the `rockstar` template tag.

The JS package lives in *this* repo (`stretchyboy/rockstar-strudel`).  The
CORS change must happen in the **RockstarLang/rockstar** fork (or its hosting
configuration).

---

## Step 1 — Fork RockstarLang/rockstar

```bash
# on GitHub: fork RockstarLang/rockstar to your account
git clone https://github.com/<you>/rockstar.git
cd rockstar
```

---

## Step 2 — Add CORS headers to the WASM assets

The `codewithrockstar.com` site is a Jekyll project deployed (most likely) via
GitHub Pages, with the WASM files published separately to the `/wasm/` path.

Choose the option that matches your hosting:

### Option A — Cloudflare (recommended)

If the domain is proxied through Cloudflare (orange cloud in DNS settings):

1. Go to **Cloudflare dashboard → your domain → Rules → Transform Rules →
   Modify Response Header**.
2. Create a new rule:
   - **Field**: URI Path  **Operator**: starts with  **Value**: `/wasm/`
   - **Action**: Set  **Header name**: `Access-Control-Allow-Origin`
     **Value**: `*`
3. Save and deploy.

Alternatively, add a `_headers` file at the root of the
`codewithrockstar.com/` directory (works with Cloudflare Pages):

```
# codewithrockstar.com/_headers
/wasm/*
  Access-Control-Allow-Origin: *
```

### Option B — Netlify

Add (or update) `codewithrockstar.com/_headers`:

```
/wasm/*
  Access-Control-Allow-Origin: *
```

Commit and push; Netlify picks this up automatically.

### Option C — Host the WASM on jsDelivr via GitHub Releases

jsDelivr mirrors GitHub release assets with CORS enabled.

1. Build the WASM (see Step 3).
2. Create a GitHub Release and upload the entire `wwwroot/` directory as a
   zip, or upload the individual `_framework/` files.
3. Reference them via jsDelivr:
   ```
   https://cdn.jsdelivr.net/gh/<you>/rockstar@<tag>/wasm/wwwroot/_framework/dotnet.js
   ```
4. Pass this URL to `init()` in the JS module (or update `DEFAULT_DOTNET_URL`
   in `src/index.js`).

> **Note**: jsDelivr does not serve binary `.wasm` files with the correct
> `application/wasm` MIME type from GitHub Releases.  Use this option only if
> you can confirm MIME types are correct, or bundle the WASM into the npm
> package instead (see Step 5).

---

## Step 3 — Build the WASM locally to verify

You need the **.NET 9 SDK** (`dotnet --version` should show `9.x`).

```bash
cd Starship
dotnet publish Rockstar.Wasm -c Release -o ../wasm-publish
```

The output in `../wasm-publish/wwwroot/` contains:

```
_framework/
  dotnet.js               ← the JS loader
  dotnet.native.js
  dotnet.runtime.js
  dotnet.wasm             ← the .NET runtime (~7 MB, AOT-compiled in Release)
  Rockstar.Wasm.wasm      ← the Rockstar engine
  ... (satellite assemblies, boot config, etc.)
```

Serve this folder locally and verify it works:

```bash
cd ../wasm-publish/wwwroot
npx serve -p 8080
# open http://localhost:8080 and check the browser console
```

---

## Step 4 — Smoke-test the JS module against your local WASM

Clone this repo, then:

```bash
cd rockstar-strudel
npm test           # 19 unit tests, all pure JS — no WASM needed
```

To do a browser integration test, create a minimal HTML file:

```html
<!-- /tmp/test.html -->
<script type="module">
  import { init, rockstar } from './src/index.js'

  // Point at the locally-served WASM
  await init('http://localhost:8080/_framework/dotnet.js')

  const result = await rockstar`
    My heart is 123
    Let your love be 456
    Put 789 into the night
    Shout my heart. Scream your love. Whisper the night.
  `
  console.assert(JSON.stringify(result) === '[123,456,789]',
    'Expected [123,456,789], got ' + JSON.stringify(result))
  document.body.textContent = JSON.stringify(result)
</script>
```

Serve it from the same origin as the WASM (to avoid CORS issues during local
testing):

```bash
# from the wasm-publish/wwwroot directory
cp /path/to/test.html .
npx serve -p 8080
# open http://localhost:8080/test.html
```

---

## Step 5 — Publish the JS module to npm

### 5a — Update DEFAULT_DOTNET_URL if needed

If you are serving the WASM from your own URL (not the upstream
`codewithrockstar.com`), update the constant in `src/index.js`:

```js
const DEFAULT_DOTNET_URL =
  'https://codewithrockstar.com/wasm/wwwroot/_framework/dotnet.js';
  //  ↑ change to your own CDN URL if you forked the hosting
```

### 5b — Publish

```bash
cd rockstar-strudel
npm publish --access public
```

The package will be available at `https://esm.sh/rockstar-strudel` (esm.sh
auto-publishes packages from npm with proper CORS headers and ESM wrapping).

---

## Step 6 — Add a CI workflow to keep the WASM in sync (optional)

Add `.github/workflows/publish-strudel-js.yml` to the rockstar fork:

```yaml
name: Publish rockstar-strudel

on:
  release:
    types: [published]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '9.x'

      - name: Build WASM
        run: dotnet publish Starship/Rockstar.Wasm -c Release -o wasm-publish

      # If you host the WASM yourself: upload wasm-publish/wwwroot to your CDN
      # here, e.g. via an AWS S3 sync, Cloudflare Pages deploy, etc.

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'

      - name: Publish rockstar-strudel to npm
        run: npm publish --access public
        working-directory: path/to/rockstar-strudel
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

## Summary checklist

- [ ] Fork `RockstarLang/rockstar`
- [ ] Add `Access-Control-Allow-Origin: *` to the `/wasm/` path on
      `codewithrockstar.com` (Cloudflare rule, `_headers` file, or alternative
      CDN)
- [ ] Build the WASM with `dotnet publish Rockstar.Wasm -c Release` and verify
      it works locally
- [ ] Smoke-test `src/index.js` against the local WASM build
- [ ] Update `DEFAULT_DOTNET_URL` in `src/index.js` if serving from a
      different URL
- [ ] `npm publish` the `rockstar-strudel` package
- [ ] Verify in strudel.cc: `import { rockstar } from 'https://esm.sh/rockstar-strudel'`
