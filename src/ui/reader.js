/**
 * Reader Drawer Component.
 * Encapsulated bottom sheet for assignment inspection, editing, and printing.
 * Mounts entirely within the isolated ShadowRoot using the Acadrix Design System.
 */

import { ICONS } from "./icons.js";
import { escapeHtml } from "../utils/dom.js";
import { ContentType, QuestionType, AssessmentFamily } from "../model/types.js";
import { buildExportFilename } from "../model/document.js";
import { ProgrammingCodeEditor } from "./code-editor.js";
import { LANGUAGE_REGISTRY, normalizeProgrammingLanguage } from "../bridge/languages.js";
import { renderVisualMath } from "../utils/math.js";
import { renderContentNodes } from "./reader-content.js";
import {
  handleReaderKeyDown,
  handleReaderActionClick,
  wireReaderDrag,
} from "./reader-interactions.js";
import { createReaderAiFeature, attachReaderAiFeatures } from "./reader-ai.js";

export { renderContentNodes };

const readerFeatureFactories = [];
if (typeof createReaderAiFeature === "function") {
  readerFeatureFactories.push(createReaderAiFeature);
}



export class ReaderDrawer {
  constructor(shadowHost, portal) {
    this.shadowHost = shadowHost;
    this.portal = portal;
    this.sheetElement = null;
    this.backdropElement = null;
    this.clockInterval = null;
    this.statusTimer = null;
    this.onRefreshCallback = null;
    this.onDismissCallback = null;
    this.onExportCallback = null;
    this.onThemeCallback = null;
    this.isDragging = false;
    this.dragStart = null;
    this.boundPointerMove = null;
    this.boundPointerUp = null;
    this.boundKeyDown = null;
    this.pdfDirectFallbackActive = false;
    this.programmingEditor = null;
    this.features = readerFeatureFactories
      .map((factory) => factory(this))
      .filter(Boolean);
  }

  runReaderFeatureHook(name, payload) {
    let handled = false;
    for (const feature of this.features) {
      const hook = feature?.[name];
      if (typeof hook === "function" && hook.call(feature, payload) === true) {
        handled = true;
      }
    }
    return handled;
  }

  callReaderFeatureMethod(name, ...args) {
    for (const feature of this.features) {
      const method = feature?.[name];
      if (typeof method === "function") return method.call(feature, ...args);
    }
    return undefined;
  }

  isDirectPdfAvailable() {
    return this.callReaderFeatureMethod("isDirectPdfAvailable") ?? false;
  }

  setPdfFallbackMode(isFallback) {
    this.pdfDirectFallbackActive = Boolean(isFallback);
    this.runReaderFeatureHook("documentChange", { reason: "pdf-fallback" });
  }

  isOpen() {
    return Boolean(this.sheetElement?.classList.contains("is-open"));
  }

  isMounted() {
    return Boolean(this.sheetElement);
  }

  build(
    documentModel,
    {
      compact = false,
      warningMessage = "",
      onRefresh = null,
      onDismiss = null,
      onExport = null,
      onThemeChange = null,
    } = {}
  ) {
    this.destroy(); // Clean up existing elements if any

    this.onRefreshCallback = onRefresh;
    this.onDismissCallback = onDismiss;
    this.onExportCallback = onExport;
    this.onThemeCallback = onThemeChange;
    this.documentModel = documentModel;

    const root = this.shadowHost.root;
    if (root) {
      root.querySelectorAll("#saq-backdrop, #saq-sheet").forEach((el) => el.remove());
    }

    // 1. Backdrop
    const backdrop = document.createElement("div");
    backdrop.id = "saq-backdrop";
    backdrop.addEventListener("click", () => this.dismiss());
    root.appendChild(backdrop);
    this.backdropElement = backdrop;

    // 2. Sheet
    const sheet = document.createElement("div");
    sheet.id = "saq-sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-labelledby", "saq-reader-title");
    sheet.tabIndex = -1;
    if (compact) sheet.classList.add("saq-compact");

    const isReview = documentModel.metadata?.isReview;
    const isDark = this.shadowHost.getTheme?.() === "dark";
    const warnHtml = warningMessage
      ? `<div class="saq-warn" role="status">${ICONS.warn}<span>${warningMessage}</span></div>`
      : "";

    const isProgramming =
      documentModel?.metadata?.family === AssessmentFamily.PROGRAMMING ||
      documentModel?.family === AssessmentFamily.PROGRAMMING ||
      documentModel?.metadata?.family === "programming" ||
      documentModel?.family === "programming" ||
      documentModel?.questions?.some((q) => q.type === QuestionType.PROGRAMMING || Boolean(q.programmingData));
    const programmingData = isProgramming ? documentModel.questions?.[0]?.programmingData || {} : {};
    const progLangId = normalizeProgrammingLanguage(programmingData.language) || "javascript";
    const progLangLabel = LANGUAGE_REGISTRY[progLangId]?.canonicalName || "Code";

