/**
 * Unfold Runtime Controller.
 * Coordinates detection, lifecycle, traversal, extraction, and Shadow DOM UI.
 */

import { debounce } from "../utils/timing.js";
import { shortcutFromEvent, isTypingTarget } from "../utils/shortcut.js";
import { Lifecycle, LifecycleState } from "./lifecycle.js";
import { portalAdapter } from "../portal/adapter.js";
import { AssessmentExtractor } from "../extraction/extractor.js";
import { QuestionTraverser } from "../traversal/traverser.js";
import { AssignmentAssembler } from "../model/assembler.js";
import { buildExportFilename } from "../model/document.js";
import { ShadowHost } from "../ui/shadow.js";
import { LauncherButton } from "../ui/launcher.js";
import { ProgressOverlay } from "../ui/overlay.js";
import { ReaderDrawer } from "../ui/reader.js";
import { ExportOrchestrator } from "../orchestration/orchestrator.js";

const DEFAULT_SHORTCUT = "Alt+Q";

export class UnfoldRuntime {
  constructor({ css = "", extractor = null } = {}) {
    this.portal = portalAdapter;
    const ExtractorClass =
      typeof SemanticExtractor !== "undefined"
        ? SemanticExtractor
        : AssessmentExtractor;
    this.extractor = extractor || new ExtractorClass(this.portal);
    this.traverser = new QuestionTraverser(this.portal);
    this.lifecycle = new Lifecycle();

    this.shadowHost = new ShadowHost("unfold-root", css);
    this.launcher = new LauncherButton(this.shadowHost);
    this.overlay = new ProgressOverlay(this.shadowHost);
    this.reader = new ReaderDrawer(this.shadowHost, this.portal);
    this.orchestrator =
      typeof ExportOrchestrator !== "undefined"
        ? new ExportOrchestrator(this)
        : null;

    // Configuration state
    this.config = {
      enabled: true,
      autoLauncher: true,
      compact: false,
      openShortcutEnabled: true,
      openShortcut: DEFAULT_SHORTCUT,
      launcherPos: "bottom-center",
      theme: "system",
    };

    this.observer = null;
    this.boundKeydown = null;
    this.activeDocument = null;
    this.activeContextKey = null;
    this.isDestroyed = false;
/* @extension-only-start */
    this.config.readerTextSize = "default";
    this.config.directPdfEnabled = true;
    if (typeof window !== "undefined") {
      window.__saqVersion = "__SAQ_VERSION__";
      window.__saqStatus = () => ({
        assessment: Boolean(this.portal?.detectAssessment?.()),
        readerOpen: Boolean(this.reader?.isOpen?.()),
      });
    }
/* @extension-only-end */  }

  getContextKey() {
    const loc =
      typeof window !== "undefined" && window.location
        ? `${window.location.pathname || ""}${window.location.search || ""}`
        : "";
    const title = this.portal?.getAssessmentTitle?.() || "";
    const total = this.portal?.getTotalQuestionCount?.() ?? "";
    const review = Boolean(this.portal?.isReviewMode?.());
    return `${loc}::${title}::${total}::${review}`;
  }

  updateContextKey() {
    this.activeContextKey = this.getContextKey();
  }

  invalidateDocument() {
    this.activeDocument = null;
    this.activeContextKey = null;
  }

  initialize() {
    this.isDestroyed = false;
    this.lifecycle.transition(LifecycleState.IDLE);

    // 1. Load preferences
    this.loadSettings();

    // 2. Attach global keyboard shortcut
    this.boundKeydown = (e) => this.handleKeydown(e);
    document.addEventListener("keydown", this.boundKeydown, true);

    // 3. Lifecycle-managed mutation observer
    this.startObserver();

    // 4. Initial assessment check
    this.detect();
/* @extension-only-start */
    // 5. Extension portal decor initialization
    try {
      if (typeof initPortalDecor === "function") {
        this.portalDecor = initPortalDecor();
      }
    } catch (err) {
      console.error("[Acadrix Runtime] Portal decor initialization failed:", err);
    }
/* @extension-only-end */  }

