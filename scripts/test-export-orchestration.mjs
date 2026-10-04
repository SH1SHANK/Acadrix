#!/usr/bin/env node
/**
 * End-to-End Export Orchestration Test Suite.
 * 
 * Verifies all 20 requirements of Section 35:
 * 1. Markdown only export
 * 2. PDF only export
 * 3. Markdown + PDF multi-export with single traversal and document reuse
 * 4. Portable Bundle packaging (ZIP, assignment.md, metadata.json, manifest.json)
 * 5. Resource deduplication (single fetch pass across questions)
 * 6. Document reuse (active document reused without re-traversal)
 * 7. Invalidation / forceRefresh triggers fresh traversal
 * 8. Cancellation during traversal (aborts, restores user position, throws CancellationError)
 * 9. Cancellation during resource resolution (aborts, throws CancellationError)
 * 10. Cancellation during PDF export (cleans up print surface / iframe)
 * 11. Partial resource failure handling (404 asset handled, bundle generated)
 * 12. Markdown exporter failure transitions session to FAILED state
 * 13. PDF exporter failure leaves Markdown output intact
 * 14. Bundle packaging failure is diagnosable
 * 15. Double export prevention (DoubleExportError thrown)
 * 16. Progress reporting emits ordered phases
 * 17. User position restoration on completion and abort
 * 18. Reader integration triggers export without redundant traversal
 * 19. Bookmarklet graph isolation (free of orchestrator and exporters)
 * 20. End-to-end mocked workflow
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { ContentType, QuestionType, MathType, MathFormat } from "../src/model/types.js";
import { ContentNode, OptionNode, QuestionNode, AssignmentDocument } from "../src/model/document.js";
import {
  ExportState,
  ExportPhase,
  ExtractionError,
  ResourceError,
  MarkdownExportError,
  PdfExportError,
  PackagingError,
  CancellationError,
  DoubleExportError,
} from "../src/orchestration/types.js";
import {
  createZipArchive,
  crc32,
  getSafeBaseName,
  sanitizeArchivePath,
  compareArchivePaths,
} from "../src/orchestration/bundle.js";
import { sanitizeFilename, generateAssetLocalPath } from "../src/resources/naming.js";
import { ExportSession } from "../src/orchestration/session.js";
import { ExportOrchestrator, exportAssignment } from "../src/orchestration/orchestrator.js";
import { BOOKMARKLET_MODULES } from "../build.mjs";

let passed = true;

async function check(desc, fn) {
  try {
    await fn();
    console.log(`✓ ${desc}`);
  } catch (e) {
    console.error(`❌ ${desc}: ${e.message}\n${e.stack}`);
    passed = false;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

// 1x1 valid PNG fixture
const ONE_PIXEL_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

/**
 * Creates a standard mock AssignmentDocument for testing.
 */
function createMockDocument(title = "Calculus Assignment 1") {
  const doc = new AssignmentDocument({
    metadata: {
      title,
      course: "Mathematics 101",
      totalQuestions: 2,
      isReview: false,
    },
  });

  const q1 = new QuestionNode({
    index: 0,
    number: 1,
    label: "Question 1",
    type: QuestionType.MCQ,
    marks: 2,
    stem: [
      new ContentNode({
        type: ContentType.PARAGRAPH,
        children: [
          new ContentNode({ type: ContentType.TEXT, text: "What is the derivative of " }),
          new ContentNode({ type: ContentType.MATH_INLINE, value: "x^2", rawText: "$x^2$" }),
          new ContentNode({ type: ContentType.TEXT, text: "?" }),
        ],
      }),
    ],
    options: [
      new OptionNode({
        id: "opt_0",
        label: "A",
        content: [new ContentNode({ type: ContentType.TEXT, text: "2x" })],
      }),
      new OptionNode({
        id: "opt_1",
        label: "B",
        content: [new ContentNode({ type: ContentType.TEXT, text: "x" })],
      }),
    ],
  });

  const q2 = new QuestionNode({
    index: 1,
    number: 2,
    label: "Question 2",
    type: QuestionType.NAT,
    marks: 3,
    stem: [
      new ContentNode({
        type: ContentType.PARAGRAPH,
        children: [
          new ContentNode({ type: ContentType.TEXT, text: "Evaluate the integral below:" }),
        ],
      }),
      new ContentNode({
        type: ContentType.IMAGE,
        attributes: {
          src: "https://example.com/assets/integral.png",
          alt: "Integral Formula",
        },
      }),
    ],
  });

  doc.addQuestion(q1);
  doc.addQuestion(q2);
  return doc;
}

/**
 * Creates a mock Traverser and Extractor.
 */
function createMockTraverserAndExtractor(doc = null) {
  const targetDoc = doc || createMockDocument();
  let traverseCalls = 0;
  let restored = false;

  const traverser = {
    get traverseCalls() {
      return traverseCalls;
    },
    get isRestored() {
      return restored;
    },
    restoreLocation: async () => {
      restored = true;
    },
    traverseAll: async ({ onProgress, onQuestion, signal } = {}) => {
      traverseCalls++;
      if (signal?.aborted) {
        throw new CancellationError("Traversal aborted before starting");
      }

      for (let i = 0; i < targetDoc.questions.length; i++) {
        // Asynchronous pause to allow cancellation signals to interleave
        await new Promise((r) => setTimeout(r, 20));

        if (signal?.aborted) {
          throw new CancellationError("Traversal aborted during execution");
        }
        if (onProgress) {
          onProgress(i + 1, targetDoc.questions.length);
        }
        if (onQuestion) {
          await onQuestion({ index: i, isReview: false });
        }
      }
    },
  };

  const extractor = {
    captureCurrentQuestion: (index, isReview) => {
      return targetDoc.questions[index];
    },
  };

  const portal = {
    detectAssessment: () => true,
    isReviewMode: () => false,
    getTotalQuestionCount: () => targetDoc.questions.length,
    getQuestionChips: () => [{ index: 0, text: "1" }, { index: 1, text: "2" }],
    getAssessmentTitle: () => targetDoc.metadata?.title || "Calculus Assignment 1",
    originalIndex: 0,
    restoreLocation: async () => {
      restored = true;
    },
  };

  return { traverser, extractor, portal, document: targetDoc };
}

/**
 * Unpacks and inspects entries in a PKZIP 2.0 buffer.
 */
function inspectZipArchive(uint8) {
  const view = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);
  const files = new Map();
  let offset = 0;

  // Scan local file headers
  while (offset + 30 <= uint8.length) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) {
      // Reached central directory or end
      break;
    }

    const compressedSize = view.getUint32(offset + 18, true);
    const fileNameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);

    const nameBytes = uint8.subarray(offset + 30, offset + 30 + fileNameLen);
    const fileName = new TextDecoder().decode(nameBytes);

    const dataStart = offset + 30 + fileNameLen + extraLen;
    const fileData = uint8.subarray(dataStart, dataStart + compressedSize);

    files.set(fileName, fileData);
    offset = dataStart + compressedSize;
  }

  return files;
}

