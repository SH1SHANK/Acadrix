# Changelog

## [0.5.0-rc-1](https://github.com/SH1SHANK/Acadrix/compare/v0.4.0-rc.1...v0.5.0-rc-1) (2026-10-17)

### Highlights

- Added a course grade calculator with searchable verified policies, manual score entry, locally captured Grades-page scores, weighted-score visuals, and required-marks calculations.
- Added a **Summarise** action beside video transcripts. It copies a timestamped lecture-summary prompt and the YouTube video link when available.
- Replaced oversized lecture-slide image buttons with compact accessible download links and emphasized the nearest upcoming deadline with a live countdown.
- Improved programming imports to merge matching complete function or method definitions, preserve unrelated code, and reject unsafe partial or ambiguous matches.
- Improved programming prompt context, editor import feedback, clipboard fallback guidance, protected-scaffold verification, and non-blocking dialog behavior.
- Corrected course-code normalization for IITM degree-prefixed course IDs and added the Sep 2026 grading-policy migration.

### Verification

- `npm run build` and `npm run check` passed.
- `npm test` passed all deterministic suites.
- Real IITM session behavior and Supabase migration application are not covered by the local suite.

### Release packages

- `acadrix-v0.5.0-rc-1-chrome-extension.zip` — unpacked Manifest V3 extension for manual installation.
- `acadrix-v0.5.0-rc-1-bookmarklet.zip` — bookmarklet source, install page, stylesheet, and drag-to-install package.

### Install the extension manually

1. Download and extract `acadrix-v0.5.0-rc-1-chrome-extension.zip`.
2. Open `chrome://extensions` in Chrome or another Chromium browser.
3. Turn on **Developer mode**.
4. Select **Load unpacked** and choose the extracted folder.
5. Refresh the IITM page.

### Install the bookmarklet

Download and extract `acadrix-v0.5.0-rc-1-bookmarklet.zip`, then follow the included install page to add the bookmarklet.

This is a prerelease candidate. Review course calculations against the published policy before relying on them for academic planning.

## [0.4.0-rc.1](https://github.com/SH1SHANK/Acadrix/compare/v0.3.0...v0.4.0-rc.1) (2026-10-12)

### Highlights

- Added programming-assignment test-case extraction for actual output and execution status, while distinguishing unavailable data from a genuinely empty result.
- Expanded Reader and PDF/print exports to show test-case input, expected output, actual output, and known pass/fail status. Code and test-case sections now paginate more cleanly, with syntax-highlighted code and compact sections kept together when they fit.
- Added indexed answer-key review for MCQ, MSQ, numerical, and text questions. Valid MCQ/MSQ suggestions appear in the Reader without changing the IITM form; applying answers remains an explicit action.
- Improved answer-application reporting so missing portal controls are identified instead of reported as successful applications.
- Preserved modified programming-editor drafts when refreshing the Reader, and improved test-case tab switching so extraction waits for updated details and restores the original selection.
- Added safe programming-code import with protected-range preservation and assignment-title-based export filenames.
- Added graded-assignment navigation on both summary and question pages, across weeks, while excluding solution pages.
- Added automatic application of valid imported indexed answers, including compact streams such as `1: D 2: A 3: A`.
- Refined Reader controls, export wording, popup typography choices, schedule status copy, and hover/disabled button behavior.

### Fixes and safeguards

- Rejected indexed answers for unsupported question types and invalid option letters before they can be applied.
- Kept test-case output whitespace intact and represented unavailable output or execution status explicitly.
- Improved responsive programming test-case layout for desktop, tablet, and narrow screens.
- Added regression coverage for programming exports, answer review, portal application, and PDF pagination.

### Release packages

- `acadrix-v0.4.0-rc.1-chrome-extension.zip` — unpacked Manifest V3 extension for manual installation.
- `acadrix-v0.4.0-rc.1-bookmarklet.zip` — bookmarklet source, install page, stylesheet, and drag-to-install package.

### Install the extension manually

1. Download and extract `acadrix-v0.4.0-rc.1-chrome-extension.zip`.
2. Open `chrome://extensions` in Chrome or another Chromium browser.
3. Turn on **Developer mode**.
4. Select **Load unpacked** and choose the extracted folder.
5. Refresh the IITM assessment page.

### Install the bookmarklet

Download and extract `acadrix-v0.4.0-rc.1-bookmarklet.zip`, then follow the included install page to add the bookmarklet.

### Release candidate 1 (RC-1)

This is a prerelease candidate. Review the changes and report issues before using it for graded work.

## [0.2.0](https://github.com/civiks/unfold-iitm/compare/v0.1.0...v0.2.0) (2026-06-23)


### Features

* added customizable Keyboard shortcut functionality to improve UX ([3b4db0a](https://github.com/civiks/unfold-iitm/commit/3b4db0a2e03aef605dee8b6ef1d549eeb6fd9e85))
* added customizable Keyboard shortcut functionality to improve UX ([08b100f](https://github.com/civiks/unfold-iitm/commit/08b100f35e78c9fb1b4b12acdbe6b4aeefa32b80))


### Bug Fixes

* match shortcuts by physical key (e.code) ([#2](https://github.com/civiks/unfold-iitm/issues/2)) ([1d6e678](https://github.com/civiks/unfold-iitm/commit/1d6e6783c76e471366cfd279627495b0190cf31f))
