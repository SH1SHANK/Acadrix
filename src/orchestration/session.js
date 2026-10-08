/**
 * Export Session Lifecycle Controller.
 * 
 * Coordinates a single end-to-end export workflow across extraction,
 * resource resolution, Markdown serialization, PDF preparation, and bundle packaging.
 * Enforces:
 * - Exactly one traversal per session
 * - Exactly one canonical AssignmentDocument reused across all requested formats
 * - Resource resolution at most once per session
 * - Clean cancellation propagation across all subsystems
 */

import {
  ExportState,
  ExportPhase,
  ExtractionError,
  ResourceError,
  MarkdownExportError,
  TextExportError,
  PdfExportError,
  PackagingError,
  CancellationError,
} from "./types.js";
import { AssignmentAssembler } from "../model/assembler.js";
import { buildExportFilename } from "../model/document.js";
import { exportAssignmentToMarkdown } from "../exporters/markdown.js";
import { exportAssignmentToText } from "../exporters/plain-text.js";
import { renderPdfDocument, exportPdf } from "../exporters/pdf.js";
import { ResourceEngine } from "../resources/engine.js";
import { inferExtension } from "../resources/naming.js";
import { EXTENSION_TO_MIME } from "../resources/types.js";
import { createZipArchive, downloadFile, getSafeBaseName } from "./bundle.js";

function bytesToBase64(bytes) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  if (typeof btoa === "function") {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }
  throw new Error("No base64 encoder available for embedding exported images.");
}

export function createPdfDataUrlResourceMap(resources = []) {
  const map = new Map();
  for (const resource of resources) {
    if (resource?.status !== "downloaded" || !resource.data) continue;
    const bytes = resource.data instanceof Uint8Array ? resource.data : new Uint8Array(resource.data);
    const declaredMime = String(resource.mimeType || "").toLowerCase();
    const inferredMime = EXTENSION_TO_MIME[inferExtension("", resource.source || resource.localPath || "", bytes)];
    const mimeType = declaredMime.startsWith("image/") ? declaredMime : inferredMime;
    if (!mimeType) continue;
    const dataUrl = `data:${mimeType};base64,${bytesToBase64(bytes)}`;
    for (const key of [resource.source, resource.normalizedSource, resource.localPath]) {
      if (typeof key === "string" && key) map.set(key, dataUrl);
    }
  }
  return map;
}

export class ExportSession {
  /**
   * @param {Object} [params]
   * @param {Object} [params.runtime] - UnfoldRuntime instance
   * @param {Object} [params.traverser] - QuestionTraverser
   * @param {Object} [params.extractor] - SemanticExtractor
   * @param {Object} [params.document] - Pre-existing canonical AssignmentDocument
   * @param {Object} [params.options]
   */
  constructor({ runtime = null, traverser = null, extractor = null, document = null, options = {} } = {}) {
    this.runtime = runtime;
    this.traverser = traverser || runtime?.traverser || null;
    this.extractor = extractor || runtime?.extractor || null;
    this.document = document || runtime?.activeDocument || null;
    this.options = { ...options };

    this.state = ExportState.IDLE;
    this.resourceMap = null;
    this.bundleData = null;
    this.outputs = {
      markdown: null,
      text: null,
      pdf: null,
      bundle: null,
    };
    this.error = null;
    this.abortController = new AbortController();
    this._stageProgress = new Map();
  }

  /**
   * Cancels the active export session.
   * Immediately aborts pending traversal, resource fetches, and PDF print surfaces.
   */
  abort() {
    if (
      this.state === ExportState.COMPLETED ||
      this.state === ExportState.FAILED ||
      this.state === ExportState.CANCELLED
    ) {
      return;
    }
    this.state = ExportState.CANCELLED;
    this.abortController.abort();
    if (this.options.onStateChange) {
      this.options.onStateChange(this.state);
    }
  }

  transition(newState) {
    if (this.state === newState) return;
    this.state = newState;
    if (this.options.onStateChange) {
      this.options.onStateChange(newState);
    }
  }

  notifyProgress(phase, current, total, message) {
    // Never emit progress (especially COMPLETED) after session has failed or been cancelled
    if (this.state === ExportState.CANCELLED || this.state === ExportState.FAILED) {
      return;
    }

    const safeTotal = Math.max(0, Number(total) || 0);
    const clampedCurrent = Math.max(0, Math.min(Number(current) || 0, safeTotal));
    const prevCurrent = this._stageProgress.get(phase) ?? 0;
    const monotonicCurrent = Math.min(safeTotal, Math.max(prevCurrent, clampedCurrent));
    this._stageProgress.set(phase, monotonicCurrent);

    if (this.options.onProgress) {
      this.options.onProgress({
        phase,
        current: monotonicCurrent,
        total: safeTotal,
        message,
      });
    }
  }

