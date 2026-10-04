#!/usr/bin/env node
/**
 * LLM-Optimized Markdown Exporter Verification Suite.
 * 
 * Tests Phase 4 requirements:
 * 1. Assignment header (metadata appears only when available)
 * 2. Question metadata (question number, type, marks)
 * 3. Paragraphs (block boundaries)
 * 4. Inline formatting (nested bold/italic/sub/sup/strike/code)
 * 5. Links (escaped/resolved links and unsafe URL neutralization)
 * 6. Lists (nested ordered/unordered lists)
 * 7. Blockquotes (nested quote content)
 * 8. Inline code (embedded backticks)
 * 9. Code blocks (exact whitespace and language)
 * 10. TeX math (inline and display math with source unchanged)
 * 11. MathML fallback (preserved)
 * 12. Text math fallback (identifiable without pretending it is TeX)
 * 13. Simple GFM table (valid table output)
 * 14. Complex table (colspan/rowspan preserved in HTML fallback)
 * 15. Figure/image (image reference plus caption)
 * 16. Inline SVG (deterministic SVG fallback)
 * 17. Options (canonical option letters and nested semantic content)
 * 18. Interaction state disabled (selected/review data does not leak)
 * 19. Interaction state enabled (explicit state serialization)
 * 20. Determinism (two runs produce exact identical strings)
 * 21. DOM independence (run in Node with zero browser globals)
 * 22. Realistic mixed assignment (multi-question AssignmentDocument)
 * + 5 Golden exact output tests
 */

import { ContentType, QuestionType, MathType, MathFormat } from "../src/model/types.js";
import { ContentNode, OptionNode, QuestionNode, AssignmentDocument } from "../src/model/document.js";
import {
  exportAssignmentToMarkdown,
  MarkdownExporter,
  formatInlineCode,
  formatCodeBlock,
  sanitizeUrl,
} from "../src/exporters/markdown.js";

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

console.log("\nStarting Phase 4 Markdown Exporter Verification Suite...\n");

// ── Test 1: Assignment Header ───────────────────────────────────────────────

check("Test 1: Assignment header outputs metadata only when available", () => {
  // Case A: Full metadata
  const docFull = new AssignmentDocument({
    metadata: {
      title: "Data Science Assessment 1",
      course: "BS in Data Science",
      totalQuestions: 15,
      totalMarks: 30,
    },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "Sample question stem." })],
      }),
    ],
  });

  const mdFull = exportAssignmentToMarkdown(docFull);
  if (!mdFull.startsWith("# Data Science Assessment 1\n\n**Course:** BS in Data Science  \n**Questions:** 15  \n**Total Marks:** 30\n\n")) {
    throw new Error(`Unexpected full header output:\n${mdFull}`);
  }

  // Case B: Minimal metadata (no course, no marks)
  const docMin = new AssignmentDocument({
    metadata: {
      title: "Quiz 2",
    },
    questions: [
      new QuestionNode({
        number: 1,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "Minimal question." })],
      }),
    ],
  });

  const mdMin = exportAssignmentToMarkdown(docMin);
  if (!mdMin.startsWith("# Quiz 2\n\n**Questions:** 1\n\n")) {
    throw new Error(`Minimal header contained fabricated metadata:\n${mdMin}`);
  }
  if (mdMin.includes("Course:") || mdMin.includes("Total Marks:")) {
    throw new Error("Minimal header must not fabricate Course or Marks");
  }
});

// ── Test 2: Question Metadata ───────────────────────────────────────────────

check("Test 2: Question metadata (number, type, marks, label)", () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Assessment" },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        marks: 2,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "MCQ stem." })],
      }),
      new QuestionNode({
        number: 2,
        label: "Question 2 — Part B",
        type: QuestionType.NUMERICAL,
        marks: 3,
        negativeMarks: -1,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "Numerical stem." })],
      }),
      new QuestionNode({
        number: 3,
        type: QuestionType.DESCRIPTIVE,
        marks: null,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "Descriptive stem." })],
      }),
    ],
  });

  const md = exportAssignmentToMarkdown(doc);
  if (!md.includes("## Question 1\n\n**Type:** MCQ  \n**Marks:** 2")) {
    throw new Error(`Question 1 metadata incorrect:\n${md}`);
  }
  if (!md.includes("## Question 2 — Part B\n\n**Type:** Numerical  \n**Marks:** 3  \n**Negative Marks:** -1")) {
    throw new Error(`Question 2 metadata incorrect:\n${md}`);
  }
  if (!md.includes("## Question 3\n\n**Type:** Descriptive\n\n")) {
    throw new Error(`Question 3 metadata incorrect (should not contain null marks):\n${md}`);
  }
  if (md.includes("Marks: null")) {
    throw new Error("Must not print literal 'null' for marks");
  }
});

// ── Test 3: Paragraphs and Block Boundaries ─────────────────────────────────

check("Test 3: Paragraph block boundaries are separated by blank lines", () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Test" },
    questions: [
      new QuestionNode({
        number: 1,
        stem: [
          new ContentNode({ type: ContentType.PARAGRAPH, value: "First paragraph." }),
          new ContentNode({ type: ContentType.PARAGRAPH, value: "Second paragraph." }),
          new ContentNode({ type: ContentType.PARAGRAPH, value: "Third paragraph." }),
        ],
      }),
    ],
  });

  const md = exportAssignmentToMarkdown(doc);
  const expected = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
  if (!md.includes(expected)) {
    throw new Error(`Paragraph boundaries incorrect:\n${md}`);
  }
});

