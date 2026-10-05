#!/usr/bin/env node
/**
 * High-Fidelity PDF Exporter Test Suite.
 * 
 * Verifies all Phase 6 requirements:
 * 1. Valid standalone HTML structure (DOCTYPE, html, head, style, body)
 * 2. Embedded print stylesheet (PDF_CSS contains @page, academic typography, page breaks)
 * 3. Custom title option overriding
 * 4. Custom CSS option appending
 * 5. Suppressing header via includeHeader: false
 * 6. Assignment metadata rendering (course, questions, marks)
 * 7. Question metadata rendering (number, label, type, marks, negative marks)
 * 8. Paragraph rendering (<p class="saq-pdf-paragraph">)
 * 9. Heading rendering (<h1-6 class="saq-pdf-heading"> with clamped levels)
 * 10. Inline text formatting (bold, italic, underline, strike, sub, sup)
 * 11. Inline code rendering (<code class="saq-pdf-inline-code">)
 * 12. Code block exact whitespace, indentation, and tabs preservation
 * 13. MathML <math> native rendering
 * 14. TeX display math rendering in .saq-pdf-math-display
 * 15. TeX inline math rendering in .saq-pdf-math-inline
 * 16. Ordered and unordered lists with nested list support
 * 17. Blockquote rendering (<blockquote class="saq-pdf-blockquote">)
 * 18. Simple table rendering (thead, tbody, th, td)
 * 19. Complex table with colspan, rowspan, align, and caption
 * 20. Image rendering in figure with alt and optional caption
 * 21. Resource map resolution for images
 * 22. Resource map resolution for external SVGs
 * 23. Inline SVG rendering and script/event sanitization
 * 24. Options rendering (<ul class="saq-pdf-options"> with letter markers)
 * 25. Opt-in interaction state (default false omits; true renders)
 * 26. Opt-in review data (default false omits; true renders)
 * 27. Deterministic output (repeated rendering produces exact string)
 * 28. Legacy guard against unextracted HTML nodes
 */

import { ContentType, QuestionType, MathType, MathFormat } from "../src/model/types.js";
import {
  ContentNode,
  OptionNode,
  QuestionNode,
  AssignmentDocument,
  buildExportFilename,
} from "../src/model/document.js";
import {
  renderPdfDocument,
  PDFRenderer,
  escapeHtml,
  sanitizeUrl,
  sanitizeSvg,
  PDF_CSS,
} from "../src/exporters/pdf.js";

let passed = true;

