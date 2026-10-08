# Manual smoke test

This checklist is for a developer using an unpacked build and an authenticated IITM account. It is not part of CI and does not replace the automated fixture/browser tests.

## Setup

1. Run `npm ci` and `node build.mjs`.
2. Load the generated `build/` directory from `chrome://extensions` with Developer mode enabled.
3. Refresh the IITM portal tab. Do not use real student credentials in test fixtures or reports.

## Normal assessment

- Open a supported assessment and launch Acadrix.
- Confirm the Reader shows the extracted question content and its navigation controls.
- Verify that copying a prompt and parsing a small indexed response works as expected.
- Review an answer suggestion and confirm that portal changes occur only after the explicit apply action; verify Acadrix does not submit the assessment.
- Close and reopen the Reader and confirm it remains usable.

## Programming assignment

- Visit an assignment information page and confirm the programming launcher is not offered there.
- Open the actual programming editor page and confirm the launcher/Reader programming workflow is available.
- Edit the local CodeMirror working buffer; confirm syntax support, paste, undo/redo, and protected scaffold behavior.
- Use **Apply Changes** only when intended. Confirm the portal editor updates the editable region and retains protected scaffold content. Confirm Acadrix does not run or submit the assignment.

## Export and notifications

- If permitted for the test assignment, check Markdown, PDF/print, and resource-bundle exports.
- If academic events are configured for the current term, confirm the displayed event state and notification behavior without assuming that portal submission status is inferred.

Record browser version, build revision, and reproducible steps for any issue. Redact account details, answers, and private assessment content.
