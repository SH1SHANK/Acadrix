#!/usr/bin/env node
/**
 * Comprehensive Academic Document & PDF Compilation Test Suite.
 * 
 * Validates all 26 edge cases and architectural invariants defined in
 * Sections 22, 23, and 32 of the Acadrix PDF Compilation Specification.
 */

import { AssignmentDocument, QuestionNode, OptionNode, ContentNode } from "../src/model/document.js";
import { QuestionType, ContentType, MathType, MathFormat } from "../src/model/types.js";
import { DocNodeType, QuestionKind } from "../src/document/ast.js";
import { normalizeDocument } from "../src/document/normalizer.js";
import { compilePdfDocument, compilePdfDefinition } from "../src/document/compiler.js";
import { postProcessPdf } from "../src/document/post-processor.js";
import { validatePdfCompilation } from "../src/document/validator.js";
import { compileAcademicPdf, exportPdf } from "../src/exporters/pdf.js";
import { tokenizeCode } from "../src/document/tokenizer.js";
import { createJavaWeek01Fixture } from "../fixtures/java-week-01-ga1.mjs";

let passed = true;

async function check(desc, fn) {
  try {
    await fn();
    console.log(`✓ ${desc}`);
  } catch (err) {
    console.error(`❌ ${desc}: ${err.message}\n${err.stack}`);
    passed = false;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "Assertion failed");
}

console.log("\n=======================================================");
console.log("  Acadrix PDF Compilation Pipeline Test Suite");
console.log("=======================================================\n");

// ── Test 1: 0 Questions (Empty Assessment) ───────────────────────────────────
await check("Edge Case 1: 0 Questions (empty assessment compiles safely without errors)", async () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Empty Assessment", totalQuestions: 0 },
    questions: [],
  });
  const ast = normalizeDocument(doc);
  assert(ast.questions.length === 0, "AST should have 0 questions");
  assert(ast.metadata.title === "Empty Assessment", "Metadata title preserved");

  const compiled = await compileAcademicPdf(doc);
  assert(compiled.pdfBytes.length > 0, "PDF bytes generated");
  assert(compiled.pageCount >= 1, "At least 1 page generated");
  assert(compiled.validation.valid, "Validation passes for empty doc");
});

// ── Test 2: 1 Question ───────────────────────────────────────────────────────
await check("Edge Case 2: 1 Question assessment", async () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Single Question Quiz", totalQuestions: 1, course: "CS101" },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        marks: 1,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "What is 2 + 2?" })],
        options: [
          new OptionNode({ letter: "A", content: "3" }),
          new OptionNode({ letter: "B", content: "4" }),
        ],
      }),
    ],
  });
  const compiled = await compileAcademicPdf(doc);
  assert(compiled.pageCount === 1, "Should be 1 page");
  assert(compiled.validation.valid, "Validation must pass");
  assert(compiled.validation.invariantPassed, "Invariant must pass");
});

// ── Test 3: 12-Question Java Assessment (Reference PDF) ──────────────────────
await check("Edge Case 3: 12-question Java-style assessment (full reference match)", async () => {
  const doc = createJavaWeek01Fixture();
  const compiled = await compileAcademicPdf(doc);

  assert(compiled.validation.valid, "12-question assessment validation must pass");
  assert(compiled.validation.invariantPassed, "Invariant 12 === 12 === 12 must pass");
  assert(compiled.pageCount >= 2, "12-question assessment should span at least 2 pages");
  assert(compiled.pdfBytes.length > 20000, "PDF bytes should be substantial");

  // Verify Q1 was classified as MATCHING
  const q1 = compiled.docRoot.questions[0];
  assert(q1.kind === QuestionKind.MATCHING, `Q1 should be MATCHING, got ${q1.kind}`);
  assert(q1.matching && q1.matching.pairs.length === 4, "Q1 should have 4 matching pairs");

  // Verify Q2 line-number gutter artifact was stripped
  const q2 = compiled.docRoot.questions[1];
  const q2HasGutter = q2.stem.some((b) => b.text && b.text.includes("12345678910111213"));
  assert(!q2HasGutter, "Q2 gutter artifact must be stripped from stem");
  const q2Code = q2.stem.find((b) => b.type === DocNodeType.CODE);
  assert(q2Code && q2Code.language === "python", "Q2 code block must exist with python lang");
});

