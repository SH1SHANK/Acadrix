# GEMINI.md — Acadrix Agent Operating Rules

This file defines the mandatory operating procedure for Gemini/Antigravity agents working on the Acadrix repository.
These rules are strict. They exist to prevent unnecessary test execution, uncontrolled file exploration, duplicated work, speculative changes, and inconsistent UI decisions.

## 0. Absolute Priority

Follow these rules before task-specific instructions.

When a task-specific instruction conflicts with this file, stop and resolve the conflict before changing the repository.

The default behavior is:

**Inspect → Reason → Plan → Implement → Validate once → Report.**

Do not use:

**Inspect → change → test → change → test → change → test → ...**

---

# 1. File Management: Use the Filesystem MCP

The repository must be explored and read using the available **filesystem MCP/tools** whenever possible.

### Mandatory

Use filesystem MCP/tooling for:

- locating files
- listing directories
- reading source files
- reading configuration
- reading documentation
- inspecting existing implementation
- checking related modules
- checking file contents before editing
- confirming that a file exists before modifying it

### Do NOT use shell commands for file exploration

Do not use terminal commands such as:

```text
ls
ls -la
find
fd
grep
rg
cat
head
tail
sed
awk
tree
```

for repository exploration or file reading.

Use filesystem MCP instead.

Terminal/shell is reserved primarily for:

- running the project's requested build
- running validation commands
- running the final required test suite
- invoking explicitly requested tooling
- commands that actually execute/build the software

Do not use terminal output as a substitute for reading files through the filesystem MCP.

### Before editing a file

1. Confirm the file exists through filesystem tooling.
2. Read the relevant implementation.
3. Read directly related modules if necessary.
4. Understand the current architecture.
5. Only then edit.

Never edit a file solely from an assumption based on a filename.

---

# 2. Documentation: Use Context7

When a task depends on external library, framework, browser API, package, or tooling documentation, use **Context7** first for current documentation when the library is available there.

This applies especially to:

- JavaScript/TypeScript libraries
- KaTeX
- browser APIs
- extension APIs
- DOM APIs
- CSS features
- build tooling
- packaging APIs
- third-party dependencies
- framework behavior

Do not rely on remembered APIs when current documentation is available.

### Context7 procedure

Before implementing a non-trivial library/API change:

1. Identify the exact library/API.
2. Query Context7 for the current documentation.
3. Confirm the relevant API/behavior.
4. Implement using the documented interface.

Do not add a dependency merely because documentation exists for it.

Do not use Context7 for repository source inspection; use filesystem MCP for that.

---

# 3. UI / Layout Changes: Mandatory Web Guidance Review

Any change affecting:

- UI
- layout
- interaction
- accessibility
- browser-extension UX
- responsive behavior
- visual hierarchy
- dialogs
- popovers
- menus
- controls
- focus management
- keyboard interaction
- touch targets
- design system
- CSS architecture

must be informed by the available **web/product design guidance skill** before implementation.

Do not improvise UI patterns when authoritative guidance is available.

### UI procedure

Before implementing a meaningful UI/layout change:

1. Read the relevant local design specification, especially `DESIGN.md`.
2. Inspect the current implementation with filesystem MCP.
3. Use the web guidance/product-design guidance skill for the relevant UX/accessibility question.
4. Where appropriate, inspect current official browser/platform guidance.
5. Implement only after the intended behavior is clear.

Do not browse randomly or collect references without a concrete UI question.

### Mandatory design-system rule

`DESIGN.md` is authoritative for Acadrix visual implementation.

If `DESIGN.md` defines the token, component, spacing, typography, interaction, accessibility, responsive behavior, or Shadow DOM rule, follow it exactly.

Do not invent local alternatives.

If a required design value or pattern is missing from `DESIGN.md`:

1. Extend `DESIGN.md` first.
2. Use the new design-system rule in the implementation.

Do not introduce one-off visual values directly in component CSS.

---

# 4. Chrome Extension Guidance

When changing anything related to browser-extension behavior or browser-extension UI, use the available **Chrome Extension skill/plugin/reference tooling** when available.

Use it for current guidance on:

- Manifest V3
- extension UI surfaces
- content scripts
- action/popup behavior
- permissions
- messaging
- lifecycle
- Shadow DOM/content-script interaction
- extension packaging
- browser-specific constraints
- accessibility of extension surfaces

If the extension-specific plugin/skill is unavailable, use the current official Chrome Extensions documentation as the fallback reference.

Do not assume Chrome extension behavior from generic web development knowledge when platform-specific guidance is available.