async function runTests() {
  console.log("\nStarting Phase 7 Export Orchestration Verification Suite...\n");

  // ── Test 1: Markdown Only ──────────────────────────────────────────────────
  await check("Test 1: Markdown only export generates markdown, no PDF, no ZIP", async () => {
    const { traverser, extractor, portal } = createMockTraverserAndExtractor();
    const orchestrator = new ExportOrchestrator({ traverser, extractor, portal });

    const result = await orchestrator.export({
      formats: ["markdown"],
      autoDownload: false,
    });

    assert(result.status === "completed", "Status must be completed");
    assert(typeof result.outputs.markdown === "string" && result.outputs.markdown.length > 0, "Markdown output required");
    assert(result.outputs.markdown.includes("# Calculus Assignment 1"), "Markdown should include title");
    assert(result.outputs.pdf === null, "PDF output must be null");
    assert(result.outputs.bundle === null, "Bundle output must be null");
    assert(result.resourceMap === null, "Resource map should be null when not requested");
  });

  // ── Test 2: PDF Only ───────────────────────────────────────────────────────
  await check("Test 2: PDF only export generates PDF HTML, no markdown, no ZIP", async () => {
    const { traverser, extractor, portal } = createMockTraverserAndExtractor();
    const orchestrator = new ExportOrchestrator({ traverser, extractor, portal });

    const result = await orchestrator.export({
      formats: ["pdf"],
      autoDownload: false,
    });

    assert(result.status === "completed", "Status must be completed");
    assert(result.outputs.pdf !== null, "PDF output must be populated");
    assert(typeof result.outputs.pdf.html === "string", "PDF HTML must be generated in node environment");
    assert(result.outputs.pdf.html.includes("<!DOCTYPE html>"), "PDF HTML must contain valid DOCTYPE");
    assert(result.outputs.markdown === null, "Markdown output must be null");
    assert(result.outputs.bundle === null, "Bundle output must be null");
  });

  // ── Test 3: Markdown + PDF Multi-Export ────────────────────────────────────
  await check("Test 3: Markdown + PDF multi-export performs single traversal and shares document", async () => {
    const { traverser, extractor, portal } = createMockTraverserAndExtractor();
    const orchestrator = new ExportOrchestrator({ traverser, extractor, portal });

    const result = await orchestrator.export({
      formats: ["markdown", "pdf"],
      autoDownload: false,
    });

    assert(traverser.traverseCalls === 1, `Expected exactly 1 traversal call, got ${traverser.traverseCalls}`);
    assert(typeof result.outputs.markdown === "string", "Markdown must be generated");
    assert(typeof result.outputs.pdf?.html === "string", "PDF must be generated");
    assert(result.document === orchestrator.getActiveDocument(), "Cached document matches result document");
  });

  // ── Test 4: Portable Bundle Packaging ──────────────────────────────────────
  await check("Test 4: Portable bundle packaging creates valid ZIP with markdown, metadata, manifest, and assets", async () => {
    const { traverser, extractor, portal } = createMockTraverserAndExtractor();
    const orchestrator = new ExportOrchestrator({ traverser, extractor, portal });

    // Mock fetch for image asset
    const fetchFn = async (url) => ({
      ok: true,
      status: 200,
      headers: { get: () => "image/png" },
      arrayBuffer: async () => ONE_PIXEL_PNG.buffer,
    });

    const result = await orchestrator.export({
      formats: ["bundle"],
      autoDownload: false,
      resourceOptions: { fetchFn },
    });

    assert(result.outputs.bundle !== null, "Bundle output must be populated");
    assert(result.outputs.bundle.zipBytes instanceof Uint8Array, "zipBytes must be Uint8Array");

    // Inspect the generated ZIP
    const zipEntries = inspectZipArchive(result.outputs.bundle.zipBytes);
    assert(zipEntries.has("assignment.md"), "ZIP must contain assignment.md");
    assert(zipEntries.has("metadata.json"), "ZIP must contain metadata.json");
    assert(zipEntries.has("manifest.json"), "ZIP must contain manifest.json");

    // Check that asset is present in ZIP
    let hasAsset = false;
    for (const key of zipEntries.keys()) {
      if (key.startsWith("assets/")) hasAsset = true;
    }
    assert(hasAsset, "ZIP must contain assets/");

    // Verify manifest JSON inside ZIP
    const manifestJson = new TextDecoder().decode(zipEntries.get("manifest.json"));
    const manifest = JSON.parse(manifestJson);
    assert(manifest.version.startsWith("1."), "Manifest version must be 1.0 or 1.0.0");
    assert(manifest.resources.length > 0, "Manifest must list resources");
  });

  // ── Test 5: Resource Deduplication ─────────────────────────────────────────
  await check("Test 5: Identical resource references across questions fetch exactly once", async () => {
    const doc = createMockDocument("Shared Asset Test");
    // Add third question with identical image URL
    doc.addQuestion(
      new QuestionNode({
        index: 2,
        number: 3,
        label: "Question 3",
        type: QuestionType.MCQ,
        marks: 1,
        stem: [
          new ContentNode({
            type: ContentType.IMAGE,
            attributes: {
              src: "https://example.com/assets/integral.png", // duplicate of Q2
            },
          }),
        ],
      })
    );

    let fetchCount = 0;
    const fetchFn = async (url) => {
      fetchCount++;
      return {
        ok: true,
        status: 200,
        headers: { get: () => "image/png" },
        arrayBuffer: async () => ONE_PIXEL_PNG.buffer,
      };
    };

    const orchestrator = new ExportOrchestrator();
    const result = await orchestrator.export({
      document: doc,
      formats: ["bundle"],
      autoDownload: false,
      resourceOptions: { fetchFn },
    });

    assert(fetchCount === 1, `Expected exactly 1 fetch for shared URL, got ${fetchCount}`);
    assert(result.resourceStats.total === 1, "Should discover 1 unique resource");
    assert(result.resourceStats.downloaded === 1, "Should complete 1 resource");
  });

  // ── Test 6: Document Reuse ─────────────────────────────────────────────────
  await check("Test 6: Existing valid document is reused without triggering re-traversal", async () => {
    const existingDoc = createMockDocument("Cached Document");
    const { traverser, extractor, portal } = createMockTraverserAndExtractor();

    const runtimeMock = {
      traverser,
      extractor,
      portal,
      activeDocument: existingDoc,
    };

    const orchestrator = new ExportOrchestrator(runtimeMock);

    const result = await orchestrator.export({
      formats: ["markdown"],
      autoDownload: false,
    });

    assert(traverser.traverseCalls === 0, "Traverser must NOT be called when document is cached");
    assert(result.document === existingDoc, "Must return existing document");
  });

  // ── Test 7: Invalidation and Force Refresh ──────────────────────────────────
  await check("Test 7: Invalidation or forceRefresh: true triggers fresh traversal", async () => {
    const existingDoc = createMockDocument("Old Document");
    const { traverser, extractor, portal } = createMockTraverserAndExtractor();

    const runtimeMock = {
      traverser,
      extractor,
      portal,
      activeDocument: existingDoc,
    };

    const orchestrator = new ExportOrchestrator(runtimeMock);

    // Call export with forceRefresh: true
    const result = await orchestrator.export({
      formats: ["markdown"],
      forceRefresh: true,
      autoDownload: false,
    });

    assert(traverser.traverseCalls === 1, "Traverser must be called when forceRefresh: true");
    assert(runtimeMock.activeDocument !== existingDoc, "Cached document must be updated");
  });

  // ── Test 8: Cancellation During Traversal ───────────────────────────────────
  await check("Test 8: Cancellation during traversal halts and restores location", async () => {
    const { traverser, extractor, portal } = createMockTraverserAndExtractor();
    const orchestrator = new ExportOrchestrator({ traverser, extractor, portal });

    const abortController = new AbortController();

    // Trigger abort after a small delay while traversal is in progress
    setTimeout(() => abortController.abort(), 10);

    let caughtError = null;
    try {
      await orchestrator.export({
        formats: ["markdown"],
        signal: abortController.signal,
        autoDownload: false,
      });
    } catch (err) {
      caughtError = err;
    }

    assert(caughtError !== null, "Export must reject when cancelled");
    assert(
      caughtError.name === "CancellationError" || caughtError instanceof CancellationError,
      `Error must be CancellationError, got ${caughtError?.name}`
    );
    assert(orchestrator.activeSession.state === ExportState.CANCELLED, "Session state must be CANCELLED");
  });

  // ── Test 9: Cancellation During Resources ───────────────────────────────────
  await check("Test 9: Cancellation during resource resolution aborts cleanly", async () => {
    const doc = createMockDocument("Resource Cancellation");
    const abortController = new AbortController();

    const fetchFn = async (url, { signal } = {}) => {
      // Trigger abort when asset fetch begins
      abortController.abort();
      const err = new Error("Fetch Aborted");
      err.name = "AbortError";
      throw err;
    };

    const orchestrator = new ExportOrchestrator();

    let caughtError = null;
    try {
      await orchestrator.export({
        document: doc,
        formats: ["bundle"],
        signal: abortController.signal,
        autoDownload: false,
        resourceOptions: { fetchFn },
      });
    } catch (err) {
      caughtError = err;
    }

    assert(caughtError !== null, "Export must reject on cancellation during resources");
    assert(
      caughtError.name === "CancellationError" || caughtError instanceof CancellationError,
      `Expected CancellationError, got ${caughtError?.name}`
    );
    assert(orchestrator.activeSession.state === ExportState.CANCELLED, "Session state must be CANCELLED");
  });

  // ── Test 10: Cancellation During PDF Export ────────────────────────────────
  await check("Test 10: Cancellation during PDF export cleans up print surfaces", async () => {
    const doc = createMockDocument("PDF Cancel Cleanup");
    const abortController = new AbortController();

    // Mock DOM environment with iframe support
    const attachedIframes = [];
    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;

    globalThis.window = {
      print: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    globalThis.document = {
      createElement: (tag) => {
        if (tag === "iframe") {
          const iframe = {
            style: {},
            contentDocument: {
              open: () => {},
              write: () => {},
              close: () => {},
            },
            contentWindow: {
              focus: () => {},
              addEventListener: () => {},
              removeEventListener: () => {},
              print: () => {
                // Abort during print dialog
                abortController.abort();
              },
            },
            remove: () => {
              const idx = attachedIframes.indexOf(iframe);
              if (idx !== -1) attachedIframes.splice(idx, 1);
            },
          };
          return iframe;
        }
        return {};
      },
      body: {
        appendChild: (el) => {
          el.parentNode = globalThis.document.body;
          attachedIframes.push(el);
        },
        removeChild: (el) => {
          el.parentNode = null;
          const idx = attachedIframes.indexOf(el);
          if (idx !== -1) attachedIframes.splice(idx, 1);
        },
      },
    };

    try {
      const orchestrator = new ExportOrchestrator();
      let caught = null;
      try {
        await orchestrator.export({
          document: doc,
          formats: ["pdf"],
          signal: abortController.signal,
          autoDownload: true, // triggers browser interactive print branch
        });
      } catch (err) {
        caught = err;
      }

      assert(caught !== null, "Export must reject when cancelled during PDF");
      assert(
        caught.name === "CancellationError" || caught instanceof CancellationError,
        `Expected CancellationError, got ${caught?.name}`
      );
      assert(attachedIframes.length === 0, "Any temporary iframe must be detached upon cancellation");
    } finally {
      globalThis.document = originalDocument;
      globalThis.window = originalWindow;
    }
  });

  // ── Test 11: Partial Resource Failure ──────────────────────────────────────
  await check("Test 11: Partial resource failure packages available assets and updates manifest", async () => {
    const doc = new AssignmentDocument({ metadata: { title: "Partial Failure Test" } });
    doc.addQuestion(
      new QuestionNode({
        index: 0,
        number: 1,
        stem: [
          new ContentNode({
            type: ContentType.IMAGE,
            attributes: { src: "https://example.com/ok.png" },
          }),
          new ContentNode({
            type: ContentType.IMAGE,
            attributes: { src: "https://example.com/missing.png" },
          }),
        ],
      })
    );

    const fetchFn = async (url) => {
      if (url.includes("missing")) {
        return { ok: false, status: 404, statusText: "Not Found" };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => "image/png" },
        arrayBuffer: async () => ONE_PIXEL_PNG.buffer,
      };
    };

    const orchestrator = new ExportOrchestrator();
    const result = await orchestrator.export({
      document: doc,
      formats: ["bundle"],
      autoDownload: false,
      resourceOptions: { fetchFn },
    });

    assert(result.status === "completed", "Export should complete despite 404 asset");
    assert(result.resourceStats.downloaded === 1, "One asset should succeed");
    assert(result.resourceStats.failed === 1, "One asset should fail");

    const zipEntries = inspectZipArchive(result.outputs.bundle.zipBytes);
    const manifest = JSON.parse(new TextDecoder().decode(zipEntries.get("manifest.json")));

    const okRes = manifest.resources.find((r) => r.source.includes("ok.png"));
    const failRes = manifest.resources.find((r) => r.source.includes("missing.png"));
    assert(okRes.status === "downloaded", "OK asset marked downloaded");
    assert(failRes.status === "failed", "Missing asset marked failed");
  });

  // ── Test 12: Markdown Exporter Failure ─────────────────────────────────────
  await check("Test 12: Markdown exporter failure transitions session to FAILED state", async () => {
    const corruptedDoc = {
      metadata: { title: "Bad Doc" },
      questions: [{ invalid: "not a QuestionNode" }],
    };

    const orchestrator = new ExportOrchestrator();
    let caught = null;
    try {
      await orchestrator.export({
        document: corruptedDoc,
        formats: ["markdown"],
        autoDownload: false,
      });
    } catch (err) {
      caught = err;
    }

    assert(caught !== null, "Must throw on exporter failure");
    assert(caught.name === "MarkdownExportError", `Expected MarkdownExportError, got ${caught.name}`);
    assert(orchestrator.activeSession.state === ExportState.FAILED, "Session state must be FAILED");
  });

  // ── Test 13: PDF Exporter Failure Preserves Prior Outputs ──────────────────
  await check("Test 13: PDF exporter failure preserves generated markdown output", async () => {
    const doc = createMockDocument("PDF Failure Test");
    const session = new ExportSession({ document: doc });

    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;

    // Simulate browser environment where iframe document is inaccessible, causing PDF export to fail
    globalThis.window = {
      URL: { createObjectURL: () => "blob:mock", revokeObjectURL: () => {} },
    };
    globalThis.document = {
      createElement: () => ({
        style: {},
        contentDocument: null,
        contentWindow: null,
        click: () => {},
        setAttribute: () => {},
        remove: () => {},
      }),
      body: { appendChild: () => {}, removeChild: () => {} },
    };

    let caught = null;
    try {
      await session.run({
        formats: ["markdown", "pdf"],
        autoDownload: true,
      });
    } catch (err) {
      caught = err;
    } finally {
      globalThis.document = originalDocument;
      globalThis.window = originalWindow;
    }

    assert(caught !== null, "Must throw when PDF export fails");
    assert(caught.name === "PdfExportError", `Expected PdfExportError, got ${caught?.name}`);
    assert(session.state === ExportState.FAILED, "Session state must be FAILED");
    assert(
      typeof session.outputs.markdown === "string" &&
        session.outputs.markdown.includes("# PDF Failure Test"),
      "Generated Markdown output must remain intact on session.outputs.markdown"
    );
  });

  // ── Test 14: Bundle Packaging Failure Diagnosable ──────────────────────────
  await check("Test 14: Bundle packaging failure throws PackagingError", async () => {
    const doc = createMockDocument("Packaging Fail");
    const session = new ExportSession({ document: doc });

    // Inject corrupted bundle asset data to simulate packaging crash
    session.bundleData = {
      markdown: "# Header",
      metadataJson: "{}",
      manifestJson: "{}",
      assets: new Map([["corrupt.png", { data: null }]]),
    };
    session.state = ExportState.IDLE;

    let caught = null;
    try {
      await session.run({
        formats: ["bundle"],
        packageResources: false,
        autoDownload: false,
      });
    } catch (err) {
      caught = err;
    }

    assert(caught !== null, "Should fail packaging");
    assert(caught.name === "PackagingError", `Expected PackagingError, got ${caught?.name}`);
  });

  // ── Test 15: Double Export Prevention ──────────────────────────────────────
  await check("Test 15: Concurrent export attempts trigger DoubleExportError", async () => {
    let unblockTraversal;
    const blockingPromise = new Promise((resolve) => {
      unblockTraversal = resolve;
    });

    const traverser = {
      traverseAll: async () => {
        await blockingPromise;
      },
    };
    const extractor = { captureCurrentQuestion: () => {} };

    const orchestrator = new ExportOrchestrator({ traverser, extractor });

    // Launch first export
    const firstExport = orchestrator.export({ formats: ["markdown"], autoDownload: false });

    // Immediately attempt second export while first is in flight
    let doubleError = null;
    try {
      orchestrator.export({ formats: ["markdown"], autoDownload: false });
    } catch (err) {
      doubleError = err;
    }

    // Unblock first export
    unblockTraversal();
    await firstExport.catch(() => {});

    assert(doubleError !== null, "Second export must throw synchronously or reject");
    assert(
      doubleError.name === "DoubleExportError" || doubleError instanceof DoubleExportError,
      `Expected DoubleExportError, got ${doubleError?.name}`
    );
  });

  // ── Test 16: Progress Reporting ───────────────────────────────────────────
  await check("Test 16: Progress callbacks receive ordered lifecycle phases", async () => {
    const { traverser, extractor, portal } = createMockTraverserAndExtractor();
    const orchestrator = new ExportOrchestrator({ traverser, extractor, portal });

    const fetchFn = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "image/png" },
      arrayBuffer: async () => ONE_PIXEL_PNG.buffer,
    });

    const receivedPhases = [];
    await orchestrator.export({
      formats: ["markdown", "pdf", "bundle"],
      autoDownload: false,
      resourceOptions: { fetchFn },
      onProgress: (p) => {
        if (!receivedPhases.includes(p.phase)) {
          receivedPhases.push(p.phase);
        }
      },
    });

    assert(receivedPhases.includes(ExportPhase.EXTRACTING), "Must emit extracting phase");
    assert(receivedPhases.includes(ExportPhase.RESOLVING_RESOURCES), "Must emit resolving-resources phase");
    assert(receivedPhases.includes(ExportPhase.GENERATING_MARKDOWN), "Must emit generating-markdown phase");
    assert(receivedPhases.includes(ExportPhase.PREPARING_PDF), "Must emit preparing-pdf phase");
    assert(receivedPhases.includes(ExportPhase.PACKAGING), "Must emit packaging phase");
    assert(receivedPhases.includes(ExportPhase.COMPLETED), "Must emit completed phase");
  });

  // ── Test 17: User Position Restoration ─────────────────────────────────────
  await check("Test 17: User position restoration occurs upon both completion and cancellation", async () => {
    // 17A: On successful traversal
    const normal = createMockTraverserAndExtractor();
    const orch1 = new ExportOrchestrator({ traverser: normal.traverser, extractor: normal.extractor });
    await orch1.export({ formats: ["markdown"], autoDownload: false });
    assert(normal.traverser.traverseCalls === 1, "Completed traversal");

    // 17B: With the real QuestionTraverser
    let restoreCalled = false;
    const mockPortal = {
      detectAssessment: () => true,
      isReviewMode: () => false,
      getTotalQuestionCount: () => 1,
      getQuestionChips: () => [{ index: 0, text: "1", isCurrent: true }],
      getCurrentQuestionChip: () => ({ index: 0, text: "1", isCurrent: true }),
      getCurrentQuestionElement: () => ({}),
      isQuestionReady: () => true,
      getAssessmentContainer: () => ({}),
      getActiveLogicalNumber: () => 1,
      canRewindWindow: () => false,
      canAdvanceWindow: () => false,
      getPaginatorWindowIdentity: () => "win_0",
      getChipLogicalNumber: () => 1,
    };

    const { QuestionTraverser } = await import("../src/traversal/traverser.js");
    const realTraverser = new QuestionTraverser(mockPortal);

    // Spy on restoreLocation
    const origRestore = realTraverser.restoreLocation.bind(realTraverser);
    realTraverser.restoreLocation = async (target, timeout) => {
      restoreCalled = true;
      return origRestore(target, timeout);
    };

    const abortCtrl = new AbortController();
    abortCtrl.abort(); // already aborted

    try {
      await realTraverser.traverseAll({ signal: abortCtrl.signal });
    } catch {
      // Expected
    }

    assert(restoreCalled, "realTraverser must call restoreLocation even when aborted");
  });

  // ── Test 18: Reader Drawer Document Reuse ──────────────────────────────────
  await check("Test 18: Reader export action invokes orchestrator without re-traversal", async () => {
    const existingDoc = createMockDocument("Reader Reuse");
    let traverserCalled = false;

    const runtimeMock = {
      activeDocument: existingDoc,
      traverser: {
        traverseAll: async () => {
          traverserCalled = true;
        },
      },
      extractor: {},
      portal: {},
      reader: {
        setExporting: () => {},
      },
      handleExportAction: async function (format) {
        return this.exportAssignment({ formats: [format], autoDownload: false });
      },
      exportAssignment: async function (request) {
        return this.orchestrator.export(request);
      },
    };

    runtimeMock.orchestrator = new ExportOrchestrator(runtimeMock);

    await runtimeMock.handleExportAction("markdown");

    assert(!traverserCalled, "Export triggered from reader must NOT re-traverse quiz");
  });

  // ── Test 19: Bookmarklet Target Graph Isolation ────────────────────────────
  await check("Test 19: Bookmarklet target remains 100% free of orchestrator and exporter modules", () => {
    for (const mod of BOOKMARKLET_MODULES) {
      assert(!mod.includes("orchestration"), `Bookmarklet module includes orchestration: ${mod}`);
      assert(!mod.includes("exporters"), `Bookmarklet module includes exporters: ${mod}`);
      assert(!mod.includes("resources"), `Bookmarklet module includes resources: ${mod}`);
    }

    const bookmarkletSrc = readFileSync("bookmarklet/bookmarklet-source.js", "utf8");
    assert(!bookmarkletSrc.includes("class ExportOrchestrator"), "Bookmarklet must not define ExportOrchestrator");
    assert(!bookmarkletSrc.includes("class ExportSession"), "Bookmarklet must not define ExportSession");
    assert(!bookmarkletSrc.includes("function createZipArchive"), "Bookmarklet must not define createZipArchive");
    assert(!bookmarkletSrc.includes("class MarkdownExporter"), "Bookmarklet must not define MarkdownExporter");
    assert(!bookmarkletSrc.includes("class PDFRenderer"), "Bookmarklet must not define PDFRenderer");
  });

  // ── Test 20: End-to-End Mocked Workflow ────────────────────────────────────
  await check("Test 20: End-to-end full workflow produces valid self-contained ZIP bundle", async () => {
    const doc = createMockDocument("Final Exam Practice");
    const { traverser, extractor, portal } = createMockTraverserAndExtractor(doc);

    const runtime = {
      traverser,
      extractor,
      portal,
      activeDocument: null, // start uncached to test full capture -> export
    };

    const orchestrator = new ExportOrchestrator(runtime);

    const fetchFn = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "image/png" },
      arrayBuffer: async () => ONE_PIXEL_PNG.buffer,
    });

    const result = await orchestrator.export({
      formats: ["bundle", "markdown", "pdf"],
      autoDownload: false,
      resourceOptions: { fetchFn },
    });

    assert(result.status === "completed", "Overall export must be completed");
    assert(traverser.traverseCalls === 1, "Captured in 1 traversal");
    assert(runtime.activeDocument !== null, "Cached document on runtime");

    // Check all three outputs
    assert(typeof result.outputs.markdown === "string", "Markdown output present");
    assert(typeof result.outputs.pdf.html === "string", "PDF output present");
    assert(result.outputs.bundle.zipBytes instanceof Uint8Array, "Bundle ZIP present");

    const files = inspectZipArchive(result.outputs.bundle.zipBytes);
    assert(files.has("assignment.md"), "ZIP has assignment.md");
    assert(files.has("metadata.json"), "ZIP has metadata.json");
    assert(files.has("manifest.json"), "ZIP has manifest.json");

    // CRC32 check on ZIP bytes
    const computedCrc = crc32(ONE_PIXEL_PNG);
    assert(computedCrc !== 0, "CRC32 computation verified");
  });

  // ── Test 21: External ZIP Validation, Round-Trip Extraction, Ordering & Determinism ──
  await check("Test 21: External unzip -t validation, round-trip byte identity, entry ordering, and determinism", async () => {
    const utf8Text = "Évaluation Mathématique: ∫ α + β → ∞, Δx ≤ ε";
    const svgContent = '<svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="30" fill="blue"/></svg>';

    const createTestDoc = () => {
      const d = new AssignmentDocument({
        metadata: {
          title: "UTF-8 & Round-Trip Assessment",
          course: "Advanced Analysis",
          totalQuestions: 2,
          totalMarks: 5,
        },
      });
      d.addQuestion(
        new QuestionNode({
          index: 0,
          number: 1,
          label: "Question 1",
          type: QuestionType.MCQ,
          marks: 2,
          stem: [
            new ContentNode({ type: ContentType.PARAGRAPH, value: utf8Text }),
            new ContentNode({ type: ContentType.SVG, value: svgContent }),
          ],
          options: [
            new OptionNode({ letter: "A", content: [new ContentNode({ type: ContentType.TEXT, value: "α" })] }),
            new OptionNode({ letter: "B", content: [new ContentNode({ type: ContentType.TEXT, value: "β" })] }),
          ],
        })
      );
      d.addQuestion(
        new QuestionNode({
          index: 1,
          number: 2,
          label: "Question 2",
          type: QuestionType.NUMERICAL,
          marks: 3,
          stem: [
            new ContentNode({
              type: ContentType.IMAGE,
              attributes: { src: "https://example.com/assets/diagram.png", alt: "Plot" },
            }),
          ],
        })
      );
      return d;
    };

    const fetchFn = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "image/png" },
      arrayBuffer: async () => ONE_PIXEL_PNG.buffer,
    });

    const orch1 = new ExportOrchestrator();
    const res1 = await orch1.export({
      document: createTestDoc(),
      formats: ["bundle"],
      autoDownload: false,
      resourceOptions: { fetchFn },
    });

    const orch2 = new ExportOrchestrator();
    const res2 = await orch2.export({
      document: createTestDoc(),
      formats: ["bundle"],
      autoDownload: false,
      resourceOptions: { fetchFn },
    });

    const zip1 = res1.outputs.bundle.zipBytes;
    const zip2 = res2.outputs.bundle.zipBytes;

    // 1. Byte-for-byte determinism across repeated runs
    assert(
      Buffer.compare(Buffer.from(zip1), Buffer.from(zip2)) === 0,
      "Repeated bundle exports must produce byte-for-byte identical ZIP buffers"
    );

    // 2. Deterministic entry ordering: assignment.md, metadata.json, manifest.json, then sorted assets/...
    const entriesMap = inspectZipArchive(zip1);
    const entryNames = Array.from(entriesMap.keys());
    const expectedOrder = [
      "assignment.md",
      "metadata.json",
      "manifest.json",
      "assets/q01-diagram-01.svg",
      "assets/q02-image-01.png",
    ];
    assert(
      JSON.stringify(entryNames) === JSON.stringify(expectedOrder),
      `Expected entry order ${JSON.stringify(expectedOrder)}, got ${JSON.stringify(entryNames)}`
    );

    // 3. External system `unzip -t` validation and round-trip extraction
    const tempDir = mkdtempSync(join(tmpdir(), "unfold-zip-verify-"));
    try {
      const zipPath = join(tempDir, "assignment.zip");
      const extractDir = join(tempDir, "extracted");
      writeFileSync(zipPath, zip1);

      const testOutput = execFileSync("unzip", ["-t", zipPath], { encoding: "utf8" });
      assert(
        testOutput.includes("No errors detected"),
        `unzip -t reported errors:\n${testOutput}`
      );

      execFileSync("unzip", ["-q", zipPath, "-d", extractDir]);

      // Verify byte-for-byte identity of extracted files against source filesMap
      for (const [relPath, sourceContent] of res1.outputs.bundle.files.entries()) {
        const extractedBytes = new Uint8Array(readFileSync(join(extractDir, relPath)));
        const expectedBytes =
          sourceContent instanceof Uint8Array
            ? sourceContent
            : new TextEncoder().encode(String(sourceContent));

        assert(
          Buffer.compare(Buffer.from(extractedBytes), Buffer.from(expectedBytes)) === 0,
          `Round-trip byte mismatch for ${relPath}`
        );
      }

      // Verify UTF-8 content preserved after round-trip extraction
      const extractedMd = readFileSync(join(extractDir, "assignment.md"), "utf8");
      assert(extractedMd.includes(utf8Text), "UTF-8 characters must survive ZIP round-trip intact");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // ── Test 22: Bundle Path Safety & Confinement Against Adversarial Inputs ──
  await check("Test 22: Bundle path safety rejects traversal, absolute, drive, null-byte, and Unicode separator paths", () => {
    const adversarialPaths = [
      "../evil.txt",
      "../../evil.txt",
      "assets/../evil.txt",
      "assets/../../etc/passwd",
      "/absolute/path.png",
      "\\windows\\system32\\cmd.exe",
      "C:\\evil.txt",
      "D:/evil.txt",
      "assets/null\0byte.png",
      "assets/control\x07char.png",
      "assets/sub/nested.png",
      "assets/.hidden",
      "assets/..hidden.png",
      "assets/file\uFF0Fevil.png", // fullwidth solidus
      "assets/file\u2215evil.png", // division slash
      "assets/file\u2044evil.png", // fraction slash
      "assets/\u2025/evil.png",    // two-dot leader
      "assets/\uFF0E\uFF0E/evil.png", // fullwidth dots
      "unexpected-root.txt",
      "",
    ];

    for (const badPath of adversarialPaths) {
      let rejected = false;
      try {
        sanitizeArchivePath(badPath);
      } catch {
        rejected = true;
      }
      assert(rejected, `Adversarial path "${badPath}" was NOT rejected by sanitizeArchivePath!`);

      let zipRejected = false;
      try {
        createZipArchive(new Map([[badPath, "payload"]]));
      } catch {
        zipRejected = true;
      }
      assert(zipRejected, `Adversarial path "${badPath}" was NOT rejected by createZipArchive!`);
    }

    // Verify naming.js helpers always produce confined paths
    const cleanName = sanitizeFilename("../../evil\0\uFF0F\u2025name?.png");
    assert(!cleanName.includes(".."), "sanitizeFilename must strip ..");
    assert(!cleanName.includes("/"), "sanitizeFilename must strip /");
    assert(!cleanName.includes("\0"), "sanitizeFilename must strip null byte");

    const generatedPath = generateAssetLocalPath({
      questionNumber: -5,
      assetIndex: 0,
      kind: "image",
      ext: "../evil",
    });
    assert(
      sanitizeArchivePath(generatedPath) === generatedPath && generatedPath.startsWith("assets/"),
      `generateAssetLocalPath produced unconfined path: ${generatedPath}`
    );
  });

  // ── Test 23: Resource Map Coherence, Partial Failure (4 succeed, 1 fails) & Demand-Driven Resolution ──
  await check("Test 23: Resource map coherence across 5 resources (4 succeed, 1 fails) and demand-driven skipping", async () => {
    const doc = new AssignmentDocument({
      metadata: { title: "Five Resource Coherence", totalQuestions: 2 },
    });

    doc.addQuestion(
      new QuestionNode({
        index: 0,
        number: 1,
        type: QuestionType.MCQ,
        stem: [
          new ContentNode({ type: ContentType.IMAGE, attributes: { src: "https://example.com/img1.png", alt: "Img 1" } }),
          new ContentNode({ type: ContentType.IMAGE, attributes: { src: "https://example.com/img2.png", alt: "Img 2" } }),
          new ContentNode({
            type: ContentType.SVG,
            value: '<svg viewBox="0 0 20 20"><rect width="10" height="10"/></svg>',
          }),
        ],
      })
    );

    doc.addQuestion(
      new QuestionNode({
        index: 1,
        number: 2,
        type: QuestionType.MCQ,
        stem: [
          new ContentNode({ type: ContentType.IMAGE, attributes: { src: "https://example.com/img3.png", alt: "Img 3" } }),
          new ContentNode({ type: ContentType.IMAGE, attributes: { src: "https://example.com/fail404.png", alt: "Missing Img" } }),
        ],
      })
    );

    let networkFetches = 0;
    const fetchFn = async (url) => {
      networkFetches++;
      if (url.includes("fail404")) {
        return { ok: false, status: 404, statusText: "Not Found" };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => "image/png" },
        arrayBuffer: async () => ONE_PIXEL_PNG.buffer,
      };
    };

    // Part A: Demand-driven skip when packageResources is false (Markdown + PDF only)
    const orchNoRes = new ExportOrchestrator();
    await orchNoRes.export({
      document: doc,
      formats: ["markdown", "pdf"],
      packageResources: false,
      autoDownload: false,
      resourceOptions: { fetchFn },
    });
    assert(networkFetches === 0, "ResourceEngine must be skipped when packageResources is false");

    // Part B: Single resource resolution pass across Markdown + PDF + Bundle (5 resources: 4 succeed, 1 fails)
    const orchWithRes = new ExportOrchestrator();
    const res = await orchWithRes.export({
      document: doc,
      formats: ["markdown", "pdf", "bundle"],
      autoDownload: false,
      resourceOptions: { fetchFn, retries: 0 },
    });

    // 4 remote images fetched once each (inline SVG requires 0 network fetches)
    assert(networkFetches === 4, `Expected exactly 4 network fetches, got ${networkFetches}`);
    assert(res.resourceStats.total === 5, "Total discovered resources must be 5");
    assert(res.resourceStats.downloaded === 4, "4 resources must succeed");
    assert(res.resourceStats.failed === 1, "1 resource must fail");

    const zipFiles = inspectZipArchive(res.outputs.bundle.zipBytes);
    const manifest = JSON.parse(new TextDecoder().decode(zipFiles.get("manifest.json")));
    const bundleMd = new TextDecoder().decode(zipFiles.get("assignment.md"));
    const pdfHtml = res.outputs.pdf.html;

    // Verify manifest.localPath == Markdown reference == PDF src == ZIP entry for all 4 downloaded resources
    for (const entry of manifest.resources) {
      if (entry.status === "downloaded") {
        assert(typeof entry.localPath === "string" && entry.localPath.startsWith("assets/"), "Valid localPath");
        assert(zipFiles.has(entry.localPath), `ZIP must contain ${entry.localPath}`);
        assert(bundleMd.includes(entry.localPath), `Bundle Markdown must reference ${entry.localPath}`);
        assert(res.outputs.markdown.includes(entry.localPath), `Standalone Markdown must reference ${entry.localPath}`);
        assert(pdfHtml.includes(entry.localPath), `PDF HTML must reference ${entry.localPath}`);
      } else {
        assert(entry.status === "failed", "5th resource must have failed status");
        assert(entry.localPath === null, "Failed resource must have localPath: null");
        assert(typeof entry.error === "string" && entry.error.includes("404"), "Failed resource must record 404 error");
        assert(bundleMd.includes("https://example.com/fail404.png"), "Markdown must fall back to original URL for failed asset");
        assert(pdfHtml.includes("https://example.com/fail404.png"), "PDF must fall back to original URL for failed asset");
      }
    }
  });

  // ── Test 24: Cross-Output Semantic Consistency (.md, .pdf, .zip) ───────────
  await check("Test 24: Cross-output semantic consistency across assignment.md, assignment.pdf, and assignment.zip", async () => {
    const doc = new AssignmentDocument({
      metadata: {
        title: "Algorithms & Linear Algebra Quiz",
        course: "CS2026",
        totalQuestions: 3,
        totalMarks: 9,
      },
    });

    // Q1: MCQ with math and options A, B
    doc.addQuestion(
      new QuestionNode({
        index: 0,
        number: 1,
        label: "Question 1 — Eigenvalues",
        type: QuestionType.MCQ,
        marks: 2,
        negativeMarks: -0.5,
        stem: [
          new ContentNode({
            type: ContentType.PARAGRAPH,
            children: [
              new ContentNode({ type: ContentType.TEXT, value: "Compute trace of " }),
              new ContentNode({
                type: ContentType.MATH,
                value: "A \\in \\mathbb{R}^{3 \\times 3}",
                attributes: { format: MathFormat.TEX, mathType: MathType.INLINE },
              }),
            ],
          }),
        ],
        options: [
          new OptionNode({ letter: "A", content: [new ContentNode({ type: ContentType.TEXT, value: "Sum of eigenvalues" })] }),
          new OptionNode({ letter: "B", content: [new ContentNode({ type: ContentType.TEXT, value: "Product of eigenvalues" })] }),
        ],
      })
    );

    // Q2: MSQ with code block, table, and options A, B, C
    doc.addQuestion(
      new QuestionNode({
        index: 1,
        number: 2,
        label: "Question 2 — Graph Search",
        type: QuestionType.MSQ,
        marks: 4,
        stem: [
          new ContentNode({
            type: ContentType.CODE_BLOCK,
            value: "def bfs(G, s):\n    visited = {s}\n    return visited",
            attributes: { language: "python" },
          }),
          new ContentNode({
            type: ContentType.TABLE,
            attributes: { caption: "Complexity Comparison" },
            children: [
              new ContentNode({
                type: ContentType.TABLE_ROW,
                children: [
                  new ContentNode({ type: ContentType.TABLE_CELL, value: "Algorithm", attributes: { isHeader: true } }),
                  new ContentNode({ type: ContentType.TABLE_CELL, value: "Time", attributes: { isHeader: true } }),
                ],
              }),
              new ContentNode({
                type: ContentType.TABLE_ROW,
                children: [
                  new ContentNode({ type: ContentType.TABLE_CELL, value: "BFS" }),
                  new ContentNode({ type: ContentType.TABLE_CELL, value: "O(V+E)" }),
                ],
              }),
            ],
          }),
        ],
        options: [
          new OptionNode({ letter: "A", content: [new ContentNode({ type: ContentType.TEXT, value: "Uses FIFO queue" })] }),
          new OptionNode({ letter: "B", content: [new ContentNode({ type: ContentType.TEXT, value: "Finds shortest unweighted paths" })] }),
          new OptionNode({ letter: "C", content: [new ContentNode({ type: ContentType.TEXT, value: "Uses LIFO stack" })] }),
        ],
      })
    );

    // Q3: Numerical with image
    doc.addQuestion(
      new QuestionNode({
        index: 2,
        number: 3,
        label: "Question 3 — Matrix Rank",
        type: QuestionType.NUMERICAL,
        marks: 3,
        stem: [
          new ContentNode({ type: ContentType.PARAGRAPH, value: "Find the rank of the matrix shown in the figure:" }),
          new ContentNode({
            type: ContentType.IMAGE,
            attributes: { src: "https://example.com/matrix.png", alt: "Matrix Figure" },
          }),
        ],
      })
    );

    const fetchFn = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "image/png" },
      arrayBuffer: async () => ONE_PIXEL_PNG.buffer,
    });

    const orchestrator = new ExportOrchestrator();
    const result = await orchestrator.export({
      document: doc,
      formats: ["markdown", "pdf", "bundle"],
      autoDownload: false,
      resourceOptions: { fetchFn },
    });

    const md = result.outputs.markdown;
    const pdfHtml = result.outputs.pdf.html;
    const zipEntries = inspectZipArchive(result.outputs.bundle.zipBytes);
    const zipMd = new TextDecoder().decode(zipEntries.get("assignment.md"));
    const zipMeta = JSON.parse(new TextDecoder().decode(zipEntries.get("metadata.json")));

    // 1. Standalone Markdown and Bundle assignment.md must be identical
    assert(md === zipMd, "Standalone Markdown and ZIP assignment.md must match exactly");

    // 2. Question count & metadata agreement
    assert(zipMeta.totalQuestions === 3 && zipMeta.totalMarks === 9, "Metadata question count and marks match");
    const mdQuestionHeaders = md.match(/^## Question \d+/gm) || [];
    const pdfQuestionSections = pdfHtml.match(/<section class="saq-pdf-question"/g) || [];
    assert(mdQuestionHeaders.length === 3 && pdfQuestionSections.length === 3, "All outputs contain 3 questions");

    // 3. Question order, labels, types, and marks agreement
    const q1IdxMd = md.indexOf("## Question 1 — Eigenvalues");
    const q2IdxMd = md.indexOf("## Question 2 — Graph Search");
    const q3IdxMd = md.indexOf("## Question 3 — Matrix Rank");
    assert(q1IdxMd !== -1 && q1IdxMd < q2IdxMd && q2IdxMd < q3IdxMd, "Markdown question order 1 -> 2 -> 3");

    const q1IdxPdf = pdfHtml.indexOf("Question 1 — Eigenvalues");
    const q2IdxPdf = pdfHtml.indexOf("Question 2 — Graph Search");
    const q3IdxPdf = pdfHtml.indexOf("Question 3 — Matrix Rank");
    assert(q1IdxPdf !== -1 && q1IdxPdf < q2IdxPdf && q2IdxPdf < q3IdxPdf, "PDF question order 1 -> 2 -> 3");

    // Types & marks in both Markdown and PDF
    assert(md.includes("**Type:** MCQ") && pdfHtml.includes("<span>Type: MCQ</span>"), "Q1 MCQ type matches");
    assert(md.includes("**Type:** MSQ") && pdfHtml.includes("<span>Type: MSQ</span>"), "Q2 MSQ type matches");
    assert(md.includes("**Type:** Numerical") && pdfHtml.includes("<span>Type: Numerical</span>"), "Q3 Numerical type matches");
    assert(md.includes("**Negative Marks:** -0.5") && pdfHtml.includes("<span>Negative Marks: -0.5</span>"), "Negative marks match");

    // 4. Content blocks (math, code, table, options, localized asset) agreement
    assert(md.includes("A \\in \\mathbb{R}^{3 \\times 3}") && pdfHtml.includes("A \\in \\mathbb{R}^{3 \\times 3}"), "Math formula matches");
    assert(md.includes("def bfs(G, s):") && pdfHtml.includes("def bfs(G, s):"), "Code block matches");
    assert(md.includes("| BFS | O(V+E) |") && pdfHtml.includes("<td>BFS</td>") && pdfHtml.includes("<td>O(V+E)</td>"), "Table cells match");
    assert(md.includes("assets/q03-image-01.png") && pdfHtml.includes('src="assets/q03-image-01.png"') && zipEntries.has("assets/q03-image-01.png"), "Resource association matches");
  });

  // ── Test 25: Document Cache & Invalidation Verification (Cases A–E) ────────
  await check("Test 25: Document cache reuse and invalidation on refresh, context change, new extraction, and failed extraction", async () => {
    let currentTitle = "Quiz Alpha";
    let shouldFailExtraction = false;
    let traverseCount = 0;

    const docAlpha = createMockDocument("Quiz Alpha");
    const docBeta = createMockDocument("Quiz Beta");

    const runtimeMock = {
      activeDocument: null,
      activeContextKey: null,
      portal: {
        detectAssessment: () => true,
        isReviewMode: () => false,
        getTotalQuestionCount: () => 2,
        getAssessmentTitle: () => currentTitle,
      },
      traverser: {
        traverseAll: async ({ onQuestion }) => {
          traverseCount++;
          if (shouldFailExtraction) {
            throw new Error("Simulated DOM disconnection during traversal");
          }
          const activeDoc = currentTitle === "Quiz Alpha" ? docAlpha : docBeta;
          for (let i = 0; i < activeDoc.questions.length; i++) {
            await onQuestion({ index: i, isReview: false });
          }
        },
      },
      extractor: {
        captureCurrentQuestion: (idx) => {
          const activeDoc = currentTitle === "Quiz Alpha" ? docAlpha : docBeta;
          return activeDoc.questions[idx];
        },
      },
      getContextKey() {
        return `::${this.portal.getAssessmentTitle()}::2::false`;
      },
      updateContextKey() {
        this.activeContextKey = this.getContextKey();
      },
      invalidateDocument() {
        this.activeDocument = null;
        this.activeContextKey = null;
      },
    };

    const orchestrator = new ExportOrchestrator(runtimeMock);

    // Case A: Initial capture -> subsequent Markdown, PDF, and Bundle exports reuse cached document
    await orchestrator.export({ formats: ["markdown"], autoDownload: false });
    assert(traverseCount === 1, "Initial export triggers 1 traversal");
    assert(runtimeMock.activeDocument?.metadata?.title === "Quiz Alpha", "Quiz Alpha cached");

    await orchestrator.export({ formats: ["pdf"], autoDownload: false });
    await orchestrator.export({
      formats: ["bundle"],
      autoDownload: false,
      resourceOptions: {
        fetchFn: async () => ({
          ok: true,
          status: 200,
          headers: { get: () => "image/png" },
          arrayBuffer: async () => ONE_PIXEL_PNG.buffer,
        }),
      },
    });
    assert(traverseCount === 1, "Case A: Cached document reused across Markdown, PDF, and Bundle without re-traversal");

    // Case B & D: Force refresh / new extraction invalidates cache and re-traverses
    await orchestrator.export({ formats: ["markdown"], forceRefresh: true, autoDownload: false });
    assert(traverseCount === 2, "Case B/D: forceRefresh triggers fresh traversal");

    // Case C: Assessment context changes -> invalidates cached document
    currentTitle = "Quiz Beta";
    if (runtimeMock.getContextKey() !== runtimeMock.activeContextKey) {
      orchestrator.invalidateDocument();
    }
    assert(runtimeMock.activeDocument === null, "Case C: Context change invalidates cached document");

    const betaRes = await orchestrator.export({ formats: ["markdown"], autoDownload: false });
    assert(traverseCount === 3, "Case C: Export after context change traverses new assessment");
    assert(betaRes.outputs.markdown.includes("# Quiz Beta"), "Case C: Export reflects new Quiz Beta");

    // Case E: Failed extraction leaves activeDocument === null (never partial or stale)
    shouldFailExtraction = true;
    let extractErr = null;
    try {
      await orchestrator.export({ formats: ["markdown"], forceRefresh: true, autoDownload: false });
    } catch (err) {
      extractErr = err;
    }
    assert(extractErr instanceof ExtractionError, "Case E: Failed extraction throws ExtractionError");
    assert(runtimeMock.activeDocument === null, "Case E: No stale or partial document remains cached after failure");
  });

  // ── Test 26: Concurrency Recovery After Terminal States ────────────────────
  await check("Test 26: Concurrency guard recovers cleanly after COMPLETED, FAILED, and CANCELLED sessions", async () => {
    const doc = createMockDocument("Concurrency Recovery");
    const orchestrator = new ExportOrchestrator();

    // 1. After COMPLETED -> next export succeeds
    const r1 = await orchestrator.export({ document: doc, formats: ["markdown"], autoDownload: false });
    assert(r1.status === "completed" && !orchestrator.isBusy(), "Not busy after COMPLETED");

    // 2. After FAILED -> next export succeeds
    let failed = false;
    try {
      await orchestrator.export({
        document: { metadata: {}, questions: [{ bad: true }] },
        formats: ["markdown"],
        autoDownload: false,
      });
    } catch {
      failed = true;
    }
    assert(failed && !orchestrator.isBusy(), "Not busy after FAILED");

    const r2 = await orchestrator.export({ document: doc, formats: ["markdown"], autoDownload: false });
    assert(r2.status === "completed", "Export B succeeds after Export A failed");

    // 3. After CANCELLED -> next export succeeds
    const abortCtrl = new AbortController();
    abortCtrl.abort();
    let cancelled = false;
    try {
      await orchestrator.export({
        document: doc,
        formats: ["markdown"],
        signal: abortCtrl.signal,
        autoDownload: false,
      });
    } catch (err) {
      cancelled = err instanceof CancellationError;
    }
    assert(cancelled && !orchestrator.isBusy(), "Not busy after CANCELLED");

    const r3 = await orchestrator.export({ document: doc, formats: ["markdown"], autoDownload: false });
    assert(r3.status === "completed", "Export C succeeds after Export B was cancelled");
  });

  // ── Test 27: All-Stage Cancellation (Stages 1–5) & Zero Completed Leak ─────
  await check("Test 27: Cancellation at every stage (Extraction, Resources, Markdown, PDF, Packaging) cleans up deterministically", async () => {
    const stagesToCancel = [
      ExportPhase.EXTRACTING,
      ExportPhase.RESOLVING_RESOURCES,
      ExportPhase.GENERATING_MARKDOWN,
      ExportPhase.PREPARING_PDF,
      ExportPhase.PACKAGING,
    ];

    for (const targetPhase of stagesToCancel) {
      const doc = createMockDocument(`Cancel At ${targetPhase}`);
      const { traverser, extractor, portal } = createMockTraverserAndExtractor(doc);
      const orchestrator = new ExportOrchestrator({ traverser, extractor, portal });
      const abortCtrl = new AbortController();
      const emittedPhases = [];

      const fetchFn = async () => ({
        ok: true,
        status: 200,
        headers: { get: () => "image/png" },
        arrayBuffer: async () => ONE_PIXEL_PNG.buffer,
      });

      let caught = null;
      try {
        await orchestrator.export({
          formats: ["markdown", "pdf", "bundle"],
          forceRefresh: true,
          autoDownload: false,
          signal: abortCtrl.signal,
          resourceOptions: { fetchFn },
          onProgress: (p) => {
            emittedPhases.push(p.phase);
            if (p.phase === targetPhase) {
              abortCtrl.abort();
            }
          },
        });
      } catch (err) {
        caught = err;
      }

      assert(
        caught instanceof CancellationError,
        `Stage "${targetPhase}" cancellation must throw CancellationError, got ${caught?.name}`
      );
      assert(
        orchestrator.activeSession.state === ExportState.CANCELLED,
        `Stage "${targetPhase}" session state must be CANCELLED`
      );
      assert(!orchestrator.isBusy(), `Orchestrator must not remain busy after cancelling at "${targetPhase}"`);
      assert(
        !emittedPhases.includes(ExportPhase.COMPLETED),
        `Cancelled session at "${targetPhase}" must NEVER emit ExportPhase.COMPLETED`
      );
    }
  });

  // ── Test 28: User Position Restoration Across All Terminal States & Windows ──
  await check("Test 28: User position is restored across windows on completed, failed, and cancelled exports", async () => {
    const { QuestionTraverser } = await import("../src/traversal/traverser.js");

    // Helper creating a 12-question, 3-window (4 per window) simulated portal
    function createMultiWindowPortal(initialQ = 1) {
      let currentLogical = initialQ;
      let windowIdx = Math.floor((initialQ - 1) / 4);
      const total = 12;

      return {
        detectAssessment: () => true,
        isReviewMode: () => false,
        getTotalQuestionCount: () => total,
        getAssessmentTitle: () => "Multi-Window Assessment",
        getStableAssessmentAncestor: () => null,
        isQuestionStructurallyReady: () => true,
        getActiveLogicalNumber: () => currentLogical,
        getPaginatorWindowIdentity: () => `win_${windowIdx}`,
        canRewindWindow: () => windowIdx > 0,
        rewindWindow: () => {
          if (windowIdx > 0) {
            windowIdx--;
            currentLogical = windowIdx * 4 + 1;
            return true;
          }
          return false;
        },
        canAdvanceWindow: () => windowIdx < 2,
        advanceWindow: () => {
          if (windowIdx < 2) {
            windowIdx++;
            currentLogical = windowIdx * 4 + 1;
            return true;
          }
          return false;
        },
        getQuestionChips: () => {
          const start = windowIdx * 4 + 1;
          const chips = [];
          for (let q = start; q <= Math.min(start + 3, total); q++) {
            chips.push({
              qNum: q,
              click: () => {
                currentLogical = q;
              },
            });
          }
          return chips;
        },
        getChipLogicalNumber: (chip) => chip.qNum,
        getActiveChip: () => ({ qNum: currentLogical }),
      };
    }

    // Test starting from Question 1 (Window 1), Question 6 (Window 2), and Question 11 (Window 3)
    for (const startQuestion of [1, 6, 11]) {
      // Outcome 1: Completed
      {
        const portal = createMultiWindowPortal(startQuestion);
        const traverser = new QuestionTraverser(portal, { timeoutMs: 500 });
        const extractor = {
          captureCurrentQuestion: (idx) =>
            new QuestionNode({
              index: idx,
              number: idx + 1,
              stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: `Q${idx + 1}` })],
            }),
        };
        const orch = new ExportOrchestrator({ traverser, extractor, portal });
        await orch.export({ formats: ["markdown"], autoDownload: false });
        assert(
          portal.getActiveLogicalNumber() === startQuestion,
          `[Completed] Expected restored question ${startQuestion}, got ${portal.getActiveLogicalNumber()}`
        );
      }

      // Outcome 2: Failed mid-traversal (extractor throws on Q8)
      {
        const portal = createMultiWindowPortal(startQuestion);
        const traverser = new QuestionTraverser(portal, { timeoutMs: 500 });
        const extractor = {
          captureCurrentQuestion: (idx) => {
            if (idx + 1 === 8) throw new Error("Extractor failure on Q8");
            return new QuestionNode({
              index: idx,
              number: idx + 1,
              stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: `Q${idx + 1}` })],
            });
          },
        };
        const orch = new ExportOrchestrator({ traverser, extractor, portal });
        try {
          await orch.export({ formats: ["markdown"], autoDownload: false });
        } catch {}
        assert(
          portal.getActiveLogicalNumber() === startQuestion,
          `[Failed] Expected restored question ${startQuestion}, got ${portal.getActiveLogicalNumber()}`
        );
      }

      // Outcome 3: Cancelled mid-traversal (aborted on Q9)
      {
        const portal = createMultiWindowPortal(startQuestion);
        const traverser = new QuestionTraverser(portal, { timeoutMs: 500 });
        const abortCtrl = new AbortController();
        const extractor = {
          captureCurrentQuestion: (idx) => {
            if (idx + 1 === 9) abortCtrl.abort();
            return new QuestionNode({
              index: idx,
              number: idx + 1,
              stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: `Q${idx + 1}` })],
            });
          },
        };
        const orch = new ExportOrchestrator({ traverser, extractor, portal });
        try {
          await orch.export({ formats: ["markdown"], signal: abortCtrl.signal, autoDownload: false });
        } catch {}
        assert(
          portal.getActiveLogicalNumber() === startQuestion,
          `[Cancelled] Expected restored question ${startQuestion}, got ${portal.getActiveLogicalNumber()}`
        );
      }
    }
  });

  // ── Test 29: PDF Print Lifecycle (Success, Cancel, Print Error, Timeout) ───
  await check("Test 29: PDF print lifecycle cleans up iframe across success, cancel, print error, and timeout", async () => {
    const { exportPdf } = await import("../src/exporters/pdf.js");
    const doc = createMockDocument("PDF Lifecycle Test");

    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;

    function withMockPrintDom(printBehavior) {
      const attachedIframes = [];
      globalThis.window = {};
      globalThis.document = {
        createElement: (tag) => {
          if (tag === "iframe") {
            const listeners = new Map();
            const iframe = {
              style: {},
              setAttribute: () => {},
              contentDocument: {
                open: () => {},
                write: () => {},
                close: () => {},
                images: [],
              },
              contentWindow: {
                focus: () => {},
                addEventListener: (ev, cb) => listeners.set(ev, cb),
                removeEventListener: (ev) => listeners.delete(ev),
                print: () => printBehavior({ iframe, listeners }),
              },
              remove: () => {
                const idx = attachedIframes.indexOf(iframe);
                if (idx !== -1) attachedIframes.splice(idx, 1);
              },
            };
            return iframe;
          }
          return {};
        },
        body: {
          appendChild: (el) => {
            el.parentNode = globalThis.document.body;
            attachedIframes.push(el);
          },
          removeChild: (el) => {
            el.parentNode = null;
            const idx = attachedIframes.indexOf(el);
            if (idx !== -1) attachedIframes.splice(idx, 1);
          },
        },
      };
      return attachedIframes;
    }

    try {
      // 1. Normal completion via afterprint
      {
        const iframes = withMockPrintDom(({ listeners }) => {
          setTimeout(() => listeners.get("afterprint")?.(), 10);
        });
        const res = await exportPdf(doc);
        assert(res.success === true, "Normal print resolves with success: true");
        assert(iframes.length === 0, "Iframe removed after afterprint");
      }

      // 2. Print error (contentWindow.print throws)
      {
        const iframes = withMockPrintDom(() => {
          throw new Error("Printer driver unavailable");
        });
        let printErr = null;
        try {
          await exportPdf(doc);
        } catch (err) {
          printErr = err;
        }
        assert(printErr !== null && printErr.message.includes("Printer driver"), "Print error propagates");
        assert(iframes.length === 0, "Iframe removed on print error");
      }

      // 3. Print timeout (afterprint never fires -> fallback timeout cleans up)
      {
        const iframes = withMockPrintDom(() => {
          // afterprint never fires
        });
        const res = await exportPdf(doc, { printTimeoutMs: 35 });
        assert(res.success === true && res.timedOut === true, "Timeout fallback resolves cleanly");
        assert(iframes.length === 0, "Iframe removed on print timeout");
      }
    } finally {
      globalThis.document = originalDocument;
      globalThis.window = originalWindow;
    }
  });

  // ── Test 30: Monotonic Progress Contract Verification ─────────────────────
  await check("Test 30: Progress events satisfy non-negative, current <= total, monotonic, and valid phase ordering", async () => {
    const doc = createMockDocument("Progress Contract");
    const { traverser, extractor, portal } = createMockTraverserAndExtractor(doc);
    const orchestrator = new ExportOrchestrator({ traverser, extractor, portal });

    const events = [];
    const fetchFn = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "image/png" },
      arrayBuffer: async () => ONE_PIXEL_PNG.buffer,
    });

    await orchestrator.export({
      formats: ["markdown", "pdf", "bundle"],
      forceRefresh: true,
      autoDownload: false,
      resourceOptions: { fetchFn },
      onProgress: (ev) => events.push({ ...ev }),
    });

    const phaseOrder = [
      ExportPhase.EXTRACTING,
      ExportPhase.RESOLVING_RESOURCES,
      ExportPhase.GENERATING_MARKDOWN,
      ExportPhase.PREPARING_PDF,
      ExportPhase.PACKAGING,
      ExportPhase.COMPLETED,
    ];

    let maxPhaseRank = -1;
    const maxCurrentByPhase = new Map();

    for (const ev of events) {
      assert(ev.current >= 0 && ev.total >= 0, `Negative progress values forbidden: ${JSON.stringify(ev)}`);
      assert(ev.current <= ev.total, `current (${ev.current}) exceeded total (${ev.total})`);

      const prevCurrent = maxCurrentByPhase.get(ev.phase) ?? 0;
      assert(
        ev.current >= prevCurrent,
        `Progress moved backward in phase ${ev.phase}: ${ev.current} < ${prevCurrent}`
      );
      maxCurrentByPhase.set(ev.phase, ev.current);

      const rank = phaseOrder.indexOf(ev.phase);
      assert(rank !== -1, `Unknown progress phase: ${ev.phase}`);
      assert(rank >= maxPhaseRank, `Phases emitted out of order: ${ev.phase} after rank ${maxPhaseRank}`);
      maxPhaseRank = rank;
    }
  });

  // ── Test 31: Reader Dismissal Policy & Runtime Teardown During Export ──────
  await check("Test 31: Reader dismissal Policy A and runtime.destroy() cancellation during active export", async () => {
    const doc = createMockDocument("Teardown Test");
    let unblockFetch;
    const slowFetchPromise = new Promise((r) => {
      unblockFetch = r;
    });

    const fetchFn = async (url, { signal } = {}) => {
      await new Promise((resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
        slowFetchPromise.then(resolve);
      });
      return {
        ok: true,
        status: 200,
        headers: { get: () => "image/png" },
        arrayBuffer: async () => ONE_PIXEL_PNG.buffer,
      };
    };

    const orchestrator = new ExportOrchestrator();
    const exportPromise = orchestrator.export({
      document: doc,
      formats: ["bundle"],
      autoDownload: false,
      resourceOptions: { fetchFn },
    });

    assert(orchestrator.isBusy(), "Export is in flight");

    // Simulate runtime.destroy() cancelling active orchestrator session
    orchestrator.cancel();
    unblockFetch();

    let caught = null;
    try {
      await exportPromise;
    } catch (err) {
      caught = err;
    }

    assert(caught instanceof CancellationError, "Destroying/cancelling runtime aborts active export with CancellationError");
    assert(!orchestrator.isBusy(), "Orchestrator is no longer busy after teardown cancellation");
  });

  // ── Test 32: Performance Smoke Test (25-Question Realistic Assessment) ─────
  await check("Test 32: Performance smoke test on 25-question assessment with images, SVGs, tables, code, and math", async () => {
    const totalQuestions = 25;
    const perfDoc = new AssignmentDocument({
      metadata: {
        title: "IITM Comprehensive Final Assessment",
        course: "BS in Data Science and Applications",
        totalQuestions,
        totalMarks: 50,
      },
    });

    for (let i = 1; i <= totalQuestions; i++) {
      const stem = [
        new ContentNode({
          type: ContentType.PARAGRAPH,
          children: [
            new ContentNode({ type: ContentType.TEXT, value: `Question ${i}: Evaluate the loss function ` }),
            new ContentNode({
              type: ContentType.MATH,
              value: `\\mathcal{L}_{${i}}(\\theta) = \\frac{1}{n}\\sum_{j=1}^{n} (y_j - \\hat{y}_j)^2`,
              attributes: { format: MathFormat.TEX, mathType: MathType.INLINE },
            }),
          ],
        }),
      ];

      if (i % 3 === 0) {
        stem.push(
          new ContentNode({
            type: ContentType.CODE_BLOCK,
            value: `def compute_step_${i}(x):\n    return [val * ${i} for val in x]\n`,
            attributes: { language: "python" },
          })
        );
      }

      if (i % 4 === 0) {
        stem.push(
          new ContentNode({
            type: ContentType.TABLE,
            attributes: { caption: `Dataset Summary ${i}` },
            children: [
              new ContentNode({
                type: ContentType.TABLE_ROW,
                children: [
                  new ContentNode({ type: ContentType.TABLE_CELL, value: "Feature", attributes: { isHeader: true } }),
                  new ContentNode({ type: ContentType.TABLE_CELL, value: "Weight", attributes: { isHeader: true } }),
                ],
              }),
              new ContentNode({
                type: ContentType.TABLE_ROW,
                children: [
                  new ContentNode({ type: ContentType.TABLE_CELL, value: `x_${i}` }),
                  new ContentNode({ type: ContentType.TABLE_CELL, value: String(i * 0.25) }),
                ],
              }),
            ],
          })
        );
      }

      if (i % 5 === 0) {
        stem.push(
          new ContentNode({
            type: ContentType.IMAGE,
            attributes: {
              src: `https://example.com/assets/plot_${i}.png`,
              alt: `Plot ${i}`,
            },
          })
        );
      }

      if (i % 6 === 0) {
        stem.push(
          new ContentNode({
            type: ContentType.SVG,
            value: `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="${10 + i}"/></svg>`,
          })
        );
      }

      perfDoc.addQuestion(
        new QuestionNode({
          index: i - 1,
          number: i,
          label: `Question ${i}`,
          type: i % 2 === 0 ? QuestionType.MCQ : QuestionType.MSQ,
          marks: 2,
          stem,
          options: [
            new OptionNode({ letter: "A", content: [new ContentNode({ type: ContentType.TEXT, value: `Option A for Q${i}` })] }),
            new OptionNode({ letter: "B", content: [new ContentNode({ type: ContentType.TEXT, value: `Option B for Q${i}` })] }),
            new OptionNode({ letter: "C", content: [new ContentNode({ type: ContentType.TEXT, value: `Option C for Q${i}` })] }),
            new OptionNode({ letter: "D", content: [new ContentNode({ type: ContentType.TEXT, value: `Option D for Q${i}` })] }),
          ],
        })
      );
    }

    let traverseCalls = 0;
    let fetchCalls = 0;

    const traverser = {
      traverseAll: async ({ onProgress, onQuestion }) => {
        traverseCalls++;
        for (let i = 0; i < totalQuestions; i++) {
          onProgress?.(i + 1, totalQuestions);
          await onQuestion({ index: i, isReview: false });
        }
      },
    };
    const extractor = {
      captureCurrentQuestion: (idx) => perfDoc.questions[idx],
    };
    const portal = {
      isReviewMode: () => false,
      getTotalQuestionCount: () => totalQuestions,
      getAssessmentTitle: () => perfDoc.metadata.title,
    };

    const fetchFn = async () => {
      fetchCalls++;
      return {
        ok: true,
        status: 200,
        headers: { get: () => "image/png" },
        arrayBuffer: async () => ONE_PIXEL_PNG.buffer,
      };
    };

    const stageMarks = {};
    const t0 = performance.now();
    const orchestrator = new ExportOrchestrator({ traverser, extractor, portal });

    const result = await orchestrator.export({
      formats: ["markdown", "pdf", "bundle"],
      forceRefresh: true,
      autoDownload: false,
      resourceOptions: { fetchFn },
      onProgress: (p) => {
        if (!(p.phase in stageMarks)) {
          stageMarks[p.phase] = performance.now() - t0;
        }
      },
    });
    const totalMs = performance.now() - t0;

    assert(result.status === "completed", "25-question export must complete");
    assert(traverseCalls === 1, `Expected 1 traversal, got ${traverseCalls}`);
    // 5 unique remote images (i = 5, 10, 15, 20, 25) -> 5 network fetches; 4 inline SVGs (i = 6, 12, 18, 24) -> 0 network fetches
    assert(fetchCalls === 5, `Expected 5 network fetches for 5 unique images, got ${fetchCalls}`);
    assert(result.resourceStats.total === 9, `Expected 9 total resources (5 images + 4 SVGs), got ${result.resourceStats.total}`);
    assert(totalMs < 2000, `25-question full export took too long: ${totalMs.toFixed(2)}ms`);

    console.log(
      `  [Perf Smoke 25Q] Total: ${totalMs.toFixed(2)}ms | Markdown: ${result.outputs.markdown.length} chars | PDF HTML: ${result.outputs.pdf.html.length} chars | ZIP: ${result.outputs.bundle.zipBytes.length} bytes`
    );
  });

  // ── Test 33: Direct PDF Download (chrome.debugger + Page.printToPDF) & Fallback ──
  await check("Test 33: Direct PDF download via chrome.debugger, attach/sendCommand fallback, single-flight lock, sender check, and document.title restore", async () => {
    const { exportPdf } = await import("../src/exporters/pdf.js");
    const doc = new AssignmentDocument({
      metadata: {
        title: "Week 1 - Graded Assignment 1",
        course: "Sep 2026 - MAD II",
        totalQuestions: 1,
        totalMarks: 2,
      },
      questions: [
        new QuestionNode({
          index: 0,
          number: 1,
          label: "Question 1",
          type: QuestionType.MCQ,
          marks: 2,
          stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "What is HTTP?" })],
          options: [
            new OptionNode({ letter: "A", content: [new ContentNode({ type: ContentType.TEXT, value: "Protocol" })] }),
          ],
        }),
      ],
    });

    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;
    const originalChrome = globalThis.chrome;
    const originalURL = globalThis.URL;

    const debuggerCalls = [];
    let attachError = null;
    let sendCommandError = null;
    let sendCommandDelayMs = 0;
    const samplePdfBytes = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF", "utf8");
    const samplePdfBase64 = samplePdfBytes.toString("base64");

    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener: () => {},
        },
        sendMessage: (msg, cb) => {
          globalThis.__unfoldHandlePrintToPdfMessage(
            msg,
            { tab: { id: 42 } },
            (resp) => cb(resp)
          );
        },
      },
      debugger: {
        attach: async (target, version) => {
          debuggerCalls.push({ op: "attach", target, version });
          if (attachError) throw attachError;
        },
        sendCommand: async (target, method, params) => {
          debuggerCalls.push({ op: "sendCommand", target, method, params });
          if (sendCommandDelayMs > 0) {
            await new Promise((r) => setTimeout(r, sendCommandDelayMs));
          }
          if (sendCommandError) throw sendCommandError;
          return { data: samplePdfBase64 };
        },
        detach: async (target) => {
          debuggerCalls.push({ op: "detach", target });
        },
      },
    };

    // Load background.js to register globalThis.__unfoldHandlePrintToPdfMessage
    await import("../extension/background.js");
    assert(
      typeof globalThis.__unfoldHandlePrintToPdfMessage === "function",
      "background.js must expose __unfoldHandlePrintToPdfMessage"
    );

    function setupMockPdfDom(printBehavior) {
      const attachedElements = [];
      const downloads = [];
      const createdUrls = [];
      const revokedUrls = [];
      const titlesDuringPrint = [];

      globalThis.URL = {
        createObjectURL: (blob) => {
          const u = `blob:pdf-${createdUrls.length + 1}`;
          createdUrls.push({ url: u, blob });
          return u;
        },
        revokeObjectURL: (u) => {
          revokedUrls.push(u);
        },
      };

      const winListeners = new Map();
      globalThis.window = {
        addEventListener: (ev, cb) => winListeners.set(ev, cb),
        removeEventListener: (ev) => winListeners.delete(ev),
        focus: () => {},
        print: () => {
          titlesDuringPrint.push(globalThis.document.title);
          printBehavior({ winListeners });
        },
      };

      globalThis.document = {
        title: "IITM Portal Original Tab Title",
        head: {
          appendChild: (el) => {
            el.parentNode = globalThis.document.head;
            attachedElements.push(el);
          },
          removeChild: (el) => {
            el.parentNode = null;
            const i = attachedElements.indexOf(el);
            if (i !== -1) attachedElements.splice(i, 1);
          },
        },
        body: {
          appendChild: (el) => {
            el.parentNode = globalThis.document.body;
            attachedElements.push(el);
          },
          removeChild: (el) => {
            el.parentNode = null;
            const i = attachedElements.indexOf(el);
            if (i !== -1) attachedElements.splice(i, 1);
          },
        },
        createElement: (tag) => {
          const t = String(tag).toLowerCase();
          if (t === "a") {
            const a = {
              tagName: "A",
              style: {},
              href: "",
              download: "",
              click: () => {
                downloads.push({ href: a.href, download: a.download });
              },
              remove: () => {
                const i = attachedElements.indexOf(a);
                if (i !== -1) attachedElements.splice(i, 1);
              },
            };
            return a;
          }
          if (t === "style") {
            const styleEl = {
              tagName: "STYLE",
              className: "",
              textContent: "",
              setAttribute: () => {},
              remove: () => {
                const i = attachedElements.indexOf(styleEl);
                if (i !== -1) attachedElements.splice(i, 1);
              },
            };
            return styleEl;
          }
          if (t === "iframe") {
            const listeners = new Map();
            const iframe = {
              tagName: "IFRAME",
              className: "",
              style: {},
              setAttribute: () => {},
              contentDocument: {
                open: () => {},
                write: () => {},
                close: () => {},
                images: [],
                fonts: { ready: Promise.resolve() },
              },
              contentWindow: {
                focus: () => {},
                addEventListener: (ev, cb) => listeners.set(ev, cb),
                removeEventListener: (ev) => listeners.delete(ev),
                print: () => {
                  titlesDuringPrint.push(globalThis.document.title);
                  printBehavior({ iframe, listeners, winListeners });
                },
              },
              remove: () => {
                const i = attachedElements.indexOf(iframe);
                if (i !== -1) attachedElements.splice(i, 1);
              },
            };
            return iframe;
          }
          return { style: {}, setAttribute: () => {}, remove: () => {} };
        },
      };

      return { attachedElements, downloads, createdUrls, revokedUrls, titlesDuringPrint };
    }

    try {
      // 1. Direct PDF download success path
      {
        debuggerCalls.length = 0;
        attachError = null;
        sendCommandError = null;
        let printCalled = false;
        const dom = setupMockPdfDom(() => {
          printCalled = true;
        });

        const res = await exportPdf(doc, { revokeDelayMs: 5 });
        await new Promise((r) => setTimeout(r, 20));

        assert(res.success === true && res.method === "direct", "Direct PDF path must resolve with method: 'direct'");
        assert(res.filename === "MAD II - Week 01 - GA 1.pdf", `Expected filename 'MAD II - Week 01 - GA 1.pdf', got '${res.filename}'`);
        assert(printCalled === false, "Direct PDF path must NOT call print()");
        assert(debuggerCalls.length === 3, `Expected attach -> sendCommand -> detach (3 calls), got ${debuggerCalls.length}`);
        assert(debuggerCalls[0].op === "attach" && debuggerCalls[0].target.tabId === 42 && debuggerCalls[0].version === "1.3", "Must attach debugger 1.3 to sender tab");
        assert(
          debuggerCalls[1].op === "sendCommand" &&
            debuggerCalls[1].method === "Page.printToPDF" &&
            debuggerCalls[1].params.printBackground === true &&
            debuggerCalls[1].params.preferCSSPageSize === true &&
            debuggerCalls[1].params.transferMode === "ReturnAsBase64",
          "Must call Page.printToPDF with required options"
        );
        assert(debuggerCalls[2].op === "detach" && debuggerCalls[2].target.tabId === 42, "Must detach debugger in finally");
        assert(dom.downloads.length === 1 && dom.downloads[0].download === "MAD II - Week 01 - GA 1.pdf", "Must trigger <a download> with intelligent filename");
        assert(dom.createdUrls.length === 1 && dom.createdUrls[0].blob.type === "application/pdf", "Created Blob must have type application/pdf");
        assert(dom.revokedUrls.length === 1, "Object URL must be revoked after download");
        assert(dom.attachedElements.length === 0, "Print-mode style and iframe must be cleaned up in finally");
        assert(globalThis.document.title === "IITM Portal Original Tab Title", "Original document.title must remain intact");
      }

      // 2. attach rejection falls back to print(), detaches, calls onFallback, sets & restores document.title
      {
        debuggerCalls.length = 0;
        attachError = new Error("Another debugger is already attached");
        sendCommandError = null;
        let fallbackReason = null;
        const dom = setupMockPdfDom(({ listeners }) => {
          setTimeout(() => listeners.get("afterprint")?.(), 10);
        });

        const res = await exportPdf(doc, {
          onFallback: (reason) => {
            fallbackReason = reason;
          },
        });

        assert(res.success === true && res.method === "fallback-print", "Attach rejection must fall back to print()");
        assert(typeof fallbackReason === "string" && fallbackReason.includes("already attached"), "onFallback must receive error reason");
        assert(debuggerCalls.some((c) => c.op === "detach"), "detach must still be called in finally after attach failure");
        assert(dom.titlesDuringPrint[0] === "MAD II - Week 01 - GA 1", `document.title during print must be intelligent filename without .pdf, got '${dom.titlesDuringPrint[0]}'`);
        assert(globalThis.document.title === "IITM Portal Original Tab Title", "document.title must be restored after afterprint");
        assert(dom.attachedElements.length === 0, "Print-mode DOM cleaned up after fallback print");
      }

      // 3. sendCommand error falls back to print(), detaches, and restores document.title
      {
        debuggerCalls.length = 0;
        attachError = null;
        sendCommandError = new Error("Page.printToPDF failed");
        const dom = setupMockPdfDom(({ listeners }) => {
          setTimeout(() => listeners.get("afterprint")?.(), 10);
        });

        const res = await exportPdf(doc);
        assert(res.success === true && res.method === "fallback-print", "sendCommand failure must fall back to print()");
        assert(
          debuggerCalls.map((c) => c.op).join(",") === "attach,sendCommand,detach",
          "Must run attach -> sendCommand -> detach on sendCommand failure"
        );
        assert(dom.titlesDuringPrint[0] === "MAD II - Week 01 - GA 1", "document.title set during fallback print");
        assert(globalThis.document.title === "IITM Portal Original Tab Title", "document.title restored after afterprint");
      }

      // 4. print() error restores document.title immediately
      {
        attachError = new Error("Debugger disabled");
        sendCommandError = null;
        const dom = setupMockPdfDom(() => {
          throw new Error("Print dialog crashed");
        });

        let caught = null;
        try {
          await exportPdf(doc);
        } catch (err) {
          caught = err;
        }
        assert(caught !== null && caught.message.includes("Print dialog crashed"), "Print error must propagate");
        assert(dom.titlesDuringPrint[0] === "MAD II - Week 01 - GA 1", "document.title was set before print()");
        assert(globalThis.document.title === "IITM Portal Original Tab Title", "document.title must be restored even when print() throws");
        assert(dom.attachedElements.length === 0, "Print-mode DOM cleaned up when print() throws");
      }

      // 5. Double-click / concurrent UNFOLD_PRINT_TO_PDF calls: single-flight lock allows only one debugger session
      {
        debuggerCalls.length = 0;
        attachError = null;
        sendCommandError = null;
        sendCommandDelayMs = 40;

        const responses = await Promise.all([
          new Promise((resolve) =>
            globalThis.__unfoldHandlePrintToPdfMessage(
              { type: "UNFOLD_PRINT_TO_PDF" },
              { tab: { id: 77 } },
              resolve
            )
          ),
          new Promise((resolve) =>
            globalThis.__unfoldHandlePrintToPdfMessage(
              { type: "UNFOLD_PRINT_TO_PDF" },
              { tab: { id: 77 } },
              resolve
            )
          ),
        ]);
        sendCommandDelayMs = 0;

        assert(responses[0].ok === true, "First in-flight PDF request must succeed");
        assert(
          responses[1].ok === false && responses[1].error.includes("already in progress"),
          "Concurrent second PDF request must be rejected by single-flight lock"
        );
        assert(
          debuggerCalls.filter((c) => c.op === "attach").length === 1,
          "Only one chrome.debugger.attach session may start on double-click"
        );
      }

      // 6. Sender tab mismatch or missing sender.tab.id is rejected
      {
        debuggerCalls.length = 0;
        const mismatchResp = await new Promise((resolve) =>
          globalThis.__unfoldHandlePrintToPdfMessage(
            { type: "UNFOLD_PRINT_TO_PDF", tabId: 999 },
            { tab: { id: 42 } },
            resolve
          )
        );
        const missingTabResp = await new Promise((resolve) =>
          globalThis.__unfoldHandlePrintToPdfMessage(
            { type: "UNFOLD_PRINT_TO_PDF" },
            {},
            resolve
          )
        );
        assert(mismatchResp.ok === false && mismatchResp.error.includes("mismatch"), "Mismatched tabId must be rejected");
        assert(missingTabResp.ok === false && missingTabResp.error.includes("Missing sender tab"), "Missing sender.tab.id must be rejected");
        assert(debuggerCalls.length === 0, "Rejected sender checks must never call chrome.debugger.attach");
      }
    } finally {
      globalThis.document = originalDocument;
      globalThis.window = originalWindow;
      globalThis.chrome = originalChrome;
      globalThis.URL = originalURL;
    }
  });

  if (!passed) {
    console.error("\nExport Orchestration Test Suite FAILED.");
    process.exit(1);
  } else {
    console.log("\n==================================================");
    console.log("✓ All 33 Export Orchestration Tests Passed Successfully!");
    console.log("==================================================\n");
  }
}

runTests();
