<p align="center">
  <img width="80px" alt="Acadrix icon" src="extension/icons/icon-128.png" />
</p>

<h1 align="center">Acadrix</h1>

<p align="center">
  <strong>High-fidelity assignment extractor, reader drawer & workflow suite for the IITM Online Degree portal.</strong>
</p>

<p align="center">
  <a href="https://github.com/SH1SHANK/unfold-iitm/releases/latest">
    <img src="https://img.shields.io/github/v/release/SH1SHANK/unfold-iitm?label=Release&color=blue" alt="Latest Release" />
  </a>
  <a href="https://github.com/SH1SHANK/unfold-iitm/actions/workflows/ci.yml">
    <img src="https://github.com/SH1SHANK/unfold-iitm/actions/workflows/ci.yml/badge.svg" alt="CI Status" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License: MIT" />
  </a>
</p>

<p align="center">
  <sub>Unofficial, beta, not affiliated with IIT Madras. <a href="NAMING.md">Why Acadrix?</a></sub>
</p>

<p align="center">
  <img width="800px" alt="Acadrix in action" src=".github/assets/acadrix-demo.gif" />
</p>

---

## ✨ Features

- **📖 Unified Reader Drawer (`Alt+Q`)**: View all assignment questions in a single scrollable sheet. Traverser captures prompts, mathematical equations (KaTeX), tables, diagrams, and options without modifying quiz answers.
- **⚡ 1-Click AI Prompt Serialization**: Generate clean, LLM-optimized prompts in one click—stripping sensitive grades and review markers while preserving full mathematical formulas and figures.
- **🎯 Interactive Answer Key Review**: Import structured AI answer keys (`MCQ`, `MSQ`, `Numerical`, `Text`) with real-time status badges (`AI Match`, `Overridden`, `Invalid`), preview choices, and sync answers with the portal safely.
- **📄 Multi-Format Exporters**:
  - **Direct PDF**: Instant high-fidelity PDF download with intelligent course filenames.
  - **Clean Markdown**: GitHub Flavored Markdown with preserved KaTeX math and layout tables.
  - **Offline ZIP Bundles**: Self-contained ZIP packages bundling the document, figures, SVG plots, and images.
- **⏰ Smart Deadline & Notification Engine**:
  - Exact Asia/Kolkata (`IST`) timezone deadline evaluation.
  - Automatic background alarm scheduling for upcoming unsubmitted deadlines (1 day, 6 hours, 1 hour).
  - Intelligent suppression when assignments are marked submitted or evaluated.
- **🎨 Portal Decorator & Aesthetics**:
  - Optional Satoshi typography enhancement for portal navigation.
  - Deadline badges and grade status indicators in the portal course sidebar.
  - Light, dark, and system theme synchronization with isolated Shadow DOM encapsulation.

<p align="center">
  <img width="320px" alt="Acadrix Popup Interface" src=".github/assets/hero.png" />
</p>

---

## 🚀 Installation

### Option 1: Chrome Extension (Recommended)

1. Download `acadrix-v0.3.0-chrome-extension.zip` from **[Releases](https://github.com/SH1SHANK/unfold-iitm/releases/latest)**.
2. Unpack the downloaded `.zip` file into a folder.
3. Open your Chromium browser (Chrome, Brave, Edge, Arc) and navigate to `chrome://extensions`.
4. Enable **Developer mode** in the top right.
5. Click **Load unpacked** and select the extracted folder.

### Option 2: Firefox (Temporary Add-on)

1. Download and unpack the release archive.
2. Navigate to `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on...** and select `manifest.json`.

### Option 3: Browser Bookmarklet (Zero Install)

1. Open `bookmarklet/install.html` in your browser.
2. Drag the **Acadrix** button to your browser's bookmarks bar.
3. Click the bookmarklet on any IITM assignment page to open the Reader.

---

## 🛠️ Build & Development

The project uses zero external runtime dependencies for building:

```bash
# Assemble extension and bookmarklet distribution targets
node build.mjs

# Syntax check generated bundles
npm run check

# Execute comprehensive 15-suite test runner
npm test

# Run real-browser smoke tests (headless Chrome)
npm run test:browser

# Verify build integrity and consistency
npm run verify
```

---

## 🔒 Safety & Privacy

- **Read-Only / Non-Destructive**: Acadrix is designed for reading, reviewing, and offline study. It never auto-submits quizzes or alters portal submission timers.
- **Zero Remote Telemetry**: Your quiz contents and local grades stay entirely in your browser (`chrome.storage.local`).
- **Encapsulated Styles**: All reader UI components mount in an isolated Shadow DOM root, preventing CSS leakage to or from the host IITM portal.

---

## ⚖️ Disclaimer & License

Acadrix is an independent open-source project and is not affiliated with, endorsed by, or sponsored by IIT Madras. "IITM" is used solely to describe compatibility with the IITM Online Degree portal. Always verify your official assignment submissions directly on the portal.

Distributed under the [MIT License](LICENSE).
