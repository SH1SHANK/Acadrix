/**
 * Reader Drawer Component.
 * Encapsulated bottom sheet for read-only assignment inspection and printing.
 * Mounts entirely within the isolated ShadowRoot using the Acadrix Design System.
 */

import { ICONS } from "./icons.js";
import { escapeHtml } from "../utils/dom.js";
import { ContentType } from "../model/types.js";
import { buildExportFilename } from "../model/document.js";
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

    sheet.innerHTML = `
      <div class="saq-grip" aria-hidden="true" title="Drag down to close"></div>
      <header class="saq-header">
        <span class="saq-title" id="saq-reader-title">All Questions</span>
        <span class="saq-count-pill" aria-label="${documentModel.length} questions">${documentModel.length}</span>
        ${isReview ? '<span class="saq-tag">✓ Results</span>' : ""}
        <div class="saq-actions">
          <span class="saq-clock" title="Time remaining">${ICONS.clock}<span class="saq-clock-val"></span></span>
          <nav class="saq-export-group" aria-label="Export actions">
            <button type="button" class="saq-btn saq-btn-export" data-act="export-md" aria-label="Export Markdown" title="Export Markdown (.md)">${ICONS.markdown}<span>Markdown</span></button>
            <button type="button" class="saq-btn saq-btn-export" data-act="print" aria-label="Print or save as PDF" title="Print or save as PDF">${ICONS.print}<span>PDF</span></button>
            <button type="button" class="saq-btn saq-btn-export" data-act="export-bundle" aria-label="Export portable ZIP bundle" title="Export portable ZIP bundle">${ICONS.bundle}<span>Bundle</span></button>
          </nav>
          <button type="button" class="saq-btn saq-btn-secondary" data-act="refresh" aria-label="Refresh questions from assessment" title="Re-read questions from assessment">${ICONS.refresh}<span>Refresh</span></button>
          <button type="button" class="saq-btn saq-icon" data-act="theme" aria-label="Toggle dark theme" aria-pressed="${isDark ? "true" : "false"}" title="Toggle light/dark theme">${ICONS.theme}</button>
          <button type="button" class="saq-btn saq-icon saq-btn-close" data-act="dismiss" aria-label="Close reader" title="Close reader (Esc)">${ICONS.close}</button>
        </div>
      </header>
      <output class="saq-status-bar" id="saq-status-bar" role="status" aria-live="polite" aria-atomic="true"></output>
      ${warnHtml}
      <div class="saq-scroll" tabindex="0" role="region" aria-label="Questions list"></div>`;

    this.renderBlocks(sheet.querySelector(".saq-scroll"), documentModel);

    // Event delegation on header actions
    sheet.addEventListener("click", (e) => this.handleActionClick(e), true);

    // Focus trap inside modal dialog
    this.boundKeyDown = (e) => this.handleKeyDown(e);
    sheet.addEventListener("keydown", this.boundKeyDown);

    // Drag-to-dismiss gesture
    const grip = sheet.querySelector(".saq-grip");
    this.wireDrag(grip, sheet);

    root.appendChild(sheet);
    this.sheetElement = sheet;
    this.runReaderFeatureHook("renderHeaderActions", { sheet, documentModel });
    this.runReaderFeatureHook("documentChange", { documentModel, reason: "build" });
  }

  formatQuestionType(type) {
    if (!type || type === "unknown") return "";
    const map = {
      mcq: "MCQ",
      msq: "MSQ",
      numerical: "Numerical",
      text: "Short Answer",
      descriptive: "Descriptive",
    };
    return map[String(type).toLowerCase()] || "";
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
      b.className = "saq-block";
      b.id = `saq-q-${i}`;
      b.dataset.q = String(i);

      // 1. Question Header
      const typeLabel = this.formatQuestionType(q.type);
      const typeHtml = typeLabel ? `<span class="saq-qtype">${escapeHtml(typeLabel)}</span>` : "";
      const marksHtml = q.marks ? `<span class="saq-marks">${q.marks} Mark${q.marks > 1 ? "s" : ""}</span>` : "";
      const statusHtml = q.review?.statusText
        ? `<span class="saq-status ${q.review.isCorrect ? "correct" : "incorrect"}">${q.review.isCorrect ? "✓ " : "✕ "}${escapeHtml(q.review.statusText)}</span>`
        : "";

      const headerHtml = `
        <div class="saq-qheader">
          <span class="saq-qlabel">${escapeHtml(q.label)}</span>
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

      b.innerHTML = `
        ${headerHtml}
        <div class="saq-stem">${stemHtml}</div>
        ${optsHtml}
        ${feedbackHtml}
      `;

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

      // Enforce read-only state on all inputs inside block
      b.querySelectorAll("input, textarea, select, button").forEach((el) => {
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
      ".saq-btn-export, [data-act='export-md'], [data-act='print'], [data-act='export-bundle']"
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
    const root = this.shadowHost?.root;
    if (root) {
      root.querySelectorAll("#saq-backdrop, #saq-sheet").forEach((el) => el.remove());
    }
  }
}

if (typeof attachReaderAiFeatures === "function") {
  attachReaderAiFeatures(ReaderDrawer);
}
