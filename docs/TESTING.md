# Testing

## CI-safe validation

The GitHub Actions workflow runs on pushes to `main` and pull requests targeting `main`. It installs from `package-lock.json` with `npm ci`, validates the extension manifest, builds the extension/bookmarklet outputs, runs the syntax check and generated-bookmarklet drift check, then runs `npm test`.

`npm test` is deterministic Node-based verification. It runs `scripts/verify-architecture.mjs` and the repository's fixture, extraction, traversal, export, UI simulation, answer-protocol, notification, academic-event, and programming-assignment suites. The programming editor and privileged bridge tests use test doubles/fixtures; they do not log in to the IITM portal.

Run locally:

```bash
npm ci
node build.mjs
npm run check
npm test
```

`npm run check` validates syntax for generated JavaScript bundles. `npm run verify` combines a build, the generated bookmarklet drift check, and `npm test`.

## Real-browser tests (local only)

`npm run test:browser` runs `scripts/test-real-browser.mjs` and `scripts/test-real-browser-programming.mjs`. They launch a local Chrome/Chromium binary against local fixtures. CI does not run them because the repository does not provision a deterministic browser-test environment. Set `CHROME_BIN` if Chrome/Chromium is installed at a nonstandard path.

Run an individual programming browser test with:

```bash
node scripts/test-real-browser-programming.mjs
```

These tests do not verify behavior on a live authenticated IITM account. Do not report them as passing unless they were actually run and completed.

## Live portal checks

Authenticated IITM portal behavior requires a developer's own account and is not part of CI. A short manual checklist is in [Manual smoke test](manual-smoke-test.md). Do not include credentials, personal answers, or private course data in fixtures or test output.
