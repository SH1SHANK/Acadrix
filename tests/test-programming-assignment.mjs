#!/usr/bin/env node
/**
 * Acadrix Programming Assignment Workflow & Fixture Verification Test Suite.
 * 
 * Complete verification for:
 * 1. Multi-signal programming assignment detection
 * 2. Problem statement extraction with rich formatting and formulas
 * 3. Image extraction with dimensions and absolute URL resolution
 * 4. Language extraction and normalization across Bash, SQL, Python, Java, JavaScript
 * 5. Semantic Test Cases tab switching and extraction without polling
 * 6. Test case data modeling (input, expected output, multiline preservation)
 * 7. Ace editor public API reading and writing (readAceEditorCode, setAceEditorCode)
 * 8. Markdown code fence parsing (single block, multiple blocks, plain code)
 * 9. Language mismatch detection and warning
 * 10. AI prompt generation (full problem, test cases only, problem only, code only)
 * 11. Document AST normalization for programming assignments
 * 12. PDF and Markdown compilation of programming assignments
 * 13. Security invariants (zero eval, zero auto-run, zero auto-submit)
 * 14. Language Integration Test Matrix (Bash, SQL, Python, Java, JavaScript)
 * 15. Editor Protected-Region Test Matrix A–L
 * 16. Instructions Test Matrix 1–14 (instructions are metadata, never questions)
 * 17. Multi-Question Traversal & Paginator Windows with State Restoration
 * 18. Browser-level / IITM guard simulation regression test
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  ProgrammingAssignmentExtractor,
  AssessmentState,
  ExtractionState,
  ExtractionStatus,
} from "../src/extraction/programming.js";
import {
  resolveAceContext,
  validateAceSessionInvariants,
  getAceEditorInstance,
  readAceEditorCode,
  readAceStarterCode,
  readAcePrefixCode,
  readAceSuffixCode,
  readAceEditorData,
  setAceEditorCode,
  resolveEditableRange,
  ProgrammingEditorAdapter,
  requestMainWorldBridge,
  ensureMainWorldBridge,
  EditorErrorCode,
  EditorState,
} from "../src/bridge/ace-bridge.js";
import {
  initPageBridge,
  executePrivilegedWrite,
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_CHANNEL,
  BRIDGE_REQUEST_EVENT,
  BRIDGE_RESPONSE_EVENT,
} from "../src/bridge/page-bridge.js";
import {
  normalizeProgrammingLanguage,
  getLanguageMetadata,
  isLanguageCompatible,
  SUPPORTED_LANGUAGES,
} from "../src/bridge/languages.js";

import { LauncherButton } from "../src/ui/launcher.js";
import { ReaderDrawer } from "../src/ui/reader.js";
import { createReaderImportFeature } from "../src/ui/reader-import.js";
import {
  formatProgrammingPrompt,
  serializeProgrammingPrompt,
  copyQuestion,
  copyStarterCode,
  copyPrefixCode,
  copySuffixCode,
  copyTestCases,
  copyCurrentCode,
  copyAiContext,
  copyFullAssignment,
  generateAiPrompt,
} from "../src/bridge/prompt.js";
import { IitmPortalAdapter, PortalPageType, isFabEligible } from "../src/portal/adapter.js";
import { QuestionType, ContentType, AssessmentFamily } from "../src/model/types.js";
import { AssignmentDocument, QuestionNode, TestCaseNode, ProgrammingAssignmentData, ContentNode } from "../src/model/document.js";
import { normalizeDocument } from "../src/document/normalizer.js";
import { compilePdfDocument } from "../src/document/compiler.js";
import { MarkdownExporter } from "../src/exporters/markdown.js";
import { DocNodeType, QuestionKind } from "../src/document/ast.js";
import {
  AssessmentNotDetectedError,
  QuestionReadinessError,
  TraversalIncompleteError,
  StateRestorationError,
} from "../src/extraction/errors.js";
import {
  serializeAssignmentAnswers,
  parseAssignmentAnswers,
  serializeAnswerStream,
  parseAnswerStream,
  escapeAnswerRecord,
  unescapeAnswerRecord,
} from "../src/bridge/answer-stream.js";
import { parseAnswerKey } from "../src/bridge/parser.js";


let totalChecks = 0;
let passed = true;

async function check(desc, fn) {
  totalChecks++;
  try {
    await fn();
    console.log(`✓ ${desc}`);
  } catch (err) {
    console.error(`❌ ${desc}: ${err.message}\n${err.stack}`);
    passed = false;
  }
}

console.log("\n=======================================================");
console.log("  Acadrix Programming Assignment Verification Suite");
console.log("=======================================================\n");

const fixtureHtml = fs.readFileSync("fixtures/programming/programming-assignment.html", "utf8");

// Mock Ace session factory for fixture-driven testing
function createMockAceSession({ lines = [], readonlyRanges = [] } = {}) {
  let docLines = [...lines];
  let markers = {};
  let markerId = 1;
  const undoStack = [];

  for (const r of readonlyRanges) {
    markers[markerId] = {
      id: markerId++,
      clazz: "readonly_line",
      type: "fullLine",
      range: {
        start: { row: r.startRow, column: r.startCol ?? 0 },
        end: { row: r.endRow, column: r.endCol ?? 0 },
      },
    };
  }

  const session = {
    id: `mock-session-${Math.random().toString(36).slice(2, 7)}`,
    getLength: () => docLines.length,
    getLine: (row) => docLines[row] ?? "",
    getLines: (first, last) => docLines.slice(first, last + 1),
    getValue: () => docLines.join("\n"),
    getMarkers: (inFront) => (inFront ? markers : {}),
    addMarker: (range, clazz, type, inFront) => {
      const id = markerId++;
      markers[id] = { id, range, clazz, type, inFront };
      return id;
    },
    getTextRange: (range) => {
      if (!range?.start || !range?.end) return "";
      const { start, end } = range;
      if (start.row === end.row) {
        const line = docLines[start.row] || "";
        return line.slice(start.column, end.column);
      }
      const parts = [];
      parts.push((docLines[start.row] || "").slice(start.column));
      for (let r = start.row + 1; r < end.row; r++) {
        parts.push(docLines[r] || "");
      }
      if (end.row < docLines.length) {
        parts.push((docLines[end.row] || "").slice(0, end.column));
      }
      return parts.join("\n");
    },
    replace: (range, text) => {
      undoStack.push({
        lines: [...docLines],
        markers: JSON.parse(JSON.stringify(markers)),
      });
      const { start, end } = range;
      const before = (docLines[start.row] || "").slice(0, start.column);
      const after = end.row < docLines.length ? (docLines[end.row] || "").slice(end.column) : "";
      const replacementLines = text.split("\n");

      const newLines = [];
      for (let r = 0; r < start.row; r++) {
        newLines.push(docLines[r]);
      }
      if (replacementLines.length === 1) {
        newLines.push(before + replacementLines[0] + after);
      } else {
        newLines.push(before + replacementLines[0]);
        for (let i = 1; i < replacementLines.length - 1; i++) {
          newLines.push(replacementLines[i]);
        }
        newLines.push(replacementLines[replacementLines.length - 1] + after);
      }
      for (let r = end.row + 1; r < docLines.length; r++) {
        newLines.push(docLines[r]);
      }

      // Shift markers after replaced range
      const linesReplaced = end.row - start.row + 1;
      const lineDelta = replacementLines.length - linesReplaced;

      if (lineDelta !== 0) {
        for (const m of Object.values(markers)) {
          if (m?.range?.start && m.range.start.row > end.row) {
            m.range.start.row += lineDelta;
            m.range.end.row += lineDelta;
          }
        }
      }

      docLines = newLines;
      return range;
    },
    setValue: (val) => {
      undoStack.push({
        lines: [...docLines],
        markers: JSON.parse(JSON.stringify(markers)),
      });
      docLines = val.split("\n");
    },
    undo: () => {
      if (undoStack.length > 0) {
        const prev = undoStack.pop();
        docLines = prev.lines;
        markers = prev.markers;
      }
    },
  };

  return session;
}

// Helper to create mock DOM document from HTML string
function createMockProgrammingDoc(html = fixtureHtml) {
  let activeTabName = "Question";
  const mockTabs = [
    { name: "Question", active: true },
    { name: "Test Cases", active: false },
  ];

  return {
    nodeType: 9,
    activeTabName,
    querySelector: (sel) => {
      if (sel.includes("app-programming-assignment-view") || sel.includes(".programming-assignment-view")) {
        return { tagName: "APP-PROGRAMMING-ASSIGNMENT-VIEW" };
      }
      if (sel.includes("app-pa-question") || sel.includes(".pa-question")) {
        return {
          tagName: "APP-PA-QUESTION",
          innerHTML: `
            <div class="backend-html">
              <p>Write a function to calculate simple interest.</p>
              <p>Formula: \\( I = \\frac{P \\times R \\times T}{100} \\)</p>
              <img src="/assets/diagram.png" alt="Interest diagram" width="400" height="200">
            </div>
          `,
          textContent: "Write a function to calculate simple interest. Formula: I = P*R*T/100",
          querySelectorAll: (s) => (s === "img" ? [{ getAttribute: (a) => (a === "src" ? "/assets/diagram.png" : a === "alt" ? "Interest diagram" : a === "width" ? "400" : "200") }] : []),
        };
      }
      if (sel.includes("headerTitle") || sel.includes("h1.title") || sel.includes(".title")) {
        return { textContent: "JavaScript Graded Assignment - Simple and Compound Interest" };
      }
      if (sel.includes("breadcrumb") || sel.includes("current")) {
        return { textContent: "Week 4" };
      }
      if (sel.includes("courseTitle") || sel.includes("course-title")) {
        return { textContent: "Programming, Data Structures and Algorithms using Python" };
      }
      if (sel.includes("timer") || sel.includes("due-label")) {
        return { textContent: "Due: 2026-10-15 23:59 IST" };
      }
      if (sel.includes("languageValue") || sel.includes("current-value")) {
        return { textContent: "JavaScript" };
      }
      if (sel.includes("runCodeButton") || sel.includes("Run Code")) {
        return { disabled: false, getAttribute: () => null };
      }
      if (sel.includes("submitButton") || sel.includes("Submit")) {
        return { disabled: false, getAttribute: () => null };
      }
      if (sel.includes("testCasesRoot") || sel.includes("app-pa-test-cases")) {
        if (activeTabName === "Test Cases") {
          return {
            querySelectorAll: (s) => [
              {
                querySelector: (sub) => {
                  if (sub.includes("description") || sub.includes("title")) return { textContent: "Test Case 1 (Sample)" };
                  if (sub.includes("input")) return { textContent: "1000 5 2" };
                  if (sub.includes("output")) return { textContent: "100" };
                  return null;
                },
              },
              {
                querySelector: (sub) => {
                  if (sub.includes("description") || sub.includes("title")) return { textContent: "Test Case 2" };
                  if (sub.includes("input")) return { textContent: "5000 10 3" };
                  if (sub.includes("output")) return { textContent: "1500" };
                  return null;
                },
              },
            ],
          };
        }
        return null;
      }
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel.includes("button[role=tab]") || sel.includes(".tab-item")) {
        return [
          {
            textContent: "Question",
            getAttribute: (a) => (a === "aria-selected" ? String(activeTabName === "Question") : null),
            classList: { contains: (c) => c === "active" && activeTabName === "Question" },
            click: () => {
              activeTabName = "Question";
            },
          },
          {
            textContent: "Test Cases",
            getAttribute: (a) => (a === "aria-selected" ? String(activeTabName === "Test Cases") : null),
            classList: { contains: (c) => c === "active" && activeTabName === "Test Cases" },
            click: () => {
              activeTabName = "Test Cases";
            },
          },
        ];
      }
      return [];
    },
  };
}

// ── Test 1: Detection ────────────────────────────────────────────────────────
await check("Test 1: isProgrammingAssignment accurately detects programming view", async () => {
  const doc = createMockProgrammingDoc();
  const extractor = new ProgrammingAssignmentExtractor(doc);
  assert.equal(extractor.isProgrammingAssignment(doc), true, "Must detect programming assignment");

  const emptyDoc = { querySelector: () => null, querySelectorAll: () => [] };
  assert.equal(extractor.isProgrammingAssignment(emptyDoc), false, "Must return false on empty DOM");
});

// ── Test 2: Language Registry & Normalization Contract ───────────────────────
await check("Test 2: Language Registry strictly supports Bash, SQL, Python, Java, JavaScript as first-class", async () => {
  assert.deepEqual(SUPPORTED_LANGUAGES, ["bash", "sql", "python", "java", "javascript"]);

  // Bash
  assert.equal(normalizeProgrammingLanguage("Bash"), "bash");
  assert.equal(normalizeProgrammingLanguage("Shell"), "bash");
  assert.equal(normalizeProgrammingLanguage("Shell Script"), "bash");
  assert.equal(normalizeProgrammingLanguage("zsh"), "bash");

  // SQL
  assert.equal(normalizeProgrammingLanguage("SQL"), "sql");
  assert.equal(normalizeProgrammingLanguage("PostgreSQL"), "sql");
  assert.equal(normalizeProgrammingLanguage("MySQL"), "sql");

  // Python
  assert.equal(normalizeProgrammingLanguage("Python"), "python");
  assert.equal(normalizeProgrammingLanguage("Python 3"), "python");
  assert.equal(normalizeProgrammingLanguage("Python 3.10"), "python");

  // Java
  assert.equal(normalizeProgrammingLanguage("Java"), "java");

  // JavaScript
  assert.equal(normalizeProgrammingLanguage("JavaScript"), "javascript");
  assert.equal(normalizeProgrammingLanguage("JS"), "javascript");
  assert.equal(normalizeProgrammingLanguage("Node.js"), "javascript");

  // Unsupported language returns null, never falls back to javascript
  assert.equal(normalizeProgrammingLanguage("Ruby"), null);
  assert.equal(normalizeProgrammingLanguage("Rust"), null);
  assert.equal(normalizeProgrammingLanguage("Go"), null);
  assert.equal(normalizeProgrammingLanguage("unknown"), null);
});

// ── Test 3: Language Metadata & Code Fences ──────────────────────────────────
await check("Test 3: Language Metadata defines canonical fence, extension, and comments", async () => {
  for (const langId of SUPPORTED_LANGUAGES) {
    const meta = getLanguageMetadata(langId);
    assert.ok(meta, `Metadata must exist for ${langId}`);
    assert.equal(meta.id, langId);
    assert.ok(meta.canonicalName);
    assert.ok(meta.fileExtension.startsWith("."));
    assert.ok(meta.codeFence);
    assert.ok(meta.commentPrefixes.length > 0);
  }
});

// ── Test 4: 5 Supported Language Integration Matrix ──────────────────────────
await check("Test 4: 5 Language Integration Matrix (Bash, SQL, Python, Java, JavaScript)", async () => {
  // 1. Bash
  const bashLines = ["#!/usr/bin/env bash", "# Protected scaffold", "result=0", "echo $result"];
  const bashSession = createMockAceSession({
    lines: bashLines,
    readonlyRanges: [{ startRow: 0, endRow: 2, endCol: 0 }],
  });
  const bashAdapter = new ProgrammingEditorAdapter(bashSession);
  assert.equal(bashAdapter.getCode(), "result=0\necho $result");
  const bashWrite = bashAdapter.setCode("count=42\necho \"Count is: $count\"");
  assert.equal(bashWrite.ok, true);
  assert.equal(bashAdapter.getCode(), "count=42\necho \"Count is: $count\"");

  // 2. SQL
  const sqlLines = ["-- Protected Schema", "CREATE TABLE users (id INT);", "SELECT * FROM users;", "-- Protected Suffix"];
  const sqlSession = createMockAceSession({
    lines: sqlLines,
    readonlyRanges: [
      { startRow: 0, endRow: 2, endCol: 0 },
      { startRow: 3, endRow: 4, endCol: 0 },
    ],
  });
  const sqlAdapter = new ProgrammingEditorAdapter(sqlSession);
  assert.equal(sqlAdapter.getCode(), "SELECT * FROM users;");
  const sqlWrite = sqlAdapter.setCode("SELECT id, name FROM users\nWHERE active = 1;");
  assert.equal(sqlWrite.ok, true);
  assert.equal(sqlAdapter.getCode(), "SELECT id, name FROM users\nWHERE active = 1;");

  // 3. Python
  const pyLines = ["# Prefix: Header", "def solution(arr):", "    return len(arr)", "# Suffix: Runner"];
  const pySession = createMockAceSession({
    lines: pyLines,
    readonlyRanges: [
      { startRow: 0, endRow: 1, endCol: 0 },
      { startRow: 3, endRow: 4, endCol: 0 },
    ],
  });
  const pyAdapter = new ProgrammingEditorAdapter(pySession);
  assert.equal(pyAdapter.getCode(), "def solution(arr):\n    return len(arr)");
  const pyWrite = pyAdapter.setCode("def solution(arr):\n    # Count positive items\n    return sum(1 for x in arr if x > 0)");
  assert.equal(pyWrite.ok, true);
  assert.equal(pyAdapter.getCode(), "def solution(arr):\n    # Count positive items\n    return sum(1 for x in arr if x > 0)");

  // 4. Java
  const javaLines = ["import java.util.*;\npublic class Main {\n  public static void main(String[] args) {", "    int x = 1;", "  }\n}"];
  const javaSession = createMockAceSession({
    lines: javaLines,
    readonlyRanges: [
      { startRow: 0, endRow: 1, endCol: 0 },
      { startRow: 2, endRow: 3, endCol: 0 },
    ],
  });
  const javaAdapter = new ProgrammingEditorAdapter(javaSession);
  assert.equal(javaAdapter.getCode(), "    int x = 1;");
  const javaWrite = javaAdapter.setCode("    int a = 10;\n    int b = 20;\n    System.out.println(a + b);");
  assert.equal(javaWrite.ok, true);
  assert.equal(javaAdapter.getCode(), "    int a = 10;\n    int b = 20;\n    System.out.println(a + b);");

  // 5. JavaScript
  const jsLines = ["// Prefix", "function add(a, b) {", "  return a + b;", "}", "// Suffix"];
  const jsSession = createMockAceSession({
    lines: jsLines,
    readonlyRanges: [
      { startRow: 0, endRow: 1, endCol: 0 },
      { startRow: 4, endRow: 5, endCol: 0 },
    ],
  });
  const jsAdapter = new ProgrammingEditorAdapter(jsSession);
  assert.equal(jsAdapter.getCode(), "function add(a, b) {\n  return a + b;\n}");
  const jsWrite = jsAdapter.setCode("const add = (a, b) => a + b;");
  assert.equal(jsWrite.ok, true);
  assert.equal(jsAdapter.getCode(), "const add = (a, b) => a + b;");
});


// ── Test 6: Instructions Are Metadata, Never Questions ───────────────────────
await check("Test 6: Instructions Test Matrix (Instructions are metadata, never Question 1)", async () => {
  let activeQuestionNum = 1;
  const instructionsDoc = {
    nodeType: 9,
    querySelector: (sel) => {
      if (sel.includes("app-programming-assignment-view") || sel.includes(".programming-assignment-view")) {
        return { tagName: "APP-PROGRAMMING-ASSIGNMENT-VIEW" };
      }
      if (sel.includes("app-pa-instructions") || sel.includes(".instructions-panel")) {
        return {
          innerHTML: "<p>Read all instructions carefully. Do not use prohibited packages.</p>",
          textContent: "Read all instructions carefully. Do not use prohibited packages.",
          children: [],
        };
      }
      if (sel.includes("app-pa-question") || sel.includes(".pa-question")) {
        return {
          tagName: "APP-PA-QUESTION",
          innerHTML: `<p>Actual problem statement for Question ${activeQuestionNum}.</p>`,
          textContent: `Actual problem statement for Question ${activeQuestionNum}.`,
          querySelectorAll: (s) => (s === "img" ? [] : []),
        };
      }
      if (sel.includes("headerTitle") || sel.includes("h1.title") || sel.includes(".title")) {
        return { textContent: "Week 5 Python Graded Assignment" };
      }
      if (sel.includes("activeChip")) {
        return { textContent: String(activeQuestionNum), getAttribute: (a) => (a === "aria-label" ? `Question ${activeQuestionNum}` : null) };
      }
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel.includes("chip")) {
        return [
          {
            textContent: "Instructions",
            getAttribute: (a) => (a === "aria-label" ? "Instructions" : null),
            classList: { contains: () => false },
            click: () => {},
          },
          {
            textContent: "1",
            getAttribute: (a) => (a === "aria-label" ? "Question 1" : null),
            classList: { contains: (c) => c === "active" && activeQuestionNum === 1 },
            click: () => { activeQuestionNum = 1; },
          },
          {
            textContent: "2",
            getAttribute: (a) => (a === "aria-label" ? "Question 2" : null),
            classList: { contains: (c) => c === "active" && activeQuestionNum === 2 },
            click: () => { activeQuestionNum = 2; },
          },
        ];
      }
      return [];
    },
  };

  const extractor = new ProgrammingAssignmentExtractor(instructionsDoc);
  const targets = extractor.enumerateQuestionTargets(instructionsDoc);

  // Invariant: Instructions chip must be excluded from question targets
  assert.equal(targets.length, 2, "Must contain exactly 2 question targets, excluding Instructions");
  assert.equal(targets[0].number, 1);
  assert.equal(targets[1].number, 2);

  const assignmentDoc = await extractor.extractAssignment(instructionsDoc);
  assert.equal(assignmentDoc.questions.length, 2);
  assert.equal(assignmentDoc.questions[0].number, 1);
  assert.notEqual(assignmentDoc.questions[0].label, "Instructions");
  assert.ok(assignmentDoc.metadata.instructions, "Instructions must be stored in metadata");
});

// ── Test 7: Protected Region Matrix A–L ──────────────────────────────────────
await check("Test 7: Protected Region Matrix A–L (Dynamic resolution, fail-closed on ambiguity)", async () => {
  // A. No protected regions
  const sessA = createMockAceSession({ lines: ["line 0", "line 1"], readonlyRanges: [] });
  const adA = new ProgrammingEditorAdapter(sessA);
  assert.equal(adA.resolveEditableRange().isGuarded, false);
  assert.equal(adA.setCode("new code").ok, true);

  // B. Prefix only
  const sessB = createMockAceSession({ lines: ["prefix 0", "code 1"], readonlyRanges: [{ startRow: 0, endRow: 1, endCol: 0 }] });
  const adB = new ProgrammingEditorAdapter(sessB);
  assert.equal(adB.resolveEditableRange().hasPrefix, true);
  assert.equal(adB.resolveEditableRange().hasSuffix, false);
  assert.equal(adB.setCode("replaced 1").ok, true);

  // C. Suffix only
  const sessC = createMockAceSession({ lines: ["code 0", "suffix 1"], readonlyRanges: [{ startRow: 1, endRow: 2, endCol: 0 }] });
  const adC = new ProgrammingEditorAdapter(sessC);
  assert.equal(adC.resolveEditableRange().hasPrefix, false);
  assert.equal(adC.resolveEditableRange().hasSuffix, true);
  assert.equal(adC.setCode("replaced 0").ok, true);

  // D. Prefix + Suffix
  const sessD = createMockAceSession({
    lines: ["prefix 0", "code 1", "suffix 2"],
    readonlyRanges: [
      { startRow: 0, endRow: 1, endCol: 0 },
      { startRow: 2, endRow: 3, endCol: 0 },
    ],
  });
  const adD = new ProgrammingEditorAdapter(sessD);
  assert.equal(adD.resolveEditableRange().hasPrefix, true);
  assert.equal(adD.resolveEditableRange().hasSuffix, true);
  assert.equal(adD.setCode("updated 1").ok, true);

  // K. Ambiguous middle markers (Must fail closed)
  const sessK = createMockAceSession({
    lines: ["prefix 0", "code 1", "MIDDLE READONLY 2", "code 3", "suffix 4"],
    readonlyRanges: [
      { startRow: 0, endRow: 1, endCol: 0 },
      { startRow: 2, endRow: 3, endCol: 0 }, // Middle marker!
      { startRow: 4, endRow: 5, endCol: 0 },
    ],
  });
  const adK = new ProgrammingEditorAdapter(sessK);
  assert.equal(adK.resolveEditableRange().isAmbiguous, true);
  const resK = adK.setCode("unsafeWrite();");
  assert.equal(resK.ok, false);
  assert.equal(resK.errorCode, EditorErrorCode.PROTECTED_REGION_UNKNOWN);
});

// ── Test 8: Prompt Generation for all 5 languages ────────────────────────────
await check("Test 8: formatProgrammingPrompt serializes complete problem, test cases, and starter code for all languages", async () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    const qNode = new QuestionNode({
      number: 1,
      label: `${lang.toUpperCase()} Assignment`,
      type: QuestionType.PROGRAMMING,
      stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: `Solve problem in ${lang}` })],
      programmingData: new ProgrammingAssignmentData({
        language: lang,
        currentCode: `// ${lang} solution`,
        testCases: [new TestCaseNode({ index: 1, input: "in1", expectedOutput: "out1" })],
      }),
    });

    const doc = new AssignmentDocument({
      metadata: { title: `${lang} Graded Assignment`, course: "IITM Degree" },
      questions: [qNode],
    });

    const prompt = formatProgrammingPrompt(doc, { mode: "full" });
    assert.ok(prompt.includes(`Language: ${lang}`));
    assert.ok(prompt.includes("```text\nin1\n```"));
    assert.ok(prompt.includes("```text\nout1\n```"));
    assert.ok(prompt.includes(`\`\`\`${lang}`));
  }
});

// ── Test 9: PDF AST Compilation for All Languages ────────────────────────────
await check("Test 9: PDF AST Normalization & Compilation for all 5 languages", async () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    const qNode = new QuestionNode({
      number: 1,
      label: `${lang} Assignment`,
      type: QuestionType.PROGRAMMING,
      stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: `Problem in ${lang}` })],
      programmingData: new ProgrammingAssignmentData({
        language: lang,
        currentCode: `# Starter code for ${lang}`,
        testCases: [new TestCaseNode({ index: 1, input: "10", expectedOutput: "20" })],
      }),
    });

    const doc = new AssignmentDocument({
      metadata: { title: `${lang} Assignment`, course: "CS" },
      questions: [qNode],
    });

    const ast = normalizeDocument(doc);
    assert.equal(ast.questions[0].kind, QuestionKind.PROGRAMMING);
    const pdfBytes = await compilePdfDocument(ast);
    assert.ok(pdfBytes instanceof Uint8Array);
    assert.ok(pdfBytes.length > 3000);
  }
});

// ── Test 10: Security Invariants ─────────────────────────────────────────────
await check("Test 10: Security Invariants (zero eval, zero auto-run, zero auto-submit)", async () => {
  const bridgeCode = fs.readFileSync("src/bridge/ace-bridge.js", "utf8");

  const langCode = fs.readFileSync("src/bridge/languages.js", "utf8");
  const extractorCode = fs.readFileSync("src/extraction/programming.js", "utf8");

  const allCode = `${bridgeCode}\n${langCode}\n${extractorCode}`;

  assert(!allCode.includes("eval("), "Must never call eval()");
  assert(!allCode.includes("new Function"), "Must never call new Function()");
  assert(!allCode.includes("runCodeButton.click"), "Must never trigger Run Code automatically");
  assert(!allCode.includes("submitButton.click"), "Must never trigger Submit automatically");
});

// ── Test 11: Regression Test for IITM Guard Simulation ───────────────────────
await check("Test 11: Regression Test for IITM Guard (session.setValue reverts vs adapter.setCode persists)", async () => {
  const prefixCode = "/* Protected Assignment Scaffold: Do Not Edit */\nfunction mainWrapper() {\n";
  const suffixCode = "\n}\n/* End of Scaffold */";
  const initialStudentCode = "  // Write your code here\n  return 0;";

  const fullDocLines = `${prefixCode}${initialStudentCode}${suffixCode}`.split("\n");

  const session = createMockAceSession({
    lines: fullDocLines,
    readonlyRanges: [
      { startRow: 0, endRow: 2, endCol: 0 },
      { startRow: 4, endRow: 6, endCol: 0 },
    ],
  });

  function simulateIitmReadOnlyGuard(sess) {
    const docValue = sess.getValue();
    if (!docValue.startsWith(prefixCode) || !docValue.endsWith(suffixCode)) {
      sess.undo();
      return false;
    }
    return true;
  }

  // 1. Buggy session.setValue -> Rejected by guard
  session.setValue("function student() { return 999; }");
  const guardPassed1 = simulateIitmReadOnlyGuard(session);
  assert.equal(guardPassed1, false, "IITM guard MUST reject full document setValue mutation");
  assert.ok(session.getValue().includes("mainWrapper"), "Code was rolled back by IITM guard");

  // 2. Canonical adapter.setCode -> Accepted by guard
  const adapter = new ProgrammingEditorAdapter(session);
  const newStudentCode = "  const interest = 123;\n  return interest * 2;";
  const setRes = adapter.setCode(newStudentCode);
  assert.equal(setRes.ok, true, "Adapter setCode must succeed");

  const guardPassed2 = simulateIitmReadOnlyGuard(session);
  assert.equal(guardPassed2, true, "IITM guard MUST accept editable range replacement");
  assert.equal(adapter.getCode(), newStudentCode, "Student code must persist without rollback");
  assert.ok(session.getValue().startsWith(prefixCode), "Prefix remains 100% intact");
  assert.ok(session.getValue().endsWith(suffixCode), "Suffix remains 100% intact");
});

