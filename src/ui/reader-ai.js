/**
 * Extension-only Reader AI & Import Bridge.
 * Delegates active Reader actions and review workflows to createReaderImportFeature.
 */

import { createReaderImportFeature } from "./reader-import.js";

export function createReaderAiFeature(reader) {
  return createReaderImportFeature(reader);
}

export function attachReaderAiFeatures(ReaderDrawer) {
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
      if (this.directPdfEnabled === false) return false;
      return typeof chrome !== "undefined" && typeof chrome?.runtime?.sendMessage === "function";
    },

    setPdfFallbackMode(isFallback) {
      this.pdfDirectFallbackActive = Boolean(isFallback);
      this.runReaderFeatureHook("documentChange", { reason: "pdf-fallback" });
    },

    isAiPopoverOpen() {
      return Boolean(this._readerImportFeature?.isOpen());
    },

    closeAiPopover({ restoreFocus = true } = {}) {
      if (this._readerImportFeature?.isOpen()) {
        this._readerImportFeature.close({ restoreFocus });
      }
    },

    writeClipboardText(text) {
      const execFallback = () => {
        try {
          const prevFocused = this.rootNode?.activeElement || (typeof document !== "undefined" ? document.activeElement : null);
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
            return promise.then(() => true, () => execFallback());
          }
          return Promise.resolve(true);
        }
      } catch {
        return Promise.resolve(execFallback());
      }

      return Promise.resolve(execFallback());
    },
  });
}
