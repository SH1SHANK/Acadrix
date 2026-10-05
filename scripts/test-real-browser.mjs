#!/usr/bin/env node
/**
 * Real-Browser Automated End-to-End Smoke Test Suite.
 *
 * Classification: Automated Real-Browser Verification (Headless Google Chrome).
 * Launches a real headless Google Chrome instance against a local HTTP fixture server
 * serving a multi-question IITM assessment page and the compiled `build/run.js` bundle.
 *
 * Verifies in a real browser environment (Blink DOM + V8 + Shadow DOM + Fetch + Blob):
 * 1. Runtime launch (`build/run.js`) and Shadow DOM `#unfold-root` injection
 * 2. Assessment traversal across paginator chips with real MutationObserver readiness
 * 3. ReaderDrawer opening and UI rendering
 * 4. Markdown export trigger (`Blob`, `URL.createObjectURL`, `<a download>` click & removal, `URL.revokeObjectURL`)
 * 5. PDF/Print export trigger (`.saq-pdf-print-frame` iframe lifecycle, single `print()`, and DOM removal)
 * 6. Bundle ZIP export trigger (real HTTP image fetch, SVG capture, ZIP Blob creation, and host `unzip -t` verification)
 * 7. Button busy states and duplicate click blocking during active export
 * 8. Zero uncaught console/page errors and clean runtime teardown (`window.__unfold.destroy()`)
 *
 * Note: Live authenticated IITM portal verification remains a manual release checklist item
 * documented in `docs/manual-smoke-test.md`.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const RUN_JS_PATH = path.join(ROOT_DIR, "build", "run.js");

let passed = true;

async function check(desc, fn) {
  try {
    await fn();
    console.log(`✓ ${desc}`);
  } catch (e) {
    console.error(`❌ ${desc}: ${e.message}\n${e.stack}`);
    passed = false;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

// Valid 1x1 blue PNG pixel
const PNG_1X1_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d7636060f80f000104010054a24f5d0000000049454e44ae426082",
  "hex"
);

function findChromeBinary() {
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function buildFixtureHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>IITM Portal Fixture — Week 4 Graded Assignment</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 24px; background: #f8fafc; }
    .breadcrumb { font-weight: 600; margin-bottom: 12px; }
    .chips { display: flex; gap: 8px; margin-bottom: 16px; }
    .chip { padding: 6px 12px; border: 1px solid #cbd5e1; border-radius: 4px; cursor: pointer; background: #fff; }
    .chip.active { background: #2563eb; color: #fff; border-color: #1d4ed8; }
    .backend-html { padding: 16px; background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; }
    .choices { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
    .choice { padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; text-align: left; }
  </style>
</head>
<body>
  <app-assessment-question-view>
    <div class="app-assessment-container">
      <div class="breadcrumb">Week 4: Linear Algebra &amp; Optimization — Graded Assignment</div>
      <app-submission-timer>42:15</app-submission-timer>

      <div class="chips app-assessment-paginator">
        <button class="chip active" aria-current="true" data-qidx="0">1</button>
        <button class="chip" data-qidx="1">2</button>
        <button class="chip" data-qidx="2">3</button>
      </div>

      <div id="question-mount" class="question-body">
        <div class="header">
          <span class="question-header">Question 1 / 3</span>
          <span class="question-marks">2 Marks</span>
        </div>
        <div class="backend-html">
          <p>Consider the eigenvalue equation <span class="katex"><math><semantics><annotation encoding="application/x-tex">\\det(A - \\lambda I) = 0</annotation></semantics></math></span> for the matrix shown below:</p>
          <table>
            <thead><tr><th>Row</th><th>Col 1</th><th>Col 2</th></tr></thead>
            <tbody>
              <tr><td>1</td><td>4</td><td>1</td></tr>
              <tr><td>2</td><td>2</td><td>3</td></tr>
            </tbody>
          </table>
          <p><img src="/assets/matrix-plot.png" alt="Eigenvalue spectrum plot" /></p>
        </div>
        <app-assessment-question data-qid="q1">
          <div class="choices" role="radiogroup">
            <button class="choice" role="radio" aria-checked="true">
              <span class="choice-letter">A</span>
              <span class="choice-text">\\(\\lambda_1 = 5, \\lambda_2 = 2\\)</span>
            </button>
            <button class="choice" role="radio" aria-checked="false">
              <span class="choice-letter">B</span>
              <span class="choice-text">\\(\\lambda_1 = 4, \\lambda_2 = 3\\)</span>
            </button>
          </div>
        </app-assessment-question>
      </div>
    </div>
  </app-assessment-question-view>

  <script>
    // Interactive question data for real DOM replacement + MutationObserver verification
    const QUESTIONS_HTML = [
      \`<div class="header">
          <span class="question-header">Question 1 / 3</span>
          <span class="question-marks">2 Marks</span>
        </div>
        <div class="backend-html">
          <p>Consider the eigenvalue equation <span class="katex"><math><semantics><annotation encoding="application/x-tex">\\\\det(A - \\\\lambda I) = 0</annotation></semantics></math></span> for the matrix shown below:</p>
          <table>
            <thead><tr><th>Row</th><th>Col 1</th><th>Col 2</th></tr></thead>
            <tbody>
              <tr><td>1</td><td>4</td><td>1</td></tr>
              <tr><td>2</td><td>2</td><td>3</td></tr>
            </tbody>
          </table>
          <p><img src="/assets/matrix-plot.png" alt="Eigenvalue spectrum plot" /></p>
        </div>
        <app-assessment-question data-qid="q1">
          <div class="choices" role="radiogroup">
            <button class="choice" role="radio" aria-checked="true">
              <span class="choice-letter">A</span>
              <span class="choice-text">\\\\(\\\\lambda_1 = 5, \\\\lambda_2 = 2\\\\)</span>
            </button>
            <button class="choice" role="radio" aria-checked="false">
              <span class="choice-letter">B</span>
              <span class="choice-text">\\\\(\\\\lambda_1 = 4, \\\\lambda_2 = 3\\\\)</span>
            </button>
          </div>
        </app-assessment-question>\`,
      \`<div class="header">
          <span class="question-header">Question 2 / 3</span>
          <span class="question-marks">3 Marks</span>
        </div>
        <div class="backend-html">
          <p>Which of the following statements hold for the gradient descent update implemented below?</p>
          <pre><code class="language-python">def step(x, grad, lr=0.01):
    return x - lr * grad</code></pre>
          <p>Refer to the convergence diagram:</p>
          <svg viewBox="0 0 120 40" width="120" height="40" xmlns="http://www.w3.org/2000/svg">
            <rect x="4" y="4" width="112" height="32" rx="4" fill="#dbeafe" stroke="#2563eb" />
            <circle cx="60" cy="20" r="8" fill="#1d4ed8" />
          </svg>
        </div>
        <app-assessment-question data-qid="q2">
          <div class="choices">
            <button class="choice" role="checkbox" aria-checked="true">
              <span class="choice-letter">A</span>
              <span class="choice-text">Step size scales linearly with learning rate</span>
            </button>
            <button class="choice" role="checkbox" aria-checked="false">
              <span class="choice-letter">B</span>
              <span class="choice-text">Always converges for any learning rate</span>
            </button>
          </div>
        </app-assessment-question>\`,
      \`<div class="header">
          <span class="question-header">Question 3 / 3</span>
          <span class="question-marks">5 Marks</span>
        </div>
        <div class="backend-html">
          <p>Compute the optimal objective value of the least-squares problem:</p>
          <span class="katex-display"><math display="block"><semantics><annotation encoding="application/x-tex">\\\\min_{x \\\\in \\\\mathbb{R}^n} \\\\|Ax - b\\\\|_2^2</annotation></semantics></math></span>
          <p>See the <a href="https://study.iitm.ac.in/ds/docs">course reference notes</a> for details.</p>
        </div>
        <app-assessment-question data-qid="q3">
          <div class="form-field">
            <input type="number" class="gcb-unchanged" value="0" />
          </div>
        </app-assessment-question>\`
    ];

    const mount = document.getElementById("question-mount");
    const chips = Array.from(document.querySelectorAll(".chip"));
    chips.forEach((chip, idx) => {
      chip.addEventListener("click", () => {
        chips.forEach((c) => {
          c.classList.remove("active");
          c.removeAttribute("aria-current");
        });
        chip.classList.add("active");
        chip.setAttribute("aria-current", "true");
        mount.innerHTML = QUESTIONS_HTML[idx];
      });
    });

    // ── Telemetry & Browser API Instrumentation ───────────────────────────────
    const telemetry = {
      userAgent: navigator.userAgent,
      consoleErrors: [],
      pageErrors: [],
      unhandledRejections: [],
      createdBlobs: [],
      revokedUrls: [],
      downloads: [],
      printCalls: [],
      clipboardWrites: [],
      steps: {}
    };
    window.__unfoldTestTelemetry = telemetry;

    const origConsoleError = console.error.bind(console);
    console.error = (...args) => {
      const msg = args.map((a) => String(a)).join(" ");
      telemetry.consoleErrors.push(msg);
      origConsoleError(...args);
      fetch("/__log", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "[Console Error] " + msg }).catch(() => {});
    };
    window.addEventListener("error", (ev) => {
      const msg = ev.message || String(ev.error);
      telemetry.pageErrors.push(msg);
      fetch("/__log", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "[Page Error] " + msg }).catch(() => {});
    });
    window.addEventListener("unhandledrejection", (ev) => {
      const msg = String(ev.reason);
      telemetry.unhandledRejections.push(msg);
      fetch("/__log", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "[Unhandled Rejection] " + msg }).catch(() => {});
    });

    try {
      if (navigator.clipboard) {
        navigator.clipboard.writeText = async (text) => {
          telemetry.clipboardWrites.push(String(text));
        };
      }
    } catch (_e) {}

    const blobStore = new Map();
    const origCreateObjectURL = URL.createObjectURL.bind(URL);
    const origRevokeObjectURL = URL.revokeObjectURL.bind(URL);

    URL.createObjectURL = (blob) => {
      const url = origCreateObjectURL(blob);
      const entry = {
        url,
        type: blob ? blob.type : "",
        size: blob ? blob.size : 0,
        base64Promise: blob
          ? blob.arrayBuffer().then((buf) => {
              const bytes = new Uint8Array(buf);
              let binary = "";
              for (let i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
              }
              return btoa(binary);
            })
          : Promise.resolve("")
      };
      telemetry.createdBlobs.push(entry);
      blobStore.set(url, entry);
      return url;
    };

    URL.revokeObjectURL = (url) => {
      telemetry.revokedUrls.push(url);
      return origRevokeObjectURL(url);
    };

    const origAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.hasAttribute("download") || this.download) {
        telemetry.downloads.push({
          download: this.getAttribute("download") || this.download,
          href: this.getAttribute("href") || this.href,
          inBodyDuringClick: document.body.contains(this)
        });
        // Prevent native headless file save dialog while exercising exact DOM code path
        return;
      }
      return origAnchorClick.apply(this, arguments);
    };

    // Intercept iframe creation to hook contentWindow.print() on .saq-pdf-print-frame
    const origAppendChild = Element.prototype.appendChild;
    Element.prototype.appendChild = function (child) {
      const res = origAppendChild.apply(this, arguments);
      if (
        child &&
        child.tagName === "IFRAME" &&
        child.classList &&
        child.classList.contains("saq-pdf-print-frame") &&
        child.contentWindow
      ) {
        child.contentWindow.print = () => {
          const iframeDoc = child.contentDocument;
          const imgEl = iframeDoc ? iframeDoc.querySelector(".saq-pdf-image") : null;
          const svgEl = iframeDoc ? iframeDoc.querySelector(".saq-pdf-svg-wrap svg") : null;
          telemetry.printCalls.push({
            iframeInBody: document.body.contains(child),
            hasAriaHidden: child.getAttribute("aria-hidden") === "true",
            htmlLength: iframeDoc ? iframeDoc.documentElement.innerHTML.length : 0,
            questionCount: iframeDoc ? iframeDoc.querySelectorAll(".saq-pdf-question").length : 0,
            hasImageAndSvg: Boolean(imgEl && svgEl),
            imageComplete: Boolean(imgEl && imgEl.complete),
            documentTitleDuringPrint: document.title
          });
          setTimeout(() => {
            if (child.contentWindow) {
              child.contentWindow.dispatchEvent(new Event("afterprint"));
            }
          }, 25);
        };
      }
      return res;
    };

    // Simulate Chrome Extension content-script environment for build/run.js
    window.chrome = window.chrome || {};
    window.chrome.runtime = { id: "unfold-iitm-extension-smoke-test" };
  </script>
  <script src="/run.js"></script>
  <script>
    async function sleep(ms) {
      return new Promise((r) => setTimeout(r, ms));
    }

    async function remoteLog(msg) {
      try {
        await fetch("/__log", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: String(msg)
        });
      } catch {}
    }

    let smokeSuiteRan = false;
    async function runInBrowserSmokeSuite() {
      if (smokeSuiteRan) return;
      smokeSuiteRan = true;
      const t = window.__unfoldTestTelemetry;
      try {
        await remoteLog("Browser suite started");
        // Step 1: Verify runtime launch & Shadow DOM launcher
        const runtime = window.__unfold;
        const hostEl = document.getElementById("unfold-root");
        const shadow = hostEl ? hostEl.shadowRoot : null;
        const launcher = shadow ? shadow.querySelector(".saq-launcher") : null;

        await remoteLog("Step 1 starting");
        t.steps.step1 = {
          hasRuntime: Boolean(runtime),
          lifecycleState: runtime ? runtime.lifecycle.state : null,
          hasHostEl: Boolean(hostEl),
          hasShadowRoot: Boolean(shadow),
          launcherShown: Boolean(launcher && launcher.classList.contains("is-shown"))
        };

        // Step 2: Click launcher, traverse all 3 questions, open ReaderDrawer
        await remoteLog("Step 2 clicking launcher");
        launcher.click();
        // Wait for traversal across 3 chips + restoration + requestAnimationFrame(.is-open) to complete
        for (let i = 0; i < 80; i++) {
          await sleep(50);
          const s = shadow.querySelector("#saq-sheet");
          if (runtime.lifecycle.state === "open" && runtime.activeDocument && s && s.classList.contains("is-open")) {
            break;
          }
        }
        await sleep(50);
        await remoteLog("Step 2 traversal completed");

        const sheet = shadow.querySelector("#saq-sheet");
        const activeChipAfterOpen = document.querySelector(".chip.active");
        t.steps.step2 = {
          lifecycleState: runtime.lifecycle.state,
          sheetOpen: Boolean(sheet && sheet.classList.contains("is-open")),
          questionCount: runtime.activeDocument ? runtime.activeDocument.questions.length : 0,
          restoredChipText: activeChipAfterOpen ? activeChipAfterOpen.textContent.trim() : null,
          hasMdBtn: Boolean(sheet && sheet.querySelector("[data-act='export-md']")),
          hasPrintBtn: Boolean(sheet && sheet.querySelector("[data-act='print']")),
          hasCopyQBtn: Boolean(sheet && sheet.querySelector("[data-act='copy-questions']")),
          hasImportBtn: Boolean(sheet && sheet.querySelector("[data-act='import-answers']")),
          hasApplyBtn: Boolean(sheet && sheet.querySelector("[data-act='apply-answers']")),
          hasRefreshBtn: Boolean(sheet && sheet.querySelector("[data-act='refresh']")),
          hasCloseBtn: Boolean(sheet && sheet.querySelector("[data-act='dismiss']")),
          renderedQuestionCards: sheet ? sheet.querySelectorAll(".saq-block").length : 0
        };

        // Step 3: Trigger Markdown export via Reader button click
        await remoteLog("Step 3 markdown export");
        const docBeforeMd = runtime.activeDocument;
        const mdBtn = sheet.querySelector("[data-act='export-md']");
        mdBtn.click();
        for (let i = 0; i < 40; i++) {
          await sleep(50);
          if (!runtime.orchestrator.isBusy() && t.downloads.length >= 1 && t.revokedUrls.length >= 1) break;
        }
        await sleep(300);
        await remoteLog("Step 3 markdown completed");

        const mdBlobEntry = t.createdBlobs[0];
        const mdBase64 = mdBlobEntry ? await mdBlobEntry.base64Promise : "";
        t.steps.step3 = {
          downloadCount: t.downloads.length,
          downloadFilename: t.downloads[0] ? t.downloads[0].download : null,
          inBodyDuringClick: t.downloads[0] ? t.downloads[0].inBodyDuringClick : false,
          lingeringAnchorsInBody: document.body.querySelectorAll("a[download]").length,
          blobType: mdBlobEntry ? mdBlobEntry.type : null,
          blobSize: mdBlobEntry ? mdBlobEntry.size : 0,
          urlRevoked: Boolean(mdBlobEntry && t.revokedUrls.includes(mdBlobEntry.url)),
          reusedActiveDocument: runtime.activeDocument === docBeforeMd,
          mdBase64
        };

        // Step 4: Trigger PDF/Print export via Reader button click (fallback print mode)
        const originalDocTitle = document.title;
        const printBtn = sheet.querySelector("[data-act='print']");
        printBtn.click();
        for (let i = 0; i < 60; i++) {
          await sleep(50);
          if (!runtime.orchestrator.isBusy() && t.printCalls.length >= 1) break;
        }
        await sleep(100);

        t.steps.step4 = {
          printCallCount: t.printCalls.length,
          printDetails: t.printCalls[0] || null,
          originalDocTitle,
          documentTitleAfterPrint: document.title,
          lingeringPrintIframes: document.querySelectorAll(".saq-pdf-print-frame").length,
          lingeringPrintStyles: document.querySelectorAll(".saq-pdf-print-mode-style").length
        };

        // Step 5: Trigger Bundle ZIP export & test busy-state duplicate click blocking
        const downloadsBeforeBundle = t.downloads.length;
        const bundlePromise = runtime.handleExportAction("bundle");

        // Immediately inspect busy state while export is in-flight
        const busySnapshot = {
          isExporting: runtime.orchestrator.isBusy(),
          mdDisabled: mdBtn.hasAttribute("disabled"),
          printDisabled: printBtn.hasAttribute("disabled"),
          isExportingActive: runtime.orchestrator.isBusy()
        };

        // Attempt a duplicate click while busy (or via handleExportAction)
        mdBtn.click();
        await runtime.handleExportAction("markdown");
        await bundlePromise;

        for (let i = 0; i < 60; i++) {
          await sleep(50);
          if (!runtime.orchestrator.isBusy() && t.downloads.length > downloadsBeforeBundle) break;
        }
        await sleep(300);

        const zipDownload = t.downloads[t.downloads.length - 1];
        const zipBlobEntry = t.createdBlobs[t.createdBlobs.length - 1];
        const zipBase64 = zipBlobEntry ? await zipBlobEntry.base64Promise : "";

        t.steps.step5 = {
          busySnapshot,
          downloadsTriggeredForBundle: t.downloads.length - downloadsBeforeBundle,
          zipFilename: zipDownload ? zipDownload.download : null,
          zipInBodyDuringClick: zipDownload ? zipDownload.inBodyDuringClick : false,
          lingeringAnchorsInBody: document.body.querySelectorAll("a[download]").length,
          zipBlobType: zipBlobEntry ? zipBlobEntry.type : null,
          zipBlobSize: zipBlobEntry ? zipBlobEntry.size : 0,
          zipUrlRevoked: Boolean(zipBlobEntry && t.revokedUrls.includes(zipBlobEntry.url)),
          buttonsReEnabledAfterExport:
            !mdBtn.hasAttribute("disabled") &&
            !printBtn.hasAttribute("disabled") &&
            !runtime.orchestrator.isBusy(),
          zipBase64
        };

        // Step 5b: Verify Exact 7 Top-Bar Actions, 1-Click Copy Questions, Direct PDF, and Panel/Dialog Esc in Real Chrome
        // 1. 1-click Copy Questions directly from top bar
        const copyQuestionsBtn = sheet.querySelector("[data-act='copy-questions']");
        copyQuestionsBtn.click();
        await sleep(50);
        const direct1ClickCopied = t.clipboardWrites.length >= 1 && t.clipboardWrites[0].includes("You are solving an assessment.");

        // 2. Exact 7 top-bar actions
        const hasImportBtn = Boolean(sheet.querySelector("[data-act='import-answers']"));
        const hasApplyBtn = Boolean(sheet.querySelector("[data-act='apply-answers']"));
        const hasCopyQBtn = Boolean(sheet.querySelector("[data-act='copy-questions']"));
        const hasPrintBtn = Boolean(sheet.querySelector("[data-act='print']"));
        const hasMdBtn = Boolean(sheet.querySelector("[data-act='export-md']"));
        const hasRefreshBtn = Boolean(sheet.querySelector("[data-act='refresh']"));
        const hasCloseBtn = Boolean(sheet.querySelector("[data-act='dismiss']"));

        // 3. Direct PDF download via chrome.runtime.sendMessage in Real Chrome
        window.chrome.runtime.sendMessage = (msg, cb) => {
          if (msg && msg.type === "UNFOLD_PRINT_TO_PDF") {
            setTimeout(() => {
              cb({ ok: true, data: btoa("%PDF-1.4 mock pdf") });
            }, 15);
          }
        };
        const downloadsBeforeDirectPdf = t.downloads.length;
        const printCountBeforeDirectPdf = t.printCalls.length;
        await runtime.handleExportAction("pdf");
        await sleep(300);
        const directPdfDownload = t.downloads[t.downloads.length - 1];
        const directPdfBlobEntry = t.createdBlobs[t.createdBlobs.length - 1];
        const directPdfTriggered =
          t.downloads.length === downloadsBeforeDirectPdf + 1 &&
          t.printCalls.length === printCountBeforeDirectPdf &&
          directPdfDownload?.download === "Week 04 - GA.pdf" &&
          directPdfBlobEntry?.type === "application/pdf" &&
          t.revokedUrls.includes(directPdfBlobEntry?.url);
        delete window.chrome.runtime.sendMessage;

        // 4. Test Import Answers panel Esc
        const importBtn = sheet.querySelector("[data-act='import-answers']");
        const importPanel = sheet.querySelector("#saq-import-panel");
        importBtn.click();
        await sleep(20);
        const importPanelOpen = importPanel && !importPanel.hasAttribute("hidden");
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        await sleep(20);
        const importPanelClosedAfterFirstEsc = importPanel && importPanel.hasAttribute("hidden");
        const readerStillOpenAfterFirstEsc = sheet.classList.contains("is-open");

        // 5. Test Apply Answers dialog Esc
        const applyBtn = sheet.querySelector("[data-act='apply-answers']");
        const applyDialog = sheet.querySelector("#saq-apply-dialog");
        applyBtn.click();
        await sleep(20);
        const applyDialogOpen = applyDialog && !applyDialog.hasAttribute("hidden");
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        await sleep(20);
        const applyDialogClosedAfterFirstEsc = applyDialog && applyDialog.hasAttribute("hidden");

        t.steps.step5b = {
          hasCopyQBtn,
          hasImportBtn,
          hasApplyBtn,
          hasPrintBtn,
          hasMdBtn,
          hasRefreshBtn,
          hasCloseBtn,
          direct1ClickCopied,
          directPdfTriggered,
          importPanelOpen,
          importPanelClosedAfterFirstEsc,
          applyDialogOpen,
          applyDialogClosedAfterFirstEsc,
          readerStillOpenAfterFirstEsc
        };

        // Step 5c: Verify Release 2 answer-key import in real Chrome.
        const importDoc = {
          metadata: { title: "Import Fixture", totalQuestions: 4 },
          questions: [
            { number: 1, type: "single_choice", label: "Question 1", stem: [{ type: "text", value: "One" }], options: [{ letter: "A", content: [{ type: "text", value: "A" }] }, { letter: "B", content: [{ type: "text", value: "B" }] }] },
            { number: 2, type: "multiple_choice", label: "Question 2", stem: [{ type: "text", value: "Many" }], options: [{ letter: "A", content: [{ type: "text", value: "A" }] }, { letter: "B", content: [{ type: "text", value: "B" }] }, { letter: "C", content: [{ type: "text", value: "C" }] }] },
            { number: 3, type: "numerical", label: "Question 3", stem: [{ type: "text", value: "Number" }], options: [] },
            { number: 4, type: "text", label: "Question 4", stem: [{ type: "text", value: "Text" }], options: [] }
          ]
        };
        runtime.reader.build(importDoc, { onDismiss: () => runtime.close() });
        runtime.reader.show();
        await sleep(40);
        const importSheet = shadow.querySelector("#saq-sheet");
        const importButton = importSheet.querySelector("[data-act='import-answers']");
        const copyQBtnInImport = importSheet.querySelector("[data-act='copy-questions']");
        copyQBtnInImport.click();
        await sleep(20);
        const importPrompt = t.clipboardWrites[t.clipboardWrites.length - 1] || "";
        const importFp = (importPrompt.match(/\"fp\":\"([0-9a-f]{8})\"/) || [])[1];

        importButton.click();
        await sleep(10);
        const testImportPanel = importSheet.querySelector("#saq-import-panel");
        const importTextarea = testImportPanel.querySelector("textarea");
        const importAnswers = [
          { question: 1, type: "MCQ", answer: "B" },
          { question: 2, type: "MSQ", answer: ["C", "A"] },
          { question: 3, type: "NUMERICAL", answer: "42.50" },
          { question: 4, type: "TEXT", answer: "<img onerror=alert(1)>" }
        ];
        importTextarea.value = JSON.stringify({ acadrix: 1, fp: importFp, answers: importAnswers });
        testImportPanel.querySelector("[data-act='import-submit']").click();
        await sleep(20);
        const importBadges = Array.from(importSheet.querySelectorAll("[data-acx-ai-answer]"));
        const hostileBadge = importBadges.find((badge) => badge.textContent.includes("<img"));

        const focusInImportPanel = testImportPanel.contains(shadow.activeElement);
        testImportPanel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        await sleep(10);
        t.steps.step5c = {
          hasImportButton: Boolean(importButton),
          hasDialogAndName: testImportPanel.getAttribute("role") === "dialog" && testImportPanel.getAttribute("aria-labelledby") === "saq-import-title",
          fingerprintCaptured: Boolean(importFp),
          badgeCount: importBadges.length,
          badges: importBadges.map((badge) => badge.textContent),
          hostileTextInert: Boolean(hostileBadge && !hostileBadge.querySelector("img") && hostileBadge.textContent.includes("<img onerror=alert(1)>")),
          focusInImportPanel,
          panelClosedAfterEscape: testImportPanel.hasAttribute("hidden"),
          readerOpenAfterEscape: importSheet.classList.contains("is-open")
        };

        // Step 5f: Verify Interactive Answer Review Controls, Single Apply AI, and Portal Apply Dialog in Real Chrome
        const qCards = Array.from(importSheet.querySelectorAll(".saq-block"));
        const q1Card = qCards[0];
        const q2Card = qCards[1];
        const q3Card = qCards[2];

        // 1. MCQ Interaction on Q1 (AI suggested "B")
        q1Card.querySelector(".saq-option[data-letter='A']").click(); // Select A (overriding AI B)
        await sleep(10);
        const q1OptASelected = q1Card.querySelector(".saq-option[data-letter='A']").classList.contains("is-selected");
        const q1BadgeOverridden = q1Card.querySelector(".saq-status-badge")?.textContent === "Overridden";

        q1Card.querySelector("[data-act='apply-single-ai']").click(); // Quick apply AI B
        await sleep(10);
        const q1OptBSelected = q1Card.querySelector(".saq-option[data-letter='B']").classList.contains("is-selected");
        const q1BadgeMatched = q1Card.querySelector(".saq-status-badge")?.textContent === "AI Match";

        // 2. MSQ Interaction on Q2 (AI suggested ["A", "C"])
        q2Card.querySelector(".saq-option[data-letter='B']").click(); // Select B
        await sleep(10);
        const q2OptBSelected = q2Card.querySelector(".saq-option[data-letter='B']").classList.contains("is-selected");
        q2Card.querySelector("[data-act='apply-single-ai']").click(); // Quick apply AI A & C
        await sleep(10);
        const q2OptA = q2Card.querySelector(".saq-option[data-letter='A']");
        const q2OptB = q2Card.querySelector(".saq-option[data-letter='B']");
        const q2OptC = q2Card.querySelector(".saq-option[data-letter='C']");
        const q2OptsACSelected = Boolean(q2OptA?.classList.contains("is-selected") && q2OptC?.classList.contains("is-selected") && !q2OptB?.classList.contains("is-selected"));
        const q2BadgeMatched = q2Card.querySelector(".saq-status-badge")?.textContent === "AI Match";

        // 3. Numerical Interaction on Q3 (AI suggested "42.50")
        const q3Input = q3Card.querySelector(".saq-num-input");
        q3Input.value = "100.5";
        q3Input.dispatchEvent(new Event("input", { bubbles: true }));
        await sleep(10);
        const q3BadgeOverridden = q3Card.querySelector(".saq-status-badge")?.textContent === "Overridden";

        q3Card.querySelector("[data-act='clear-input']").click(); // Clear numerical input
        await sleep(10);
        const q3Cleared = q3Card.querySelector(".saq-num-input")?.value === "";
        const q3BadgeSuggested = q3Card.querySelector(".saq-status-badge")?.textContent === "AI Suggested";

        q3Card.querySelector("[data-act='apply-single-ai']").click(); // Quick apply AI canonical 42.5
        await sleep(10);
        const q3AppliedVal = q3Card.querySelector(".saq-num-input")?.value === "42.5";
        const q3BadgeMatched = q3Card.querySelector(".saq-status-badge")?.textContent === "AI Match";

        // 4. Apply Answers Dialog Flow
        const applyAnswersTrigger = importSheet.querySelector("[data-act='apply-answers']");
        const applyDialogEl = importSheet.querySelector("#saq-apply-dialog");
        const readyBadgeText = importSheet.querySelector("[data-ready-badge]")?.textContent;

        applyAnswersTrigger.click();
        await sleep(10);
        const isApplyDialogOpen = applyDialogEl && !applyDialogEl.hasAttribute("hidden");
        const summaryReady = applyDialogEl.querySelector("[data-summary-ready]")?.textContent;
        const summaryMatched = applyDialogEl.querySelector("[data-summary-matched]")?.textContent;

        applyDialogEl.querySelector("[data-act='apply-cancel']").click();
        await sleep(10);
        const applyDialogClosed = applyDialogEl.hasAttribute("hidden");

        t.steps.step5f = {
          q1OptASelected,
          q1BadgeOverridden,
          q1OptBSelected,
          q1BadgeMatched,
          q2OptBSelected,
          q2OptsACSelected,
          q2BadgeMatched,
          q3BadgeOverridden,
          q3Cleared,
          q3BadgeSuggested,
          q3AppliedVal,
          q3BadgeMatched,
          hasApplyButton: Boolean(applyAnswersTrigger),
          readyBadgeText,
          applyDialogOpen: isApplyDialogOpen,
          summaryReady,
          summaryMatched,
          applyDialogClosed
        };

        // Close reader drawer before navigation test
        runtime.close();
        await sleep(20);

        // Step 5e: In-App Client-Side Navigation Auto-Detection & Dynamic Sidebar
        const assessmentContainer = document.querySelector("app-assessment-question-view");
        const savedAssessmentHtml = assessmentContainer.outerHTML;

        // 1. Navigate assessment -> non-assessment (replace DOM)
        const nonAssessmentNode = document.createElement("div");
        nonAssessmentNode.id = "non-assessment-view";
        nonAssessmentNode.innerHTML = "<h1>Course Catalog</h1><p>Browse available courses</p>";
        assessmentContainer.replaceWith(nonAssessmentNode);
        await sleep(180);

        const hostAfterNavOut = document.getElementById("unfold-root");
        const launcherAfterNavOut = hostAfterNavOut?.shadowRoot?.querySelector(".saq-launcher.is-shown");
        const lifecycleAfterNavOut = runtime.lifecycle.state;

        // 2. Navigate non-assessment -> assessment (restore assessment DOM without popup action)
        nonAssessmentNode.replaceWith(assessmentContainer);
        await sleep(180);

        const hostAfterNavIn = document.getElementById("unfold-root");
        const launcherAfterNavIn = hostAfterNavIn?.shadowRoot?.querySelector(".saq-launcher.is-shown");
        const lifecycleAfterNavIn = runtime.lifecycle.state;
        const readerAutoOpened = Boolean(hostAfterNavIn?.shadowRoot?.querySelector("#saq-sheet.is-open"));

        // 3. Dynamic Sidebar Insertion: Insert sidebar after boot
        const sidebarMount = document.createElement("div");
        sidebarMount.id = "sidebar-dynamic-mount";
        sidebarMount.innerHTML = \`
          <div class="nav-container side-nav" id="side-nav-content">
            <h1 class="side-nav-title">Sep 2026 - MAD II</h1>
            <div class="unit-container">
              <div class="unit-title">Week 1</div>
              <button class="child-row">
                <div class="child-title">Graded Assignment 1</div>
                <div class="child-type">Assignment</div>
              </button>
            </div>
          </div>\`;
        document.body.appendChild(sidebarMount);
        await sleep(180);

        const decorElements = document.querySelectorAll("acx-portal-decor, [data-acx-decor]");
        const decorCount = decorElements.length;

        // 4. Repeated navigation cycles (idempotence / no duplicate roots)
        for (let i = 0; i < 3; i++) {
          assessmentContainer.remove();
          await sleep(50);
          document.body.appendChild(assessmentContainer);
          await sleep(50);
        }
        await sleep(180);
        const rootElementsCount = document.querySelectorAll("#unfold-root").length;

        // 5. Flood of mutations (50 rapid DOM mutations trigger debounced detection)
        let detectCountDuringFlood = 0;
        const origDetect = runtime.detect.bind(runtime);
        runtime.detect = () => {
          detectCountDuringFlood++;
          return origDetect();
        };
        for (let i = 0; i < 50; i++) {
          const scratch = document.createElement("span");
          scratch.textContent = "tick-" + i;
          document.body.appendChild(scratch);
          scratch.remove();
        }
        await sleep(180);
        runtime.detect = origDetect;

        t.steps.step5e = {
          launcherRemovedOnExit: !Boolean(launcherAfterNavOut),
          lifecycleAfterNavOut,
          launcherAppearedOnEnter: Boolean(launcherAfterNavIn),
          lifecycleAfterNavIn,
          readerDidNotAutoOpen: !readerAutoOpened,
          sidebarDecorAppeared: decorCount > 0,
          rootElementsCount,
          detectCountDuringFlood
        };

        // Step 6: Teardown & Destruction
        runtime.destroy();
        t.steps.step6 = {
          lifecycleStateAfterDestroy: runtime.lifecycle.state,
          unfoldRootAfterDestroy: document.getElementById("unfold-root") === null,
          lingeringPrintIframes: document.querySelectorAll(".saq-pdf-print-frame").length,
          lingeringDownloadAnchors: document.body.querySelectorAll("a[download]").length,
          consoleErrorCount: t.consoleErrors.length,
          pageErrorCount: t.pageErrors.length,
          unhandledRejectionCount: t.unhandledRejections.length
        };
      } catch (err) {
        t.fatalError = err ? (err.stack || err.message || String(err)) : "Unknown error";
      }

      await fetch("/__report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(t)
      });
    }

    if (document.readyState === "complete" || document.readyState === "interactive") {
      setTimeout(runInBrowserSmokeSuite, 50);
    } else {
      window.addEventListener("DOMContentLoaded", () => {
        setTimeout(runInBrowserSmokeSuite, 50);
      }, { once: true });
    }
  </script>
</body>
</html>`;
}

async function runRealBrowserTests() {
  console.log("\nStarting Phase 7.1 Real-Browser End-to-End Smoke Tests (Headless Chrome)...\n");

  const chromeBin = findChromeBinary();
  assert(chromeBin !== null, "Google Chrome binary must be installed for real-browser verification");
  assert(fs.existsSync(RUN_JS_PATH), "build/run.js must exist before running real-browser tests (run `npm run build` first)");

  const runJsSource = fs.readFileSync(RUN_JS_PATH, "utf-8");
  const fixtureHtml = buildFixtureHtml();

  let reportResolve;
  const reportPromise = new Promise((resolve) => {
    reportResolve = resolve;
  });

  const server = http.createServer((req, res) => {
    console.log(`[Server] ${req.method} ${req.url}`);
    if (req.method === "GET" && (req.url === "/" || req.url === "/quiz/weekly-assignment-4")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fixtureHtml);
      return;
    }
    if (req.method === "GET" && req.url === "/run.js") {
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
      res.end(runJsSource);
      return;
    }
    if (req.method === "GET" && req.url.includes(".woff2")) {
      const fontName = path.basename(req.url.split("?")[0]);
      const fontPath = path.join(ROOT_DIR, "extension", "fonts", fontName);
      if (fs.existsSync(fontPath)) {
        res.writeHead(200, { "Content-Type": "font/woff2" });
        res.end(fs.readFileSync(fontPath));
        return;
      }
    }
    if (req.method === "GET" && req.url === "/assets/matrix-plot.png") {
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": PNG_1X1_BYTES.length,
        "Cache-Control": "no-store",
      });
      res.end(PNG_1X1_BYTES);
      return;
    }
    if (req.method === "POST" && req.url === "/__log") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        console.log(`[Browser Log] ${body}`);
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
      });
      return;
    }
    if (req.method === "POST" && req.url === "/__report") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        try {
          reportResolve(JSON.parse(body));
        } catch (err) {
          reportResolve({ fatalError: `Failed to parse browser report JSON: ${err.message}` });
        }
      });
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const targetUrl = `http://127.0.0.1:${port}/quiz/weekly-assignment-4`;

  const tmpUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unfold-chrome-profile-"));
  let chromeStderr = "";
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
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-sync",
      "--disable-extensions",
      "--mute-audio",
      "--hide-scrollbars",
      "--disable-features=Translate,OptimizationHints,MediaRouter",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      `--user-data-dir=${tmpUserDataDir}`,
      targetUrl,
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );

  chromeProc.stderr?.on("data", (chunk) => {
    chromeStderr += chunk.toString();
  });

  let report;
  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out waiting for real-browser test report (45s)\nChrome stderr: ${chromeStderr}`)), 45000)
    );
    report = await Promise.race([reportPromise, timeoutPromise]);
  } finally {
    chromeProc.kill("SIGKILL");
    server.closeAllConnections?.();
    server.close();
    try {
      fs.rmSync(tmpUserDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // ignore lingering OS file lock on temp profile dir
    }
  }

  if (report.fatalError) {
    throw new Error(`Real-browser fatal error: ${report.fatalError}`);
  }

  // ── Check 1: Runtime Launch & Shadow DOM Injection ────────────────────────
  await check("Real-Browser Check 1: Launches build/run.js in Headless Chrome and mounts Shadow DOM launcher", () => {
    assert(
      report.userAgent && report.userAgent.includes("Chrome/"),
      `Expected real Chrome userAgent, got: ${report.userAgent}`
    );
    const s1 = report.steps.step1;
    assert(s1 && s1.hasRuntime === true, "window.__unfold runtime must be initialized");
    assert(s1.lifecycleState === "active", `Expected ACTIVE state, got ${s1.lifecycleState}`);
    assert(s1.hasHostEl === true, "#unfold-root host element must be attached to document");
    assert(s1.hasShadowRoot === true, "Open ShadowRoot must be attached to #unfold-root");
    assert(s1.launcherShown === true, ".saq-launcher button must be visible (.is-shown)");
  });

  // ── Check 2: Assessment Traversal & Reader Opening ────────────────────────
  await check("Real-Browser Check 2: Traverses multi-question DOM with real MutationObserver and opens ReaderDrawer", () => {
    const s2 = report.steps.step2;
    assert(s2 && s2.lifecycleState === "open", `Expected OPEN state, got ${s2?.lifecycleState}`);
    assert(s2.sheetOpen === true, "#saq-sheet must have .is-open class in Shadow DOM");
    assert(s2.questionCount === 3, `Expected 3 extracted questions, got ${s2.questionCount}`);
    assert(s2.restoredChipText === "1", `Expected original chip '1' restored, got '${s2.restoredChipText}'`);
    assert(s2.hasMdBtn && s2.hasPrintBtn && s2.hasCopyQBtn && s2.hasImportBtn && s2.hasApplyBtn && s2.hasRefreshBtn && s2.hasCloseBtn, "All Reader top-bar action buttons must be rendered");
    assert(s2.renderedQuestionCards === 3, `Expected 3 rendered .saq-block elements, got ${s2.renderedQuestionCards}`);
  });

  // ── Check 3: Markdown Export & Download Cleanup ───────────────────────────
  await check("Real-Browser Check 3: Markdown export creates valid Blob, clicks & removes <a download>, and revokes Blob URL", () => {
    const s3 = report.steps.step3;
    assert(s3 && s3.downloadCount === 1, `Expected 1 download triggered, got ${s3?.downloadCount}`);
    assert(s3.downloadFilename.endsWith(".md"), `Expected .md filename, got ${s3.downloadFilename}`);
    assert(s3.inBodyDuringClick === true, "Temporary <a download> must be in document.body during click()");
    assert(s3.lingeringAnchorsInBody === 0, "Temporary <a download> must be removed from DOM after click()");
    assert(s3.blobType.includes("text/markdown"), `Expected text/markdown Blob type, got ${s3.blobType}`);
    assert(s3.blobSize > 200, `Expected non-trivial Markdown Blob size, got ${s3.blobSize}`);
    assert(s3.urlRevoked === true, "URL.revokeObjectURL must be called for Markdown Blob URL");
    assert(s3.reusedActiveDocument === true, "Markdown export must reuse cached activeDocument without re-traversal");

    const mdContent = Buffer.from(s3.mdBase64, "base64").toString("utf-8");
    assert(mdContent.includes("# Week 4: Linear Algebra & Optimization"), "Markdown must contain assignment title");
    assert(mdContent.includes("\\det(A - \\lambda I) = 0"), "Markdown must preserve extracted LaTeX math");
    assert(mdContent.includes("```python"), "Markdown must preserve fenced Python code block");
  });

  // ── Check 4: PDF/Print Export Lifecycle & Iframe Cleanup ──────────────────
  await check("Real-Browser Check 4: PDF/Print export renders print iframe with image & SVG, sets & restores intelligent document.title, invokes print() once, and removes iframe", () => {
    const s4 = report.steps.step4;
    assert(s4 && s4.printCallCount === 1, `Expected exactly 1 print() invocation, got ${s4?.printCallCount}`);
    assert(s4.printDetails.iframeInBody === true, "Print iframe must be mounted in document.body during print()");
    assert(s4.printDetails.hasAriaHidden === true, "Print iframe must have aria-hidden='true'");
    assert(s4.printDetails.questionCount === 3, `Expected 3 rendered questions in print document, got ${s4.printDetails.questionCount}`);
    assert(s4.printDetails.hasImageAndSvg === true, "Print document must render both .saq-pdf-image and .saq-pdf-svg-wrap svg");
    assert(s4.printDetails.imageComplete === true, "Image in print iframe must finish loading before print() is invoked");
    assert(s4.printDetails.documentTitleDuringPrint === "Week 04 - GA", `Expected document.title 'Week 04 - GA' during print(), got '${s4.printDetails.documentTitleDuringPrint}'`);
    assert(s4.documentTitleAfterPrint === s4.originalDocTitle, `Expected document.title restored to '${s4.originalDocTitle}' after afterprint, got '${s4.documentTitleAfterPrint}'`);
    assert(s4.lingeringPrintIframes === 0, "Print iframe (.saq-pdf-print-frame) must be removed after afterprint");
    assert(s4.lingeringPrintStyles === 0, "Print mode style (.saq-pdf-print-mode-style) must be removed after afterprint");
  });

  // ── Check 5: Bundle ZIP Export & External `unzip -t` Verification ─────────
  await check("Real-Browser Check 5: Bundle export packages fetched assets into valid ZIP passing system `unzip -t`", () => {
    const s5 = report.steps.step5;
    assert(s5 && s5.downloadsTriggeredForBundle === 1, `Expected 1 bundle download, got ${s5?.downloadsTriggeredForBundle}`);
    assert(s5.zipFilename.endsWith(".zip"), `Expected .zip filename, got ${s5.zipFilename}`);
    assert(s5.zipInBodyDuringClick === true, "Temporary <a download> must be in document.body during bundle click()");
    assert(s5.lingeringAnchorsInBody === 0, "Temporary <a download> must be removed after bundle click()");
    assert(s5.zipBlobType === "application/zip", `Expected application/zip Blob type, got ${s5.zipBlobType}`);
    assert(s5.zipBlobSize > 300, `Expected non-trivial ZIP Blob size, got ${s5.zipBlobSize}`);
    assert(s5.zipUrlRevoked === true, "URL.revokeObjectURL must be called for ZIP Blob URL");

    // Write the real-browser generated ZIP bytes to disk and validate with system `unzip -t`
    const zipBytes = Buffer.from(s5.zipBase64, "base64");
    const tmpZipDir = fs.mkdtempSync(path.join(os.tmpdir(), "unfold-real-browser-zip-"));
    try {
      const zipPath = path.join(tmpZipDir, "assignment.zip");
      const extractDir = path.join(tmpZipDir, "extracted");
      fs.writeFileSync(zipPath, zipBytes);

      const unzipTestOut = execFileSync("unzip", ["-t", zipPath], { encoding: "utf-8" });
      assert(unzipTestOut.includes("No errors detected"), "System `unzip -t` must report no errors on Chrome-generated ZIP");

      execFileSync("unzip", ["-q", zipPath, "-d", extractDir]);
      assert(fs.existsSync(path.join(extractDir, "assignment.md")), "Extracted ZIP must contain assignment.md");
      assert(fs.existsSync(path.join(extractDir, "metadata.json")), "Extracted ZIP must contain metadata.json");
      assert(fs.existsSync(path.join(extractDir, "manifest.json")), "Extracted ZIP must contain manifest.json");
      assert(fs.existsSync(path.join(extractDir, "assets", "q01-image-01.png")), "Extracted ZIP must contain fetched PNG asset");
      assert(fs.existsSync(path.join(extractDir, "assets", "q02-diagram-01.svg")), "Extracted ZIP must contain serialized SVG asset");

      const extractedPng = fs.readFileSync(path.join(extractDir, "assets", "q01-image-01.png"));
      assert(Buffer.compare(extractedPng, PNG_1X1_BYTES) === 0, "Extracted PNG bytes must be byte-identical to server PNG");
    } finally {
      fs.rmSync(tmpZipDir, { recursive: true, force: true });
    }
  });

  // ── Check 6: Busy State & Duplicate Click Prevention ──────────────────────
  await check("Real-Browser Check 6: Export buttons enter busy/disabled state during export, block duplicate clicks, and recover", () => {
    const s5 = report.steps.step5;
    assert(s5.busySnapshot.isExporting === true, "runtime.isExporting must be true immediately after clicking export");
    assert(s5.busySnapshot.mdDisabled === true, "Markdown button must be disabled during active export");
    assert(s5.busySnapshot.printDisabled === true, "Print button must be disabled during active export");
    assert(s5.downloadsTriggeredForBundle === 1, "Duplicate click while busy must not trigger duplicate download");
    assert(s5.buttonsReEnabledAfterExport === true, "All export buttons must be re-enabled after export completes");
  });

  // ── Check 6b: Reader Actions & Direct PDF in Real Chrome ────────
  await check("Real-Browser Check 6b: Reader exposes exactly 7 top-bar actions, 1-click Copy Questions, direct PDF export, and layered Escape handling", () => {
    const s5b = report.steps.step5b;
    assert(s5b && s5b.hasCopyQBtn === true, "Copy Questions button must be present in Reader header");
    assert(s5b.direct1ClickCopied === true, "1-click Copy Questions must copy prompt to clipboard directly");
    assert(s5b.hasImportBtn === true, "Import Answers button must be present in Reader header");
    assert(s5b.hasApplyBtn === true, "Apply Answers button must be present in Reader header");
    assert(s5b.hasPrintBtn === true, "Download PDF button must be present in Reader header");
    assert(s5b.hasMdBtn === true, "Copy (Markdown) button must be present in Reader header");
    assert(s5b.hasRefreshBtn === true, "Refresh button must be present in Reader header");
    assert(s5b.hasCloseBtn === true, "Close button must be present in Reader header");
    assert(s5b.directPdfTriggered === true, "Direct PDF path must download 'Week 04 - GA.pdf' with application/pdf Blob and no print() call");
    assert(s5b.importPanelOpen === true, "Clicking Import Answers opens import panel");
    assert(s5b.importPanelClosedAfterFirstEsc === true, "Escape must close Import panel");
    assert(s5b.applyDialogOpen === true, "Clicking Apply Answers opens apply dialog");
    assert(s5b.applyDialogClosedAfterFirstEsc === true, "Escape must close Apply dialog");
    assert(s5b.readerStillOpenAfterFirstEsc === true, "First Escape must NOT close Reader drawer");
  });

  await check("Real-Browser Check 6c: AI answer import renders accessible, inert inline badges and closes before the Reader", () => {
    const s5c = report.steps.step5c;
    assert(s5c && s5c.hasImportButton === true, "Import AI button must be present in Reader header");
    assert(s5c.hasDialogAndName === true, "Import panel must expose role=dialog and an accessible name");
    assert(s5c.fingerprintCaptured === true, "Import test must obtain the prompt fingerprint");
    assert(s5c.badgeCount === 4, `Expected four imported answer badges, got ${s5c.badgeCount}`);
    assert(s5c.badges.some((b) => b.includes("AI: B")), "MCQ badge must render its answer");
    assert(s5c.badges.some((b) => b.includes("AI: A, C")), "MSQ badge must render sorted answers");
    assert(s5c.badges.some((b) => b.includes("AI: 42.5")), "Numerical badge must render canonical decimal");
    assert(s5c.hostileTextInert === true, "Hostile TEXT answer must remain inert visible text");
    assert(s5c.focusInImportPanel === true, "Opening import must move focus into the dialog");
    assert(s5c.panelClosedAfterEscape === true, "Escape must close the import panel");
    assert(s5c.readerOpenAfterEscape === true, "Escape must leave the Reader open");
  });

  // ── Check 6d: In-App Navigation Auto-Detection & Dynamic Sidebar ──────────
  await check("Real-Browser Check 6d: In-app navigation auto-detects assessment, mounts launcher without opening Reader, decorates dynamically inserted sidebar, and resists mutation floods", () => {
    const s5e = report.steps.step5e;
    assert(s5e && s5e.launcherRemovedOnExit === true, "Launcher must be removed when navigating to non-assessment");
    assert(s5e.lifecycleAfterNavOut === "idle", `Expected IDLE state after nav out, got ${s5e?.lifecycleAfterNavOut}`);
    assert(s5e.launcherAppearedOnEnter === true, "Launcher must appear (.is-shown) when navigating back to assessment");
    assert(s5e.lifecycleAfterNavIn === "active", `Expected ACTIVE state after nav in, got ${s5e?.lifecycleAfterNavIn}`);
    assert(s5e.readerDidNotAutoOpen === true, "Auto-detection must mount launcher only and NOT auto-open Reader");
    assert(s5e.sidebarDecorAppeared === true, "Dynamically inserted sidebar must receive decorations");
    assert(s5e.rootElementsCount === 1, `Expected exactly 1 #unfold-root after navigation cycles, got ${s5e?.rootElementsCount}`);
    assert(s5e.detectCountDuringFlood <= 2, `Expected debounced detection during 50-mutation flood, got ${s5e?.detectCountDuringFlood}`);
  });

  // ── Check 6e: Interactive Answer Review UI, Single AI Apply & Confirmation Modal ──
  await check("Real-Browser Check 6e: Interactive MCQ/MSQ/Numerical controls update state & badges, quick apply AI copies suggestions, and Apply Answers dialog opens with summary counts", () => {
    const s5f = report.steps.step5f;
    assert(s5f && s5f.hasApplyButton === true, "Apply Answers button must be present in Reader header");
    assert(s5f.q1OptASelected === true, "Clicking MCQ option A must set selected class on option");
    assert(s5f.q1BadgeOverridden === true, "Selecting non-AI MCQ option must show 'Overridden' status badge");
    assert(s5f.q1OptBSelected === true, "Quick Apply AI on Q1 must select option B");
    assert(s5f.q1BadgeMatched === true, "Quick Apply AI on Q1 must update status badge to 'AI Match'");

    assert(s5f.q2OptBSelected === true, "Clicking MSQ option B must set selected class");
    assert(s5f.q2OptsACSelected === true, "Quick Apply AI on Q2 must select options A & C and deselect B");
    assert(s5f.q2BadgeMatched === true, "Quick Apply AI on Q2 must update status badge to 'AI Match'");

    assert(s5f.q3BadgeOverridden === true, "Typing non-AI numerical value must show 'Overridden' status badge");
    assert(s5f.q3Cleared === true, "Clicking clear button must empty numerical input");
    assert(s5f.q3BadgeSuggested === true, "Clearing numerical input with AI present must show 'AI Suggested' status badge");
    assert(s5f.q3AppliedVal === true, "Quick Apply AI on Q3 must populate numerical input with '42.5'");
    assert(s5f.q3BadgeMatched === true, "Quick Apply AI on Q3 must update status badge to 'AI Match'");

    assert(s5f.applyDialogOpen === true, "Clicking Apply Answers must open #saq-apply-dialog confirmation modal");
    assert(Number(s5f.summaryReady) >= 3, `Expected at least 3 ready questions in dialog, got ${s5f.summaryReady}`);
    assert(Number(s5f.summaryMatched) >= 3, `Expected at least 3 AI matched questions in dialog, got ${s5f.summaryMatched}`);
    assert(s5f.applyDialogClosed === true, "Clicking cancel on apply dialog must close the modal");
  });

  // ── Check 7: Zero Console Errors & Clean Teardown ─────────────────────────
  await check("Real-Browser Check 7: Zero uncaught console/page errors and clean runtime.destroy() DOM removal", () => {
    const s6 = report.steps.step6;
    assert(
      s6.consoleErrorCount === 0,
      `Expected 0 console.error calls, got ${s6.consoleErrorCount}: ${JSON.stringify(report.consoleErrors)}`
    );
    assert(
      s6.pageErrorCount === 0,
      `Expected 0 uncaught page errors, got ${s6.pageErrorCount}: ${JSON.stringify(report.pageErrors)}`
    );
    assert(
      s6.unhandledRejectionCount === 0,
      `Expected 0 unhandled rejections, got ${s6.unhandledRejectionCount}: ${JSON.stringify(report.unhandledRejections)}`
    );
    assert(s6.lifecycleStateAfterDestroy === "destroyed", "Runtime lifecycle must transition to DESTROYED");
    assert(s6.unfoldRootAfterDestroy === true, "#unfold-root must be removed from document on destroy()");
    assert(s6.lingeringPrintIframes === 0, "Zero lingering print iframes on destroy()");
    assert(s6.lingeringDownloadAnchors === 0, "Zero lingering download anchors on destroy()");
  });

  if (!passed) {
    console.error("\nReal-Browser Smoke Tests FAILED.");
    process.exit(1);
  } else {
    console.log("\n==================================================");
    console.log("✓ All Real-Browser End-to-End Smoke Tests Passed!");
    console.log("==================================================\n");
  }
}

runRealBrowserTests();
