/**
 * Reader Drawer Component.
 * Encapsulated bottom sheet for read-only assignment inspection and printing.
 * Mounts entirely within the isolated ShadowRoot using the Acadrix Design System.
 */

import { ICONS } from "./icons.js";
import { escapeHtml, sanitizeSvgSource, sanitizeMathML } from "../utils/dom.js";
import { ContentType, MathFormat, MathType } from "../model/types.js";
import { buildExportFilename } from "../model/document.js";
import { renderVisualMath } from "../utils/math.js";
/* @extension-only-start */
import { generateAiPrompt } from "../bridge/prompt.js";
/* @extension-only-end */

export function renderContentNodes(nodes, options = {}) {
  if (!Array.isArray(nodes) || nodes.length === 0) return "";
  const { visualMath = false } = options;

  return nodes
    .map((node) => {
      if (!node) return "";

      const attrs = node.attributes || {};
      const childrenHtml =
        node.children && node.children.length > 0
          ? renderContentNodes(node.children, options)
          : "";

      switch (node.type) {
        case ContentType.PARAGRAPH: {
          const content = childrenHtml || escapeHtml(node.value);
          return `<p>${content}</p>`;
        }

        case ContentType.HEADING: {
          const level = Math.min(Math.max(attrs.level || 1, 1), 6);
          const content = childrenHtml || escapeHtml(node.value);
          return `<h${level}>${content}</h${level}>`;
        }

        case ContentType.TEXT: {
          let text = escapeHtml(node.value);
          if (attrs.bold) text = `<strong>${text}</strong>`;
          if (attrs.italic) text = `<em>${text}</em>`;
          if (attrs.underline) text = `<u>${text}</u>`;
          if (attrs.strike) text = `<del>${text}</del>`;
          if (attrs.sub) text = `<sub>${text}</sub>`;
          if (attrs.sup) text = `<sup>${text}</sup>`;
          return text;
        }

        case ContentType.INLINE_CODE:
          return `<code>${escapeHtml(node.value)}</code>`;

        case ContentType.CODE_BLOCK: {
          const lang = attrs.language ? ` class="language-${escapeHtml(attrs.language)}"` : "";
          return `<pre><code${lang}>${escapeHtml(node.value)}</code></pre>`;
        }

        case ContentType.MATH: {
          const format = attrs.format || MathFormat.TEX;
          const isDisplay = attrs.mathType === "display" || attrs.mathType === MathType.DISPLAY;
          const tex = node.value || "";
          const mathml = attrs.mathml || (format === MathFormat.MATHML ? tex : "");

          if (visualMath) {
            return renderVisualMath(tex, {
              isDisplay,
              mathml,
              fallbackText: attrs.texUnavailable ? tex : "",
            });
          }

          if (format === MathFormat.TEX) {
            return isDisplay
              ? `<div class="katex-display math-tex">\\[${escapeHtml(node.value)}\\]</div>`
              : `<span class="katex math-inline">\\(${escapeHtml(node.value)}\\)</span>`;
          } else if (format === MathFormat.MATHML) {
            return `<span class="mathml-wrap">${sanitizeMathML(node.value)}</span>`;
          }
          return `<span class="math-plain">${escapeHtml(node.value)}</span>`;
        }

        case ContentType.LIST: {
          const tag = attrs.ordered ? "ol" : "ul";
          const start = attrs.ordered && attrs.start > 1 ? ` start="${attrs.start}"` : "";
          return `<${tag}${start}>${childrenHtml}</${tag}>`;
        }

        case ContentType.LIST_ITEM: {
          const content = childrenHtml || escapeHtml(node.value);
          return `<li>${content}</li>`;
        }

        case ContentType.BLOCKQUOTE: {
          const content = childrenHtml || escapeHtml(node.value);
          return `<blockquote>${content}</blockquote>`;
        }

        case ContentType.TABLE: {
          const caption = attrs.caption ? `<caption>${escapeHtml(attrs.caption)}</caption>` : "";
          const rows = node.children || [];

          const theadRows = [];
          const tbodyRows = [];

          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const isHeaderRow =
              row.children &&
              row.children.length > 0 &&
              row.children.every((c) => c.attributes?.isHeader);

            if (isHeaderRow && tbodyRows.length === 0) {
              theadRows.push(row);
            } else {
              tbodyRows.push(row);
            }
          }

          let tableInner = caption;
          if (theadRows.length > 0) {
            tableInner += `<thead>${renderContentNodes(theadRows, options)}</thead>`;
          }
          if (tbodyRows.length > 0) {
            tableInner += `<tbody>${renderContentNodes(tbodyRows, options)}</tbody>`;
          } else if (theadRows.length === 0) {
            tableInner += `<tbody>${childrenHtml}</tbody>`;
          }

          return `<div class="saq-table-wrap"><table class="saq-table">${tableInner}</table></div>`;
        }

        case ContentType.TABLE_ROW:
          return `<tr>${childrenHtml}</tr>`;

        case ContentType.TABLE_CELL: {
          const tag = attrs.isHeader ? "th" : "td";
          const colspan = attrs.colspan > 1 ? ` colspan="${attrs.colspan}"` : "";
          const rowspan = attrs.rowspan > 1 ? ` rowspan="${attrs.rowspan}"` : "";
          const validAlign = ["left", "center", "right", "justify"].includes(attrs.align) ? attrs.align : "left";
          const align = validAlign !== "left" ? ` align="${validAlign}" style="text-align:${validAlign};"` : "";
          const content = childrenHtml || escapeHtml(node.value);
          return `<${tag}${colspan}${rowspan}${align}>${content}</${tag}>`;
        }

        case ContentType.IMAGE: {
          const rawSrc = (attrs.src || "").trim();
          const isSafeSrc = /^(https?:|\/|data:image\/)/i.test(rawSrc);
          const src = isSafeSrc ? escapeHtml(rawSrc) : "";
          const alt = escapeHtml(attrs.alt || "");
          const title = attrs.title ? ` title="${escapeHtml(attrs.title)}"` : "";
          const width = attrs.width ? ` width="${escapeHtml(String(attrs.width))}"` : "";
          const height = attrs.height ? ` height="${escapeHtml(String(attrs.height))}"` : "";
          return `<img src="${src}" alt="${alt}"${title}${width}${height} />`;
        }

        case ContentType.FIGURE: {
          const caption = attrs.caption ? `<figcaption>${escapeHtml(attrs.caption)}</figcaption>` : "";
          return `<figure>${childrenHtml}${caption}</figure>`;
        }

        case ContentType.SVG:
          return `<span class="saq-svg-wrap">${sanitizeSvgSource(node.value || "")}</span>`;

        case ContentType.LINK: {
          const rawHref = (attrs.href || "").trim();
          const isSafeHref = /^(https?:|\/|#|mailto:)/i.test(rawHref);
          const href = isSafeHref ? escapeHtml(rawHref) : "#";
          const title = attrs.title ? ` title="${escapeHtml(attrs.title)}"` : "";
          const content = childrenHtml || escapeHtml(node.value);
          return `<a href="${href}"${title} target="_blank" rel="noopener noreferrer">${content}</a>`;
        }

        case ContentType.LINE_BREAK:
          return `<br />`;

        case ContentType.HTML_BLOCK:
          return node.value || "";

        default:
          return childrenHtml || escapeHtml(node.value || "");
      }
    })
    .join("");
}

