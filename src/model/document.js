/**
 * Canonical Document Model Contract.
 * 
 * Defines the structured, minimal schema representing an IITM assessment independently
 * of input HTML representations or output formats (Markdown, PDF, Reader UI).
 */

import { QuestionType, ContentType } from "./types.js";

/**
 * Atomic or composite content node (e.g. text paragraph, LaTeX formula, code block, image, table).
 */
export class ContentNode {
  constructor({
    type = ContentType.PARAGRAPH,
    value = "",
    children = [],
    attributes = {},
  } = {}) {
    this.type = type;
    this.value = value;
    this.children = Array.isArray(children) ? children : [];
    this.attributes = attributes || {};
  }
}

/**
 * Option item for choice-based questions (MCQ / MSQ).
 */
export class OptionNode {
  constructor({
    id = "",
    letter = "",
    content = [],
    selected = false,
    isCorrect = null,
    feedback = null,
  } = {}) {
    this.id = id;
    this.letter = letter;
    if (Array.isArray(content)) {
      this.content = content.map((item) =>
        item instanceof ContentNode ? item : new ContentNode({ value: String(item) })
      );
    } else if (content instanceof ContentNode) {
      this.content = [content];
    } else if (content !== null && content !== undefined && content !== "") {
      this.content = [new ContentNode({ value: String(content) })];
    } else {
      this.content = [];
    }
    this.selected = Boolean(selected);
    this.isCorrect = isCorrect;
    this.feedback = feedback;
  }
}

/**
 * Normalized Question Node.
 */
export class QuestionNode {
  constructor({
    id = "",
    number = 1,
    label = "",
    type = QuestionType.UNKNOWN,
    marks = null,
    negativeMarks = null,
    stem = [],
    options = [],
    status = { answered: false, flagged: false },
    review = null,
    legacyMigrationData = null,
    rawHtml = null, // Transitional alias
    metadata = {},
  } = {}) {
    this.id = id || `q-${number}`;
    this.number = number;
    this.label = label || `Question ${number}`;
    this.type = type;
    this.marks = marks;
    this.negativeMarks = negativeMarks;
    this.stem = Array.isArray(stem) ? stem : [];
    this.options = Array.isArray(options) ? options : [];
    this.status = status;
    this.review = review;

    /**
     * LEGACY MIGRATION DATA ONLY.
     * NOT PART OF THE CANONICAL SEMANTIC MODEL.
     * TEMPORARY (Phase 1-2 only, scheduled for full removal in Phase 3).
     */
    this.legacyMigrationData = legacyMigrationData || rawHtml ? { ...(legacyMigrationData || rawHtml) } : null;
    this.metadata = metadata;
  }

  /**
   * @deprecated Temporary legacy access for Phase 1-2 migration. Do not use in new layers.
   */
  get rawHtml() {
    return this.legacyMigrationData;
  }

  /**
   * Transitional helper for the temporary reader drawer.
   */
  getLegacyOptionsMarkup() {
    return this.legacyMigrationData?.optsHtml || "";
  }

  /**
   * Transitional adapter method: constructs a valid QuestionNode from legacy raw HTML snapshots.
   * Isolates legacy HTML scraping behind the Canonical Document Model contract.
   */
  static fromLegacySnapshot({ stemHtml = "", optsHtml = "", index = 0, isReview = false } = {}) {
    const number = index + 1;
    return new QuestionNode({
      id: `q-${number}`,
      number,
      label: `Question ${number}`,
      type: QuestionType.UNKNOWN,
      legacyMigrationData: {
        stemHtml,
        optsHtml,
      },
      stem: [
        new ContentNode({
          type: ContentType.HTML_BLOCK,
          value: stemHtml,
        }),
      ],
      review: isReview ? { mode: "evaluated" } : null,
    });
  }
}

/**
 * Top-level Normalized Assignment Document.
 */