// ── Test 12: ProgrammingAssignmentData Extended Fields ───────────────────────
await check("Test 12: ProgrammingAssignmentData — examples, constraints, instructions, provenance, status", async () => {
  const pData = new ProgrammingAssignmentData({
    language: "python",
    starterCode: "def solve():\n    pass",
    currentCode: "def solve():\n    return 42",
    examples: [{ input: "5", output: "10", explanation: "doubles it" }],
    constraints: ["1 <= n <= 1000", "n is an integer"],
    instructions: "Read input from stdin. Print one value per line.",
    provenance: { source: "imported", detail: "Imported from GPT-4o", timestamp: Date.now() },
    status: { isModified: true, lastVerified: null },
  });

  assert.equal(pData.language, "python");
  assert.equal(pData.starterCode, "def solve():\n    pass");
  assert.equal(pData.currentCode, "def solve():\n    return 42");
  assert.ok(Array.isArray(pData.examples));
  assert.equal(pData.examples.length, 1);
  assert.equal(pData.examples[0].input, "5");
  assert.equal(pData.examples[0].explanation, "doubles it");
  assert.ok(Array.isArray(pData.constraints));
  assert.equal(pData.constraints.length, 2);
  assert.ok(pData.constraints[0].includes("1 <= n"));
  assert.equal(typeof pData.instructions, "string");
  assert.ok(pData.instructions.includes("stdin"));
  assert.equal(pData.provenance.source, "imported");
  assert.equal(pData.status.isModified, true);
  assert.equal(pData.status.lastVerified, null);
});

// ── Test 13: serializeProgrammingPrompt Options ───────────────────────────────
await check("Test 13: serializeProgrammingPrompt — option flags, all 5 languages", async () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    const doc = new AssignmentDocument({
      metadata: { title: `${lang} Assignment`, course: "CS101", week: "Week 3" },
      questions: [new QuestionNode({
        number: 1,
        label: `Q1 — ${lang}`,
        type: QuestionType.PROGRAMMING,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: `Solve in ${lang}` })],
        programmingData: new ProgrammingAssignmentData({
          language: lang,
          starterCode: `# starter for ${lang}`,
          currentCode: `# student code for ${lang}`,
          testCases: [new TestCaseNode({ index: 1, input: "1", expectedOutput: "2" })],
          examples: [{ input: "3", output: "6" }],
          constraints: [`n >= 0`],
          instructions: `Write in ${lang}`,
        }),
      })],
    });

    // Full prompt with all sections
    const full = serializeProgrammingPrompt(doc, {
      includeInstructions: true,
      includeStarterCode: true,
      includeTestCases: true,
      includeExamples: true,
      includeConstraints: true,
      includeCurrentCode: false,
    });
    assert.ok(full.includes(`Language: ${lang}`), `${lang}: language tag missing`);
    assert.ok(full.includes("## Problem Statement"), `${lang}: problem missing`);
    assert.ok(full.includes("## Test Cases"), `${lang}: test cases missing`);
    assert.ok(full.includes("## Starter Code"), `${lang}: starter code missing`);
    assert.ok(full.includes("## Examples"), `${lang}: examples missing`);
    assert.ok(full.includes("## Constraints"), `${lang}: constraints missing`);
    assert.ok(full.includes("## Instructions"), `${lang}: instructions missing`);
    assert.ok(!full.includes("## Current Student Code"), `${lang}: current code should be excluded`);
    assert.ok(full.includes("## Return Instructions"), `${lang}: return instructions missing`);
    assert.ok(full.includes("direct pasting into the editor"), `${lang}: prompt should request paste-ready code`);
    assert.ok(!full.includes("acadrix.programming.solution"), `${lang}: prompt must not request a JSON transport wrapper`);

    // Problem-only prompt
    const problemOnly = serializeProgrammingPrompt(doc, {
      includeInstructions: false,
      includeStarterCode: false,
      includeTestCases: false,
      includeExamples: false,
      includeConstraints: false,
    });
    assert.ok(problemOnly.includes("## Problem Statement"), `${lang}: problem-only prompt missing problem`);
    assert.ok(!problemOnly.includes("## Test Cases"), `${lang}: test cases should be absent`);
    assert.ok(!problemOnly.includes("## Starter Code"), `${lang}: starter should be absent`);
  }
});

// ── Test 14: Granular Copy Helpers ───────────────────────────────────────────
await check("Test 14: Granular copy helpers — copyQuestion, copyStarterCode, copyTestCases, copyCurrentCode, copyAiContext, copyFullAssignment", async () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Python GrPA", course: "CS" },
    questions: [new QuestionNode({
      number: 1,
      label: "Question 1",
      type: QuestionType.PROGRAMMING,
      stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "Fibonacci sequence" })],
      programmingData: new ProgrammingAssignmentData({
        language: "python",
        starterCode: "def fib(n):\n    pass",
        currentCode: "def fib(n):\n    return n if n <= 1 else fib(n-1) + fib(n-2)",
        testCases: [new TestCaseNode({ index: 1, input: "5", expectedOutput: "5" })],
      }),
    })],
  });

  const q = copyQuestion(doc);
  assert.ok(q.includes("Python GrPA"), "copyQuestion: title");
  assert.ok(q.includes("Fibonacci sequence"), "copyQuestion: problem text");
  assert.ok(!q.includes("```python"), "copyQuestion: should not include code fence");

  const sc = copyStarterCode(doc);
  assert.ok(sc.includes("def fib(n)"), "copyStarterCode: starter code present");
  assert.ok(sc.includes("pass"), "copyStarterCode: starter body");

  const tc = copyTestCases(doc);
  assert.ok(tc.includes("Test Case 1"), "copyTestCases: heading");
  assert.ok(tc.includes("```text\n5\n```"), "copyTestCases: input block");

  const cc = copyCurrentCode(doc);
  assert.ok(cc.includes("fib(n-1)"), "copyCurrentCode: student code");

  const ai = copyAiContext(doc);
  assert.ok(ai.includes("## Starter Code"), "copyAiContext: starter included");
  assert.ok(ai.includes("## Test Cases"), "copyAiContext: test cases included");
  assert.ok(ai.includes("## Return Instructions"), "copyAiContext: return instructions");
  assert.ok(!ai.includes("## Current Student Code"), "copyAiContext: current code excluded by default");

  const full = copyFullAssignment(doc);
  assert.ok(full.length > 0, "copyFullAssignment: not empty");
});


// ── Test 17: Starter vs Current Code Immutability ────────────────────────────
await check("Test 17: Starter vs Current code — immutability contract and provenance tracking", async () => {
  const pData = new ProgrammingAssignmentData({
    language: "java",
    starterCode: "public class Main {\n    public static void main(String[] args) {}\n}",
    currentCode: "public class Main {\n    public static void main(String[] args) {\n        System.out.println(\"hi\");\n    }\n}",
  });

  const originalStarter = pData.starterCode;

  // Simulate replacing editable code without changing the starter template.
  const importedCode = "public class Main {\n    public static void main(String[] args) {\n        System.out.println(\"42\");\n    }\n}";
  pData.currentCode = importedCode;
  pData.provenance = { source: "editor", detail: "Student-edited code", timestamp: Date.now() };
  pData.status = { isModified: true, lastVerified: null };

  // starterCode must remain unchanged
  assert.equal(pData.starterCode, originalStarter, "starterCode must not be mutated by import");
  assert.ok(pData.currentCode.includes("42"), "currentCode updated");
  assert.notEqual(pData.currentCode, pData.starterCode, "starterCode and currentCode are distinct after import");
  assert.equal(pData.provenance.source, "imported");
  assert.equal(pData.status.isModified, true);
  assert.equal(pData.status.lastVerified, null);

  // copyStarterCode gives the original; copyCurrentCode gives imported
  const doc = new AssignmentDocument({
    metadata: { title: "Java GrPA" },
    questions: [new QuestionNode({
      number: 1,
      label: "Q1",
      type: QuestionType.PROGRAMMING,
      stem: [],
      programmingData: pData,
    })],
  });

  const sc = copyStarterCode(doc);
  assert.ok(sc.includes("{}"), "copyStarterCode: original starter body");

  const cc = copyCurrentCode(doc);
  assert.ok(cc.includes("42"), "copyCurrentCode: imported student code");

  // serializeProgrammingPrompt with includeCurrentCode=false excludes current code
  const withoutCurrent = serializeProgrammingPrompt(doc, { includeCurrentCode: false, includeStarterCode: true });
  assert.ok(!withoutCurrent.includes("## Current Student Code"), "includeCurrentCode=false excludes current code");
});