function check(desc, fn) {
  try {
    fn();
    console.log(`✓ ${desc}`);
  } catch (e) {
    console.error(`❌ ${desc}: ${e.message}`);
    passed = false;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

console.log("\nStarting Phase 6 PDF Exporter Verification Suite...\n");

// Helper to create a basic single-question AssignmentDocument
function createSimpleDoc(stemNodes = [], options = []) {
  return new AssignmentDocument({
    metadata: {
      title: "Data Science Assessment 1",
      course: "BS in Data Science",
      totalQuestions: 1,
      totalMarks: 2.5,
    },
    questions: [
      new QuestionNode({
        number: 1,
        label: "Question 1",
        type: QuestionType.MCQ,
        marks: 2.5,
        stem: stemNodes.length > 0 ? stemNodes : [
          new ContentNode({
            type: ContentType.PARAGRAPH,
            children: [new ContentNode({ type: ContentType.TEXT, value: "Which of the following is true?" })],
          }),
        ],
        options: options.length > 0 ? options : [
          new OptionNode({
            index: 0,
            letter: "A",
            content: [new ContentNode({ type: ContentType.TEXT, value: "First option statement." })],
          }),
          new OptionNode({
            index: 1,
            letter: "B",
            content: [new ContentNode({ type: ContentType.TEXT, value: "Second option statement." })],
          }),
        ],
      }),
    ],
  });
}

// ── Test 1: Valid standalone HTML structure ─────────────────────────────────
check("Test 1: Standalone HTML structure contains valid DOCTYPE, html, head, style, body", () => {
  const doc = createSimpleDoc();
  const html = renderPdfDocument(doc);

  assert(html.startsWith("<!DOCTYPE html>"), "Must begin with <!DOCTYPE html>");
  assert(html.includes("<html lang=\"en\">"), "Must have <html lang=\"en\">");
  assert(html.includes("<head>"), "Must have <head>");
  assert(html.includes("<meta charset=\"utf-8\">"), "Must have utf-8 charset");
  assert(html.includes("<title>Data Science Assessment 1</title>"), "Must have title tag");
  assert(html.includes("<style>"), "Must have <style> tag");
  assert(html.includes("</style>"), "Must close </style> tag");
  assert(html.includes("<body>"), "Must have <body>");
  assert(html.includes('<div class="saq-pdf-document">'), "Must have .saq-pdf-document container");
  assert(html.includes("</body>\n</html>"), "Must close body and html");
});

// ── Test 2: Embedded print stylesheet (PDF_CSS) ──────────────────────────────
check("Test 2: Embedded print stylesheet contains @page, academic typography, and break controls", () => {
  assert(PDF_CSS.includes("@page {"), "Must contain @page rule");
  assert(PDF_CSS.includes("size: A4;"), "Must specify A4 size");
  assert(PDF_CSS.includes("counter(page)"), "Must support page counter");
  assert(PDF_CSS.includes("break-inside: auto;"), "Must allow question break-inside auto");
  assert(PDF_CSS.includes("break-after: avoid;"), "Must avoid breaking after headings");
  assert(PDF_CSS.includes(".saq-pdf-question"), "Must style .saq-pdf-question");
  assert(PDF_CSS.includes(".saq-pdf-math-display"), "Must style display math");
  assert(PDF_CSS.includes("pre.saq-pdf-code-block"), "Must style code blocks");
  assert(PDF_CSS.includes("table.saq-pdf-table"), "Must style tables");
});

// ── Test 3: Custom title option ──────────────────────────────────────────────
check("Test 3: Custom title option overrides assignment document metadata title", () => {
  const doc = createSimpleDoc();
  const html = renderPdfDocument(doc, { title: "Custom Exam Title" });

  assert(html.includes("<title>Custom Exam Title</title>"), "Title tag must reflect custom title");
  assert(html.includes('<h1 class="saq-pdf-title">Custom Exam Title</h1>'), "H1 header must reflect custom title");
});

// ── Test 4: Custom CSS option ────────────────────────────────────────────────
check("Test 4: Custom CSS option is appended to the <style> block", () => {
  const doc = createSimpleDoc();
  const customCss = "/* Custom Test Style */ body { font-size: 12pt !important; }";
  const html = renderPdfDocument(doc, { customCss });

  assert(html.includes(customCss), "HTML <style> must include the custom CSS");
});

// ── Test 5: Suppress header via includeHeader: false ─────────────────────────
check("Test 5: includeHeader: false suppresses document header block", () => {
  const doc = createSimpleDoc();
  const html = renderPdfDocument(doc, { includeHeader: false });

  assert(!html.includes('<header class="saq-pdf-header">'), "Must not include header element");
  assert(!html.includes('<h1 class="saq-pdf-title">'), "Must not include title h1");
});

// ── Test 6: Assignment metadata rendering ────────────────────────────────────
check("Test 6: Assignment metadata renders course, total questions, and marks", () => {
  const doc = new AssignmentDocument({
    metadata: {
      title: "Algorithms Quiz",
      course: "CS2001 Algorithms",
      totalQuestions: 15,
      totalMarks: 30,
    },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.NUMERICAL,
        marks: 2,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "What is time complexity of merge sort?" })],
      }),
    ],
  });

  const html = renderPdfDocument(doc);
  assert(html.includes("<strong>Course:</strong> CS2001 Algorithms"), "Course must be rendered");
  assert(html.includes("<strong>Questions:</strong> 15"), "Questions count must be rendered");
  assert(html.includes("<strong>Total Marks:</strong> 30"), "Total marks must be rendered");
});

// ── Test 7: Question metadata rendering ──────────────────────────────────────
check("Test 7: Question metadata renders number, label, type, marks, negative marks", () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Test" },
    questions: [
      new QuestionNode({
        number: 4,
        label: "Question 4 — Section B",
        type: QuestionType.MSQ,
        marks: 3,
        negativeMarks: -1,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "Select all valid options." })],
      }),
    ],
  });

  const html = renderPdfDocument(doc);
  assert(html.includes('<h2 class="saq-pdf-question-header">Question 4 — Section B</h2>'), "Question heading must include label");
  assert(html.includes("<span>Type: MSQ</span>"), "Question type MSQ must be rendered");
  assert(html.includes("<span>Marks: 3</span>"), "Marks 3 must be rendered");
  assert(html.includes("<span>Negative Marks: -1</span>"), "Negative marks -1 must be rendered");
});

// ── Test 8: Paragraph rendering ──────────────────────────────────────────────
check("Test 8: Paragraph content renders with <p class=\"saq-pdf-paragraph\">", () => {
  const doc = createSimpleDoc([
    new ContentNode({
      type: ContentType.PARAGRAPH,
      children: [new ContentNode({ type: ContentType.TEXT, value: "This is a detailed paragraph." })],
    }),
  ]);

  const html = renderPdfDocument(doc);
  assert(html.includes('<p class="saq-pdf-paragraph">This is a detailed paragraph.</p>'), "Paragraph class and content must match");
});

