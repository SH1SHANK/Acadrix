/**
 * Types and Enums for the Resource & Asset Subsystem.
 */

export const ResourceStatus = Object.freeze({
  PENDING: "pending",
  DOWNLOADING: "downloading",
  DOWNLOADED: "downloaded",
  UNSUPPORTED: "unsupported",
  FAILED: "failed",
});

export const ResourceKind = Object.freeze({
  IMAGE: "image",
  INLINE_SVG: "inline_svg",
  EXTERNAL_SVG: "external_svg",
});

export const MIME_TYPES = Object.freeze({
  PNG: "image/png",
  JPEG: "image/jpeg",
  WEBP: "image/webp",
  GIF: "image/gif",
  SVG: "image/svg+xml",
});

export const MIME_TO_EXTENSION = Object.freeze({
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
});

export const EXTENSION_TO_MIME = Object.freeze({
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
});