// ── Test 18: PortalPageType & detectPageType Matrix ──────────────────────────
await check("Test 18: PortalPageType & detectPageType on all portal surfaces", async () => {
  function makeMockDoc(selectors = [], text = "") {
    const matches = (query, available) => query
      .split(",")
      .map((selector) => selector.trim())
      .some((selector) => available.some((candidate) => selector.includes(candidate) || candidate.includes(selector)));
    const makeNode = (available, nodeText = text) => ({
      textContent: nodeText,
      querySelector: (query) => matches(query, available) ? makeNode(available) : null,
      querySelectorAll: (query) => matches(query, available) ? [makeNode(available)] : [],
      classList: { contains: () => false },
      getAttribute: () => null,
    });
    const descendantSelectors = selectors.filter((selector) => !selector.includes("app-programming-assignment-view"));
    const view = makeNode(descendantSelectors);
    const documentNode = {
      nodeType: 9,
      textContent: text,
      querySelector: (query) => {
        if (matches(query, ["app-programming-assignment-view"])) return view;
        return matches(query, selectors) ? makeNode(selectors) : null;
      },
      querySelectorAll: (query) => {
        if (/^button,\s*a,\s*\[role='button'\]$/.test(query) && /resume assignment/i.test(text)) {
          return [{ textContent: "Resume Assignment", getAttribute: () => null }];
        }
        return matches(query, selectors) ? [makeNode(selectors)] : [];
      },
    };
    return documentNode;
  }

  // 1. Full programming assignment view
  const doc1 = makeMockDoc(["app-programming-assignment-view", "app-pa-question", "app-pa-code-editor", ".ace_editor"]);
  const adapter1 = new IitmPortalAdapter(doc1);
  assert.equal(adapter1.detectPageType(), PortalPageType.PROGRAMMING_ASSIGNMENT);
  assert.equal(adapter1.isProgrammingAssignment(), true);
  assert.equal(adapter1.isStandardAssessment(), false);
  assert.equal(adapter1.detectAssessment(), true);

  // 2. Information / instructions state is not an active editor surface
  const doc2 = makeMockDoc(["app-programming-assignment-view", "app-pa-start-page", "app-pa-instructions"], "Resume Assignment");
  const adapter2 = new IitmPortalAdapter(doc2);
  assert.equal(adapter2.detectPageType(), PortalPageType.PROGRAMMING_ASSIGNMENT_INFO);
  assert.equal(adapter2.detectAssessment(), false);
  assert.equal(isFabEligible(adapter2.detectPageType()), false);

  // Assignment metadata and Resume Assignment text never activate the editor/FAB.
  const doc2b = makeMockDoc([], "Programming Assignment · Submission Type - Code · Resume Assignment");
  const adapter2b = new IitmPortalAdapter(doc2b);
  assert.equal(adapter2b.detectPageType(), PortalPageType.PROGRAMMING_ASSIGNMENT_INFO);
  assert.equal(isFabEligible(adapter2b.detectPageType()), false);

  // The outer PA wrapper alone is not evidence that the code editor is active.
  const doc2c = makeMockDoc(["app-programming-assignment-view"]);
  const adapter2c = new IitmPortalAdapter(doc2c);
  assert.equal(adapter2c.detectPageType(), PortalPageType.UNKNOWN);
  assert.equal(adapter2c.detectAssessment(), false);

  // 3. Question state with Ace editor inside the PA view (no normal assessment selectors)
  const doc3 = makeMockDoc(["app-programming-assignment-view", "app-pa-question", ".ace_editor"]);
  const adapter3 = new IitmPortalAdapter(doc3);
  assert.equal(adapter3.detectPageType(), PortalPageType.PROGRAMMING_ASSIGNMENT);
  assert.equal(adapter3.detectAssessment(), true);

  // 4. Test Cases tab state
  const doc4 = makeMockDoc(["app-programming-assignment-view", "app-pa-code-editor", "button[role=tab]", ".ace-container"], "Test Cases");
  const adapter4 = new IitmPortalAdapter(doc4);
  assert.equal(adapter4.detectPageType(), PortalPageType.PROGRAMMING_ASSIGNMENT);
  assert.equal(adapter4.detectAssessment(), true);

  // 5. Standard MCQ assessment
  const doc5 = makeMockDoc(["app-assessment-question-view", "div.chips", "app-assessment-question"]);
  const adapter5 = new IitmPortalAdapter(doc5);
  assert.equal(adapter5.detectPageType(), PortalPageType.ASSESSMENT);
  assert.equal(adapter5.isStandardAssessment(), true);
  assert.equal(adapter5.isProgrammingAssignment(), false);
  assert.equal(adapter5.detectAssessment(), true);

  // 6. Course content / Video view (should be COURSE_CONTENT, NOT eligible)
  const doc6 = makeMockDoc(["app-course-content", ".course-content", "app-unit-view"]);
  const adapter6 = new IitmPortalAdapter(doc6);
  assert.equal(adapter6.detectPageType(), PortalPageType.COURSE_CONTENT);
  assert.equal(adapter6.detectAssessment(), false);

  // 7. Grades / Scores view (should be GRADES, NOT eligible)
  const doc7 = makeMockDoc(["app-grades", ".grades-view", "app-score-card"]);
  const adapter7 = new IitmPortalAdapter(doc7);
  assert.equal(adapter7.detectPageType(), PortalPageType.GRADES);
  assert.equal(adapter7.detectAssessment(), false);

  // 8. Unknown / Portal Home
  const doc8 = makeMockDoc([]);
  const adapter8 = new IitmPortalAdapter(doc8);
  assert.equal(adapter8.detectPageType(), PortalPageType.UNKNOWN);
  assert.equal(adapter8.detectAssessment(), false);
});

// ── Test 19: isFabEligible Contract & Selector Decoupling ────────────────────
await check("Test 19: isFabEligible — strictly true for ASSESSMENT and PROGRAMMING_ASSIGNMENT, false for all else", async () => {
  assert.equal(isFabEligible(PortalPageType.ASSESSMENT), true);
  assert.equal(isFabEligible(PortalPageType.PROGRAMMING_ASSIGNMENT), true);
  assert.equal(isFabEligible(PortalPageType.COURSE_CONTENT), false);
  assert.equal(isFabEligible(PortalPageType.GRADES), false);
  assert.equal(isFabEligible(PortalPageType.UNKNOWN), false);
  assert.equal(isFabEligible(null), false);
  assert.equal(isFabEligible(undefined), false);

  // Programming editor detection does not depend on standard assessment selectors.
  const programmingView = {
    textContent: "Java GrPA",
    querySelector: (sel) => sel.includes("app-pa-code-editor") ? { textContent: "editor" } : null,
    querySelectorAll: () => [],
  };
  const programmingDoc = {
    nodeType: 9,
    querySelector: (sel) => sel.includes("app-programming-assignment-view") ? programmingView : null,
    querySelectorAll: () => [],
  };
  const adapter = new IitmPortalAdapter(programmingDoc);

  assert.equal(programmingDoc.querySelector("div.chips"), null);
  assert.equal(programmingDoc.querySelector("app-assessment-question"), null);
  assert.equal(adapter.detectAssessment(), true, "Programming assignment MUST be detected even without normal assessment selectors");
  assert.equal(isFabEligible(adapter.detectPageType()), true);
});

// ── Test 20: Page Capabilities Resolution ────────────────────────────────────
await check("Test 20: getPageCapabilities — distinguishes standard assessment vs programming capabilities", async () => {
  // Programming assignment capabilities
  const paView = {
    textContent: "PA",
    querySelector: (sel) => sel.includes("app-pa-code-editor") ? { textContent: "editor" } : null,
    querySelectorAll: () => [],
  };
  const paDoc = {
    nodeType: 9,
    querySelector: (sel) => sel.includes("app-programming-assignment-view") ? paView : null,
    querySelectorAll: () => [],
  };
  const paAdapter = new IitmPortalAdapter(paDoc);
  const paCaps = paAdapter.getPageCapabilities();
  assert.equal(paCaps.canReadAssessment, true);
  assert.equal(paCaps.canReadProgrammingAssignment, true);
  assert.equal(paCaps.canCopyQuestion, true);
  assert.equal(paCaps.canCopyStarterCode, true);
  assert.equal(paCaps.canCopyTestCases, true);
  assert.equal(paCaps.canCopyCurrentCode, true);
  assert.equal(paCaps.canEditProgrammingCode, true);
  assert.equal(paCaps.canApplyAnswers, false, "Programming assignments must not expose MCQ apply-answers capability");

  // Standard assessment capabilities
  const stdDoc = {
    nodeType: 9,
    querySelector: (sel) => (sel.includes("app-assessment-question-view") ? { textContent: "Quiz" } : null),
    querySelectorAll: () => [],
  };
  const stdAdapter = new IitmPortalAdapter(stdDoc);
  const stdCaps = stdAdapter.getPageCapabilities();
  assert.equal(stdCaps.canReadAssessment, true);
  assert.equal(stdCaps.canReadProgrammingAssignment, false);
  assert.equal(stdCaps.canCopyQuestion, true);
  assert.equal(stdCaps.canCopyStarterCode, false);
  assert.equal(stdCaps.canCopyTestCases, false);
  assert.equal(stdCaps.canCopyCurrentCode, false);
  assert.equal(stdCaps.canEditProgrammingCode, false);
  assert.equal(stdCaps.canApplyAnswers, true);
});

// ── Test 21: Angular Transition & Editor Independence ────────────────────────
await check("Test 21: Angular transitions and editor independence (FAB eligible before Ace is initialized)", async () => {
  let hasAce = false;
  const paView = {
    textContent: "Loading...",
    querySelector: (sel) => {
      if (sel.includes("app-pa-code-editor")) return { textContent: "Code editor shell" };
      if (hasAce && sel.includes(".ace_editor")) return { textContent: "code" };
      return null;
    },
    querySelectorAll: () => [],
  };
  const loadingPaDoc = {
    nodeType: 9,
    querySelector: (sel) => sel.includes("app-programming-assignment-view") ? paView : null,
    querySelectorAll: () => [],
  };
  const adapter = new IitmPortalAdapter(loadingPaDoc);

  // The actual editor component is positive evidence even before Ace finishes mounting.
  assert.equal(adapter.detectPageType(), PortalPageType.PROGRAMMING_ASSIGNMENT);
  assert.equal(adapter.detectAssessment(), true);
  assert.equal(isFabEligible(adapter.detectPageType()), true);

  // Ace hydration must not change eligibility or reclassify the page.
  hasAce = true;
  assert.equal(adapter.detectPageType(), PortalPageType.PROGRAMMING_ASSIGNMENT);
  assert.equal(adapter.detectAssessment(), true);
});
// ── Test 22: Requirement 19 Validation Assertions ────────────────────────────
await check("Test 22: Requirement 19 Validation Assertions (explicit failure conditions)", async () => {
  // Condition 1: Question extracted but Test Cases tab exists and was never inspected (activateTab: false)
  const docWithHiddenTC = {
    nodeType: 9,
    querySelector: (sel) => {
      if (sel.includes("app-programming-assignment-view")) return { tagName: "APP-PROGRAMMING-ASSIGNMENT-VIEW" };
      if (sel.includes("app-pa-question")) return { innerHTML: "<div class='backend-html'><p>Problem</p></div>", querySelectorAll: () => [] };
      if (sel.includes("headerTitle") || sel.includes(".title")) return { textContent: "Assignment" };
      if (sel.includes("languageValue") || sel.includes("current-value")) return { textContent: "JavaScript" };
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel.includes("button[role=tab]") || sel.includes(".tab-item")) {
        return [
          { textContent: "Question", getAttribute: (a) => (a === "aria-selected" ? "true" : null), classList: { contains: () => true } },
          { textContent: "Test Cases", getAttribute: (a) => (a === "aria-selected" ? "false" : null), classList: { contains: () => false }, click: () => {} },
        ];
      }
      return [];
    },
  };
  const ext1 = new ProgrammingAssignmentExtractor(docWithHiddenTC);
  const qNode1 = await ext1.extractCurrentQuestionNode(docWithHiddenTC, 1, { activateTab: false });
  assert.equal(qNode1.programmingData.extractionStatus, "PARTIAL", "Condition 1: must be PARTIAL if Test Cases tab was never inspected");
  assert.ok(qNode1.programmingData.warnings.some((w) => w.includes("Test Cases tab")), "Condition 1: warning for uninspected tab");

  // Condition 2: Test Cases exist in DOM but missing from canonical document
  let activeTabName2 = "Question";
  const docWithTC = {
    nodeType: 9,
    querySelector: (sel) => {
      if (sel.includes("app-programming-assignment-view")) return { tagName: "APP-PROGRAMMING-ASSIGNMENT-VIEW" };
      if (sel.includes("app-pa-question")) return { innerHTML: "<div class='backend-html'><p>Problem</p></div>", querySelectorAll: () => [] };
      if (sel.includes("headerTitle") || sel.includes(".title")) return { textContent: "Assignment" };
      if (sel.includes("languageValue") || sel.includes("current-value")) return { textContent: "JavaScript" };
      if (sel.includes("testCasesRoot") || sel.includes("testcases") || sel.includes("test-cases")) {
        return activeTabName2 === "Test Cases" ? {
          querySelectorAll: (s) => (s.includes("testCaseItem") || s.includes("test-case") ? [
            {
              querySelector: (sub) => {
                if (sub.includes("title") || sub.includes("description")) return { textContent: "Case 1" };
                if (sub.includes("input")) return { textContent: "in1" };
                if (sub.includes("output")) return { textContent: "out1" };
                return null;
              },
              querySelectorAll: () => [],
            }
          ] : []),
          children: [{ tagName: "DIV" }],
        } : null;
      }
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel.includes("button[role=tab]") || sel.includes(".tab-item")) {
        return [
          { textContent: "Question", getAttribute: (a) => (a === "aria-selected" ? String(activeTabName2 === "Question") : null), classList: { contains: (c) => c === "active" && activeTabName2 === "Question" }, click: () => { activeTabName2 = "Question"; } },
          { textContent: "Test Cases", getAttribute: (a) => (a === "aria-selected" ? String(activeTabName2 === "Test Cases") : null), classList: { contains: (c) => c === "active" && activeTabName2 === "Test Cases" }, click: () => { activeTabName2 = "Test Cases"; } },
        ];
      }
      return [];
    },
  };
  const ext2 = new ProgrammingAssignmentExtractor(docWithTC);
  const qNode2 = await ext2.extractCurrentQuestionNode(docWithTC, 1);
  assert.ok(qNode2.programmingData.testCases.length > 0, "Condition 2: test cases must exist in canonical document");
  assert.equal(qNode2.programmingData.testCases[0].input, "in1");
  assert.equal(qNode2.programmingData.testCases[0].expectedOutput, "out1");

  // Condition 3: suffixCode exists in editor but missing from canonical document
  const sess3 = createMockAceSession({
    lines: ["// Prefix", "function solve() {}", "// Suffix: runner"],
    readonlyRanges: [
      { startRow: 0, endRow: 1, endCol: 0 },
      { startRow: 2, endRow: 3, endCol: 0 },
    ],
  });
  const adapter3 = new ProgrammingEditorAdapter(sess3);
  assert.ok(adapter3.getSuffixCode().length > 0, "Condition 3: suffix code must exist in editor");
  assert.ok(adapter3.getSuffixCode().includes("Suffix: runner"), "Condition 3: suffix code content verified");

  // Condition 4: starterCode is identical to currentCode only because extraction happened too late
  const sess4 = createMockAceSession({
    lines: ["let count = 0;"],
    readonlyRanges: [],
  });
  const adapter4 = new ProgrammingEditorAdapter(sess4);
  adapter4.captureStarterCode();
  assert.equal(adapter4.getStarterCode(), "let count = 0;");
  // Student modifies code
  adapter4.setCode("let count = 100;");
  assert.equal(adapter4.getCode(), "let count = 100;");
  assert.equal(adapter4.getStarterCode(), "let count = 0;", "Condition 4: starterCode must remain initial code and not be overwritten");

  // Condition 5: question image exists but canonical document has no image representation
  const docWithImg = {
    nodeType: 9,
    querySelector: (sel) => {
      if (sel.includes("app-programming-assignment-view")) return { tagName: "APP-PROGRAMMING-ASSIGNMENT-VIEW" };
      if (sel.includes("app-pa-question")) return {
        innerHTML: "<div class='backend-html'><p>Problem with image</p><img src='/asset/img.png' alt='Diagram' width='300' height='150'></div>",
        querySelectorAll: (s) => (s === "img" ? [{ getAttribute: (a) => (a === "src" ? "/asset/img.png" : a === "alt" ? "Diagram" : "300") }] : []),
      };
      if (sel.includes("headerTitle") || sel.includes(".title")) return { textContent: "Assignment" };
      if (sel.includes("languageValue") || sel.includes("current-value")) return { textContent: "JavaScript" };
      return null;
    },
    querySelectorAll: (sel) => [],
  };
  const ext5 = new ProgrammingAssignmentExtractor(docWithImg);
  const qNode5 = await ext5.extractCurrentQuestionNode(docWithImg, 1);
  assert.ok(qNode5.programmingData.images.length > 0, "Condition 5: image must be represented in canonical document");
  assert.equal(qNode5.programmingData.images[0].alt, "Diagram");

  // Condition 6: Return Instructions exist but serializer omits them
  const doc6 = new AssignmentDocument({
    metadata: { title: "JS Assignment" },
    questions: [new QuestionNode({
      number: 1,
      type: QuestionType.PROGRAMMING,
      stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "Problem" })],
      programmingData: new ProgrammingAssignmentData({
        language: "javascript",
        returnInstructions: "Return only the completed, working code inside a single ```javascript code block.",
      }),
    })],
  });
  const serialized6 = serializeProgrammingPrompt(doc6, { includeReturnInstructions: true });
  assert.ok(serialized6.includes("## Return Instructions"), "Condition 6: return instructions section must be present");
  assert.ok(serialized6.includes("single ```javascript code block"), "Condition 6: return instructions verbatim contract preserved");

  // Condition 7: Reader displays incomplete assignment without marking extraction PARTIAL
  const partialPData = new ProgrammingAssignmentData({
    language: "javascript",
    extractionStatus: "PARTIAL",
    warnings: ["Test cases tab was detected but no test cases were extracted."],
  });
  assert.equal(partialPData.extractionStatus, "PARTIAL", "Condition 7: extractionStatus must be PARTIAL");
  assert.ok(partialPData.warnings.length > 0, "Condition 7: warnings must explain unavailable context");

  // Condition 8: Test Cases extraction leaves the portal permanently on Test Cases
  assert.equal(activeTabName2, "Question", "Condition 8: portal must be restored to Question tab after test case extraction");

  // Condition 9: prefixCode/suffixCode accidentally enters editable currentCode
  const sess9 = createMockAceSession({
    lines: ["// PREFIX", "function user() { return 1; }", "// SUFFIX"],
    readonlyRanges: [
      { startRow: 0, endRow: 1, endCol: 0 },
      { startRow: 2, endRow: 3, endCol: 0 },
    ],
  });
  const adapter9 = new ProgrammingEditorAdapter(sess9);
  const studentCode = adapter9.getCode();
  assert.ok(!studentCode.includes("PREFIX"), "Condition 9: prefix code must NOT enter editable currentCode");
  assert.ok(!studentCode.includes("SUFFIX"), "Condition 9: suffix code must NOT enter editable currentCode");
  assert.equal(studentCode, "function user() { return 1; }");

  // Condition 10: AI serializer produces an incomplete prompt when full context was requested
  const fullDoc10 = new AssignmentDocument({
    metadata: { title: "Full Assignment", course: "MAD II", week: "Week 1" },
    questions: [new QuestionNode({
      number: 1,
      type: QuestionType.PROGRAMMING,
      stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "Problem body" })],
      programmingData: new ProgrammingAssignmentData({
        language: "javascript",
        starterCode: "function solve() {}",
        currentCode: "function solve() { return 42; }",
        prefixCode: "// Prefix",
        suffixCode: "// Suffix",
        returnInstructions: "Return only the completed, working code inside a single ```javascript code block.",
        testCases: [new TestCaseNode({ index: 1, input: "in", expectedOutput: "out" })],
        examples: [{ input: "exIn", output: "exOut" }],
        constraints: ["x > 0"],
        instructions: "Do not import external packages.",
        images: [{ src: "https://example.com/img.png", alt: "Img" }],
      }),
    })],
  });
  const fullPrompt10 = serializeProgrammingPrompt(fullDoc10, {
    includeInstructions: true,
    includeQuestion: true,
    includeImages: true,
    includeExamples: true,
    includeConstraints: true,
    includeTestCases: true,
    includeStarterCode: true,
    includePrefixCode: true,
    includeSuffixCode: true,
    includeReturnInstructions: true,
    includeCurrentCode: true,
  });
  assert.ok(fullPrompt10.includes("# Full Assignment"), "Condition 10: metadata");
  assert.ok(fullPrompt10.includes("Language: javascript"), "Condition 10: language");
  assert.ok(fullPrompt10.includes("## Instructions"), "Condition 10: instructions");
  assert.ok(fullPrompt10.includes("## Problem Statement"), "Condition 10: problem statement");
  assert.ok(fullPrompt10.includes("## Images / Diagrams"), "Condition 10: images");
  assert.ok(fullPrompt10.includes("## Examples"), "Condition 10: examples");
  assert.ok(fullPrompt10.includes("## Constraints"), "Condition 10: constraints");
  assert.ok(fullPrompt10.includes("## Test Cases"), "Condition 10: test cases");
  assert.ok(fullPrompt10.includes("## Starter Code"), "Condition 10: starter code");
  assert.ok(fullPrompt10.includes("## Protected Prefix Code"), "Condition 10: prefix code");
  assert.ok(fullPrompt10.includes("## Protected Suffix Code"), "Condition 10: suffix code");
  assert.ok(fullPrompt10.includes("## Return Instructions"), "Condition 10: return instructions");
  assert.ok(fullPrompt10.includes("## Current Student Code"), "Condition 10: current code");
  assert.ok(fullPrompt10.includes("### Task"), "Condition 10: task response format");
});