// ── Test 9: Heading rendering with clamped levels ────────────────────────────
check("Test 9: Headings render with clamped levels (h1 through h6)", () => {
  const doc = createSimpleDoc([
    new ContentNode({
      type: ContentType.HEADING,
      attributes: { level: 3 },
      value: "Section Subheading",
    }),
    new ContentNode({
      type: ContentType.HEADING,
      attributes: { level: 9 }, // Should clamp to 6
      value: "Deep Subheading",
    }),
  ]);

  const html = renderPdfDocument(doc);
  assert(html.includes('<h3 class="saq-pdf-heading">Section Subheading</h3>'), "Heading level 3 must be h3");
  assert(html.includes('<h6 class="saq-pdf-heading">Deep Subheading</h6>'), "Heading level 9 must clamp to h6");
});

// ── Test 10: Inline text formatting ──────────────────────────────────────────
check("Test 10: Inline text formatting nests bold, italic, underline, strike, sub, sup", () => {
  const doc = createSimpleDoc([
    new ContentNode({
      type: ContentType.PARAGRAPH,
      children: [
        new ContentNode({
          type: ContentType.TEXT,
          value: "Bold and Italic",
          attributes: { bold: true, italic: true },
        }),
        new ContentNode({
          type: ContentType.TEXT,
          value: "Underline",
          attributes: { underline: true },
        }),
        new ContentNode({
          type: ContentType.TEXT,
          value: "Deleted",
          attributes: { strike: true },
        }),
        new ContentNode({
          type: ContentType.TEXT,
          value: "i",
          attributes: { sub: true },
        }),
        new ContentNode({
          type: ContentType.TEXT,
          value: "2",
          attributes: { sup: true },
        }),
      ],
    }),
  ]);

  const html = renderPdfDocument(doc);
  assert(html.includes("<strong><em>Bold and Italic</em></strong>") || html.includes("<em><strong>Bold and Italic</strong></em>"), "Bold + Italic tags must be present");
  assert(html.includes("<u>Underline</u>"), "Underline tag must be present");
  assert(html.includes("<del>Deleted</del>"), "Del/strike tag must be present");
  assert(html.includes("<sub>i</sub>"), "Sub tag must be present");
  assert(html.includes("<sup>2</sup>"), "Sup tag must be present");
});

// ── Test 11: Inline code rendering ───────────────────────────────────────────
check("Test 11: Inline code renders with <code class=\"saq-pdf-inline-code\">", () => {
  const doc = createSimpleDoc([
    new ContentNode({
      type: ContentType.PARAGRAPH,
      children: [
        new ContentNode({ type: ContentType.TEXT, value: "Use " }),
        new ContentNode({ type: ContentType.INLINE_CODE, value: "console.log(x)" }),
      ],
    }),
  ]);

  const html = renderPdfDocument(doc);
  assert(html.includes('<code class="saq-pdf-inline-code">console.log(x)</code>'), "Inline code tag and class must be present");
});

// ── Test 12: Code block whitespace and tabs preservation ─────────────────────
check("Test 12: Code block preserves exact indentation, whitespace, and tabs", () => {
  const pythonCode = "def calculate_mean(data):\n\ttotal = 0\n    for item in data:\n        total += item\n    return total / len(data)";
  const doc = createSimpleDoc([
    new ContentNode({
      type: ContentType.CODE_BLOCK,
      attributes: { language: "python" },
      value: pythonCode,
    }),
  ]);

  const html = renderPdfDocument(doc);
  assert(html.includes('<pre class="saq-pdf-code-block"><code class="language-python">'), "Code block pre/code tags and language class must be present");
  assert(html.includes(escapeHtml(pythonCode)), "Raw whitespace, indentation, and tabs must be preserved exactly");
});

// ── Test 13: MathML native rendering ─────────────────────────────────────────
check("Test 13: MathML <math> is rendered natively without distortion", () => {
  const mathmlSource = '<math xmlns="http://www.w3.org/1998/Math/MathML"><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mi>y</mi></math>';
  const doc = createSimpleDoc([
    new ContentNode({
      type: ContentType.MATH,
      attributes: { format: MathFormat.MATHML, mathType: MathType.DISPLAY },
      value: mathmlSource,
    }),
  ]);

  const html = renderPdfDocument(doc);
  assert(html.includes('<div class="saq-pdf-math-display">'), "Display math must be inside .saq-pdf-math-display");
  assert(html.includes(mathmlSource), "MathML XML content must be included natively");
});

// ── Test 14: TeX display math rendering ──────────────────────────────────────
check("Test 14: TeX display math is rendered in .saq-pdf-math-display with delimiters", () => {
  const texFormula = "\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}";
  const doc = createSimpleDoc([
    new ContentNode({
      type: ContentType.MATH,
      attributes: { format: MathFormat.TEX, mathType: MathType.DISPLAY },
      value: texFormula,
    }),
  ]);

  const html = renderPdfDocument(doc);
  assert(html.includes('<div class="saq-pdf-math-display">'), "Must have display math div");
  assert(html.includes('<span class="saq-pdf-math-tex">\\['), "Must have TeX display open delimiter \\[");
  assert(html.includes('\\]</span>'), "Must have TeX display close delimiter \\]");
  assert(html.includes(escapeHtml(texFormula)), "TeX formula content must be present");
});