  loadSettings() {
    try {
      if (typeof chrome !== "undefined" && chrome?.storage?.local) {
        chrome.storage.local.get(this.config, (items) => {
          Object.assign(this.config, items);
          this.applySettings();
          this.detect();
        });

        chrome.storage.onChanged?.addListener((changes) => {
          let needsDetect = false;
          for (const [key, change] of Object.entries(changes)) {
            if (key in this.config) {
              this.config[key] = change.newValue;
              if (key === "enabled" || key === "autoLauncher") needsDetect = true;
            }
          }
          this.applySettings();
          if (needsDetect) this.detect();
        });
      }
    } catch {
      // In page-world / bookmarklet context, chrome.storage is not available; defaults stick.
    }
  }

  applySettings() {
    this.shadowHost.setTheme?.(this.config.theme);
    this.launcher.setPosition(this.config.launcherPos);
    this.launcher.setShortcutHint(
      this.config.openShortcutEnabled && this.config.openShortcut
        ? this.config.openShortcut
        : "Shortcut disabled"
    );
    this.reader.setCompact(this.config.compact);
/* @extension-only-start */
    if (this.config.readerTextSize && typeof this.shadowHost.setTextSize === "function") {
      this.shadowHost.setTextSize(this.config.readerTextSize);
      if (this.reader?.sheetElement) {
        this.reader.sheetElement.setAttribute("data-text-size", this.config.readerTextSize);
      }
    }
    if (this.reader) {
      this.reader.directPdfEnabled = this.config.directPdfEnabled ?? true;
    }
/* @extension-only-end */
  }