export class ReaderDrawer {
  constructor(shadowHost, portal) {
    this.shadowHost = shadowHost;
    this.portal = portal;
    this.sheetElement = null;
    this.backdropElement = null;
    this.clockInterval = null;
    this.statusTimer = null;
    this.aiCopyTimer = null;
    this.onRefreshCallback = null;
    this.onDismissCallback = null;
    this.onExportCallback = null;
    this.onThemeCallback = null;
    this.isDragging = false;
    this.dragStart = null;
    this.boundPointerMove = null;
    this.boundPointerUp = null;
    this.boundKeyDown = null;
    this.aiScopeState = null;
    this.aiPopoverOpenedOnce = false;
    this.aiPreviewExpanded = false;
    this.pdfDirectFallbackActive = false;
  }

  /* @extension-only-start */
  isDirectPdfAvailable() {
    if (this.pdfDirectFallbackActive) return false;
    return typeof chrome !== "undefined" && typeof chrome?.runtime?.sendMessage === "function";
  }

  setPdfFallbackMode(isFallback) {
    this.pdfDirectFallbackActive = Boolean(isFallback);
    if (this.sheetElement && this.isAiPopoverOpen?.()) {
      this.updateAiPopoverState?.();
    }
  }
  /* @extension-only-end */

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

    let aiTriggerHtml = "";
    let aiPopoverHtml = "";
    /* @extension-only-start */
    const hasAiPrompt = typeof generateAiPrompt === "function" && typeof this.buildAiPopoverHtml === "function";
    if (hasAiPrompt) {
      aiTriggerHtml = `<button type="button" class="saq-btn saq-btn-export" data-act="copy-ai" aria-label="Copy for AI" aria-expanded="false" aria-controls="saq-ai-popover" title="Copy prompt for AI chat">${ICONS.copy}<span>Copy for AI</span></button>`;
      aiPopoverHtml = this.buildAiPopoverHtml(documentModel);
    }
    /* @extension-only-end */

