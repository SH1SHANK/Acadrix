/** Shared Reader interaction behavior. */
import {
  formatProgrammingPrompt,
  serializeProgrammingPrompt,
  copyQuestion,
  copyTestCases,
  copyCurrentCode,
  copyAiContext,
  copyFullAssignment,
} from "../bridge/prompt.js";


const ZOOM_STEPS = [0.8, 0.9, 1.0, 1.15, 1.3, 1.5];

function importProgrammingCode(reader) {
  const editor = reader.programmingEditor;
  if (!editor) return;
  const readClipboard = typeof navigator !== "undefined" ? navigator.clipboard?.readText : null;
  const pasteFromEditor = () => {
    editor.editorView?.focus();
    reader.notify?.("Clipboard access is unavailable. Paste with ⌘V in the code editor.", "info", 4000);
  };
  if (typeof readClipboard === "function") {
    Promise.resolve().then(() => readClipboard.call(navigator)).then((text) => {
      if (!String(text ?? "").trim()) {
        editor.importCode(String(text ?? ""));
        editor.editorView?.focus();
        return;
      }
      const result = editor.importCode(String(text));
      if (result.ok) reader.notify?.(result.mode === "merge" ? `Updated ${result.count} function(s) in the editor` : "Code imported into the editor", "success", 2500);
    }).catch(pasteFromEditor);
  } else pasteFromEditor();
}

function confirmRefresh(reader) {
  const root = reader.shadowHost?.root;
  if (!root) return;
  const returnFocus = root.activeElement;
  root.querySelector("[data-refresh-dialog]")?.remove();
  const dialog = document.createElement("div");
  dialog.className = "saq-dialog-modal";
  dialog.dataset.refreshDialog = "";
  dialog.setAttribute("role", "alertdialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "saq-refresh-title");
  dialog.innerHTML = `<div class="saq-dialog-backdrop"></div><div class="saq-dialog-content"><div class="saq-dialog-head"><h2 class="saq-dialog-title" id="saq-refresh-title">Discard editor changes?</h2></div><div class="saq-dialog-body"><p id="saq-refresh-description">Your unsaved code will be discarded when the assignment reloads.</p></div><div class="saq-dialog-footer"><button type="button" class="saq-btn saq-btn-secondary" data-refresh-cancel>Cancel</button><button type="button" class="saq-btn saq-btn-primary" data-refresh-confirm>Refresh</button></div></div></div>`;
  dialog.setAttribute("aria-describedby", "saq-refresh-description");
  const close = () => {
    dialog.remove();
    returnFocus?.focus?.();
  };
  dialog.querySelector("[data-refresh-cancel]").addEventListener("click", close);
  dialog.querySelector(".saq-dialog-backdrop").addEventListener("click", close);
  dialog.querySelector("[data-refresh-confirm]").addEventListener("click", () => {
    close();
    refreshReader(reader);
  });
  dialog.addEventListener("keydown", (event) => {
    const actions = [...dialog.querySelectorAll("button:not(:disabled)")];
    const active = root.activeElement;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dialog.querySelector("[data-refresh-cancel]")?.click();
    } else if (event.key === "Tab" && actions.length) {
      if (!dialog.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? actions.at(-1) : actions[0]).focus();
      } else if (event.shiftKey && active === actions[0]) {
        event.preventDefault();
        actions.at(-1).focus();
      } else if (!event.shiftKey && active === actions.at(-1)) {
        event.preventDefault();
        actions[0].focus();
      }
    }
  });
  root.appendChild(dialog);
  dialog.querySelector("[data-refresh-cancel]").focus();
}

function refreshReader(reader) {
  const exportMenu = reader.sheetElement?.querySelector("#saq-export-menu");
  const splitArrow = reader.sheetElement?.querySelector("[data-act='toggle-export-menu']");
  if (exportMenu) {
    exportMenu.hidden = true;
    exportMenu.setAttribute("hidden", "");
    splitArrow?.setAttribute("aria-expanded", "false");
  }
  reader.closeAiPopover?.({ restoreFocus: false });
  reader.onRefreshCallback?.();
}

