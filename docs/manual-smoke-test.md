# Unfold IITM — Final Release Verification & Manual Smoke-Test Checklist

This document serves as the final release verification matrix and step-by-step live-portal smoke-test checklist for Unfold IITM.

---

## 1. Release Verification Matrix (Automated vs. Manual vs. Not Verified)

To ensure verification integrity, every release requirement is explicitly classified into one of three categories:

1. **Automated (Verified in Node / Real-Browser Test Suites)**: Verified automatically on every `npm test` run across 10 test runners (9 deterministic Node suites + 1 real-browser Headless Google Chrome smoke suite).
2. **Manual (Requires Live Authenticated IITM Portal)**: Verified manually by a developer/tester logged into `https://study.iitm.ac.in/` using the checklist in Sections 2–4 below.
3. **Not Verified Automatically**: Capabilities that depend on live IITM student Single Sign-On (SSO) credentials or native OS print-dialog confirmation and therefore cannot be executed unattended in local/CI automation.

### 1.1 Automated (Verified in Node & Real-Browser Test Suites)

| Subsystem / Capability | Verification Environment | Runner Script | Status |
| :--- | :--- | :--- | :---: |
| Architectural boundaries, module graph, & zero DOM leaks in exporters | Node Static & AST Analysis | `scripts/verify-architecture.mjs` (13 checks) | **Automated** |
| Canonical `AssignmentDocument` model & 6 IITM HTML fixture contracts | Node Deterministic Suite | `scripts/test-fixtures.mjs` (4 checks / 6 fixtures) | **Automated** |
| Multi-window paginator traversal, `MutationObserver` readiness, & position restoration | Node Deterministic Suite | `scripts/test-traversal.mjs` (10 checks) | **Automated** |
| High-fidelity semantic extraction (LaTeX, MathML, code, tables, images, SVGs, options, review) | Node Deterministic Suite | `scripts/test-semantic-extraction.mjs` (18 checks) | **Automated** |
| Deterministic LLM-ready Markdown export & byte-for-byte golden fixtures | Node Deterministic Suite | `scripts/test-markdown-exporter.mjs` (27 checks: 22 unit + 5 golden) | **Automated** |
| Resource discovery, deduplication, retry/timeout, MIME magic bytes, & asset rewriting | Node Deterministic Suite | `scripts/test-resource-engine.mjs` (20 checks) | **Automated** |
| Standalone print-ready PDF HTML rendering, `@page` typography, & break controls | Node Deterministic Suite | `scripts/test-pdf-exporter.mjs` (28 checks) | **Automated** |
| Export orchestration, cache invalidation, 5-stage cancellation, path safety, external `unzip -t` round-trip, cross-output consistency, & 25Q performance smoke | Node + System `unzip` CLI | `scripts/test-export-orchestration.mjs` (32 checks) | **Automated** |
| Runtime/Reader/Orchestrator state machine & DOM wiring under simulated Shadow DOM | Node DOM Simulation | `scripts/test-browser-integration.mjs` (7 checks) | **Automated** |
| End-to-end runtime launch (`build/run.js`), real Shadow DOM, real `MutationObserver` traversal, Reader UI, `.md`/`.zip` `Blob` + `URL.createObjectURL` + `<a download>` + `URL.revokeObjectURL`, `.saq-pdf-print-frame` iframe lifecycle, system `unzip -t` on Chrome ZIP, busy-state duplicate click blocking, zero console errors, & `destroy()` teardown | **Real Browser (Headless Google Chrome)** | `scripts/test-real-browser.mjs` (7 checks) | **Automated** |

### 1.2 Manual (Requires Live Authenticated IITM Portal)

| Capability / Scenario | Why Manual Verification Is Required | Verification Procedure |
| :--- | :--- | :--- |
| Live `study.iitm.ac.in` assessment detection & Angular hydration | Requires authenticated student Google/IITM SSO session on live portal | Section 3 (Steps 1–6) & Scenarios A–D |
| Live cross-origin signed asset fetching (GCS / IITM CDN images) | Live assessment images may use time-limited signed URLs or portal cookies | Section 4 (Scenario G) |
| Interactive browser Print Preview visual inspection & "Save as PDF" | Headless Chrome verifies iframe DOM, image load, `contentWindow.print()`, and `afterprint` cleanup, but visual pagination review uses the interactive print preview | Section 4 (Scenario F) |
| Live bookmarklet execution from browser bookmarks bar | Requires user click on bookmarks bar in an active browser tab | Build `bookmarklet/install.html`, drag to bar, click on quiz page |

### 1.3 Not Verified Automatically (Explicit Boundaries)

- **Live IITM Portal Execution**: Not executed in automated test runs because automated scripts have no access to authenticated `study.iitm.ac.in` student credentials or live course assessments.
- **Native OS Print Dialog File Save**: Automated real-browser tests verify the complete `.saq-pdf-print-frame` iframe creation, stylesheet/image/SVG rendering, single `contentWindow.print()` invocation, and `afterprint` DOM removal, but do not click the OS-native print dialog's "Save" button.

