/** Extension-only Reader feature: Copy for AI and direct-PDF fallback state. */

import { ICONS } from "./icons.js";
import { escapeHtml } from "../utils/dom.js";
import { generateAiPrompt } from "../bridge/prompt.js";
import { createReaderImportFeature } from "./reader-import.js";

function createReaderAiBaseFeature(reader) {
  return {
    renderHeaderActions({ sheet, documentModel }) {
      const actions = sheet.querySelector(".saq-export-group");
      const header = sheet.querySelector(".saq-header");
      if (!actions || !header || typeof generateAiPrompt !== "function") return;

      actions.innerHTML =
        `<button type="button" class="saq-btn saq-btn-export" data-act="copy-ai" aria-label="Copy for AI" aria-expanded="false" aria-controls="saq-ai-popover" title="Copy prompt for AI chat">${ICONS.copy}<span>Copy for AI</span></button>` +
        actions.innerHTML;
      const popoverContainer = document.createElement("div");
      popoverContainer.innerHTML = reader.buildAiPopoverHtml(documentModel);
      const popover = popoverContainer.firstElementChild || popoverContainer.children?.[0];
      if (popover) header.parentNode.appendChild(popover);
      reader.wireAiPopover(sheet);
    },

    handleActionClick(e) {
      const btn = e.target.closest?.("[data-act]");
      const popover = reader.sheetElement?.querySelector("#saq-ai-popover");

      if (!btn || btn.hasAttribute("disabled") || btn.classList.contains("is-busy")) {
        if (reader.isAiPopoverOpen() && popover && !popover.contains(e.target)) {
          reader.closeAiPopover({ restoreFocus: false });
        }
        return false;
      }

      const action = btn.dataset.act;
      if (action === "copy-ai") {
        e.preventDefault();
        reader.toggleAiPopover();
        return true;
      }
      if (action === "ai-close") {
        e.preventDefault();
        reader.closeAiPopover();
        return true;
      }
      if (action === "ai-preview-toggle") {
        e.preventDefault();
        reader.toggleAiPreview();
        return true;
      }
      if (action === "ai-copy-confirm") {
        e.preventDefault();
        reader.copyAiPrompt();
        return true;
      }
      if (action === "ai-save-pdf") {
        e.preventDefault();
        reader.saveAiPdf();
        return true;
      }

      return false;
    },

    handleKeydown(e) {
      if (e.key !== "Escape" || !reader.isAiPopoverOpen()) return false;
      e.preventDefault();
      e.stopPropagation();
      reader.closeAiPopover();
      return true;
    },

    documentChange() {
      reader.updateAiPopoverState();
    },

    destroy() {
      if (reader.aiCopyTimer) {
        clearTimeout(reader.aiCopyTimer);
        reader.aiCopyTimer = null;
      }
    },
  };
}

export function createReaderAiFeature(reader) {
  const ai = createReaderAiBaseFeature(reader);
  const importer = typeof createReaderImportFeature === "function" ? createReaderImportFeature(reader) : null;
  return {
    renderHeaderActions(payload) {
      ai.renderHeaderActions(payload);
      importer?.renderHeaderActions(payload);
    },
    handleActionClick(event) {
      if (ai.handleActionClick(event) === true) return true;
      return importer?.handleActionClick(event) === true;
    },
    handleKeydown(event) {
      if (ai.handleKeydown(event) === true) return true;
      return importer?.handleKeydown(event) === true;
    },
    documentChange(payload) {
      ai.documentChange(payload);
      importer?.documentChange(payload);
    },
    destroy(payload) {
      ai.destroy(payload);
      importer?.destroy(payload);
    },
    isDirectPdfAvailable: ai.isDirectPdfAvailable,
  };
}