// ── Test 4: 100+ Questions (Massive Assessment) ──────────────────────────────
await check("Edge Case 4: 100+ questions compilation and pagination stress test", async () => {
  const questions = [];
  for (let i = 1; i <= 105; i++) {
    questions.push(
      new QuestionNode({
        number: i,
        type: i % 2 === 0 ? QuestionType.MCQ : QuestionType.NUMERICAL,
        marks: 1,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: `Stress test item ${i}` })],
        options: i % 2 === 0 ? [
          new OptionNode({ letter: "A", content: "Option A" }),
          new OptionNode({ letter: "B", content: "Option B" }),
        ] : [],
      })
    );
  }

  const doc = new AssignmentDocument({
    metadata: { title: "105 Questions Exam", totalQuestions: 105 },
    questions,
  });

  const ast = normalizeDocument(doc);
  assert(ast.questions.length === 105, "AST must contain 105 questions");
  assert(ast.diagnostics.expectedQuestions === 105, "Expected 105");

  const pdfDef = compilePdfDefinition(ast);
  assert(pdfDef.content.length >= 105, "pdfmake definition has all question nodes");
});

// ── Test 5: Very Long Question ───────────────────────────────────────────────
await check("Edge Case 5: Very long question stem (>2500 characters)", async () => {
  const longText = "Detailed theoretical background context. ".repeat(60);
  const doc = new AssignmentDocument({
    metadata: { title: "Long Stem Exam", totalQuestions: 1 },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        marks: 2,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: longText })],
        options: [
          new OptionNode({ letter: "A", content: "True" }),
          new OptionNode({ letter: "B", content: "False" }),
        ],
      }),
    ],
  });

  const compiled = await compileAcademicPdf(doc);
  assert(compiled.validation.valid, "Validation passes for long stem");
  assert(compiled.pageCount >= 1, "Document compiled");
});

// ── Test 6: Very Long Option ─────────────────────────────────────────────────
await check("Edge Case 6: Very long option content (>600 characters)", async () => {
  const longOption = "Option explanation detailing the specific architecture of memory models. ".repeat(10);
  const doc = new AssignmentDocument({
    metadata: { title: "Long Option Quiz", totalQuestions: 1 },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        marks: 1,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "Select the most accurate statement:" })],
        options: [
          new OptionNode({ letter: "A", content: longOption }),
          new OptionNode({ letter: "B", content: "Short option B" }),
        ],
      }),
    ],
  });

  const compiled = await compileAcademicPdf(doc);
  assert(compiled.validation.valid, "Long option compiled safely");
});

// ── Test 7: Very Large Code Block (120+ lines) ───────────────────────────────
await check("Edge Case 7: Very large code block (120 lines)", async () => {
  const codeLines = [];
  for (let i = 1; i <= 120; i++) {
    codeLines.push(`    line_${i} = execute_step(${i}, factor=${i * 2})`);
  }
  const fullCode = `def large_algorithm():\n${codeLines.join("\n")}\n    return True`;

  const doc = new AssignmentDocument({
    metadata: { title: "Large Code Test", totalQuestions: 1 },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.TEXT,
        marks: 5,
        stem: [
          new ContentNode({ type: ContentType.PARAGRAPH, value: "Analyze the algorithm below:" }),
          new ContentNode({
            type: ContentType.CODE_BLOCK,
            attributes: { language: "python" },
            value: fullCode,
          }),
        ],
      }),
    ],
  });

  const compiled = await compileAcademicPdf(doc);
  assert(compiled.pageCount >= 2, "Large code block flows across multiple pages");
  assert(compiled.validation.valid, "Validation passes");
});

