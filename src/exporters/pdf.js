/**
 * High-Fidelity PDF & Print Document Exporter.
 * 
 * Transforms Canonical AssignmentDocument AST -> Standalone Print-Ready HTML & PDF.
 * Pure functional transformer: node-runnable, zero live DOM queries, zero IITM selector dependencies.
 * Consumes strictly the Canonical Document Model AST + optional Phase 5 Resource Map.
 */

import { ContentType, QuestionType, MathType, MathFormat } from "../model/types.js";
import { buildExportFilename } from "../model/document.js";

// ── Default Print Stylesheet (Inlined for standalone portability) ────────────

export const PDF_CSS = `
@page {
  size: A4;
  margin: 15mm 15mm 20mm 15mm;
  @bottom-center {
    content: counter(page);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 8.5pt;
    color: #666666;
  }
}

*, *::before, *::after {
  box-sizing: border-box;
}

html, body {
  margin: 0;
  padding: 0;
  background: #ffffff;
  color: #111111;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 10pt;
  line-height: 1.5;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.saq-pdf-document {
  max-width: 100%;
  margin: 0 auto;
  padding: 0;
}

.saq-pdf-header {
  margin-bottom: 20pt;
  padding-bottom: 10pt;
  border-bottom: 1.5pt solid #222222;
  page-break-after: avoid;
  break-after: avoid;
}

.saq-pdf-title {
  margin: 0 0 6pt 0;
  font-size: 18pt;
  font-weight: 700;
  color: #111111;
  line-height: 1.25;
}

.saq-pdf-metadata {
  display: flex;
  flex-wrap: wrap;
  gap: 14pt;
  font-size: 9pt;
  color: #444444;
}

.saq-pdf-meta-item {
  display: inline-block;
}

.saq-pdf-meta-item strong {
  color: #111111;
}

.saq-pdf-question {
  margin-bottom: 22pt;
  page-break-inside: auto;
  break-inside: auto;
}

.saq-pdf-question-header {
  margin: 0 0 4pt 0;
  font-size: 12pt;
  font-weight: 700;
  color: #111111;
  page-break-after: avoid;
  break-after: avoid;
}

.saq-pdf-question-meta {
  font-size: 8.5pt;
  color: #555555;
  margin-bottom: 8pt;
  page-break-after: avoid;
  break-after: avoid;
}

.saq-pdf-question-meta span + span::before {
  content: " • ";
  margin: 0 4pt;
  color: #888888;
}

.saq-pdf-stem {
  margin-bottom: 10pt;
}

.saq-pdf-paragraph {
  margin: 0 0 8pt 0;
}

.saq-pdf-heading {
  margin: 12pt 0 6pt 0;
  font-weight: 600;
  color: #222222;
  page-break-after: avoid;
  break-after: avoid;
}

h1.saq-pdf-heading { font-size: 14pt; }
h2.saq-pdf-heading { font-size: 12.5pt; }
h3.saq-pdf-heading { font-size: 11pt; }
h4.saq-pdf-heading { font-size: 10pt; }
h5.saq-pdf-heading { font-size: 9.5pt; }
h6.saq-pdf-heading { font-size: 9pt; }

.saq-pdf-options-title {
  font-size: 9.5pt;
  font-weight: 700;
  color: #333333;
  margin: 10pt 0 6pt 0;
  page-break-after: avoid;
  break-after: avoid;
}

.saq-pdf-options {
  list-style: none;
  padding: 0;
  margin: 0 0 10pt 0;
  page-break-inside: avoid;
  break-inside: avoid;
}

.saq-pdf-option {
  display: flex;
  align-items: baseline;
  gap: 8pt;
  margin-bottom: 6pt;
  page-break-inside: avoid;
  break-inside: avoid;
}

.saq-pdf-option-letter {
  font-weight: 700;
  color: #111111;
  min-width: 18pt;
  flex-shrink: 0;
}

.saq-pdf-option-content {
  flex: 1;
}

.saq-pdf-math-display {
  display: block;
  text-align: center;
  margin: 10pt 0;
  font-family: "Cambria Math", "Latin Modern Math", "TeX Gyre Termes Math", "Times New Roman", serif;
  font-size: 11pt;
  page-break-inside: avoid;
  break-inside: avoid;
}

.saq-pdf-math-inline {
  display: inline;
  font-family: "Cambria Math", "Latin Modern Math", "TeX Gyre Termes Math", "Times New Roman", serif;
  font-style: italic;
}

.saq-pdf-math-plain {
  font-family: "Cambria Math", serif;
}

math {
  font-size: 1.05em;
  font-family: "Cambria Math", "Latin Modern Math", serif;
}

pre.saq-pdf-code-block {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 8.5pt;
  line-height: 1.4;
  background: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 3pt;
  padding: 8pt 10pt;
  margin: 8pt 0;
  white-space: pre-wrap;
  word-break: break-word;
  tab-size: 4;
  page-break-inside: auto;
  break-inside: auto;
}

code.saq-pdf-inline-code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 9pt;
  background: #f1f3f5;
  border: 1px solid #e9ecef;
  border-radius: 2pt;
  padding: 1pt 3pt;
}

table.saq-pdf-table {
  width: 100%;
  border-collapse: collapse;
  margin: 10pt 0;
  font-size: 9pt;
  page-break-inside: auto;
  break-inside: auto;
}

table.saq-pdf-table thead {
  display: table-header-group;
}

table.saq-pdf-table tr {
  page-break-inside: avoid;
  break-inside: avoid;
}

table.saq-pdf-table caption {
  caption-side: top;
  text-align: left;
  font-style: italic;
  font-size: 8.5pt;
  color: #444444;
  margin-bottom: 4pt;
}

table.saq-pdf-table th,
table.saq-pdf-table td {
  border: 1px solid #dee2e6;
  padding: 5pt 7pt;
  text-align: left;
  vertical-align: top;
  overflow-wrap: break-word;
}

table.saq-pdf-table th {
  background: #f1f3f5;
  font-weight: 600;
  color: #222222;
}

figure.saq-pdf-figure {
  margin: 10pt 0;
  text-align: center;
  page-break-inside: avoid;
  break-inside: avoid;
}

figure.saq-pdf-figure img,
img.saq-pdf-image {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 4pt auto;
}

figure.saq-pdf-figure figcaption {
  margin-top: 4pt;
  font-size: 8.5pt;
  font-style: italic;
  color: #555555;
}

.saq-pdf-svg-wrap {
  display: block;
  text-align: center;
  margin: 8pt 0;
  page-break-inside: avoid;
  break-inside: avoid;
}

.saq-pdf-svg-wrap svg {
  max-width: 100%;
  height: auto;
  display: inline-block;
}

ul.saq-pdf-list,
ol.saq-pdf-list {
  margin: 6pt 0 8pt 18pt;
  padding: 0;
}

li.saq-pdf-list-item {
  margin-bottom: 3pt;
}

blockquote.saq-pdf-blockquote {
  border-left: 3pt solid #adb5bd;
  margin: 8pt 0;
  padding: 4pt 0 4pt 10pt;
  color: #495057;
  font-style: italic;
  page-break-inside: avoid;
  break-inside: avoid;
}

a.saq-pdf-link {
  color: #1a73e8;
  text-decoration: underline;
}

.saq-pdf-interaction-box {
  margin-top: 8pt;
  padding: 5pt 8pt;
  background: #f8f9fa;
  border-left: 3pt solid #6c757d;
  font-size: 8.5pt;
  color: #495057;
  page-break-inside: avoid;
  break-inside: avoid;
}

.saq-pdf-review-box {
  margin-top: 8pt;
  padding: 6pt 10pt;
  background: #f0f7ff;
  border: 1px solid #b6d4fe;
  border-radius: 3pt;
  font-size: 8.5pt;
  color: #084298;
  page-break-inside: avoid;
  break-inside: avoid;
}

.saq-pdf-review-title {
  font-weight: 700;
  margin-bottom: 2pt;
}

.saq-pdf-review-feedback {
  margin-top: 4pt;
  font-style: italic;
  color: #333333;
}
`;