For Firefox-specific behavior, consult the relevant browser documentation when the change affects Firefox compatibility.

---

# 5. TESTING: EXTREMELY STRICT RULES

## 5.1 Do NOT run tests while exploring

Do not run the test suite:

- before inspecting the repository
- while deciding what to change
- after reading a single file
- after every edit
- after every small CSS adjustment
- as a background task
- automatically after tool calls
- repeatedly during implementation

Testing is NOT a continuous feedback loop for this workflow.

## 5.2 Test only after all required changes are complete

First:

```text
Inspect
→ Reason
→ Decide
→ Implement ALL requested changes
```

Only after the implementation is complete should validation begin.

## 5.3 Run the required validation exactly once

After all required changes for the task are complete:

1. Run the relevant build/check/test command(s).
2. Run them **once**.
3. Wait for completion.
4. Analyze the result.
5. Fix any genuine failure.
6. Do not restart the entire test suite repeatedly for every minor correction.

### Important exception

If the validation reveals a real defect that requires a code change, make the necessary correction and run the **smallest targeted validation needed to confirm that correction**.

Do NOT automatically rerun the entire suite.

If the targeted validation passes and the original full suite had already passed before the correction, report the exact validation performed.

If a full suite must genuinely be rerun because the correction affects broad behavior, state why before doing so.

## 5.4 Never run tests as background tasks

Do not launch tests with:

- background processes
- detached shell commands
- parallel hidden jobs
- asynchronous unattended test commands

The agent must actively wait for the validation command to finish and inspect its result.

Do not say:

> "I started the tests and will wait for them."

while continuing unrelated work.

Run validation in the foreground as the final validation step.

## 5.5 No unnecessary test creation

Do not create new tests merely to demonstrate activity.

Do not expand the test suite unless the task explicitly requires new coverage or there is a clear, material regression risk that cannot be validated through existing infrastructure.

For UX/UI tasks, prefer:

- existing validation
- real-browser verification
- direct visual inspection

Do not create tests just because a CSS value changed.

---

# 6. Build Discipline

Do not build repeatedly during implementation unless the task requires intermediate build artifacts to continue.

Preferred sequence:

```text
Inspect
↓
Implement all changes
↓
Build once
↓
Validate once
↓
Real-browser verification if required
```

If the build is required to inspect generated behavior, only run it when genuinely necessary.

Do not rebuild after every file modification.

---

# 7. Planning Before Coding

For non-trivial tasks, first form a concise implementation plan internally before making changes.

The plan must identify:

- files/modules affected
- architectural boundary
- data-flow impact
- UI impact
- risks
- validation method

Do not start making speculative edits before understanding the scope.

### Prefer one coherent implementation

Do not implement multiple competing approaches and choose later.

Select the best architecture based on the existing codebase and constraints.

Avoid unnecessary refactors outside the requested scope.

---

# 8. Read the Existing Architecture Before Changing It

Acadrix has an established architecture.

Preserve existing boundaries unless the task explicitly requires changing them.

Important boundaries include:

```text
IITM DOM
  ↓
Semantic Extraction
  ↓
Canonical Document
  ↓
Reader / Exporters / Prompt Serialization
```

and the extension runtime/lifecycle boundaries.

Do not solve a Reader problem by introducing DOM scraping into the Reader.

Do not solve an exporter problem by modifying the semantic extractor unnecessarily.

Do not bypass the portal adapter with ad-hoc IITM DOM manipulation.

---

# 9. UI Implementation Rules

For UI/layout work:

1. Read `DESIGN.md` first.
2. Inspect current UI code.
3. Identify the smallest set of reusable primitives/components affected.
4. Reuse tokens and existing primitives.
5. Preserve Shadow DOM isolation.
6. Implement interaction semantics correctly.
7. Verify in a real browser when visual/interaction behavior matters.

Do not introduce:

- gradients
- glassmorphism
- unnecessary animation
- decorative UI
- duplicate controls
- generic dashboard patterns
- extra menus merely to hide unnecessary actions
- arbitrary CSS values

Acadrix should optimize for clarity and efficiency.

---

# 10. Avoid Duplicate User Actions

Every user-facing action should have exactly one primary entry point.

Before adding a button/menu/action, ask:

> Does another existing action already perform the same user goal?

If yes, do not add another action.

Prefer a small, explicit action surface over feature-heavy toolbars.

For example, if a task defines a specific action set, implement exactly that set instead of exposing internal capabilities individually.

---

# 11. Real-Browser Verification for UI Changes