export function handleReaderKeyDown(e) {
  if (!this.sheetElement || !this.isOpen()) return;

  if (this.runReaderFeatureHook("handleKeydown", e)) return;

  if (e.key === "Escape") {

    const refreshDialog = this.shadowHost?.root?.querySelector("[data-refresh-dialog]");
    if (refreshDialog) {
      e.preventDefault();
      e.stopPropagation();
      refreshDialog.querySelector("[data-refresh-cancel]")?.click();
      return;
    }

    if (this.isLightboxOpen?.()) {
      e.preventDefault();
      e.stopPropagation();
      this.closeLightbox?.();
      return;
    }
    const exportMenu = this.sheetElement.querySelector("#saq-export-menu");
    const splitArrow = this.sheetElement.querySelector("[data-act='toggle-export-menu']");
    if (exportMenu && !exportMenu.hasAttribute("hidden") && !exportMenu.hidden) {
      e.preventDefault();
      e.stopPropagation();
      exportMenu.hidden = true;
      exportMenu.setAttribute("hidden", "");
      if (splitArrow) splitArrow.setAttribute("aria-expanded", "false");
      splitArrow?.focus?.();
      return;
    }
  }

  // Zoom Keyboard Shortcuts: Ctrl/Cmd + Plus/Minus/0
  if (e.metaKey || e.ctrlKey) {
    if (e.key === "=" || e.key === "+") {
      e.preventDefault();
      const cur = this.getZoom?.() || 1.0;
      const idx = ZOOM_STEPS.findIndex((s) => s >= cur - 0.01);
      const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, (idx >= 0 ? idx : 2) + 1)];
      this.setZoom?.(next);
      return;
    }
    if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      const cur = this.getZoom?.() || 1.0;
      const idx = ZOOM_STEPS.findIndex((s) => s >= cur - 0.01);
      const prev = ZOOM_STEPS[Math.max(0, (idx >= 0 ? idx : 2) - 1)];
      this.setZoom?.(prev);
      return;
    }
    if (e.key === "0") {
      e.preventDefault();
      this.setZoom?.(1.0);
      return;
    }
  }

  if (e.defaultPrevented || e.key !== "Tab") return;

  const activeDialog = this.shadowHost?.root?.querySelector(".saq-dialog-modal:not([hidden])");
  const focusScope = activeDialog || this.sheetElement;
  const focusables = Array.from(
    focusScope.querySelectorAll(
      "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex='-1'])"
    )
  ).filter((el) => {
    if (el.closest?.("[hidden], [inert], [aria-hidden='true']")) return false;
    if (el.getClientRects && el.getClientRects().length === 0) return false;
    return true;
  });

  if (focusables.length === 0) return;

  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = this.shadowHost.root?.activeElement;
  const activeIsInScope = focusScope.contains(active);

  if (!activeIsInScope) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus?.();
  } else if (e.shiftKey && (active === first || active === this.sheetElement || !active)) {
    e.preventDefault();
    last.focus?.();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus?.();
  }
}