// ── Test 4: Inline Formatting ───────────────────────────────────────────────

check("Test 4: Inline formatting (nested bold, italic, sub, sup, strike, underline)", () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Formatting Test" },
    questions: [
      new QuestionNode({
        number: 1,
        stem: [
          new ContentNode({
            type: ContentType.PARAGRAPH,
            children: [
              new ContentNode({ type: ContentType.TEXT, value: "This is " }),
              new ContentNode({
                type: ContentType.TEXT,
                value: "bold and italic",
                attributes: { bold: true, italic: true },
              }),
              new ContentNode({ type: ContentType.TEXT, value: ", and this is " }),
              new ContentNode({
                type: ContentType.TEXT,
                value: "strikethrough",
                attributes: { strike: true },
              }),
              new ContentNode({ type: ContentType.TEXT, value: ", H" }),
              new ContentNode({
                type: ContentType.TEXT,
                value: "2",
                attributes: { sub: true },
              }),
              new ContentNode({ type: ContentType.TEXT, value: "O and x" }),
              new ContentNode({
                type: ContentType.TEXT,
                value: "2",
                attributes: { sup: true },
              }),
              new ContentNode({ type: ContentType.TEXT, value: ", and " }),
              new ContentNode({
                type: ContentType.TEXT,
                value: "underlined bold",
                attributes: { bold: true, underline: true },
              }),
              new ContentNode({ type: ContentType.TEXT, value: "." }),
            ],
          }),
        ],
      }),
    ],
  });

  const md = exportAssignmentToMarkdown(doc);
  const expectedFragment =
    "This is ***bold and italic***, and this is ~~strikethrough~~, H<sub>2</sub>O and x<sup>2</sup>, and **<u>underlined bold</u>**.";
  if (!md.includes(expectedFragment)) {
    throw new Error(`Inline formatting incorrect:\n${md}\nExpected fragment:\n${expectedFragment}`);
  }
});

// ── Test 5: Links and URL Safety ────────────────────────────────────────────

check("Test 5: Links with titles and neutralization of unsafe URLs", () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Links Test" },
    questions: [
      new QuestionNode({
        number: 1,
        stem: [
          new ContentNode({
            type: ContentType.PARAGRAPH,
            children: [
              new ContentNode({
                type: ContentType.LINK,
                value: "Official Documentation",
                attributes: { href: "https://example.com/docs", title: "Reference Docs" },
              }),
              new ContentNode({ type: ContentType.TEXT, value: " and " }),
              new ContentNode({
                type: ContentType.LINK,
                value: "Malicious Link",
                attributes: { href: "javascript:alert(1)" },
              }),
              new ContentNode({ type: ContentType.TEXT, value: " and " }),
              new ContentNode({
                type: ContentType.LINK,
                value: "Data Scheme",
                attributes: { href: "data:text/html;base64,PHNjcmlwdD4=" },
              }),
            ],
          }),
        ],
      }),
    ],
  });

  const md = exportAssignmentToMarkdown(doc);
  if (!md.includes('[Official Documentation](https://example.com/docs "Reference Docs")')) {
    throw new Error(`Safe link formatting incorrect:\n${md}`);
  }
  if (!md.includes("[Malicious Link](#)")) {
    throw new Error(`javascript: URL was not neutralized to #:\n${md}`);
  }
  if (!md.includes("[Data Scheme](#)")) {
    throw new Error(`data:text/html URL was not neutralized to #:\n${md}`);
  }
});

// ── Test 6: Lists (Nested Ordered and Unordered) ────────────────────────────

