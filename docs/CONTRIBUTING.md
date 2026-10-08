# Contributing

Thanks for considering a contribution. Please keep changes focused and base behavior claims on the current source and fixtures.

## Before changing code

- Read the relevant architecture and feature documentation.
- Preserve the boundary between IITM DOM extraction, the canonical document, the Reader, and exporters.
- For programming edits, keep CodeMirror's local `workingCode` separate from IITM Ace and preserve the explicit privileged Apply Changes safeguards.
- For normal-answer changes, keep indexed records such as `1: A` as the canonical format; legacy parsing is compatibility only.
- Avoid adding dependencies unless the change requires them.

## Build and validate

Install dependencies reproducibly and run the CI-safe checks:

```bash
npm ci
node build.mjs
npm run check
npm test
```

If you change source used by the bookmarklet, include regenerated bookmarklet outputs from `node build.mjs`. Do not edit generated bundles by hand. Optional real-browser tests are local-only and require Chrome/Chromium; see [Testing](TESTING.md).

## Pull requests

- Explain the behavior change and relevant constraints.
- Include or update deterministic tests when behavior changes materially.
- Update documentation when current behavior or supported commands change.
- Do not commit credentials, local configuration, generated build output, browser profiles, or debugging artifacts.
- For a significant architectural decision, add a concise ADR under `docs/decisions/`.

See [Development](DEVELOPMENT.md) for setup and [Testing](TESTING.md) for validation scope.