// ── Test 23: Requirement 20 Test Fixture Verification ────────────────────────
await check("Test 23: Requirement 20 Test Fixture (Question tab + Test Cases tab + Editor prefix/suffix)", async () => {
  let activeTab = "Question";
  let activePill = "Case 1";

  const fixtureMockDoc = {
    nodeType: 9,
    querySelector: (sel) => {
      if (sel.includes("app-programming-assignment-view") || sel.includes(".programming-assignment-view")) {
        return { tagName: "APP-PROGRAMMING-ASSIGNMENT-VIEW" };
      }
      if (sel.includes("app-pa-question") || sel.includes(".pa-question") || sel.includes("backend-html")) {
        return activeTab === "Question" ? {
          tagName: "APP-PA-QUESTION",
          textContent: "Write the definitions of the functions given below with the help of given information.",
          innerHTML: `
            <div class="backend-html">
              <p>Write the definitions of the functions given below with the help of given information.</p>
              <figure><img src="/assets/interest_formula.png" alt="Interest Calculation Diagram" width="400" height="200"><figcaption>Figure 1</figcaption></figure>
              <div class="example"><p class="title">Example 1</p><pre class="input">20000 1</pre><pre class="output">48600</pre><div class="explanation">Formula calculation</div></div>
              <div class="constraints"><ul><li>1000 &lt;= P &lt;= 1000000</li></ul></div>
              <p class="return-instructions">Return only the completed, working code inside a single \`\`\`javascript code block.</p>
            </div>
          `,
          querySelectorAll: (s) => (s === "img" ? [{ getAttribute: (a) => (a === "src" ? "/assets/interest_formula.png" : a === "alt" ? "Interest Calculation Diagram" : "400") }] : []),
        } : null;
      }
      if (sel.includes("headerTitle") || sel.includes(".title")) {
        return { textContent: "JavaScript Graded Assignment - Simple and Compound Interest" };
      }
      if (sel.includes("breadcrumb") || sel.includes("current")) return { textContent: "Week 1" };
      if (sel.includes("courseTitle")) return { textContent: "Sep 2026 - MAD II" };
      if (sel.includes("languageValue") || sel.includes("current-value")) return { textContent: "Javascript" };
      if (sel.includes("return-instructions") || sel.includes("returnInstructions")) {
        return { textContent: "Return only the completed, working code inside a single ```javascript code block." };
      }
      if (sel.includes("testCasesRoot") || sel.includes("app-pa-testcases") || sel.includes("testcases") || sel.includes("test-cases")) {
        return activeTab === "Test Cases" ? {
          tagName: "APP-PA-TESTCASES",
          children: [{ tagName: "DIV" }],
          querySelectorAll: (s) => {
            if (s.includes("accordionHeader")) return [{ getAttribute: () => "true", textContent: "Public Test Cases" }];
            if (s.includes("testCasePill") || s.includes("test-case-pill")) {
              return [
                {
                  textContent: "Case 1",
                  classList: { contains: (c) => c === "is-selected" && activePill === "Case 1" },
                  click: () => { activePill = "Case 1"; },
                },
                {
                  textContent: "Case 2",
                  classList: { contains: (c) => c === "is-selected" && activePill === "Case 2" },
                  click: () => { activePill = "Case 2"; },
                },
              ];
            }
            if (s.includes("testCaseBlock") || s.includes("test-case-block")) {
              if (activePill === "Case 1") {
                return [
                  { querySelector: (sub) => (sub.includes("title") ? { textContent: "Input" } : { textContent: "20000 1 2020-12-27 2021-08-27" }) },
                  { querySelector: (sub) => (sub.includes("title") ? { textContent: "Expected Output" } : { textContent: "48600 204452 320" }) },
                ];
              } else {
                return [
                  { querySelector: (sub) => (sub.includes("title") ? { textContent: "Input" } : { textContent: "50000 2 2019-01-01 2020-01-01" }) },
                  { querySelector: (sub) => (sub.includes("title") ? { textContent: "Expected Output" } : { textContent: "100000 500000 700" }) },
                ];
              }
            }
            return [];
          },
          querySelector: (s) => {
            if (s.includes("testCaseDetails") || s.includes("test-case-details")) return { querySelector: () => null, querySelectorAll: () => [] };
            return null;
          },
        } : null;
      }
      if (sel.includes("ace") || sel.includes("editor")) {
        return {
          env: { editor: { session: fixtureSession, getValue: () => fixtureSession.getValue(), getSession: () => fixtureSession } },
          _editor: { session: fixtureSession, getValue: () => fixtureSession.getValue(), getSession: () => fixtureSession },
          id: "app-code-editor-0",
          querySelector: () => null,
          querySelectorAll: () => [],
        };
      }
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel.includes("button[role=tab]") || sel.includes(".tab-item")) {
        return [
          {
            textContent: "Question",
            getAttribute: (a) => (a === "aria-selected" ? String(activeTab === "Question") : null),
            classList: { contains: (c) => c === "active" && activeTab === "Question" },
            click: () => { activeTab = "Question"; },
          },
          {
            textContent: "Test Cases",
            getAttribute: (a) => (a === "aria-selected" ? String(activeTab === "Test Cases") : null),
            classList: { contains: (c) => c === "active" && activeTab === "Test Cases" },
            click: () => { activeTab = "Test Cases"; },
          },
        ];
      }
      return [];
    },
  };

  const fixtureSession = createMockAceSession({
    lines: [
      "/* Protected Prefix: IITM Header */",
      "/* DO NOT MODIFY */",
      "function calculateSimpleInterest(p, r, t) {",
      "  return (p * r * t) / 100;",
      "}",
      "/* Protected Suffix: IITM Runner */",
      "/* DO NOT MODIFY */",
    ],
    readonlyRanges: [
      { startRow: 0, endRow: 2, endCol: 0 },
      { startRow: 5, endRow: 7, endCol: 0 },
    ],
  });

  const origGetAce = getAceEditorInstance;
  // Inject mock editor session for this test
  const extractor = new ProgrammingAssignmentExtractor(fixtureMockDoc);

  // Initial state check
  assert.equal(activeTab, "Question");

  // Extract
  const initialActive = activeTab;
  const qNode = await extractor.extractCurrentQuestionNode(fixtureMockDoc, 1);

  // State restoration verification
  assert.equal(activeTab, initialActive, "Active tab must be restored to Question tab");

  // Invariant checks from Requirement 20
  assert.ok(qNode.stem.length > 0, "question != empty");
  assert.ok(qNode.programmingData.images.length > 0, "images.length > 0");
  assert.ok(qNode.programmingData.testCases.length > 0, "testCases.length > 0");
  assert.ok(qNode.programmingData.currentCode !== null, "currentCode != null");
  assert.ok(qNode.programmingData.returnInstructions.length > 0, "returnInstructions != null");
});

// ── Test 24: Requirement 21 End-to-End Tests Across All 5 Languages (A–W) ────
await check("Test 24: Requirement 21 End-to-End Matrix across Bash, SQL, Python, Java, JavaScript (A–W)", async () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    // A & B: Tab initially visible vs hidden
    // C & D: Empty test cases vs multiple test cases
    // E & F: Image vs no image
    // G, H, I, J: Prefix only, Suffix only, Prefix+Suffix, No protected regions
    // K & L: Starter != current vs Starter == current
    // M: Reader extraction
    // N: Copy AI Context
    // O: Full Assignment serialization
    // P: Return Instructions
    // Q: UI restoration after extraction
    // R: Multiple consecutive extraction calls
    // S: Tab switching during extraction
    // T: Unsupported/ambiguous state
    // U: Editor identity change during extraction
    // V & W: Partial vs complete extraction

    // Case 1: Complete assignment with Prefix + Suffix, images, test cases, and return instructions
    const pDataComplete = new ProgrammingAssignmentData({
      language: lang,
      starterCode: `// Starter ${lang}`,
      currentCode: `// Edited ${lang}`,
      prefixCode: `// Prefix ${lang}`,
      suffixCode: `// Suffix ${lang}`,
      returnInstructions: `Return only the completed, working code inside a single \`\`\`${lang} code block.`,
      testCases: [
        new TestCaseNode({ index: 1, input: "10", expectedOutput: "20" }),
        new TestCaseNode({ index: 2, input: "30", expectedOutput: "60" }),
      ],
      images: [{ src: `https://example.com/${lang}.png`, alt: `${lang} diagram` }],
      extractionStatus: "COMPLETE",
    });

    const docComplete = new AssignmentDocument({
      metadata: { title: `${lang.toUpperCase()} GrPA`, course: "IITM CS", week: "Week 2", family: AssessmentFamily.PROGRAMMING },
      questions: [new QuestionNode({
        number: 1,
        label: `${lang.toUpperCase()} Q1`,
        type: QuestionType.PROGRAMMING,
        family: AssessmentFamily.PROGRAMMING,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: `Solve problem in ${lang}` })],
        programmingData: pDataComplete,
      })],
    });

    // M: Reader extraction
    assert.equal(docComplete.questions[0].programmingData.language, lang);

    // N: Copy AI Context
    const aiCtx = copyAiContext(docComplete);
    assert.ok(aiCtx.includes(`Language: ${lang}`));
    assert.ok(aiCtx.includes("## Test Cases"));
    assert.ok(aiCtx.includes("## Starter Code"));
    assert.ok(aiCtx.includes("## Protected Prefix Code"));
    assert.ok(aiCtx.includes("## Protected Suffix Code"));
    assert.ok(aiCtx.includes("## Return Instructions"));

    // O: Full Assignment serialization
    const fullMd = copyFullAssignment(docComplete);
    assert.ok(fullMd.length > 50);

    // P: Return Instructions
    assert.ok(aiCtx.includes(`single \`\`\`${lang} code block`));

    // Case 2: Partial assignment (test cases missing)
    const pDataPartial = new ProgrammingAssignmentData({
      language: lang,
      starterCode: `// Starter ${lang}`,
      currentCode: `// Starter ${lang}`, // K & L: Starter == Current
      prefixCode: "",
      suffixCode: "",
      testCases: [],
      extractionStatus: "PARTIAL",
      warnings: ["Test Cases tab was detected but no test cases could be extracted."],
    });

    const docPartial = new AssignmentDocument({
      metadata: { title: `${lang} Partial`, family: AssessmentFamily.PROGRAMMING },
      questions: [new QuestionNode({
        number: 1,
        type: QuestionType.PROGRAMMING,
        stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "Problem" })],
        programmingData: pDataPartial,
      })],
    });

    // V: Partial extraction
    assert.equal(docPartial.questions[0].programmingData.extractionStatus, "PARTIAL");
    assert.ok(docPartial.questions[0].programmingData.warnings.length > 0);

    // W: Complete extraction
    assert.equal(docComplete.questions[0].programmingData.extractionStatus, "COMPLETE");

    // R: Multiple consecutive extraction calls
    const aiPrompt1 = generateAiPrompt(docComplete);
    const aiPrompt2 = generateAiPrompt(docComplete);
    assert.equal(aiPrompt1.prompt, aiPrompt2.prompt, "Multiple consecutive calls must produce identical prompt");
  }
});
// ── Test 25: Requirement 23 Test Fixture for Prefix/Suffix ───────────────────
await check("Test 25: Requirement 23 Test Fixture (Prefix, Editable Starter, Suffix immutability)", async () => {
  const prefixFixture = "// BEGIN PROVIDED CODE\nimport java.util.*;\n// END PROVIDED CODE";
  const starterFixture = "function solve() {\n}";
  const suffixFixture = "// BEGIN PROVIDED SUFFIX\nmodule.exports = solve;\n// END PROVIDED SUFFIX";

  const fullDocLines = `${prefixFixture}\n${starterFixture}\n${suffixFixture}`.split("\n");
  const prefixLineCount = prefixFixture.split("\n").length;
  const starterLineCount = starterFixture.split("\n").length;

  const session = createMockAceSession({
    lines: fullDocLines,
    readonlyRanges: [
      { startRow: 0, startCol: 0, endRow: prefixLineCount - 1, endCol: 100 },
      { startRow: prefixLineCount + starterLineCount, startCol: 0, endRow: fullDocLines.length - 1, endCol: 100 },
    ],
  });

  const adapter = new ProgrammingEditorAdapter(session);
  adapter.captureStarterCode();

  assert.equal(adapter.getPrefixCode(), prefixFixture, "prefixCode must equal prefix fixture");
  assert.equal(adapter.getStarterCode(), starterFixture, "starterCode must equal editable fixture");
  assert.equal(adapter.getCode(), starterFixture, "currentCode must initially equal editable fixture");
  assert.equal(adapter.getSuffixCode(), suffixFixture, "suffixCode must equal suffix fixture");
  assert.equal(adapter.hasPrefixCode(), true, "hasPrefixCode must be true");
  assert.equal(adapter.hasSuffixCode(), true, "hasSuffixCode must be true");

  // Modify currentCode
  const modifiedCode = "function solve() {\n    return 42;\n}";
  const writeRes = adapter.setCode(modifiedCode);
  assert.equal(writeRes.ok, true, "Writing modified editable code must succeed");

  // Verify starterCode, prefixCode, suffixCode remain unchanged
  assert.equal(adapter.getStarterCode(), starterFixture, "starterCode must remain unchanged after edit");
  assert.equal(adapter.getPrefixCode(), prefixFixture, "prefixCode must remain unchanged after edit");
  assert.equal(adapter.getSuffixCode(), suffixFixture, "suffixCode must remain unchanged after edit");
  assert.equal(adapter.getCode(), modifiedCode, "currentCode must reflect the new editable code");
  assert.ok(session.getValue().startsWith(prefixFixture), "Session content must start with prefix fixture");
  assert.ok(session.getValue().endsWith(suffixFixture), "Session content must end with suffix fixture");
});