For meaningful UI/interaction changes, real-browser inspection is part of implementation quality.

Use the browser tooling available in the environment.

Verify:

- actual rendered layout
- keyboard behavior
- pointer interaction
- responsive behavior
- dark/light mode where applicable
- focus behavior
- Shadow DOM isolation
- host-page interaction
- actual extension behavior

Do not claim visual success based solely on source inspection.

### Screenshot discipline

Capture screenshots only when they provide useful evidence.

Do not generate dozens of screenshots for trivial changes.

Prefer a small set of representative states.

---

# 12. Source of Truth Rules

Use the following hierarchy:

### Repository implementation
For what the code currently does.

### `DESIGN.md`
For Acadrix visual/design behavior.

### Filesystem MCP
For repository/file inspection.

### Context7
For current library/API documentation.

### Web guidance / product-design skill
For UX/accessibility/layout guidance.

### Chrome Extension guidance/plugin
For extension-specific platform behavior.

### Official web documentation
For current browser/platform standards when needed.

Do not replace repository facts with assumptions from generic knowledge.

---

# 13. No Speculative Scope Expansion

Do not add:

- future features
- unrelated cleanup
- architectural rewrites
- new dependencies
- extra UI
- new abstractions
- test frameworks
- telemetry
- analytics
- APIs
- backend services

unless explicitly requested or required to correctly implement the current task.

If you discover a potentially useful improvement outside the requested scope, note it in the final report instead of silently implementing it.

---

# 14. Code Quality and Refactoring

When modifying code:

- preserve existing naming conventions unless there is a strong reason to change them
- remove dead code created by the change
- avoid duplicate implementations
- keep modules focused
- keep UI state deterministic
- avoid hidden side effects
- preserve cancellation/lifecycle behavior
- preserve extension/bookmarklet boundaries

Refactor only as much as required to produce a clean implementation.

Do not refactor unrelated legacy code simply because it is imperfect.

---

# 15. Browser Extension / Host-Page Safety

Never allow Acadrix to:

- leak its CSS into the IITM page
- change host-page typography
- accidentally intercept unrelated page controls
- block page scrolling unnecessarily
- alter IITM form state without an explicit user action
- submit assignments automatically

Interactive Reader controls may synchronize explicitly with IITM when the feature requires it, but this must remain deterministic and controlled.

---

# 16. Validation Reporting

When validation is complete, report exactly what was run.

Example:

```text
Build: PASS
Existing validation suite: PASS
Real-browser verification: PASS
```

Do not imply that tests were run if they were not.

Do not claim live-browser verification unless it actually happened.

Do not claim production performance benchmarks from synthetic smoke timings.

If something was not verified, explicitly say so.

---

# 17. Required Final Workflow

For every task, follow this sequence:

### Step 1 — Inspect
Use filesystem MCP to inspect only the relevant repository files.

### Step 2 — Consult Guidance
For documentation-dependent work use Context7.
For UI/layout work use web/product-design guidance.
For extension-specific work use Chrome Extension guidance/plugin.

### Step 3 — Plan
Determine the smallest coherent implementation.

### Step 4 — Implement
Make all required changes before running the main validation.

### Step 5 — Review
Inspect the final diff / changed files through filesystem/repository tooling.
Check for:

- unintended changes
- dead code
- duplicate actions
- stale branding
- design-system violations
- architectural boundary violations

### Step 6 — Build / Validate
Run the relevant validation **once, in the foreground, after implementation is complete**.

### Step 7 — Browser Verification
For UI/extension interaction tasks, perform the necessary real-browser verification after implementation.

### Step 8 — Report
State:

- what changed
- important architectural decisions
- validation actually performed
- browser verification actually performed
- remaining known issues

---

# 18. Forbidden Agent Behavior

The following behavior is explicitly forbidden unless the user specifically requests it:

- running tests after every change
- running tests in the background
- repeatedly rebuilding while exploring
- using shell commands for routine file exploration when filesystem MCP is available
- reading documentation from memory when Context7/current docs are available
- changing UI without consulting the design system and relevant web guidance
- inventing UI patterns without checking platform guidance when platform-specific behavior matters
- adding duplicate user actions
- adding features outside task scope
- creating tests solely to prove that work happened
- claiming verification that was not performed

---

# 19. Final Principle

Optimize for:

**Correctness → Minimal change → Clear UX → Efficient execution → One deliberate validation pass.**

The agent's job is not to maximize the number of tool calls.
The agent's job is to produce the correct implementation with the minimum necessary repository disruption.