    sheet.innerHTML = `
      <div class="saq-grip" aria-hidden="true" title="Drag down to close"></div>
      <header class="saq-header">
        <span class="saq-title" id="saq-reader-title">All Questions</span>
        <span class="saq-count-pill" aria-label="${documentModel.length} questions">${documentModel.length}</span>
        ${isReview ? '<span class="saq-tag">✓ Results</span>' : ""}
        <div class="saq-actions">
          <span class="saq-clock" title="Time remaining">${ICONS.clock}<span class="saq-clock-val"></span></span>
          <nav class="saq-export-group" aria-label="Export actions">
            ${aiTriggerHtml}
            <button type="button" class="saq-btn saq-btn-export" data-act="export-md" aria-label="Export Markdown" title="Export Markdown (.md)">${ICONS.markdown}<span>Markdown</span></button>
            <button type="button" class="saq-btn saq-btn-export" data-act="print" aria-label="Print or save as PDF" title="Print or save as PDF">${ICONS.print}<span>PDF</span></button>
            <button type="button" class="saq-btn saq-btn-export" data-act="export-bundle" aria-label="Export portable ZIP bundle" title="Export portable ZIP bundle">${ICONS.bundle}<span>Bundle</span></button>
          </nav>
          <button type="button" class="saq-btn saq-btn-secondary" data-act="refresh" aria-label="Refresh questions from assessment" title="Re-read questions from assessment">${ICONS.refresh}<span>Refresh</span></button>
          <button type="button" class="saq-btn saq-icon" data-act="theme" aria-label="Toggle dark theme" aria-pressed="${isDark ? "true" : "false"}" title="Toggle light/dark theme">${ICONS.theme}</button>
          <button type="button" class="saq-btn saq-icon saq-btn-close" data-act="dismiss" aria-label="Close reader" title="Close reader (Esc)">${ICONS.close}</button>
        </div>
      </header>
      ${aiPopoverHtml}
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

    /* @extension-only-start */
    if (typeof this.wireAiPopover === "function") {
      this.wireAiPopover(sheet);
    }
    /* @extension-only-end */
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
    if (!this.sheetElement || !this.isOpen()) return;

    /* @extension-only-start */
    if (e.key === "Escape" && this.isAiPopoverOpen?.()) {
      e.preventDefault();
      e.stopPropagation();
      this.closeAiPopover?.();
      return;
    }
    /* @extension-only-end */

    if (e.key !== "Tab") return;

    /* @extension-only-start */
    const popover = this.sheetElement.querySelector("#saq-ai-popover");
    const popoverOpen = Boolean(this.isAiPopoverOpen?.());
    /* @extension-only-end */

    const focusables = Array.from(
      this.sheetElement.querySelectorAll(
        "button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"
      )
    ).filter((el) => {
      if (el.hasAttribute("disabled")) return false;
      /* @extension-only-start */
      if (!popoverOpen && popover && popover.contains(el)) return false;
      if (el.classList?.contains("saq-ai-preview") && el.hasAttribute("hidden")) return false;
      /* @extension-only-end */
      return true;
    });

    if (focusables.length === 0) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = this.shadowHost.root?.activeElement;

    if (e.shiftKey) {
      if (active === first || active === this.sheetElement || !active) {
        e.preventDefault();
        last.focus?.();
      }
    } else {
      if (active === last) {
        e.preventDefault();
        first.focus?.();
      }
    }
  }

  handleActionClick(e) {
    const btn = e.target.closest("[data-act]");
    if (!btn || btn.hasAttribute("disabled") || btn.classList.contains("is-busy")) {
      /* @extension-only-start */
      // Close popover if clicking outside popover and outside trigger button
      if (this.isAiPopoverOpen?.()) {
        const popover = this.sheetElement?.querySelector("#saq-ai-popover");
        if (popover && !popover.contains(e.target)) {
          this.closeAiPopover?.({ restoreFocus: false });
        }
      }
      /* @extension-only-end */
      return;
    }

    e.preventDefault();
    const action = btn.dataset.act;

    /* @extension-only-start */
    if (action === "copy-ai") {
      this.toggleAiPopover?.();
      return;
    } else if (action === "ai-close") {
      this.closeAiPopover?.();
      return;
    } else if (action === "ai-preview-toggle") {
      this.toggleAiPreview?.();
      return;
    } else if (action === "ai-copy-confirm") {
      this.copyAiPrompt?.();
      return;
    } else if (action === "ai-save-pdf") {
      this.saveAiPdf?.();
      return;
    }
    /* @extension-only-end */

    if (action === "refresh") {
      this.closeAiPopover?.({ restoreFocus: false });
      if (this.onRefreshCallback) this.onRefreshCallback();
    } else if (action === "export-md") {
      this.closeAiPopover?.({ restoreFocus: false });
      if (this.onExportCallback) {
        this.onExportCallback("markdown");
      }
    } else if (action === "print") {
      this.closeAiPopover?.({ restoreFocus: false });
      if (this.onExportCallback) {
        this.onExportCallback("pdf");
      } else if (typeof exportPdf === "function" && this.documentModel) {
        exportPdf(this.documentModel, {
          onFallback: () => this.setPdfFallbackMode?.(true),
        }).catch((err) => {
          console.error("[Unfold IITM] PDF export failed, falling back to window.print():", err);
          this.setPdfFallbackMode?.(true);
          this.printFallbackWithTitle(this.documentModel);
        });
      } else {
        this.printFallbackWithTitle(this.documentModel);
      }
    } else if (action === "export-bundle") {
      this.closeAiPopover?.({ restoreFocus: false });
      if (this.onExportCallback) {
        this.onExportCallback("bundle");
      }
    } else if (action === "theme") {
      const next = this.shadowHost.toggleTheme?.() || "light";
      btn.setAttribute("aria-pressed", next === "dark" ? "true" : "false");
      if (this.onThemeCallback) {
        this.onThemeCallback(next);
      }
    } else if (action === "dismiss") {
      this.dismiss();
    }
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

  /* @extension-only-start */
  // ── "Copy for AI" Popover (§4) ────────────────────────────────────────────

  getQuestionBounds(documentModel = this.documentModel) {
    const questions = documentModel?.questions || [];
    if (questions.length === 0) {
      return { minQ: 1, maxQ: 1, extractedCount: 0, totalCount: 0, isPartial: false };
    }
    const numbers = questions.map((q, idx) => Number(q.number) || idx + 1);
    const minQ = Math.min(...numbers);
    const maxQ = Math.max(...numbers);
    const extractedCount = questions.length;
    const rawTotal = Number(documentModel?.metadata?.totalQuestions);
    const totalCount = !isNaN(rawTotal) && rawTotal > 0 ? rawTotal : extractedCount;
    const isPartial = extractedCount < totalCount;
    return { minQ, maxQ, extractedCount, totalCount, isPartial };
  }

  ensureAiScopeState(documentModel = this.documentModel) {
    const { minQ, maxQ } = this.getQuestionBounds(documentModel);
    const activePortalQ = Number(this.portal?.getActiveLogicalNumber?.());
    const defaultSingle =
      !isNaN(activePortalQ) && activePortalQ >= minQ && activePortalQ <= maxQ
        ? activePortalQ
        : minQ;

    if (!this.aiScopeState) {
      this.aiScopeState = {
        type: "all",
        start: minQ,
        end: maxQ,
        single: defaultSingle,
      };
    } else {
      // Clamp stored session bounds to current document
      this.aiScopeState.start = Math.min(Math.max(this.aiScopeState.start || minQ, minQ), maxQ);
      this.aiScopeState.end = Math.min(Math.max(this.aiScopeState.end || maxQ, this.aiScopeState.start), maxQ);
      this.aiScopeState.single = Math.min(Math.max(this.aiScopeState.single || defaultSingle, minQ), maxQ);
    }
    return this.aiScopeState;
  }

  buildAiPopoverHtml(documentModel) {
    const { minQ, maxQ, extractedCount, totalCount, isPartial } = this.getQuestionBounds(documentModel);
    const state = this.ensureAiScopeState(documentModel);

    const allLabel = isPartial
      ? `${extractedCount} of ${totalCount} extracted`
      : `All (${extractedCount} Q${extractedCount === 1 ? "" : "s"})`;

    const partialWarnHtml = isPartial
      ? `<p class="saq-ai-notice is-warn" data-ai-partial-warn>${ICONS.warn}<span>Only ${extractedCount} of ${totalCount} questions were extracted. Use Refresh to capture the full assessment.</span></p>`
      : "";

    return `
      <aside class="saq-ai-popover" id="saq-ai-popover" role="dialog" aria-modal="false" aria-label="Copy for AI" hidden>
        <header class="saq-ai-popover-head">
          <span class="saq-ai-popover-title">Copy for AI</span>
          <button type="button" class="saq-btn saq-icon saq-ai-close" data-act="ai-close" aria-label="Close Copy for AI" title="Close (Esc)">${ICONS.close}</button>
        </header>
        <section class="saq-ai-popover-body">
          ${partialWarnHtml}
          <fieldset class="saq-ai-scope-fieldset">
            <legend class="saq-ai-legend">Scope</legend>
            <cite class="saq-ai-scope-options">
              <label class="saq-ai-radio-label" for="saq-ai-scope-all">
                <input type="radio" id="saq-ai-scope-all" name="saq-ai-scope" value="all" ${state.type === "all" ? "checked" : ""} />
                <span data-ai-all-label>${escapeHtml(allLabel)}</span>
              </label>
              <p class="saq-ai-radio-row">
                <bdi class="saq-ai-radio-label">
                  <input type="radio" id="saq-ai-scope-range" name="saq-ai-scope" value="range" aria-label="Range" ${state.type === "range" ? "checked" : ""} />
                  <var class="saq-ai-radio-text">Range</var>
                </bdi>
                <small class="saq-ai-range-inputs">
                  <input type="number" class="saq-ai-num-input" data-ai-input="start" aria-label="Range start question" min="${minQ}" max="${maxQ}" value="${state.start}" />
                  <abbr class="saq-ai-range-sep" aria-hidden="true">–</abbr>
                  <input type="number" class="saq-ai-num-input" data-ai-input="end" aria-label="Range end question" min="${minQ}" max="${maxQ}" value="${state.end}" />
                </small>
              </p>
              <dl class="saq-ai-radio-row">
                <dt class="saq-ai-radio-label">
                  <input type="radio" id="saq-ai-scope-single" name="saq-ai-scope" value="single" aria-label="Single question" ${state.type === "single" ? "checked" : ""} />
                  <kbd class="saq-ai-radio-text">Single Q</kbd>
                </dt>
                <dd class="saq-ai-range-inputs">
                  <input type="number" class="saq-ai-num-input" data-ai-input="single" aria-label="Single question number" min="${minQ}" max="${maxQ}" value="${state.single}" />
                </dd>
              </dl>
            </cite>
          </fieldset>