---

## 2. Prerequisites for Manual Live-Portal Smoke Testing

1. Run the build and automated verification suite:
   ```bash
   npm run build && npm run check && npm test
   ```
2. Open Chrome (or Chromium-based browser):
   - Navigate to `chrome://extensions/`.
   - Enable **Developer mode** (toggle in upper right).
   - Click **Load unpacked** and select the `/build` directory of this repository.
   - Alternatively for Firefox: Navigate to `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and select `build/manifest.json`.
3. Log in to the IITM Online Degree portal (`https://study.iitm.ac.in/`).
4. Navigate to any active course and open a Quiz or Graded/Practice Assignment containing multiple questions.

---

## 3. Traversal Verification Scenarios (Live Portal)

### Scenario A: Single-Window Assessment (< 10 Questions)
1. Open an assessment with fewer questions than the chip window limit (all chips visible without chevron buttons).
2. Note the initial active question (e.g., Question 3).
3. Trigger Unfold (`Alt+Q`).
4. **Verification**:
   - `QuestionTraverser` iterates chips 1..N sequentially.
   - `MutationObserver` detects question container updates without falling back to timeout limits.
   - Traversal completes and restores the active chip back to Question 3.
   - Browser console logs no `NavigationTimeoutError` or `RestorationError`.

### Scenario B: Multi-Window Assessment (> 10 Questions with Pagination Arrows)
1. Open an assessment with paginator controls (`.arrow-btn`, chevrons, or next/prev buttons).
2. **Test Run 1 (Start from Question 1)**:
   - Begin on Question 1 in Window 1. Trigger Unfold.
   - Verify chips 1..10 are traversed.
   - Verify `advanceWindow()` clicks the forward paginator chevron and waits for window identity change.
   - Verify subsequent chips (11..N) are dynamically discovered and traversed without duplicate indices.
   - Verify restoration rewinds back through the paginator windows to restore active state to Question 1.
3. **Test Run 2 (Start from Middle Window / Question)**:
   - Navigate to a question in Window 2 (e.g., Question 14).
   - Trigger Unfold.
   - Verify initial window rewinds or progresses systematically across all windows (1..N).
   - Verify that upon completion, `QuestionTraverser.restoreLocation()` navigates through paginator arrows back to Window 2 and activates Question 14.
4. **Test Run 3 (Start from Last Question in Final Window)**:
   - Navigate to the final question (e.g., Question 25 in Window 3).
   - Trigger Unfold.
   - Verify all questions 1..25 are traversed deduplicated.
   - Verify active chip is restored to Question 25 in Window 3.

### Scenario C: Angular DOM Replacement & Stale Node Resiliency
1. Inspect elements with DevTools while traversal is running.
2. Verify `QuestionTraverser` queries the question container and active chip dynamically on each step, preventing stale node reference errors even when Angular completely detaches and replaces `app-assessment-question-view`.

### Scenario D: Navigation & Timeout Diagnostics
1. If network latency delays question rendering beyond 3500ms:
   - Verify console outputs a structured warning with question index, expected vs actual question number, and elapsed time.
   - Traversal must not hang indefinitely; it should reject or throw a structured `NavigationTimeoutError` / `TraversalError`.

---

## 4. End-to-End Export Orchestration Scenarios (Live Portal)

### Scenario E: Markdown (.md) Export
1. While the Unfold reader drawer is open, click the **Export Markdown** button (`[data-act="export-md"]`) in the header actions bar.
2. Verify:
   - Export buttons indicate busy state (`disabled` + `.is-busy`).
   - No quiz re-traversal occurs; the existing canonical `AssignmentDocument` is serialized immediately.
   - The browser initiates a file download named `<assignment-title>.md`.
   - Temporary `<a download>` is immediately removed from `document.body` and the Blob URL is revoked.
   - Open the `.md` file in a Markdown viewer / editor:
     - Document header contains `# <Title>`, `**Course:**`, `**Questions:**`.
     - Equations are cleanly preserved in LaTeX `$...$` / `$$...$$`.
     - Code blocks preserve language and indentation.
     - Tables render as valid GitHub-Flavored Markdown.
     - Images maintain valid reference tags.

### Scenario F: High-Fidelity PDF & Print Export
1. Click the **Print / PDF** button (`[data-act="print"]`) in the header actions bar.
2. Verify:
   - A hidden rendering iframe (`.saq-pdf-print-frame`) is created with the full print stylesheet (`PDF_CSS`).
   - The browser native Print dialog opens once all images finish loading.
   - Print preview displays:
     - Clean academic typography with cover header.
     - Rendered mathematical formulas (KaTeX / MathML).
     - Page break controls (`break-inside: avoid` prevents questions from cutting awkwardly across pages).
     - Clean margins and page numbering.
   - Closing or cancelling the print dialog removes `.saq-pdf-print-frame` from the DOM without leaving ghost iframes.