// ── Test 8: Code Spanning Pages ──────────────────────────────────────────────
await check("Edge Case 8: Code spanning pages with preserved indentation", async () => {
  const code = `def quicksort(arr):\n    # Indented recursive sort\n` +
    `    if len(arr) <= 1:\n        return arr\n` +
    Array.from({ length: 60 }, (_, i) => `    step_${i} = arr[${i % 5}] + ${i}`).join("\n") +
    `\n    return arr`;

  const tokens = tokenizeCode(code, "python");
  assert(tokens.length >= 65, "All lines tokenized");
  assert(tokens[0][0].text === "def", "First token is def keyword");
  assert(tokens[1][0].text === "    ", "Preserved 4-space indentation");

  const doc = new AssignmentDocument({
    metadata: { title: "Code Spanning Pages", totalQuestions: 1 },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.TEXT,
        stem: [
          new ContentNode({ type: ContentType.CODE_BLOCK, attributes: { language: "python" }, value: code }),
        ],
      }),
    ],
  });

  const compiled = await compileAcademicPdf(doc);
  assert(compiled.pageCount >= 2, "Code block spanning pages compiled");
});

// ── Test 9: Table Spanning Pages ─────────────────────────────────────────────
await check("Edge Case 9: Table spanning pages with repeatable header", async () => {
  const rows = [];
  for (let r = 0; r < 40; r++) {
    rows.push(
      new ContentNode({
        type: ContentType.TABLE_ROW,
        children: [
          new ContentNode({ type: ContentType.TABLE_CELL, value: `Item ${r + 1}` }),
          new ContentNode({ type: ContentType.TABLE_CELL, value: `Data ${r * 10}` }),
          new ContentNode({ type: ContentType.TABLE_CELL, value: `Status ${r % 2 === 0 ? "Active" : "Pending"}` }),
        ],
      })
    );
  }

  const doc = new AssignmentDocument({
    metadata: { title: "Multi-page Table", totalQuestions: 1 },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        stem: [
          new ContentNode({
            type: ContentType.TABLE,
            attributes: { caption: "Extensive lookup table" },
            children: rows,
          }),
        ],
        options: [
          new OptionNode({ letter: "A", content: "Correct" }),
          new OptionNode({ letter: "B", content: "Incorrect" }),
        ],
      }),
    ],
  });

  const compiled = await compileAcademicPdf(doc);
  assert(compiled.pageCount >= 2, "Large table spans across pages");
  assert(compiled.validation.valid, "Multi-page table valid");
});

// ── Test 10: Question Immediately Before Page Boundary ───────────────────────
await check("Edge Case 10: Question immediately before page boundary (orphan prevention)", async () => {
  // Question 1 has medium text, Question 2 starts right near boundary
  const filler = "Paragraph line of text that consumes vertical page height. ".repeat(20);
  const doc = new AssignmentDocument({
    metadata: { title: "Page Boundary Test", totalQuestions: 2 },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        marks: 1,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: filler })],
        options: [
          new OptionNode({ letter: "A", content: "Choice 1" }),
          new OptionNode({ letter: "B", content: "Choice 2" }),
        ],
      }),
      new QuestionNode({
        number: 2,
        type: QuestionType.MCQ,
        marks: 2,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "Prompt for question 2 at boundary." })],
        options: [
          new OptionNode({ letter: "A", content: "Choice 2A" }),
          new OptionNode({ letter: "B", content: "Choice 2B" }),
        ],
      }),
    ],
  });

  const compiled = await compileAcademicPdf(doc);
  assert(compiled.validation.valid, "Validation passes for boundary questions");
  assert(compiled.pageCount >= 1, "Rendered cleanly");
});

// ── Test 11: Matching Question ───────────────────────────────────────────────
await check("Edge Case 11: Matching question structuring and two-column rendering", async () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Matching Exam", totalQuestions: 1 },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        marks: 2,
        stem: [
          new ContentNode({ type: ContentType.HEADING, value: "Match the following:" }),
          new ContentNode({
            type: ContentType.PARAGRAPH,
            value: "A. Lexical Analysis I. Generates Parse Tree\nB. Syntax Analysis II. Symbol Table Creation\nC. Semantic Analysis III. Token Stream Generation",
          }),
        ],
        options: [
          new OptionNode({ letter: "A", content: "A-III, B-I, C-II" }),
          new OptionNode({ letter: "B", content: "A-I, B-III, C-II" }),
        ],
      }),
    ],
  });

  const ast = normalizeDocument(doc);
  const q = ast.questions[0];
  assert(q.kind === QuestionKind.MATCHING, "Classified as MATCHING");
  assert(q.matching && q.matching.pairs.length === 3, "Extracted 3 pairs");
  assert(q.matching.pairs[0].leftText === "Lexical Analysis", "Left text match");
  assert(q.matching.pairs[0].rightText === "Generates Parse Tree", "Right text match");

  const compiled = await compileAcademicPdf(doc);
  assert(compiled.validation.valid, "Matching question compiles to valid PDF");
});

