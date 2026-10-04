<img width="72px" alt="Acadrix icon" src="extension/icons/icon-128.png" />

# Acadrix

> Declutter the IITM Online Degree portal.

**[Download the latest release](../../releases/latest)**

[![CI](https://github.com/civiks/unfold-iitm/actions/workflows/ci.yml/badge.svg)](https://github.com/civiks/unfold-iitm/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/civiks/unfold-iitm?include_prereleases)](../../releases)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

<sub>Unofficial, beta, not affiliated with IIT Madras. <a href="NAMING.md">Why Acadrix?</a></sub>

<img width="800px" alt="Acadrix in action" src=".github/assets/demo.gif" />

## Features

- View all questions in a single scrollable sheet
- Print or save an assessment as PDF
- High-fidelity typography and layout
- Clean reader drawer and sidebar decorations
- Compact mode
- Master on/off toggle
- Configurable keyboard shortcut

<img width="300px" alt="Acadrix popup" src=".github/assets/hero.png" />

## Install

Not on the Chrome/Firefox stores yet. Install it manually:

1. Download the zip from [Releases](../../releases/latest).
2. Unzip it.
3. Open `chrome://extensions`, turn on "Developer mode" (top right).
4. Click "Load unpacked" and select the unzipped folder.

On Firefox: open `about:debugging`, click "Load Temporary Add-on", and pick `manifest.json` from the unzipped folder.

No install needed? Open `bookmarklet/install.html` and drag the button to your bookmarks bar.

## Build & Test

```bash
node build.mjs       # Assemble extension and bookmarklet targets
npm test             # Run architecture verification and fixture tests
npm run check        # Syntax-check generated bundles
```

Manual smoke-testing on live IITM portals is documented in [docs/manual-smoke-test.md](docs/manual-smoke-test.md).
Full dev and release guide: [CONTRIBUTING](.github/CONTRIBUTING.md).

## How it works

The portal presents questions one at a time. Acadrix traverses the assignment, capturing questions into an encapsulated, read-only reader view. It does not alter or mutate your live quiz answers. Prompts, mathematical formulas, and options are preserved for study, review, and export.

## Disclaimer

Beta and unofficial. Acadrix provides read-only inspection and export; it does not answer or modify assignments for you. Always verify your official submission directly on the IITM portal. Not affiliated with IIT Madras; "IITM" only describes portal compatibility.

## License

[MIT](LICENSE)
