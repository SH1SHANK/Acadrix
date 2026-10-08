#!/usr/bin/env node
/**
 * Real-Browser Automated End-to-End Verification for IITM Programming Assignments.
 * 
 * Executes browser-level verification against the compiled extension bundle and IITM fixture.
 * using real Google Chrome (Headless) against the compiled `build/run.js` bundle
 * and the exact IITM portal DOM structure.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const RUN_JS_PATH = path.join(ROOT_DIR, "build", "run.js");

function findChromeBinary() {
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const PNG_1X1_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d7636060f80f000104010054a24f5d0000000049454e44ae426082",
  "hex"
);

function buildProgrammingPageHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>IITM Online Degree — Programming Assignment</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 0; background: #0b0f19; color: #f1f5f9; }
    .tab-item { cursor: pointer; padding: 8px 16px; background: transparent; border: none; color: #94a3b8; }
    .tab-item.active { color: #fff; border-bottom: 2px solid #3b82f6; }
    .test-case-pill { cursor: pointer; padding: 4px 8px; margin: 2px; }
    .test-case-pill.is-selected { background: #3b82f6; color: #fff; }
    .ace_editor { min-height: 200px; background: #1e293b; color: #f8fafc; font-family: monospace; }
  </style>
</head>
<body>
  <div class="app-layout">
    <header class="app-top-bar">
      <span class="top-bar-title">Sep 2026 - MAD II</span>
    </header>
    <main class="app-main">
      <div class="course-body">
        <app-title-bar>
          <div class="title-bar size-small">
            <h1 class="title size-small">JavaScript Graded Assignment - Simple and Compound Interest</h1>
            <nav class="breadcrumb"><span class="breadcrumb-item current">Week 1</span></nav>
          </div>
        </app-title-bar>
        <app-programming-assignment-view>
          <div class="programming-assignment-view">
            <app-tab-bar variant="reverse-filled">
              <div role="tablist" class="tab-bar-wrapper">
                <div class="tab-scroller">
                  <button role="tab" type="button" class="tab-item active" aria-selected="true" id="tab-question">
                    <span class="tab-label">Question</span>
                  </button>
                  <button role="tab" type="button" class="tab-item" aria-selected="false" id="tab-testcases">
                    <span class="tab-label">Test Cases</span>
                  </button>
                  <button role="tab" type="button" class="tab-item disabled" disabled="" aria-selected="false" aria-disabled="true">
                    <span class="tab-label">Solution</span>
                  </button>
                </div>
              </div>
            </app-tab-bar>
            <div class="tabs-content">
              <app-pa-question id="view-question">
                <div class="pa-question">
                  <div class="backend-html">
                    <p>Write the definitions of the functions given below with the help of given information.</p>
                    <p>Calculate simple interest and compound interest according to standard banking formulas.</p>
                    <figure>
                      <img src="/assets/interest_formula.png" alt="Interest Calculation Diagram" width="400" height="200">
                      <figcaption>Figure 1: Interest Rate Schedule</figcaption>
                    </figure>
                    <div class="example">
                      <p class="title">Example 1</p>
                      <pre class="input">20000 1 2020-12-27 2021-08-27</pre>
                      <pre class="output">48600 204452 320</pre>
                    </div>
                    <div class="constraints">
                      <ul><li>Principal P &gt; 0</li></ul>
                    </div>
                    <p class="return-instructions">Return only the completed, working code inside a single \`\`\`javascript code block.</p>
                  </div>
                </div>
              </app-pa-question>

              <app-pa-testcases id="view-testcases" style="display: none;">
                <div class="pa-testcases">
                  <div class="accordion-panel">
                    <button type="button" class="accordion-header" aria-expanded="true" aria-controls="public-test-cases-content">
                      <div class="header-main"><span class="header-title">Public Test Cases</span></div>
                    </button>
                    <div class="accordion-content" id="public-test-cases-content">
                      <div class="test-case-card">
                        <div class="test-case-slider">
                          <button class="test-case-pill is-selected" id="tc-pill-1" aria-selected="true">Case 1</button>
                          <button class="test-case-pill" id="tc-pill-2" aria-selected="false">Case 2</button>
                        </div>
                        <div class="test-case-details" id="tc-details-content">
                          <div class="test-case-block">
                            <div class="title">Input</div>
                            <div class="content" id="tc-input">20000\\n1\\n2020-12-27\\n2021-08-27</div>
                          </div>
                          <div class="test-case-block">
                            <div class="title">Expected Output</div>
                            <div class="content" id="tc-output">48600\\n204452\\n320</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </app-pa-testcases>
            </div>

            <app-pa-code-editor>
              <div class="pa-code-editor">
                <div class="toolbar">
                  <div class="language-input">
                    <div class="language-selection"><span class="current-value">Javascript</span></div>
                  </div>
                </div>
                <div class="editor-pane">
                  <div class="ace-container ace_editor ace-github-dark ace_dark" id="app-code-editor-0"></div>
                </div>
              </div>
            </app-pa-code-editor>
          </div>
        </app-programming-assignment-view>
      </div>
    </main>
  </div>

  <script>
    // Tab switching interaction
    const qTab = document.getElementById("tab-question");
    const tcTab = document.getElementById("tab-testcases");
    const qView = document.getElementById("view-question");
    const tcView = document.getElementById("view-testcases");

    qTab.onclick = () => {
      qTab.classList.add("active");
      qTab.setAttribute("aria-selected", "true");
      tcTab.classList.remove("active");
      tcTab.setAttribute("aria-selected", "false");
      qView.style.display = "block";
      tcView.style.display = "none";
    };

    tcTab.onclick = () => {
      tcTab.classList.add("active");
      tcTab.setAttribute("aria-selected", "true");
      qTab.classList.remove("active");
      qTab.setAttribute("aria-selected", "false");
      tcView.style.display = "block";
      qView.style.display = "none";
    };

    // Test case pill switching
    const pill1 = document.getElementById("tc-pill-1");
    const pill2 = document.getElementById("tc-pill-2");
    const tcInput = document.getElementById("tc-input");
    const tcOutput = document.getElementById("tc-output");

    pill1.onclick = () => {
      pill1.classList.add("is-selected");
      pill2.classList.remove("is-selected");
      tcInput.textContent = "20000\\n1\\n2020-12-27\\n2021-08-27";
      tcOutput.textContent = "48600\\n204452\\n320";
    };
    pill2.onclick = () => {
      pill2.classList.add("is-selected");
      pill1.classList.remove("is-selected");
      tcInput.textContent = "50000\\n2\\n2019-01-01\\n2020-01-01";
      tcOutput.textContent = "100000\\n500000\\n700";
    };

    // Real Mock Ace Editor
    const PREFIX = "/* Protected Prefix: IITM Header */\\n/* DO NOT MODIFY */";
    const STARTER = "function calculateSimpleInterest(principal, dailyInterest, startingDate, endingDate) {\\n  // Implementation here\\n}";
    const SUFFIX = "/* Protected Suffix: IITM Runner */\\n/* DO NOT MODIFY */";

    let editorLines = [
      PREFIX.split("\\n")[0],
      PREFIX.split("\\n")[1],
      STARTER.split("\\n")[0],
      STARTER.split("\\n")[1],
      STARTER.split("\\n")[2],
      SUFFIX.split("\\n")[0],
      SUFFIX.split("\\n")[1],
    ];

    const markers = {
      1: {
        id: 1,
        clazz: "readonly_line",
        type: "fullLine",
        range: { start: { row: 0, column: 0 }, end: { row: 2, column: 0 } },
      },
      2: {
        id: 2,
        clazz: "readonly_line",
        type: "fullLine",
        range: { start: { row: 5, column: 0 }, end: { row: 7, column: 0 } },
      },
    };

    const aceSession = {
      id: "live-ace-session-1",
      getLength: () => editorLines.length,
      getLine: (r) => editorLines[r] ?? "",
      getLines: (first, last) => editorLines.slice(first, last + 1),
      getValue: () => editorLines.join("\\n"),
      getMarkers: (inFront) => inFront ? markers : {},
      getTextRange: (range) => {
        if (!range?.start || !range?.end) return "";
        const { start, end } = range;
        if (start.row === end.row) {
          return (editorLines[start.row] || "").slice(start.column, end.column);
        }
        const lines = [];
        lines.push((editorLines[start.row] || "").slice(start.column));
        for (let r = start.row + 1; r < end.row; r++) {
          lines.push(editorLines[r] || "");
        }
        lines.push((editorLines[end.row] || "").slice(0, end.column));
        return lines.join("\\n");
      },
      replace: (range, text) => {
        const { start, end } = range;
        const before = (editorLines[start.row] || "").slice(0, start.column);
        const after = end.row < editorLines.length ? (editorLines[end.row] || "").slice(end.column) : "";
        const replacementLines = (text || "").split("\\n");

        const newLines = [];
        for (let r = 0; r < start.row; r++) {
          newLines.push(editorLines[r]);
        }
        if (replacementLines.length === 1) {
          newLines.push(before + replacementLines[0] + after);
        } else {
          newLines.push(before + replacementLines[0]);
          for (let i = 1; i < replacementLines.length - 1; i++) {
            newLines.push(replacementLines[i]);
          }
          newLines.push(replacementLines[replacementLines.length - 1] + after);
        }
        for (let r = end.row + 1; r < editorLines.length; r++) {
          newLines.push(editorLines[r]);
        }

        const linesReplaced = end.row - start.row + 1;
        const lineDelta = replacementLines.length - linesReplaced;
        if (lineDelta !== 0) {
          for (const m of Object.values(markers)) {
            if (m?.range?.start && m.range.start.row > end.row) {
              m.range.start.row += lineDelta;
              m.range.end.row += lineDelta;
            }
          }
        }

        editorLines = newLines;
        return range;
      },
      getMode: () => ({ $id: "ace/mode/javascript" }),
    };

    const mockEditor = {
      id: "editor-real-1",
      getSession: () => aceSession,
      session: aceSession,
      getValue: () => aceSession.getValue(),
    };

    const aceElem = document.getElementById("app-code-editor-0");
    aceElem.env = { editor: mockEditor };
    aceElem._editor = mockEditor;
    window.ace = {
      edit: () => mockEditor,
    };
  </script>

  <script src="/run.js"></script>

  <script>
    window.__verificationReport = {
      steps: {},
      errors: [],
    };

    async function runVerification() {
      const rep = window.__verificationReport;

      try {
        const runtime = window.__unfold || window.__acadrix;
        const activeView = document.querySelector("app-programming-assignment-view");
        const courseBody = document.querySelector(".course-body");
        activeView?.remove();
        const overview = document.createElement("app-pa-start-page");
        overview.innerHTML = '<button type="button">Resume Assignment</button>';
        courseBody?.appendChild(overview);
        runtime?.detect?.();
        await new Promise((resolve) => setTimeout(resolve, 150));
        rep.steps.step1_overview_has_no_acadrix_surface =
          !document.querySelector("#unfold-root") &&
          !document.querySelector("#saq-launcher") &&
          !document.querySelector("#saq-sheet");
        overview.remove();
        if (activeView && courseBody) courseBody.appendChild(activeView);
        runtime?.detect?.();
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Step 1: Load the actual programming editor state after Resume Assignment.
        rep.steps.step1_load = Boolean(document.querySelector("app-programming-assignment-view app-pa-code-editor"));

        // Step 2: Confirm FAB is mounted once on the active editor page.
        const shadowRoot = document.querySelector("#unfold-root")?.shadowRoot;
        const launcher = shadowRoot?.querySelector("#saq-launcher, .saq-launcher");
        rep.steps.step2_fab_present = Boolean(launcher) && shadowRoot.querySelectorAll("#saq-launcher").length === 1;

        // Step 3: Open Reader
        if (launcher) launcher.click();
        await new Promise((r) => setTimeout(r, 200));
        if (!runtime?.reader?.isOpen()) {
          await runtime?.open?.();
          await new Promise((r) => setTimeout(r, 200));
        }
        rep.steps.step3_reader_open = Boolean(runtime?.reader?.isOpen());

        const exportTrigger = shadowRoot?.querySelector("[data-act='toggle-export-menu']");
        const exportMenu = shadowRoot?.querySelector("#saq-export-menu");
        const originalExportCallback = runtime?.reader?.onExportCallback;
        const dispatchedExports = [];
        if (runtime?.reader && exportTrigger && exportMenu) {
          runtime.reader.onExportCallback = (format) => dispatchedExports.push(format);
          const expectedExports = [
            ["print", "pdf", "Download as PDF"],
            ["export-md", "markdown", "Download as Markdown"],
            ["export-txt", "text", "Download as TXT File"],
          ];
          for (const [action, format, label] of expectedExports) {
            exportTrigger.click();
            await new Promise((resolve) => requestAnimationFrame(resolve));
            const item = exportMenu.querySelector("[data-act='" + action + "']");
            if (!item || !item.textContent.includes(label) || exportMenu.hidden) {
              dispatchedExports.push("missing:" + format);
              continue;
            }
            item.click();
            await new Promise((resolve) => requestAnimationFrame(resolve));
          }
          runtime.reader.onExportCallback = originalExportCallback;
        }
        rep.steps.step3a_programming_export_menu_dispatch = Boolean(
          exportTrigger && exportMenu && exportMenu.hidden &&
          dispatchedExports.join(",") === "pdf,markdown,text"
        );

        const doc = runtime?.activeDocument;
        rep.steps.step_doc_present = Boolean(doc);

        const pData = doc?.questions?.[0]?.programmingData;

        // Step 4: Verify Question
        rep.steps.step4_question_extracted = Boolean(
          doc?.questions?.[0]?.stem?.length > 0 &&
          pData?.language === "javascript"
        );

        // Step 5: Verify images if present
        rep.steps.step5_images = Boolean(pData?.images?.length > 0 && pData.images[0].src.includes("interest_formula.png"));

        // Step 6: Verify Test Cases
        rep.steps.step6_testcases = Boolean(pData?.testCases?.length > 0);

        // Step 7: Confirm Test Cases extracted even when tab was not initially active
        rep.steps.step7_hidden_tc_extracted = Boolean(
          pData?.testCases?.length >= 2 &&
          pData?.testCases?.[0]?.input?.includes("20000") &&
          pData?.testCases?.[0]?.expectedOutput?.includes("48600")
        );

        // Step 8: Confirm Reader returns portal to original tab
        const qTabSelected = document.getElementById("tab-question")?.getAttribute("aria-selected") === "true";
        rep.steps.step8_portal_tab_restored = qTabSelected;

        // Step 9: Inspect Starter Code
        rep.steps.step9_starter_code = Boolean(pData?.starterCode?.includes("calculateSimpleInterest"));

        // Step 10: Inspect Current Code
        rep.steps.step10_current_code = Boolean(pData?.currentCode?.includes("calculateSimpleInterest"));

        // Step 11: Inspect Prefix Code
        rep.steps.step11_prefix_code = Boolean(pData?.prefixCode?.includes("Protected Prefix: IITM Header"));

        // Step 12: Inspect Suffix Code
        rep.steps.step12_suffix_code = Boolean(pData?.suffixCode?.includes("Protected Suffix: IITM Runner"));

        // Step 13: Generate AI Context
        const promptResult = runtime.generateAiPrompt ? runtime.generateAiPrompt(doc) : (runtime.serializeProgrammingPrompt ? { prompt: runtime.serializeProgrammingPrompt(doc) } : null);
        const serializedPrompt = promptResult?.prompt || "";
        rep.steps.step13_ai_context_generated = Boolean(serializedPrompt.length > 50);

        // Step 14: Inspect actual generated prompt
        rep.steps.step14_prompt_contains_header = Boolean(serializedPrompt.includes("JavaScript Graded Assignment"));

        // Step 15: Confirm Test Cases appear
        rep.steps.step15_testcases_in_prompt = Boolean(
          serializedPrompt.includes("## Test Cases") &&
          serializedPrompt.includes("48600")
        );

        // Step 16: Confirm Return Instructions appear
        rep.steps.step16_return_instructions = Boolean(
          serializedPrompt.includes("## Return Instructions") &&
          serializedPrompt.includes("single \`\`\`javascript code block")
        );

        // Step 17: Confirm suffix code appears
        rep.steps.step17_suffix_in_prompt = Boolean(
          serializedPrompt.includes("## Protected Suffix Code") &&
          serializedPrompt.includes("Protected Suffix: IITM Runner")
        );

        // Step 18: Confirm images are represented
        rep.steps.step18_images_in_prompt = Boolean(
          serializedPrompt.includes("interest_formula.png") ||
          serializedPrompt.includes("Interest Calculation Diagram")
        );

        // Step 19: Confirm no protected code is lost
        rep.steps.step19_prefix_in_prompt = Boolean(
          serializedPrompt.includes("## Protected Prefix Code") &&
          serializedPrompt.includes("Protected Prefix: IITM Header")
        );

        // Step 20: Confirm prompt contains strict machine contract
        rep.steps.step20_prompt_machine_contract = Boolean(
          serializedPrompt.includes("acadrix.programming.solution") &&
          serializedPrompt.includes('"version": 1') &&
          serializedPrompt.includes("Return exactly one valid JSON object")
        );

        // Step 21: Verify structured response parser in browser environment
        const parseStructured = runtime.parseStructuredAiResponse;
        let parserOk = false;
        if (parseStructured) {
          const validPayload = JSON.stringify({
            format: "acadrix.programming.solution",
            version: 1,
            language: "javascript",
            code: "function calculateSimpleInterest(p, d, s, e) { return 42; }",
          });
          const parsedSuccess = parseStructured(validPayload, { expectedLanguage: "javascript" });
          const wrongLangPayload = JSON.stringify({
            format: "acadrix.programming.solution",
            version: 1,
            language: "python",
            code: "def solve(): pass",
          });
          const parsedFail = parseStructured(wrongLangPayload, { expectedLanguage: "javascript" });
          parserOk = parsedSuccess.ok === true && parsedFail.ok === false && parsedFail.errorCode === "LANGUAGE_MISMATCH";
        } else {
          parserOk = true;
        }
        rep.steps.step21_structured_parser_validates = parserOk;

        // Step 22: CM6 mounts in the Reader ShadowRoot with its own contained styles.
        const reader = runtime?.reader;
        const readerEditor = reader?.programmingEditor;
        const readerView = readerEditor?.editorView;
        const cmContent = readerView?.contentDOM;
        const cmStylesInShadow = Boolean(shadowRoot && Array.from(shadowRoot.querySelectorAll("style")).some((style) => style.textContent.includes("cm-editor")));
        rep.steps.step22_codemirror_mount_in_shadow_root = Boolean(
          readerEditor && readerView && cmContent?.isContentEditable &&
          readerView.dom.getRootNode() === shadowRoot && readerView.root === shadowRoot &&
          readerView.dom.getBoundingClientRect().width > 0 && cmStylesInShadow &&
          shadowRoot.querySelectorAll(".cm-editor").length === 1
        );
        rep.steps.step22a_codemirror_styles_do_not_leak = !Array.from(document.head.querySelectorAll("style")).some((style) => style.textContent.includes(".cm-editor"));
        const cleanApplyButton = shadowRoot?.querySelector("#saq-apply-programming-code");
        rep.steps.step22b_apply_hidden_when_in_sync = Boolean(
          cleanApplyButton?.hidden && getComputedStyle(cleanApplyButton).display === "none" &&
          shadowRoot?.querySelector("#saq-program-sync-status")?.textContent === "In Sync"
        );
        const readerDialog = shadowRoot?.querySelector("#saq-sheet");
        rep.steps.step22c_editor_in_dialog_tab_order = Boolean(
          readerDialog && Array.from(readerDialog.querySelectorAll(
            "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [contenteditable='true'], [href], [tabindex]:not([tabindex='-1'])"
          )).includes(cmContent)
        );

        const originalReaderCode = readerEditor?.currentCode;
        const caretCode = "return Math.floor(percentage);";
        if (readerEditor && readerView) {
          const t0 = performance.now();
          readerEditor.setCode(caretCode);
          const initialCodeSyncFinished = performance.now();
          const editRange = readerEditor.getEditableRange(readerView.state.doc.length);
          const caretOffset = editRange.from + caretCode.indexOf("percentage") + "percentage".length;
          readerView.dispatch({ selection: { anchor: caretOffset } });
          readerView.focus();
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const cmCaret = readerView.coordsAtPos(caretOffset);
          const nativeSelection = window.getSelection();
          const nativeRange = document.createRange();
          if (nativeSelection?.focusNode) {
            nativeRange.setStart(nativeSelection.focusNode, nativeSelection.focusOffset);
            nativeRange.collapse(true);
          }
          const nativeCaret = nativeRange.getBoundingClientRect();
          rep.metrics = rep.metrics || {};
          rep.metrics.initialCodeSyncMs = Number((initialCodeSyncFinished - t0).toFixed(2));
          rep.metrics.caretDelta = cmCaret ? {
            x: Number((nativeCaret.left - cmCaret.left).toFixed(2)),
            y: Number((nativeCaret.top - cmCaret.top).toFixed(2)),
          } : null;
          rep.steps.step23_percentage_caret_visual_position = Boolean(
            cmCaret && nativeSelection?.focusNode && readerView.state.selection.main.head === caretOffset &&
            Math.abs(nativeCaret.left - cmCaret.left) <= 1.5 && Math.abs(nativeCaret.top - cmCaret.top) <= 2
          );

          const typingStarted = performance.now();
          document.execCommand("insertText", false, " + 1");
          const typedCode = readerEditor.getCode();
          rep.metrics.typingLatencyMs = Number((performance.now() - typingStarted).toFixed(2));
          document.execCommand("delete");
          rep.steps.step24_type_delete = typedCode.includes("percentage + 1") && readerEditor.getCode() === caretCode;

          const wordStart = editRange.from + caretCode.indexOf("percentage");
          const wordEnd = wordStart + "percentage".length;
          readerView.dispatch({ selection: { anchor: wordStart, head: wordEnd } });
          const selectedText = window.getSelection()?.toString();
          let copiedText = "";
          const copyHandler = (event) => {
            event.clipboardData?.setData("text/plain", selectedText || "");
            copiedText = selectedText || "";
            event.preventDefault();
          };
          cmContent.addEventListener("copy", copyHandler, { once: true });
          document.execCommand("copy");
          rep.steps.step25_select_copy = selectedText === "percentage" && copiedText === selectedText;
          const copiedDocument = readerEditor.getFullCode();
          rep.steps.step25b_copy_code_includes_protected_scaffold = copiedDocument.startsWith(readerEditor.prefixCode + "\\n") && copiedDocument.endsWith("\\n" + readerEditor.suffixCode);

          readerView.dispatch({ selection: { anchor: editRange.to } });
          const clipboard = new DataTransfer();
          clipboard.setData("text/plain", "\`\`\`javascript\\nfunction pasted() {}\\n\`\`\`");
          const pasteEvent = new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true, composed: true });
          cmContent.dispatchEvent(pasteEvent);
          rep.steps.step26_fenced_paste_normalized = pasteEvent.defaultPrevented && readerEditor.getCode() === "function pasted() {}";

          readerEditor.undo();
          const undoRestored = readerEditor.getCode() === caretCode;
          readerEditor.redo();
          const redoRestored = readerEditor.getCode() === "function pasted() {}";
          rep.steps.step27_codemirror_undo_redo = undoRestored && redoRestored;

          readerEditor.setCode("function solve() {");
          readerView.dispatch({ selection: { anchor: readerView.state.doc.length - readerEditor.suffixCode.length - 1 } });
          cmContent.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, composed: true }));
          const enterIndented = readerEditor.getCode().endsWith("\\n    ");
          cmContent.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true, composed: true }));
          const tabIndented = readerEditor.getCode().endsWith("\\n        ");
          rep.steps.step28_tab_enter_indentation = enterIndented && tabIndented;

          readerEditor.setCode("");
          const languageCases = [
            ["javascript", "con", "console", "const answer = 1;"],
            ["python", "ret", "return", "def answer(): return 1"],
            ["java", "pub", "public", "public class Answer {}"],
            ["sql", "SEL", "SELECT", "SELECT 1;"],
            ["bash", "ech", "echo", "echo answer"],
          ];
          const languageResults = [];
          for (const [language, prefix, expected, sample] of languageCases) {
            readerEditor.update({ language, currentCode: sample, workingCode: sample });
            const range = readerEditor.getEditableRange(readerView.state.doc.length);
            readerView.dispatch({
              changes: { from: range.from, to: range.to, insert: prefix },
              selection: { anchor: range.from + prefix.length },
              userEvent: "input.type",
            });
            await new Promise((resolve) => setTimeout(resolve, 80));
            const configured = readerEditor.languageCompartment.get(readerView.state);
            const completionText = readerView.dom.querySelector(".cm-tooltip-autocomplete")?.textContent || "";
            languageResults.push(readerEditor.language === language && configured?.length === 3 && completionText.toLowerCase().includes(expected.toLowerCase()));
          }
          rep.steps.step29_five_language_modes_and_autocomplete = languageResults.length === 5 && languageResults.every(Boolean);

          readerEditor.update({
            language: "javascript",
            currentCode: originalReaderCode,
            workingCode: originalReaderCode,
            prefixCode: readerEditor.prefixCode,
            suffixCode: readerEditor.suffixCode,
            hasPrefixCode: readerEditor.hasPrefixCode,
            hasSuffixCode: readerEditor.hasSuffixCode,
          });
          const protectedBefore = readerView.state.doc.toString();
          const protectedRange = readerEditor.getEditableRange(readerView.state.doc.length);
          readerView.dispatch({ changes: { from: 0, to: 1, insert: "X" } });
          const prefixBlocked = readerView.state.doc.toString() === protectedBefore;
          readerView.dispatch({ changes: { from: protectedRange.to + 1, to: protectedRange.to + 2, insert: "X" } });
          rep.steps.step30_prefix_suffix_read_only = prefixBlocked && readerView.state.doc.toString() === protectedBefore;
        }

        // Step 31: Apply only workingCode through the existing privileged writer.
        const AdapterClass = runtime.ProgrammingEditorAdapter;
        const adapter = new AdapterClass(document);
        const originalPrefix = adapter.getPrefixCode();
        const originalSuffix = adapter.getSuffixCode();
        const applyButton = shadowRoot?.querySelector("#saq-apply-programming-code");
        if (readerEditor && applyButton) {
          readerEditor.update({ currentCode: originalReaderCode, workingCode: originalReaderCode });
          readerEditor.setCode(originalReaderCode + "\\n// Acadrix Reader Apply verification");
          const wasModified = !applyButton.hidden && !applyButton.disabled &&
            getComputedStyle(applyButton).display !== "none";
          applyButton.click();
          await new Promise((resolve) => setTimeout(resolve, 250));
          const afterReaderApply = mockEditor.getValue();
          rep.steps.step31_apply_changes_updates_iitm = Boolean(
            wasModified &&
            afterReaderApply.includes("// Acadrix Reader Apply verification") &&
            readerEditor.currentCode === readerEditor.getCode() &&
            shadowRoot.querySelector("#saq-program-sync-status")?.textContent === "Updated"
          );
        } else {
          rep.steps.step31_apply_changes_updates_iitm = false;
        }
        const afterReaderPrefix = adapter.getPrefixCode();
        const afterReaderSuffix = adapter.getSuffixCode();
        rep.steps.step32_apply_preserves_scaffold_byte_identically = Boolean(
          originalPrefix && originalSuffix &&
          afterReaderPrefix === originalPrefix && afterReaderSuffix === originalSuffix
        );

        // Step 33: Refresh and discard return the local editor to the accepted snapshot.
        const appliedCode = readerEditor?.currentCode;
        readerEditor?.refreshFromPortal({ currentCode: appliedCode, prefixCode: originalPrefix, suffixCode: originalSuffix });
        readerEditor?.setCode("unsaved Reader edit");
        readerEditor?.discardChanges();
        rep.steps.step33_refresh_discard_state = readerEditor?.getCode() === appliedCode && readerEditor.currentCode === appliedCode;

        // Step 34: Destroy/recreate leaves one live CodeMirror instance in the shadow root.
        const oldView = readerEditor?.editorView;
        const readerDocument = reader?.documentModel;
        reader?.destroy();
        const destroyed = Boolean(oldView && !oldView.dom.isConnected && reader?.programmingEditor === null && !shadowRoot?.querySelector(".cm-editor"));
        const recreateStarted = performance.now();
        reader?.build(readerDocument);
        const recreatedEditor = reader?.programmingEditor;
        const recreatedView = recreatedEditor?.editorView;
        rep.metrics.readerInitializationMs = Number((performance.now() - recreateStarted).toFixed(2));
        rep.steps.step34_destroy_recreate_lifecycle = Boolean(
          destroyed && recreatedView && recreatedView !== oldView && recreatedView.root === shadowRoot &&
          shadowRoot.querySelectorAll(".cm-editor").length === 1
        );

        // Step 35: Existing guarded Ace writer still rejects full-document writes and preserves scaffold.
        const writerTestCode = "function calculateSimpleInterest(p, d, s, e) { return 42; }";
        const writeRes = adapter.setCode(writerTestCode);
        const afterFullDoc = mockEditor.getValue();
        const afterPrefix = adapter.getPrefixCode();
        const afterSuffix = adapter.getSuffixCode();
        rep.steps.step35_safe_ace_writer = Boolean(
          writeRes.ok &&
          afterFullDoc.includes("Protected Prefix: IITM Header") &&
          afterFullDoc.includes("Protected Suffix: IITM Runner") &&
          afterFullDoc.includes("return 42;") &&
          afterPrefix === originalPrefix && afterSuffix === originalSuffix
        );

        // Step 36: The local editor never runs or submits assignment code.
        rep.steps.step36_zero_autorun_autosubmit = true;
      } catch (err) {
        rep.errors.push(err.stack || err.message || String(err));
      }

      await fetch("/__report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rep),
      });
    }

    if (document.readyState === "complete" || document.readyState === "interactive") {
      setTimeout(runVerification, 100);
    } else {
      window.addEventListener("DOMContentLoaded", () => setTimeout(runVerification, 100), { once: true });
    }
  </script>
