/**
 * Network Acquisition, Concurrency Limiting, Validation, and Data Materialization.
 * Operates independently of the browser DOM.
 */

import { ResourceKind, ResourceStatus, MIME_TYPES } from "./types.js";
import { hashBytes, hashString, inferExtension } from "./naming.js";
import { sanitizeSvgSource } from "../utils/dom.js";

/**
 * Decodes base64 string to Uint8Array in both Node.js and browser environments.
 * @param {string} b64
 * @returns {Uint8Array}
 */
export function decodeBase64(b64) {
  const cleanB64 = b64.replace(/\s+/g, "");
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(cleanB64, "base64"));
  }
  if (typeof atob !== "undefined") {
    const binary = atob(cleanB64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  throw new Error("No base64 decoder available in runtime.");
}

/**
 * Converts text string to Uint8Array bytes using TextEncoder or Buffer.
 * @param {string} text
 * @returns {Uint8Array}
 */
export function textToBytes(text) {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(text);
  }
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(text, "utf8"));
  }
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return bytes;
}

/**
 * Checks if a byte array represents HTML content rather than an image.
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
export function isHtmlContent(bytes) {
  if (!bytes || bytes.length < 5) return false;
  const sample = String.fromCharCode(...bytes.slice(0, Math.min(bytes.length, 128)))
    .trim()
    .toLowerCase();
  return (
    sample.startsWith("<!doctype html") ||
    sample.startsWith("<html") ||
    sample.startsWith("<head") ||
    sample.startsWith("<body")
  );
}

/**
 * Materializes or fetches a single resource with timeout, retries, and validation.
 * @param {Object} resource ResourceEntry
 * @param {Object} [options]
 * @param {Function} [options.fetchFn]
 * @param {number} [options.timeoutMs=5000]
 * @param {number} [options.retries=1]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Object>} Updated resource entry
 */