export class AssignmentDocument {
  constructor({
    metadata = {},
    questions = [],
    resources = new Map(),
  } = {}) {
    this.metadata = {
      title: metadata.title || "IITM Assessment",
      course: metadata.course || "",
      week: metadata.week || "",
      totalQuestions: metadata.totalQuestions || questions.length,
      totalMarks: metadata.totalMarks || null,
      url: metadata.url || (typeof window !== "undefined" ? window.location?.href || "" : ""),
      timestamp: metadata.timestamp || new Date().toISOString(),
      ...metadata,
    };
    this.questions = Array.isArray(questions) ? questions : [];
    this.resources = resources instanceof Map ? resources : new Map(Object.entries(resources));
  }

  addQuestion(question) {
    if (question instanceof QuestionNode) {
      this.questions.push(question);
    } else {
      this.questions.push(new QuestionNode(question));
    }
  }

  getQuestion(index) {
    return this.questions[index] || null;
  }

  get length() {
    return this.questions.length;
  }
}

const TERM_PREFIX_REGEX =
  /^\s*(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}\s*[-–—:]\s*/i;

const WEEK_EXTRACT_REGEX = /\bweek[\s\-_:]*(\d{1,2})\b/i;

const KIND_EXTRACT_PATTERNS = [
  { label: "GrPA", regex: /\b(?:grpa|graded\s+programming(?:\s+assignment)?)(?:[\s\-_#:]*(\d+))?\b/i },
  { label: "PPA", regex: /\b(?:ppa|practice\s+programming(?:\s+assignment)?)(?:[\s\-_#:]*(\d+))?\b/i },
  { label: "AQ", regex: /\b(?:aq|activity\s+questions?|weekly\s+activity|activity)(?:[\s\-_#:]*(\d+(?:\.\d+)?))?\b/i },
  { label: "GA", regex: /\b(?:ga|graded\s+assignment)(?:[\s\-_#:]*(\d+))?\b/i },
  { label: "PA", regex: /\b(?:pa|practice(?:\s+assignment)?)(?:[\s\-_#:]*(\d+))?\b/i },
  { label: "OPPE", regex: /\b(?:oppe)(?:[\s\-_#:]*(\d+))?\b/i },
  { label: "Quiz", regex: /\b(?:quiz)(?:[\s\-_#:]*(\d+))?\b/i },
];

function sanitizeFilenameSegment(raw) {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\/\\:*?"<>|\x00-\x1f\x7f-\x9f]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "");
}

const TRAILING_CONNECTOR_REGEX = /\s+\b(?:and|of|for|to|in|the)$/i;

function truncateCourseOnWordBoundary(course, maxLen = 60) {
  if (course.length <= maxLen) return course;
  const sliced = course.slice(0, maxLen);
  let truncated = sliced;
  if (course[maxLen] !== " ") {
    const lastSpace = sliced.lastIndexOf(" ");
    if (lastSpace > 0) {
      truncated = sliced.slice(0, lastSpace);
    }
  }
  truncated = truncated.replace(/[\s.\-_]+$/g, "").replace(/^[. ]+|[. ]+$/g, "");
  while (TRAILING_CONNECTOR_REGEX.test(truncated)) {
    truncated = truncated.replace(TRAILING_CONNECTOR_REGEX, "").replace(/[\s.\-_]+$/g, "");
  }
  return truncated;
}

function parseWeekCandidate(candidate, allowDirectNumber = false) {
  if (typeof candidate === "number" && candidate >= 0 && candidate <= 99) {
    return `Week ${String(Math.floor(candidate)).padStart(2, "0")}`;
  }
  if (typeof candidate !== "string") return "";
  const trimmed = candidate.trim();
  if (!trimmed) return "";
  const directMatch = allowDirectNumber ? trimmed.match(/^(\d{1,2})$/) : null;
  const weekMatch = directMatch || trimmed.match(WEEK_EXTRACT_REGEX);
  if (weekMatch) {
    return `Week ${String(parseInt(weekMatch[1], 10)).padStart(2, "0")}`;
  }
  return "";
}

/**
 * Pure, core, bookmarklet-safe filename builder for exported artifacts.
 * Format: "{Course} - Week {NN} - {Kind}.{ext}"
 * Any missing part is omitted with its separator.
 * If every part is missing: "Acadrix Assignment - YYYY-MM-DD.{ext}".
 *
 * @param {Object} [meta={}] - Metadata object (course, title, week, subtitle, activeUnitHeader, kind, timestamp, date)
 * @param {string} [ext="pdf"] - File extension without leading dot
 * @returns {string}
 */
export function buildExportFilename(meta = {}, ext = "pdf") {
  const safeMeta = meta && typeof meta === "object" ? meta : {};
  const rawCourse = typeof safeMeta.course === "string" ? safeMeta.course.replace(TERM_PREFIX_REGEX, "") : "";
  const rawTitle = typeof safeMeta.title === "string" ? safeMeta.title : "";

  // 1. Course (sanitized, truncated at 60 chars on a word boundary, trailing connector words dropped)
  let coursePart = sanitizeFilenameSegment(rawCourse);
  if (coursePart) {
    coursePart = truncateCourseOnWordBoundary(coursePart, 60);
  }

  // 2. Week (/\bweek[\s\-_:]*(\d{1,2})\b/i, zero-padded to 2 digits)
  // Fallback order: header subtitle / explicit week -> title -> sidebar active .unit-header
  const weekPart =
    parseWeekCandidate(safeMeta.week, true) ||
    parseWeekCandidate(safeMeta.subtitle, false) ||
    parseWeekCandidate(rawTitle, false) ||
    parseWeekCandidate(safeMeta.activeUnitHeader || safeMeta.unitHeader, false);

  // 3. Kind (GrPA, PPA, AQ, GA, PA, OPPE, Quiz; first match wins, optional number suffix kept)
  let kindPart = "";
  const kindSource =
    typeof safeMeta.kind === "string" && safeMeta.kind.trim()
      ? `${safeMeta.kind} ${rawTitle}`
      : rawTitle;

  if (kindSource) {
    for (const { label, regex } of KIND_EXTRACT_PATTERNS) {
      const m = kindSource.match(regex);
      if (m) {
        const suffixNum = m[1] !== undefined ? ` ${m[1]}` : "";
        kindPart = sanitizeFilenameSegment(`${label}${suffixNum}`);
        break;
      }
    }
  }

  // If no standard kind acronym matched, check if rawTitle contains a specific non-generic title
  if (!kindPart && rawTitle && typeof rawTitle === "string") {
    const trimmedTitle = rawTitle.trim();
    if (
      !/^(?:IITM\s+Assessment|Assignment|Assessment|Quiz)$/i.test(trimmedTitle) &&
      !trimmedTitle.startsWith("IITM Assessment")
    ) {
      const cleanedTitle = trimmedTitle
        .replace(/\bweek[\s\-_:]*\d{1,2}\b/gi, "")
        .replace(/^[\s\-_:]+|[\s\-_:]+$/g, "")
        .trim();
      if (cleanedTitle && !/^(?:Assignment|Assessment|Quiz)$/i.test(cleanedTitle)) {
        kindPart = sanitizeFilenameSegment(cleanedTitle);
      }
    }
  }

  // 4. Assemble present parts or fallback to "Acadrix Assignment - YYYY-MM-DD"
  const parts = [coursePart, weekPart, kindPart].filter(Boolean);
  let baseName = "";
  if (parts.length > 0) {
    baseName = parts.join(" - ");
  } else {
    const rawDate = String(safeMeta.date || safeMeta.timestamp || "");
    const dateMatch = rawDate.match(/^(\d{4}-\d{2}-\d{2})/);
    const dateStr = dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10);
    baseName = `Acadrix Assignment - ${dateStr}`;
  }

  baseName = sanitizeFilenameSegment(baseName) || "Acadrix Assignment";

  // 5. Clean extension and enforce 120-char total cap
  const cleanExt = sanitizeFilenameSegment(String(ext || "pdf").replace(/^\.+/, "")) || "pdf";
  const extSuffix = `.${cleanExt}`;
  const maxBaseLen = Math.max(1, 120 - extSuffix.length);
  if (baseName.length > maxBaseLen) {
    baseName = baseName.slice(0, maxBaseLen).replace(/[. \-]+$/g, "").replace(/^[. ]+|[. ]+$/g, "");
  }

  return `${baseName}${extSuffix}`;
}