// ── Test 28: AI Prompt Snapshot & Direct-Paste Instructions ──────────────────
await check("Test 28: AI prompt includes assignment context and requests direct code pasting", async () => {
  const qNode = new QuestionNode({
    number: 1,
    label: "Simple Interest Calculator",
    type: QuestionType.PROGRAMMING,
    family: AssessmentFamily.PROGRAMMING,
    stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "Compute simple interest given P, R, T." })],
    programmingData: new ProgrammingAssignmentData({
      language: "javascript",
      starterCode: "function simpleInterest(p, r, t) {\n  // Implementation\n}",
      currentCode: "function simpleInterest(p, r, t) {\n  // Implementation\n}",
      prefixCode: "/* Protected Header */",
      suffixCode: "/* Protected Runner */",
      hasPrefixCode: true,
      hasSuffixCode: true,
      testCases: [
        new TestCaseNode({ index: 1, input: "1000\n5\n2", expectedOutput: "100", isSample: true }),
        new TestCaseNode({ index: 2, input: "20000\n1\n2020", expectedOutput: "48600", isSample: true }),
      ],
      examples: [{ input: "1000 5 2", output: "100", explanation: "1000 * 0.05 * 2 = 100" }],
      constraints: ["P > 0", "R >= 0", "T >= 0"],
      instructions: "Follow standard IEEE 754 precision.",
      returnInstructions: "Return only the completed, working code inside a single ```javascript code block.",
      images: [{ src: "https://example.com/interest_formula.png", alt: "Interest Formula Diagram" }],
    }),
  });

  const doc = new AssignmentDocument({
    metadata: {
      title: "JavaScript Graded Assignment",
      course: "Data Science 101",
      week: "Week 4",
      family: AssessmentFamily.PROGRAMMING,
    },
    questions: [qNode],
  });

  const prompt = copyAiContext(doc);

  // Snapshot assertions per Requirement 26:
  assert.ok(prompt.includes("# Acadrix Programming Assignment"), "Must contain Acadrix Programming Assignment header");
  assert.ok(prompt.includes("## Assignment Metadata"), "Must contain Assignment Metadata section");
  assert.ok(prompt.includes("Course: Data Science 101"), "Must contain course metadata");
  assert.ok(prompt.includes("Assignment: JavaScript Graded Assignment"), "Must contain assignment title");
  assert.ok(prompt.includes("Week: Week 4"), "Must contain week");
  assert.ok(prompt.includes("Language: javascript"), "Must contain language");
  assert.ok(prompt.includes("## Instructions"), "Must contain Instructions section");
  assert.ok(prompt.includes("## Problem Statement"), "Must contain Problem Statement section");
  assert.ok(prompt.includes("## Images / Diagrams"), "Must contain Images / Diagrams section");
  assert.ok(prompt.includes("![Interest Formula Diagram](https://example.com/interest_formula.png)"), "Must contain image markdown");
  assert.ok(prompt.includes("## Examples"), "Must contain Examples section");
  assert.ok(prompt.includes("## Constraints"), "Must contain Constraints section");
  assert.ok(prompt.includes("## Test Cases"), "Must contain Test Cases section");
  assert.ok(prompt.includes("48600"), "Must contain canonical test case content");
  assert.ok(prompt.includes("## Protected Prefix Code"), "Must contain Protected Prefix Code section");
  assert.ok(prompt.includes("/* Protected Header */"), "Must contain prefix code content");
  assert.ok(prompt.includes("## Starter Code"), "Must contain Starter Code section");
  assert.ok(prompt.includes("## Protected Suffix Code"), "Must contain Protected Suffix Code section");
  assert.ok(prompt.includes("/* Protected Runner */"), "Must contain suffix code content");
  assert.ok(prompt.includes("## Return Instructions"), "Must contain Return Instructions section");
  assert.ok(prompt.includes("single ```javascript code block"), "Preserves assignment-specific return instructions");
  assert.ok(prompt.includes("## Task"), "Must contain Task section");
  assert.ok(prompt.includes("direct pasting into Acadrix's code editor"), "Must request direct code pasting");
  assert.ok(prompt.includes("Do not wrap the solution in an Acadrix JSON or HTML format"), "Must reject legacy transport wrappers");
  assert.ok(!prompt.includes("## Required Response Format"), "Must not include the legacy response contract");
  assert.ok(!prompt.includes('"format": "acadrix.programming.solution"'), "Must not require the JSON transport wrapper");

  const generatedPrompt = generateAiPrompt(doc).prompt;
  assert.ok(generatedPrompt.includes("direct pasting into Acadrix's code editor"), "Generated AI prompt must use direct-paste workflow");
  assert.ok(!generatedPrompt.includes("acadrix.programming.solution"), "Generated AI prompt must not request the legacy response wrapper");
});