    if (isProgramming) {
      sheet.classList.add("saq-programming-mode");
      sheet.innerHTML = `
        <div class="saq-grip" aria-hidden="true" title="Drag down to close"></div>
        <header class="saq-header saq-programming-header">
          <div class="saq-header-left">
            <span class="saq-title" id="saq-reader-title">${escapeHtml(progLangLabel)}</span>
            <span class="saq-sync-status" id="saq-program-sync-status" role="status" aria-live="polite">In Sync</span>
          </div>
          <div class="saq-actions">
            <button type="button" class="saq-btn saq-btn-secondary saq-btn-sm" data-act="copy-prompt-context" aria-label="Copy Prompt" title="Copy LLM-optimized prompt">${ICONS.copy}<span>Copy Prompt</span></button>
            <button type="button" class="saq-btn saq-btn-secondary saq-btn-sm" data-act="copy-current-code" aria-label="Copy Code" title="Copy current solution code">${ICONS.code || ICONS.copy}<span>Copy Code</span></button>
            <div class="saq-dropdown-wrap">
              <button type="button" class="saq-btn saq-btn-secondary saq-btn-sm" data-act="toggle-export-menu" aria-label="Export problem statement" aria-haspopup="menu" aria-controls="saq-export-menu" aria-expanded="false"><span>Export</span>${ICONS.chevronDown}</button>
              <div class="saq-dropdown-menu" id="saq-export-menu" role="menu" hidden>
                <button type="button" class="saq-dropdown-item" data-act="print" role="menuitem" title="Download as PDF">${ICONS.print}<span>Download as PDF</span></button>
                <button type="button" class="saq-dropdown-item" data-act="export-md" role="menuitem" title="Download as Markdown">${ICONS.markdown}<span>Download as Markdown</span></button>
                <button type="button" class="saq-dropdown-item" data-act="export-txt" role="menuitem" title="Download as TXT File">${ICONS.code || ICONS.copy}<span>Download as TXT File</span></button>
              </div>
            </div>
            <button type="button" class="saq-btn saq-btn-secondary saq-btn-sm" data-act="refresh" aria-label="Refresh from assignment" title="Refresh from assignment">${ICONS.refresh}<span>Refresh</span></button>
            <button type="button" class="saq-btn saq-btn-primary saq-btn-sm" data-act="apply-programming-code" id="saq-apply-programming-code" hidden disabled>Apply Changes</button>
            <button type="button" class="saq-btn saq-icon" data-act="theme" aria-label="Toggle dark theme" aria-pressed="${isDark ? "true" : "false"}" title="Toggle light/dark theme">${ICONS.theme}</button>
            <button type="button" class="saq-btn saq-icon saq-btn-close" data-act="dismiss" aria-label="Close reader" title="Close reader (Esc)">${ICONS.close}</button>
          </div>
        </header>
        <output class="saq-status-bar" id="saq-status-bar" role="status" aria-live="polite" aria-atomic="true"></output>
        ${warnHtml}
        <div class="saq-scroll" tabindex="0" role="region" aria-label="Questions list"></div>`;
    } else {
      sheet.innerHTML = `
        <div class="saq-grip" aria-hidden="true" title="Drag down to close"></div>
        <header class="saq-header">
          <span class="saq-title" id="saq-reader-title">All Questions</span>
          <span class="saq-count-pill" aria-label="${documentModel.length} questions">${documentModel.length}</span>
          ${isReview ? '<span class="saq-tag">✓ Results</span>' : ""}
          <div class="saq-actions">
            <span class="saq-clock" title="Time remaining">${ICONS.clock}<span class="saq-clock-val"></span></span>
            <button type="button" class="saq-btn saq-btn-secondary" data-act="import-answers" aria-label="Import AI Response" title="Import structured AI response">${ICONS.bundle || ""}<span>Import</span></button>
            <button type="button" class="saq-btn saq-btn-primary" data-act="copy-questions" aria-label="Copy AI Prompt" title="Copy LLM-optimized prompt with questions">${ICONS.copy}<span>Copy Prompt</span></button>
            <div class="saq-split-btn-group" id="saq-export-split">
              <button type="button" class="saq-btn saq-btn-secondary saq-split-main" data-act="copy-md-clipboard" aria-label="Copy Markdown" title="Copy assignment as Markdown">${ICONS.markdown}<span>Copy</span></button>
              <button type="button" class="saq-btn saq-btn-secondary saq-split-arrow" data-act="toggle-export-menu" aria-label="More download formats" aria-haspopup="menu" aria-expanded="false" title="Download formats (PDF, Markdown, Bundle)">${ICONS.chevronDown}</button>
              <div class="saq-dropdown-menu" id="saq-export-menu" role="menu" hidden>
                <button type="button" class="saq-dropdown-item" data-act="print" role="menuitem" title="Download as PDF">${ICONS.print}<span>Download PDF</span></button>
                <button type="button" class="saq-dropdown-item" data-act="export-md" role="menuitem" title="Download as Markdown">${ICONS.markdown}<span>Download Markdown</span></button>
                <button type="button" class="saq-dropdown-item" data-act="export-bundle" role="menuitem" title="Download ZIP Bundle">${ICONS.bundle}<span>Download Bundle</span></button>
              </div>
            </div>
            <button type="button" class="saq-btn saq-btn-secondary" data-act="refresh" aria-label="Refresh questions from assessment" title="Re-read questions from assessment">${ICONS.refresh}<span>Refresh</span></button>
            <button type="button" class="saq-btn saq-icon" data-act="theme" aria-label="Toggle dark theme" aria-pressed="${isDark ? "true" : "false"}" title="Toggle light/dark theme">${ICONS.theme}</button>
            <button type="button" class="saq-btn saq-icon saq-btn-close" data-act="dismiss" aria-label="Close reader" title="Close reader (Esc)">${ICONS.close}</button>
            <button type="button" class="saq-btn-apply" data-act="apply-answers" hidden aria-hidden="true"><span class="saq-btn-badge" data-ready-badge hidden>0</span></button>
          </div>
        </header>
        <output class="saq-status-bar" id="saq-status-bar" role="status" aria-live="polite" aria-atomic="true"></output>
        ${warnHtml}
        <div class="saq-scroll" tabindex="0" role="region" aria-label="Questions list"></div>`;
    }

