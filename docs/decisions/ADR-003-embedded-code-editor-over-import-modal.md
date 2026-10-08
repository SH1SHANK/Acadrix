# ADR-003: Retirement of "Import Code" Modal in Favor of Embedded Extension-Owned Code Editor

## Status
Accepted

## Date
2026-10-08

## Context
In earlier iterations of Acadrix, the AI assistance workflow for programming assignments used an automated "Import Code" modal dialog:
1. The student pasted an entire raw LLM response (markdown, explanations, multiple code blocks) into a text area.
2. A heuristic parsing engine (`scoreCandidateBlock`, `code-importer.js`) analyzed code fences, scored candidates based on language keywords and token lengths, and attempted to auto-select the "best" code block.
3. The student was presented with candidate options and clicked an import button to write to the portal.

In practice, this architecture suffered from significant limitations:
- **Heuristic Fragility**: LLMs frequently output multiple helper snippets, partial diffs, or explanation blocks that confused block-scoring algorithms.
- **Inability to Edit In-Flight**: Students could not easily make minor adjustments, fix variable names, or debug syntax before applying code to the portal.
- **Disjointed User Experience**: Reviewing the problem statement, test cases, and code required navigating between separate modals.
- **Dead Weight & Maintenance**: Maintaining complex markdown heuristics and scoring rules introduced unnecessary complexity without solving the core need: high-fidelity student review.

## Decision
1. **Retire the "Import Code" Modal**: Deprecate the modal-based parsing dialog as the primary programming workflow.
2. **Implement an Embedded Extension-Owned Code Editor** (`ProgrammingCodeEditor`, `src/ui/code-editor.js`):
   - Mount an extension-owned coding surface directly inside the Reader drawer (`#unfold-root`) immediately below the problem statement and test case tabs.
   - Maintain an independent `workingCode` buffer decoupled from the portal's live session until explicitly synced.
   - Provide essential developer conveniences: keyword-based syntax highlighting, local undo/redo history (50 snapshots), auto-closing brackets and quotes, adjustable font sizing (12px–20px), and tab indentation handling.
3. **Establish the Direct Copy-Paste AI Workflow**:
   - Step 1: Student uses granular copy tools ("Copy Question", "Copy Code", or "Prepare AI Prompt").
   - Step 2: Student consults their external LLM of choice.
   - Step 3: Student pastes the generated solution directly into the Acadrix Code Editor.
   - Step 4: Editor automatically normalizes line endings and updates syntax highlights.
   - Step 5: Student reviews, edits, and tests locally in the drawer.
   - Step 6: Student clicks "Apply Changes" to trigger the verified write pipeline (ADR-002).

## Alternatives Considered

### Alternative 1: Retain Both Import Modal and Embedded Editor
- *Pros*: Provides backward compatibility for users accustomed to the import dialog.
- *Cons*: Dual UI paths cause user confusion; doubles the maintenance surface for programming UI.
- *Reason for Rejection*: Violates the engineering principle of clean cutovers and removing dead weight.

### Alternative 2: Embed a Full Ace Editor Instance Inside the Shadow DOM
- *Pros*: Full feature parity with the portal editor (folding, multi-cursor, extensive keymaps).
- *Cons*: Adds significant bundle weight (~500KB+), increases memory footprint, and creates potential namespace collisions with page-level Ace styles.
- *Reason for Rejection*: A lightweight, native textarea paired with a syntax-highlighting overlay satisfies all review and editing requirements with zero runtime dependencies and instant render performance.

## Consequences
- **Positive**: Direct, intuitive workflow with zero parsing ambiguity.
- **Positive**: Students have full agency to review, edit, and understand code before syncing to the portal.
- **Positive**: Single-sheet inspection: problem stem, public test cases, and working code are visible simultaneously in one scrollable view.
- **Positive**: Eliminates fragile heuristics for scoring LLM markdown blocks.
- **Negative**: The student must manually select and paste code from the LLM rather than having the tool attempt full-response extraction.