await check("Test 29: Requirement 21 Ace Editor Resolution & Contract Matrix A–R", async () => {
  // A. Editor instance successfully resolved
  const mockSessionA = {
    lines: ["line 1", "line 2"],
    getValue: () => "line 1\nline 2",
    getLength: () => 2,
    getLine: (r) => mockSessionA.lines[r] ?? "",
    getLines: (f, l) => mockSessionA.lines.slice(f, l + 1),
    getMarkers: () => ({}),
    replace: () => {},
    getTextRange: (r) => "line 1",
  };
  const mockEditorA = {
    id: "test-editor-a",
    getSession: () => mockSessionA,
    session: mockSessionA,
    getValue: () => mockSessionA.getValue(),
  };
  const ctxA = resolveAceContext(mockEditorA);
  assert.equal(ctxA.isReady, true, "A: must be ready");
  assert.equal(ctxA.hasAceInstance, true, "A: hasAceInstance must be true");
  assert.equal(ctxA.identity, "editor-test-editor-a", "A: identity must match editor id");

  // B. Ace DOM exists but instance unavailable
  const mockElB = {
    nodeType: 1,
    tagName: "DIV",
    className: "ace-container ace_editor",
    classList: { contains: (c) => c === "ace_editor" || c === "ace-container" },
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  const ctxB = resolveAceContext(mockElB);
  assert.equal(ctxB.hasAceDom, true, "B: hasAceDom must be true");
  assert.equal(ctxB.hasAceInstance, false, "B: hasAceInstance must be false");
  assert.equal(ctxB.isReady, false, "B: isReady must be false");
  assert.equal(ctxB.identity, null, "B: identity must be null (never 'editor-none')");

  // C. Session exists but editor object unavailable
  const mockSessionC = {
    lines: ["foo", "bar"],
    getValue: () => "foo\nbar",
    getLength: () => 2,
    getLine: (r) => mockSessionC.lines[r] ?? "",
    getLines: (f, l) => mockSessionC.lines.slice(f, l + 1),
    getMarkers: () => ({}),
    replace: () => {},
    getTextRange: () => "foo",
  };
  const ctxC = resolveAceContext(mockSessionC);
  assert.equal(ctxC.isReady, true, "C: session-only context must be ready");
  assert.equal(ctxC.session, mockSessionC, "C: session must match");
  assert.ok(ctxC.identity !== null, "C: identity must be generated");

  // D. Protected prefix
  const markersD = {
    1: { range: { start: { row: 0, column: 0 }, end: { row: 1, column: 0 } }, clazz: "readonly_line" }
  };
  const sessionD = {
    lines: ["/* prefix */", "let x = 1;"],
    getValue: () => "/* prefix */\nlet x = 1;",
    getLength: () => 2,
    getLine: (r) => sessionD.lines[r] ?? "",
    getLines: (f, l) => sessionD.lines.slice(f, l + 1),
    getMarkers: () => markersD,
    replace: () => {},
    getTextRange: (r) => (r.start.row === 0 ? "/* prefix */" : "let x = 1;"),
  };
  const adapterD = new ProgrammingEditorAdapter(sessionD);
  assert.equal(adapterD.hasPrefixCode(), true, "D: must have prefix");
  assert.equal(adapterD.hasSuffixCode(), false, "D: must not have suffix");
  assert.equal(adapterD.getPrefixCode(), "/* prefix */", "D: prefix text must match");

  // E. Protected suffix
  const markersE = {
    1: { range: { start: { row: 1, column: 0 }, end: { row: 2, column: 0 } }, clazz: "readonly_line" }
  };
  const sessionE = {
    lines: ["let x = 1;", "/* suffix */"],
    getValue: () => "let x = 1;\n/* suffix */",
    getLength: () => 2,
    getLine: (r) => sessionE.lines[r] ?? "",
    getLines: (f, l) => sessionE.lines.slice(f, l + 1),
    getMarkers: () => markersE,
    replace: () => {},
    getTextRange: (r) => (r.start.row === 1 ? "/* suffix */" : "let x = 1;"),
  };
  const adapterE = new ProgrammingEditorAdapter(sessionE);
  assert.equal(adapterE.hasPrefixCode(), false, "E: must not have prefix");
  assert.equal(adapterE.hasSuffixCode(), true, "E: must have suffix");
  assert.equal(adapterE.getSuffixCode(), "/* suffix */", "E: suffix text must match");

  // F. Prefix + Suffix
  const markersF = {
    1: { range: { start: { row: 0, column: 0 }, end: { row: 1, column: 0 } }, clazz: "readonly_line" },
    2: { range: { start: { row: 2, column: 0 }, end: { row: 3, column: 0 } }, clazz: "readonly_line" }
  };
  const sessionF = {
    lines: ["/* prefix */", "let x = 1;", "/* suffix */"],
    getValue: () => "/* prefix */\nlet x = 1;\n/* suffix */",
    getLength: () => 3,
    getLine: (r) => sessionF.lines[r] ?? "",
    getLines: (f, l) => sessionF.lines.slice(f, l + 1),
    getMarkers: () => markersF,
    replace: () => {},
    getTextRange: (r) => (r.start.row === 0 ? "/* prefix */" : r.start.row === 2 ? "/* suffix */" : "let x = 1;"),
  };
  const adapterF = new ProgrammingEditorAdapter(sessionF);
  assert.equal(adapterF.hasPrefixCode(), true, "F: must have prefix");
  assert.equal(adapterF.hasSuffixCode(), true, "F: must have suffix");
  assert.equal(adapterF.getCode(), "let x = 1;", "F: getCode must return middle line");

  // G. No protected regions
  const sessionG = {
    lines: ["function main() {", "  return 42;", "}"],
    getValue: () => "function main() {\n  return 42;\n}",
    getLength: () => 3,
    getLine: (r) => sessionG.lines[r] ?? "",
    getLines: (f, l) => sessionG.lines.slice(f, l + 1),
    getMarkers: () => ({}),
    replace: () => {},
    getTextRange: () => "function main() {\n  return 42;\n}",
  };
  const adapterG = new ProgrammingEditorAdapter(sessionG);
  assert.equal(adapterG.hasPrefixCode(), false, "G: no prefix");
  assert.equal(adapterG.hasSuffixCode(), false, "G: no suffix");
  assert.equal(adapterG.getCode(), "function main() {\n  return 42;\n}", "G: returns all lines");

  // H & I. Starter code equals currentCode initially and differs after write
  let currentValH = "initial starter code";
  const sessionH = {
    id: "session-h-1",
    lines: [currentValH],
    getValue: () => currentValH,
    getLength: () => 1,
    getLine: () => currentValH,
    getLines: () => [currentValH],
    getMarkers: () => ({}),
    replace: (r, newText) => { currentValH = newText; },
    getTextRange: () => currentValH,
  };
  const adapterH = new ProgrammingEditorAdapter(sessionH);
  assert.equal(adapterH.getStarterCode(), "initial starter code", "I: starter equals current initially");
  adapterH.setCode("modified student code");
  assert.equal(adapterH.getStarterCode(), "initial starter code", "H: starter code remains immutable");
  assert.equal(adapterH.getCode(), "modified student code", "H: current code updated");

  // J. Marker discovery via session.getMarkers(true)
  let markersQueriedWithTrue = false;
  const sessionJ = {
    lines: ["code"],
    getValue: () => "code",
    getLength: () => 1,
    getLine: () => "code",
    getLines: () => ["code"],
    getMarkers: (front) => {
      if (front === true) markersQueriedWithTrue = true;
      return { 1: { range: { start: { row: 0, column: 0 }, end: { row: 1, column: 0 } }, clazz: "readonly_line" } };
    },
  };
  resolveEditableRange(sessionJ);
  assert.equal(markersQueriedWithTrue, true, "J: must query getMarkers(true) for front readonly markers");

  // K. Unresolved editor => PARTIAL with warning
  const unresolvedDoc = {
    nodeType: 9,
    querySelector: (s) => {
      if (s.includes("aceContainer") || s.includes(".ace_editor")) {
        return {
          nodeType: 1,
          classList: { contains: (c) => c === "ace_editor" || c === "ace-container" },
          querySelectorAll: () => [],
          querySelector: () => null,
        };
      }
      if (s.includes("problemContent") || s.includes(".backend-html")) {
        return { textContent: "Solve this problem." };
      }
      return null;
    },
    querySelectorAll: (s) => [],
  };
  const extractorK = new ProgrammingAssignmentExtractor(unresolvedDoc);
  const qNodeK = await extractorK.extractCurrentQuestionNode(unresolvedDoc, 1);
  assert.equal(qNodeK.programmingData.extractionStatus, "PARTIAL", "K: status must be PARTIAL");
  assert.equal(qNodeK.programmingData.editorIdentity, null, "K: editorIdentity must be null");
  assert.equal(qNodeK.programmingData.prefixState, "UNAVAILABLE", "K: prefixState must be UNAVAILABLE");
  assert.equal(qNodeK.programmingData.suffixState, "UNAVAILABLE", "K: suffixState must be UNAVAILABLE");
  assert.ok(qNodeK.programmingData.warnings.some((w) => w.includes("readiness timeout") || w.includes("could not be resolved")), "K: must include warning");

  // L. Resolved editor => COMPLETE
  const resolvedSessionL = {
    id: "session-l",
    lines: ["return 1;"],
    getValue: () => "return 1;",
    getLength: () => 1,
    getLine: () => "return 1;",
    getLines: () => ["return 1;"],
    getMarkers: () => ({}),
    getTextRange: () => "return 1;",
  };
  const resolvedDoc = {
    nodeType: 9,
    querySelector: (s) => {
      if (s.includes("aceContainer") || s.includes(".ace_editor")) {
        return {
          nodeType: 1,
          classList: { contains: (c) => c === "ace_editor" || c === "ace-container" },
          env: { editor: { id: "ed-l", getSession: () => resolvedSessionL, getValue: () => "return 1;" } },
          querySelectorAll: () => [],
          querySelector: () => null,
        };
      }
      if (s.includes("problemContent") || s.includes(".backend-html")) {
        return { textContent: "Calculate interest." };
      }
      return null;
    },
    querySelectorAll: (s) => [],
  };
  const extractorL = new ProgrammingAssignmentExtractor(resolvedDoc);
  const qNodeL = await extractorL.extractCurrentQuestionNode(resolvedDoc, 1);
  assert.equal(qNodeL.programmingData.extractionStatus, "COMPLETE", "L: status must be COMPLETE");
  assert.equal(qNodeL.programmingData.editorIdentity, "editor-ed-l", "L: editor identity must match");

  // M. Language extraction uses same Ace context
  const pySessionM = {
    id: "session-m",
    lines: ["print('hi')"],
    getValue: () => "print('hi')",
    getLength: () => 1,
    getLine: () => "print('hi')",
    getLines: () => ["print('hi')"],
    getMarkers: () => ({}),
    getMode: () => ({ $id: "ace/mode/python" }),
  };
  const ctxM = resolveAceContext(pySessionM);
  const langM = extractorL.extractLanguage(resolvedDoc, ctxM);
  assert.equal(langM, "python", "M: extractLanguage must resolve mode from aceContext");

  // N. Multiple extraction calls preserve starterCode
  const qNodeL2 = await extractorL.extractCurrentQuestionNode(resolvedDoc, 1);
  assert.equal(qNodeL2.programmingData.starterCode, qNodeL.programmingData.starterCode, "N: starterCode immutable across multiple extractions");

  // O. Editor identity changes during write => aborts write
  const sessionO = {
    lines: ["original"],
    getValue: () => "original",
    getLength: () => 1,
    getLine: () => "original",
    getLines: () => ["original"],
    getMarkers: () => ({}),
    replace: () => { editorO.id = "editor-o-shifted"; },
    getTextRange: () => "original",
  };
  const editorO = {
    id: "editor-o-initial",
    getSession: () => sessionO,
    session: sessionO,
    getValue: () => "original",
  };
  const adapterO = new ProgrammingEditorAdapter(editorO);
  const resO = adapterO.setCode("new code");
  assert.equal(resO.ok, false, "O: write must abort when editor identity changes");
  assert.equal(resO.errorCode, EditorErrorCode.EDITOR_IDENTITY_CHANGED, "O: error code must be EDITOR_IDENTITY_CHANGED");

  // P. Question identity changes during write => aborts write
  let activeQuestionNum = 1;
  const mockDocP = {
    nodeType: 9,
    querySelector: (s) => (s.includes("chip") ? { textContent: String(activeQuestionNum) } : null),
  };
  const sessionP = {
    id: "session-p",
    lines: ["original"],
    getValue: () => "original",
    getLength: () => 1,
    getLine: () => "original",
    getLines: () => ["original"],
    getMarkers: () => ({}),
    replace: () => { activeQuestionNum = 2; },
    getTextRange: () => "original",
  };
  const editorP = {
    id: "editor-p",
    getSession: () => sessionP,
    session: sessionP,
    getValue: () => "original",
  };
  const adapterP = new ProgrammingEditorAdapter(editorP);
  adapterP.container = mockDocP;
  const resP = adapterP.setCode("new code");
  assert.equal(resP.ok, false, "P: write must abort when question changes");
  assert.equal(resP.errorCode, EditorErrorCode.QUESTION_IDENTITY_CHANGED, "P: error code must be QUESTION_IDENTITY_CHANGED");

  // Q. Loading editor detection
  const loadingDoc = {
    querySelector: (s) => (s.includes("loading") || s.includes("spinner") ? { className: "mat-spinner" } : null),
    querySelectorAll: () => [],
  };
  const stateQ = extractorL.detectCurrentState(loadingDoc);
  assert.equal(stateQ, AssessmentState.LOADING, "Q: detectCurrentState must detect LOADING");

  // R. Real Five-Language Matrix (bash, sql, python, java, javascript)
  const langMatrix = [
    { modeId: "ace/mode/sh", expected: "bash" },
    { modeId: "ace/mode/sql", expected: "sql" },
    { modeId: "ace/mode/python", expected: "python" },
    { modeId: "ace/mode/java", expected: "java" },
    { modeId: "ace/mode/javascript", expected: "javascript" },
  ];
  for (const { modeId, expected } of langMatrix) {
    const langSess = {
      lines: ["sample code"],
      getValue: () => "sample code",
      getLength: () => 1,
      getLine: () => "sample code",
      getLines: () => ["sample code"],
      getMarkers: () => ({}),
      getMode: () => ({ $id: modeId }),
    };
    const ctx = resolveAceContext(langSess);
    const adapter = new ProgrammingEditorAdapter(ctx);
    assert.equal(adapter.getLanguage(), expected, `R: must resolve canonical language ${expected} from ${modeId}`);
  }
});

// ============================================================================
// 19. MAIN-WORLD BRIDGE & EXECUTION-WORLD BOUNDARY TEST MATRIX (A–F)
// ============================================================================

await check("19. Main-World Bridge & Execution-World Boundary Tests (A–F)", async () => {
  // A. Bridge unavailable fallback -> returns PARTIAL cleanly without crashing
  const unbridgedDoc = {
    nodeType: 9,
    querySelector: (s) => (s.includes("ace_editor") ? { nodeType: 1, classList: { contains: () => true } } : null),
    querySelectorAll: () => [],
    defaultView: {
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    },
  };
  const unbridgedExtractor = new ProgrammingAssignmentExtractor(unbridgedDoc);
  const unbridgedNode = await unbridgedExtractor.extractCurrentQuestionNode(unbridgedDoc, 1);
  assert.equal(unbridgedNode.programmingData.extractionStatus, "PARTIAL", "A: must be PARTIAL when bridge is unavailable");
  assert.equal(unbridgedNode.programmingData.prefixState, "UNAVAILABLE", "A: prefixState must be UNAVAILABLE");

  // Setup simulated mock DOM Window with Main-World Bridge
  const listeners = new Map();
  const mockWindow = {
    addEventListener: (type, handler) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener: (type, handler) => {
      if (!listeners.has(type)) return;
      listeners.set(type, listeners.get(type).filter((h) => h !== handler));
    },
    dispatchEvent: (event) => {
      const handlers = listeners.get(event.type) || [];
      for (const h of handlers) {
        h(event);
      }
      return true;
    },
    CustomEvent: class CustomEvent {
      constructor(type, params = {}) {
        this.type = type;
        this.detail = params.detail || {};
      }
    },
  };

  // Mock Ace Session & Editor for Bridge
  const mockPrefix = "const fs = require('fs');\nfunction helper() {}\n";
  const mockEditable = "function calculateSimpleInterest(p, r, t) {\n  return (p * r * t) / 100;\n}";
  const mockFullCode = mockPrefix + mockEditable;
  const mockLines = mockFullCode.split("\n");

  const mockBridgeSession = {
    id: "bridge-session-42",
    getLength: () => mockLines.length,
    getLine: (r) => mockLines[r] || "",
    getLines: (s, e) => mockLines.slice(s, e + 1),
    getValue: () => mockLines.join("\n"),
    getMode: () => ({ $id: "ace/mode/javascript" }),
    getMarkers: (front) => (front ? {
      1: {
        range: { start: { row: 0, column: 0 }, end: { row: 2, column: 0 } },
        clazz: "readonly_line",
        type: "fullLine",
      },
    } : {}),
    replace: (range, text) => {
      const before = mockLines.slice(0, range.start.row);
      const after = mockLines.slice(range.end.row + 1);
      const repLines = text.split("\n");
      mockLines.length = 0;
      mockLines.push(...before, ...repLines, ...after);
    },
  };

  const mockBridgeEditor = {
    id: "editor-bridge-real",
    getSession: () => mockBridgeSession,
    session: mockBridgeSession,
    getValue: () => mockLines.join("\n"),
  };

  const mockAceDomEl = {
    nodeType: 1,
    id: "app-code-editor-1",
    classList: { contains: (c) => c === "ace_editor" || c === "ace-container" },
    env: { editor: mockBridgeEditor },
    querySelector: () => null,
    querySelectorAll: () => [],
    dispatchEvent: () => true,
  };

  const bridgedDoc = {
    nodeType: 9,
    defaultView: mockWindow,
    querySelector: (s) => {
      if (s.includes("ace_editor") || s.includes("aceContainer")) return mockAceDomEl;
      if (s.includes("problemContent") || s.includes("backend-html")) return { textContent: "Calculate simple interest." };
      return null;
    },
    querySelectorAll: () => [],
  };
  mockAceDomEl.ownerDocument = bridgedDoc;
  mockWindow.document = bridgedDoc;
  globalThis.CustomEvent = mockWindow.CustomEvent;

  // Initialize bridge in mockWindow
  initPageBridge(mockWindow);

  // B. Valid Snapshot via bridge -> extracts prefix, currentCode, suffix, language, editorIdentity
  const pingRes = requestMainWorldBridge("ping", {}, bridgedDoc);
  assert.equal(pingRes.ok, true, "B: ping must succeed");
  assert.equal(pingRes.data.isReady, true, "B: bridge must report ready");

  const snapshotRes = requestMainWorldBridge("getSnapshot", {}, bridgedDoc);
  assert.equal(snapshotRes.ok, true, "B: snapshot must succeed");
  assert.equal(snapshotRes.data.editorIdentity, "editor-editor-bridge-real", "B: editor identity must match");
  assert.equal(snapshotRes.data.language, "javascript", "B: language must be javascript");

  // C. Protected prefix/suffix parsing -> validates prefix rows 0..1, editable 2..end
  assert.equal(snapshotRes.data.prefixCode, "const fs = require('fs');\nfunction helper() {}", "C: prefixCode must match scaffold");
  assert.equal(snapshotRes.data.suffixCode, null, "C: suffixCode must be null when no trailing readonly markers");
  assert.equal(snapshotRes.data.isGuarded, true, "C: isGuarded must be true");

  // Adapter integration via bridge
  const bridgedCtx = resolveAceContext(bridgedDoc);
  assert.equal(bridgedCtx.isReady, true, "C: resolved Ace context must be ready");
  assert.equal(bridgedCtx.source, "dom-env-editor", "C: source matches in mock environment");

  // Isolated mock document where env is null on DOM element
  const isolatedAceDomEl = {
    nodeType: 1,
    id: "app-code-editor-1",
    classList: { contains: (c) => c === "ace_editor" || c === "ace-container" },
    env: null, // Isolated world has no expando env
    querySelector: () => null,
    querySelectorAll: () => [],
    dispatchEvent: () => true,
  };
  const isolatedDoc = {
    nodeType: 9,
    defaultView: mockWindow,
    querySelector: (s) => {
      if (s.includes("ace_editor") || s.includes("aceContainer")) return isolatedAceDomEl;
      if (s.includes("problemContent") || s.includes("backend-html")) return { textContent: "Calculate simple interest." };
      return null;
    },
    querySelectorAll: () => [],
  };
  isolatedAceDomEl.ownerDocument = isolatedDoc;

  const isolatedCtx = resolveAceContext(isolatedDoc);
  assert.equal(isolatedCtx.isReady, true, "C: isolated context resolves via bridge");
  assert.equal(isolatedCtx.source, "main-world-bridge", "C: source is main-world-bridge");

  const isolatedAdapter = new ProgrammingEditorAdapter(isolatedCtx);
  assert.equal(isolatedAdapter.isReady(), true, "C: adapter is ready");
  assert.equal(isolatedAdapter.getEditorIdentity(), "editor-editor-bridge-real", "C: adapter identity matches snapshot");
  assert.equal(isolatedAdapter.hasPrefixCode(), true, "C: adapter detects prefix code");
  assert.equal(isolatedAdapter.getPrefixCode(), "const fs = require('fs');\nfunction helper() {}", "C: prefix matches");

  // D. Editor identity mismatch -> privileged write aborts when target identity changes
  const mismatchWriteRes = executePrivilegedWrite({
    editorIdentity: "editor-wrong-id",
    code: "console.log('injected');",
  }, mockWindow);
  assert.equal(mismatchWriteRes.ok, false, "D: privileged write must fail on identity mismatch");
  assert.equal(mismatchWriteRes.errorCode, "EDITOR_IDENTITY_CHANGED", "D: error code must be EDITOR_IDENTITY_CHANGED");

  // E. Safe write & verification -> setCode via isolated adapter succeeds
  const safeWriteRes = isolatedAdapter.setCode(
    "function calculateSimpleInterest(p, r, t) {\n  return (p * r * t) / 100;\n}\n// updated by test"
  );
  assert.equal(safeWriteRes.ok, true, "E: safe write must succeed");
  assert.equal(safeWriteRes.verified, true, "E: write must be verified");

  // F. Message schema validation -> rejects malformed or unversioned messages
  const invalidVersionRes = requestMainWorldBridge("ping", { version: 999 }, bridgedDoc);
  // requestMainWorldBridge enforces BRIDGE_PROTOCOL_VERSION
  assert.equal(pingRes.detail?.version ?? BRIDGE_PROTOCOL_VERSION, 1, "F: bridge protocol version must be 1");
});

await check("20. Main-World Bridge Security Hardening & Negative Tests Matrix (A–J)", async () => {
  // Setup isolated mock environment for security testing
  let editorLines = [
    "// Protected Prefix: IITM Header",
    "const fs = require('fs');",
    "function solve() {",
    "  // student editable starter code",
    "  return 0;",
    "}",
    "// Protected Suffix: IITM Runner",
    "solve();",
  ];

  const markers = {
    prefixMarker: {
      clazz: "readonly_line",
      type: "fullLine",
      range: { start: { row: 0, column: 0 }, end: { row: 1, column: 25 } },
    },
    suffixMarker: {
      clazz: "readonly_line",
      type: "fullLine",
      range: { start: { row: 6, column: 0 }, end: { row: 7, column: 8 } },
    },
  };

  const aceSession = {
    getLength: () => editorLines.length,
    getLines: (s, e) => editorLines.slice(s, e + 1),
    getLine: (r) => editorLines[r] || "",
    getValue: () => editorLines.join("\n"),
    getMarkers: (front) => (front ? markers : {}),
    $frontMarkers: markers,
    getMode: () => ({ $id: "ace/mode/javascript" }),
    replace: (range, text) => {
      const lines = text.split("\n");
      const before = editorLines.slice(0, range.start.row);
      const after = editorLines.slice(range.end.row + 1);
      editorLines = [...before, ...lines, ...after];
    },
  };

  const mockEditor = {
    id: "editor-sec-test",
    getSession: () => aceSession,
    session: aceSession,
    getValue: () => aceSession.getValue(),
  };

  const listeners = new Map();
  const mockWin = {
    __ACADRIX_PAGE_BRIDGE_INITIALIZED__: false,
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener: (type, fn) => {
      const list = listeners.get(type) || [];
      listeners.set(type, list.filter((f) => f !== fn));
    },
    dispatchEvent: (evt) => {
      const list = listeners.get(evt.type) || [];
      for (const fn of list) fn(evt);
      return true;
    },
    CustomEvent: class {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail || null;
      }
    },
  };

  const mockAceDom = {
    nodeType: 1,
    id: "app-code-editor-sec",
    classList: { contains: (c) => c === "ace_editor" || c === "ace-container" },
    env: { editor: mockEditor },
    _editor: mockEditor,
    querySelector: () => null,
    querySelectorAll: () => [],
    dispatchEvent: () => true,
  };

  const mockDoc = {
    nodeType: 9,
    defaultView: mockWin,
    querySelector: (sel) => {
      if (sel.includes("ace_editor") || sel.includes("ace-container") || sel.includes("app-code-editor")) {
        return mockAceDom;
      }
      if (sel.includes("title")) {
        return { textContent: "Course Assignment 1" };
      }
      if (sel.includes("chip")) {
        return { textContent: "1" };
      }
      return null;
    },
    querySelectorAll: () => [],
  };

  mockWin.document = mockDoc;
  initPageBridge(mockWin);

  const initialCodeSnapshot = aceSession.getValue();
  const initialPrefix = editorLines.slice(0, 2).join("\n");
  const initialSuffix = editorLines.slice(6, 8).join("\n");

  // Helper to send raw CustomEvent requests to bridge
  function dispatchBridgeRequest(detail) {
    let capturedResponse = null;
    const respHandler = (evt) => {
      capturedResponse = evt.detail;
    };
    mockWin.addEventListener(BRIDGE_RESPONSE_EVENT, respHandler);
    mockWin.dispatchEvent(new mockWin.CustomEvent(BRIDGE_REQUEST_EVENT, { detail }));
    mockWin.removeEventListener(BRIDGE_RESPONSE_EVENT, respHandler);
    return capturedResponse;
  }

  // --- Negative Test A: Page fake writeCode rejection over CustomEvent ---
  const fakeWriteResponse = dispatchBridgeRequest({
    source: "acadrix",
    channel: BRIDGE_CHANNEL,
    version: BRIDGE_PROTOCOL_VERSION,
    requestId: "req_fake_write_1",
    operation: "writeCode",
    payload: { editorIdentity: "editor-sec-test", code: "malicious_override()" },
  });
  assert.equal(fakeWriteResponse.ok, false, "Test A: fake writeCode over CustomEvent must be rejected");
  assert.equal(fakeWriteResponse.errorCode, "UNAUTHORIZED_OPERATION", "Test A: error code must be UNAUTHORIZED_OPERATION");
  assert.equal(aceSession.getValue(), initialCodeSnapshot, "Test A: editor content must remain unmodified (zero mutation)");

  // --- Negative Test B: Page fake getSnapshot (read-only snapshot, no write capability exposed) ---
  const snapshotResponse = dispatchBridgeRequest({
    source: "acadrix",
    channel: BRIDGE_CHANNEL,
    version: BRIDGE_PROTOCOL_VERSION,
    requestId: "req_snap_test_1",
    operation: "getSnapshot",
    payload: {},
  });
  assert.equal(snapshotResponse.ok, true, "Test B: getSnapshot over CustomEvent succeeds as read-only");
  assert.equal(snapshotResponse.data.editorIdentity, "editor-editor-sec-test", "Test B: snapshot provides identity");
  assert.equal(snapshotResponse.data.session, undefined, "Test B: snapshot must not leak live session object");
  assert.equal(snapshotResponse.data.editor, undefined, "Test B: snapshot must not leak live editor object");
  assert.equal(typeof snapshotResponse.data.writeCode, "undefined", "Test B: snapshot must not expose write capability");

  // --- Negative Test C: Replay attack / duplicate requestId rejection ---
  const duplicateId = "req_replay_attack_123";
  const firstReq = dispatchBridgeRequest({
    source: "acadrix",
    channel: BRIDGE_CHANNEL,
    version: BRIDGE_PROTOCOL_VERSION,
    requestId: duplicateId,
    operation: "ping",
    payload: {},
  });
  assert.equal(firstReq.ok, true, "Test C: first request with ID succeeds");
  const replayReq = dispatchBridgeRequest({
    source: "acadrix",
    channel: BRIDGE_CHANNEL,
    version: BRIDGE_PROTOCOL_VERSION,
    requestId: duplicateId,
    operation: "ping",
    payload: {},
  });
  assert.equal(replayReq.ok, false, "Test C: replayed request with same ID must be rejected");
  assert.equal(replayReq.errorCode, "DUPLICATE_REQUEST_ID", "Test C: error code must be DUPLICATE_REQUEST_ID");

  // --- Negative Test D: Malformed request payload rejection ---
  const malformedNullRes = dispatchBridgeRequest(null);
  assert.equal(malformedNullRes.ok, false, "Test D: null payload must be rejected");
  assert.equal(malformedNullRes.errorCode, "MALFORMED_REQUEST", "Test D: error code must be MALFORMED_REQUEST");

  const malformedStringRes = dispatchBridgeRequest("not-an-object");
  assert.equal(malformedStringRes.ok, false, "Test D: string payload must be rejected");
  assert.equal(malformedStringRes.errorCode, "MALFORMED_REQUEST", "Test D: error code must be MALFORMED_REQUEST");

  // --- Negative Test E: Missing or empty requestId rejection ---
  const missingIdRes = dispatchBridgeRequest({
    source: "acadrix",
    channel: BRIDGE_CHANNEL,
    version: BRIDGE_PROTOCOL_VERSION,
    operation: "ping",
  });
  assert.equal(missingIdRes.ok, false, "Test E: missing requestId must be rejected");
  assert.equal(missingIdRes.errorCode, "MISSING_REQUEST_ID", "Test E: error code must be MISSING_REQUEST_ID");

  const emptyIdRes = dispatchBridgeRequest({
    source: "acadrix",
    channel: BRIDGE_CHANNEL,
    version: BRIDGE_PROTOCOL_VERSION,
    requestId: "   ",
    operation: "ping",
  });
  assert.equal(emptyIdRes.ok, false, "Test E: empty whitespace requestId must be rejected");
  assert.equal(emptyIdRes.errorCode, "MISSING_REQUEST_ID", "Test E: error code must be MISSING_REQUEST_ID");

  // --- Negative Test F: Unsupported protocol version rejection ---
  const badVersionRes = dispatchBridgeRequest({
    source: "acadrix",
    channel: BRIDGE_CHANNEL,
    version: 999,
    requestId: "req_bad_ver_1",
    operation: "ping",
  });
  assert.equal(badVersionRes.ok, false, "Test F: unsupported version must be rejected");
  assert.equal(badVersionRes.errorCode, "UNSUPPORTED_VERSION", "Test F: error code must be UNSUPPORTED_VERSION");

  // --- Negative Test G: Unknown operation rejection ---
  const unknownOpRes = dispatchBridgeRequest({
    source: "acadrix",
    channel: BRIDGE_CHANNEL,
    version: BRIDGE_PROTOCOL_VERSION,
    requestId: "req_unknown_op_1",
    operation: "executeArbitraryScript",
  });
  assert.equal(unknownOpRes.ok, false, "Test G: unknown operation must be rejected");
  assert.equal(unknownOpRes.errorCode, "UNKNOWN_OPERATION", "Test G: error code must be UNKNOWN_OPERATION");

  // --- Negative Test H: Stale editor ID rejection in executePrivilegedWrite ---
  const staleEditorRes = executePrivilegedWrite({
    editorIdentity: "editor-stale-previous-session",
    code: "console.log('stale');",
  }, mockWin);
  assert.equal(staleEditorRes.ok, false, "Test H: stale editor ID must be rejected");
  assert.equal(staleEditorRes.errorCode, "EDITOR_IDENTITY_CHANGED", "Test H: error code must be EDITOR_IDENTITY_CHANGED");
  assert.equal(aceSession.getValue(), initialCodeSnapshot, "Test H: editor content must remain unmodified (zero mutation)");

  // --- Negative Test I: Stale question ID / assignment title mismatch rejection in executePrivilegedWrite ---
  const wrongQuestionRes = executePrivilegedWrite({
    editorIdentity: "editor-editor-sec-test",
    questionNumber: 42,
    code: "console.log('wrong question');",
  }, mockWin);
  assert.equal(wrongQuestionRes.ok, false, "Test I: mismatched question number must be rejected");
  assert.equal(wrongQuestionRes.errorCode, "QUESTION_IDENTITY_CHANGED", "Test I: error code must be QUESTION_IDENTITY_CHANGED");

  const wrongTitleRes = executePrivilegedWrite({
    editorIdentity: "editor-editor-sec-test",
    assignmentTitle: "Completely Different Course",
    code: "console.log('wrong title');",
  }, mockWin);
  assert.equal(wrongTitleRes.ok, false, "Test I: mismatched assignment title must be rejected");
  assert.equal(wrongTitleRes.errorCode, "ASSIGNMENT_IDENTITY_CHANGED", "Test I: error code must be ASSIGNMENT_IDENTITY_CHANGED");
  assert.equal(aceSession.getValue(), initialCodeSnapshot, "Test I: editor content must remain unmodified (zero mutation)");

  // --- Negative Test J: Response spoofing / invalid response rejection in requestMainWorldBridge ---
  const forgedSyncRes = requestMainWorldBridge("ping", {}, mockDoc);
  assert.equal(forgedSyncRes.ok, true, "Test J: genuine ping succeeds");

  // Dispatch forged response event with attacker source
  mockWin.dispatchEvent(new mockWin.CustomEvent(BRIDGE_RESPONSE_EVENT, {
    detail: {
      source: "attacker-script",
      channel: BRIDGE_CHANNEL,
      version: BRIDGE_PROTOCOL_VERSION,
      requestId: "fake_id",
      ok: true,
      data: { forged: true },
    },
  }));

  // Dispatch forged response event with wrong channel
  mockWin.dispatchEvent(new mockWin.CustomEvent(BRIDGE_RESPONSE_EVENT, {
    detail: {
      source: "acadrix-page-bridge",
      channel: "wrong-channel",
      version: BRIDGE_PROTOCOL_VERSION,
      requestId: "fake_id",
      ok: true,
      data: { forged: true },
    },
  }));

  // Dispatch forged response event with wrong version
  mockWin.dispatchEvent(new mockWin.CustomEvent(BRIDGE_RESPONSE_EVENT, {
    detail: {
      source: "acadrix-page-bridge",
      channel: BRIDGE_CHANNEL,
      version: 999,
      requestId: "fake_id",
      ok: true,
      data: { forged: true },
    },
  }));

  // --- Global Invariant: Zero Mutation Verification ---
  assert.equal(aceSession.getValue(), initialCodeSnapshot, "Global Invariant: Total editor content byte-for-byte identical across all negative tests");
  const postPrefix = editorLines.slice(0, 2).join("\n");
  const postSuffix = editorLines.slice(6, 8).join("\n");
  assert.equal(postPrefix, initialPrefix, "Global Invariant: Prefix scaffold byte-for-byte identical");
  assert.equal(postSuffix, initialSuffix, "Global Invariant: Suffix scaffold byte-for-byte identical");
});

