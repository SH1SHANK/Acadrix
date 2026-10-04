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

    if (navigator.clipboard) {
      Object.defineProperty(navigator.clipboard, "writeText", {
        configurable: true,
        writable: true,
        value: async (text) => {
          telemetry.clipboardWrites.push(String(text));
        }
      });
    }

    const origConsoleError = console.error.bind(console);
    console.error = (...args) => {
      telemetry.consoleErrors.push(args.map((a) => String(a)).join(" "));
      origConsoleError(...args);
    };
    window.addEventListener("error", (ev) => {
      telemetry.pageErrors.push(ev.message || String(ev.error));
    });
    window.addEventListener("unhandledrejection", (ev) => {
      telemetry.unhandledRejections.push(String(ev.reason));
    });

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

    async function runInBrowserSmokeSuite() {
      const t = window.__unfoldTestTelemetry;
      try {
        // Step 1: Verify runtime launch & Shadow DOM launcher
        const runtime = window.__unfold;
        const hostEl = document.getElementById("unfold-root");
        const shadow = hostEl ? hostEl.shadowRoot : null;
        const launcher = shadow ? shadow.querySelector(".saq-launcher") : null;

        t.steps.step1 = {
          hasRuntime: Boolean(runtime),
          lifecycleState: runtime ? runtime.lifecycle.state : null,
          hasHostEl: Boolean(hostEl),
          hasShadowRoot: Boolean(shadow),
          launcherShown: Boolean(launcher && launcher.classList.contains("is-shown"))
        };

        // Step 2: Click launcher, traverse all 3 questions, open ReaderDrawer
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

        const sheet = shadow.querySelector("#saq-sheet");
        const activeChipAfterOpen = document.querySelector(".chip.active");
        t.steps.step2 = {
          lifecycleState: runtime.lifecycle.state,
          sheetOpen: Boolean(sheet && sheet.classList.contains("is-open")),
          questionCount: runtime.activeDocument ? runtime.activeDocument.questions.length : 0,
          restoredChipText: activeChipAfterOpen ? activeChipAfterOpen.textContent.trim() : null,
          hasMdBtn: Boolean(sheet && sheet.querySelector("[data-act='export-md']")),
          hasPrintBtn: Boolean(sheet && sheet.querySelector("[data-act='print']")),
          hasBundleBtn: Boolean(sheet && sheet.querySelector("[data-act='export-bundle']")),
          renderedQuestionCards: sheet ? sheet.querySelectorAll(".saq-block").length : 0
        };

        // Step 3: Trigger Markdown export via Reader button click
        const docBeforeMd = runtime.activeDocument;
        const mdBtn = sheet.querySelector("[data-act='export-md']");
        mdBtn.click();
        for (let i = 0; i < 40; i++) {
          await sleep(50);
          if (!runtime.orchestrator.isBusy() && t.downloads.length >= 1 && t.revokedUrls.length >= 1) break;
        }
        await sleep(300);

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
        const bundleBtn = sheet.querySelector("[data-act='export-bundle']");
        const downloadsBeforeBundle = t.downloads.length;
        bundleBtn.click();

        // Immediately inspect busy state while export is in-flight
        const busySnapshot = {
          isExporting: runtime.orchestrator.isBusy(),
          mdDisabled: mdBtn.hasAttribute("disabled"),
          printDisabled: printBtn.hasAttribute("disabled"),
          bundleDisabled: bundleBtn.hasAttribute("disabled"),
          bundleHasBusyClass: bundleBtn.classList.contains("is-busy")
        };

        // Attempt a duplicate click while busy (or via handleExportAction)
        mdBtn.click();
        await runtime.handleExportAction("markdown");

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
            !bundleBtn.hasAttribute("disabled") &&
            !bundleBtn.classList.contains("is-busy"),
          zipBase64
        };

        // Step 5b: Verify §4 "Copy for AI" popover in Real Chrome
        // Set active portal question to Q2 before first popover open
        chips[1].click();
        await sleep(20);

        const copyAiBtn = sheet.querySelector("[data-act='copy-ai']");
        const aiPopover = sheet.querySelector("#saq-ai-popover");
        copyAiBtn.click();
        await sleep(50);

        const aiOpened = aiPopover && aiPopover.classList.contains("is-open") && !aiPopover.hasAttribute("hidden");
        const hasDialogRoleAndLabel =
          aiPopover.getAttribute("role") === "dialog" &&
          aiPopover.getAttribute("aria-label") === "Copy for AI";
        const focusMovedIntoPopover = aiPopover.contains(shadow.activeElement);

        const singleInput = aiPopover.querySelector("[data-ai-input='single']");
        const singleDefaultedToActiveQ2 = singleInput && singleInput.value === "2";

        const figWarnEl = aiPopover ? aiPopover.querySelector("[data-ai-fig-warn]") : null;
        const figWarnText = figWarnEl && !figWarnEl.hasAttribute("hidden") ? figWarnEl.textContent : "";
        const figWarnNotColorOnly = Boolean(
          figWarnEl && figWarnEl.querySelector("svg") && figWarnText.includes("image not included")
        );

        // Toggle preview open
        const previewBtn = aiPopover.querySelector("[data-act='ai-preview-toggle']");
        const previewEl = aiPopover.querySelector("[data-ai-preview]");
        previewBtn.click();
        await sleep(20);
        const previewExpanded = !previewEl.hasAttribute("hidden") && previewEl.getAttribute("tabindex") === "0";
        const previewText = previewEl.textContent || "";

        // Click Copy Prompt to Clipboard
        const copyConfirmBtn = aiPopover.querySelector("[data-act='ai-copy-confirm']");
        const liveStatusEl = aiPopover.querySelector("[data-ai-live-status]");
        copyConfirmBtn.click();
        await sleep(50);
        const copyFeedbackShown =
          liveStatusEl.getAttribute("aria-live") === "polite" &&
          liveStatusEl.classList.contains("is-visible") &&
          liveStatusEl.textContent.includes("Copied to clipboard");
        const copiedNotColorOnly = Boolean(
          liveStatusEl.querySelector("svg") &&
          copyConfirmBtn.querySelector("svg") &&
          liveStatusEl.textContent.includes("Copied to clipboard")
        );
        const copiedMatchesPreview = t.clipboardWrites.length === 1 && t.clipboardWrites[0] === previewText;

        function parseCssColor(str) {
          const cleaned = String(str || "")
            .replace("rgba", "")
            .replace("rgb", "")
            .replace("(", " ")
            .replace(")", " ")
            .replaceAll(",", " ")
            .replaceAll("/", " ")
            .trim();
          const nums = cleaned.split(" ").filter(Boolean).map(Number);
          if (nums.length < 3 || nums.some((n) => Number.isNaN(n))) return [0, 0, 0, 1];
          return [nums[0], nums[1], nums[2], nums[3] !== undefined ? nums[3] : 1];
        }
        function compositeOver(fgRgba, bgRgb) {
          const a = fgRgba[3];
          return [
            fgRgba[0] * a + bgRgb[0] * (1 - a),
            fgRgba[1] * a + bgRgb[1] * (1 - a),
            fgRgba[2] * a + bgRgb[2] * (1 - a)
          ];
        }
        function relLum(rgb) {
          const chan = (c) => {
            const v = c / 255;
            return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
          };
          return 0.2126 * chan(rgb[0]) + 0.7152 * chan(rgb[1]) + 0.0722 * chan(rgb[2]);
        }
        function wcagRatio(fgRgb, bgRgb) {
          const l1 = relLum(fgRgb);
          const l2 = relLum(bgRgb);
          return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        }
        function measureThemeContrast(themeName) {
          runtime.shadowHost.setTheme(themeName);
          const popBg = parseCssColor(window.getComputedStyle(aiPopover).backgroundColor);
          const warnCs = window.getComputedStyle(figWarnEl);
          const warnBg = compositeOver(parseCssColor(warnCs.backgroundColor), popBg);
          const warnFg = parseCssColor(warnCs.color);

          const liveCs = window.getComputedStyle(liveStatusEl);
          const liveBg = compositeOver(parseCssColor(liveCs.backgroundColor), popBg);
          const liveFg = parseCssColor(liveCs.color);

          const btnCs = window.getComputedStyle(copyConfirmBtn);
          const btnBg = compositeOver(parseCssColor(btnCs.backgroundColor), popBg);
          const btnFg = parseCssColor(btnCs.color);

          return {
            warnRatio: Number(wcagRatio(warnFg, warnBg).toFixed(2)),
            liveRatio: Number(wcagRatio(liveFg, liveBg).toFixed(2)),
            btnRatio: Number(wcagRatio(btnFg, btnBg).toFixed(2))
          };
        }

        const lightContrast = measureThemeContrast("light");
        const darkContrast = measureThemeContrast("dark");
        runtime.shadowHost.setTheme("light");

        // Validate Range inputs reject start > end and out-of-bounds values
        const startInput = aiPopover.querySelector("[data-ai-input='start']");
        const endInput = aiPopover.querySelector("[data-ai-input='end']");
        const rangeErrEl = aiPopover.querySelector("[data-ai-range-error]");
        startInput.value = "3";
        endInput.value = "1";
        startInput.dispatchEvent(new Event("input", { bubbles: true }));
        await sleep(10);
        const startGtEndRejected = !rangeErrEl.hasAttribute("hidden") && copyConfirmBtn.hasAttribute("disabled");

        startInput.value = "1";
        endInput.value = "99";
        endInput.dispatchEvent(new Event("input", { bubbles: true }));
        await sleep(10);
        const outOfBoundsRejected = !rangeErrEl.hasAttribute("hidden") && copyConfirmBtn.hasAttribute("disabled");

        // Switch scope to Single Q3 (which has no figure)
        singleInput.value = "3";
        singleInput.dispatchEvent(new Event("input", { bubbles: true }));
        await sleep(20);
        const singleFigWarnHidden = figWarnEl.hasAttribute("hidden");
        const singlePreviewText = previewEl.textContent || "";

        // Click Save PDF inside popover while scoped to Single Q3:
        // must invoke print() for the 1 scoped question and keep the popover open
        const savePdfBtn = aiPopover.querySelector("[data-act='ai-save-pdf']");
        const printCountBeforeAiPdf = t.printCalls.length;
        savePdfBtn.click();
        for (let i = 0; i < 60; i++) {
          await sleep(50);
          if (!runtime.orchestrator.isBusy() && t.printCalls.length > printCountBeforeAiPdf) break;
        }
        await sleep(50);
        const aiPdfPrintTriggered = t.printCalls.length === printCountBeforeAiPdf + 1;
        const aiPdfQuestionCount = t.printCalls[t.printCalls.length - 1]?.questionCount ?? 0;
        const popoverStillOpenAfterSavePdf = aiPopover.classList.contains("is-open") && !aiPopover.hasAttribute("hidden");

        // Also test direct PDF download via chrome.runtime.sendMessage in Real Chrome
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

        // Focus inside <pre tabindex="0"> preview and press first Escape:
        // must close ONLY the popover, return focus to trigger, and keep Reader open
        previewEl.focus();
        const focusWasInPreview = shadow.activeElement === previewEl;
        previewEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        await sleep(20);
        const popoverClosedAfterFirstEsc = !aiPopover.classList.contains("is-open") && aiPopover.hasAttribute("hidden");
        const readerStillOpenAfterFirstEsc = sheet.classList.contains("is-open");
        const focusReturnedToTrigger = shadow.activeElement === copyAiBtn;

        // Verify Single scope does NOT reset after a document refresh even when active portal question changes to Q1
        chips[0].click();
        await sleep(10);
        const partialDoc = {
          length: runtime.activeDocument.questions.length,
          metadata: { ...runtime.activeDocument.metadata, totalQuestions: 10 },
          questions: runtime.activeDocument.questions
        };
        runtime.reader.build(partialDoc, {
          onDismiss: () => runtime.close()
        });
        runtime.reader.show();
        await sleep(30);
        const refreshedSheet = shadow.querySelector("#saq-sheet");
        const refreshedCopyAiBtn = refreshedSheet.querySelector("[data-act='copy-ai']");
        const refreshedPopover = refreshedSheet.querySelector("#saq-ai-popover");
        refreshedCopyAiBtn.click();
        await sleep(20);
        const refreshedSingleInput = refreshedPopover.querySelector("[data-ai-input='single']");
        const singlePreservedAcrossRefresh =
          runtime.reader.aiScopeState.type === "single" &&
          runtime.reader.aiScopeState.single === 3 &&
          refreshedSingleInput.value === "3";
        const partialAllLabel = refreshedPopover.querySelector("[data-ai-all-label]")?.textContent || "";
        const partialBannerShown = Boolean(refreshedPopover.querySelector("[data-ai-partial-warn]"));

        // Close popover with first Escape, then press second Escape to close Reader drawer
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        await sleep(20);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        await sleep(20);
        const readerClosedAfterSecondEsc = !refreshedSheet.classList.contains("is-open") && runtime.lifecycle.state === "active";

        t.steps.step5b = {
          hasCopyAiBtn: Boolean(copyAiBtn),
          hasSavePdfBtn: Boolean(savePdfBtn),
          aiOpened,
          hasDialogRoleAndLabel,
          focusMovedIntoPopover,
          singleDefaultedToActiveQ2,
          figWarnText,
          figWarnNotColorOnly,
          previewExpanded,
          previewHasAssignment: previewText.includes("<assignment>") && previewText.includes("- Figures omitted for: Q1, Q2"),
          copyFeedbackShown,
          copiedNotColorOnly,
          copiedMatchesPreview,
          lightContrast,
          darkContrast,
          startGtEndRejected,
          outOfBoundsRejected,
          singleFigWarnHidden,
          singleHasOnlyQ3: singlePreviewText.includes("Q3 [NUMERICAL]") && !singlePreviewText.includes("Q1 [MCQ]"),
          aiPdfPrintTriggered,
          aiPdfQuestionCount,
          popoverStillOpenAfterSavePdf,
          directPdfTriggered,
          focusWasInPreview,
          popoverClosedAfterFirstEsc,
          readerStillOpenAfterFirstEsc,
          focusReturnedToTrigger,
          singlePreservedAcrossRefresh,
          partialAllLabel,
          partialBannerShown,
          readerClosedAfterSecondEsc
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

    window.addEventListener("load", () => {
      setTimeout(runInBrowserSmokeSuite, 50);
    });
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
    if (req.method === "GET" && (req.url === "/" || req.url.startsWith("/quiz/"))) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fixtureHtml);
      return;
    }
    if (req.method === "GET" && req.url === "/run.js") {
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
      res.end(runJsSource);
      return;
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
  const chromeProc = spawn(
    chromeBin,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      `--user-data-dir=${tmpUserDataDir}`,
      targetUrl,
    ],
    { stdio: "ignore" }
  );

  let report;
  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timed out waiting for real-browser test report (20s)")), 20000)
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
    assert(s2.hasMdBtn && s2.hasPrintBtn && s2.hasBundleBtn, "All 3 export buttons must be rendered in Reader header");
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
    assert(s5.busySnapshot.bundleDisabled === true, "Bundle button must be disabled during active export");
    assert(s5.busySnapshot.bundleHasBusyClass === true, "Buttons must have .is-busy class during active export");
    assert(s5.downloadsTriggeredForBundle === 1, "Duplicate click while busy must not trigger duplicate download");
    assert(s5.buttonsReEnabledAfterExport === true, "All export buttons must be re-enabled after export completes");
  });

  // ── Check 6b: §4 "Copy for AI" Popover & Direct PDF in Real Chrome ────────
  await check("Real-Browser Check 6b: Copy for AI popover opens, warns on figures, expands preview, copies prompt, filters scope, downloads direct PDF, and handles layered Escape", () => {
    const s5b = report.steps.step5b;
    assert(s5b && s5b.hasCopyAiBtn === true, "Copy for AI button must be present in Reader header");
    assert(s5b.hasSavePdfBtn === true, "Save PDF button must be present inside Copy for AI popover");
    assert(s5b.aiOpened === true, "Clicking Copy for AI must open #saq-ai-popover");
    assert(s5b.hasDialogRoleAndLabel === true, "Popover must have role='dialog' and accessible name 'Copy for AI'");
    assert(s5b.focusMovedIntoPopover === true, "Focus must move inside popover on open");
    assert(s5b.singleDefaultedToActiveQ2 === true, "Single scope must default to active question (Q2) on first open");
    assert(s5b.figWarnText.includes("Q1, Q2"), `Expected figure warning for Q1, Q2, got: ${s5b.figWarnText}`);
    assert(s5b.figWarnNotColorOnly === true, "Figure warning must include both icon and text (not color-only)");
    assert(s5b.previewExpanded === true, "Preview <pre tabindex='0'> must expand on toggle click");
    assert(s5b.previewHasAssignment === true, "Preview must contain <assignment> and '- Figures omitted for: Q1, Q2'");
    assert(s5b.copyFeedbackShown === true, "Clicking Copy must announce 'Copied to clipboard' in aria-live='polite' status");
    assert(s5b.copiedNotColorOnly === true, "Copied state must include both icon and text (not color-only)");
    assert(s5b.copiedMatchesPreview === true, "Clipboard writeText must receive exact prompt string matching preview");
    assert(
      s5b.lightContrast.warnRatio >= 4.5 && s5b.lightContrast.liveRatio >= 4.5 && s5b.lightContrast.btnRatio >= 4.5,
      `Light theme contrast must be >= 4.5:1 (got warn=${s5b.lightContrast.warnRatio}, live=${s5b.lightContrast.liveRatio}, btn=${s5b.lightContrast.btnRatio})`
    );
    assert(
      s5b.darkContrast.warnRatio >= 4.5 && s5b.darkContrast.liveRatio >= 4.5 && s5b.darkContrast.btnRatio >= 4.5,
      `Dark theme contrast must be >= 4.5:1 (got warn=${s5b.darkContrast.warnRatio}, live=${s5b.darkContrast.liveRatio}, btn=${s5b.darkContrast.btnRatio})`
    );
    assert(s5b.startGtEndRejected === true, "Range inputs must reject start > end");
    assert(s5b.outOfBoundsRejected === true, "Range inputs must reject out-of-bounds values");
    assert(s5b.singleFigWarnHidden === true, "Switching to Single Q3 (no figure) must hide figure warning");
    assert(s5b.singleHasOnlyQ3 === true, "Single Q3 scope must serialize only Q3");
    assert(s5b.aiPdfPrintTriggered === true, "Clicking Save PDF in popover must invoke print() on fallback");
    assert(s5b.aiPdfQuestionCount === 1, `Scoped Save PDF (Single Q3) must render 1 question, got ${s5b.aiPdfQuestionCount}`);
    assert(s5b.popoverStillOpenAfterSavePdf === true, "Clicking Save PDF must keep the Copy for AI popover open");
    assert(s5b.directPdfTriggered === true, "Direct PDF path must download 'Week 04 - GA.pdf' with application/pdf Blob and no print() call");
    assert(s5b.focusWasInPreview === true, "Focus must be inside <pre tabindex='0'> preview before pressing Escape");
    assert(s5b.popoverClosedAfterFirstEsc === true, "First Escape (from inside preview) must close the AI popover");
    assert(s5b.readerStillOpenAfterFirstEsc === true, "First Escape must NOT close the Reader drawer");
    assert(s5b.focusReturnedToTrigger === true, "Closing popover via Escape must return focus to Copy for AI trigger button");
    assert(s5b.singlePreservedAcrossRefresh === true, "Single scope must not reset after a document refresh");
    assert(s5b.partialAllLabel === "3 of 10 extracted" && s5b.partialBannerShown === true, `Partial extraction must show '3 of 10 extracted' and warning banner (got '${s5b.partialAllLabel}')`);
    assert(s5b.readerClosedAfterSecondEsc === true, "Second Escape must close the Reader drawer");
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