### Scenario G: Portable ZIP Bundle (.zip) Export
1. Click the **Export Bundle** button (`[data-act="export-bundle"]`) in the header actions bar.
2. Verify:
   - Button busy state is engaged.
   - Assets (diagrams, figures, formula screenshots) are acquired and validated.
   - Standard PKZIP 2.0 archive is generated and downloaded as `<assignment-title>.zip`.
   - Extract the `.zip` archive on your system (`unzip -t` / Archive Utility):
     - Entries are deterministically ordered: `assignment.md`, `metadata.json`, `manifest.json`, `assets/...`.
     - `assets/` subfolder contains all downloaded images and materialized SVGs with safe, collision-free names (e.g., `q01-image-01.png`, `q02-diagram-01.svg`).
     - Image links inside `assignment.md` point to `assets/...` relative local paths where download succeeded, and preserve original URLs where any asset failed.
     - `manifest.json` specifies `"version": "1.0.0"` with accurate status and MIME types for all assets.

### Scenario H: Concurrency Guard, Dismissal Policy, & Busy State
1. Click any export button and immediately click another export action:
   - Verify duplicate clicks are blocked while an export operation is in flight.
   - Verify buttons restore to clickable state once the export finishes, fails, or is cancelled.
2. Dismiss the Reader drawer (`Escape`) while an export is running:
   - Verify Policy A (Background Completion): the drawer closes cleanly while the active export completes its download without leaving buttons stuck on reopen.

---

## 5. 15-Step Live-Portal Smoke-Test Checklist

| Step # | Test Action | Expected Result | Verification Mode | Pass / Fail |
| :---: | :--- | :--- | :---: | :---: |
| **1** | Open an active IITM assessment page. | Page loads with question view (`app-assessment-question-view`) and chip bar (`div.chips`). | Manual (Live) / Automated (Fixture) | [ ] |
| **2** | Inspect DOM detection. | Extension detects the assessment without throwing errors in the browser console. | Manual (Live) / Automated (Chrome) | [ ] |
| **3** | Check Launcher Pill appearance. | Floating pill button (`#saq-launcher` with "All Questions" and icon) appears in the configured position (default: bottom-center). | Manual (Live) / Automated (Chrome) | [ ] |
| **4** | Trigger Unfold opening. | Click the launcher button OR press the configured shortcut (`Alt+Q` / `Option+Q`). | Manual (Live) / Automated (Chrome) | [ ] |
| **5** | Verify Progress Overlay. | Centered loading card (`#saq-overlay`) appears displaying spinner, progress bar, and "Loading questions X/Y". | Manual (Live) / Automated (Chrome) | [ ] |
| **6** | Verify Question Traversal. | Chips are sequentially clicked and traversed. Active chip restores to the user's starting question when traversal finishes. | Manual (Live) / Automated (Chrome) | [ ] |
| **7** | Verify Reader Drawer. | Bottom sheet (`#saq-sheet`) slides up over a dimmed backdrop (`#saq-backdrop`). | Manual (Live) / Automated (Chrome) | [ ] |
| **8** | Inspect Question Content. | Question stems (text, math formulas, code) and answer options display cleanly in numbered cards (`.saq-block`). | Manual (Live) / Automated (Chrome) | [ ] |
| **9** | **Safety Check: Verify Zero Live Form Mutation**. | Selecting or clicking radio buttons/checkboxes in the Unfold reader drawer does **NOT** alter the underlying live IITM portal form. Inputs in Unfold are non-interactive/read-only. | Manual (Live) / Automated (Node) | [ ] |
| **10** | Verify Reader Dismissal. | Press `Escape`, click the close button, click the backdrop, or drag down the grip handle (`.saq-grip`). The drawer smoothly slides down and closes. | Manual (Live) / Automated (Node) | [ ] |
| **11** | Verify Reopening & Cache. | Click the launcher again. The drawer reopens immediately without re-triggering the traversal progress overlay. Click "Refresh" to verify re-traversal on demand. | Manual (Live) / Automated (Node) | [ ] |
| **12** | **Export Markdown (.md)**. | Click Markdown action button in header. Download `<title>.md` triggers; content matches canonical assignment without re-traversal. | Manual (Live) / Automated (Chrome) | [ ] |
| **13** | **Export Print / PDF**. | Click Print action button in header. Native print preview displays clean academic PDF layout with math and break controls; iframe is removed after print. | Manual (Live) / Automated (Chrome) | [ ] |
| **14** | **Export Bundle (.zip)**. | Click Bundle action button in header. Valid ZIP file downloads containing `assignment.md`, `metadata.json`, `manifest.json`, and `assets/`. | Manual (Live) / Automated (Chrome) | [ ] |
| **15** | Verify Navigation Teardown. | Navigate away from the assessment (e.g. back to Course Dashboard). Unfold cleans up its `#unfold-root` Shadow DOM container; no ghost buttons, anchors, or iframes remain. | Manual (Live) / Automated (Chrome) | [ ] |
