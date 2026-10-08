# Architecture

Acadrix separates portal observation, semantic extraction, canonical data, and presentation/export. The extension is the full-featured target; `build.mjs` also creates a constrained bookmarklet target.

Interactive diagrams: [system architecture](diagrams/acadrix-architecture.html) and [programming Apply Changes sequence](diagrams/apply-changes-pipeline.html).

## Main data flow

```text
IITM page
  → portal adapter and traversal
  → semantic extraction
  → canonical AssignmentDocument
  → Reader, answer review, and exporters
```

- `src/portal/` identifies supported portal page types and provides selectors/adapters.
- `src/traversal/` navigates assessment question controls and restores the user's portal location.
- `src/parsers/` and `src/extraction/` turn page content into model nodes.
- `src/model/` holds the document and question model; `src/document/` normalizes and compiles export documents.
- `src/ui/` renders the Reader, launcher, and programming editor within the extension UI boundary.
- `src/exporters/`, `src/resources/`, and `src/orchestration/` generate document outputs and package resources.

## Browser execution contexts

The Manifest V3 extension uses three contexts:

1. **Portal main world:** IITM's Angular application, page DOM, and Ace editor instance.
2. **Extension isolated world:** Acadrix's adapter, extraction, Reader, and local UI state.
3. **Extension service worker:** privileged extension APIs, including scripting, alarms/notifications, and direct PDF support.

Acadrix's UI is mounted in a closed Shadow DOM. The page bridge in `src/bridge/page-bridge.js` runs in the main world to serialize programming-editor snapshots over a CustomEvent channel. It does not accept programming writes over that public event channel. A user-requested programming write is dispatched through `extension/background.js` and `chrome.scripting` into the main world; see [Programming assignments](PROGRAMMING_ASSIGNMENTS.md) and the [sequence diagram](diagrams/apply-changes-pipeline.html).

## Programming assignment boundary

IITM's Ace editor and form remain authoritative. The CodeMirror component in `src/ui/code-editor.js` edits only the local `workingCode` value. The adapter and background writer verify the selected editor/question, constrain the replacement to the editable range, and check protected scaffold content after the write.

## Answer review boundary

`src/bridge/prompt.js` serializes prompts. `src/bridge/answer-stream.js` and `src/bridge/parser.js` handle the normal-assignment indexed answer protocol and validation. The Reader presents suggestions for review; the portal applicator updates controls only after the user's action. The canonical format is documented in [Answer protocol](ANSWER_PROTOCOL.md).

## Academic event and export data flows

`src/notifications/events.js` retrieves only course-independent weekly assignment deadlines from Supabase `public.academic_events` (`course_code IS NULL`) and caches them in extension storage. It does not derive submission state from the portal DOM. Export resource resolution can fetch resources referenced by an assessment; see the outbound-request details in [Security](SECURITY.md).

## Build targets

`build.mjs` assembles the extension bundle from `EXTENSION_MODULES`, copies extension assets into the generated `build/` directory, and generates bookmarklet outputs from the smaller `BOOKMARKLET_MODULES` list. CodeMirror is bundled into the extension target; the bookmarklet does not include the extension-only programming editor or privileged background features. Generated `build/` output is not committed.

For implementation decisions that are useful as historical context, see [Architecture Decision Records](decisions/README.md).