          <div class="saq-ai-meta-row">
            <span class="saq-ai-tokens" data-ai-tokens></span>
          </div>

          <blockquote class="saq-ai-notice is-warn" data-ai-range-error hidden></blockquote>
          <figure class="saq-ai-notice is-warn" data-ai-fig-warn hidden></figure>
          <address class="saq-ai-notice is-warn" data-ai-token-warn hidden></address>

          <article class="saq-ai-preview-section">
            <button type="button" class="saq-ai-preview-toggle" data-act="ai-preview-toggle" aria-expanded="${this.aiPreviewExpanded ? "true" : "false"}">
              <span class="saq-ai-preview-chevron" aria-hidden="true">${this.aiPreviewExpanded ? "▾" : "▸"}</span>
              <span>Preview prompt</span>
            </button>
            <pre class="saq-ai-preview" data-ai-preview tabindex="0" ${this.aiPreviewExpanded ? "" : "hidden"}></pre>
          </article>

          <footer class="saq-ai-footer">
            <div class="saq-ai-actions">
              <button type="button" class="saq-btn saq-btn-secondary saq-ai-pdf-btn" data-act="ai-save-pdf" aria-label="Save PDF for AI" title="Save as PDF to attach in AI chat">
                ${ICONS.print}
                <span>Save PDF</span>
              </button>
              <button type="button" class="saq-btn saq-btn-primary saq-ai-copy-btn" data-act="ai-copy-confirm">
                ${ICONS.copy}
                <span>Copy Prompt to Clipboard</span>
              </button>
            </div>
            <output class="saq-ai-live-status" data-ai-live-status role="status" aria-live="polite" aria-atomic="true"></output>
          </footer>
        </section>
      </aside>
    `;
  }

  wireAiPopover(sheet) {
    const popover = sheet.querySelector("#saq-ai-popover");
    if (!popover) return;

    const labels = popover.querySelectorAll(".saq-ai-radio-label");
    labels.forEach((lbl) => {
      lbl.addEventListener("click", (e) => {
        const radio = lbl.querySelector("input[type='radio']");
        if (radio && e.target !== radio) {
          radio.checked = true;
          const state = this.ensureAiScopeState();
          state.type = radio.value;
          this.updateAiPopoverState();
        }
      });
    });

    const radios = popover.querySelectorAll("input[name='saq-ai-scope']");
    radios.forEach((radio) => {
      radio.addEventListener("change", () => {
        if (radio.checked) {
          const state = this.ensureAiScopeState();
          state.type = radio.value;
          this.updateAiPopoverState();
        }
      });
    });

    const inputs = popover.querySelectorAll("[data-ai-input]");
    inputs.forEach((input) => {
      const handleInput = () => {
        const kind = input.getAttribute("data-ai-input");
        const state = this.ensureAiScopeState();
        if (kind === "start" || kind === "end") {
          state.type = "range";
          const rangeRadio = popover.querySelector("input[name='saq-ai-scope'][value='range']");
          if (rangeRadio) rangeRadio.checked = true;
        } else if (kind === "single") {
          state.type = "single";
          const singleRadio = popover.querySelector("input[name='saq-ai-scope'][value='single']");
          if (singleRadio) singleRadio.checked = true;
        }
        this.updateAiPopoverState();
      };
      input.addEventListener("input", handleInput);
      input.addEventListener("change", handleInput);
    });

    this.updateAiPopoverState();
  }

  isAiPopoverOpen() {
    const popover = this.sheetElement?.querySelector("#saq-ai-popover");
    return Boolean(popover && popover.classList.contains("is-open") && !popover.hasAttribute("hidden"));
  }

  toggleAiPopover() {
    if (this.isAiPopoverOpen()) {
      this.closeAiPopover();
    } else {
      this.openAiPopover();
    }
  }

  openAiPopover() {
    if (!this.sheetElement || typeof generateAiPrompt !== "function") return;
    const popover = this.sheetElement.querySelector("#saq-ai-popover");
    const trigger = this.sheetElement.querySelector("[data-act='copy-ai']");
    if (!popover) return;

    // Default Single scope to the active portal question on first open only;
    // do not reset after a document refresh or subsequent opens.
    if (!this.aiPopoverOpenedOnce) {
      this.aiPopoverOpenedOnce = true;
      const state = this.ensureAiScopeState();
      const { minQ, maxQ } = this.getQuestionBounds();
      const activeQ = Number(this.portal?.getActiveLogicalNumber?.());
      if (!isNaN(activeQ) && activeQ >= minQ && activeQ <= maxQ) {
        state.single = activeQ;
        const singleInput = popover.querySelector("[data-ai-input='single']");
        if (singleInput) {
          singleInput.value = String(activeQ);
          singleInput.setAttribute("value", String(activeQ));
        }
      }
    }

    popover.removeAttribute("hidden");
    popover.classList.add("is-open");
    if (trigger) {
      trigger.setAttribute("aria-expanded", "true");
      trigger.classList.add("is-active-export");
    }

    this.updateAiPopoverState();

    // Move focus into the popover (checked radio or copy button)
    const checkedRadio =
      popover.querySelector(`input[name='saq-ai-scope'][value='${this.aiScopeState?.type || "all"}']`) ||
      popover.querySelector("input[name='saq-ai-scope']") ||
      popover.querySelector("[data-act='ai-copy-confirm']");
    if (checkedRadio && typeof checkedRadio.focus === "function") {
      try {
        checkedRadio.focus({ preventScroll: true });
      } catch {
        checkedRadio.focus();
      }
    }
  }

  closeAiPopover({ restoreFocus = true } = {}) {
    if (!this.sheetElement) return;
    const popover = this.sheetElement.querySelector("#saq-ai-popover");
    const trigger = this.sheetElement.querySelector("[data-act='copy-ai']");
    if (!popover || !this.isAiPopoverOpen()) return;

    popover.classList.remove("is-open");
    popover.setAttribute("hidden", "");
    if (trigger) {
      trigger.setAttribute("aria-expanded", "false");
      trigger.classList.remove("is-active-export");
      if (restoreFocus && typeof trigger.focus === "function") {
        try {
          trigger.focus({ preventScroll: true });
        } catch {
          trigger.focus();
        }
      }
    }
  }

  toggleAiPreview() {
    if (!this.sheetElement) return;
    const popover = this.sheetElement.querySelector("#saq-ai-popover");
    if (!popover) return;

    this.aiPreviewExpanded = !this.aiPreviewExpanded;
    const btn = popover.querySelector("[data-act='ai-preview-toggle']");
    const pre = popover.querySelector("[data-ai-preview]");
    const chevron = popover.querySelector(".saq-ai-preview-chevron");

    if (btn) btn.setAttribute("aria-expanded", this.aiPreviewExpanded ? "true" : "false");
    if (chevron) chevron.textContent = this.aiPreviewExpanded ? "▾" : "▸";
    if (pre) {
      if (this.aiPreviewExpanded) {
        pre.removeAttribute("hidden");
      } else {
        pre.setAttribute("hidden", "");
      }
    }
  }

  resolveValidatedScope() {
    const { minQ, maxQ, extractedCount } = this.getQuestionBounds();
    const state = this.ensureAiScopeState();
    const popover = this.sheetElement?.querySelector("#saq-ai-popover");

    if (extractedCount === 0) {
      return { valid: false, error: "No questions available to export.", scope: { type: "all" } };
    }

    if (state.type === "all") {
      return { valid: true, error: "", scope: { type: "all" } };
    }

    if (state.type === "range") {
      const startInput = popover?.querySelector("[data-ai-input='start']");
      const endInput = popover?.querySelector("[data-ai-input='end']");
      const rawStart = startInput ? (startInput.value ?? startInput.getAttribute("value")) : state.start;
      const rawEnd = endInput ? (endInput.value ?? endInput.getAttribute("value")) : state.end;
      const start = parseInt(String(rawStart), 10);
      const end = parseInt(String(rawEnd), 10);

      if (isNaN(start) || isNaN(end) || start < minQ || end < minQ || start > maxQ || end > maxQ || start > end) {
        return {
          valid: false,
          error: `Range must satisfy ${minQ} ≤ start ≤ end ≤ ${maxQ}.`,
          scope: null,
        };
      }

      state.start = start;
      state.end = end;
      return { valid: true, error: "", scope: { type: "range", start, end } };
    }

    if (state.type === "single") {
      const singleInput = popover?.querySelector("[data-ai-input='single']");
      const rawSingle = singleInput ? (singleInput.value ?? singleInput.getAttribute("value")) : state.single;
      const num = parseInt(String(rawSingle), 10);

      if (isNaN(num) || num < minQ || num > maxQ) {
        return {
          valid: false,
          error: `Question number must be between ${minQ} and ${maxQ}.`,
          scope: null,
        };
      }

      state.single = num;
      return { valid: true, error: "", scope: { type: "single", number: num } };
    }

    return { valid: true, error: "", scope: { type: "all" } };
  }

  updateAiPopoverState() {
    if (!this.sheetElement || !this.documentModel || typeof generateAiPrompt !== "function") return;
    const popover = this.sheetElement.querySelector("#saq-ai-popover");
    if (!popover) return;

    const { valid, error, scope } = this.resolveValidatedScope();
    const rangeErrEl = popover.querySelector("[data-ai-range-error]");
    const figWarnEl = popover.querySelector("[data-ai-fig-warn]");
    const tokenWarnEl = popover.querySelector("[data-ai-token-warn]");
    const tokensEl = popover.querySelector("[data-ai-tokens]");
    const previewEl = popover.querySelector("[data-ai-preview]");
    const copyBtn = popover.querySelector("[data-act='ai-copy-confirm']");
    const pdfBtn = popover.querySelector("[data-act='ai-save-pdf']");

    if (!valid || !scope) {
      if (rangeErrEl) {
        rangeErrEl.innerHTML = `${ICONS.warn}<span>${escapeHtml(error)}</span>`;
        rangeErrEl.removeAttribute("hidden");
      }
      if (figWarnEl) figWarnEl.setAttribute("hidden", "");
      if (tokenWarnEl) tokenWarnEl.setAttribute("hidden", "");
      if (tokensEl) tokensEl.textContent = "Size: —";
      if (previewEl) previewEl.textContent = "";
      if (copyBtn) copyBtn.setAttribute("disabled", "true");
      if (pdfBtn) pdfBtn.setAttribute("disabled", "true");
      this.currentAiPromptResult = null;
      return;
    }

    if (rangeErrEl) {
      rangeErrEl.setAttribute("hidden", "");
      rangeErrEl.innerHTML = "";
    }

    const result = generateAiPrompt(this.documentModel, { scope });
    this.currentAiPromptResult = result;

    if (result.questionCount === 0) {
      if (rangeErrEl) {
        rangeErrEl.innerHTML = `${ICONS.warn}<span>No extracted questions match the selected scope.</span>`;
        rangeErrEl.removeAttribute("hidden");
      }
      if (copyBtn) copyBtn.setAttribute("disabled", "true");
      if (pdfBtn) pdfBtn.setAttribute("disabled", "true");
    } else {
      if (copyBtn) copyBtn.removeAttribute("disabled");
      if (pdfBtn) pdfBtn.removeAttribute("disabled");
    }

    if (tokensEl) {
      const formattedTokens = result.tokenEstimate.toLocaleString("en-US");
      tokensEl.textContent = `Size: ~${formattedTokens} tokens (${result.questionCount} Q${result.questionCount === 1 ? "" : "s"})`;
    }

    if (figWarnEl) {
      if (result.figureQuestions && result.figureQuestions.length > 0) {
        const qList = result.figureQuestions.map((n) => `Q${n}`).join(", ");
        const noun = result.figureQuestions.length === 1 ? "Figure" : "Figures";
        const hint = this.isDirectPdfAvailable()
          ? "save PDF and attach in chat alongside prompt"
          : "click Save PDF, choose Save as PDF, and attach in chat";
        figWarnEl.innerHTML = `${ICONS.warn}<span>${noun} in ${escapeHtml(qList)} — image not included (${hint})</span>`;
        figWarnEl.removeAttribute("hidden");
      } else {
        figWarnEl.setAttribute("hidden", "");
        figWarnEl.innerHTML = "";
      }
    }

    if (tokenWarnEl) {
      if (result.tokenEstimate > 25000) {
        tokenWarnEl.innerHTML = `${ICONS.warn}<span>Large prompt (~${result.tokenEstimate.toLocaleString("en-US")} tokens). Consider exporting in smaller Range batches to avoid chat truncation.</span>`;
        tokenWarnEl.removeAttribute("hidden");
      } else {
        tokenWarnEl.setAttribute("hidden", "");
        tokenWarnEl.innerHTML = "";
      }
    }

    if (previewEl) {
      previewEl.textContent = result.prompt;
    }
  }

  getScopedDocument(scope) {
    if (!this.documentModel || !scope || scope.type === "all") {
      return this.documentModel;
    }
    const allQuestions = this.documentModel.questions || [];
    let questions = allQuestions;
    if (scope.type === "single" && typeof scope.number === "number") {
      questions = allQuestions.filter((q) => q.number === scope.number);
    } else if (
      scope.type === "range" &&
      typeof scope.start === "number" &&
      typeof scope.end === "number"
    ) {
      const min = Math.min(scope.start, scope.end);
      const max = Math.max(scope.start, scope.end);
      questions = allQuestions.filter((q) => q.number >= min && q.number <= max);
    }
    return {
      ...this.documentModel,
      length: questions.length,
      metadata: {
        ...(this.documentModel.metadata || {}),
        totalQuestions: questions.length,
      },
      questions,
    };
  }

  saveAiPdf() {
    if (!this.sheetElement || !this.documentModel) return;
    const { valid, scope } = this.resolveValidatedScope();
    if (!valid || !scope) return;

    const scopedDoc = this.getScopedDocument(scope);
    if (!scopedDoc || !scopedDoc.questions || scopedDoc.questions.length === 0) return;

    if (this.onExportCallback) {
      this.onExportCallback("pdf", {
        document: scopedDoc,
        includeReviewData: false,
        includeInteractionState: false,
      });
    } else if (typeof exportPdf === "function") {
      exportPdf(scopedDoc, {
        includeReviewData: false,
        includeInteractionState: false,
        onFallback: () => this.setPdfFallbackMode?.(true),
      }).catch((err) => {
        console.error("[Unfold IITM] PDF export failed, falling back to window.print():", err);
        this.setPdfFallbackMode?.(true);
        this.printFallbackWithTitle(scopedDoc);
      });
    } else {
      this.printFallbackWithTitle(scopedDoc);
    }
  }

  announceAiStatus(message, tone = "success", durationMs = 2500) {
    if (!this.sheetElement) return;
    const popover = this.sheetElement.querySelector("#saq-ai-popover");
    const liveStatus = popover?.querySelector("[data-ai-live-status]");
    if (!liveStatus) return;

    if (this.aiCopyTimer) {
      clearTimeout(this.aiCopyTimer);
      this.aiCopyTimer = null;
    }

    const icon = tone === "error" ? ICONS.cross : tone === "info" ? ICONS.info : ICONS.check;
    liveStatus.dataset.tone = tone;
    liveStatus.innerHTML = `${icon}<span>${escapeHtml(message)}</span>`;
    liveStatus.classList.add("is-visible");

    if (durationMs > 0) {
      this.aiCopyTimer = setTimeout(() => {
        liveStatus.classList.remove("is-visible");
        liveStatus.innerHTML = "";
      }, durationMs);
    }
  }

  writeClipboardText(text) {
    const execFallback = () => {
      try {
        const prevFocused = this.rootNode?.activeElement || null;
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.setAttribute("aria-hidden", "true");
        ta.style.position = "fixed";
        ta.style.top = "-9999px";
        ta.style.left = "-9999px";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select?.();
        const ok = typeof document.execCommand === "function" ? Boolean(document.execCommand("copy")) : true;
        ta.remove();
        prevFocused?.focus?.();
        return ok;
      } catch {
        return false;
      }
    };

    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        const promise = navigator.clipboard.writeText(text);
        if (promise && typeof promise.then === "function") {
          return promise.then(
            () => true,
            () => execFallback()
          );
        }
        return Promise.resolve(true);
      }
    } catch {
      return Promise.resolve(execFallback());
    }

    return Promise.resolve(execFallback());
  }

  async copyAiPrompt() {
    if (!this.sheetElement) return;
    if (!this.currentAiPromptResult) {
      this.updateAiPopoverState();
    }
    const result = this.currentAiPromptResult;
    if (!result || !result.prompt || result.questionCount === 0) return;

    const ok = await this.writeClipboardText(result.prompt);
    const popover = this.sheetElement.querySelector("#saq-ai-popover");
    const liveStatus = popover?.querySelector("[data-ai-live-status]");
    const copyBtn = popover?.querySelector("[data-act='ai-copy-confirm']");

    if (this.aiCopyTimer) {
      clearTimeout(this.aiCopyTimer);
      this.aiCopyTimer = null;
    }

    if (ok) {
      if (liveStatus) {
        liveStatus.dataset.tone = "success";
        liveStatus.innerHTML = `${ICONS.check}<span>Copied to clipboard</span>`;
        liveStatus.classList.add("is-visible");
      }
      if (copyBtn) {
        copyBtn.classList.add("is-copied");
        copyBtn.innerHTML = `${ICONS.check}<span>Copied to clipboard</span>`;
      }
      this.aiCopyTimer = setTimeout(() => {
        if (liveStatus) {
          liveStatus.classList.remove("is-visible");
          liveStatus.innerHTML = "";
        }
        if (copyBtn) {
          copyBtn.classList.remove("is-copied");
          copyBtn.innerHTML = `${ICONS.copy}<span>Copy Prompt to Clipboard</span>`;
        }
      }, 2500);
    } else {
      if (liveStatus) {
        liveStatus.dataset.tone = "error";
        liveStatus.innerHTML = `${ICONS.cross}<span>Copy failed — select from Preview below</span>`;
        liveStatus.classList.add("is-visible");
      }
      if (!this.aiPreviewExpanded) {
        this.toggleAiPreview();
      }
    }
  }
  /* @extension-only-end */

  wireDrag(grip, sheet) {
    if (!grip) return;

    this.boundPointerMove = (e) => {
      if (!this.dragStart) return;
      const dy = Math.max(0, e.clientY - this.dragStart.y);
      sheet.style.transform = `translateY(${dy}px)`;
      if (this.backdropElement) {
        this.backdropElement.style.opacity = String(Math.max(0, 1 - dy / (window.innerHeight * 0.6)));
      }
    };

    this.boundPointerUp = (e) => {
      if (!this.dragStart) return;
      const dy = Math.max(0, e.clientY - this.dragStart.y);
      const velocity = dy / Math.max(1, Date.now() - this.dragStart.t);

      grip.releasePointerCapture?.(e.pointerId);
      grip.removeEventListener("pointermove", this.boundPointerMove);
      grip.removeEventListener("pointerup", this.boundPointerUp);

      sheet.classList.remove("is-dragging");
      sheet.style.transform = "";
      if (this.backdropElement) {
        this.backdropElement.style.opacity = "";
      }

      this.dragStart = null;
      if (dy > 140 || velocity > 0.55) {
        this.dismiss();
      }
    };

    grip.addEventListener("pointerdown", (e) => {
      if (e.button) return;
      this.dragStart = { y: e.clientY, t: Date.now() };
      sheet.classList.add("is-dragging");
      grip.setPointerCapture?.(e.pointerId);
      grip.addEventListener("pointermove", this.boundPointerMove);
      grip.addEventListener("pointerup", this.boundPointerUp);
    });
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
    this.closeAiPopover({ restoreFocus: false });
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
    this.stopClock();
    this.clearStatus();
    if (this.aiCopyTimer) {
      clearTimeout(this.aiCopyTimer);
      this.aiCopyTimer = null;
    }
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
