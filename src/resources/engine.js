/**
 * Resource & Asset Engine Orchestrator.
 * 
 * Transforms canonical AssignmentDocument resource references into a portable,
 * self-contained assignment bundle with localized Markdown and assets.
 * Operates with zero browser or DOM dependencies.
 */

import { ResourceStatus, ResourceKind } from "./types.js";
import { discoverResources } from "./discover.js";
import { acquireAllResources } from "./fetch.js";
import { inferExtension, generateAssetLocalPath } from "./naming.js";
import { exportAssignmentToMarkdown } from "../exporters/markdown.js";

export class ResourceEngine {
  constructor(options = {}) {
    this.options = {
      concurrency: 4,
      timeoutMs: 5000,
      retries: 1,
      baseUrl: "",
      fetchFn: null,
      ...options,
    };
  }

  /**
   * Main entry point: builds a self-contained portable assignment bundle.
   * Preserves canonical model immutability (the input AssignmentDocument is never mutated).
   * @param {Object} assignmentDoc AssignmentDocument
   * @param {Object} [options]
   * @returns {Promise<Object>} Portable bundle result
   */
  async buildBundle(assignmentDoc, options = {}) {
    if (!assignmentDoc || !Array.isArray(assignmentDoc.questions)) {
      throw new TypeError("AssignmentDocument is required to build an assignment bundle.");
    }

    const mergedOptions = { ...this.options, ...options };

    // 1. Discover all embedded resources without mutating the AST
    const { resources, resourceMap } = discoverResources(assignmentDoc, {
      baseUrl: mergedOptions.baseUrl,
    });

    // 2. Fetch and materialize assets in a bounded concurrency pool
    await acquireAllResources(resources, mergedOptions);

    // 3. Post-acquisition path refinement & resource map finalization
    // If validated MIME type or magic bytes suggest a different extension, refine localPath
    const activeResourceMap = new Map();

    for (const res of resources) {
      if (res.status === ResourceStatus.DOWNLOADED) {
        const accurateExt = inferExtension(res.mimeType, res.source, res.data);
        if (!res.localPath.endsWith(accurateExt)) {
          const oldPath = res.localPath;
          const dotIdx = oldPath.lastIndexOf(".");
          const basePath = dotIdx !== -1 ? oldPath.slice(0, dotIdx) : oldPath;
          res.localPath = `${basePath}${accurateExt}`;
        }

        // Map both original source and normalized source to verified local path
        activeResourceMap.set(res.source, res.localPath);
        if (res.normalizedSource) {
          activeResourceMap.set(res.normalizedSource, res.localPath);
        }
      }
    }

    // 4. Generate portable Markdown using the localized resource map
    const markdown = exportAssignmentToMarkdown(assignmentDoc, {
      ...mergedOptions,
      resourceMap: activeResourceMap,
    });

    // 5. Construct machine-readable asset manifest
    const downloadedCount = resources.filter((r) => r.status === ResourceStatus.DOWNLOADED).length;
    const failedCount = resources.filter(
      (r) => r.status === ResourceStatus.FAILED || r.status === ResourceStatus.UNSUPPORTED
    ).length;

    const manifest = {
      version: "1.0.0",
      totalResources: resources.length,
      downloaded: downloadedCount,
      failed: failedCount,
      resources: resources.map((r) => ({
        id: r.id,
        kind: r.kind,
        source: r.source,
        localPath: r.status === ResourceStatus.DOWNLOADED ? r.localPath : null,
        mimeType: r.mimeType,
        byteSize: r.byteSize,
        contentHash: r.contentHash,
        status: r.status,
        questions: r.questions,
        error: r.error || undefined,
      })),
    };

    // 6. Construct bundle metadata
    const metadata = {
      title: assignmentDoc.metadata?.title || "Assignment",
      course: assignmentDoc.metadata?.course || "",
      totalQuestions: assignmentDoc.questions.length,
      totalMarks: assignmentDoc.metadata?.totalMarks ?? null,
      resourceCount: resources.length,
      downloadedCount,
      failedCount,
    };

    const assetsMap = new Map();
    for (const r of resources) {
      if (r.status === ResourceStatus.DOWNLOADED && r.data) {
        assetsMap.set(r.localPath, {
          data: r.data,
          mimeType: r.mimeType,
          byteSize: r.byteSize,
          contentHash: r.contentHash,
        });
      }
    }

    return {
      markdown,
      manifest,
      manifestJson: JSON.stringify(manifest, null, 2),
      metadataJson: JSON.stringify(metadata, null, 2),
      assets: assetsMap,
      resources,
      resourceMap: activeResourceMap,
      stats: {
        total: resources.length,
        downloaded: downloadedCount,
        failed: failedCount,
      },
    };
  }
}

/**
 * Functional entry point for building an assignment bundle.
 * @param {Object} assignmentDoc AssignmentDocument
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
export async function buildAssignmentBundle(assignmentDoc, options = {}) {
  const engine = new ResourceEngine(options);
  return engine.buildBundle(assignmentDoc, options);
}