// ── HTML Escaping & Sanitization Helpers ─────────────────────────────────────

function escapePdfHtml(str) {
  if (typeof str !== "string") str = String(str ?? "");
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function sanitizePdfUrl(url) {
  if (!url || typeof url !== "string") return "#";
  const trimmed = url.trim();
  if (/^(?:javascript:|vbscript:|data:(?!image\/))/i.test(trimmed)) {
    return "#";
  }
  return trimmed;
}

function sanitizePdfSvg(svgStr) {
  if (typeof svgStr !== "string") return "";
  let clean = svgStr.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  clean = clean.replace(/\son\w+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, "");
  clean = clean.replace(/(?:href|xlink:href)\s*=\s*["']\s*javascript:[^"']*["']/gi, 'href="#"');
  return clean;
}

export {
  escapePdfHtml as escapeHtml,
  sanitizePdfUrl as sanitizeUrl,
  sanitizePdfSvg as sanitizeSvg,
};

const PDF_QUESTION_TYPE_LABELS = {
  [QuestionType.MCQ]: "MCQ",
  [QuestionType.MSQ]: "MSQ",
  [QuestionType.NUMERICAL]: "Numerical",
  [QuestionType.TEXT]: "Text",
  [QuestionType.DESCRIPTIVE]: "Descriptive",
  [QuestionType.UNKNOWN]: "Unknown",
};

// ── PDF Renderer Class ───────────────────────────────────────────────────────

export class PDFRenderer {
  constructor(options = {}) {
    this.options = {
      title: null,
      resourceMap: null,
      includeHeader: true,
      includePageNumbers: true,
      includeInteractionState: false,
      includeReviewData: false,
      css: PDF_CSS,
      customCss: "",
      ...options,
    };
  }

  /**
   * Resolves a canonical asset URL or SVG string against the resourceMap.
   * @param {string} sourceKey
   * @returns {string}
   */
  resolveResource(sourceKey) {
    if (!sourceKey || !this.options.resourceMap) return sourceKey;
    const map = this.options.resourceMap;
    if (map instanceof Map && map.has(sourceKey)) {
      return map.get(sourceKey);
    }
    if (typeof map === "object" && sourceKey in map) {
      return map[sourceKey];
    }
    return sourceKey;
  }

  /**
   * Renders an AssignmentDocument into a standalone, print-ready HTML document string.
   * Pure functional transformation, runnable in Node.js or browser.
   * @param {Object} assignmentDoc AssignmentDocument
   * @returns {string} Standalone HTML document
   */
  renderDocument(assignmentDoc) {
    if (!assignmentDoc || !Array.isArray(assignmentDoc.questions)) {
      throw new TypeError("AssignmentDocument with questions array is required for PDF rendering.");
    }

    const title =
      this.options.title ||
      assignmentDoc.metadata?.title ||
      assignmentDoc.title ||
      "Assignment";

    const headerHtml = this.options.includeHeader !== false
      ? this.renderHeader(assignmentDoc.metadata || {}, title)
      : "";

    const questionsHtml = assignmentDoc.questions
      .map((q) => this.renderQuestion(q))
      .filter(Boolean)
      .join("\n\n");

    const cssContent = this.options.css || PDF_CSS;
    const customCss = this.options.customCss ? `\n${this.options.customCss}` : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapePdfHtml(title)}</title>
  <style>
${cssContent}${customCss}
  </style>
</head>
<body>
  <div class="saq-pdf-document">
${headerHtml}
    <main class="saq-pdf-main">
${questionsHtml}
    </main>
  </div>
</body>
</html>`;
  }

  /**
   * Renders assignment metadata header.
   */
  renderHeader(metadata, title) {
    const headerTitle = title || metadata.title || "Assignment";
    const metaItems = [];

    if (metadata.course && typeof metadata.course === "string" && metadata.course.trim()) {
      metaItems.push(`<div class="saq-pdf-meta-item"><strong>Course:</strong> ${escapePdfHtml(metadata.course.trim())}</div>`);
    }

    if (metadata.totalQuestions !== undefined && metadata.totalQuestions !== null) {
      metaItems.push(`<div class="saq-pdf-meta-item"><strong>Questions:</strong> ${escapePdfHtml(String(metadata.totalQuestions))}</div>`);
    }

    if (metadata.totalMarks !== undefined && metadata.totalMarks !== null) {
      metaItems.push(`<div class="saq-pdf-meta-item"><strong>Total Marks:</strong> ${escapePdfHtml(String(metadata.totalMarks))}</div>`);
    }

    const metaBlock = metaItems.length > 0
      ? `      <div class="saq-pdf-metadata">\n        ${metaItems.join("\n        ")}\n      </div>`
      : "";

    return `    <header class="saq-pdf-header">
      <h1 class="saq-pdf-title">${escapePdfHtml(headerTitle)}</h1>
${metaBlock}
    </header>`;
  }

  /**
   * Renders a single QuestionNode into HTML.
   * @param {Object} question QuestionNode
   * @returns {string}
   */
  renderQuestion(question) {
    if (!question || question.number === undefined || question.number === null) {
      throw new Error("QuestionNode must have a valid number.");
    }

    // Guard against legacy-only migration nodes
    if (
      question.stem.length === 1 &&
      question.stem[0].type === ContentType.HTML_BLOCK &&
      (!question.options || question.options.length === 0)
    ) {
      throw new Error(
        `Question ${question.number} contains only legacy HTML data and cannot be exported to semantic PDF. Semantic extraction is required.`
      );
    }

    const parts = [];

    // 1. Heading
    let labelText = `Question ${question.number}`;
    if (question.label && question.label !== labelText) {
      if (question.label.startsWith(labelText)) {
        labelText = question.label;
      } else {
        labelText = `${labelText} — ${question.label}`;
      }
    }
    parts.push(`      <h2 class="saq-pdf-question-header">${escapePdfHtml(labelText)}</h2>`);

    // 2. Question Metadata (Type, Marks, Negative Marks)
    const metaParts = [];
    if (question.type) {
      const typeLabel = PDF_QUESTION_TYPE_LABELS[question.type] || question.type;
      metaParts.push(`<span>Type: ${escapePdfHtml(typeLabel)}</span>`);
    }
    if (question.marks !== null && question.marks !== undefined) {
      metaParts.push(`<span>Marks: ${escapePdfHtml(String(question.marks))}</span>`);
    }
    if (question.negativeMarks !== null && question.negativeMarks !== undefined && question.negativeMarks !== 0) {
      metaParts.push(`<span>Negative Marks: ${escapePdfHtml(String(question.negativeMarks))}</span>`);
    }
    if (metaParts.length > 0) {
      parts.push(`      <div class="saq-pdf-question-meta">${metaParts.join("")}</div>`);
    }

    // 3. Question Stem
    if (Array.isArray(question.stem) && question.stem.length > 0) {
      const stemHtml = this.renderBlocks(question.stem);
      if (stemHtml) {
        parts.push(`      <div class="saq-pdf-stem">\n${stemHtml}\n      </div>`);
      }
    }

    // 4. Options
    if (Array.isArray(question.options) && question.options.length > 0) {
      const optionsHtml = this.renderOptions(question.options);
      if (optionsHtml) {
        parts.push(optionsHtml);
      }
    }

    // 5. Opt-in Interaction State
    if (this.options.includeInteractionState) {
      const interactionHtml = this.renderInteractionState(question);
      if (interactionHtml) {
        parts.push(interactionHtml);
      }
    }

    // 6. Opt-in Review / Evaluation Data
    if (this.options.includeReviewData && question.review) {
      const reviewHtml = this.renderReviewData(question.review);
      if (reviewHtml) {
        parts.push(reviewHtml);
      }
    }

    return `    <section class="saq-pdf-question" id="question-${question.number}">\n${parts.join("\n")}\n    </section>`;
  }

  /**
   * Renders choice options.
   * @param {Array} options OptionNode[]
   * @returns {string}
   */
  renderOptions(options) {
    const items = options.map((opt, idx) => {
      const letter = (opt.letter && opt.letter.trim()) || String.fromCharCode(65 + idx);
      const content = this.renderInline(opt.content);
      return `          <li class="saq-pdf-option"><span class="saq-pdf-option-letter">${escapePdfHtml(letter)}.</span><div class="saq-pdf-option-content">${content}</div></li>`;
    });

    return `      <div class="saq-pdf-options-title">Options:</div>\n      <ul class="saq-pdf-options">\n${items.join("\n")}\n      </ul>`;
  }

  /**
   * Renders student interaction state (if enabled).
   * @param {Object} question QuestionNode
   * @returns {string|null}
   */
  renderInteractionState(question) {
    if (Array.isArray(question.options) && question.options.length > 0) {
      const selected = question.options
        .filter((o) => o.selected)
        .map((o, idx) => (o.letter && o.letter.trim()) || String.fromCharCode(65 + idx));

      if (selected.length > 0) {
        return `      <div class="saq-pdf-interaction-box"><strong>Existing Selection:</strong> ${escapePdfHtml(selected.join(", "))}</div>`;
      }
    }

    if (question.status?.value !== undefined && question.status?.value !== null && question.status?.value !== "") {
      return `      <div class="saq-pdf-interaction-box"><strong>Existing Response:</strong> ${escapePdfHtml(String(question.status.value))}</div>`;
    }

    return null;
  }

  /**
   * Renders evaluation review feedback (if enabled).
   * @param {Object} review
   * @returns {string|null}
   */
  renderReviewData(review) {
    if (!review) return null;
    const items = [];

    if (review.score !== undefined && review.score !== null) {
      items.push(`<div><strong>Score:</strong> ${escapePdfHtml(String(review.score))}</div>`);
    }

    if (review.isCorrect !== undefined && review.isCorrect !== null) {
      items.push(`<div><strong>Result:</strong> ${review.isCorrect ? "Correct" : "Incorrect"}</div>`);
    } else if (review.statusText) {
      items.push(`<div><strong>Result:</strong> ${escapePdfHtml(review.statusText)}</div>`);
    }

    if (review.feedback && typeof review.feedback === "string" && review.feedback.trim()) {
      items.push(`<div class="saq-pdf-review-feedback">${escapePdfHtml(review.feedback.trim())}</div>`);
    }

    if (items.length === 0) return null;

    return `      <div class="saq-pdf-review-box">\n        <div class="saq-pdf-review-title">Review / Evaluation</div>\n        ${items.join("\n        ")}\n      </div>`;
  }

  // ── Block Content Renderers ────────────────────────────────────────────────

  /**
   * Renders an array of block ContentNodes into HTML strings.
   * @param {Array} nodes ContentNode[]
   * @returns {string}
   */
  renderBlocks(nodes) {
    if (!Array.isArray(nodes) || nodes.length === 0) return "";
    return nodes
      .map((node) => this.renderNode(node))
      .filter((html) => html && html.trim().length > 0)
      .join("\n");
  }

  /**
   * Dispatches serialization of any ContentNode (block or inline).
   * @param {Object} node ContentNode
   * @param {Object} [context]
   * @returns {string}
   */
  renderNode(node, context = {}) {
    if (!node || typeof node !== "object") return "";
    if (!node.type) {
      throw new Error("Invalid ContentNode: missing type.");
    }

    switch (node.type) {
      case ContentType.PARAGRAPH:
        return this.renderParagraph(node, context);

      case ContentType.HEADING:
        return this.renderHeading(node, context);

      case ContentType.TEXT:
        return this.renderText(node, context);

      case ContentType.INLINE_CODE:
        return `<code class="saq-pdf-inline-code">${escapePdfHtml(node.value || "")}</code>`;

      case ContentType.CODE_BLOCK:
        return this.renderCodeBlock(node);

      case ContentType.MATH:
        return this.renderMath(node, context);

      case ContentType.LIST:
        return this.renderList(node, context);

      case ContentType.LIST_ITEM:
        return this.renderListItem(node, context);

      case ContentType.BLOCKQUOTE:
        return this.renderBlockquote(node, context);

      case ContentType.TABLE:
        return this.renderTable(node, context);

      case ContentType.FIGURE:
        return this.renderFigure(node, context);

      case ContentType.IMAGE:
        return this.renderImage(node, context);

      case ContentType.SVG:
        return this.renderSvg(node, context);

      case ContentType.LINK:
        return this.renderLink(node, context);

      case ContentType.LINE_BREAK:
        return "<br>";

      case ContentType.HTML_BLOCK:
        return node.value || "";

      default:
        if (node.children && node.children.length > 0) {
          return this.renderInline(node.children, context);
        }
        return escapePdfHtml(node.value || "");
    }
  }

  /**
   * Renders inline ContentNodes sequence.
   * @param {Array} nodes
   * @param {Object} [context]
   * @returns {string}
   */
  renderInline(nodes, context = {}) {
    if (!Array.isArray(nodes)) return "";
    return nodes.map((n) => this.renderNode(n, context)).join("");
  }

  renderParagraph(node, context) {
    const content =
      node.children && node.children.length > 0
        ? this.renderInline(node.children, context)
        : escapePdfHtml(node.value || "");
    return `<p class="saq-pdf-paragraph">${content}</p>`;
  }

  renderHeading(node, context) {
    const rawLevel = node.attributes?.level ?? 1;
    const level = Math.min(Math.max(parseInt(rawLevel, 10) || 1, 1), 6);
    const content =
      node.children && node.children.length > 0
        ? this.renderInline(node.children, context)
        : escapePdfHtml(node.value || "");
    return `<h${level} class="saq-pdf-heading">${content}</h${level}>`;
  }

  renderText(node, context) {
    let text = escapePdfHtml(node.value || "");
    const attrs = node.attributes || {};

    if (attrs.sub) text = `<sub>${text}</sub>`;
    if (attrs.sup) text = `<sup>${text}</sup>`;
    if (attrs.underline) text = `<u>${text}</u>`;
    if (attrs.strike) text = `<del>${text}</del>`;
    if (attrs.italic) text = `<em>${text}</em>`;
    if (attrs.bold) text = `<strong>${text}</strong>`;

    return text;
  }

  /**
   * Renders a pre-formatted code block preserving exact whitespace, tabs, and indentation.
   */
  renderCodeBlock(node) {
    const langAttr = node.attributes?.language ? ` class="language-${escapePdfHtml(node.attributes.language)}"` : "";
    const rawCode = node.value ?? "";
    return `<pre class="saq-pdf-code-block"><code${langAttr}>${escapePdfHtml(rawCode)}</code></pre>`;
  }

  /**
   * Renders mathematical expressions.
   * TeX: MathJax/KaTeX-compatible spans or display blocks.
   * MathML: native <math> element.
   * Text fallback: clean plaintext serif representation.
   */
  renderMath(node, context) {
    const format = node.attributes?.format || MathFormat.TEX;
    const isDisplay = node.attributes?.mathType === MathType.DISPLAY;
    const val = (node.value || "").trim();

    if (format === MathFormat.MATHML || val.startsWith("<math")) {
      return isDisplay
        ? `<div class="saq-pdf-math-display">${val}</div>`
        : `<span class="saq-pdf-math-inline">${val}</span>`;
    }

    if (format === MathFormat.TEX) {
      if (isDisplay) {
        return `<div class="saq-pdf-math-display"><span class="saq-pdf-math-tex">\\[${escapePdfHtml(val)}\\]</span></div>`;
      }
      return `<span class="saq-pdf-math-inline"><span class="saq-pdf-math-tex">\\(${escapePdfHtml(val)}\\)</span></span>`;
    }

    return `<span class="saq-pdf-math-plain">${escapePdfHtml(val)}</span>`;
  }

  renderList(listNode, context = {}) {
    const isOrdered = Boolean(listNode.attributes?.ordered);
    const startNum = parseInt(listNode.attributes?.start, 10);
    const tag = isOrdered ? "ol" : "ul";
    const startAttr = isOrdered && startNum && startNum !== 1 ? ` start="${startNum}"` : "";

    const items = (listNode.children || [])
      .map((item) => this.renderListItem(item, context))
      .join("\n");

    return `<${tag} class="saq-pdf-list"${startAttr}>\n${items}\n</${tag}>`;
  }

  renderListItem(itemNode, context = {}) {
    if (!itemNode.children || itemNode.children.length === 0) {
      return `  <li class="saq-pdf-list-item">${escapePdfHtml(itemNode.value || "")}</li>`;
    }

    const inlineParts = [];
    const nestedBlocks = [];

    for (const child of itemNode.children) {
      if (child.type === ContentType.LIST) {
        nestedBlocks.push(this.renderList(child, context));
      } else if (
        child.type === ContentType.CODE_BLOCK ||
        child.type === ContentType.TABLE ||
        child.type === ContentType.BLOCKQUOTE
      ) {
        nestedBlocks.push(this.renderNode(child, context));
      } else {
        inlineParts.push(this.renderNode(child, context));
      }
    }

    let result = inlineParts.join("").trim();
    if (nestedBlocks.length > 0) {
      result += (result ? "\n" : "") + nestedBlocks.join("\n");
    }

    return `  <li class="saq-pdf-list-item">${result}</li>`;
  }

  renderBlockquote(node, context) {
    const inner =
      node.children && node.children.length > 0
        ? this.renderBlocks(node.children)
        : escapePdfHtml(node.value || "");
    return `<blockquote class="saq-pdf-blockquote">\n${inner}\n</blockquote>`;
  }

  renderTable(tableNode, context = {}) {
    const rows = tableNode.children || [];
    if (rows.length === 0) return "";

    const parts = ['<table class="saq-pdf-table">'];
    if (tableNode.attributes?.caption) {
      parts.push(`  <caption>${escapePdfHtml(tableNode.attributes.caption.trim())}</caption>`);
    }

    let inThead = false;
    let inTbody = false;

    rows.forEach((row, rIdx) => {
      const isHeaderRow =
        row.children && row.children.length > 0 && row.children.every((c) => c.attributes?.isHeader);

      if (isHeaderRow && !inThead && rIdx === 0) {
        parts.push("  <thead>");
        inThead = true;
      } else if (!isHeaderRow && inThead) {
        parts.push("  </thead>");
        inThead = false;
      }

      if (!isHeaderRow && !inTbody && !inThead) {
        parts.push("  <tbody>");
        inTbody = true;
      }

      parts.push("    <tr>");
      for (const cell of row.children || []) {
        const tag = cell.attributes?.isHeader ? "th" : "td";
        const attrs = [];
        if (cell.attributes?.colspan > 1) attrs.push(`colspan="${cell.attributes.colspan}"`);
        if (cell.attributes?.rowspan > 1) attrs.push(`rowspan="${cell.attributes.rowspan}"`);
        if (cell.attributes?.align && cell.attributes.align !== "left") {
          attrs.push(`align="${escapePdfHtml(cell.attributes.align)}"`);
        }
        const attrStr = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
        const cellContent =
          cell.children && cell.children.length > 0
            ? this.renderInline(cell.children, context)
            : escapePdfHtml(cell.value || "");
        parts.push(`      <${tag}${attrStr}>${cellContent}</${tag}>`);
      }
      parts.push("    </tr>");
    });

    if (inThead) parts.push("  </thead>");
    if (inTbody) parts.push("  </tbody>");

    parts.push("</table>");
    return parts.join("\n");
  }

  renderImage(node, context) {
    const rawSrc = node.attributes?.src || "";
    const resolvedSrc = this.resolveResource(rawSrc);
    const safeSrc = sanitizePdfUrl(resolvedSrc);
    const alt = node.attributes?.alt || "";
    const title = node.attributes?.title ? ` title="${escapePdfHtml(node.attributes.title)}"` : "";
    const width = node.attributes?.width ? ` width="${escapePdfHtml(String(node.attributes.width))}"` : "";
    const height = node.attributes?.height ? ` height="${escapePdfHtml(String(node.attributes.height))}"` : "";

    const imgTag = `<img class="saq-pdf-image" src="${safeSrc}" alt="${escapePdfHtml(alt)}"${title}${width}${height} />`;

    // If part of an inline context or inside a figure already, return img tag directly
    if (context.isInline) {
      return imgTag;
    }

    return `<figure class="saq-pdf-figure">${imgTag}</figure>`;
  }

  renderFigure(node, context) {
    const parts = [];

    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        parts.push(this.renderNode(child, { ...context, isInline: true }));
      }
    }

    if (node.attributes?.caption) {
      parts.push(`<figcaption>${escapePdfHtml(node.attributes.caption.trim())}</figcaption>`);
    }

    return `<figure class="saq-pdf-figure">\n  ${parts.join("\n  ")}\n</figure>`;
  }

  renderSvg(node, context) {
    const url = node.attributes?.src || node.attributes?.url;
    if (url) {
      const resolvedUrl = this.resolveResource(url);
      const title = node.attributes?.title || "SVG Diagram";
      return `<div class="saq-pdf-svg-wrap"><img class="saq-pdf-image" src="${sanitizePdfUrl(resolvedUrl)}" alt="${escapePdfHtml(title)}" /></div>`;
    }

    const svgSource = (node.value || "").trim();
    if (!svgSource) return "";

    // Check if inline SVG is mapped to an extracted asset file path
    const resolvedAsset = this.resolveResource(svgSource);
    if (resolvedAsset !== svgSource) {
      const title = node.attributes?.title || "SVG Diagram";
      return `<div class="saq-pdf-svg-wrap"><img class="saq-pdf-image" src="${sanitizePdfUrl(resolvedAsset)}" alt="${escapePdfHtml(title)}" /></div>`;
    }

    return `<div class="saq-pdf-svg-wrap">${sanitizePdfSvg(svgSource)}</div>`;
  }

  renderLink(node, context) {
    const rawHref = node.attributes?.href || "";
    const safeHref = sanitizePdfUrl(rawHref);
    const title = node.attributes?.title ? ` title="${escapePdfHtml(node.attributes.title)}"` : "";

    const text =
      node.children && node.children.length > 0
        ? this.renderInline(node.children, context)
        : escapePdfHtml(node.value || safeHref);

    return `<a class="saq-pdf-link" href="${safeHref}"${title} target="_blank" rel="noopener noreferrer">${text}</a>`;
  }
}

// ── Functional Entry Points ──────────────────────────────────────────────────

/**
 * Pure functional entry point: renders an AssignmentDocument into standalone print HTML.
 * Suitable for Node.js or browser.
 * @param {Object} assignmentDoc AssignmentDocument
 * @param {Object} [options]
 * @returns {string} Standalone HTML document string
 */
export function renderPdfDocument(assignmentDoc, options = {}) {
  const renderer = new PDFRenderer(options);
  return renderer.renderDocument(assignmentDoc);
}

function decodeBase64ToBytes(base64Str) {
  if (typeof atob === "function") {
    const bin = atob(base64Str);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
  }
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64Str, "base64"));
  }
  throw new Error("Base64 decoding is not available in this environment.");
}

function triggerPdfBlobDownload(filename, bytes, { revokeDelayMs = 250 } = {}) {
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error("Browser Blob URL download is not available.");
  }
  const blob = new Blob([bytes], { type: "application/pdf" });
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
}

function sendPrintToPdfRuntimeMessage() {
  return new Promise((resolve, reject) => {
    try {
      let settled = false;
      const done = (err, res) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve(res);
      };

      const maybePromise = chrome.runtime.sendMessage({ type: "UNFOLD_PRINT_TO_PDF" }, (response) => {
        const lastErr = chrome.runtime?.lastError;
        if (lastErr) {
          done(new Error(lastErr.message || String(lastErr)));
        } else {
          done(null, response);
        }
      });

      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(
          (res) => done(null, res),
          (err) => done(err instanceof Error ? err : new Error(String(err)))
        );
      }
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * Browser PDF Export & Print Workflow:
 * - Prepares print-mode view in an isolated iframe and waits for images and fonts.
 * - In the Chromium extension (when chrome.runtime.sendMessage is present), requests
 *   direct PDF generation via chrome.debugger + Page.printToPDF and downloads the PDF
 *   directly via an <a download=filename> click without opening a print dialog.
 * - In the Bookmarklet, Firefox, or on any direct-path error, falls back to the
 *   window.print() / iframe.contentWindow.print() flow, setting document.title to the
 *   intelligent filename (without extension) for the duration of the print and restoring
 *   it in afterprint and on error.
 *
 * @param {Object} assignmentDoc AssignmentDocument
 * @param {Object} [options]
 * @returns {Promise<{success: boolean, method?: string, filename?: string, fallbackReason?: string}>}
 */
export async function exportPdf(assignmentDoc, options = {}) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("exportPdf requires a browser environment with window and document.");
  }

  const filename = options.filename || buildExportFilename(assignmentDoc?.metadata || {}, "pdf");
  const printTitle = filename.replace(/\.pdf$/i, "");
  const html = renderPdfDocument(assignmentDoc, options);
  const printTimeoutMs = options.printTimeoutMs ?? 60000;
  const imageTimeoutMs = options.imageTimeoutMs ?? 3000;

  return new Promise((resolve, reject) => {
    try {
      const iframe = document.createElement("iframe");
      iframe.className = "saq-pdf-print-frame";
      iframe.setAttribute?.("aria-hidden", "true");
      iframe.style.cssText =
        "position:fixed;top:0;left:-9999px;width:1px;height:1px;border:none;opacity:0;pointer-events:none;z-index:-1;";

      let printModeStyle = null;
      if (document.head && typeof document.createElement === "function") {
        try {
          printModeStyle = document.createElement("style");
          printModeStyle.className = "saq-pdf-print-mode-style";
          printModeStyle.textContent = `@media print { body > *:not(.saq-pdf-print-frame) { display: none !important; } iframe.saq-pdf-print-frame { position: static !important; left: 0 !important; top: 0 !important; width: 100% !important; height: auto !important; min-height: 100vh !important; opacity: 1 !important; pointer-events: auto !important; z-index: auto !important; } }`;
          document.head.appendChild(printModeStyle);
        } catch {
          printModeStyle = null;
        }
      }

      const previousDocTitle = typeof document.title === "string" ? document.title : "";
      let titleOverridden = false;
      let cleanedUp = false;
      let printTriggered = false;
      let initTimerId = null;
      let imgTimerId = null;
      let printTimeoutId = null;
      let iframeWin = null;
      let activePrintResult = { success: true, method: "print", filename };

      const restoreDocTitle = () => {
        if (!titleOverridden) return;
        titleOverridden = false;
        try {
          document.title = previousDocTitle;
        } catch {
          // ignore restore error
        }
      };

      const onAfterPrint = () => {
        cleanup();
        resolve(activePrintResult);
      };

      const onAbort = () => {
        cleanup();
        reject(new Error("PDF export cancelled by user"));
      };

      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;

        restoreDocTitle();

        if (initTimerId !== null) {
          clearTimeout(initTimerId);
          initTimerId = null;
        }
        if (imgTimerId !== null) {
          clearTimeout(imgTimerId);
          imgTimerId = null;
        }
        if (printTimeoutId !== null) {
          clearTimeout(printTimeoutId);
          printTimeoutId = null;
        }

        if (options.signal) {
          options.signal.removeEventListener?.("abort", onAbort);
        }

        if (iframeWin) {
          iframeWin.removeEventListener?.("afterprint", onAfterPrint);
        }
        window.removeEventListener?.("afterprint", onAfterPrint);

        if (printModeStyle) {
          try {
            if (printModeStyle.parentNode) {
              printModeStyle.parentNode.removeChild(printModeStyle);
            } else if (typeof printModeStyle.remove === "function") {
              printModeStyle.remove();
            }
          } catch {
            // ignore style removal error
          }
          printModeStyle = null;
        }

        try {
          if (iframe.parentNode) {
            iframe.parentNode.removeChild(iframe);
          } else if (typeof iframe.remove === "function") {
            iframe.remove();
          }
        } catch {
          // ignore cleanup errors
        }
      };

      if (options.signal?.aborted) {
        cleanup();
        reject(new Error("PDF export cancelled by user"));
        return;
      }

      if (options.signal) {
        options.signal.addEventListener("abort", onAbort, { once: true });
      }

      document.body.appendChild(iframe);

      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) {
        cleanup();
        reject(new Error("Unable to access iframe document for PDF printing."));
        return;
      }

      iframeDoc.open();
      iframeDoc.write(html);
      iframeDoc.close();

      if (globalThis.katex && typeof iframeDoc.querySelectorAll === "function") {
        try {
          if (globalThis.chrome?.runtime?.getURL && iframeDoc.head && typeof iframeDoc.createElement === "function") {
            const katexLink = iframeDoc.createElement("link");
            katexLink.rel = "stylesheet";
            katexLink.href = globalThis.chrome.runtime.getURL("katex.min.css");
            iframeDoc.head.appendChild(katexLink);
          }
          const mathEls = iframeDoc.querySelectorAll(".saq-pdf-math-tex");
          for (const el of mathEls) {
            const raw = el.textContent || "";
            let tex = raw;
            let isDisplay = false;
            if (raw.startsWith("\\[") && raw.endsWith("\\]")) {
              tex = raw.slice(2, -2).trim();
              isDisplay = true;
            } else if (raw.startsWith("\\(") && raw.endsWith("\\)")) {
              tex = raw.slice(2, -2).trim();
              isDisplay = false;
            }
            try {
              const rendered = globalThis.katex.renderToString(tex, {
                displayMode: isDisplay,
                throwOnError: true,
                output: "htmlAndMathml",
              });
              el.innerHTML = rendered;
            } catch {
              // fallback remains unchanged
            }
          }
        } catch {
          // ignore enhancement error
        }
      }

      iframeWin = iframe.contentWindow;

      const runWindowPrintFallback = (method = "print", fallbackReason = null) => {
        try {
          if (iframeWin) {
            try {
              document.title = printTitle;
              titleOverridden = true;
            } catch {
              // ignore title assignment error
            }
            try {
              if (iframeDoc) iframeDoc.title = printTitle;
            } catch {
              // ignore iframe title assignment error
            }

            activePrintResult = {
              success: true,
              method,
              filename,
              ...(fallbackReason ? { fallbackReason } : {}),
            };

            iframeWin.focus();
            iframeWin.addEventListener("afterprint", onAfterPrint, { once: true });
            window.addEventListener?.("afterprint", onAfterPrint, { once: true });

            // Safety timeout in case afterprint does not fire in some browser versions
            printTimeoutId = setTimeout(() => {
              cleanup();
              resolve({ ...activePrintResult, timedOut: true });
            }, printTimeoutMs);

            iframeWin.print();
          } else {
            cleanup();
            reject(new Error("Unable to access iframe contentWindow."));
          }
        } catch (printErr) {
          cleanup();
          reject(printErr);
        }
      };

      const triggerPrint = () => {
        if (cleanedUp || printTriggered) return;
        printTriggered = true;

        if (imgTimerId !== null) {
          clearTimeout(imgTimerId);
          imgTimerId = null;
        }

        const waitForFonts =
          iframeDoc.fonts?.ready && typeof iframeDoc.fonts.ready.then === "function"
            ? Promise.race([
                iframeDoc.fonts.ready.catch(() => {}),
                new Promise((r) => setTimeout(r, 300)),
              ])
            : Promise.resolve();

        waitForFonts.then(() => {
          if (cleanedUp) return;

          const canTryDirect = Boolean(
            options.useDirectDownload !== false &&
              typeof chrome !== "undefined" &&
              chrome?.runtime &&
              typeof chrome.runtime.sendMessage === "function"
          );

          if (!canTryDirect) {
            runWindowPrintFallback("print", null);
            return;
          }

          sendPrintToPdfRuntimeMessage()
            .then((res) => {
              if (cleanedUp) return;
              if (!res || !res.ok || typeof res.data !== "string" || !res.data) {
                throw new Error(res?.error || "Direct PDF generation failed.");
              }
              const pdfBytes = decodeBase64ToBytes(res.data);
              triggerPdfBlobDownload(filename, pdfBytes, options);
              cleanup();
              resolve({ success: true, method: "direct", filename });
            })
            .catch((directErr) => {
              if (cleanedUp) return;
              const fallbackReason = directErr?.message || String(directErr);
              if (typeof options.onFallback === "function") {
                try {
                  options.onFallback(fallbackReason);
                } catch {
                  // ignore callback error
                }
              }
              runWindowPrintFallback("fallback-print", fallbackReason);
            });
        });
      };

      // Wait for any images inside the iframe to load before printing
      const images = Array.from(iframeDoc.images || []);
      if (images.length === 0) {
        initTimerId = setTimeout(triggerPrint, 20);
      } else {
        let remaining = images.length;
        const onImgDone = () => {
          remaining--;
          if (remaining <= 0) {
            triggerPrint();
          }
        };

        // Safety timeout if an image hangs
        imgTimerId = setTimeout(triggerPrint, imageTimeoutMs);

        images.forEach((img) => {
          if (img.complete) {
            onImgDone();
          } else {
            img.addEventListener("load", onImgDone, { once: true });
            img.addEventListener("error", onImgDone, { once: true });
          }
        });
      }
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Common alias for PDF rendering / export.
 */
export const exportAssignmentToPdf = renderPdfDocument;