// ── Test 15: TeX inline math rendering ───────────────────────────────────────
check("Test 15: TeX inline math is rendered in .saq-pdf-math-inline", () => {
  const texInline = "f(x) = \\sigma(W x + b)";
  const doc = createSimpleDoc([
    new ContentNode({
      type: ContentType.PARAGRAPH,
      children: [
        new ContentNode({ type: ContentType.TEXT, value: "Given " }),
        new ContentNode({
          type: ContentType.MATH,
          attributes: { format: MathFormat.TEX, mathType: MathType.INLINE },
          value: texInline,
        }),
      ],
    }),
  ]);

  const html = renderPdfDocument(doc);
  assert(html.includes('<span class="saq-pdf-math-inline"><span class="saq-pdf-math-tex">\\('), "Must have inline math wrapper and \\(");
  assert(html.includes('\\)</span></span>'), "Must have \\) closing delimiter");
  assert(html.includes(escapeHtml(texInline)), "Inline formula must be present");
});

// ── Test 16: Ordered and unordered lists with nesting ────────────────────────
check("Test 16: Ordered and unordered lists render with nested sub-lists", () => {
  const doc = createSimpleDoc([
    new ContentNode({
      type: ContentType.LIST,
      attributes: { ordered: true, start: 1 },
      children: [
        new ContentNode({
          type: ContentType.LIST_ITEM,
          children: [
            new ContentNode({ type: ContentType.TEXT, value: "Step 1: Data Preparation" }),
            new ContentNode({
              type: ContentType.LIST,
              attributes: { ordered: false },
              children: [
                new ContentNode({
                  type: ContentType.LIST_ITEM,
                  children: [new ContentNode({ type: ContentType.TEXT, value: "Clean missing values" })],
                }),
                new ContentNode({
                  type: ContentType.LIST_ITEM,
                  children: [new ContentNode({ type: ContentType.TEXT, value: "Normalize numeric features" })],
                }),
              ],
            }),
          ],
        }),
        new ContentNode({
          type: ContentType.LIST_ITEM,
          children: [new ContentNode({ type: ContentType.TEXT, value: "Step 2: Model Training" })],
        }),
      ],
    }),
  ]);

  const html = renderPdfDocument(doc);
  assert(html.includes('<ol class="saq-pdf-list">'), "Outer ordered list must use <ol>");
  assert(html.includes('<ul class="saq-pdf-list">'), "Inner unordered list must use <ul>");
  assert(html.includes("Step 1: Data Preparation"), "Step 1 text present");
  assert(html.includes("Clean missing values"), "Nested list item text present");
});

// ── Test 17: Blockquote rendering ────────────────────────────────────────────
check("Test 17: Blockquotes render with <blockquote class=\"saq-pdf-blockquote\">", () => {
  const doc = createSimpleDoc([
    new ContentNode({
      type: ContentType.BLOCKQUOTE,
      children: [
        new ContentNode({
          type: ContentType.PARAGRAPH,
          value: "Premature optimization is the root of all evil.",
        }),
      ],
    }),
  ]);

  const html = renderPdfDocument(doc);
  assert(html.includes('<blockquote class="saq-pdf-blockquote">'), "Blockquote element and class present");
  assert(html.includes("Premature optimization is the root of all evil."), "Quote content present");
});

// ── Test 18: Simple table rendering (thead, tbody, th, td) ───────────────────
check("Test 18: Simple table renders with thead, tbody, th, and td", () => {
  const doc = createSimpleDoc([
    new ContentNode({
      type: ContentType.TABLE,
      children: [
        new ContentNode({
          type: ContentType.TABLE_ROW,
          children: [
            new ContentNode({ type: ContentType.TABLE_CELL, attributes: { isHeader: true }, value: "Metric" }),
            new ContentNode({ type: ContentType.TABLE_CELL, attributes: { isHeader: true }, value: "Score" }),
          ],
        }),
        new ContentNode({
          type: ContentType.TABLE_ROW,
          children: [
            new ContentNode({ type: ContentType.TABLE_CELL, value: "Accuracy" }),
            new ContentNode({ type: ContentType.TABLE_CELL, value: "0.94" }),
          ],
        }),
      ],
    }),
  ]);

  const html = renderPdfDocument(doc);
  assert(html.includes('<table class="saq-pdf-table">'), "Table class present");
  assert(html.includes("<thead>"), "thead must group header row");
  assert(html.includes("<th>Metric</th>"), "th must render metric header");
  assert(html.includes("<th>Score</th>"), "th must render score header");
  assert(html.includes("<tbody>"), "tbody must group data rows");
  assert(html.includes("<td>Accuracy</td>"), "td must render cell");
  assert(html.includes("<td>0.94</td>"), "td must render cell");
});

