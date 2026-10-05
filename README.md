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

The IITM portal displays assessment questions one at a time across paginated chips. Acadrix traverses the paginator in memory, extracts question stems, math formulas, and choices into a canonical document model, and renders the assessment inside an isolated Shadow DOM sheet (`Alt+Q`). It operates as a local view layer and never alters submission timers or auto-submits answers.

## Origins and Acknowledgements

Acadrix is a fork and evolution of the original prototype [civiks/unfold-iitm](https://github.com/civiks/unfold-iitm) and its companion design essay, [*Mirroring a live Angular quiz form*](https://civiks.tech/writing/mirroring-an-angular-quiz/) (published 24 June 2026).

### The Core Insight

The IITM assessment portal renders one question at a time using paginator chips (`div.chips button.chip`) and an Angular component (`app-assessment-question`). Because Angular binds answer state directly to event listeners on active DOM nodes, simple DOM cloning produces inert elements whose inputs never reach Angular's reactive form models or trigger backend autosaves.

The upstream prototype established that **display and state are separable**:
1. Question HTML can be captured sequentially for display.
2. The single live Angular component is kept mounted off-screen as the only writable state container.
3. User interactions on display snapshots are proxied back to the live component by clicking the corresponding paginator chip, replaying the action against live controls (`[role=radio]`, `[role=checkbox]`, native `input`/`textarea` setters), and flushing autosaves (`app-save-status`) by navigating away.

We credit and thank the original author for discovering this separation pattern and publishing the initial proof-of-concept.

## Architectural Evolution

While the upstream prototype proved the viability of single-question DOM proxying, Acadrix was re-architected from the ground up into a robust, standalone academic assessment platform:

### 1. Canonical Document AST vs Fragile DOM Clones
- **Upstream**: Captured raw `.backend-html` inner markup and serialized DOM outerHTML strings. Layout shifts or KaTeX wrapper variations on the portal broke the mirrored view.
- **Acadrix**: Replaced string scraping with a normalized Canonical Document Abstract Syntax Tree (`AssignmentDocument`, `QuestionNode`, `OptionNode`, `ContentNode`). Extraction parses math, tables, images, and option metadata into structured nodes before rendering, decoupling content extraction from the presentation layer.

### 2. Multi-Format Exporter Pipeline
- **Upstream**: Displayed questions only within a single in-page HTML view.
- **Acadrix**: Built a comprehensive exporter subsystem:
  - **PDF Export**: Print stylesheets and Chrome DevTools Protocol (CDP) print emulation that preserve math layout, formulas, and diagrams without viewport clipping.
  - **Markdown Export**: Clean Markdown generation preserving KaTeX mathematical formulas (`$...$` and `$$...$$`).
  - **Offline ZIP Bundles**: Self-contained archives containing the markdown document alongside extracted and base64-decoded image assets.
  - **LLM Prompt Builder**: 1-click serialization tailored for LLM reasoning prompts with review answers automatically stripped.

### 3. Multi-Window Paginator Traversal and View Restoration
- **Upstream**: Assumed all question chips were visible simultaneously in a flat list and polled DOM text changes with fixed delays.
- **Acadrix**: Implemented an automated paginator traverser that navigates windowed chip sets (including `<` and `>` pagination controls), stabilizes DOM transitions with MutationObserver listeners, and politely restores the portal back to the student's active question upon extraction.

### 4. Transparent Answer Review Bridge
- **Upstream**: Background proxying immediately fired click events on live controls upon snapshot interaction.
- **Acadrix**: Re-engineered into an explicit, transparent Answer Review layer. External answer keys are parsed, matched against option identifiers, and displayed with visual state badges (`AI Match`, `Overridden`, `Invalid`). Syncing requires deliberate user action, dispatching proper synthetic events (`input`, `change`, `blur`) via native prototype descriptors while guaranteeing that assessments are never automatically submitted.

### 5. Background Deadline Scheduler and Notifications
- **Upstream**: Limited to mirroring the live `app-submission-timer` text into the open reader header.
- **Acadrix**: Added a background deadline evaluator that parses Asia/Kolkata timezone deadlines, tracks weekly assignment cycles via Chrome alarms, issues desktop notifications before due dates, and auto-suppresses alerts once an assignment is submitted.

### 6. Shadow DOM Isolation and Design System
- **Upstream**: Injected global CSS directly into the host page, risking style bleed between the portal and the reader.
- **Acadrix**: Encapsulated entirely within `#unfold-root` using an isolated Shadow DOM root. UI chrome strictly adheres to the token-driven design system defined in `DESIGN.md`, paired with optional Satoshi typography enhancements for the host portal.

## Disclaimer

Beta and unofficial. Acadrix provides read-only inspection and export utilities; it does not answer or modify assignments for you. Always verify your official submission directly on the portal. "IITM" is used solely to identify portal compatibility.

## License

[MIT](LICENSE)