check("Test 6: Ordered and unordered nested lists with preserved start index", () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Lists Test" },
    questions: [
      new QuestionNode({
        number: 1,
        stem: [
          new ContentNode({
            type: ContentType.LIST,
            attributes: { ordered: false },
            children: [
              new ContentNode({
                type: ContentType.LIST_ITEM,
                value: "Item A",
                children: [
                  new ContentNode({ type: ContentType.TEXT, value: "Item A" }),
                  new ContentNode({
                    type: ContentType.LIST,
                    attributes: { ordered: true, start: 5 },
                    children: [
                      new ContentNode({
                        type: ContentType.LIST_ITEM,
                        value: "Sub 1",
                        children: [new ContentNode({ type: ContentType.TEXT, value: "Sub 1" })],
                      }),
                      new ContentNode({
                        type: ContentType.LIST_ITEM,
                        value: "Sub 2",
                        children: [new ContentNode({ type: ContentType.TEXT, value: "Sub 2" })],
                      }),
                    ],
                  }),
                ],
              }),
              new ContentNode({
                type: ContentType.LIST_ITEM,
                value: "Item B",
                children: [new ContentNode({ type: ContentType.TEXT, value: "Item B" })],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  const md = exportAssignmentToMarkdown(doc);
  const expectedList = "- Item A\n  5. Sub 1\n  6. Sub 2\n- Item B";
  if (!md.includes(expectedList)) {
    throw new Error(`List formatting incorrect:\n${md}\nExpected:\n${expectedList}`);
  }
});

// ── Test 7: Blockquotes ─────────────────────────────────────────────────────

check("Test 7: Multiline and nested blockquotes", () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Quote Test" },
    questions: [
      new QuestionNode({
        number: 1,
        stem: [
          new ContentNode({
            type: ContentType.BLOCKQUOTE,
            children: [
              new ContentNode({ type: ContentType.PARAGRAPH, value: "Line one of quote.\nLine two of quote." }),
              new ContentNode({
                type: ContentType.BLOCKQUOTE,
                children: [new ContentNode({ type: ContentType.PARAGRAPH, value: "Nested quote line." })],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  const md = exportAssignmentToMarkdown(doc);
  if (!md.includes("> Line one of quote.\n> Line two of quote.\n>\n> > Nested quote line.")) {
    throw new Error(`Blockquote formatting incorrect:\n${md}`);
  }
});

// ── Test 8: Inline Code with Embedded Backticks ──────────────────────────────

check("Test 8: Inline code formatting and backtick delimiter escalation", () => {
  if (formatInlineCode("simple") !== "`simple`") {
    throw new Error(`Simple inline code failed: ${formatInlineCode("simple")}`);
  }
  // Code containing single backtick should use double backticks
  if (formatInlineCode("foo ` bar") !== "``foo ` bar``") {
    throw new Error(`Single backtick escape failed: ${formatInlineCode("foo ` bar")}`);
  }
  // Single isolated backtick requires double backticks and padding spaces
  if (formatInlineCode("`") !== "`` ` ``") {
    throw new Error(`Single isolated backtick failed: ${formatInlineCode("`")}`);
  }
  // Code containing double backticks should escalate to triple backticks
  if (formatInlineCode("foo `` bar") !== "```foo `` bar```") {
    throw new Error(`Double backtick escalation failed: ${formatInlineCode("foo `` bar")}`);
  }
});

// ── Test 9: Code Blocks Preserving Whitespace ────────────────────────────────

check("Test 9: Fenced code block preserving exact whitespace, tabs, and language", () => {
  const codeContent = "def solve(n):\n    # Tab and spaces\n\treturn n * 42\n";
  const doc = new AssignmentDocument({
    metadata: { title: "Code Test" },
    questions: [
      new QuestionNode({
        number: 1,
        stem: [
          new ContentNode({
            type: ContentType.CODE_BLOCK,
            value: codeContent,
            attributes: { language: "python" },
          }),
        ],
      }),
    ],
  });

  const md = exportAssignmentToMarkdown(doc);
  const expectedBlock = "```python\ndef solve(n):\n    # Tab and spaces\n\treturn n * 42\n```";
  if (!md.includes(expectedBlock)) {
    throw new Error(`Code block output incorrect:\n${md}\nExpected:\n${expectedBlock}`);
  }

  // Embedded triple backticks in code
  const codeWithFence = "```\ninner\n```";
  const formatted = formatCodeBlock(codeWithFence, "markdown");
  if (!formatted.startsWith("````markdown\n") || !formatted.endsWith("\n````")) {
    throw new Error(`Embedded fence handling failed:\n${formatted}`);
  }
});

// ── Test 10: TeX Mathematics (Inline and Display) ───────────────────────────

check("Test 10: TeX math preserved exactly: inline \\( ... \\) and display \\[ ... \\]", () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Math Test" },
    questions: [
      new QuestionNode({
        number: 1,
        stem: [
          new ContentNode({
            type: ContentType.PARAGRAPH,
            children: [
              new ContentNode({ type: ContentType.TEXT, value: "Given " }),
              new ContentNode({
                type: ContentType.MATH,
                value: "\\alpha + \\beta = 180^\\circ",
                attributes: { format: MathFormat.TEX, mathType: MathType.INLINE },
              }),
              new ContentNode({ type: ContentType.TEXT, value: ", calculate:" }),
            ],
          }),
          new ContentNode({
            type: ContentType.MATH,
            value: "\\int_{0}^{\\infty} x^2 e^{-x} \\, dx = 2",
            attributes: { format: MathFormat.TEX, mathType: MathType.DISPLAY },
          }),
        ],
      }),
    ],
  });

  const md = exportAssignmentToMarkdown(doc);
  if (!md.includes("Given \\(\\alpha + \\beta = 180^\\circ\\), calculate:")) {
    throw new Error(`Inline TeX math incorrect:\n${md}`);
  }
  if (!md.includes("\\[\n\\int_{0}^{\\infty} x^2 e^{-x} \\, dx = 2\n\\]")) {
    throw new Error(`Display TeX math incorrect:\n${md}`);
  }
});

// ── Test 11: MathML Fallback ────────────────────────────────────────────────

check("Test 11: MathML preserved machine-readably in fenced ```mathml block", () => {
  const mathmlSource = '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow></math>';
  const doc = new AssignmentDocument({
    metadata: { title: "MathML Test" },
    questions: [
      new QuestionNode({
        number: 1,
        stem: [
          new ContentNode({
            type: ContentType.MATH,
            value: mathmlSource,
            attributes: { format: MathFormat.MATHML, mathType: MathType.DISPLAY },
          }),
        ],
      }),
    ],
  });

  const md = exportAssignmentToMarkdown(doc);
  if (!md.includes("```mathml\n" + mathmlSource + "\n```")) {
    throw new Error(`MathML fenced block incorrect:\n${md}`);
  }
});

// ── Test 12: Text Math Fallback ─────────────────────────────────────────────

check("Test 12: Text math fallback remains identifiable without pretending it is TeX", () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Text Math Test" },
    questions: [
      new QuestionNode({
        number: 1,
        stem: [
          new ContentNode({
            type: ContentType.PARAGRAPH,
            children: [
              new ContentNode({ type: ContentType.TEXT, value: "Formula: " }),
              new ContentNode({
                type: ContentType.MATH,
                value: "E = mc^2",
                attributes: { format: MathFormat.TEXT, mathType: MathType.INLINE, texUnavailable: true },
              }),
            ],
          }),
        ],
      }),
    ],
  });

  const md = exportAssignmentToMarkdown(doc);
  if (!md.includes("Formula: E = mc^2")) {
    throw new Error(`Text math output incorrect:\n${md}`);
  }
  if (md.includes("\\(E = mc^2\\)") || md.includes("\\[E = mc^2\\]")) {
    throw new Error(`Text math fallback must not be wrapped in TeX delimiters:\n${md}`);
  }
});

// ── Test 13: Simple GFM Table ───────────────────────────────────────────────

check("Test 13: Simple table serializes as valid GFM table with column alignments", () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Table Test" },
    questions: [
      new QuestionNode({
        number: 1,
        stem: [
          new ContentNode({
            type: ContentType.TABLE,
            attributes: { caption: "Student Scores" },
            children: [
              new ContentNode({
                type: ContentType.TABLE_ROW,
                children: [
                  new ContentNode({
                    type: ContentType.TABLE_CELL,
                    value: "Student",
                    attributes: { isHeader: true, align: "left" },
                  }),
                  new ContentNode({
                    type: ContentType.TABLE_CELL,
                    value: "Score | Grade",
                    attributes: { isHeader: true, align: "center" },
                  }),
                  new ContentNode({
                    type: ContentType.TABLE_CELL,
                    value: "Percent",
                    attributes: { isHeader: true, align: "right" },
                  }),
                ],
              }),
              new ContentNode({
                type: ContentType.TABLE_ROW,
                children: [
                  new ContentNode({ type: ContentType.TABLE_CELL, value: "Alice" }),
                  new ContentNode({ type: ContentType.TABLE_CELL, value: "95 | A" }),
                  new ContentNode({ type: ContentType.TABLE_CELL, value: "95%" }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  const md = exportAssignmentToMarkdown(doc);
  if (!md.includes("*Student Scores*")) {
    throw new Error(`Table caption missing:\n${md}`);
  }
  // Pipes inside cell must be escaped: 95 \| A
  if (!md.includes("| Student | Score \\| Grade | Percent |")) {
    throw new Error(`Table header or pipe escaping incorrect:\n${md}`);
  }
  if (!md.includes("| :--- | :---: | ---: |")) {
    throw new Error(`Table alignment delimiters incorrect:\n${md}`);
  }
  if (!md.includes("| Alice | 95 \\| A | 95% |")) {
    throw new Error(`Table data row incorrect:\n${md}`);
  }
});

// ── Test 14: Complex Table with Colspan / Rowspan ────────────────────────────

check("Test 14: Complex table with colspan/rowspan preserved in semantic HTML table fallback", () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Complex Table Test" },
    questions: [
      new QuestionNode({
        number: 1,
        stem: [
          new ContentNode({
            type: ContentType.TABLE,
            attributes: { caption: "Merged Matrix" },
            children: [
              new ContentNode({
                type: ContentType.TABLE_ROW,
                children: [
                  new ContentNode({
                    type: ContentType.TABLE_CELL,
                    value: "Header Span",
                    attributes: { isHeader: true, colspan: 2, align: "center" },
                  }),
                ],
              }),
              new ContentNode({
                type: ContentType.TABLE_ROW,
                children: [
                  new ContentNode({
                    type: ContentType.TABLE_CELL,
                    value: "Row 1 Col 1",
                    attributes: { rowspan: 2 },
                  }),
                  new ContentNode({ type: ContentType.TABLE_CELL, value: "Row 1 Col 2" }),
                ],
              }),
              new ContentNode({
                type: ContentType.TABLE_ROW,
                children: [new ContentNode({ type: ContentType.TABLE_CELL, value: "Row 2 Col 2" })],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  const md = exportAssignmentToMarkdown(doc);
  if (!md.includes("<table>") || !md.includes("<caption>Merged Matrix</caption>")) {
    throw new Error(`HTML table structure missing:\n${md}`);
  }
  if (!md.includes('<th colspan="2" align="center">Header Span</th>')) {
    throw new Error(`th with colspan missing:\n${md}`);
  }
  if (!md.includes('<td rowspan="2">Row 1 Col 1</td>')) {
    throw new Error(`td with rowspan missing:\n${md}`);
  }
});

// ── Test 15: Figure and Image ───────────────────────────────────────────────

check("Test 15: Image reference and figure with caption", () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Figure Test" },
    questions: [
      new QuestionNode({
        number: 1,
        stem: [
          new ContentNode({
            type: ContentType.FIGURE,
            attributes: { caption: "Distribution of test scores" },
            children: [
              new ContentNode({
                type: ContentType.IMAGE,
                attributes: {
                  src: "https://example.com/plot.png",
                  alt: "Scores Histogram",
                  title: "Figure 1",
                },
              }),
            ],
          }),
        ],
      }),
    ],
  });

  const md = exportAssignmentToMarkdown(doc);
  if (!md.includes('![Scores Histogram](https://example.com/plot.png "Figure 1")')) {
    throw new Error(`Image formatting incorrect:\n${md}`);
  }
  if (!md.includes("*Distribution of test scores*")) {
    throw new Error(`Figure caption missing:\n${md}`);
  }
});

// ── Test 16: Inline SVG ─────────────────────────────────────────────────────

check("Test 16: Inline SVG preserved deterministically in fenced ```svg block", () => {
  const svgMarkup = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" /></svg>';
  const doc = new AssignmentDocument({
    metadata: { title: "SVG Test" },
    questions: [
      new QuestionNode({
        number: 1,
        stem: [new ContentNode({ type: ContentType.SVG, value: svgMarkup })],
      }),
    ],
  });

  const md = exportAssignmentToMarkdown(doc);
  if (!md.includes("```svg\n" + svgMarkup + "\n```")) {
    throw new Error(`Inline SVG block incorrect:\n${md}`);
  }
});

// ── Test 17: Options with Canonical Letters and Semantic Content ────────────

check("Test 17: Options with canonical letters and nested math/formatting", () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Options Test" },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "Select the correct statement:" })],
        options: [
          new OptionNode({
            letter: "A",
            content: [
              new ContentNode({ type: ContentType.TEXT, value: "Value of " }),
              new ContentNode({
                type: ContentType.MATH,
                value: "\\pi \\approx 3.14159",
                attributes: { format: MathFormat.TEX, mathType: MathType.INLINE },
              }),
            ],
          }),
          new OptionNode({
            letter: "B",
            content: [
              new ContentNode({
                type: ContentType.TEXT,
                value: "Statement B is false",
                attributes: { italic: true },
              }),
            ],
          }),
        ],
      }),
    ],
  });

  const md = exportAssignmentToMarkdown(doc);
  const expectedOptions = "**Options**\n\n- **A.** Value of \\(\\pi \\approx 3.14159\\)\n- **B.** *Statement B is false*";
  if (!md.includes(expectedOptions)) {
    throw new Error(`Options formatting incorrect:\n${md}\nExpected:\n${expectedOptions}`);
  }
});

// ── Test 18: Interaction State Disabled (Default) ───────────────────────────

check("Test 18: Interaction state disabled by default (no selection/review leakage)", () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Default Export" },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "Question stem." })],
        options: [
          new OptionNode({ letter: "A", content: [new ContentNode({ type: ContentType.TEXT, value: "Opt A" })], selected: false }),
          new OptionNode({ letter: "B", content: [new ContentNode({ type: ContentType.TEXT, value: "Opt B" })], selected: true }),
        ],
        review: {
          score: 1,
          isCorrect: true,
          feedback: "Great job!",
        },
      }),
    ],
  });

  const md = exportAssignmentToMarkdown(doc);
  if (md.includes("Existing selection") || md.includes("Review score") || md.includes("Great job!")) {
    throw new Error(`Interaction or review data leaked into default export:\n${md}`);
  }
});

// ── Test 19: Interaction State and Review Data Enabled (Opt-in) ─────────────

check("Test 19: Explicit serialization when includeInteractionState and includeReviewData are true", () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Opt-in Export" },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MSQ,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "Select all that apply:" })],
        options: [
          new OptionNode({ letter: "A", content: [new ContentNode({ type: ContentType.TEXT, value: "Opt A" })], selected: true }),
          new OptionNode({ letter: "B", content: [new ContentNode({ type: ContentType.TEXT, value: "Opt B" })], selected: false }),
          new OptionNode({ letter: "C", content: [new ContentNode({ type: ContentType.TEXT, value: "Opt C" })], selected: true }),
        ],
        review: {
          score: "2 / 2",
          isCorrect: true,
          feedback: "All correct options chosen.",
        },
      }),
    ],
  });

  const md = exportAssignmentToMarkdown(doc, {
    includeInteractionState: true,
    includeReviewData: true,
  });

  if (!md.includes("> Existing selection: A, C")) {
    throw new Error(`Existing selection line missing:\n${md}`);
  }
  if (!md.includes("> Review score: 2 / 2\n> Result: Correct\n\n> Feedback:\n> All correct options chosen.")) {
    throw new Error(`Review data serialization incorrect:\n${md}`);
  }
});

// ── Test 20: Determinism ────────────────────────────────────────────────────

check("Test 20: Deterministic output across multiple runs", () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Determinism Check", course: "Math 101", totalMarks: 10 },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        marks: 5,
        stem: [
          new ContentNode({ type: ContentType.PARAGRAPH, value: "What is 2 + 2?" }),
          new ContentNode({
            type: ContentType.MATH,
            value: "2 + 2 = 4",
            attributes: { format: MathFormat.TEX, mathType: MathType.DISPLAY },
          }),
        ],
        options: [
          new OptionNode({ letter: "A", content: [new ContentNode({ type: ContentType.TEXT, value: "3" })] }),
          new OptionNode({ letter: "B", content: [new ContentNode({ type: ContentType.TEXT, value: "4" })] }),
        ],
      }),
    ],
  });

  const run1 = exportAssignmentToMarkdown(doc);
  const run2 = exportAssignmentToMarkdown(doc);

  if (run1 !== run2) {
    throw new Error("Exporter produced differing outputs for identical input document!");
  }
  if (run1.length === 0) {
    throw new Error("Exporter output was empty!");
  }
});

// ── Test 21: DOM Independence (Node Environment) ────────────────────────────

check("Test 21: DOM independence in pure Node runtime without browser globals", () => {
  if (typeof window !== "undefined") {
    throw new Error("Test environment unexpectedly has global window defined");
  }
  if (typeof document !== "undefined") {
    throw new Error("Test environment unexpectedly has global document defined");
  }

  const exporter = new MarkdownExporter();
  if (typeof exporter.exportDocument !== "function") {
    throw new Error("MarkdownExporter must be instantiable without DOM");
  }
});

// ── Test 22: Realistic Mixed Multi-Question Assignment ──────────────────────

check("Test 22: Realistic mixed multi-question assignment", () => {
  const doc = new AssignmentDocument({
    metadata: {
      title: "IITM Programming, Data Structures and Algorithms",
      course: "BS Degree Program",
      totalQuestions: 3,
      totalMarks: 15,
    },
    questions: [
      // Q1: MCQ with code block and math
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        marks: 5,
        stem: [
          new ContentNode({
            type: ContentType.PARAGRAPH,
            value: "Consider the following recursive function:",
          }),
          new ContentNode({
            type: ContentType.CODE_BLOCK,
            value: "def f(n):\n    if n <= 1:\n        return 1\n    return f(n - 1) + f(n - 2)",
            attributes: { language: "python" },
          }),
          new ContentNode({
            type: ContentType.PARAGRAPH,
            children: [
              new ContentNode({ type: ContentType.TEXT, value: "Its asymptotic time complexity is " }),
              new ContentNode({
                type: ContentType.MATH,
                value: "O(2^n)",
                attributes: { format: MathFormat.TEX, mathType: MathType.INLINE },
              }),
              new ContentNode({ type: ContentType.TEXT, value: "." }),
            ],
          }),
        ],
        options: [
          new OptionNode({
            letter: "A",
            content: [
              new ContentNode({
                type: ContentType.MATH,
                value: "O(n)",
                attributes: { format: MathFormat.TEX, mathType: MathType.INLINE },
              }),
            ],
          }),
          new OptionNode({
            letter: "B",
            content: [
              new ContentNode({
                type: ContentType.MATH,
                value: "O(2^n)",
                attributes: { format: MathFormat.TEX, mathType: MathType.INLINE },
              }),
            ],
          }),
        ],
      }),

      // Q2: Numerical with table
      new QuestionNode({
        number: 2,
        type: QuestionType.NUMERICAL,
        marks: 5,
        stem: [
          new ContentNode({
            type: ContentType.PARAGRAPH,
            value: "Refer to the execution table below:",
          }),
          new ContentNode({
            type: ContentType.TABLE,
            children: [
              new ContentNode({
                type: ContentType.TABLE_ROW,
                children: [
                  new ContentNode({ type: ContentType.TABLE_CELL, value: "Iteration", attributes: { isHeader: true } }),
                  new ContentNode({ type: ContentType.TABLE_CELL, value: "Value", attributes: { isHeader: true } }),
                ],
              }),
              new ContentNode({
                type: ContentType.TABLE_ROW,
                children: [
                  new ContentNode({ type: ContentType.TABLE_CELL, value: "1" }),
                  new ContentNode({ type: ContentType.TABLE_CELL, value: "10" }),
                ],
              }),
            ],
          }),
          new ContentNode({
            type: ContentType.PARAGRAPH,
            value: "Compute the final value of the accumulator.",
          }),
        ],
      }),

      // Q3: Descriptive with image and list
      new QuestionNode({
        number: 3,
        type: QuestionType.DESCRIPTIVE,
        marks: 5,
        stem: [
          new ContentNode({
            type: ContentType.PARAGRAPH,
            value: "Analyze the diagram and answer the following questions:",
          }),
          new ContentNode({
            type: ContentType.IMAGE,
            attributes: {
              src: "https://example.com/network.png",
              alt: "Network Topology",
            },
          }),
          new ContentNode({
            type: ContentType.LIST,
            attributes: { ordered: true },
            children: [
              new ContentNode({
                type: ContentType.LIST_ITEM,
                value: "Identify bottlenecks",
                children: [new ContentNode({ type: ContentType.TEXT, value: "Identify bottlenecks" })],
              }),
              new ContentNode({
                type: ContentType.LIST_ITEM,
                value: "Calculate max throughput",
                children: [new ContentNode({ type: ContentType.TEXT, value: "Calculate max throughput" })],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  const md = exportAssignmentToMarkdown(doc);

  // Assert presence of all critical structural markers
  if (!md.includes("# IITM Programming, Data Structures and Algorithms")) {
    throw new Error("Header missing");
  }
  if (!md.includes("## Question 1\n\n**Type:** MCQ  \n**Marks:** 5")) {
    throw new Error("Question 1 missing");
  }
  if (!md.includes("```python\ndef f(n):")) {
    throw new Error("Code block missing");
  }
  if (!md.includes("\\(O(2^n)\\)")) {
    throw new Error("Math expression missing");
  }
  if (!md.includes("- **A.** \\(O(n)\\)")) {
    throw new Error("Option A missing");
  }
  if (!md.includes("## Question 2\n\n**Type:** Numerical  \n**Marks:** 5")) {
    throw new Error("Question 2 missing");
  }
  if (!md.includes("| Iteration | Value |")) {
    throw new Error("Table missing");
  }
  if (!md.includes("## Question 3\n\n**Type:** Descriptive  \n**Marks:** 5")) {
    throw new Error("Question 3 missing");
  }
  if (!md.includes("![Network Topology](https://example.com/network.png)")) {
    throw new Error("Image missing");
  }
  if (!md.includes("1. Identify bottlenecks\n2. Calculate max throughput")) {
    throw new Error("Ordered list missing");
  }
});

// ── Golden Exact String Tests (Section 40) ──────────────────────────────────

// Golden 1: Simple Question
check("Golden 1: Exact output for simple question", () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Simple Quiz", totalQuestions: 1 },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        marks: 1,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "What is the capital of France?" })],
        options: [
          new OptionNode({ letter: "A", content: [new ContentNode({ type: ContentType.TEXT, value: "Berlin" })] }),
          new OptionNode({ letter: "B", content: [new ContentNode({ type: ContentType.TEXT, value: "Paris" })] }),
        ],
      }),
    ],
  });

  const actual = exportAssignmentToMarkdown(doc);
  const expected =
`# Simple Quiz

**Questions:** 1

## Question 1

**Type:** MCQ  
**Marks:** 1

What is the capital of France?

**Options**

- **A.** Berlin
- **B.** Paris
`;

  if (actual !== expected) {
    throw new Error(`Golden 1 mismatch!\n--- EXPECTED ---\n${expected}\n--- ACTUAL ---\n${actual}`);
  }
});

// Golden 2: Math-Heavy Question
check("Golden 2: Exact output for math-heavy question", () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Calculus Quiz", totalQuestions: 1, totalMarks: 4 },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        marks: 4,
        stem: [
          new ContentNode({
            type: ContentType.PARAGRAPH,
            children: [
              new ContentNode({ type: ContentType.TEXT, value: "Evaluate the limit " }),
              new ContentNode({
                type: ContentType.MATH,
                value: "\\lim_{x \\to 0} \\frac{\\sin x}{x}",
                attributes: { format: MathFormat.TEX, mathType: MathType.INLINE },
              }),
              new ContentNode({ type: ContentType.TEXT, value: ":" }),
            ],
          }),
          new ContentNode({
            type: ContentType.MATH,
            value: "L = \\lim_{x \\to 0} \\frac{\\sin x}{x} = 1",
            attributes: { format: MathFormat.TEX, mathType: MathType.DISPLAY },
          }),
        ],
        options: [
          new OptionNode({
            letter: "A",
            content: [new ContentNode({ type: ContentType.MATH, value: "0", attributes: { format: MathFormat.TEX, mathType: MathType.INLINE } })],
          }),
          new OptionNode({
            letter: "B",
            content: [new ContentNode({ type: ContentType.MATH, value: "1", attributes: { format: MathFormat.TEX, mathType: MathType.INLINE } })],
          }),
        ],
      }),
    ],
  });

  const actual = exportAssignmentToMarkdown(doc);
  const expected =
`# Calculus Quiz

**Questions:** 1  
**Total Marks:** 4

## Question 1

**Type:** MCQ  
**Marks:** 4

Evaluate the limit \\(\\lim_{x \\to 0} \\frac{\\sin x}{x}\\):

\\[
L = \\lim_{x \\to 0} \\frac{\\sin x}{x} = 1
\\]

**Options**

- **A.** \\(0\\)
- **B.** \\(1\\)
`;

  if (actual !== expected) {
    throw new Error(`Golden 2 mismatch!\n--- EXPECTED ---\n${expected}\n--- ACTUAL ---\n${actual}`);
  }
});