  startObserver() {
    this.stopObserver();
    const debouncedDetect = debounce(() => this.detect(), 250);
    this.observer = new MutationObserver(debouncedDetect);
    this.observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  stopObserver() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  handleKeydown(e) {
    if (e.key === "Escape" && this.reader.isOpen()) {
      if (this.reader.isAiPopoverOpen?.()) {
        e.preventDefault();
        e.stopPropagation();
        this.reader.closeAiPopover();
        return;
      }
      this.close();
      return;
    }

    if (
      !this.config.enabled ||
      !this.config.openShortcutEnabled ||
      !this.config.openShortcut ||
      e.repeat ||
      isTypingTarget(e.target)
    ) {
      return;
    }

    if (shortcutFromEvent(e) === this.config.openShortcut && this.portal.detectAssessment()) {
      e.preventDefault();
      e.stopPropagation();
      this.open();
    }
  }

  detect() {
    if (!this.config.enabled) {
      this.orchestrator?.cancel();
      this.invalidateDocument();
      this.destroyUi();
      return;
    }

    const isAssessment = this.portal.detectAssessment();

    if (isAssessment) {
      if (
        this.activeDocument &&
        this.activeContextKey &&
        this.getContextKey() !== this.activeContextKey
      ) {
        this.orchestrator?.cancel();
        this.invalidateDocument();
        this.reader.destroy();
      }

      const isBusyOrOpen =
        this.lifecycle.state === LifecycleState.TRAVERSING ||
        this.lifecycle.state === LifecycleState.OPEN;

      if (!isBusyOrOpen) {
        this.lifecycle.transition(LifecycleState.ACTIVE);
      }
      this.shadowHost.ensure();
      this.launcher.ensure(this.config.launcherPos, () => this.open());

      if (this.config.autoLauncher && !this.reader.isOpen() && !isBusyOrOpen) {
        this.launcher.show();
      }
    } else {
      this.orchestrator?.cancel();
      this.invalidateDocument();
      if (this.launcher.element || this.reader.isMounted()) {
        this.destroyUi();
        this.lifecycle.transition(LifecycleState.IDLE);
      }
    }
  }

  async open() {
    if (this.lifecycle.state === LifecycleState.TRAVERSING) {
      return;
    }

    if (!this.portal.detectAssessment()) {
      alert("Open an IITM quiz or assessment with numbered question chips first.");
      return;
    }

    if (this.reader.isOpen() && this.activeDocument) {
      this.reader.show();
      return;
    }

    if (
      this.activeDocument &&
      this.activeContextKey &&
      this.getContextKey() !== this.activeContextKey
    ) {
      this.invalidateDocument();
      this.reader.destroy();
    }

    if (this.reader.isMounted() && this.activeDocument && !this.reader.isOpen()) {
      this.launcher.setExpanded?.(true);
      this.launcher.hide();
      this.reader.show();
      this.lifecycle.transition(LifecycleState.OPEN);
      return;
    }

    await this.refresh();
  }

  /**
   * Dismisses the Reader drawer UI.
   * Policy A (Background Completion): Dismissing the Reader drawer while an export is in flight
   * closes the drawer and restores the launcher pill without aborting the active export download.
   * When the export finishes, button busy state resets cleanly.
   */
  close() {
    this.reader.dismiss();
    this.launcher.setExpanded?.(false);
    if (this.portal.detectAssessment() && this.config.autoLauncher) {
      this.launcher.show();
      this.launcher.focus?.();
    }
    this.lifecycle.transition(LifecycleState.ACTIVE);
  }

  async refresh() {
    if (this.lifecycle.state === LifecycleState.TRAVERSING) {
      return;
    }

    // Invalidate any cached document immediately when a new extraction begins
    this.invalidateDocument();
    this.lifecycle.transition(LifecycleState.TRAVERSING);
    this.launcher.setExpanded?.(true);
    this.launcher.hide();
    this.overlay.show();

    try {
      const assembler = new AssignmentAssembler({
        title: this.portal.getAssessmentTitle?.() || "Assignment",
        course: this.portal.getCourseName?.() || "",
        week: this.portal.getAssessmentWeek?.() || "",
        isReview: this.portal.isReviewMode(),
        totalQuestions: this.portal.getTotalQuestionCount(),
      });

      await this.traverser.traverseAll({
        onProgress: (done, total) => this.overlay.progress(done, total),
        onQuestion: async (context) => {
          const questionNode = this.extractor.captureCurrentQuestion(context.index, context.isReview);
          assembler.addQuestion(questionNode);
        },
      });

      this.activeDocument = assembler.build();
      this.updateContextKey();
      await this.overlay.hide();

      // Check if question count matches paginator
      const totalExpected = this.portal.getTotalQuestionCount();
      const warningMessage =
        totalExpected && totalExpected !== this.activeDocument.length
          ? `Captured ${this.activeDocument.length} of ${totalExpected} questions — some questions may be paginated. Verify on the original quiz.`
          : "";

      this.reader.build(this.activeDocument, {
        compact: this.config.compact,
        warningMessage,
        onRefresh: () => this.refresh(),
        onDismiss: () => this.close(),
        onExport: (format, exportOptions) => this.handleExportAction(format, exportOptions),
        onThemeChange: (nextTheme) => {
          this.config.theme = nextTheme;
          try {
            if (typeof chrome !== "undefined" && chrome?.storage?.local) {
              chrome.storage.local.set({ theme: nextTheme });
            }
          } catch {}
        },
      });

      this.reader.show();
      this.lifecycle.transition(LifecycleState.OPEN);
    } catch (err) {
      this.invalidateDocument();
      console.error("[Acadrix Runtime] Error capturing assessment:", err);
      await this.overlay.hide();
      this.launcher.setExpanded?.(false);
      if (this.config.autoLauncher) {
        this.launcher.show();
        this.launcher.focus?.();
      }
      this.lifecycle.transition(LifecycleState.ACTIVE);
    }
  }

  formatExportErrorMessage(err) {
    if (!err) return "Unable to complete export. Please try refreshing the assessment.";
    switch (err.name) {
      case "ExtractionError":
        return "Could not capture all assessment questions. Please click Refresh and try again.";
      case "ResourceError":
        return "Could not resolve one or more assignment diagrams or images. Please check your connection and try again.";
      case "MarkdownExportError":
        return "Could not generate the Markdown document for this assignment.";
      case "PdfExportError":
        return "Could not prepare the PDF print view. Please try again.";
      case "PackagingError":
        return "Could not package the assignment ZIP bundle. Please try exporting Markdown instead.";
      default:
        return "Export could not be completed. Please refresh the assessment and try again.";
    }
  }

  printWithIntelligentTitle(docModel = this.activeDocument) {
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

  async handleExportAction(format, exportOptions = {}) {
    if (!this.orchestrator) {
      if (format === "pdf") {
        this.printWithIntelligentTitle(exportOptions.document || this.activeDocument);
      } else {
        const msg = "Markdown and Bundle export are available in the Acadrix Chrome Extension.";
        this.reader.notify?.(msg, "warn", 4200);
        alert(msg);
      }
      return;
    }

    /* @extension-only-start */
    if (this.orchestrator.isBusy()) {
      return;
    }

    this.reader.setExporting(true, format);

    try {
      let result = null;
      if (format === "markdown") {
        result = await this.exportAssignment({ formats: ["markdown"], autoDownload: true, ...exportOptions });
      } else if (format === "pdf") {
        result = await this.exportAssignment({
          formats: ["pdf"],
          autoDownload: true,
          onPdfFallback: () => {
            if (!this.isDestroyed && this.lifecycle.state !== LifecycleState.DESTROYED) {
              this.reader.setPdfFallbackMode?.(true);
              this.reader.notify?.(
                "Direct PDF unavailable — choose Save as PDF in the print dialog.",
                "info",
                4500
              );
              this.reader.announceAiStatus?.(
                "Direct PDF unavailable — choose Save as PDF in the print dialog.",
                "info"
              );
            }
          },
          ...exportOptions,
        });
      } else if (format === "bundle") {
        result = await this.exportAssignment({ formats: ["bundle"], autoDownload: true, ...exportOptions });
      }

      if (!this.isDestroyed && this.lifecycle.state !== LifecycleState.DESTROYED) {
        const failedAssets = result?.resourceStats?.failed || 0;
        if (failedAssets > 0) {
          this.reader.notify?.(
            `Export completed with ${failedAssets} missing asset${failedAssets > 1 ? "s" : ""}.`,
            "warn",
            4500
          );
        } else if (format === "pdf") {
          const pdfMethod = result?.outputs?.pdf?.method;
          if (pdfMethod === "direct") {
            this.reader.notify?.("PDF downloaded", "success", 3200);
            this.reader.announceAiStatus?.("PDF downloaded", "success");
          } else if (pdfMethod === "fallback-print") {
            this.reader.setPdfFallbackMode?.(true);
            this.reader.notify?.(
              "Direct PDF unavailable — choose Save as PDF in the print dialog.",
              "info",
              4500
            );
            this.reader.announceAiStatus?.(
              "Direct PDF unavailable — choose Save as PDF in the print dialog.",
              "info"
            );
          } else {
            this.reader.notify?.("PDF print view ready", "success", 3200);
          }
        } else {
          const doneLabel = format === "markdown" ? "Markdown exported" : "Bundle downloaded";
          this.reader.notify?.(doneLabel, "success", 3200);
        }
      }
    } catch (err) {
      if (this.isDestroyed || this.lifecycle.state === LifecycleState.DESTROYED) {
        return;
      }
      if (err.name === "CancellationError") {
        console.log("[Acadrix Runtime] Export cancelled.");
        this.reader.clearStatus?.();
      } else {
        console.error("[Acadrix Runtime] Export failed:", err);
        const errMsg = this.formatExportErrorMessage(err);
        this.reader.notify?.(errMsg, "error", 5200);
        alert(errMsg);
      }
    } finally {
      if (!this.isDestroyed && this.lifecycle.state !== LifecycleState.DESTROYED) {
        this.reader.setExporting(false);
      }
    }
    /* @extension-only-end */
  }

  async exportAssignment(request = {}) {
    if (!this.orchestrator) {
      throw new Error("Export orchestrator is not available.");
    }
    return this.orchestrator.export(request);
  }

  destroyUi() {
    this.launcher.destroy();
    this.overlay.destroy();
    this.reader.destroy();
    this.shadowHost.destroy();
  }

  destroy() {
    this.isDestroyed = true;
    if (this.orchestrator) {
      this.orchestrator.cancel();
    }/* @extension-only-start */
    try {
      this.portalDecor?.destroy?.();
      this.portalDecor = null;
    } catch {}
/* @extension-only-end */
    this.stopObserver();
    if (this.boundKeydown) {
      document.removeEventListener("keydown", this.boundKeydown, true);
      this.boundKeydown = null;
    }
    this.destroyUi();
    this.invalidateDocument();
    this.lifecycle.transition(LifecycleState.DESTROYED);
  }
}