export async function acquireResource(resource, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5000;
  const maxRetries = options.retries ?? 1;
  const fetchFn = options.fetchFn || (typeof globalThis !== "undefined" ? globalThis.fetch : null);

  // 1. Check for cancellation
  if (options.signal?.aborted) {
    resource.status = ResourceStatus.FAILED;
    resource.error = "Operation cancelled";
    return resource;
  }

  // 2. Inline SVG: Zero network requests
  if (resource.kind === ResourceKind.INLINE_SVG) {
    try {
      const sanitized = sanitizeSvgSource(resource.source);
      const bytes = textToBytes(sanitized);
      resource.data = bytes;
      resource.byteSize = bytes.length;
      resource.mimeType = MIME_TYPES.SVG;
      resource.contentHash = hashBytes(bytes);
      resource.status = ResourceStatus.DOWNLOADED;
      return resource;
    } catch (err) {
      resource.status = ResourceStatus.FAILED;
      resource.error = err.message;
      return resource;
    }
  }

  // 3. Data URLs: Direct materialization without network fetch
  if (resource.source.startsWith("data:")) {
    if (!resource.source.startsWith("data:image/")) {
      resource.status = ResourceStatus.UNSUPPORTED;
      resource.error = "Unsupported data URL media type (only data:image/* permitted)";
      return resource;
    }

    try {
      const commaIdx = resource.source.indexOf(",");
      if (commaIdx === -1) {
        throw new Error("Malformed data URL: missing comma delimiter");
      }
      const header = resource.source.slice(5, commaIdx).toLowerCase();
      const payload = resource.source.slice(commaIdx + 1);
      const isBase64 = header.includes(";base64");
      const mime = header.split(";")[0] || "image/png";

      const bytes = isBase64
        ? decodeBase64(payload)
        : textToBytes(decodeURIComponent(payload));

      if (isHtmlContent(bytes)) {
        resource.status = ResourceStatus.UNSUPPORTED;
        resource.error = "Data URL contained HTML content instead of image data";
        return resource;
      }

      resource.data = bytes;
      resource.byteSize = bytes.length;
      resource.mimeType = mime;
      resource.contentHash = hashBytes(bytes);
      resource.status = ResourceStatus.DOWNLOADED;
      return resource;
    } catch (err) {
      resource.status = ResourceStatus.FAILED;
      resource.error = `Failed to materialize data URL: ${err.message}`;
      return resource;
    }
  }

  // 4. Validate URL protocol safety
  const rawUrl = resource.source.trim();
  if (/^(?:javascript|vbscript|data:(?!image\/)):/i.test(rawUrl)) {
    resource.status = ResourceStatus.FAILED;
    resource.error = "Unsafe or prohibited URL protocol";
    return resource;
  }

  if (!fetchFn) {
    resource.status = ResourceStatus.FAILED;
    resource.error = "No fetch implementation available";
    return resource;
  }

  // 5. Remote network acquisition with bounded timeout and retries
  resource.status = ResourceStatus.DOWNLOADING;
  let attempt = 0;

  while (attempt <= maxRetries) {
    attempt += 1;

    // Check cancellation before each attempt
    if (options.signal?.aborted) {
      resource.status = ResourceStatus.FAILED;
      resource.error = "Operation cancelled";
      return resource;
    }

    const controller = new AbortController();
    let timeoutId = null;

    // Chain external signal if provided
    const onExternalAbort = () => controller.abort();
    if (options.signal) {
      options.signal.addEventListener("abort", onExternalAbort, { once: true });
    }

    try {
      timeoutId = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      const response = await fetchFn(rawUrl, {
        signal: controller.signal,
        headers: { Accept: "image/*,image/svg+xml,*/*;q=0.8" },
      });

      if (!response.ok) {
        // Non-2xx HTTP response
        const isClientError = response.status >= 400 && response.status < 500;
        if (isClientError || attempt > maxRetries) {
          resource.status = ResourceStatus.FAILED;
          resource.error = `HTTP ${response.status} ${response.statusText || "Error"}`;
          return resource;
        }
        // Transient 5xx error: retry
        continue;
      }

      // Check Content-Type header
      const contentType = (response.headers?.get?.("content-type") || "").toLowerCase();
      if (
        contentType &&
        (contentType.includes("text/html") ||
          contentType.includes("application/javascript") ||
          contentType.includes("text/javascript"))
      ) {
        resource.status = ResourceStatus.UNSUPPORTED;
        resource.error = `Unsupported Content-Type returned: ${contentType}`;
        return resource;
      }

      // Read binary buffer
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      if (bytes.length === 0) {
        resource.status = ResourceStatus.FAILED;
        resource.error = "Empty response received";
        return resource;
      }

      if (isHtmlContent(bytes)) {
        resource.status = ResourceStatus.UNSUPPORTED;
        resource.error = "Server returned HTML document instead of valid image";
        return resource;
      }

      let finalBytes = bytes;
      let mimeType = contentType.split(";")[0].trim() || resource.mimeType;

      // If SVG, validate and sanitize payload
      if (
        mimeType.includes("svg") ||
        rawUrl.endsWith(".svg") ||
        (bytes[0] === 0x3c /* '<' */ && String.fromCharCode(...bytes.slice(0, 10)).includes("svg"))
      ) {
        const svgText = new TextDecoder().decode(bytes);
        const cleanSvg = sanitizeSvgSource(svgText);
        finalBytes = textToBytes(cleanSvg);
        mimeType = MIME_TYPES.SVG;
      }

      resource.data = finalBytes;
      resource.byteSize = finalBytes.length;
      resource.mimeType = mimeType || "image/png";
      resource.contentHash = hashBytes(finalBytes);
      resource.status = ResourceStatus.DOWNLOADED;
      return resource;
    } catch (err) {
      const isTimeout = controller.signal.aborted && !options.signal?.aborted;
      const isCancelled = options.signal?.aborted;

      if (isCancelled) {
        resource.status = ResourceStatus.FAILED;
        resource.error = "Operation cancelled";
        return resource;
      }

      if (attempt > maxRetries) {
        resource.status = ResourceStatus.FAILED;
        resource.error = isTimeout ? `Fetch timed out after ${timeoutMs}ms` : err.message;
        return resource;
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (options.signal) {
        options.signal.removeEventListener("abort", onExternalAbort);
      }
    }
  }

  return resource;
}

/**
 * Concurrency-bounded queue processor for resource acquisition.
 * @param {Object[]} resources
 * @param {Object} options
 * @param {number} [options.concurrency=4]
 * @param {Function} [options.onProgress]
 * @returns {Promise<Object[]>}
 */
export async function acquireAllResources(resources, options = {}) {
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const total = resources.length;
  let completed = 0;
  let index = 0;

  async function worker() {
    while (index < resources.length) {
      if (options.signal?.aborted) break;

      const currentIdx = index;
      index += 1;
      const res = resources[currentIdx];

      await acquireResource(res, options);

      completed += 1;
      if (options.onProgress) {
        options.onProgress({
          completed,
          total,
          resource: res,
        });
      }
    }
  }

  const pool = Array.from({ length: Math.min(concurrency, total) }, () => worker());
  await Promise.all(pool);

  return resources;
}