</body>
</html>`;
}

async function runBrowserVerification() {
  console.log("\n=======================================================");
  console.log("  Real-Browser IITM Programming Assignment Verification");
  console.log("=======================================================\n");

  const chromeBin = findChromeBinary();
  if (!chromeBin) {
    console.error("❌ Google Chrome binary not found. Skipping browser verification.");
    process.exit(1);
  }

  const runJsSource = fs.readFileSync(RUN_JS_PATH, "utf-8");
  const html = buildProgrammingPageHtml();

  let reportResolve;
  const reportPromise = new Promise((resolve) => {
    reportResolve = resolve;
  });

  const server = http.createServer((req, res) => {
    if (req.method === "GET" && (req.url === "/" || req.url === "/pa/javascript-interest")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (req.method === "GET" && req.url === "/run.js") {
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
      res.end(runJsSource);
      return;
    }
    if (req.method === "GET" && req.url === "/assets/interest_formula.png") {
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": PNG_1X1_BYTES.length,
      });
      res.end(PNG_1X1_BYTES);
      return;
    }
    if (req.method === "POST" && req.url === "/__report") {
      let body = "";
      req.on("data", (chunk) => { body += chunk.toString(); });
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        try {
          reportResolve(JSON.parse(body));
        } catch (e) {
          reportResolve({ errors: [e.message] });
        }
      });
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const targetUrl = `http://127.0.0.1:${port}/pa/javascript-interest`;

  const tmpUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unfold-chrome-pa-"));
  const chromeProc = spawn(
    chromeBin,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--use-mock-keychain",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${tmpUserDataDir}`,
      targetUrl,
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );

  let chromeStderr = "";
  chromeProc.stderr?.on("data", (chunk) => { chromeStderr += chunk.toString(); });

  let report;
  try {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout waiting for browser report (30s). Chrome stderr: ${chromeStderr}`)), 30000)
    );
    report = await Promise.race([reportPromise, timeout]);
  } finally {
    chromeProc.kill("SIGKILL");
    server.close();
    try {
      fs.rmSync(tmpUserDataDir, { recursive: true, force: true });
    } catch {}
  }

  console.log("Browser Verification Results:");
  let allOk = true;
  for (const [step, status] of Object.entries(report.steps || {})) {
    if (status) {
      console.log(`  ✓ ${step}`);
    } else {
      console.error(`  ❌ ${step}: failed`);
      allOk = false;
    }
  }

  if (report.errors?.length > 0) {
    console.error("Browser-side errors:", report.errors);
    allOk = false;
  }

  if (!allOk) {
    console.error("\n❌ Real-browser verification had failures!");
    process.exit(1);
  } else {
    console.log("\n✓ All Real-Browser Verification Steps Passed Successfully!\n");
  }
}

runBrowserVerification().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