export function handleReaderActionClick(e) {
  if (this.runReaderFeatureHook("handleActionClick", e)) return;

  // Image & Diagram Click -> Open Expand View Lightbox
  const expandImgTrigger = e.target.closest?.("img, .saq-svg-wrap, [data-act='expand-image']");
  if (expandImgTrigger && !e.target.closest?.("button:not([data-act='expand-image']), a, input, textarea")) {
    const img = expandImgTrigger.tagName === "IMG" ? expandImgTrigger : expandImgTrigger.querySelector?.("img");
    const svgWrap = expandImgTrigger.classList?.contains("saq-svg-wrap") ? expandImgTrigger : expandImgTrigger.querySelector?.(".saq-svg-wrap");
    if (img && img.src && !img.closest?.(".saq-lightbox")) {
      e.preventDefault();
      e.stopPropagation();
      const figure = img.closest?.("figure");
      const caption = figure?.querySelector?.("figcaption")?.textContent || img.title || "";
      this.openLightbox?.({ src: img.src, alt: img.alt || caption, caption });
      return;
    }
    if (svgWrap && !svgWrap.closest?.(".saq-lightbox")) {
      e.preventDefault();
      e.stopPropagation();
      const figure = svgWrap.closest?.("figure");
      const caption = figure?.querySelector?.("figcaption")?.textContent || "";
      this.openLightbox?.({ svgHtml: svgWrap.innerHTML, alt: caption || "Diagram", caption });
      return;
    }
  }

  const splitGroup = this.sheetElement?.querySelector("#saq-export-split, .saq-dropdown-wrap");
  const exportMenu = this.sheetElement?.querySelector("#saq-export-menu");
  const splitArrow = this.sheetElement?.querySelector("[data-act='toggle-export-menu']");
  if (exportMenu && !exportMenu.hasAttribute("hidden") && !exportMenu.hidden && splitGroup && !splitGroup.contains(e.target)) {
    exportMenu.hidden = true;
    exportMenu.setAttribute("hidden", "");
    if (splitArrow) splitArrow.setAttribute("aria-expanded", "false");
  }

  const btn = e.target.closest?.("[data-act]");
  if (!btn || btn.hasAttribute("disabled") || btn.classList.contains("is-busy")) return;

  e.preventDefault();
  const action = btn.dataset.act;

  // Lightbox Controls
  if (action === "close-lightbox") {
    this.closeLightbox?.();
    return;
  }
  if (action === "lightbox-zoom-in") {
    const vp = this.shadowHost?.root?.querySelector("#saq-lightbox-viewport");
    if (vp) {
      const cur = Number(vp.dataset.zoom || 1);
      const next = Math.min(3, cur + 0.25);
      vp.dataset.zoom = String(next);
      vp.style.transform = `scale(${next})`;
    }
    return;
  }
  if (action === "lightbox-zoom-out") {
    const vp = this.shadowHost?.root?.querySelector("#saq-lightbox-viewport");
    if (vp) {
      const cur = Number(vp.dataset.zoom || 1);
      const next = Math.max(0.5, cur - 0.25);
      vp.dataset.zoom = String(next);
      vp.style.transform = `scale(${next})`;
    }
    return;
  }
  if (action === "lightbox-zoom-reset") {
    const vp = this.shadowHost?.root?.querySelector("#saq-lightbox-viewport");
    if (vp) {
      vp.dataset.zoom = "1";
      vp.style.transform = "scale(1)";
    }
    return;
  }

  // Text Zoom Controls
  if (action === "zoom-in") {
    const cur = this.getZoom?.() || 1.0;
    const idx = ZOOM_STEPS.findIndex((s) => s >= cur - 0.01);
    const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, (idx >= 0 ? idx : 2) + 1)];
    this.setZoom?.(next);
    return;
  }
  if (action === "zoom-out") {
    const cur = this.getZoom?.() || 1.0;
    const idx = ZOOM_STEPS.findIndex((s) => s >= cur - 0.01);
    const prev = ZOOM_STEPS[Math.max(0, (idx >= 0 ? idx : 2) - 1)];
    this.setZoom?.(prev);
    return;
  }
  if (action === "zoom-reset") {
    this.setZoom?.(1.0);
    return;
  }

  if (action === "toggle-export-menu") {
    if (exportMenu) {
      const isExpanded = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!isExpanded));
      exportMenu.hidden = isExpanded;
      if (isExpanded) {
        exportMenu.setAttribute("hidden", "");
      } else {
        exportMenu.removeAttribute("hidden");
        exportMenu.querySelector(".saq-dropdown-item")?.focus?.();
      }
    }
  } else if (action === "apply-programming-code") {
    this.programmingEditor?.applyChanges?.();
  } else if (action === "refresh") {
    if (this.programmingEditor?.isModified()) {
      confirmRefresh(this);
    } else {
      refreshReader(this);
    }
  } else if (action === "export-md" || action === "export-txt") {
    if (exportMenu) {
      exportMenu.hidden = true;
      exportMenu.setAttribute("hidden", "");
      if (splitArrow) splitArrow.setAttribute("aria-expanded", "false");
    }
    this.closeAiPopover?.({ restoreFocus: false });
    if (this.onExportCallback) this.onExportCallback(action === "export-md" ? "markdown" : "text");
  } else if (action === "print") {
    if (exportMenu) {
      exportMenu.hidden = true;
      exportMenu.setAttribute("hidden", "");
      if (splitArrow) splitArrow.setAttribute("aria-expanded", "false");
    }
    this.closeAiPopover?.({ restoreFocus: false });
    if (this.onExportCallback) {
      this.onExportCallback("pdf");
    } else if (typeof exportPdf === "function" && this.documentModel) {
      exportPdf(this.documentModel, {
        onFallback: () => this.setPdfFallbackMode?.(true),
      }).catch((err) => {
        console.error("[Acadrix] PDF export failed, falling back to window.print():", err);
        this.setPdfFallbackMode?.(true);
        this.printFallbackWithTitle(this.documentModel);
      });
    } else {
      this.printFallbackWithTitle(this.documentModel);
    }
  } else if (action === "export-bundle") {
    if (exportMenu) {
      exportMenu.hidden = true;
      exportMenu.setAttribute("hidden", "");
      if (splitArrow) splitArrow.setAttribute("aria-expanded", "false");
    }
    this.closeAiPopover?.({ restoreFocus: false });
    if (this.onExportCallback) this.onExportCallback("bundle");
  } else if (action === "theme") {
    const next = this.shadowHost.toggleTheme?.() || "light";
    btn.setAttribute("aria-pressed", next === "dark" ? "true" : "false");
    if (this.onThemeCallback) this.onThemeCallback(next);
  } else if (action === "copy-problem" || action === "copy-question") {
    const text = copyQuestion(this.documentModel);
    const write = this.writeClipboardText ? this.writeClipboardText(text) : navigator.clipboard?.writeText?.(text);
    Promise.resolve(write).then(() => {
      this.notify?.("Problem statement copied", "success", 2500);
    }).catch(() => {
      this.notify?.("Failed to copy problem", "error", 2500);
    });
  } else if (action === "copy-testcases") {
    const text = copyTestCases(this.documentModel);
    const write = this.writeClipboardText ? this.writeClipboardText(text) : navigator.clipboard?.writeText?.(text);
    Promise.resolve(write).then(() => {
      this.notify?.("Test cases copied", "success", 2500);
    }).catch(() => {
      this.notify?.("Failed to copy test cases", "error", 2500);
    });
  } else if (action === "copy-current-code" || action === "copy-code") {
    const editorCode = this.programmingEditor?.getFullCode?.();
    const pData = this.documentModel?.questions?.[0]?.programmingData || {};
    const text = editorCode ?? [
      pData.prefixCode,
      pData.currentCode ?? pData.starterCode ?? copyCurrentCode(this.documentModel),
      pData.suffixCode,
    ].filter((part) => part !== null && part !== undefined).join("\n");
    const write = this.writeClipboardText ? this.writeClipboardText(text) : navigator.clipboard?.writeText?.(text);
    Promise.resolve(write).then(() => {
      this.notify?.("Current code copied", "success", 2500);
    }).catch(() => {
      this.notify?.("Failed to copy current code", "error", 2500);
    });
  } else if (action === "import-code") {
    importProgrammingCode(this);
  } else if (action === "copy-prompt-context" || action === "copy-prompt") {
    const text = copyAiContext(this.documentModel, { editableCode: this.programmingEditor?.getCode?.() });
    const write = this.writeClipboardText ? this.writeClipboardText(text) : navigator.clipboard?.writeText?.(text);
    Promise.resolve(write).then(() => {
      this.notify?.("AI context prompt copied", "success", 2500);
    }).catch(() => {
      this.notify?.("Failed to copy AI prompt", "error", 2500);
    });
  } else if (action === "copy-full-assignment") {
    const text = copyFullAssignment(this.documentModel);
    const write = this.writeClipboardText ? this.writeClipboardText(text) : navigator.clipboard?.writeText?.(text);
    Promise.resolve(write).then(() => {
      this.notify?.("Full assignment Markdown copied", "success", 2500);
    }).catch(() => {
      this.notify?.("Failed to copy assignment", "error", 2500);
    });
  } else if (action === "dismiss") {
    this.dismiss();
  }
}


export function wireReaderDrag(grip, sheet) {
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
    if (dy > 140 || velocity > 0.55) this.dismiss();
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