// ── Test 12: MCQ Question ────────────────────────────────────────────────────
await check("Edge Case 12: MCQ question structure", async () => {
  const doc = new AssignmentDocument({
    metadata: { title: "MCQ Test", totalQuestions: 1 },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        marks: 1,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "Select one:" })],
        options: [
          new OptionNode({ letter: "A", content: "Alpha" }),
          new OptionNode({ letter: "B", content: "Beta" }),
          new OptionNode({ letter: "C", content: "Gamma" }),
          new OptionNode({ letter: "D", content: "Delta" }),
        ],
      }),
    ],
  });
  const ast = normalizeDocument(doc);
  assert(ast.questions[0].kind === QuestionKind.MCQ, "MCQ classified");
  assert(ast.questions[0].options.length === 4, "4 options");
});

// ── Test 13: MSQ Question ────────────────────────────────────────────────────
await check("Edge Case 13: MSQ question structure", async () => {
  const doc = new AssignmentDocument({
    metadata: { title: "MSQ Test", totalQuestions: 1 },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MSQ,
        marks: 2,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "Select all that apply:" })],
        options: [
          new OptionNode({ letter: "A", content: "Statement 1" }),
          new OptionNode({ letter: "B", content: "Statement 2" }),
          new OptionNode({ letter: "C", content: "Statement 3" }),
        ],
      }),
    ],
  });
  const ast = normalizeDocument(doc);
  assert(ast.questions[0].kind === QuestionKind.MSQ, "MSQ classified");
});

// ── Test 14: Numerical Question ──────────────────────────────────────────────
await check("Edge Case 14: Numerical question structure", async () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Numerical Test", totalQuestions: 1 },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.NUMERICAL,
        marks: 3,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "Calculate the exact value of pi to 2 decimals." })],
      }),
    ],
  });
  const ast = normalizeDocument(doc);
  assert(ast.questions[0].kind === QuestionKind.NUMERICAL, "NUMERICAL classified");
  assert(ast.questions[0].options.length === 0, "No options for numerical");
});

// ── Test 15: Text / Descriptive Response ─────────────────────────────────────
await check("Edge Case 15: Text / descriptive response question", async () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Descriptive Test", totalQuestions: 1 },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.DESCRIPTIVE,
        marks: 5,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "Explain the difference between TCP and UDP in detail." })],
      }),
    ],
  });
  const ast = normalizeDocument(doc);
  assert(ast.questions[0].kind === QuestionKind.DESCRIPTIVE, "DESCRIPTIVE classified");
});

// ── Test 16: Missing Course Name ─────────────────────────────────────────────
await check("Edge Case 16: Missing course name handles gracefully", async () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Assignment Without Course", totalQuestions: 1 },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        marks: 1,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "Prompt without course." })],
        options: [
          new OptionNode({ letter: "A", content: "A" }),
          new OptionNode({ letter: "B", content: "B" }),
        ],
      }),
    ],
  });
  const compiled = await compileAcademicPdf(doc);
  assert(compiled.validation.valid, "Valid compilation without course name");
  assert(compiled.docRoot.metadata.course === "", "Course defaults cleanly to empty string");
});

// ── Test 17: Missing Assessment Title ────────────────────────────────────────
await check("Edge Case 17: Missing assessment title uses fallback", async () => {
  const doc = new AssignmentDocument({
    metadata: { course: "CS50", totalQuestions: 1 },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "Prompt." })],
        options: [
          new OptionNode({ letter: "A", content: "A" }),
          new OptionNode({ letter: "B", content: "B" }),
        ],
      }),
    ],
  });
  const compiled = await compileAcademicPdf(doc);
  assert(compiled.docRoot.metadata.title.length > 0, "Title fallback applied");
});