// Golden 3: Code Question
check("Golden 3: Exact output for code question", () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Python Quiz", totalQuestions: 1 },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        marks: 2,
        stem: [
          new ContentNode({
            type: ContentType.PARAGRAPH,
            children: [
              new ContentNode({ type: ContentType.TEXT, value: "What is the output of " }),
              new ContentNode({ type: ContentType.INLINE_CODE, value: "print(len([1, 2, 3]))" }),
              new ContentNode({ type: ContentType.TEXT, value: "?" }),
            ],
          }),
          new ContentNode({
            type: ContentType.CODE_BLOCK,
            value: "nums = [1, 2, 3]\nprint(len(nums))\n",
            attributes: { language: "python" },
          }),
        ],
        options: [
          new OptionNode({ letter: "A", content: [new ContentNode({ type: ContentType.TEXT, value: "2" })] }),
          new OptionNode({ letter: "B", content: [new ContentNode({ type: ContentType.TEXT, value: "3" })] }),
        ],
      }),
    ],
  });

  const actual = exportAssignmentToMarkdown(doc);
  const expected =
`# Python Quiz

**Questions:** 1

## Question 1

**Type:** MCQ  
**Marks:** 2

What is the output of \`print(len([1, 2, 3]))\`?

\`\`\`python
nums = [1, 2, 3]
print(len(nums))
\`\`\`

**Options**

- **A.** 2
- **B.** 3
`;

  if (actual !== expected) {
    throw new Error(`Golden 3 mismatch!\n--- EXPECTED ---\n${expected}\n--- ACTUAL ---\n${actual}`);
  }
});