export function attachReaderAiFeatures(ReaderDrawer) {
  // ReaderDrawer.prototype.build() explicitly executes this.destroy() at line 99 to tear
  // down existing DOM before assembling the new sheet. Without this flag, build()'s internal
  // DOM cleanup would wipe memory-held answer keys before documentChange could inspect
  // whether the newly built document has the same or different fingerprint. Genuine teardown
  // (runtime.destroy() or reader.destroy()) leaves _readerRebuilding false, ensuring answers
  // are wiped upon destruction.
  if (!ReaderDrawer.prototype.__aiBuildWrapped) {
    const originalBuild = ReaderDrawer.prototype.build;
    ReaderDrawer.prototype.build = function (...args) {
      this._readerRebuilding = true;
      try {
        return originalBuild.apply(this, args);
      } finally {
        this._readerRebuilding = false;
      }
    };
    ReaderDrawer.prototype.__aiBuildWrapped = true;
  }
  Object.assign(ReaderDrawer.prototype, {
    isDirectPdfAvailable() {
      if (this.pdfDirectFallbackActive) return false;
      return typeof chrome !== "undefined" && typeof chrome?.runtime?.sendMessage === "function";
    },

    setPdfFallbackMode(isFallback) {
      this.pdfDirectFallbackActive = Boolean(isFallback);
      this.runReaderFeatureHook("documentChange", { reason: "pdf-fallback" });
    },

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
    },

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
        this.aiScopeState.start = Math.min(Math.max(this.aiScopeState.start || minQ, minQ), maxQ);
        this.aiScopeState.end = Math.min(Math.max(this.aiScopeState.end || maxQ, this.aiScopeState.start), maxQ);
        this.aiScopeState.single = Math.min(Math.max(this.aiScopeState.single || defaultSingle, minQ), maxQ);
      }
      return this.aiScopeState;
    },

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
      </aside>`;
    },

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
    },

    isAiPopoverOpen() {
      const popover = this.sheetElement?.querySelector("#saq-ai-popover");
      return Boolean(popover && popover.classList.contains("is-open") && !popover.hasAttribute("hidden")) || Boolean(this._readerImportFeature?.isOpen());
    },

    toggleAiPopover() {
      if (this.isAiPopoverOpen()) this.closeAiPopover();
      else this.openAiPopover();
    },

    openAiPopover() {
      if (!this.sheetElement || typeof generateAiPrompt !== "function") return;
      const popover = this.sheetElement.querySelector("#saq-ai-popover");
      const trigger = this.sheetElement.querySelector("[data-act='copy-ai']");
      if (!popover) return;

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

      const checkedRadio =
        popover.querySelector(`input[name='saq-ai-scope'][value='${this.aiScopeState?.type || "all"}']`) ||
        popover.querySelector("input[name='saq-ai-scope']") ||
        popover.querySelector("[data-act='ai-copy-confirm']");
      if (checkedRadio && typeof checkedRadio.focus === "function") {
        try { checkedRadio.focus({ preventScroll: true }); } catch { checkedRadio.focus(); }
      }
    },

    closeAiPopover({ restoreFocus = true } = {}) {
      if (this._readerImportFeature?.isOpen()) this._readerImportFeature.close({ restoreFocus });
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
          try { trigger.focus({ preventScroll: true }); } catch { trigger.focus(); }
        }
      }
    },

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
        if (this.aiPreviewExpanded) pre.removeAttribute("hidden");
        else pre.setAttribute("hidden", "");
      }
    },

    resolveValidatedScope() {
      const { minQ, maxQ, extractedCount } = this.getQuestionBounds();
      const state = this.ensureAiScopeState();
      const popover = this.sheetElement?.querySelector("#saq-ai-popover");

      if (extractedCount === 0) return { valid: false, error: "No questions available to export.", scope: { type: "all" } };
      if (state.type === "all") return { valid: true, error: "", scope: { type: "all" } };

      if (state.type === "range") {
        const startInput = popover?.querySelector("[data-ai-input='start']");
        const endInput = popover?.querySelector("[data-ai-input='end']");
        const rawStart = startInput ? (startInput.value ?? startInput.getAttribute("value")) : state.start;
        const rawEnd = endInput ? (endInput.value ?? endInput.getAttribute("value")) : state.end;
        const start = parseInt(String(rawStart), 10);
        const end = parseInt(String(rawEnd), 10);
        if (isNaN(start) || isNaN(end) || start < minQ || end < minQ || start > maxQ || end > maxQ || start > end) {
          return { valid: false, error: `Range must satisfy ${minQ} ≤ start ≤ end ≤ ${maxQ}.`, scope: null };
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
          return { valid: false, error: `Question number must be between ${minQ} and ${maxQ}.`, scope: null };
        }
        state.single = num;
        return { valid: true, error: "", scope: { type: "single", number: num } };
      }

      return { valid: true, error: "", scope: { type: "all" } };
    },

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

      if (previewEl) previewEl.textContent = result.prompt;
    },

    getScopedDocument(scope) {
      if (!this.documentModel || !scope || scope.type === "all") return this.documentModel;
      const allQuestions = this.documentModel.questions || [];
      let questions = allQuestions;
      if (scope.type === "single" && typeof scope.number === "number") {
        questions = allQuestions.filter((q) => q.number === scope.number);
      } else if (scope.type === "range" && typeof scope.start === "number" && typeof scope.end === "number") {
        const min = Math.min(scope.start, scope.end);
        const max = Math.max(scope.start, scope.end);
        questions = allQuestions.filter((q) => q.number >= min && q.number <= max);
      }
      return {
        ...this.documentModel,
        length: questions.length,
        metadata: { ...(this.documentModel.metadata || {}), totalQuestions: questions.length },
        questions,
      };
    },

    saveAiPdf() {
      if (!this.sheetElement || !this.documentModel) return;
      const { valid, scope } = this.resolveValidatedScope();
      if (!valid || !scope) return;
      const scopedDoc = this.getScopedDocument(scope);
      if (!scopedDoc?.questions?.length) return;

      if (this.onExportCallback) {
        this.onExportCallback("pdf", { document: scopedDoc, includeReviewData: false, includeInteractionState: false });
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
    },

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
    },

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
        } catch { return false; }
      };

      try {
        if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          const promise = navigator.clipboard.writeText(text);
          if (promise && typeof promise.then === "function") return promise.then(() => true, () => execFallback());
          return Promise.resolve(true);
        }
      } catch { return Promise.resolve(execFallback()); }

      return Promise.resolve(execFallback());
    },

    async copyAiPrompt() {
      if (!this.sheetElement) return;
      if (!this.currentAiPromptResult) this.updateAiPopoverState();
      const result = this.currentAiPromptResult;
      if (!result?.prompt || result.questionCount === 0) return;

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
        if (!this.aiPreviewExpanded) this.toggleAiPreview();
      }
    },
  });
}
