/** Shared Reader interaction behavior. */

export function handleReaderKeyDown(e) {
  if (!this.sheetElement || !this.isOpen()) return;

  if (this.runReaderFeatureHook("handleKeydown", e)) return;
  if (e.key !== "Tab") return;

  const focusables = Array.from(
    this.sheetElement.querySelectorAll(
      "button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"
    )
  ).filter((el) => {
    if (el.hasAttribute("disabled")) return false;
    if (el.closest?.("[hidden]")) return false;
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
  } else if (active === last) {
    e.preventDefault();
    first.focus?.();
  }
}

export function handleReaderActionClick(e) {
  if (this.runReaderFeatureHook("handleActionClick", e)) return;

  const btn = e.target.closest?.("[data-act]");
  if (!btn || btn.hasAttribute("disabled") || btn.classList.contains("is-busy")) return;

  e.preventDefault();
  const action = btn.dataset.act;

  if (action === "refresh") {
    this.closeAiPopover?.({ restoreFocus: false });
    if (this.onRefreshCallback) this.onRefreshCallback();
  } else if (action === "export-md") {
    this.closeAiPopover?.({ restoreFocus: false });
    if (this.onExportCallback) this.onExportCallback("markdown");
  } else if (action === "print") {
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
    this.closeAiPopover?.({ restoreFocus: false });
    if (this.onExportCallback) this.onExportCallback("bundle");
  } else if (action === "theme") {
    const next = this.shadowHost.toggleTheme?.() || "light";
    btn.setAttribute("aria-pressed", next === "dark" ? "true" : "false");
    if (this.onThemeCallback) this.onThemeCallback(next);
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
