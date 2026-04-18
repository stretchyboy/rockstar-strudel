# Publishing rockstar-strudel to npm

This package is ready to publish from the repo root.

## 1. Log in to npm

```bash
npm login
```

If you already have a token-based setup, make sure you are logged in as the correct account:

```bash
npm whoami
```

---

## 2. Run the tests

From the project root:

```bash
npm test
```

You already verified the suite is passing.

---

## 3. Bump the version

Current version is the one in [package.json](package.json).

For a patch release:

```bash
npm version patch
```

For a minor release:

```bash
npm version minor
```

For a major release:

```bash
npm version major
```

This updates the version and creates a git tag.

---

## 4. Preview what will be published

```bash
npm pack --dry-run
```

Check that only the expected files are included.

---

## 5. Publish to npm

```bash
npm publish
```

If you ever need public access explicitly:

```bash
npm publish --access public
```

---

## 6. Push git commits and tags

```bash
git push && git push --tags
```

---

## Handy one-release flow

```bash
npm test && npm version patch && npm publish && git push && git push --tags
```

---

## Notes

- Package name: `rockstar-strudel`
- Entry point: [src/index.js](src/index.js)
- npm metadata is defined in [package.json](package.json)
- If `npm publish` fails because the version already exists, bump the version and try again.