// ── Test 19: Complex table with colspan, rowspan, align, caption ─────────────
check("Test 19: Complex table supports colspan, rowspan, align, and caption", () => {
  const doc = createSimpleDoc([
    new ContentNode({
      type: ContentType.TABLE,
      attributes: { caption: "Confusion Matrix Performance" },
      children: [
        new ContentNode({
          type: ContentType.TABLE_ROW,
          children: [
            new ContentNode({
              type: ContentType.TABLE_CELL,
              attributes: { isHeader: true, colspan: 2, align: "center" },
              value: "Predicted Class",
            }),
          ],
        }),
        new ContentNode({
          type: ContentType.TABLE_ROW,
          children: [
            new ContentNode({
              type: ContentType.TABLE_CELL,
              attributes: { rowspan: 2, align: "right" },
              value: "True Class",
            }),
            new ContentNode({ type: ContentType.TABLE_CELL, value: "Positive (85)" }),
          ],
        }),
      ],
    }),
  ]);

  const html = renderPdfDocument(doc);
  assert(html.includes("<caption>Confusion Matrix Performance</caption>"), "Caption must be rendered");
  assert(html.includes('colspan="2"'), "Colspan attribute must be preserved");
  assert(html.includes('rowspan="2"'), "Rowspan attribute must be preserved");
  assert(html.includes('align="center"'), "Align center attribute must be preserved");
  assert(html.includes('align="right"'), "Align right attribute must be preserved");
});

// ── Test 20: Image rendering in figure with alt and caption ──────────────────
check("Test 20: Image renders in <figure> with alt and optional <figcaption>", () => {
  const doc = createSimpleDoc([
    new ContentNode({
      type: ContentType.FIGURE,
      attributes: { caption: "Figure 1: Neural Network Architecture" },
      children: [
        new ContentNode({
          type: ContentType.IMAGE,
          attributes: {
            src: "https://example.com/assets/nn.png",
            alt: "Diagram of multilayer perceptron",
          },
        }),
      ],
    }),
  ]);

  const html = renderPdfDocument(doc);
  assert(html.includes('<figure class="saq-pdf-figure">'), "Figure element and class present");
  assert(html.includes('src="https://example.com/assets/nn.png"'), "Image src must match");
  assert(html.includes('alt="Diagram of multilayer perceptron"'), "Alt text must match");
  assert(html.includes("<figcaption>Figure 1: Neural Network Architecture</figcaption>"), "Figcaption must match");
});

// ── Test 21: Resource map resolution for images ──────────────────────────────
check("Test 21: Image URLs resolved via resourceMap when provided", () => {
  const originalUrl = "https://cdn.iitm.ac.in/quiz/img001.png";
  const localAssetPath = "assets/q01-image-01.png";
  const resourceMap = new Map([[originalUrl, localAssetPath]]);

  const doc = createSimpleDoc([
    new ContentNode({
      type: ContentType.IMAGE,
      attributes: { src: originalUrl, alt: "Scatter plot" },
    }),
  ]);

  const html = renderPdfDocument(doc, { resourceMap });
  assert(html.includes(`src="${localAssetPath}"`), `Image src must be mapped to ${localAssetPath}`);
  assert(!html.includes(originalUrl), "Original remote URL should be replaced by mapped asset");
});

// ── Test 22: Resource map resolution for external SVGs ───────────────────────
check("Test 22: External SVG URLs resolved via resourceMap", () => {
  const originalSvgUrl = "https://cdn.iitm.ac.in/quiz/diagram.svg";
  const localSvgPath = "assets/q01-diagram-01.svg";
  const resourceMap = { [originalSvgUrl]: localSvgPath };

  const doc = createSimpleDoc([
    new ContentNode({
      type: ContentType.SVG,
      attributes: { src: originalSvgUrl, title: "Circuit Schematic" },
    }),
  ]);

  const html = renderPdfDocument(doc, { resourceMap });
  assert(html.includes(`src="${localSvgPath}"`), "SVG src must be resolved to local path");
  assert(html.includes('alt="Circuit Schematic"'), "SVG title must be used as alt");
});

