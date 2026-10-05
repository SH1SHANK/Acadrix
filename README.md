# Acadrix

> Read all questions in one scrollable sheet, export assessments, and track deadlines on the IITM Online Degree portal.

[Download latest release](../../releases/latest)

[![CI](https://github.com/SH1SHANK/unfold-iitm/actions/workflows/ci.yml/badge.svg)](https://github.com/SH1SHANK/unfold-iitm/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/SH1SHANK/unfold-iitm?include_prereleases)](../../releases)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

<sub>Unofficial, beta, not affiliated with IIT Madras. <a href="NAMING.md">Why Acadrix?</a></sub>

<img width="800px" alt="Acadrix in action" src=".github/assets/acadrix-demo.gif" />

## Features

- View all questions on one scrollable sheet (`Alt+Q`)
- Direct PDF download with formatted formulas and diagrams
- Markdown export with KaTeX mathematical notation
- Offline ZIP bundles containing the markdown document and extracted image assets
- 1-click copy for LLM prompts with review answers stripped
- Answer review panel to inspect and sync structured answer keys with portal controls
- Background deadline tracking with desktop notifications for pending assignments
- Optional Satoshi typography override for the portal interface
- Dark, light, and system color themes with isolated Shadow DOM styles

## Installation

### Chrome and Chromium (Recommended)

1. Download `acadrix-v0.3.0-chrome-extension.zip` from [Releases](../../releases/latest).
2. Extract the archive.
3. Open `chrome://extensions` and enable **Developer mode** in the top right.
4. Click **Load unpacked** and choose the extracted folder.

### Firefox

1. Download and extract the extension archive.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on...** and select `manifest.json`.

### Bookmarklet (Zero Install)

1. Open `bookmarklet/install.html` in your browser.
2. Drag the **Acadrix** button to your bookmarks bar.
3. Click it while viewing any active assessment to open the reader.

## Development

```bash
# Assemble extension and bookmarklet targets
node build.mjs

# Syntax check generated bundles
npm run check

# Run architecture verification and fixture tests
npm test

# Run real-browser smoke test (headless Chrome)
npm run test:browser

# Verify build integrity and bookmarklet diff
npm run verify
```

## How It Works

The IITM portal displays assessment questions one at a time across paginated chips. Acadrix navigates the chips in memory to extract question stems, math formulas, and option choices into an isolated Shadow DOM drawer. It operates in read-only mode and does not alter submission timers or auto-submit answers.

## Disclaimer

Beta and unofficial. Acadrix provides read-only inspection and export utilities; it does not answer or modify assignments for you. Always verify your official submission directly on the portal. "IITM" is used solely to identify portal compatibility.

## License

[MIT](LICENSE)