  checkAbort() {
    if (this.abortController.signal.aborted || this.state === ExportState.CANCELLED) {
      throw new CancellationError("Export cancelled by user.");
    }
  }

  /**
   * Executes the end-to-end export workflow for the requested formats.
   * 
   * @param {Object} request
   * @param {string[]} [request.formats=["markdown"]] - Any combination of "markdown", "text", "pdf", "bundle"
   * @param {boolean} [request.packageResources=false] - Force local resource acquisition
   * @param {boolean} [request.includeInteractionState=false]
   * @param {boolean} [request.includeReviewData=false]
   * @param {boolean} [request.forceRefresh=false]
   * @param {boolean} [request.autoDownload=false]
   * @param {string} [request.customCss=""]
   * @param {AbortSignal} [request.signal]
   * @returns {Promise<Object>} Structured export result
   */
  async run(request = {}) {
    if (this.state !== ExportState.IDLE) {
      throw new Error(`ExportSession cannot run from state "${this.state}".`);
    }

    if (request.onProgress && !this.options.onProgress) {
      this.options.onProgress = request.onProgress;
    }
    if (request.onStateChange && !this.options.onStateChange) {
      this.options.onStateChange = request.onStateChange;
    }

    // Connect external cancellation signal if provided
    if (request.signal) {
      if (request.signal.aborted) {
        this.abort();
        throw new CancellationError("Export cancelled before starting.");
      }
      request.signal.addEventListener("abort", () => this.abort(), { once: true });
    }

    const formats = Array.isArray(request.formats) && request.formats.length > 0
      ? request.formats
      : ["markdown"];

    const includeInteractionState = Boolean(request.includeInteractionState ?? this.options.includeInteractionState);
    const includeReviewData = Boolean(request.includeReviewData ?? this.options.includeReviewData);
    const packageResources = Boolean(
      request.packageResources || formats.includes("bundle") || formats.includes("pdf") || this.options.packageResources
    );
    const forceRefresh = Boolean(request.forceRefresh);
    const autoDownload = Boolean(request.autoDownload ?? true);

    try {
      this.checkAbort();

      // ── Step 1: Canonical Document Acquisition ─────────────────────────────
      // Invariant: Exactly one traversal per session; reuse existing valid document when present
      const hasExistingDoc = Boolean(
        this.document && Array.isArray(this.document.questions) && this.document.questions.length > 0
      );

      if (hasExistingDoc && !forceRefresh) {
        this.notifyProgress(
          ExportPhase.EXTRACTING,
          this.document.questions.length,
          this.document.questions.length,
          "Reusing existing assessment document"
        );
      } else {
        // Invalidate any stale cached document immediately when new extraction begins
        this.document = null;
        if (this.runtime) {
          this.runtime.activeDocument = null;
        }

        this.transition(ExportState.EXTRACTING);

        if (!this.traverser || !this.extractor) {
          throw new ExtractionError("No traverser or extractor available to capture assessment.");
        }

        try {
          const isReview = this.runtime?.portal?.isReviewMode?.() ?? false;
          const totalExpected = this.runtime?.portal?.getTotalQuestionCount?.() ?? null;
          const title =
            request.title ||
            this.options.title ||
            this.runtime?.portal?.getAssessmentTitle?.() ||
            "Assignment";
          const course =
            request.course ||
            this.options.course ||
            this.runtime?.portal?.getCourseName?.() ||
            "";
          const week =
            request.week ||
            this.options.week ||
            this.runtime?.portal?.getAssessmentWeek?.() ||
            "";

          const assembler = new AssignmentAssembler({
            title,
            course,
            week,
            isReview,
            totalQuestions: totalExpected,
          });

          await this.traverser.traverseAll({
            signal: this.abortController.signal,
            onProgress: (done, total) => {
              this.checkAbort();
              this.notifyProgress(
                ExportPhase.EXTRACTING,
                done,
                Math.max(done, total || 1),
                `Extracting questions (${done}/${Math.max(done, total || 1)})...`
              );
            },
            onQuestion: async (context) => {
              this.checkAbort();
              const questionNode = this.extractor.captureCurrentQuestion(context.index, context.isReview);
              assembler.addQuestion(questionNode);
            },
          });

          this.checkAbort();
          this.document = assembler.build();

          // Update runtime's active document cache only after full extraction succeeds
          if (this.runtime) {
            this.runtime.activeDocument = this.document;
            if (typeof this.runtime.updateContextKey === "function") {
              this.runtime.updateContextKey();
            }
          }
        } catch (extErr) {
          this.document = null;
          if (this.runtime) {
            this.runtime.activeDocument = null;
          }
          if (
            this.abortController.signal.aborted ||
            extErr instanceof CancellationError ||
            extErr.name === "CancellationError" ||
            extErr.name === "TraversalCancellationError"
          ) {
            throw new CancellationError(extErr.message || "Extraction cancelled by user.");
          }
          if (extErr instanceof ExtractionError) {
            throw extErr;
          }
          throw new ExtractionError(`Assessment extraction failed: ${extErr.message}`, {
            cause: extErr,
          });
        }
      }

      this.checkAbort();

      // ── Step 2: Resource Resolution ────────────────────────────────────────
      // Invariant: Resources acquired at most once per session, shared across all outputs
      if (packageResources && !this.bundleData) {
        this.transition(ExportState.RESOLVING_RESOURCES);

        const resourceEngine = new ResourceEngine({
          signal: this.abortController.signal,
          ...request.resourceOptions,
        });

        try {
          const bundleResult = await resourceEngine.buildBundle(this.document, {
            signal: this.abortController.signal,
            includeInteractionState,
            includeReviewData,
            onProgress: (p) => {
              this.checkAbort();
              this.notifyProgress(
                ExportPhase.RESOLVING_RESOURCES,
                p.completed,
                p.total,
                `Resolving assets (${p.completed}/${p.total})...`
              );
            },
          });

          this.checkAbort();
          this.resourceMap = bundleResult.resourceMap;
          this.pdfResourceMap = createPdfDataUrlResourceMap(bundleResult.resources);
          this.bundleData = bundleResult;
        } catch (resErr) {
          if (
            this.abortController.signal.aborted ||
            resErr instanceof CancellationError ||
            resErr.name === "CancellationError"
          ) {
            throw new CancellationError("Resource resolution cancelled.");
          }
          if (resErr instanceof ResourceError) {
            throw resErr;
          }
          throw new ResourceError(`Resource resolution failed: ${resErr.message}`, { cause: resErr });
        }
      } else {
        this.resourceMap = request.resourceMap || null;
        this.pdfResourceMap = request.pdfResourceMap || null;
      }

      this.checkAbort();

      // ── Step 3: Rendering & Formatting ─────────────────────────────────────
      this.transition(ExportState.RENDERING);
      const baseName = getSafeBaseName(this.document.metadata?.title || "assignment");

      // 3A. Markdown Export
      if (formats.includes("markdown")) {
        this.notifyProgress(ExportPhase.GENERATING_MARKDOWN, 0, 1, "Generating Markdown...");
        this.checkAbort();
        try {
          // If bundle already generated markdown with identical settings and resource map, reuse it
          let markdownText;
          if (this.bundleData && this.bundleData.markdown) {
            markdownText = this.bundleData.markdown;
          } else {
            markdownText = exportAssignmentToMarkdown(this.document, {
              resourceMap: this.resourceMap,
              includeInteractionState,
              includeReviewData,
            });
          }
          this.checkAbort();
          this.outputs.markdown = markdownText;
          this.notifyProgress(ExportPhase.GENERATING_MARKDOWN, 1, 1, "Markdown generated.");

          if (autoDownload && typeof window !== "undefined") {
            downloadFile(`${baseName}.md`, markdownText, "text/markdown");
          }
        } catch (mdErr) {
          if (
            this.abortController.signal.aborted ||
            mdErr instanceof CancellationError ||
            mdErr.name === "CancellationError"
          ) {
            throw new CancellationError("Markdown generation cancelled.");
          }
          throw new MarkdownExportError(`Markdown export failed: ${mdErr.message}`, { cause: mdErr });
        }
      }

      this.checkAbort();

      // 3A. Plain-text Export
      if (formats.includes("text") || formats.includes("txt")) {
        this.checkAbort();
        try {
          const text = exportAssignmentToText(this.document);
          this.outputs.text = text;
          if (autoDownload && typeof window !== "undefined") {
            downloadFile(buildExportFilename(this.document.metadata || {}, "txt"), text, "text/plain;charset=utf-8");
          }
        } catch (textErr) {
          if (this.abortController.signal.aborted || textErr instanceof CancellationError) {
            throw new CancellationError("Plain-text generation cancelled.");
          }
          throw new TextExportError(`Plain-text export failed: ${textErr.message}`, { cause: textErr });
        }
      }

      this.checkAbort();

      // 3B. PDF Export
      if (formats.includes("pdf")) {
        this.notifyProgress(ExportPhase.PREPARING_PDF, 0, 1, "Preparing PDF print document...");
        this.checkAbort();
        try {
          const pdfFilename =
            request.filename || buildExportFilename(this.document.metadata || {}, "pdf");
          const pdfOptions = {
            resourceMap: this.pdfResourceMap || this.resourceMap,
            includeInteractionState,
            includeReviewData,
            customCss: request.customCss || "",
            signal: this.abortController.signal,
            printTimeoutMs: request.printTimeoutMs,
            imageTimeoutMs: request.imageTimeoutMs,
            filename: pdfFilename,
            useDirectDownload: request.useDirectDownload,
            onFallback: request.onPdfFallback,
          };

          const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";

          if (isBrowser && autoDownload) {
            // Browser direct PDF download or interactive print fallback
            const printRes = await exportPdf(this.document, pdfOptions);
            this.checkAbort();
            this.outputs.pdf = {
              printed: true,
              filename: pdfFilename,
              method: printRes?.method || "pdfmake",
              fallbackReason: printRes?.fallbackReason || null,
              diagnostics: printRes?.diagnostics || null,
              pageCount: printRes?.pageCount || null,
            };
          } else {
            // Pure HTML standalone generation (Node.js or non-download mode)
            const html = renderPdfDocument(this.document, pdfOptions);
            this.checkAbort();
            this.outputs.pdf = { html, printed: false, filename: pdfFilename };
          }
          this.notifyProgress(ExportPhase.PREPARING_PDF, 1, 1, "PDF prepared.");
        } catch (pdfErr) {
          if (
            this.abortController.signal.aborted ||
            pdfErr instanceof CancellationError ||
            pdfErr.name === "CancellationError" ||
            pdfErr.message?.includes("cancelled")
          ) {
            throw new CancellationError("PDF preparation cancelled.");
          }
          throw new PdfExportError(`PDF export failed: ${pdfErr.message}`, { cause: pdfErr });
        }
      }

      this.checkAbort();

      // 3C. Portable Bundle Packaging
      if (formats.includes("bundle")) {
        this.notifyProgress(ExportPhase.PACKAGING, 0, 1, "Packaging self-contained ZIP bundle...");
        this.checkAbort();
        try {
          if (!this.bundleData) {
            throw new PackagingError("Bundle resources were not initialized.");
          }

          const filesMap = new Map();
          const mdContent = this.outputs.markdown || this.bundleData.markdown;
          filesMap.set("assignment.md", mdContent);
          filesMap.set("metadata.json", this.bundleData.metadataJson);
          filesMap.set("manifest.json", this.bundleData.manifestJson);

          // Add all downloaded asset files into the ZIP archive
          for (const [assetPath, assetInfo] of this.bundleData.assets.entries()) {
            filesMap.set(assetPath, assetInfo.data);
          }

          const zipBytes = createZipArchive(filesMap);
          this.checkAbort();

          this.outputs.bundle = {
            zipBytes,
            files: filesMap,
            manifest: this.bundleData.manifest,
            stats: this.bundleData.stats,
          };
          this.notifyProgress(ExportPhase.PACKAGING, 1, 1, "Bundle packaged.");

          if (autoDownload && typeof window !== "undefined") {
            downloadFile(`${baseName}.zip`, zipBytes, "application/zip");
          }
        } catch (packErr) {
          if (
            this.abortController.signal.aborted ||
            packErr instanceof CancellationError ||
            packErr.name === "CancellationError"
          ) {
            throw new CancellationError("Bundle packaging cancelled.");
          }
          if (packErr instanceof PackagingError) {
            throw packErr;
          }
          throw new PackagingError(`Bundle packaging failed: ${packErr.message}`, { cause: packErr });
        }
      }

      // ── Step 4: Completion ─────────────────────────────────────────────────
      this.transition(ExportState.COMPLETED);
      this.notifyProgress(ExportPhase.COMPLETED, 1, 1, "Export completed successfully.");

      return {
        status: "completed",
        document: this.document,
        outputs: this.outputs,
        resourceMap: this.resourceMap,
        resourceStats: this.bundleData?.stats || null,
      };
    } catch (err) {
      if (
        this.abortController.signal.aborted ||
        err.name === "TraversalCancellationError" ||
        err instanceof CancellationError
      ) {
        this.transition(ExportState.CANCELLED);
        throw new CancellationError(err.message || "Export session was cancelled.");
      }

      this.transition(ExportState.FAILED);
      this.error = err;
      throw err;
    }
  }
}