// ── Test 18: Malformed HTML & Line Numbers ───────────────────────────────────
await check("Edge Case 18: Malformed HTML & line-number gutter artifact cleanup", async () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Artifact Test", totalQuestions: 1 },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        stem: [
          new ContentNode({ type: ContentType.PARAGRAPH, value: "Analyze the program:" }),
          new ContentNode({ type: ContentType.PARAGRAPH, value: "123456789101112" }), // Gutter artifact
          new ContentNode({
            type: ContentType.CODE_BLOCK,
            attributes: { language: "python" },
            value: "def add(x, y):\n    return x + y",
          }),
        ],
        options: [
          new OptionNode({ letter: "A", content: "3" }),
          new OptionNode({ letter: "B", content: "5" }),
        ],
      }),
    ],
  });
  const ast = normalizeDocument(doc);
  const q = ast.questions[0];
  assert(q.stem.length === 2, `Stem should contain 2 blocks (paragraph + code), got ${q.stem.length}`);
  assert(q.stem[0].type === DocNodeType.PARAGRAPH, "Paragraph preserved");
  assert(q.stem[1].type === DocNodeType.CODE, "Code preserved");
});

// ── Test 19: Duplicate Question Number Detection ─────────────────────────────
await check("Edge Case 19: Duplicate question numbers caught by validator", async () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Duplicate Test", totalQuestions: 2 },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "Question 1" })],
        options: [new OptionNode({ letter: "A", content: "A" }), new OptionNode({ letter: "B", content: "B" })],
      }),
      new QuestionNode({
        number: 1, // Duplicate 1!
        type: QuestionType.MCQ,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "Question 1 duplicate" })],
        options: [new OptionNode({ letter: "A", content: "A" }), new OptionNode({ letter: "B", content: "B" })],
      }),
    ],
  });

  const ast = normalizeDocument(doc);
  const rawBytes = await compilePdfDocument(ast);
  const validation = await validatePdfCompilation(rawBytes, ast);

  assert(!validation.valid, "Validator should detect duplicate question number");
  assert(
    validation.errors.some((e) => e.includes("Duplicate question number")),
    "Error message flags duplicate question"
  );
});

// ── Test 20: Unicode-Heavy Question ──────────────────────────────────────────
await check("Edge Case 20: Unicode-heavy content (smart quotes, math symbols, Greek letters)", async () => {
  const unicodeText = 'Consider the mapping φ: α → β where “quoted” and ‘nested’ terms satisfy: ∀x ∈ S, f(x) ≤ ∑ᵢ₌₁ⁿ xᵢ² ≠ ∅.';
  const doc = new AssignmentDocument({
    metadata: { title: "Unicode Assessment", totalQuestions: 1 },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: unicodeText })],
        options: [
          new OptionNode({ letter: "A", content: "True: ∀x" }),
          new OptionNode({ letter: "B", content: "False: ∃x" }),
        ],
      }),
    ],
  });

  const compiled = await compileAcademicPdf(doc);
  assert(compiled.validation.valid, "Unicode content compiles cleanly");
});

// ── Test 21: Mathematical Content (LaTeX & MathML) ───────────────────────────
await check("Edge Case 21: Mathematical content (TeX and MathML)", async () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Math Assessment", totalQuestions: 1 },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        stem: [
          new ContentNode({ type: ContentType.PARAGRAPH, value: "Given the equation:" }),
          new ContentNode({
            type: ContentType.MATH,
            attributes: { mathType: MathType.DISPLAY, format: MathFormat.TEX },
            value: "f(x) = \\int_{-\\infty}^{\\infty} e^{-t^2} dt",
          }),
        ],
        options: [
          new OptionNode({ letter: "A", content: "\\sqrt{\\pi}" }),
          new OptionNode({ letter: "B", content: "\\pi" }),
        ],
      }),
    ],
  });

  const compiled = await compileAcademicPdf(doc);
  assert(compiled.validation.valid, "Math expressions compiled cleanly");
});