// Golden 4: Table Question
check("Golden 4: Exact output for table question", () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Table Quiz", totalQuestions: 1 },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        marks: 2,
        stem: [
          new ContentNode({
            type: ContentType.PARAGRAPH,
            value: "Consider the truth table:",
          }),
          new ContentNode({
            type: ContentType.TABLE,
            attributes: { caption: "AND Gate" },
            children: [
              new ContentNode({
                type: ContentType.TABLE_ROW,
                children: [
                  new ContentNode({ type: ContentType.TABLE_CELL, value: "A", attributes: { isHeader: true, align: "center" } }),
                  new ContentNode({ type: ContentType.TABLE_CELL, value: "B", attributes: { isHeader: true, align: "center" } }),
                  new ContentNode({ type: ContentType.TABLE_CELL, value: "A AND B", attributes: { isHeader: true, align: "center" } }),
                ],
              }),
              new ContentNode({
                type: ContentType.TABLE_ROW,
                children: [
                  new ContentNode({ type: ContentType.TABLE_CELL, value: "0" }),
                  new ContentNode({ type: ContentType.TABLE_CELL, value: "0" }),
                  new ContentNode({ type: ContentType.TABLE_CELL, value: "0" }),
                ],
              }),
              new ContentNode({
                type: ContentType.TABLE_ROW,
                children: [
                  new ContentNode({ type: ContentType.TABLE_CELL, value: "1" }),
                  new ContentNode({ type: ContentType.TABLE_CELL, value: "1" }),
                  new ContentNode({ type: ContentType.TABLE_CELL, value: "1" }),
                ],
              }),
            ],
          }),
        ],
        options: [
          new OptionNode({ letter: "A", content: [new ContentNode({ type: ContentType.TEXT, value: "Conjunction" })] }),
          new OptionNode({ letter: "B", content: [new ContentNode({ type: ContentType.TEXT, value: "Disjunction" })] }),
        ],
      }),
    ],
  });

  const actual = exportAssignmentToMarkdown(doc);
  const expected =
