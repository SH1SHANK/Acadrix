/**
 * Portable Bundle Packager & Archive Generator.
 * 
 * Combines Markdown, metadata, resource manifest, and localized binary/SVG assets
 * into a single self-contained portable bundle (ZIP archive or in-memory map).
 * Zero external libraries or npm dependencies.
 */

import { buildExportFilename } from "../model/document.js";

export { buildExportFilename };

// Precomputed CRC-32 table (IEEE 802.3 standard)
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c;
}

/**
 * Computes standard IEEE 802.3 CRC-32 checksum.
 * @param {Uint8Array|string} data
 * @returns {number} 32-bit unsigned integer
 */
export function crc32(data) {
  const bytes = data instanceof Uint8Array ? data : strToBytes(String(data ?? ""));
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Converts text string to Uint8Array UTF-8 bytes across Node.js and browser.
 * @param {string} str
 * @returns {Uint8Array}
 */
export function strToBytes(str) {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(str);
  }
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(str, "utf8"));
  }
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i) & 0xff;
  }
  return bytes;
}

function writeUint16LE(arr, offset, val) {
  arr[offset] = val & 0xff;
  arr[offset + 1] = (val >>> 8) & 0xff;
}

function writeUint32LE(arr, offset, val) {
  arr[offset] = val & 0xff;
  arr[offset + 1] = (val >>> 8) & 0xff;
  arr[offset + 2] = (val >>> 16) & 0xff;
  arr[offset + 3] = (val >>> 24) & 0xff;
}

const ROOT_ENTRY_ORDER = Object.freeze({
  "assignment.md": 0,
  "metadata.json": 1,
  "manifest.json": 2,
});

// Ambiguous Unicode slash/dot lookalikes that must never appear in archive paths
const UNSAFE_UNICODE_PATH_CHARS = /[\u2024\u2025\u2026\u3002\uFF0E\uFF0F\uFF3C\u2215\u2044]/;

// Allowed confined path pattern inside the portable bundle
const SAFE_ASSET_PATH_PATTERN = /^assets\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/**
 * Validates and normalizes an archive entry path, strictly confining all bundle entries
 * to `assignment.md`, `metadata.json`, `manifest.json`, or `assets/<safe-filename>`.
 * Rejects path traversal (`..`), absolute paths, drive letters, backslashes, null bytes,
 * control characters, and Unicode separator variants.
 *
 * @param {string} rawPath
 * @returns {string} Validated relative archive path
 */