// ── Test 22: Image-based Question Content ────────────────────────────────────
await check("Edge Case 22: Image-based question content with SVG", async () => {
  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><rect width="100" height="40" fill="#2F4BDB"/><text x="10" y="25" fill="#ffffff">Acadrix</text></svg>`;
  const doc = new AssignmentDocument({
    metadata: { title: "SVG Diagram Assessment", totalQuestions: 1 },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        stem: [
          new ContentNode({ type: ContentType.PARAGRAPH, value: "Examine the following diagram:" }),
          new ContentNode({
            type: ContentType.SVG,
            value: svgContent,
            attributes: { caption: "Figure 1: State Machine" },
          }),
        ],
        options: [
          new OptionNode({ letter: "A", content: "State 1" }),
          new OptionNode({ letter: "B", content: "State 2" }),
        ],
      }),
    ],
  });

  const compiled = await compileAcademicPdf(doc);
  assert(compiled.validation.valid, "SVG diagram compiled to PDF");
});

// ── Test 23: Missing Image Fallback ──────────────────────────────────────────
await check("Edge Case 23: Missing image handles gracefully without throwing", async () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Missing Image Quiz", totalQuestions: 1 },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        stem: [
          new ContentNode({
            type: ContentType.IMAGE,
            attributes: { src: "https://example.com/missing.png", alt: "Missing diagram" },
          }),
        ],
        options: [
          new OptionNode({ letter: "A", content: "A" }),
          new OptionNode({ letter: "B", content: "B" }),
        ],
      }),
    ],
  });

  const ast = normalizeDocument(doc);
  assert(ast.questions[0].stem.length === 1, "Image block preserved in AST");
  const def = compilePdfDefinition(ast);
  assert(def.content.length > 0, "PDF definition handles missing image without failure");
});

// ── Test 24: Invariant Failure Detection ─────────────────────────────────────
await check("Edge Case 24: Critical question count invariant failure detection", async () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Partial Assessment", totalQuestions: 10 }, // Claims 10 questions!
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "Question 1" })],
        options: [new OptionNode({ letter: "A", content: "A" }), new OptionNode({ letter: "B", content: "B" })],
      }),
    ], // But only 1 extracted!
  });

  const ast = normalizeDocument(doc);
  const rawBytes = await compilePdfDocument(ast);
  const validation = await validatePdfCompilation(rawBytes, ast);

  assert(!validation.valid, "Invariant failure must mark document as invalid");
  assert(!validation.invariantPassed, "Invariant flag must be false");
  assert(
    validation.errors.some((e) => e.includes("expected 10")),
    "Invariant error explicitly details expected vs extracted mismatch"
  );
});

// ── Test 25: Deterministic Output ────────────────────────────────────────────
await check("Edge Case 25: Deterministic output check (two runs produce identical AST)", async () => {
  const doc = createJavaWeek01Fixture();
  const ast1 = normalizeDocument(doc);
  const ast2 = normalizeDocument(doc);

  assert(ast1.questions.length === ast2.questions.length, "Equal question count");
  assert(JSON.stringify(ast1.metadata) === JSON.stringify(ast2.metadata), "Identical metadata");
  assert(
    JSON.stringify(ast1.questions[0].matching) === JSON.stringify(ast2.questions[0].matching),
    "Identical matching structures"
  );
});

// ── Test 26: PDF Metadata & Outlines ─────────────────────────────────────────
await check("Edge Case 26: Post-processing metadata and question bookmarks", async () => {
  const doc = createJavaWeek01Fixture();
  const compiled = await compileAcademicPdf(doc);

  assert(compiled.validation.valid, "Valid compilation");
  assert(compiled.pageCount >= 2, "Multi-page document");

  const pdfDef = compilePdfDefinition(compiled.docRoot);
  // Verify outlines are enabled on questions for reader navigation
  const qHeaders = pdfDef.content.flatMap((c) => (c.stack ? c.stack : [c]));
  const hasOutlines = qHeaders.some((item) => {
    if (item.unbreakable && item.stack) {
      return item.stack.some((inner) => inner.columns && inner.columns[0]?.outline === true);
    }
    return false;
  });
  assert(hasOutlines, "Question headers must configure outline: true for bookmarks");
});

console.log("\n=======================================================");
if (!passed) {
  console.error("❌ Some pipeline tests failed!");
  process.exit(1);
} else {
  console.log("✓ All 26 Document Pipeline tests passed successfully!\n");
}
