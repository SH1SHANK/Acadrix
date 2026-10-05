# Acadrix

> Assessment reader, multi-format exporter, AI review bridge, and deadline tracker for the IITM Online Degree portal.

[Download latest release](../../releases/latest)

[![CI](https://github.com/SH1SHANK/unfold-iitm/actions/workflows/ci.yml/badge.svg)](https://github.com/SH1SHANK/unfold-iitm/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/SH1SHANK/unfold-iitm?include_prereleases)](../../releases)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

<sub>Unofficial, beta, not affiliated with IIT Madras. <a href="NAMING.md">Why Acadrix?</a></sub>

<img width="800px" alt="Acadrix in action" src=".github/assets/acadrix-demo.gif" />

---

## Overview

The IIT Madras Online Degree portal presents assessments one question at a time across paginated navigation chips. Reviewing or exporting a multi-question quiz requires clicking through every chip, waiting for Angular DOM transitions, and managing unrendered formulas across separate views.

Acadrix is a client-side platform built to solve this limitation. It runs locally inside the browser to traverse paginated assessments, extract questions into an Abstract Syntax Tree (AST), and render a unified, scrollable sheet in an isolated Shadow DOM drawer (`Alt+Q`). Beyond read-only viewing, Acadrix provides a multi-format exporter suite, an interactive AI answer review workflow, sidebar portal decorations, automatic grade extraction, cloud synchronization, and background deadline notifications.

---

## Core Capabilities

### 1. Unified Assessment Reader
- **Single-Sheet Inspection**: Access all assessment questions, stems, formulas, options, and diagrams in one continuous scrollable view (`Alt+Q`).
- **Formula and Diagram Rendering**: Fully typesets KaTeX mathematical notation (`$...$` and `$$...$$`), MathML elements, complex tables, and high-resolution figures.
- **Image Lightbox**: Click-to-expand image modal supporting multi-level zoom, panning, and SVG preview.
- **Isolated Shadow DOM**: UI components and styles are completely encapsulated within `#unfold-root`, preventing style leakage into or from the host portal.
- **Appearance and Typography**: Configurable light, dark, and system themes, compact card spacing, selectable font sizes, and optional Satoshi typography override for the portal.

### 2. Multi-Format Exporter Suite
- **Direct PDF Export**: Generates vector-quality PDFs via Chrome DevTools Protocol (`Page.printToPDF` in background service worker) or print stylesheet emulation, preserving formulas and image layout without viewport clipping.
- **KaTeX Markdown**: Exports clean, compliant Markdown documents preserving LaTeX formulas, markdown tables, and code fences.
- **Self-Contained Offline ZIP Bundles**: Discovers embedded image assets, downloads them in a bounded concurrency pool, verifies MIME types, remaps relative asset paths, and packages the markdown document with an asset manifest into an offline ZIP archive.
- **Managed Export Sessions**: Controlled by `ExportOrchestrator` with lifecycle states (`IDLE`, `EXTRACTING`, `RESOLVING_RESOURCES`, `RENDERING`, `COMPLETED`), single-flight concurrency guards (`DoubleExportError`), and cancellation support.

### 3. Five-Stage AI Workflow and Answer Review Bridge
- **Stage 1: Question Selection and Scoping**: Choose all or a subset of questions for export, with real-time token estimation and figure attachment notices.
- **Stage 2: Sanitized Prompt Serialization**: Converts questions into structured, zero-leak prompt representations (`<assignment>`, `<question>`). Strips review feedback, grades, and answers when in review mode, formats code blocks, and instructs AI models to respond in a strict JSON answer schema.
- **Stage 3: Response Import and Parser**: 1-click clipboard paste or manual input parser that processes JSON/Markdown responses, resolving MCQ option letters (`A`, `(b)`, `C.`), MSQ selection arrays, and normalized numerical values (integers, decimals, negative values, and scientific notation).
- **Stage 4: Deterministic State Classification**: Compares AI suggestions against user choices, classifying each question with visual badges:
  - `AI Match` (Green): User selection matches AI suggestion.
  - `Overridden` (Amber): User selection differs from AI suggestion.
  - `AI Suggested` (Blue): AI suggestion available; not yet selected by user.
  - `Selected` (Accent): User selected without an AI suggestion.
  - `Unanswered` (Muted): No selection made.
  - `Invalid` (Red): Answer failed type validation or numerical parsing.
- **Stage 5: Safe Portal Synchronization**: Applies reviewed answers to the active IITM Angular form controls using native property descriptors and synthetic event dispatch (`input`, `change`, `blur`). Strictly maintains a zero auto-submission policy.

### 4. Portal Decorator and Grade Repository
- **Sidebar Badges**: Injects closed Shadow DOM badges into the course navigation tree, distinguishing Graded Assignments from Practice Assignments.
- **Live Deadline Indicators**: Displays absolute dates and relative countdowns ("Due in 2 days", "Past due") with color-coded warning (<48h) and error (overdue) thresholds.
- **Graded Row Visual Hierarchy**: Applies coordinated accent borders and typography weight to graded coursework rows.
- **Grade Extraction**: Scrapes student scores, peer averages, median scores, evaluation states, and submission statuses into the local canonical grade repository (`acx:grades:v1`).
- **Supabase Cloud Sync**: Connects the local grade repository and offline pending queue (`acx:pending-sync:v1`) to Supabase Edge Functions (`/functions/v1/grade-sync`) via authenticated requests (`x-sync-secret`), enabling unidirectional data flow (IITM Portal -> Acadrix Extension -> Supabase -> Web Dashboard) with single-flight locks and offline retries.

### 5. Smart Deadline Scheduler and Notifications
- **Asia/Kolkata Timezone Engine**: Evaluates deadlines strictly within `Asia/Kolkata` boundaries without external date library overhead.
- **Urgency Windows**: Evaluates assignments across standardized notification windows: 3 days prior, 24 hours prior, Due Today, 6 hours prior, and Overdue.
- **Submission Suppression Invariants**: Automatically suppresses all deadline notifications once an assignment is verified as submitted or completed.
- **Chrome Alarms Integration**: Background service worker reconciles alarm triggers on install, startup, and deadline changes, delivering native desktop alerts with click-to-focus navigation.

---

## Origins and Acknowledgements

Acadrix is a fork and evolution of the original prototype [civiks/unfold-iitm](https://github.com/civiks/unfold-iitm) and its companion design essay, [*Mirroring a live Angular quiz form*](https://civiks.tech/writing/mirroring-an-angular-quiz/) (published 24 June 2026).

### The Core Insight

The IITM assessment portal renders one question at a time using paginator chips (`div.chips button.chip`) and an Angular component (`app-assessment-question`). Because Angular binds answer state directly to event listeners on active DOM nodes, simple DOM cloning produces inert elements whose inputs never reach Angular's reactive form models or trigger backend autosaves.

The upstream prototype established that **display and state are separable**:
1. Question HTML can be captured sequentially for display.
2. The single live Angular component is kept mounted off-screen as the only writable state container.
3. User interactions on display snapshots are proxied back to the live component by clicking the corresponding paginator chip, replaying the action against live controls (`[role=radio]`, `[role=checkbox]`, native `input`/`textarea` setters), and flushing autosaves (`app-save-status`) by navigating away.

We credit and thank the original author for discovering this separation pattern and publishing the initial proof-of-concept.

---

## Architectural Evolution

While the upstream prototype proved the viability of single-question DOM proxying, Acadrix was re-architected from the ground up into a modular, production-grade academic assessment platform:

| Dimension | Upstream Prototype (`civiks/unfold-iitm`) | Acadrix Platform |
|---|---|---|
| **Document Representation** | Raw `.backend-html` and `.outerHTML` string chunks concatenated into DOM. Fragile to layout changes. | Pure Canonical Document Abstract Syntax Tree (`AssignmentDocument`, `QuestionNode`, `OptionNode`, `ContentNode`) separating extraction from presentation. |
| **Export Subsystem** | Basic on-screen HTML view only. No export capability. | Multi-format engine: headless CDP PDF generation, KaTeX Markdown export, self-contained offline ZIP bundles with localized media, and prompt serializers. |
| **Paginator Traversal** | Assumed flat, visible chips in a single row. Polled text changes with fixed timing delays. | Full multi-window traverser supporting `<` and `>` paging, MutationObserver settling, timeout fallbacks, and polite view state restoration. |
| **Answer Synchronization** | Direct background proxying immediately triggered clicks on live controls on snapshot click. | 5-stage workflow with structured parser, state classification (`AI Match`, `Overridden`, `Invalid`), manual override controls, and safe synthetic event dispatch. |
| **Portal Integration** | Injected global CSS directly into host page namespace. In-sheet header timer mirror. | Closed Shadow DOM (`#unfold-root`), design-token CSS (`DESIGN.md`), sidebar badge decorator, graded row styling, and Satoshi font injection. |
| **Grade Tracking & Sync** | None. In-memory session state only. | Canonical local grade store (`acx:grades:v1`), dirty queue (`acx:pending-sync:v1`), and authenticated unidirectional sync to Supabase Edge Functions. |
| **Deadline Alarms** | None. | Asia/Kolkata timezone deadline evaluator with background Chrome alarms and auto-suppression on submitted tasks. |
| **Target Compilation** | Single inline script. | Dual-target build pipeline producing a full-featured browser extension target and a lightweight bookmarklet compatibility target. |

---

## Codebase Architecture

The codebase is organized into modular subsystems under `src/`:

```text
src/
├── model/           # Canonical AST types, document model, builder, assembler
├── portal/          # IITM DOM selectors, adapter, and portal probe helpers
├── parsers/         # Semantic HTML AST walker and node converters
├── extraction/      # Extractor orchestrator and semantic parser
├── traversal/       # Paginator traverser, windowing, and error types
├── bridge/          # AI prompt serializer, JSON parser, answer state model, applicator
├── exporters/       # Markdown and PDF export generators
├── resources/       # Asset discovery, concurrent fetcher, MIME/magic-byte engine
├── orchestration/   # Export session management, bundle packager, concurrency lock
├── portal-decor/    # Sidebar badges, graded row styling, grade scraper, Supabase sync
├── notifications/   # Asia/Kolkata deadline evaluator, storage, and alarm scheduler
├── ui/              # Shadow root, launcher, drawer, review UI, lightbox, styles
├── utils/           # DOM helpers, math typesetting, timing, shortcuts
├── core/            # Lifecycle manager and runtime entry point
└── index.js         # Main module entry point
```

---

## Installation

### Chrome and Chromium (Recommended)

1. Download `acadrix-v0.3.0-chrome-extension.zip` from [Releases](../../releases/latest).
2. Extract the archive into a directory.
3. Open `chrome://extensions` in your browser and enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the extracted folder.

### Firefox

1. Download and extract the extension archive.
2. Navigate to `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on...** and select `manifest.json`.

### Bookmarklet (Zero-Install Compatibility)

1. Open `bookmarklet/install.html` in your browser.
2. Drag the **Acadrix** button to your bookmarks toolbar.
3. Click the bookmarklet while viewing an active assessment on the IITM portal.
*(Note: The bookmarklet target contains the core reader and traversal features; advanced exporters, direct CDP PDF, and cloud sync require the full extension target).*

---

## Extension Popup Interface

Clicking the Acadrix toolbar icon opens the extension popup dashboard:

- **Context-Aware Primary Action**: Shows assessment status on the active tab and opens or focuses the reader sheet.
- **Upcoming Deadlines Panel**: Lists active assignments sorted by deadline urgency with real-time status badges.
- **Operational Status Cards**:
  - **Local Repository**: Displays extracted grade records and tracked course counts.
  - **Supabase Cloud Sync**: Displays last successful sync timestamp, sync status, and a **Sync now** trigger.
- **Preferences**:
  - **Reader**: Theme selection (System, Light, Dark), Compact cards toggle, Text size selector.
  - **Features**: Highlight graded and deadlines toggle, Direct PDF download toggle, Deadline notifications toggle, Keyboard shortcut configuration (`Alt+Q` default).
  - **Portal**: Portal font override (Default, Satoshi).
  - **Data Management**: Clear saved deadlines, Clear local grade store.

---

## Development and Verification

The project requires Node.js (v18+) and zero external build tool dependencies.

```bash
# Assemble extension (build/run.js) and bookmarklet targets
node build.mjs

# Syntax check generated bundles
npm run check

# Run architecture verification and all 15 unit/integration test suites
npm test

# Run real-browser smoke test (headless Chrome)
npm run test:browser

# Full verification: rebuild, verify bookmarklet diff, and run all test suites
npm run verify
```

---

## Safety, Privacy and Academic Integrity

- **Local Execution**: Acadrix operates locally inside your browser session. Portal credentials and session tokens are never intercepted, stored, or transmitted.
- **Read-Only Invariant**: Acadrix inspects and formats assessment markup. It never alters assessment submission timers, intercepts grading logic, or auto-submits quizzes.
- **User Confirmation**: The Answer Review bridge requires manual user verification and application. Final assignment submission must always be performed directly on the official portal interface.
- **Disclaimer**: Unofficial software. "IITM" is used solely to identify portal compatibility. Always verify your official assignment submissions on the IIT Madras portal.

---

## License

[MIT](LICENSE)
