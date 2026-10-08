# ADR-002: Privileged Write Mechanism via Background Scripting and Byte-for-Byte Scaffold Verification

## Status
Accepted

## Date
2026-10-08

## Context
Writing code from the Acadrix extension into the IITM portal's live Ace editor presents severe technical and integrity challenges:
1. **Public Channel Insecurity**: As decided in ADR-001, public DOM `CustomEvent` listeners must never accept code write commands to prevent unauthorized page-script execution.
2. **Protected Scaffold Integrity**: IITM programming assessments protect boilerplate imports, driver classes, and hidden test harnesses using Ace `readonly_line` session markers. Calling `editor.setValue()` or `session.setValue()` completely wipes out these markers, corrupts Angular's form state, and allows accidental destruction of grading harnesses.
3. **Asynchronous Navigation Hazards**: If a student clicks "Apply Changes" for Question 1 but rapidly switches to Question 2 in the portal before the write finishes, applying the code would overwrite the wrong question.
4. **Angular Reactive Form Sync**: Updating Ace's in-memory session does not automatically notify Angular's form controllers unless specific DOM input events are dispatched.

## Decision
Implement a privileged, multi-stage write pipeline governed by the background service worker:

1. **User-Initiated Trigger**: The write path can only be initiated by the student explicitly clicking "Apply Changes" in the Acadrix code editor UI (`#unfold-root`).
2. **Privileged Background Execution**: The content script sends an authenticated message to the background service worker, which executes the write directly in the Page Main World via `chrome.scripting.executeScript({ world: "MAIN", func: writeHandler })`.
3. **Four-Point Pre-Flight Identity Validation**: Before modifying the buffer, the injected write handler verifies:
   - **Editor Identity**: `payload.editorIdentity` matches `currentId`.
   - **Question Identity**: `payload.questionNumber` matches the active chip number (`div.chips button.chip.is-active`).
   - **Assignment Identity**: `payload.assignmentTitle` matches the title bar text (`app-title-bar .title`).
   - **Scaffold Clarity**: `computeProtectedRegions()` must return `isAmbiguous === false`. Any overlapping or fragmented markers trigger an immediate fail-closed abort.
4. **Surgical Range Replacement**: Mutate strictly the editable range via `session.replace(aceRange, payload.code)`. Never invoke `setValue()`.
5. **Synthetic Event Dispatch**: Dispatch synthetic `input` and `change` events on `textarea.ace_text-input` to trigger Angular's reactive form listeners and debounced autosaves.
6. **Byte-for-Byte Post-Write Scaffold Verification**:
   - Re-slice lines `0..prefixEndRow` and assert byte-for-byte identity with `originalPrefix`.
   - Re-slice lines `suffixStartRow..totalRows - 1` and assert byte-for-byte identity with `originalSuffix`.
   - Verify middle lines match `payload.code`.
   - If any verification check fails, report `CODE_WRITE_VERIFICATION_FAILED` and flag the error in the UI.

## Alternatives Considered

### Alternative 1: Full Session Replacement (`editor.setValue()`)
- *Pros*: Trivial implementation (single line of code).
- *Cons*: Erases all `readonly_line` markers, resets the cursor to line 0, clears Ace undo/redo history, and destroys prefix/suffix driver code.
- *Reason for Rejection*: Confirmed regression in automated tests (Test 11 in verification suite); leaves assignment ungradeable.

### Alternative 2: Synthesizing Keystrokes via KeyboardEvent
- *Pros*: Mimics real user typing.
- *Cons*: Extremely slow for multi-hundred line solutions; prone to race conditions with auto-indent and auto-closing bracket triggers; highly fragile across browsers.
- *Reason for Rejection*: Unreliable and poor user experience.

### Alternative 3: Direct Mutation from Content Script
- *Pros*: Avoids background service worker hop.
- *Cons*: Content script has no direct access to `ace.env.editor` or `session` due to execution-world boundaries (ADR-001).
- *Reason for Rejection*: Technically impossible under Chrome MV3 isolated world architecture.

## Consequences
- **Positive**: Eliminates risk of scaffold corruption; prefix and suffix lines are guaranteed unaltered.
- **Positive**: Atomic, validated writes prevent cross-question contamination during navigation.
- **Positive**: Triggers native Angular form state updates and autosave mechanisms.
- **Negative**: Requires `scripting` permission in `manifest.json`.
- **Negative**: If an assignment contains fragmented readonly markers, the write fails closed and the user must edit directly in the portal.
