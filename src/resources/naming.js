/**
 * Deterministic Naming, Hashing, and Path Utilities.
 * Zero browser or DOM dependencies.
 */

import { MIME_TO_EXTENSION, ResourceKind } from "./types.js";

/**
 * Deterministic 64-bit FNV-1a / Murmur-hybrid string hash.
 * Synchronous and identical across Node.js, browsers, and workers.
 * @param {string} str
 * @returns {string} 16-character hex string
 */
export function hashString(str) {
  if (typeof str !== "string") str = String(str || "");
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ (ch >> 8), 0x85ebca6b);
  }
  return (
    (h1 >>> 0).toString(16).padStart(8, "0") +
    (h2 >>> 0).toString(16).padStart(8, "0")
  );
}

/**
 * Deterministic hash for byte buffers (Uint8Array).
 * @param {Uint8Array|ArrayBuffer} bytes
 * @returns {string} 16-character hex string
 */
export function hashBytes(bytes) {
  if (!bytes) return "0000000000000000";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < arr.length; i++) {
    const b = arr[i];
    h1 = Math.imul(h1 ^ b, 0x01000193);
    h2 = Math.imul(h2 ^ b, 0x85ebca6b);
  }
  return (
    (h1 >>> 0).toString(16).padStart(8, "0") +
    (h2 >>> 0).toString(16).padStart(8, "0")
  );
}

/**
 * Normalizes resource URLs deterministically before hashing or deduplication.
 * Handles query parameter order, lowercasing hostname/protocol, port defaults, and fragment stripping.
 * @param {string} rawUrl
 * @param {string} [baseUrl]
 * @returns {string}
 */
export function normalizeResourceUrl(rawUrl, baseUrl = "") {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  const trimmed = rawUrl.trim();

  // Handle data: URLs separately
  if (trimmed.startsWith("data:")) {
    const commaIdx = trimmed.indexOf(",");
    if (commaIdx === -1) return trimmed;
    const header = trimmed.slice(0, commaIdx).toLowerCase();
    const data = trimmed.slice(commaIdx + 1);
    return `${header},${data}`;
  }

  try {
    const parsed = baseUrl ? new URL(trimmed, baseUrl) : new URL(trimmed);
    // Strip hash fragment
    parsed.hash = "";

    // Sort query parameters deterministically
    const params = Array.from(parsed.searchParams.entries()).sort((a, b) =>
      a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : (a[0] < b[0] ? -1 : 1)
    );
    parsed.search = "";
    for (const [k, v] of params) {
      parsed.searchParams.append(k, v);
    }

    return parsed.href;
  } catch {
    // If URL cannot be parsed (e.g. bare relative path without baseUrl)
    return trimmed.split("#")[0];
  }
}

/**
 * Infers appropriate file extension from MIME type, magic bytes, or URL.
 * @param {string} [mimeType]
 * @param {string} [url]
 * @param {Uint8Array} [bytes]
 * @returns {string} e.g. '.png', '.svg', '.jpg'
 */
export function inferExtension(mimeType = "", url = "", bytes = null) {
  // 1. Magic bytes check
  if (bytes && bytes.length >= 3) {
    if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return ".png";
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return ".jpg";
    }
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
      return ".gif";
    }
    if (
      bytes.length >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return ".webp";
    }
  }

  // 2. MIME type mapping
  if (mimeType) {
    const cleanMime = mimeType.split(";")[0].trim().toLowerCase();
    if (MIME_TO_EXTENSION[cleanMime]) {
      return MIME_TO_EXTENSION[cleanMime];
    }
  }

  // 3. URL path extension check
  if (url && typeof url === "string") {
    try {
      const pathname = url.startsWith("data:") ? "" : (url.includes("://") ? new URL(url).pathname : url);
      const dotIdx = pathname.lastIndexOf(".");
      if (dotIdx !== -1) {
        const candidate = pathname.slice(dotIdx).toLowerCase();
        if (candidate in { ".png": 1, ".jpg": 1, ".jpeg": 1, ".webp": 1, ".gif": 1, ".svg": 1 }) {
          return candidate === ".jpeg" ? ".jpg" : candidate;
        }
      }
    } catch {
      // Fall through
    }
  }

  return ".png"; // Sensible default
}

/**
 * Sanitizes a filename, stripping any path traversal components, control characters,
 * Unicode separator variants, or invalid filesystem characters.
 * @param {string} name
 * @returns {string}
 */
export function sanitizeFilename(name) {
  if (typeof name !== "string") return "asset";
  return (
    name
      .replace(/[\x00-\x1f\x7f\u2024\u2025\u2026\u3002\uFF0E\uFF0F\uFF3C\u2215\u2044\\/:*?"<>|]/g, "-")
      .replace(/\.{2,}/g, "-")
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[.-]+|[.-]+$/g, "") || "asset"
  );
}

/**
 * Generates a deterministic, filesystem-safe local asset path.
 * Strictly confined to `assets/q<padded_q>-<type>-<padded_idx>.<ext>`.
 * e.g. assets/q01-image-01.png, assets/q02-diagram-01.svg
 * @param {Object} params
 * @param {number} params.questionNumber
 * @param {number} params.assetIndex
 * @param {string} params.kind
 * @param {string} params.ext
 * @returns {string}
 */
export function generateAssetLocalPath({ questionNumber = 1, assetIndex = 1, kind = ResourceKind.IMAGE, ext = ".png" } = {}) {
  const safeQ = Math.max(1, Math.floor(Number(questionNumber) || 1));
  const safeIdx = Math.max(1, Math.floor(Number(assetIndex) || 1));
  const paddedQ = String(safeQ).padStart(2, "0");
  const paddedIdx = String(safeIdx).padStart(2, "0");
  const label = kind === ResourceKind.INLINE_SVG || kind === ResourceKind.EXTERNAL_SVG ? "diagram" : "image";
  const rawExt = String(ext || ".png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const allowedExts = new Set(["png", "jpg", "webp", "gif", "svg", "bin"]);
  const finalExt = allowedExts.has(rawExt) ? rawExt : "png";
  return `assets/q${paddedQ}-${label}-${paddedIdx}.${finalExt}`;
}
