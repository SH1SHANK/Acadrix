# Programming assignments

Acadrix provides a programming-assignment workflow on the active IITM coding page. The assignment information page is not the coding workspace and does not show the programming launcher. The active editor page is where the launcher and Reader workflow are available.

## Data flow

```text
Active programming editor page
  → extract problem, test cases, and Ace snapshot
  → Reader with extension-owned CodeMirror editor
  → student reviews local workingCode
  → explicit Apply Changes action
  → privileged write to IITM Ace's editable range
  → editor context and scaffold verification
```

Relevant implementation:

- `src/extraction/programming.js` — programming assignment extraction and page state handling.
- `src/bridge/languages.js` — language normalization and editor metadata.
- `src/bridge/ace-bridge.js` and `src/bridge/page-bridge.js` — editor snapshot and write coordination.
- `src/ui/code-editor.js` — CodeMirror working editor.
- `extension/background.js` — privileged extension write dispatch.
- `tests/test-programming-assignment.mjs` and `tests/test-programming-editor.mjs` — deterministic checks.

## Two editors, different roles

IITM's existing Ace editor remains the portal's source of truth. Acadrix does not edit it while the student is working in the Reader. CodeMirror stores a local `workingCode` buffer and renders the editable region together with any protected prefix/suffix as a continuous document.

The CodeMirror editor provides syntax highlighting, language completion, indentation, clipboard editing, and undo/redo. Supported language identifiers are maintained in `src/bridge/languages.js` (currently Python, Java, JavaScript, SQL, and Bash).

## Apply Changes safeguards

Applying code is an explicit user action. Before the write, Acadrix checks the captured editor/question context and confirms the current portal code and scaffold match the snapshot. The privileged main-world write calculates the editable range and uses Ace's range replacement rather than replacing the whole document. It then verifies the protected scaffold and updated code. If the context is stale or the editable range cannot be resolved safely, the operation is rejected.

Acadrix does not run or submit the programming assignment. The student remains responsible for reviewing the result in IITM and using the portal's own controls.

## AI-assisted editing

Acadrix can prepare a prompt from the assignment data. The student may copy it to an external AI tool and paste returned code into the CodeMirror editor. A single matching-language code fence is accepted by the editor's paste handler; there is no current programming "Import Code" dialog or automatic code selection. Prompt sharing is initiated by the student; Acadrix does not call an AI provider.