// ── Test 23: Inline SVG rendering and script sanitization ────────────────────
check("Test 23: Inline SVG renders directly in .saq-pdf-svg-wrap and neutralizes scripts", () => {
  const safeSvg = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" stroke="green" fill="yellow" /></svg>';
  const maliciousSvg = '<svg viewBox="0 0 100 100"><script>alert("xss")</script><circle cx="50" cy="50" r="40" onload="alert(1)" /></svg>';

  const docSafe = createSimpleDoc([new ContentNode({ type: ContentType.SVG, value: safeSvg })]);
  const docMalicious = createSimpleDoc([new ContentNode({ type: ContentType.SVG, value: maliciousSvg })]);

  const htmlSafe = renderPdfDocument(docSafe);
  assert(htmlSafe.includes('<div class="saq-pdf-svg-wrap">'), "SVG must be wrapped in .saq-pdf-svg-wrap");
  assert(htmlSafe.includes('<circle cx="50" cy="50" r="40" stroke="green" fill="yellow" />'), "Safe SVG elements must render");

  const htmlMalicious = renderPdfDocument(docMalicious);
  assert(!htmlMalicious.includes("<script>"), "Scripts must be stripped from SVG");
  assert(!htmlMalicious.includes("onload="), "Event handlers must be stripped from SVG");
});

// ── Test 24: Options rendering with letters and content ──────────────────────
check("Test 24: Options render as <ul class=\"saq-pdf-options\"> with letter markers", () => {
  const doc = createSimpleDoc([], [
    new OptionNode({
      index: 0,
      letter: "A",
      content: [new ContentNode({ type: ContentType.TEXT, value: "O(n log n)" })],
    }),
    new OptionNode({
      index: 1,
      letter: "B",
      content: [new ContentNode({ type: ContentType.TEXT, value: "O(n^2)" })],
    }),
  ]);

  const html = renderPdfDocument(doc);
  assert(html.includes('<div class="saq-pdf-options-title">Options:</div>'), "Options title must be present");
  assert(html.includes('<ul class="saq-pdf-options">'), "Options list must use .saq-pdf-options");
  assert(html.includes('<span class="saq-pdf-option-letter">A.</span>'), "Option letter A. must be rendered");
  assert(html.includes('<div class="saq-pdf-option-content">O(n log n)</div>'), "Option content A must be rendered");
  assert(html.includes('<span class="saq-pdf-option-letter">B.</span>'), "Option letter B. must be rendered");
  assert(html.includes('<div class="saq-pdf-option-content">O(n^2)</div>'), "Option content B must be rendered");
});

// ── Test 25: Opt-in interaction state ────────────────────────────────────────
check("Test 25: Opt-in interaction state (default false omits; true renders)", () => {
  const options = [
    new OptionNode({
      index: 0,
      letter: "A",
      selected: true,
      content: [new ContentNode({ type: ContentType.TEXT, value: "Option A" })],
    }),
    new OptionNode({
      index: 1,
      letter: "B",
      selected: false,
      content: [new ContentNode({ type: ContentType.TEXT, value: "Option B" })],
    }),
  ];
  const doc = createSimpleDoc([], options);

  // Default: includeInteractionState is false
  const htmlDefault = renderPdfDocument(doc);
  assert(!htmlDefault.includes('<div class="saq-pdf-interaction-box">'), "Interaction box must be omitted by default");
  assert(!htmlDefault.includes("Existing Selection:"), "Selection text must be omitted by default");

  // Opt-in: includeInteractionState is true
  const htmlWithState = renderPdfDocument(doc, { includeInteractionState: true });
  assert(htmlWithState.includes('<div class="saq-pdf-interaction-box">'), "Interaction box must be present when enabled");
  assert(htmlWithState.includes("Existing Selection:</strong> A"), "Selected option A must be rendered in interaction box");
});

// ── Test 26: Opt-in review evaluation data ───────────────────────────────────
check("Test 26: Opt-in review evaluation data (default false omits; true renders)", () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Review Test" },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        marks: 1,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "Sample question." })],
        review: {
          score: 1,
          isCorrect: true,
          statusText: "Correct",
          feedback: "Great job! Your answer matches the reference solution.",
        },
      }),
    ],
  });

  // Default: includeReviewData is false
  const htmlDefault = renderPdfDocument(doc);
  assert(!htmlDefault.includes('<div class="saq-pdf-review-box">'), "Review box must be omitted by default");
  assert(!htmlDefault.includes("Great job!"), "Feedback text must be omitted by default");

  // Opt-in: includeReviewData is true
  const htmlWithReview = renderPdfDocument(doc, { includeReviewData: true });
  assert(htmlWithReview.includes('<div class="saq-pdf-review-box">'), "Review box must be present when enabled");
  assert(htmlWithReview.includes("<strong>Score:</strong> 1"), "Review score must be rendered");
  assert(htmlWithReview.includes("<strong>Result:</strong> Correct"), "Review result must be rendered");
  assert(htmlWithReview.includes("Great job! Your answer matches the reference solution."), "Feedback must be rendered");
});

// ── Test 27: Determinism check ───────────────────────────────────────────────
check("Test 27: Determinism: two consecutive renderings produce identical HTML strings", () => {
  const doc = createSimpleDoc([
    new ContentNode({ type: ContentType.PARAGRAPH, value: "Deterministic test paragraph." }),
    new ContentNode({
      type: ContentType.MATH,
      attributes: { format: MathFormat.TEX, mathType: MathType.DISPLAY },
      value: "E = mc^2",
    }),
  ]);

  const run1 = renderPdfDocument(doc);
  const run2 = renderPdfDocument(doc);

  assert(run1 === run2, "Both outputs must be identical character-by-character");
});

