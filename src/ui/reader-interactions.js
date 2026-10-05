/** Shared Reader interaction behavior. */

const ZOOM_STEPS = [0.8, 0.9, 1.0, 1.15, 1.3, 1.5];

export function handleReaderKeyDown(e) {
  if (!this.sheetElement || !this.isOpen()) return;

  if (this.runReaderFeatureHook("handleKeydown", e)) return;

  if (e.key === "Escape") {
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

  const splitGroup = this.sheetElement?.querySelector("#saq-export-split");
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
  } else if (action === "refresh") {
    if (exportMenu) {
      exportMenu.hidden = true;
      exportMenu.setAttribute("hidden", "");
      if (splitArrow) splitArrow.setAttribute("aria-expanded", "false");
    }
    this.closeAiPopover?.({ restoreFocus: false });
    if (this.onRefreshCallback) this.onRefreshCallback();
  } else if (action === "export-md") {
    if (exportMenu) {
      exportMenu.hidden = true;
      exportMenu.setAttribute("hidden", "");
      if (splitArrow) splitArrow.setAttribute("aria-expanded", "false");
    }
    this.closeAiPopover?.({ restoreFocus: false });
    if (this.onExportCallback) this.onExportCallback("markdown");
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
