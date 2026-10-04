/**
 * Types, Enums, and Structured Error Hierarchy for Export Orchestration.
 */

export const ExportState = Object.freeze({
  IDLE: "idle",
  EXTRACTING: "extracting",
  RESOLVING_RESOURCES: "resolving-resources",
  RENDERING: "rendering",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

export const ExportPhase = Object.freeze({
  EXTRACTING: "extracting",
  RESOLVING_RESOURCES: "resolving-resources",
  GENERATING_MARKDOWN: "generating-markdown",
  PREPARING_PDF: "preparing-pdf",
  PACKAGING: "packaging",
  COMPLETED: "completed",
});

export class ExportError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ExportError";
    this.details = details;
  }
}

export class ExtractionError extends ExportError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = "ExtractionError";
  }
}

export class ResourceError extends ExportError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = "ResourceError";
  }
}

export class MarkdownExportError extends ExportError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = "MarkdownExportError";
  }
}

export class PdfExportError extends ExportError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = "PdfExportError";
  }
}

export class PackagingError extends ExportError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = "PackagingError";
  }
}

export class CancellationError extends ExportError {
  constructor(message = "Export session cancelled by user", details = {}) {
    super(message, details);
    this.name = "CancellationError";
  }
}

export class DoubleExportError extends ExportError {
  constructor(message = "An export session is already in progress.") {
    super(message);
    this.name = "DoubleExportError";
  }
}
