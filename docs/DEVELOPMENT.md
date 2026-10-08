# Development

## Prerequisites

- Node.js 22 (the version used by CI) and npm.
- Git.
- Chrome or Chromium for loading the unpacked extension and running the optional real-browser tests.

## Setup and build

```bash
npm ci
node build.mjs
```

`build.mjs` builds the extension into the ignored `build/` directory and regenerates the committed bookmarklet outputs. Edit modular source under `src/` for bundled functionality; edit extension static assets under `extension/`. Do not hand-edit generated `build/` output or generated bookmarklet files.

## Validation

```bash
npm run check
npm test
```

The Node-based suite includes architecture checks and deterministic fixtures. Optional browser tests require a local Chrome/Chromium installation:

```bash
npm run test:browser
```

See [Testing](TESTING.md) for exactly what CI covers and what remains local/manual.

## Load the extension locally

1. Run `node build.mjs`.
2. Open `chrome://extensions` in Chrome/Chromium and enable **Developer mode**.
3. Select **Load unpacked** and choose the repository's `build/` directory.
4. Reload the extension after source changes, then refresh the IITM tab.

## Useful source areas

- `src/portal/`, `src/traversal/`, `src/extraction/` — portal detection and document extraction.
- `src/model/`, `src/document/` — canonical data and export compilation.
- `src/bridge/` — page bridge, answer protocol, and editor coordination.
- `src/ui/` — launcher, Reader, and CodeMirror editor.
- `src/exporters/`, `src/resources/`, `src/orchestration/` — document export and resource packaging.
- `src/notifications/` — academic-event retrieval and notification scheduling.
- `extension/` — Manifest V3 files, background worker, and packaged vendor/static assets.

For contribution and review requirements, see [Contributing](CONTRIBUTING.md).
