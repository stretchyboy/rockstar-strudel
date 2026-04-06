# Plan: shipping `rockstar-strudel` from a RockstarLang/rockstar fork

This document describes every step needed to wire the existing Starship WASM
engine up to the `rockstar` template-tag module in this repo so that
strudel.cc users can simply write:

```js
import { init, rockstar } from 'https://esm.sh/rockstar-strudel'
await init('https://<your-username>.github.io/rockstar/wasm/wwwroot/_framework/dotnet.js')
const data = await rockstar`Shout 42`
// data === [42]
```

---

## Background: why anything needs to change

The Starship engine is already built and running at
`https://codewithrockstar.com/wasm/`.  The issue is that browsers enforce the
**Same-Origin Policy**: a page on `strudel.cc` cannot load a JS/WASM module
from `codewithrockstar.com` unless that server explicitly opts in via a CORS
header (`Access-Control-Allow-Origin: *`).

`codewithrockstar.com` uses a **custom domain**, which means CORS headers must
be configured at the CDN/DNS level (e.g. Cloudflare) by the site owner — a
change that can't be made via a GitHub PR to the repo.

However, **GitHub Pages on `*.github.io` domains serves all static assets with
`Access-Control-Allow-Origin: *` built in**, at no extra configuration cost.
This means a fork of the repo deployed to GitHub Pages at its default
`<you>.github.io/rockstar` URL has CORS working immediately, with no CDN
setup needed.

The complete build pipeline (`.NET` WASM compile → Jekyll site build →
GitHub Pages deploy) is already automated in the repo's GitHub Actions
workflows, so enabling it on a fork is a matter of enabling Pages in the
fork's settings.

---

## Option A — Fork and host on GitHub Pages (unblocked today)

This is the fastest path. No CDN, no Cloudflare, no extra accounts needed.

### Step 1 — Fork `RockstarLang/rockstar`

Fork it on GitHub (keep it **public** so the free GitHub Pages tier is
available).

### Step 2 — Enable GitHub Pages on the fork

1. Go to your fork → **Settings → Pages**
2. Under *Build and deployment*, set Source to **GitHub Actions**
   (not a branch — the workflow handles deployment itself)
3. Save.

### Step 3 — Trigger the first build

The build pipeline is three chained workflows:

```
build-rockstar-2.0
  └─► release-rockstar-engine
        └─► build-and-deploy-codewithrockstar.com  →  GitHub Pages
```

Trigger the first one manually:
- Go to **Actions → build-rockstar-2.0 → Run workflow** (pick `main`)

This will:
1. Build the Starship .NET engine and run its tests
2. Compile the WASM with `dotnet publish Starship/Rockstar.Wasm -c Release`
3. Copy the WASM into the Jekyll site and deploy it to GitHub Pages

After a few minutes your site will be live at:
```
https://<your-username>.github.io/rockstar/
```

And the WASM loader will be at:
```
https://<your-username>.github.io/rockstar/wasm/wwwroot/_framework/dotnet.js
```

### Step 4 — Point `rockstar-strudel` at your fork

Update `DEFAULT_DOTNET_URL` in `src/index.js`:

```js
const DEFAULT_DOTNET_URL =
  'https://<your-username>.github.io/rockstar/wasm/wwwroot/_framework/dotnet.js';
```

Or leave the default pointing at `codewithrockstar.com` and let users pass
their own URL via `init()`:

```js
await init('https://<your-username>.github.io/rockstar/wasm/wwwroot/_framework/dotnet.js')
```

### Step 5 — Publish the npm package

```bash
cd rockstar-strudel
npm publish --access public
```

Users can then import from `https://esm.sh/rockstar-strudel`.

---

## Option B — PR / issue to `RockstarLang/rockstar` (long-term fix)

A PR to the repo **cannot** fix CORS for the custom domain by itself — that
change must be made in the Cloudflare (or equivalent CDN) dashboard by the
site owner.  The most useful thing you can do is:

1. **Open an issue** explaining the strudel.cc use case and asking them to add
   `Access-Control-Allow-Origin: *` to the `/wasm/` path in their CDN config.
   A single Cloudflare Transform Rule would fix it permanently for all users.

2. Optionally include a **PR that adds a `_headers` file** as a signal of
   intent (it has no effect on a custom domain, but documents the desired
   config):

   ```
   # codewithrockstar.com/_headers
   /wasm/*
     Access-Control-Allow-Origin: *
   ```

Once the upstream site adds the header, update `DEFAULT_DOTNET_URL` back to
`https://codewithrockstar.com/wasm/wwwroot/_framework/dotnet.js` so users
get the canonical URL by default.

---

## Summary

| Path | Works today? | Effort |
|---|---|---|
| Fork → GitHub Pages (Option A) | ✅ Yes, ~20 min | Fork + enable Pages + trigger build |
| PR/issue to upstream (Option B) | ⏳ Depends on maintainer | Low effort, uncertain timeline |

**Do both**: use Option A to unblock yourself right now, open an upstream
issue (Option B) so the permanent fix lands in `codewithrockstar.com`.

---

## Local smoke-test (optional but recommended)

To verify `src/index.js` against a local WASM build before publishing:

### Build the WASM locally

You need the **.NET 9 SDK** (`dotnet --version` should show `9.x`).

```bash
cd Starship
dotnet workload install wasm-tools
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
```

### Run the integration test

Create a minimal HTML file in the same directory as the WASM:

```html
<!-- wasm-publish/wwwroot/test.html -->
<script type="module">
  import { init, rockstar } from '/path/to/rockstar-strudel/src/index.js'

  // localhost is in the allowed URL list, so no allowlist update needed
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

Serve from localhost (same origin as the WASM avoids CORS entirely):

```bash
cd wasm-publish/wwwroot
npx serve -p 8080
# open http://localhost:8080/test.html
```

---

## Summary checklist

- [ ] Fork `RockstarLang/rockstar` on GitHub (keep public)
- [ ] Fork Settings → Pages → Source: **GitHub Actions**
- [ ] Actions → `build-rockstar-2.0` → **Run workflow** (triggers the full chain)
- [ ] Wait for Pages deployment; note your URL: `https://<you>.github.io/rockstar/`
- [ ] Update `DEFAULT_DOTNET_URL` in `src/index.js` to your fork's WASM URL
      (or let users pass it to `init()`)
- [ ] `npm publish --access public` the `rockstar-strudel` package
- [ ] Verify in strudel.cc:
      ```js
      import { init, rockstar } from 'https://esm.sh/rockstar-strudel'
      await init('https://<you>.github.io/rockstar/wasm/wwwroot/_framework/dotnet.js')
      const data = await rockstar`Shout 42`   // [42]
      ```
- [ ] Open an issue on `RockstarLang/rockstar` asking them to add
      `Access-Control-Allow-Origin: *` to `/wasm/` at their CDN level, so
      the default URL can eventually point back at `codewithrockstar.com`