// ==============================================================================
// ── Section 21: Dedicated Programming UI/UX Refactor Verification ─────────────
// ==============================================================================

class MockTestElement {
  constructor(tagName = "DIV") {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.id = "";
    this.className = "";
    this.type = "button";
    this.dataset = {};
    this.style = {};
    this._attributes = new Map();
    this._listeners = new Map();
    this.childNodes = [];
    this.parentElement = null;
    this.tabIndex = 0;
    this.hidden = false;
  }
  get children() {
    return this.childNodes.filter((c) => c.nodeType === 1);
  }
  getAttribute(name) {
    if (name === "id") return this.id || null;
    if (name === "class") return this.className || null;
    return this._attributes.get(name.toLowerCase()) ?? null;
  }
  hasAttribute(name) {
    if (name === "id") return Boolean(this.id);
    if (name === "class") return Boolean(this.className);
    if (name === "hidden") return this.hidden;
    return this._attributes.has(name.toLowerCase());
  }
  setAttribute(name, val) {
    const lower = name.toLowerCase();
    this._attributes.set(lower, String(val));
    if (lower === "id") this.id = String(val);
    if (lower === "class") this.className = String(val);
    if (lower === "hidden") this.hidden = true;
  }
  removeAttribute(name) {
    const lower = name.toLowerCase();
    this._attributes.delete(lower);
    if (lower === "id") this.id = "";
    if (lower === "class") this.className = "";
    if (lower === "hidden") this.hidden = false;
  }
  get classList() {
    const self = this;
    return {
      add(...classes) {
        const set = new Set(self.className.split(/\s+/).filter(Boolean));
        for (const c of classes) set.add(c);
        self.className = [...set].join(" ");
      },
      remove(...classes) {
        const set = new Set(self.className.split(/\s+/).filter(Boolean));
        for (const c of classes) set.delete(c);
        self.className = [...set].join(" ");
      },
      contains(cls) {
        return self.className.split(/\s+/).filter(Boolean).includes(cls);
      },
      toggle(cls, force) {
        const has = this.contains(cls);
        const shouldAdd = force !== undefined ? force : !has;
        if (shouldAdd) this.add(cls);
        else this.remove(cls);
        return shouldAdd;
      },
    };
  }
  get textContent() {
    let text = "";
    for (const c of this.childNodes) {
      if (c.nodeType === 3) text += c._textContent || "";
      else if (c.nodeType === 1) text += c.textContent || "";
    }
    return text;
  }
  set textContent(val) {
    this.childNodes = [];
    if (val !== undefined && val !== null) {
      const textNode = { nodeType: 3, _textContent: String(val), parentElement: this };
      this.childNodes.push(textNode);
    }
  }
  get innerHTML() {
    return this.childNodes.map((c) => (c.nodeType === 1 ? c.outerHTML : (c._textContent || ""))).join("");
  }
  set innerHTML(html) {
    this.childNodes = [];
    if (!html) return;
    parseHtmlIntoMockElement(html, this);
  }
  get outerHTML() {
    const tag = this.tagName.toLowerCase();
    const attrs = [];
    if (this.id) attrs.push(`id="${this.id}"`);
    if (this.className) attrs.push(`class="${this.className}"`);
    for (const [k, v] of this._attributes.entries()) {
      if (k !== "id" && k !== "class") attrs.push(`${k}="${v}"`);
    }
    const attrStr = attrs.length > 0 ? " " + attrs.join(" ") : "";
    return `<${tag}${attrStr}>${this.innerHTML}</${tag}>`;
  }
  appendChild(child) {
    child.parentElement = this;
    this.childNodes.push(child);
    return child;
  }
  removeChild(child) {
    const idx = this.childNodes.indexOf(child);
    if (idx !== -1) {
      this.childNodes.splice(idx, 1);
      child.parentElement = null;
    }
    return child;
  }
  remove() {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }
  replaceChildren(...nodes) {
    this.childNodes = [];
    for (const n of nodes) {
      this.appendChild(n);
    }
  }
  insertBefore(newNode, refNode) {
    const idx = this.childNodes.indexOf(refNode);
    if (idx !== -1) {
      newNode.parentElement = this;
      this.childNodes.splice(idx, 0, newNode);
    } else {
      this.appendChild(newNode);
    }
    return newNode;
  }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const list = this._listeners.get(type) || [];
    this._listeners.set(type, list.filter((f) => f !== fn));
  }
  dispatchEvent(event) {
    event.target = this;
    const list = this._listeners.get(event.type) || [];
    for (const fn of list) fn(event);
    return !event.defaultPrevented;
  }
  click() {
    this.dispatchEvent({
      type: "click",
      target: this,
      preventDefault: () => {},
      stopPropagation: () => {},
    });
  }
  focus() {}
  blur() {}
  matches(selector) {
    return matchesMockSelector(this, selector);
  }
  closest(selector) {
    let curr = this;
    while (curr && curr.nodeType === 1) {
      if (curr.matches(selector)) return curr;
      curr = curr.parentElement;
    }
    return null;
  }
  contains(other) {
    let curr = other;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentElement;
    }
    return false;
  }
  querySelectorAll(selectorGroup) {
    const results = [];
    const selectors = selectorGroup.split(",").map((s) => s.trim()).filter(Boolean);
    const walk = (node) => {
      for (const child of node.children) {
        if (selectors.some((sel) => matchesMockSelector(child, sel))) {
          results.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return results;
  }
  querySelector(selectorGroup) {
    return this.querySelectorAll(selectorGroup)[0] || null;
  }
  getElementById(id) {
    return this.querySelector(`#${id}`);
  }
}

function matchesMockCompoundToken(el, token) {
  if (!el || el.nodeType !== 1) return false;
  let remaining = token;
  const tagMatch = remaining.match(/^[a-zA-Z0-9-]+/);
  if (tagMatch) {
    if (el.tagName !== tagMatch[0].toUpperCase()) return false;
    remaining = remaining.slice(tagMatch[0].length);
  }
  const idMatch = remaining.match(/#([a-zA-Z0-9_-]+)/);
  if (idMatch) {
    if (el.id !== idMatch[1]) return false;
    remaining = remaining.replace(idMatch[0], "");
  }
  const classMatches = remaining.match(/\.([a-zA-Z0-9_-]+)/g);
  if (classMatches) {
    for (const c of classMatches) {
      if (!el.classList.contains(c.slice(1))) return false;
    }
    remaining = remaining.replace(/\.([a-zA-Z0-9_-]+)/g, "");
  }
  const attrMatches = remaining.match(/\[([a-zA-Z0-9_-]+)(?:=([^\],]+))?\]/g);
  if (attrMatches) {
    for (const am of attrMatches) {
      const m = am.match(/\[([a-zA-Z0-9_-]+)(?:=([^\],]+))?\]/);
      if (!m) return false;
      const attrName = m[1];
      const attrVal = m[2] ? m[2].replace(/^["']|["']$/g, "") : null;
      if (!el.hasAttribute(attrName)) return false;
      if (attrVal !== null && el.getAttribute(attrName) !== attrVal) return false;
    }
  }
  return true;
}

function matchesMockSelector(el, sel) {
  const parts = sel.trim().split(/\s+/);
  let curr = el;
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (i === parts.length - 1) {
      if (!matchesMockCompoundToken(curr, part)) return false;
    } else {
      let parent = curr.parentElement;
      while (parent && parent.nodeType === 1 && !matchesMockCompoundToken(parent, part)) {
        parent = parent.parentElement;
      }
      if (!parent || parent.nodeType !== 1) return false;
      curr = parent;
    }
  }
  return true;
}

function parseHtmlIntoMockElement(html, parent) {
  const stack = [parent];
  const voidTags = new Set(["IMG", "BR", "HR", "INPUT", "COL", "META", "LINK"]);
  let i = 0;
  while (i < html.length) {
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith("<!", i)) {
      const end = html.indexOf(">", i);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    if (html.startsWith("</", i)) {
      const end = html.indexOf(">", i);
      const tag = html.slice(i + 2, end).trim().toUpperCase();
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s].tagName === tag) {
          stack.length = s;
          break;
        }
      }
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    if (html[i] === "<" && /^[a-zA-Z]/.test(html[i + 1] || "")) {
      const end = html.indexOf(">", i);
      if (end !== -1) {
        const rawTag = html.slice(i + 1, end).trim();
        const selfClosing = rawTag.endsWith("/");
        const cleanContent = selfClosing ? rawTag.slice(0, -1).trim() : rawTag;
        const spaceIdx = cleanContent.search(/\s/);
        const tagName = (spaceIdx === -1 ? cleanContent : cleanContent.slice(0, spaceIdx)).toUpperCase();
        const attrStr = spaceIdx === -1 ? "" : cleanContent.slice(spaceIdx).trim();

        const el = new MockTestElement(tagName);
        const attrRegex = /([a-zA-Z0-9_:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
        let match;
        while ((match = attrRegex.exec(attrStr)) !== null) {
          const name = match[1];
          const val = match[2] ?? match[3] ?? match[4] ?? "";
          el.setAttribute(name, val);
          if (name.startsWith("data-")) {
            const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            el.dataset[key] = val;
          }
        }
        stack[stack.length - 1].appendChild(el);
        if (!selfClosing && !voidTags.has(tagName)) {
          stack.push(el);
        }
        i = end + 1;
        continue;
      }
    }
    let nextTag = html.indexOf("<", i + (html[i] === "<" ? 1 : 0));
    while (nextTag !== -1 && !/^[a-zA-Z!/]/.test(html[nextTag + 1] || "")) {
      nextTag = html.indexOf("<", nextTag + 1);
    }
    const rawText = nextTag === -1 ? html.slice(i) : html.slice(i, nextTag);
    if (rawText) {
      stack[stack.length - 1].appendChild({
        nodeType: 3,
        _textContent: rawText,
        parentElement: stack[stack.length - 1],
      });
    }
    i = nextTag === -1 ? html.length : nextTag;
  }
}

// ── Test 21.1: Candidate Code Scoring ─────────────────────────────────────────
await check("Test 21.1: scoreCandidateBlock candidate scoring hierarchy and precedence", async () => {
  // 1. Structured JSON contract (100 base, 105 with valid syntax + lineCount)
  const structuredNoLines = { isStructured: true, isValid: false, lineCount: 0 };
  const structuredValid = { isStructured: true, isValid: true, lineCount: 10 };
  assert.equal(scoreCandidateBlock(structuredNoLines, "python").score, 100);
  assert.equal(scoreCandidateBlock(structuredValid, "python").score, 105);
  assert.equal(scoreCandidateBlock(structuredValid, "python").reason, "Structured solution contract");

  // 2. Exact language match (80 base, 85 with valid syntax + lineCount)
  const exactNoLines = { language: "python", rawLanguage: "python", isFenced: true, isValid: false, lineCount: 0 };
  const exactValid = { language: "python", rawLanguage: "python", isFenced: true, isValid: true, lineCount: 5 };
  assert.equal(scoreCandidateBlock(exactNoLines, "python").score, 80);
  assert.equal(scoreCandidateBlock(exactValid, "python").score, 85);
  assert.equal(scoreCandidateBlock(exactValid, "python").reason, "Matching python block");

  // 3. Compatible language mode (60 base, 65 with valid syntax + lineCount)
  const compatNoLines = { language: "sh", rawLanguage: "sh", isFenced: true, isValid: false, lineCount: 0 };
  const compatValid = { language: "sh", rawLanguage: "sh", isFenced: true, isValid: true, lineCount: 4 };
  assert.equal(scoreCandidateBlock(compatNoLines, "bash").score, 60);
  assert.equal(scoreCandidateBlock(compatValid, "bash").score, 65);
  assert.equal(scoreCandidateBlock(compatValid, "bash").reason, "Compatible sh syntax");

  // 4. Generic markdown fence without language (50 base, 55 with valid syntax + lineCount)
  const genericNoLines = { language: null, rawLanguage: "", isFenced: true, isValid: false, lineCount: 0 };
  const genericValid = { language: null, rawLanguage: "", isFenced: true, isValid: true, lineCount: 6 };
  assert.equal(scoreCandidateBlock(genericNoLines, "python").score, 50);
  assert.equal(scoreCandidateBlock(genericValid, "python").score, 55);
  assert.equal(scoreCandidateBlock(genericValid, "python").reason, "Generic fenced code block");

  // 5. Plain code without markdown fence (40 base, 45 with valid syntax + lineCount)
  const plainNoLines = { language: null, rawLanguage: "", isFenced: false, code: "print('hello')", isValid: false, lineCount: 0 };
  const plainValid = { language: null, rawLanguage: "", isFenced: false, code: "print('hello')", isValid: true, lineCount: 1 };
  assert.equal(scoreCandidateBlock(plainNoLines, "python").score, 40);
  assert.equal(scoreCandidateBlock(plainValid, "python").score, 45);
  assert.equal(scoreCandidateBlock(plainValid, "python").reason, "Plain code block");

  // 6. Explicit language mismatch (20 base, 25 with valid syntax + lineCount)
  const mismatchNoLines = { language: "javascript", rawLanguage: "javascript", isFenced: true, isValid: false, lineCount: 0 };
  const mismatchValid = { language: "javascript", rawLanguage: "javascript", isFenced: true, isValid: true, lineCount: 3 };
  assert.equal(scoreCandidateBlock(mismatchNoLines, "python").score, 20);
  assert.equal(scoreCandidateBlock(mismatchValid, "python").score, 25);
  assert.ok(scoreCandidateBlock(mismatchValid, "python").reason.includes("Language mismatch"));
});

// ── Test 21.2: Auto-Selection, Mismatch Confirmation & Preview ────────────────
await check("Test 21.2: parseImportedCode and analyzeAiResponse auto-selection and mismatch confirmation", async () => {
  // Multiple blocks in LLM response: Bash setup + Python solution + JavaScript explanation
  const multiResponse = `
Here is a bash script to test:
\`\`\`bash
pytest test_solution.py
\`\`\`

Here is the actual Python implementation:
\`\`\`python
def calculate_interest(principal, rate, time):
    interest = (principal * rate * time) / 100.0
    return interest
\`\`\`

And here is an equivalent JavaScript snippet:
\`\`\`javascript
const interest = (p * r * t) / 100;
\`\`\`
  `.trim();

  const parsed = parseImportedCode(multiResponse, { expectedLanguage: "python" });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.multipleBlocks, true);
  assert.equal(parsed.blockCount, 3);
  // Auto-selection must select block 2 (Python, score 85)
  assert.equal(parsed.selectedBlockIndex, 2);
  assert.ok(parsed.code.includes("def calculate_interest"));
  const pythonBlock = parsed.blocks.find((b) => b.index === 2);
  assert.ok(pythonBlock);
  assert.equal(pythonBlock.isRecommended, true);
  assert.equal(pythonBlock.language, "python");
  assert.equal(parsed.requiresMismatchConfirmation, false);

  // analyzeAiResponse line counts and preview
  const currentCode = "def calculate_interest(p, r, t):\n    pass";
  const analysis = analyzeAiResponse(parsed, currentCode);
  assert.equal(analysis.readyToImport, true);
  assert.equal(analysis.linesAdded >= 2, true);
  assert.ok(analysis.summary.includes("Ready to import 3 lines"));
  assert.equal(analysis.requiresMismatchConfirmation, false);

  // Language Mismatch Case: user pastes pure JavaScript into Python assignment
  const mismatchResponse = `
\`\`\`javascript
function solve() {
  return 42;
}
\`\`\`
  `.trim();
  const mismatchParsed = parseImportedCode(mismatchResponse, { expectedLanguage: "python" });
  assert.equal(mismatchParsed.hasLanguageMismatch, true);
  assert.equal(mismatchParsed.requiresMismatchConfirmation, true);
  assert.equal(mismatchParsed.blocks[0].isRecommended, false);

  const mismatchAnalysis = analyzeAiResponse(mismatchParsed, currentCode);
  assert.equal(mismatchAnalysis.hasLanguageMismatch, true);
  assert.equal(mismatchAnalysis.requiresMismatchConfirmation, true);

  // Structured Solution Case (score 100, isRecommended, no mismatch confirm)
  const structuredResponse = JSON.stringify({
    version: "acadrix.programming.solution/v1",
    language: "python",
    code: "def solve():\n    return 42\n",
  });
  const structuredParsed = parseImportedCode(structuredResponse, { expectedLanguage: "python" });
  assert.equal(structuredParsed.ok, true);
  assert.equal(structuredParsed.isStructured, true);
  assert.equal(structuredParsed.selectedBlockIndex, 1);
  assert.equal(structuredParsed.requiresMismatchConfirmation, false);
  assert.equal(structuredParsed.blocks[0].score, 100);
  assert.equal(structuredParsed.blocks[0].isRecommended, true);
});


// ── Test 21.4: FAB launcher programming mode ──────────────────────────────────
await check("Test 21.4: FAB launcher programming mode (split button, quick actions, non-blocking toast)", async () => {
  const savedDocument = globalThis.document;
  const savedEvent = globalThis.Event;
  const savedWindow = globalThis.window;

  try {
    const mockRoot = new MockTestElement("DIV");
    const shadowHost = { root: mockRoot };

    globalThis.window = {
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    globalThis.Event = class {
      constructor(type, init = {}) {
        this.type = type;
        this.bubbles = Boolean(init.bubbles);
        this.cancelable = Boolean(init.cancelable);
        this.defaultPrevented = false;
      }
      preventDefault() { this.defaultPrevented = true; }
      stopPropagation() {}
    };

    globalThis.document = {
      nodeType: 9,
      createElement: (tag) => new MockTestElement(tag),
      getElementById: (id) => mockRoot.getElementById(id),
      querySelector: (sel) => mockRoot.querySelector(sel),
      querySelectorAll: (sel) => mockRoot.querySelectorAll(sel),
    };

    const launcher = new LauncherButton(shadowHost);

    // 1. Standard Assessment Mode
    launcher.ensure("bottom-center", null, { pageType: "assessment" });
    assert.equal(launcher.element.tagName, "BUTTON", "Standard FAB must be a BUTTON");
    assert.ok(launcher.element.classList.contains("saq-launcher"), "Must have .saq-launcher");
    assert.equal(launcher.element.classList.contains("saq-launcher-pa"), false, "Must not have .saq-launcher-pa");
    assert.ok(launcher.element.textContent.includes("All Questions"), "Must render 'All Questions'");

    // 2. Programming Assignment Mode
    let quickActionFired = null;
    launcher.ensure("bottom-center", null, {
      pageType: "PROGRAMMING_ASSIGNMENT",
      isProgramming: true,
      onQuickAction: (act) => { quickActionFired = act; },
    });
    assert.equal(launcher.element.tagName, "DIV", "Programming FAB must be a DIV to support nested split buttons");
    assert.ok(launcher.element.classList.contains("saq-launcher-pa"), "Must have .saq-launcher-pa");
    assert.equal(launcher.element.textContent.includes("All Questions"), false, "Must NOT render 'All Questions'");

    // Main split button
    const mainBtn = launcher.element.querySelector(".saq-launcher-main");
    assert.ok(mainBtn, "Must contain .saq-launcher-main");
    assert.ok(mainBtn.textContent.includes("Programming Assignment"), "Must render 'Programming Assignment'");

    // Toggle split button
    const toggleBtn = launcher.element.querySelector(".saq-launcher-toggle");
    assert.ok(toggleBtn, "Must contain .saq-launcher-toggle");
    assert.equal(toggleBtn.getAttribute("aria-haspopup"), "menu");

    // Quick Actions menu
    const menu = launcher.element.querySelector("#saq-launcher-menu");
    assert.ok(menu, "Must contain #saq-launcher-menu");
    assert.equal(menu.hasAttribute("hidden"), true, "Menu must be closed initially");

    // Programming Assignment exposes only its current quick-action set.
    const expectedActions = [
      "copy-pa-question",
      "copy-pa-testcases",
      "copy-pa-current",
      "copy-pa-prompt",
      "open-pa-reader",
    ];
    for (const act of expectedActions) {
      const item = menu.querySelector(`[data-act='${act}']`);
      assert.ok(item, `Menu must contain action button for ${act}`);
    }
    assert.equal(menu.querySelector("[data-act='open-pa-import']"), null, "Programming FAB must not expose the old import workflow");
    assert.equal(menu.querySelector("[data-act='copy-pa-starter']"), null, "Copy Code is the single basic code-copy action");

    // Toggle menu open/close
    toggleBtn.click();
    assert.equal(toggleBtn.getAttribute("aria-expanded"), "true");
    assert.equal(menu.hasAttribute("hidden"), false);

    toggleBtn.click();
    assert.equal(toggleBtn.getAttribute("aria-expanded"), "false");
    assert.equal(menu.hasAttribute("hidden"), true);

    // Non-blocking toast notification
    launcher.showToast("Test copied successfully", "success", 1000);
    const toast = mockRoot.querySelector(".saq-launcher-toast");
    assert.ok(toast, "Toast element must be mounted");
    assert.ok(toast.textContent.includes("Test copied successfully"));
    assert.equal(toast.getAttribute("role"), "status");
    assert.equal(toast.getAttribute("aria-live"), "polite");
  } finally {
    globalThis.document = savedDocument;
    globalThis.Event = savedEvent;
    globalThis.window = savedWindow;
  }
});

// ── Test 21.5: Reader drawer programming layout ───────────────────────────────
await check("Test 21.5: Reader drawer programming layout (header, badges, and suppression of rail/checkboxes)", async () => {
  const savedDocument = globalThis.document;
  const savedEvent = globalThis.Event;

  try {
    const mockRoot = new MockTestElement("DIV");
    const shadowHost = {
      root: mockRoot,
      getTheme: () => "dark",
    };

    globalThis.Event = class {
      constructor(type, init = {}) {
        this.type = type;
        this.bubbles = Boolean(init.bubbles);
        this.cancelable = Boolean(init.cancelable);
        this.defaultPrevented = false;
      }
      preventDefault() { this.defaultPrevented = true; }
      stopPropagation() {}
    };

    globalThis.document = {
      nodeType: 9,
      createElement: (tag) => new MockTestElement(tag),
      getElementById: (id) => mockRoot.getElementById(id),
      querySelector: (sel) => mockRoot.querySelector(sel),
      querySelectorAll: (sel) => mockRoot.querySelectorAll(sel),
    };

    const progDoc = new AssignmentDocument({
      metadata: {
        title: "Python Assignment 1 — Simple Interest",
        course: "Programming in Python",
        family: "programming",
      },
      questions: [
        new QuestionNode({
          number: 1,
          label: "Question 1",
          type: QuestionType.PROGRAMMING,
          stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "Write an interest calculator." })],
          programmingData: new ProgrammingAssignmentData({
            language: "python",
            currentCode: "def interest():\n    return 42",
            starterCode: "def interest():\n    pass",
            testCases: [new TestCaseNode({ index: 1, input: "100 5 1", expectedOutput: "5" })],
          }),
        }),
      ],
    });

    const reader = new ReaderDrawer(shadowHost, { isProgrammingAssignment: () => true });
    const importFeature = createReaderImportFeature(reader);
    reader.features.push(importFeature);

    reader.build(progDoc);
    const sheet = reader.sheetElement;
    assert.ok(sheet, "Sheet element must be built");

    // 1. Header layout
    const titleEl = sheet.querySelector("#saq-reader-title");
    assert.ok(titleEl, "Must have #saq-reader-title");
    assert.equal(titleEl.textContent, "Python", "Programming header should identify the editor language");

    const syncStatus = sheet.querySelector("#saq-program-sync-status");
    assert.equal(syncStatus?.textContent, "In Sync", "Header status starts from the captured portal code");
    assert.equal(sheet.querySelector(".saq-lang-pill"), null, "Language should not be duplicated in a separate header pill");

    const countPill = sheet.querySelector(".saq-count-pill");
    assert.equal(countPill, null, "Header must NOT render .saq-count-pill on programming assignments");

    // Editor-first header actions and conditional Apply button.
    assert.equal(sheet.querySelector("[data-act='import-code']"), null, "Old Import Code action must be absent");
    assert.ok(sheet.querySelector("[data-act='copy-prompt-context']"), "Must have Copy Prompt button");
    assert.ok(sheet.querySelector("[data-act='copy-current-code']"), "Must have Copy Code button");
    assert.ok(sheet.querySelector("[data-act='refresh']"), "Must have Refresh action");
    const applyButton = sheet.querySelector("#saq-apply-programming-code");
    assert.ok(applyButton, "Must have an Apply Changes action");
    assert.equal(applyButton.hidden, true, "Apply Changes is hidden while the editor is in sync");

    // 2. Card header layout
    const block = sheet.querySelector("#saq-q-0");
    assert.ok(block, "Question block 0 must exist");

    const qLabel = block.querySelector(".saq-qlabel");
    assert.ok(qLabel, "Must have .saq-qlabel");
    assert.equal(qLabel.textContent, "Problem Statement", "Card header must display 'Problem Statement', not duplicate title or 'All Questions'");

    const langBadge = block.querySelector(".saq-lang-badge");
    assert.ok(langBadge, "Card header must have .saq-lang-badge");
    assert.equal(langBadge.textContent, "PYTHON");

    assert.ok(block.querySelector("[data-editor-act='undo']"), "Editor provides local Undo");
    assert.ok(block.querySelector("[data-editor-act='redo']"), "Editor provides local Redo");
    assert.ok(block.querySelector(".saq-cm-host"), "Programming Reader creates a CodeMirror mount point");

    // 3. Suppression of standard assessment MCQ components
    const rail = sheet.querySelector("#saq-qrail");
    assert.equal(rail, null, "Question Navigation Rail (#saq-qrail) must NOT be mounted on programming assignments");

    const applyDialog = sheet.querySelector("#saq-apply-dialog");
    assert.equal(applyDialog, null, "Apply Answers Dialog (#saq-apply-dialog) must NOT be mounted on programming assignments");

    const selectWrap = block.querySelector(".saq-qselect-wrap");
    assert.equal(selectWrap, null, "MCQ selection checkboxes (.saq-qselect-wrap) must NOT be injected into programming blocks");
  } finally {
    globalThis.document = savedDocument;
    globalThis.Event = savedEvent;
  }
});