`# Table Quiz

**Questions:** 1

## Question 1

**Type:** MCQ  
**Marks:** 2

Consider the truth table:

*AND Gate*

| A | B | A AND B |
| :---: | :---: | :---: |
| 0 | 0 | 0 |
| 1 | 1 | 1 |

**Options**

- **A.** Conjunction
- **B.** Disjunction
`;

  if (actual !== expected) {
    throw new Error(`Golden 4 mismatch!\n--- EXPECTED ---\n${expected}\n--- ACTUAL ---\n${actual}`);
  }
});

// Golden 5: Mixed-Content Question
check("Golden 5: Exact output for mixed-content question", () => {
  const doc = new AssignmentDocument({
    metadata: {
      title: "Algorithms Final Exam",
      course: "CS2001",
      totalQuestions: 1,
      totalMarks: 5,
    },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        marks: 5,
        stem: [
          new ContentNode({
            type: ContentType.PARAGRAPH,
            children: [
              new ContentNode({ type: ContentType.TEXT, value: "For an array of size " }),
              new ContentNode({ type: ContentType.MATH, value: "n", attributes: { format: MathFormat.TEX, mathType: MathType.INLINE } }),
              new ContentNode({ type: ContentType.TEXT, value: ", quicksort has average time complexity:" }),
            ],
          }),
          new ContentNode({
            type: ContentType.MATH,
            value: "T(n) = 2T(n/2) + \\Theta(n)",
            attributes: { format: MathFormat.TEX, mathType: MathType.DISPLAY },
          }),
          new ContentNode({
            type: ContentType.BLOCKQUOTE,
            children: [
              new ContentNode({
                type: ContentType.PARAGRAPH,
                value: "Note: Assume uniform random pivot selection.",
              }),
            ],
          }),
        ],
        options: [
          new OptionNode({
            letter: "A",
            content: [new ContentNode({ type: ContentType.MATH, value: "\\Theta(n \\log n)", attributes: { format: MathFormat.TEX, mathType: MathType.INLINE } })],
          }),
          new OptionNode({
            letter: "B",
            content: [new ContentNode({ type: ContentType.MATH, value: "\\Theta(n^2)", attributes: { format: MathFormat.TEX, mathType: MathType.INLINE } })],
          }),
        ],
      }),
    ],
  });

  const actual = exportAssignmentToMarkdown(doc);
  const expected =
`# Algorithms Final Exam

**Course:** CS2001  
**Questions:** 1  
**Total Marks:** 5

## Question 1

**Type:** MCQ  
**Marks:** 5

For an array of size \\(n\\), quicksort has average time complexity:

\\[
T(n) = 2T(n/2) + \\Theta(n)
\\]

> Note: Assume uniform random pivot selection.

**Options**

- **A.** \\(\\Theta(n \\log n)\\)
- **B.** \\(\\Theta(n^2)\\)
`;

  if (actual !== expected) {
    throw new Error(`Golden 5 mismatch!\n--- EXPECTED ---\n${expected}\n--- ACTUAL ---\n${actual}`);
  }
});

if (!passed) {
  console.error("\nMarkdown exporter verification FAILED.");
  process.exit(1);
} else {
  console.log("\nAll 22 Markdown exporter tests and 5 golden tests passed successfully!\n");
}