    this.renderBlocks(sheet.querySelector(".saq-scroll"), documentModel);

    // Event delegation on header actions
    sheet.addEventListener("click", (e) => this.handleActionClick(e));

    // Focus trap inside modal dialog
    this.boundKeyDown = (e) => this.handleKeyDown(e);
    sheet.addEventListener("keydown", this.boundKeyDown);

    // Drag-to-dismiss gesture
    const grip = sheet.querySelector(".saq-grip");
    this.wireDrag(grip, sheet);

    root.appendChild(sheet);
    this.sheetElement = sheet;
    if (root?.host) this.programmingEditor?.mount?.(root);
    this.programmingEditor?.updateStateBadges?.();
    this.runReaderFeatureHook("renderHeaderActions", { sheet, documentModel });
    this.runReaderFeatureHook("documentChange", { documentModel, reason: "build" });
  }

  formatQuestionType(type) {
    if (!type || type === "unknown") return "";
    const lower = String(type).toLowerCase().trim();
    const map = {
      mcq: "Multiple Choice",
      single_choice: "Multiple Choice",
      single_correct: "Multiple Choice",
      single: "Multiple Choice",
      msq: "Multi Choice (MSQ)",
      multiple_choice: "Multi Choice (MSQ)",
      multiple_correct: "Multi Choice (MSQ)",
      multi_choice: "Multi Choice (MSQ)",
      multi: "Multi Choice (MSQ)",
      numerical: "Numerical",
      number: "Numerical",
      text: "Short Answer",
      short_answer: "Short Answer",
      descriptive: "Descriptive",
      essay: "Descriptive",
    };
    return map[lower] || (lower.charAt(0).toUpperCase() + lower.slice(1));
  }

  renderBlocks(scrollContainer, documentModel) {
    if (!scrollContainer) return;
    const inner = document.createElement("div");
    inner.className = "saq-inner acx-content";

    if (!documentModel?.questions || documentModel.questions.length === 0) {
      const empty = document.createElement("div");
      empty.className = "saq-empty-state";
      empty.innerHTML = `<h2 class="saq-empty-title">No questions were captured</h2><p class="saq-empty-sub">Ensure the assessment is visible and select <strong>Refresh</strong> to re-scan.</p>`;
      inner.appendChild(empty);
      scrollContainer.replaceChildren(inner);
      return;
    }

    documentModel.questions.forEach((q, i) => {
      const b = document.createElement("div");
      const isProgQuestion = q.type === QuestionType.PROGRAMMING || Boolean(q.programmingData);
      b.className = isProgQuestion ? "saq-block saq-block-programming" : "saq-block";
      b.id = `saq-q-${i}`;
      b.dataset.q = String(i);

      // 1. Question Header
      const qLabelText = isProgQuestion ? "Problem Statement" : (q.label || `Question ${i + 1}`);
      const typeLabel = isProgQuestion ? "" : this.formatQuestionType(q.type);
      const typeHtml = typeLabel ? `<span class="saq-qtype">${escapeHtml(typeLabel)}</span>` : "";
      const marksHtml = q.marks ? `<span class="saq-marks">${q.marks} Mark${q.marks > 1 ? "s" : ""}</span>` : "";
      const statusHtml = q.review?.statusText
        ? `<span class="saq-status ${q.review.isCorrect ? "correct" : "incorrect"}">${q.review.isCorrect ? "✓ " : "✕ "}${escapeHtml(q.review.statusText)}</span>`
        : "";

      const headerHtml = isProgQuestion ? `
        <div class="saq-qheader saq-pa-qheader">
          <span class="saq-qlabel">${escapeHtml(qLabelText)}</span>
          <span class="saq-lang-badge">${escapeHtml((q.programmingData?.language || "CODE").toUpperCase())}</span>
          ${marksHtml}
          ${statusHtml}
        </div>
      ` : `
        <div class="saq-qheader">
          <span class="saq-qlabel">${escapeHtml(qLabelText)}</span>
          ${typeHtml}
          ${marksHtml}
          ${statusHtml}
        </div>
      `;
      // 2. Stem rendering
      let stemHtml = "";
      if (q.stem && q.stem.length > 0) {
        if (q.stem.length === 1 && q.stem[0].type === ContentType.HTML_BLOCK) {
          stemHtml = q.stem[0].value;
        } else {
          stemHtml = renderContentNodes(q.stem, { visualMath: true });
        }
      }
      if (!stemHtml) {
        stemHtml = q.rawHtml?.stemHtml || "";
      }
      if (!stemHtml || !stemHtml.trim()) {
        stemHtml = `<p class="saq-stem-empty">Content unavailable</p>`;
      }

      // 3. Options rendering
      let optsHtml = "";
      if (q.options && q.options.length > 0) {
        const optionItems = q.options.map((opt) => {
          const selectedClass = opt.selected ? "selected" : "";
          const correctClass = opt.isCorrect === true ? "correct" : opt.isCorrect === false ? "incorrect" : "";
          const contentHtml = renderContentNodes(opt.content, { visualMath: true });
          let stateBadge = "";
          if (opt.isCorrect === true) {
            stateBadge = `<span class="saq-opt-badge is-correct">${ICONS.check}<span>Correct</span></span>`;
          } else if (opt.isCorrect === false && opt.selected) {
            stateBadge = `<span class="saq-opt-badge is-incorrect">${ICONS.cross}<span>Incorrect</span></span>`;
          } else if (opt.selected) {
            stateBadge = `<span class="saq-opt-badge is-selected">${ICONS.check}<span>Selected</span></span>`;
          }
          return `
            <div class="saq-option ${selectedClass} ${correctClass}">
              <span class="saq-opt-letter">${escapeHtml(opt.letter)}</span>
              <span class="saq-opt-text">${contentHtml}</span>
              ${stateBadge}
            </div>
          `;
        }).join("");
        optsHtml = `<div class="saq-options">${optionItems}</div>`;
      } else if (typeof q.getLegacyOptionsMarkup === "function" && q.getLegacyOptionsMarkup()) {
        optsHtml = q.getLegacyOptionsMarkup();
      } else if (q.rawHtml?.optsHtml) {
        optsHtml = q.rawHtml.optsHtml;
      }

      // 4. Review feedback
      const feedbackHtml = q.review?.feedback
        ? `<div class="saq-feedback"><div class="saq-feedback-title">Feedback</div><div class="saq-feedback-body">${escapeHtml(q.review.feedback)}</div></div>`
        : "";

      if (q.type === QuestionType.PROGRAMMING || q.programmingData) {
        const pData = q.programmingData || {};
        const lang = pData.language || "javascript";

        // Partial extraction warning banner
        let warningBannerHtml = "";
        const isPartial = pData.extractionStatus === "PARTIAL" || (Array.isArray(pData.warnings) && pData.warnings.length > 0);
        if (isPartial) {
          const warningText = Array.isArray(pData.warnings) && pData.warnings.length > 0
            ? pData.warnings.join(" | ")
            : "Some assignment context could not be fully extracted.";
          warningBannerHtml = `
            <div class="saq-pa-warning-banner" style="margin-bottom: 12px; padding: 8px 12px; background: rgba(247, 144, 9, 0.1); border: 1px solid rgba(247, 144, 9, 0.3); border-radius: 6px; font-size: 13px; color: #f79009;">
              <strong>Partial Extraction:</strong> ${escapeHtml(warningText)}
            </div>
          `;
        }

        // Images section (if present and not embedded inline in stemHtml)
        let imagesHtml = "";
        if (Array.isArray(pData.images) && pData.images.length > 0) {
          const unseenImages = pData.images.filter(
            (img) => !stemHtml.includes(img.src) && !stemHtml.includes(img.alt)
          );
          if (unseenImages.length > 0) {
            const imgCards = unseenImages.map((img) => `
              <div class="saq-image-card" style="margin: 8px 0;">
                <img src="${escapeHtml(img.src)}" alt="${escapeHtml(img.alt || 'Question Image')}" style="max-width: 100%; height: auto; border-radius: 4px; border: 1px solid var(--saq-border, #ddd);" />
                ${img.caption ? `<div class="saq-image-caption" style="font-size: 12px; color: var(--saq-text-muted, #888); margin-top: 4px;">${escapeHtml(img.caption)}</div>` : ""}
              </div>
            `).join("");
            imagesHtml = `
              <div class="saq-pa-section">
                <div class="saq-pa-section-hdr"><span class="saq-pa-section-title">Images / Diagrams</span></div>
                <div>${imgCards}</div>
              </div>
            `;
          }
        }

        // Examples section
        let examplesHtml = "";
        if (Array.isArray(pData.examples) && pData.examples.length > 0) {
          const exCards = pData.examples.map((ex, i) => {
            if (typeof ex === "string") return `<div class="saq-example-card"><div class="saq-example-body">${escapeHtml(ex)}</div></div>`;
            return `
              <div class="saq-example-card" style="margin: 8px 0; padding: 8px 12px; background: var(--saq-surface-sunken, #f8f9fa); border-radius: 6px; border: 1px solid var(--saq-border, #eee);">
                <div style="font-weight: 600; font-size: 12px; margin-bottom: 4px;">Example ${i + 1}</div>
                ${ex.input ? `<div><span style="font-size: 11px; font-weight: 500;">Input:</span><pre class="saq-tc-pre" tabindex="0">${escapeHtml(ex.input)}</pre></div>` : ""}
                ${ex.output ? `<div><span style="font-size: 11px; font-weight: 500;">Output:</span><pre class="saq-tc-pre" tabindex="0">${escapeHtml(ex.output)}</pre></div>` : ""}
                ${ex.explanation ? `<div style="font-size: 12px; color: var(--saq-text-muted, #666); margin-top: 4px;"><em>Explanation:</em> ${escapeHtml(ex.explanation)}</div>` : ""}
              </div>
            `;
          }).join("");
          examplesHtml = `
            <div class="saq-pa-section">
              <div class="saq-pa-section-hdr"><span class="saq-pa-section-title">Examples</span></div>
              <div>${exCards}</div>
            </div>
          `;
        }

        // Constraints section
        let constraintsHtml = "";
        if (Array.isArray(pData.constraints) && pData.constraints.length > 0) {
          constraintsHtml = `
            <div class="saq-pa-section">
              <div class="saq-pa-section-hdr"><span class="saq-pa-section-title">Constraints</span></div>
              <ul style="margin: 4px 0 0 16px; padding: 0; font-size: 13px;">
                ${pData.constraints.map((c) => `<li>${escapeHtml(typeof c === "string" ? c : String(c))}</li>`).join("")}
              </ul>
            </div>
          `;
        }

        // Test Cases section
        let tcHtml = "";
        if (Array.isArray(pData.testCases) && pData.testCases.length > 0) {
          const cards = pData.testCases.map((tc) => {
            const label = tc.description ? `Case ${tc.index} (${escapeHtml(tc.description)})` : `Case ${tc.index}`;
            if (tc.raw) {
              return `
                <div class="saq-test-case-card">
                  <div class="saq-test-case-header"><span class="saq-tc-name">${escapeHtml(label)}</span></div>
                  <pre class="saq-tc-pre" tabindex="0">${escapeHtml(tc.raw)}</pre>
                </div>
              `;
            }
            return `
              <div class="saq-test-case-card">
                <div class="saq-test-case-header">
                  <span class="saq-tc-name">${escapeHtml(label)}</span>
                  ${tc.isSample ? '<span class="acx-badge acx-badge-neutral">Sample</span>' : ""}
                  ${tc.status === "passed" ? '<span class="acx-badge acx-badge-success">Passed</span>' : tc.status === "failed" ? '<span class="acx-badge acx-badge-error">Failed</span>' : ""}
                </div>
                <div class="saq-test-case-io">
                  <div class="saq-tc-col">
                    <span class="saq-tc-label">Input</span>
                    <pre class="saq-tc-pre" tabindex="0">${escapeHtml(tc.input || "")}</pre>
                  </div>
                  <div class="saq-tc-col">
                    <span class="saq-tc-label">Expected Output</span>
                    <pre class="saq-tc-pre" tabindex="0">${escapeHtml(tc.expectedOutput || "")}</pre>
                  </div>
                </div>
              </div>
            `;
          }).join("");
          tcHtml = `
            <div class="saq-pa-section">
              <div class="saq-pa-section-hdr">
                <span class="saq-pa-section-title">Test Cases</span>
                <button class="saq-btn saq-btn-xs saq-btn-secondary" data-act="copy-testcases" type="button" title="Copy test cases as Markdown">Copy Test Cases</button>
              </div>
              <div class="saq-test-cases-grid">${cards}</div>
            </div>
          `;
        } else {
          tcHtml = `
            <div class="saq-pa-section">
              <div class="saq-pa-section-hdr">
                <span class="saq-pa-section-title">Test Cases</span>
              </div>
              <div class="saq-empty-notice" style="color: var(--saq-text-muted, #888); font-size: 13px; font-style: italic;">No visible test cases available in this assignment.</div>
            </div>
          `;
        }

        const scaffoldUnavailable =
          (pData.hasPrefixCode && pData.prefixCode === null) ||
          (pData.hasSuffixCode && pData.suffixCode === null);
        const editorContextHtml = `
          <div class="saq-pa-section saq-pa-editor-context">
            <div class="saq-pa-section-hdr">
              <span class="saq-pa-section-title">Code</span>
              ${scaffoldUnavailable ? '<span class="acx-badge acx-badge-danger">Protected scaffold unavailable</span>' : ""}
            </div>
            <div data-programming-editor-slot></div>
          </div>
        `;

        // Return Instructions section
        let returnInstructionsHtml = "";
        if (pData.returnInstructions && pData.returnInstructions.trim()) {
          returnInstructionsHtml = `
            <div class="saq-pa-section">
              <div class="saq-pa-section-hdr"><span class="saq-pa-section-title">Return Instructions</span></div>
              <div style="font-size: 13px; line-height: 1.5; color: var(--saq-text-normal);">${escapeHtml(pData.returnInstructions)}</div>
            </div>
          `;
        }

        b.innerHTML = `
          ${headerHtml}
          ${warningBannerHtml}

          <div class="saq-stem">${stemHtml}</div>
          ${imagesHtml}
          ${examplesHtml}
          ${constraintsHtml}
          ${tcHtml}
          ${editorContextHtml}
          ${returnInstructionsHtml}
          ${feedbackHtml}
        `;

      } else {
        b.innerHTML = `
          ${headerHtml}
          <div class="saq-stem">${stemHtml}</div>
          ${optsHtml}
          ${feedbackHtml}
        `;
      }

      const editorSlot = b.querySelector("[data-programming-editor-slot]");
      if (editorSlot) {
        const pData = q.programmingData || {};
        const editor = new ProgrammingCodeEditor({
          language: pData.language || "javascript",
          prefixCode: pData.prefixCode,
          starterCode: pData.starterCode ?? pData.currentCode ?? "",
          currentCode: pData.currentCode ?? pData.starterCode ?? "",
          suffixCode: pData.suffixCode,
          hasPrefixCode: pData.hasPrefixCode,
          hasSuffixCode: pData.hasSuffixCode,
          editorIdentity: pData.editorIdentity,
          questionIdentity: pData.questionIdentity,
          onApply: (code) => {
            pData.currentCode = code;
            if (pData.status) pData.status.isModified = false;
          },
          onStatus: (message, tone) => this.notify(message, tone),
          onStateChange: ({ status, modified, applying }) => {
            const statusEl = this.sheetElement?.querySelector("#saq-program-sync-status");
            if (statusEl) statusEl.textContent = status;
            const applyButton = this.sheetElement?.querySelector("#saq-apply-programming-code");
            if (applyButton) {
              applyButton.hidden = !modified;
              applyButton.disabled = !modified || applying;
              applyButton.textContent = applying ? "Applying…" : "Apply Changes";
            }
          },
        });
        this.programmingEditor?.destroy();
        this.programmingEditor = editor;
        editorSlot.appendChild(editor.render());
      }

      // Prune empty feedback callouts in review mode
      b.querySelectorAll(".feedback").forEach((fb) => {
        const title = fb.querySelector(".title");
        const body = fb.textContent.replace(title?.textContent || "", "").trim();
        if (!body) fb.remove();
      });

      // Make code blocks keyboard scrollable per §7
      b.querySelectorAll("pre").forEach((pre) => {
        pre.setAttribute("tabindex", "0");
      });

      // Enforce read-only state on options and inputs, but keep action buttons active
      b.querySelectorAll(".saq-options input, .saq-options textarea, .saq-options select, .saq-options button").forEach((el) => {
        el.setAttribute("disabled", "true");
        el.setAttribute("tabindex", "-1");
      });

      // Enhance any remaining unrendered math in block (e.g. from raw HTML, legacy snapshots)
      this.enhanceMathInBlock(b);

      inner.appendChild(b);
    });

    scrollContainer.replaceChildren(inner);
  }

  enhanceMathInBlock(container) {
    if (!container || !container.querySelectorAll) return;

    // 1. Render any unrendered .math-tex or .katex elements
    container.querySelectorAll(".math-tex, .katex-display.math-tex, span.katex.math-inline").forEach((el) => {
      if (el.querySelector(".katex-html") || el.querySelector("math")) return;
      const text = (el.textContent || "").trim();
      const isDisplay = el.classList.contains("katex-display") || el.classList.contains("math-display");
      const match = text.match(/^\\\[([\s\S]*)\\\]$/) || text.match(/^\\\(([\s\S]*)\\\)$/);
      const tex = match ? match[1].trim() : text;
      if (tex) {
        const rendered = renderVisualMath(tex, { isDisplay });
        if (rendered) {
          el.innerHTML = rendered;
          el.classList.add("math-rendered");
        }
      }
    });

    // 2. Scan text nodes for raw \(...\) or \[...\] delimiters
    if (typeof document !== "undefined" && typeof document.createTreeWalker === "function") {
      try {
        const walker = document.createTreeWalker(
          container,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode(node) {
              const parent = node.parentElement;
              if (!parent) return NodeFilter.FILTER_REJECT;
              const tag = (parent.tagName || "").toUpperCase();
              if (
                tag === "SCRIPT" ||
                tag === "STYLE" ||
                tag === "PRE" ||
                tag === "CODE" ||
                parent.closest("pre, code, .katex-html, annotation, .math-rendered")
              ) {
                return NodeFilter.FILTER_REJECT;
              }
              if (node.nodeValue && (/\\\(|\\\[/.test(node.nodeValue))) {
                return NodeFilter.FILTER_ACCEPT;
              }
              return NodeFilter.FILTER_SKIP;
            }
          }
        );

        const nodesToReplace = [];
        while (walker.nextNode()) {
          nodesToReplace.push(walker.currentNode);
        }

        for (const textNode of nodesToReplace) {
          const text = textNode.nodeValue || "";
          const hasMath = /\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)/g.test(text);
          if (!hasMath) continue;

          const span = document.createElement("span");
          span.innerHTML = text
            .replace(/\\\[([\s\S]*?)\\\]/g, (_, tex) => {
              return renderVisualMath(tex.trim(), { isDisplay: true });
            })
            .replace(/\\\(([\s\S]*?)\\\)/g, (_, tex) => {
              return renderVisualMath(tex.trim(), { isDisplay: false });
            });

          if (textNode.parentNode) {
            textNode.parentNode.replaceChild(span, textNode);
          }
        }
      } catch {
        // TreeWalker safety fallback
      }
    }
  }

  handleKeyDown(e) {
    return handleReaderKeyDown.call(this, e);
  }

  handleActionClick(e) {
    return handleReaderActionClick.call(this, e);
  }

  printFallbackWithTitle(docModel = this.documentModel) {
    const prevTitle = typeof document !== "undefined" ? document.title : "";
    let restored = false;
    const restoreTitle = () => {
      if (restored) return;
      restored = true;
      if (typeof window !== "undefined") {
        window.removeEventListener("afterprint", restoreTitle);
      }
      if (typeof document !== "undefined") {
        try {
          document.title = prevTitle;
        } catch {}
      }
    };

    try {
      const printTitle = buildExportFilename(docModel?.metadata || {}, "pdf").replace(/\.pdf$/i, "");
      if (typeof document !== "undefined" && printTitle) {
        document.title = printTitle;
      }
      if (typeof window !== "undefined") {
        window.addEventListener("afterprint", restoreTitle, { once: true });
        window.print();
      }
    } catch (err) {
      restoreTitle();
      throw err;
    }
  }

  wireDrag(grip, sheet) {
    return wireReaderDrag.call(this, grip, sheet);
  }

  show() {
    if (!this.sheetElement || !this.backdropElement) return;

    this.startClock();
    requestAnimationFrame(() => {
      this.backdropElement?.classList.add("is-open");
      this.sheetElement?.classList.add("is-open");
      const closeBtn = this.sheetElement?.querySelector(".saq-btn-close");
      const target = closeBtn || this.sheetElement;
      if (target && typeof target.focus === "function") {
        try {
          target.focus({ preventScroll: true });
        } catch (_e) {
          target.focus();
        }
      }
    });
  }

  dismiss() {
    if (!this.isOpen()) return;
    this.closeAiPopover?.({ restoreFocus: false });
    this.stopClock();
    this.clearStatus();
    this.sheetElement?.classList.remove("is-open");
    this.backdropElement?.classList.remove("is-open");
    if (this.onDismissCallback) {
      this.onDismissCallback();
    }
  }

  setCompact(isCompact) {
    if (this.sheetElement) {
      this.sheetElement.classList.toggle("saq-compact", Boolean(isCompact));
    }
  }

  setExporting(isBusy, format = "") {
    if (!this.sheetElement) return;
    const btns = this.sheetElement.querySelectorAll(
      ".saq-btn-export, [data-act='export-md'], [data-act='print'], [data-act='export-bundle'], [data-act='copy-questions']"
    );
    const activeAct =
      format === "markdown"
        ? "export-md"
        : format === "pdf"
        ? "print"
        : format === "bundle"
        ? "export-bundle"
        : "";

    btns.forEach((btn) => {
      if (isBusy) {
        btn.setAttribute("disabled", "true");
        btn.setAttribute("aria-busy", "true");
        btn.classList.add("is-busy");
        if (activeAct && btn.dataset?.act === activeAct) {
          btn.classList.add("is-active-export");
        }
      } else {
        btn.removeAttribute("disabled");
        btn.removeAttribute("aria-busy");
        btn.classList.remove("is-busy");
        btn.classList.remove("is-active-export");
      }
    });

    if (isBusy) {
      const labelMap = {
        markdown: "Exporting Markdown…",
        pdf: "Preparing PDF…",
        bundle: "Packaging bundle…",
      };
      this.notify(labelMap[format] || "Exporting…", "busy", 0);
    }
  }

  setZoom(scale) {
    const valid = Math.min(1.6, Math.max(0.75, scale));
    this.currentZoom = valid;
    if (this.sheetElement && this.sheetElement.style) {
      if (typeof this.sheetElement.style.setProperty === "function") {
        this.sheetElement.style.setProperty("--acx-zoom", String(valid));
      } else {
        this.sheetElement.style["--acx-zoom"] = String(valid);
      }
      const valBtn = this.sheetElement.querySelector("[data-act='zoom-reset']");
      if (valBtn) valBtn.textContent = `${Math.round(valid * 100)}%`;
    }
  }

  getZoom() {
    return this.currentZoom || 1.0;
  }

  openLightbox({ src = "", alt = "", caption = "", svgHtml = "" } = {}) {
    const root = this.shadowHost?.root;
    if (!root) return;
    let lb = root.querySelector("#saq-image-lightbox");
    if (!lb) {
      lb = document.createElement("div");
      lb.id = "saq-image-lightbox";
      lb.className = "saq-lightbox";
      lb.setAttribute("role", "dialog");
      lb.setAttribute("aria-modal", "true");
      lb.setAttribute("aria-label", "Expanded Image Preview");
      lb.addEventListener("click", (e) => {
        const btn = e.target.closest?.("[data-act]");
        if (!btn) return;
        const act = btn.dataset.act;
        if (act === "close-lightbox") {
          e.preventDefault();
          e.stopPropagation();
          this.closeLightbox();
        } else if (act === "lightbox-zoom-in") {
          e.preventDefault();
          const vp = lb.querySelector("#saq-lightbox-viewport");
          if (vp) {
            const cur = Number(vp.dataset.zoom || 1);
            const next = Math.min(3, cur + 0.25);
            vp.dataset.zoom = String(next);
            vp.style.transform = `scale(${next})`;
          }
        } else if (act === "lightbox-zoom-out") {
          e.preventDefault();
          const vp = lb.querySelector("#saq-lightbox-viewport");
          if (vp) {
            const cur = Number(vp.dataset.zoom || 1);
            const next = Math.max(0.5, cur - 0.25);
            vp.dataset.zoom = String(next);
            vp.style.transform = `scale(${next})`;
          }
        } else if (act === "lightbox-zoom-reset") {
          e.preventDefault();
          const vp = lb.querySelector("#saq-lightbox-viewport");
          if (vp) {
            vp.dataset.zoom = "1";
            vp.style.transform = "scale(1)";
          }
        }
      });
      root.appendChild(lb);
    }
    const contentHtml = svgHtml
      ? `<div class="saq-lightbox-svg-wrap">${svgHtml}</div>`
      : `<img class="saq-lightbox-img" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" />`;
    const captionHtml = caption ? `<div class="saq-lightbox-caption">${escapeHtml(caption)}</div>` : "";

    lb.innerHTML = `
      <div class="saq-lightbox-backdrop" data-act="close-lightbox"></div>
      <div class="saq-lightbox-card">
        <div class="saq-lightbox-topbar">
          <span class="saq-lightbox-title">${escapeHtml(alt || caption || "Image View")}</span>
          <div class="saq-lightbox-actions">
            <button type="button" class="saq-btn saq-btn-secondary saq-btn-xs" data-act="lightbox-zoom-in" title="Zoom In">${ICONS.zoomIn || "+"}<span>Zoom In</span></button>
            <button type="button" class="saq-btn saq-btn-secondary saq-btn-xs" data-act="lightbox-zoom-out" title="Zoom Out">${ICONS.zoomOut || "−"}<span>Zoom Out</span></button>
            <button type="button" class="saq-btn saq-btn-secondary saq-btn-xs" data-act="lightbox-zoom-reset" title="Fit to View">Fit</button>
            <button type="button" class="saq-btn saq-btn-secondary saq-icon saq-lightbox-close-btn" data-act="close-lightbox" aria-label="Close image preview" title="Close preview (Esc)">${ICONS.close}</button>
          </div>
        </div>
        <div class="saq-lightbox-stage">
          <div class="saq-lightbox-viewport" id="saq-lightbox-viewport">
            ${contentHtml}
          </div>
          ${captionHtml}
        </div>
      </div>
    `;
    lb.hidden = false;
    lb.removeAttribute("hidden");
    lb.classList.add("is-open");
    const closeBtn = lb.querySelector(".saq-lightbox-close-btn");
    closeBtn?.focus?.();
  }

  closeLightbox() {
    const root = this.shadowHost?.root;
    if (!root) return;
    const lb = root.querySelector("#saq-image-lightbox");
    if (lb) {
      lb.classList.remove("is-open");
      lb.hidden = true;
      lb.setAttribute("hidden", "");
    }
  }

  isLightboxOpen() {
    const root = this.shadowHost?.root;
    const lb = root?.querySelector("#saq-image-lightbox");
    return Boolean(lb && !lb.hidden && !lb.hasAttribute("hidden"));
  }

  notify(message, tone = "info", durationMs = 3000) {
    if (!this.sheetElement) return;
    const bar = this.sheetElement.querySelector("#saq-status-bar");
    if (!bar) return;

    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }

    if (!message) {
      this.clearStatus();
      return;
    }

    bar.dataset.tone = tone;
    bar.setAttribute("role", tone === "error" ? "alert" : "status");
    const iconHtml =
      tone === "busy"
        ? `<span class="saq-spinner saq-spinner-sm" aria-hidden="true"></span>`
        : tone === "success"
        ? ICONS.check
        : tone === "error"
        ? ICONS.cross
        : tone === "warn"
        ? ICONS.warn
        : ICONS.info;

    bar.innerHTML = `${iconHtml}<span>${escapeHtml(message)}</span>`;
    bar.classList.add("is-visible");

    if (durationMs > 0) {
      this.statusTimer = setTimeout(() => {
        this.clearStatus();
      }, durationMs);
    }
  }

  clearStatus() {
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }
    if (!this.sheetElement) return;
    const bar = this.sheetElement.querySelector("#saq-status-bar");
    if (bar) {
      bar.classList.remove("is-visible");
      bar.removeAttribute("data-tone");
      bar.innerHTML = "";
    }
  }

  startClock() {
    this.stopClock();
    const tick = () => {
      const wrap = this.shadowHost.$(".saq-clock");
      const val = this.shadowHost.$(".saq-clock-val");
      if (!wrap || !val) return;
      const txt = this.portal.getSubmissionTimerText();
      val.textContent = txt;
      wrap.style.display = txt ? "" : "none";
    };
    tick();
    this.clockInterval = setInterval(tick, 500);
  }

  stopClock() {
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
      this.clockInterval = null;
    }
  }

  destroy() {
    this.runReaderFeatureHook("destroy");
    this.programmingEditor?.destroy();
    this.programmingEditor = null;
    this.stopClock();
    this.clearStatus();
    if (this.sheetElement) {
      if (this.boundKeyDown) {
        this.sheetElement.removeEventListener("keydown", this.boundKeyDown);
        this.boundKeyDown = null;
      }
      this.sheetElement.remove();
      this.sheetElement = null;
    }
    if (this.backdropElement) {
      this.backdropElement.remove();
      this.backdropElement = null;
    }
    const root = this.shadowHost?.shadow;
    if (root) {
      root.querySelectorAll("#saq-backdrop, #saq-sheet, #saq-image-lightbox").forEach((el) => el.remove());
    }
  }
}

if (typeof attachReaderAiFeatures === "function") {
  attachReaderAiFeatures(ReaderDrawer);
}