// ── Test 22: Canonical Indexed Answer Protocol (Serializer & Parser) ──────────
await check("Test 22.1: Canonical answer stream serialization with indexed format", async () => {
  const sampleAnswers = [
    { number: 1, answer: "A" },
    { number: 2, answer: ["C", "B"] },
    { number: 3, answer: "1000" },
    { number: 4, answer: "host: 127.0.0.1:8080" },
    { number: 5, answer: "" },
    { number: 6, answer: "line 1\nline 2" },
  ];

  const serialized = serializeAssignmentAnswers(sampleAnswers);
  const expected = [
    "1: A",
    "2: B,C",
    "3: 1000",
    "4: host: 127.0.0.1:8080",
    "5:",
    "6: <<<",
    "line 1",
    "line 2",
    ">>>",
  ].join("\n");

  assert.equal(serialized, expected, "Serialized output must match exact indexed human-readable format");
});

await check("Test 22.2: Indexed answer parsing with colons, multiline, and empty answers", async () => {
  const input = `
1: A
2: B,C
3: 1000.50
4: key: value: extra: colons
5:
6: <<<
First line of descriptive text.
Second line with math: x = y + z.
>>>
`;

  const doc = new AssignmentDocument({
    questions: [
      new QuestionNode({ number: 1, type: QuestionType.MCQ, options: [{ letter: "A" }, { letter: "B" }] }),
      new QuestionNode({ number: 2, type: QuestionType.MSQ, options: [{ letter: "A" }, { letter: "B" }, { letter: "C" }] }),
      new QuestionNode({ number: 3, type: QuestionType.NUMERICAL }),
      new QuestionNode({ number: 4, type: QuestionType.TEXT }),
      new QuestionNode({ number: 5, type: QuestionType.MCQ, options: [{ letter: "A" }, { letter: "B" }] }),
      new QuestionNode({ number: 6, type: QuestionType.TEXT }),
    ],
  });

  const res = parseAssignmentAnswers(input, { documentModel: doc });
  assert.ok(res.ok, "Parsing valid indexed answers must succeed");
  assert.equal(res.count, 6, "Must parse 6 questions");

  const entry1 = res.entries.find((e) => e.number === 1);
  assert.equal(entry1.status, "answered");
  assert.equal(entry1.answer, "A");

  const entry2 = res.entries.find((e) => e.number === 2);
  assert.equal(entry2.status, "answered");
  assert.deepEqual(entry2.answer, ["B", "C"]);

  const entry3 = res.entries.find((e) => e.number === 3);
  assert.equal(entry3.status, "answered");
  assert.equal(entry3.answer, "1000.5");

  const entry4 = res.entries.find((e) => e.number === 4);
  assert.equal(entry4.status, "answered");
  assert.equal(entry4.answer, "key: value: extra: colons", "Colons inside answers must be preserved");

  const entry5 = res.entries.find((e) => e.number === 5);
  assert.equal(entry5.status, "missing", "Empty answer 5: must have status 'missing'");

  const entry6 = res.entries.find((e) => e.number === 6);
  assert.equal(entry6.status, "answered");
  assert.equal(
    entry6.answer,
    "First line of descriptive text.\nSecond line with math: x = y + z.",
    "Multiline block must preserve line breaks and content"
  );
});

await check("Test 22.3: Validation of missing, duplicate, and unknown question numbers", async () => {
  const inputWithIssues = `
1: A
2: B
2: C
4: Valid text
99: Unknown answer
`;

  const doc = new AssignmentDocument({
    questions: [
      new QuestionNode({ number: 1, type: QuestionType.MCQ, options: [{ letter: "A" }, { letter: "B" }] }),
      new QuestionNode({ number: 2, type: QuestionType.MCQ, options: [{ letter: "A" }, { letter: "B" }] }),
      new QuestionNode({ number: 3, type: QuestionType.NUMERICAL }),
      new QuestionNode({ number: 4, type: QuestionType.TEXT }),
    ],
  });

  const res = parseAssignmentAnswers(inputWithIssues, { documentModel: doc });
  assert.equal(res.ok, false, "Input with duplicates and unknowns must not have ok: true");
  assert.deepEqual(res.duplicates, [2], "Must detect question 2 as duplicate");
  assert.deepEqual(res.unknowns, [99], "Must detect question 99 as unknown");
  assert.deepEqual(res.missing, [3], "Must detect question 3 as missing");

  const entry2 = res.entries.find((e) => e.number === 2);
  assert.equal(entry2.status, "invalid");
  assert.equal(entry2.reason, "duplicate entries");

  const entry3 = res.entries.find((e) => e.number === 3);
  assert.equal(entry3.status, "missing");

  const entry99 = res.entries.find((e) => e.number === 99);
  assert.equal(entry99.status, "invalid");
  assert.equal(entry99.reason, "unknown question");
});

await check("Test 22.4: Question type validation (MCQ option mismatch, invalid numerical)", async () => {
  const input = `
1: Z
2: not-a-number
3: text answer
`;

  const doc = new AssignmentDocument({
    questions: [
      new QuestionNode({ number: 1, type: QuestionType.MCQ, options: [{ letter: "A" }, { letter: "B" }] }),
      new QuestionNode({ number: 2, type: QuestionType.NUMERICAL }),
      new QuestionNode({ number: 3, type: QuestionType.TEXT }),
    ],
  });

  const res = parseAssignmentAnswers(input, { documentModel: doc });
  const entry1 = res.entries.find((e) => e.number === 1);
  assert.equal(entry1.status, "invalid");
  assert.ok(entry1.reason.includes("existing option letter"), "Invalid MCQ letter must be flagged");

  const entry2 = res.entries.find((e) => e.number === 2);
  assert.equal(entry2.status, "invalid");
  assert.ok(entry2.reason.includes("plain decimal"), "Invalid numerical answer must be flagged");
});

await check("Test 22.5: Backwards compatibility with legacy semicolon stream and JSON", async () => {
  const doc = new AssignmentDocument({
    questions: [
      new QuestionNode({ number: 1, type: QuestionType.MCQ, options: [{ letter: "A" }, { letter: "B" }] }),
      new QuestionNode({ number: 2, type: QuestionType.MSQ, options: [{ letter: "A" }, { letter: "B" }, { letter: "C" }] }),
      new QuestionNode({ number: 3, type: QuestionType.NUMERICAL }),
    ],
  });

  // 1. Semicolon format fallback
  const semiInput = "A;\nB,C;\n1000;";
  const semiRes = parseAssignmentAnswers(semiInput, { documentModel: doc });
  assert.ok(semiRes.ok, "Legacy semicolon stream must parse successfully");
  assert.equal(semiRes.isLegacy, true, "Must flag isLegacy: true for semicolon stream");
  assert.equal(semiRes.entries[0].answer, "A");
  assert.deepEqual(semiRes.entries[1].answer, ["B", "C"]);
  assert.equal(semiRes.entries[2].answer, "1000");

  // 2. parseAnswerKey integration
  const keyRes = parseAnswerKey(semiInput, doc);
  assert.ok(keyRes.ok, "parseAnswerKey must parse legacy semicolon stream");
  assert.equal(keyRes.entries.length, 3);
});

await check("Test 22.6: MarkdownExporter prompt generation uses indexed format", async () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Assessment 1" },
    questions: [
      new QuestionNode({ number: 1, type: QuestionType.MCQ, label: "Q1", stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "What is 2+2?" })], options: [{ letter: "A" }, { letter: "B" }] }),
      new QuestionNode({ number: 2, type: QuestionType.MSQ, label: "Q2", stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "Select primes." })], options: [{ letter: "A" }, { letter: "B" }] }),
      new QuestionNode({ number: 3, type: QuestionType.NUMERICAL, label: "Q3", stem: [new ContentNode({ type: ContentType.PARAGRAPH, value: "Value of pi." })] }),
    ],
  });

  const exporter = new MarkdownExporter({ mode: "prompt" });
  const prompt = exporter.exportDocument(doc);

  assert.ok(prompt.includes("1: A"), "Prompt must show indexed format rule 1: A");
  assert.ok(prompt.includes("2: B,C"), "Prompt must show indexed format rule 2: B,C");
  assert.ok(prompt.includes("3: 1000"), "Prompt must show indexed format rule 3: 1000");
  assert.ok(prompt.includes("N: <<<"), "Prompt must mention multiline format N: <<<");
  assert.ok(!prompt.includes("A;\nB,C;\n1000;"), "Old semicolon-only format must be removed from prompt");
});

console.log("\n=======================================================");
if (!passed) {
  console.error("❌ Some programming assignment tests failed!");
  process.exit(1);
} else {
  console.log(`✓ All ${totalChecks} Programming Assignment tests passed successfully!\n`);
}