export function sanitizeArchivePath(rawPath) {
  if (typeof rawPath !== "string" || rawPath.length === 0) {
    throw new Error("Archive entry path must be a non-empty string.");
  }

  // Reject null bytes and ASCII control characters
  if (/[\x00-\x1f\x7f]/.test(rawPath)) {
    throw new Error(`Unsafe archive path rejected (control or null byte): "${rawPath}"`);
  }

  // Reject Unicode dot/slash lookalike characters
  if (UNSAFE_UNICODE_PATH_CHARS.test(rawPath)) {
    throw new Error(`Unsafe archive path rejected (ambiguous Unicode separator): "${rawPath}"`);
  }

  // Reject backslashes, leading slashes, Windows drive prefixes, and relative traversal
  if (
    rawPath.includes("\\") ||
    rawPath.startsWith("/") ||
    /^[a-zA-Z]:/.test(rawPath) ||
    rawPath.includes("//")
  ) {
    throw new Error(`Unsafe archive path rejected (non-relative or platform separator): "${rawPath}"`);
  }

  const segments = rawPath.split("/");
  for (const seg of segments) {
    if (!seg || seg === "." || seg === ".." || seg.includes("..")) {
      throw new Error(`Unsafe archive path rejected (traversal segment): "${rawPath}"`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(ROOT_ENTRY_ORDER, rawPath)) {
    return rawPath;
  }

  if (SAFE_ASSET_PATH_PATTERN.test(rawPath) && segments.length === 2) {
    return rawPath;
  }

  throw new Error(
    `Unsafe archive path rejected (outside bundle confinement): "${rawPath}". Allowed: assignment.md, metadata.json, manifest.json, assets/*`
  );
}

/**
 * Deterministic comparator for bundle archive entries:
 * 1. assignment.md
 * 2. metadata.json
 * 3. manifest.json
 * 4. assets/... (sorted lexicographically by code-point)
 *
 * @param {string} pathA
 * @param {string} pathB
 * @returns {number}
 */
export function compareArchivePaths(pathA, pathB) {
  const rankA = Object.prototype.hasOwnProperty.call(ROOT_ENTRY_ORDER, pathA)
    ? ROOT_ENTRY_ORDER[pathA]
    : 3;
  const rankB = Object.prototype.hasOwnProperty.call(ROOT_ENTRY_ORDER, pathB)
    ? ROOT_ENTRY_ORDER[pathB]
    : 3;

  if (rankA !== rankB) {
    return rankA - rankB;
  }
  return pathA < pathB ? -1 : pathA > pathB ? 1 : 0;
}

/**
 * Generates a valid standard uncompressed ZIP archive (method 0: store).
 * Compatible natively with macOS Archive Utility, Windows Explorer, and standard unzip.
 * 
 * @param {Map<string, Uint8Array|string>|Record<string, Uint8Array|string>} filesMap
 * @returns {Uint8Array}
 */
export function createZipArchive(filesMap) {
  if (!filesMap || typeof filesMap !== "object") {
    throw new Error("filesMap is required to create a ZIP archive.");
  }

  const rawItems =
    filesMap instanceof Map ? Array.from(filesMap.entries()) : Object.entries(filesMap);

  const validatedItems = [];
  const seenPaths = new Set();

  for (const [rawPath, rawContent] of rawItems) {
    const cleanPath = sanitizeArchivePath(rawPath);
    if (seenPaths.has(cleanPath)) {
      throw new Error(`Duplicate archive entry path: "${cleanPath}"`);
    }
    seenPaths.add(cleanPath);

    if (rawContent === null || rawContent === undefined) {
      throw new Error(`File content for "${cleanPath}" cannot be null or undefined.`);
    }
    validatedItems.push([cleanPath, rawContent]);
  }

  // Sort files deterministically: assignment.md, metadata.json, manifest.json, then assets/...
  validatedItems.sort(([pathA], [pathB]) => compareArchivePaths(pathA, pathB));

  const entries = [];
  for (const [cleanPath, rawContent] of validatedItems) {
    const nameBytes = strToBytes(cleanPath);
    const dataBytes =
      rawContent instanceof Uint8Array ? rawContent : strToBytes(String(rawContent));
    const checksum = crc32(dataBytes);

    entries.push({
      name: cleanPath,
      nameBytes,
      dataBytes,
      checksum,
      size: dataBytes.length,
    });
  }

  // Calculate total buffer size required
  let totalSize = 0;
  for (const entry of entries) {
    // Local header (30 bytes) + filename + data
    totalSize += 30 + entry.nameBytes.length + entry.size;
    // Central directory header (46 bytes) + filename
    totalSize += 46 + entry.nameBytes.length;
  }
  // End of Central Directory record (22 bytes)
  totalSize += 22;

  const buf = new Uint8Array(totalSize);
  let offset = 0;

  // 1. Write Local File Headers and file data
  for (const entry of entries) {
    entry.localHeaderOffset = offset;

    // Signature: 0x04034b50
    writeUint32LE(buf, offset, 0x04034b50);
    writeUint16LE(buf, offset + 4, 20); // Version needed: 2.0
    writeUint16LE(buf, offset + 6, 0x0800); // Flags: UTF-8 filename
    writeUint16LE(buf, offset + 8, 0); // Method: Store (no compression)
    writeUint16LE(buf, offset + 10, 0); // Mod time (00:00:00)
    writeUint16LE(buf, offset + 12, 0x5421); // Mod date (deterministic 2022-01-01)
    writeUint32LE(buf, offset + 14, entry.checksum);
    writeUint32LE(buf, offset + 18, entry.size);
    writeUint32LE(buf, offset + 22, entry.size);
    writeUint16LE(buf, offset + 26, entry.nameBytes.length);
    writeUint16LE(buf, offset + 28, 0); // Extra field length

    offset += 30;
    buf.set(entry.nameBytes, offset);
    offset += entry.nameBytes.length;

    buf.set(entry.dataBytes, offset);
    offset += entry.size;
  }

  // 2. Write Central Directory Headers
  const centralDirStart = offset;
  for (const entry of entries) {
    // Signature: 0x02014b50
    writeUint32LE(buf, offset, 0x02014b50);
    writeUint16LE(buf, offset + 4, 20); // Version made by: 2.0
    writeUint16LE(buf, offset + 6, 20); // Version needed: 2.0
    writeUint16LE(buf, offset + 8, 0x0800); // Flags: UTF-8
    writeUint16LE(buf, offset + 10, 0); // Method: Store
    writeUint16LE(buf, offset + 12, 0); // Mod time
    writeUint16LE(buf, offset + 14, 0x5421); // Mod date
    writeUint32LE(buf, offset + 16, entry.checksum);
    writeUint32LE(buf, offset + 20, entry.size);
    writeUint32LE(buf, offset + 24, entry.size);
    writeUint16LE(buf, offset + 28, entry.nameBytes.length);
    writeUint16LE(buf, offset + 30, 0); // Extra field length
    writeUint16LE(buf, offset + 32, 0); // Comment length
    writeUint16LE(buf, offset + 34, 0); // Disk number start
    writeUint16LE(buf, offset + 36, 0); // Internal attributes
    writeUint32LE(buf, offset + 38, 0x81a40000); // External attributes: 0644 regular file
    writeUint32LE(buf, offset + 42, entry.localHeaderOffset);

    offset += 46;
    buf.set(entry.nameBytes, offset);
    offset += entry.nameBytes.length;
  }

  const centralDirLength = offset - centralDirStart;

  // 3. Write End of Central Directory Record (22 bytes)
  writeUint32LE(buf, offset, 0x06054b50);
  writeUint16LE(buf, offset + 4, 0); // Disk number
  writeUint16LE(buf, offset + 6, 0); // Disk with central directory
  writeUint16LE(buf, offset + 8, entries.length); // Total entries on disk
  writeUint16LE(buf, offset + 10, entries.length); // Total entries
  writeUint32LE(buf, offset + 12, centralDirLength); // Size of central directory
  writeUint32LE(buf, offset + 16, centralDirStart); // Offset of central directory
  writeUint16LE(buf, offset + 20, 0); // Comment length

  return buf;
}

/**
 * Produces a sanitized, filesystem-safe base name for artifacts.
 * Prevents traversal attacks, null bytes, and illegal path separators.
 * @param {string} [title="assignment"]
 * @returns {string}
 */
export function getSafeBaseName(title = "assignment") {
  if (typeof title !== "string" || !title.trim()) return "assignment";
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "assignment"
  );
}

/**
 * Triggers a browser download using a temporary anchor element.
 * Removes the temporary anchor immediately after click and revokes the Blob URL.
 * Safe no-op in Node.js environments.
 * @param {string} filename
 * @param {Uint8Array|string|Blob} content
 * @param {string} [mimeType="application/octet-stream"]
 * @param {Object} [options]
 * @param {number} [options.revokeDelayMs=250]
 * @returns {boolean} True if download was initiated
 */
export function downloadFile(filename, content, mimeType = "application/octet-stream", options = {}) {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    return false;
  }

  try {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    try {
      a.click();
    } finally {
      if (a.parentNode) {
        a.parentNode.removeChild(a);
      } else if (typeof a.remove === "function") {
        a.remove();
      }
    }

    const revokeDelayMs = options.revokeDelayMs ?? 250;
    const timer = setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore revoke errors
      }
    }, revokeDelayMs);

    if (typeof timer === "object" && typeof timer?.unref === "function") {
      timer.unref();
    }

    return true;
  } catch (err) {
    console.warn("[Acadrix Bundle] Failed to trigger browser download:", err);
    return false;
  }
}