// ── Test 28: Legacy HTML node guard ──────────────────────────────────────────
check("Test 28: Guard throws if question contains only unextracted legacy HTML data", () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Legacy Test" },
    questions: [
      new QuestionNode({
        number: 1,
        stem: [new ContentNode({ type: ContentType.HTML_BLOCK, value: "<div>legacy unextracted</div>" })],
      }),
    ],
  });

  let threw = false;
  try {
    renderPdfDocument(doc);
  } catch (err) {
    threw = true;
    assert(err.message.includes("contains only legacy HTML data"), "Error message must indicate legacy data");
  }
  assert(threw, "Must throw on unextracted legacy data");
});

// ── Test 29: Table-driven buildExportFilename(meta, ext) verification ────────
check("Test 29: buildExportFilename(meta, ext) handles real portal titles, fixture titles, and all edge cases", () => {
  const fixedDate = "2026-10-03T12:00:00Z";
  const table = [
    // Real IITM portal DOM sample provided by user
    {
      label: "Real IITM portal DOM (Sep 2026 - MAD II + Week 1 - Graded Assignment 1)",
      meta: { course: "Sep 2026 - MAD II", title: " Week 1 - Graded Assignment 1 ", timestamp: fixedDate },
      ext: "pdf",
      expected: "MAD II - Week 01 - GA 1.pdf",
    },
    {
      label: "Real IITM portal DOM (Activity Questions 1.1 with week)",
      meta: { course: "Sep 2026 - MAD II", title: "Activity Questions 1.1", week: "Week 1", timestamp: fixedDate },
      ext: "pdf",
      expected: "MAD II - Week 01 - AQ 1.1.pdf",
    },
    {
      label: "Real IITM portal DOM (PPA 1 - Not Graded with week in subtitle)",
      meta: { course: "Sep 2026 - MAD II", title: "PPA 1 - Not Graded", subtitle: "Week 1", timestamp: fixedDate },
      ext: "pdf",
      expected: "MAD II - Week 01 - PPA 1.pdf",
    },
    {
      label: "Real IITM portal DOM (Week 1 Practice Assignment - 1 - Not Graded)",
      meta: { course: "Sep 2026 - MAD II", title: "Week 1 Practice Assignment - 1 - Not Graded", timestamp: fixedDate },
      ext: "pdf",
      expected: "MAD II - Week 01 - PA 1.pdf",
    },
    {
      label: "Real IITM portal DOM (Course VM Login Instructions - custom activity)",
      meta: { course: "Sep 2026 - MAD II", title: "Course VM Login Instructions", timestamp: fixedDate },
      ext: "pdf",
      expected: "MAD II - Course VM Login Instructions.pdf",
    },
    // Specification sample
    {
      label: "Spec example (Programming Data Structures and Algorithms, Week 3, GrPA 2)",
      meta: {
        course: "Programming Data Structures and Algorithms",
        title: "Week 3 - Graded Programming Assignment 2",
        timestamp: fixedDate,
      },
      ext: "pdf",
      expected: "Programming Data Structures and Algorithms - Week 03 - GrPA 2.pdf",
    },
    // Real fixture HTML titles (when no Week or Kind is present, omits missing parts; if Course is also missing, falls back to Acadrix Assignment - YYYY-MM-DD)
    {
      label: "Fixture mcq-basic.html (<title>IITM Assessment — MCQ Basic Fixture</title>, no course)",
      meta: { course: "", title: "IITM Assessment — MCQ Basic Fixture", timestamp: fixedDate },
      ext: "pdf",
      expected: "Acadrix Assignment - 2026-10-03.pdf",
    },
    {
      label: "Fixture mcq-with-math.html with course name only (no week, no kind)",
      meta: { course: "Linear Algebra", title: "IITM Assessment — MCQ With Math (KaTeX) Fixture", timestamp: fixedDate },
      ext: "pdf",
      expected: "Linear Algebra.pdf",
    },
    {
      label: "Fixture real-browser.mjs breadcrumb (Week 4: Linear Algebra & Optimization — Graded Assignment)",
      meta: { course: "", title: "Week 4: Linear Algebra & Optimization — Graded Assignment", timestamp: fixedDate },
      ext: "pdf",
      expected: "Week 04 - GA.pdf",
    },
    {
      label: "Fixture test-browser-integration.mjs breadcrumb (Data Science Quiz 2)",
      meta: { course: "BS in Data Science", title: "Data Science Quiz 2", timestamp: fixedDate },
      ext: "pdf",
      expected: "BS in Data Science - Quiz 2.pdf",
    },
    // Edge case: Week 10 (2-digit week already)
    {
      label: "Edge case: Week 10 with Practice Assignment",
      meta: { course: "Machine Learning Techniques", title: "Week 10: Practice Assignment 3", timestamp: fixedDate },
      ext: "pdf",
      expected: "Machine Learning Techniques - Week 10 - PA 3.pdf",
    },
    // Edge case: GrPA without number vs GrPA 2
    {
      label: "Edge case: GrPA without number",
      meta: { course: "Python", title: "Week 2 GrPA", timestamp: fixedDate },
      ext: "pdf",
      expected: "Python - Week 02 - GrPA.pdf",
    },
    {
      label: "Edge case: GrPA 2",
      meta: { course: "Python", title: "Week 2 - GrPA 2", timestamp: fixedDate },
      ext: "pdf",
      expected: "Python - Week 02 - GrPA 2.pdf",
    },
    // Edge case: OPPE and Quiz
    {
      label: "Edge case: OPPE 1 without week",
      meta: { course: "DBMS", title: "OPPE 1 Examination", timestamp: fixedDate },
      ext: "pdf",
      expected: "DBMS - OPPE 1.pdf",
    },
    {
      label: "Edge case: Quiz 1 with week",
      meta: { course: "Statistics II", title: "Week_5 Quiz 1", timestamp: fixedDate },
      ext: "pdf",
      expected: "Statistics II - Week 05 - Quiz 1.pdf",
    },
    // Edge case: No week, no kind, no course (all missing)
    {
      label: "Edge case: All parts missing (default IITM Assessment title)",
      meta: { course: "", title: "IITM Assessment", timestamp: fixedDate },
      ext: "pdf",
      expected: "Acadrix Assignment - 2026-10-03.pdf",
    },
    // Edge case: Weird punctuation & forbidden filesystem characters (/ \ : * ? " < > | and control chars)
    {
      label: "Edge case: Forbidden characters and control chars in Course",
      meta: {
        course: 'CS/AI\\101: "Intro" *To* ?<Data>|Science\x00\x1f...',
        title: "Week: 7 - GA #4",
        timestamp: fixedDate,
      },
      ext: "pdf",
      expected: "CSAI101 Intro To DataScience - Week 07 - GA 4.pdf",
    },
    // Edge case: GrPA 2 with week only in header subtitle or sidebar unit-header
    {
      label: "Edge case: GrPA 2 with week in header subtitle",
      meta: { course: "System Commands", title: "GrPA 2", week: "Week 1", timestamp: fixedDate },
      ext: "pdf",
      expected: "System Commands - Week 01 - GrPA 2.pdf",
    },
    {
      label: "Edge case: GrPA 2 with week in subtitle field",
      meta: { course: "System Commands", title: "GrPA 2", subtitle: "Week 1", timestamp: fixedDate },
      ext: "pdf",
      expected: "System Commands - Week 01 - GrPA 2.pdf",
    },
    {
      label: "Edge case: GrPA 2 with week in activeUnitHeader fallback",
      meta: { course: "System Commands", title: "GrPA 2", activeUnitHeader: "Week 3", timestamp: fixedDate },
      ext: "pdf",
      expected: "System Commands - Week 03 - GrPA 2.pdf",
    },
    // Edge case: Very long course name truncated at 60 chars on a word boundary with trailing connector dropped
    {
      label: "Edge case: Long course name (>60 chars) truncated on word boundary and trailing connector dropped",
      meta: {
        course:
          "Foundations of Computational Mathematical Modeling and Advanced Statistical Inference for Engineers",
        title: "Week 12 - Graded Assignment 1",
        timestamp: fixedDate,
      },
      ext: "pdf",
      expected:
        "Foundations of Computational Mathematical Modeling - Week 12 - GA 1.pdf",
    },
    // Edge case: Unicode course name preserved cleanly
    {
      label: "Edge case: Unicode characters in course name",
      meta: {
        course: "Algèbre Linéaire & Analyse Numérique — αβγ",
        title: "Week 9 Practice 1",
        timestamp: fixedDate,
      },
      ext: "md",
      expected: "Algèbre Linéaire & Analyse Numérique — αβγ - Week 09 - PA 1.md",
    },
  ];

  for (const row of table) {
    const actual = buildExportFilename(row.meta, row.ext);
    assert(
      actual === row.expected,
      `[${row.label}] expected "${row.expected}", got "${actual}"`
    );
    assert(actual.length <= 120, `[${row.label}] filename exceeds 120 chars: ${actual.length}`);
  }
});

console.log("\n==================================================");
if (!passed) {
  console.error("❌ High-Fidelity PDF Exporter Tests FAILED.");
  process.exit(1);
} else {
  console.log("✓ All 29 PDF Exporter Tests Passed Successfully!");
  console.log("==================================================\n");
}
