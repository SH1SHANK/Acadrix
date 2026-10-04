/**
 * Resource Discovery and Deduplication Pass.
 * Operates strictly on the canonical AssignmentDocument AST.
 * Zero DOM or browser dependencies.
 */

import { ContentType } from "../model/types.js";
import { ResourceKind, ResourceStatus } from "./types.js";
import {
  hashString,
  normalizeResourceUrl,
  inferExtension,
  generateAssetLocalPath,
} from "./naming.js";

/**
 * Discovers and deduplicates all embedded resource references in an AssignmentDocument.
 * @param {Object} assignmentDoc AssignmentDocument
 * @param {Object} [options]
 * @param {string} [options.baseUrl]
 * @returns {{ resources: Object[], resourceMap: Map<string, string> }}
 */
export function discoverResources(assignmentDoc, options = {}) {
  if (!assignmentDoc || !Array.isArray(assignmentDoc.questions)) {
    return { resources: [], resourceMap: new Map() };
  }

  const baseUrl = options.baseUrl || assignmentDoc.metadata?.url || "";
  const uniqueResources = new Map(); // normalizedKey -> ResourceEntry
  const resourceMap = new Map(); // rawSource / normalizedKey -> localPath
  const questionAssetCounts = new Map(); // questionNumber -> count

  // Recursive walker over canonical ContentNodes
  function walkContentNodes(nodes, questionNumber) {
    if (!Array.isArray(nodes)) return;

    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;

      if (node.type === ContentType.IMAGE) {
        const rawSrc = (node.attributes?.src || node.attributes?.currentSrc || "").trim();
        if (rawSrc) {
          registerResource({
            rawSrc,
            kind: ResourceKind.IMAGE,
            questionNumber,
            mimeType: node.attributes?.mimeType || "",
            alt: node.attributes?.alt || "",
            title: node.attributes?.title || "",
          });
        }
      } else if (node.type === ContentType.SVG) {
        const externalUrl = (node.attributes?.src || node.attributes?.url || "").trim();
        if (externalUrl) {
          registerResource({
            rawSrc: externalUrl,
            kind: ResourceKind.EXTERNAL_SVG,
            questionNumber,
            mimeType: "image/svg+xml",
            title: node.attributes?.title || "",
          });
        } else {
          const svgContent = (node.value || "").trim();
          if (svgContent) {
            registerResource({
              rawSrc: svgContent,
              kind: ResourceKind.INLINE_SVG,
              questionNumber,
              mimeType: "image/svg+xml",
              title: node.attributes?.title || "",
            });
          }
        }
      }

      // Recursively walk children (e.g. figure, list_item, table_cell)
      if (Array.isArray(node.children) && node.children.length > 0) {
        walkContentNodes(node.children, questionNumber);
      }
    }
  }

  function registerResource({ rawSrc, kind, questionNumber, mimeType, alt, title }) {
    const isInline = kind === ResourceKind.INLINE_SVG;
    const normalizedKey = isInline
      ? `inline:${hashString(rawSrc)}`
      : normalizeResourceUrl(rawSrc, baseUrl);

    if (uniqueResources.has(normalizedKey)) {
      // Deduplicate: resource already recorded
      const existing = uniqueResources.get(normalizedKey);
      if (!existing.questions.includes(questionNumber)) {
        existing.questions.push(questionNumber);
      }
      // Also register rawSrc in lookup map
      resourceMap.set(rawSrc, existing.localPath);
      return;
    }

    // Determine deterministic local asset path
    const count = (questionAssetCounts.get(questionNumber) || 0) + 1;
    questionAssetCounts.set(questionNumber, count);

    const ext = isInline ? ".svg" : inferExtension(mimeType, normalizedKey);
    const localPath = generateAssetLocalPath({
      questionNumber,
      assetIndex: count,
      kind,
      ext,
    });

    const id = isInline
      ? `svg-${hashString(rawSrc).slice(0, 12)}`
      : `res-${hashString(normalizedKey).slice(0, 12)}`;

    const entry = {
      id,
      kind,
      source: rawSrc,
      normalizedSource: normalizedKey,
      localPath,
      mimeType: mimeType || (isInline ? "image/svg+xml" : ""),
      status: ResourceStatus.PENDING,
      questions: [questionNumber],
      alt: alt || "",
      title: title || "",
      byteSize: 0,
      contentHash: isInline ? hashString(rawSrc) : "",
      data: null, // Populated after fetch / materialization
      error: null,
    };

    uniqueResources.set(normalizedKey, entry);
    resourceMap.set(rawSrc, localPath);
    resourceMap.set(normalizedKey, localPath);
  }

  // Traverse all questions
  for (const question of assignmentDoc.questions) {
    const qNum = question.number || 1;

    // 1. Stem
    if (Array.isArray(question.stem)) {
      walkContentNodes(question.stem, qNum);
    }

    // 2. Options
    if (Array.isArray(question.options)) {
      for (const opt of question.options) {
        if (Array.isArray(opt.content)) {
          walkContentNodes(opt.content, qNum);
        }
      }
    }
  }

  return {
    resources: Array.from(uniqueResources.values()),
    resourceMap,
  };
}
