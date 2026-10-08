# Contributing

See the maintained [contribution guide](../docs/CONTRIBUTING.md) for source boundaries, setup, validation, generated files, and pull-request expectations.

CI-safe validation runs with:

```bash
npm ci
node build.mjs
npm run check
npm test
```

The optional real-browser tests require a local Chrome/Chromium installation and are not run in CI. See [Testing](../docs/TESTING.md).
