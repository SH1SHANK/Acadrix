#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import { ContentType, QuestionType } from "../src/model/types.js";
import { ExportSession, createPdfDataUrlResourceMap } from "../src/orchestration/session.js";
import { exportAssignmentToText } from "../src/exporters/plain-text.js";
import { normalizeDocument } from "../src/document/normalizer.js";
import { applyResolvedImageDataUrls, compilePdfDefinition } from "../src/document/compiler.js";
import { DocNodeType } from "../src/document/ast.js";

const imageBytes = new Uint8Array([1, 2, 3]);
const source = "https://portal.example/problem-figure.png";
const documentModel = {
  metadata: { title: "Rich Programming Problem", course: "CS101", week: "Week 2", url: "https://portal.example/" },
  questions: [
    {
      number: 1,
      label: "Question 1 — Image processing",
      type: QuestionType.PROGRAMMING,
      marks: 10,
      stem: [
        { type: ContentType.HEADING, value: "Problem statement" },
        {
          type: ContentType.PARAGRAPH,
          value: "Compute the area shown in the figure.",
          children: [{ type: ContentType.TEXT, value: "Compute the area shown in the figure." }],
        },
        {
          type: ContentType.FIGURE,
          attributes: { caption: "Diagram 1: input geometry" },
          children: [
            { type: ContentType.IMAGE, attributes: { src: source, alt: "A labelled triangle", width: "320" } },
          ],
        },
        {
          type: ContentType.CODE_BLOCK,
          value: "return area;\n",
          attributes: { language: "javascript" },
        },
        {
          type: ContentType.TABLE,
          attributes: { caption: "Sample values" },
          children: [
            { type: ContentType.TABLE_ROW, children: [
              { type: ContentType.TABLE_CELL, value: "Input" },
              { type: ContentType.TABLE_CELL, value: "Output" },
            ] },
            { type: ContentType.TABLE_ROW, children: [
              { type: ContentType.TABLE_CELL, value: "2 3" },
              { type: ContentType.TABLE_CELL, value: "3" },
            ] },
          ],
        },
        { type: ContentType.MATH, value: "A = \\frac{b h}{2}" },
        {
          type: ContentType.LINK,
          value: "Reference",
          attributes: { href: "https://portal.example/reference" },
        },
      ],
      options: [],
      programmingData: {
        language: "javascript",
        starterCode: "function area() {\n  return 0;\n}",
        currentCode: "function area() {\n  return 3;\n}",
        testCases: [{
          index: 1,
          description: "basic",
          input: "2 3",
          expectedOutput: "3",
          actualOutput: "3\n  4",
          actualOutputAvailable: true,
          status: "failed",
          executionStatusAvailable: true,
        }, {
          index: 2,
          description: "unavailable",
          input: "0",
          expectedOutput: "0",
          actualOutput: "",
          actualOutputAvailable: false,
          status: "passed",
          executionStatusAvailable: false,
        }],
      },
    },
  ],
};

const dataUrlMap = createPdfDataUrlResourceMap([{
  source,
  normalizedSource: source,
  localPath: "assets/question-1-image-1.png",
  mimeType: "image/png",
  data: imageBytes,
  status: "downloaded",
}]);
assert.equal(dataUrlMap.get(source), "data:image/png;base64,AQID");
assert.equal(dataUrlMap.get("assets/question-1-image-1.png"), "data:image/png;base64,AQID");
const inferredDataUrlMap = createPdfDataUrlResourceMap([{
  source: "https://portal.example/without-content-type.png",
  data: imageBytes,
  status: "downloaded",
}]);
assert.equal(inferredDataUrlMap.get("https://portal.example/without-content-type.png"), "data:image/png;base64,AQID");

const normalized = normalizeDocument(documentModel);
const normalizedFigure = normalized.questions[0].stem.find((node) => node.type === DocNodeType.FIGURE);
const normalizedTestCase = normalized.questions[0].stem.find((node) => node.type === DocNodeType.TEST_CASE);
assert.ok(normalizedFigure, "figure survives semantic PDF normalization");
assert.equal(normalizedFigure.caption, "Diagram 1: input geometry");
assert.equal(normalizedFigure.children[0].src, source);
assert.equal(normalizedTestCase.actualOutput, "3\n  4");
assert.equal(normalizedTestCase.actualOutputAvailable, true);
assert.equal(normalizedTestCase.executionStatusAvailable, true);
assert.equal(normalizedTestCase.status, "failed");
const unavailableTestCase = normalized.questions[0].stem.filter((node) => node.type === DocNodeType.TEST_CASE)[1];
assert.equal(unavailableTestCase.actualOutputAvailable, false);
assert.equal(unavailableTestCase.executionStatusAvailable, false);
assert.equal(unavailableTestCase.status, null, "Unverified status must not survive explicit unavailability");

const proseWithSimilarTerms = normalizeDocument({
  metadata: { title: "Test case extraction fixture" },
  questions: [{
    number: 1,
    type: QuestionType.PROGRAMMING,
    stem: [{
      type: ContentType.PARAGRAPH,
      value: "The test cases described in the prompt compare expected output for each sample.",
    }],
    programmingData: {
      language: "python",
      testCases: [{ index: 1, input: "1", expectedOutput: "2" }],
    },
  }],
});
assert.equal(
  proseWithSimilarTerms.questions[0].stem.filter((node) => node.type === DocNodeType.TEST_CASE).length,
  1,
  "Mentioning test cases and expected output in prose must not suppress structured extracted cases"
);
applyResolvedImageDataUrls(normalized, dataUrlMap);
assert.equal(normalizedFigure.children[0].dataUrl, "data:image/png;base64,AQID");

const semanticLongCode = Array.from({ length: 13 }, (_, index) => `  const value${index} = ${index};`).join("\n");
const semanticLongOutput = Array.from({ length: 13 }, (_, index) => `output ${index}`).join("\n");
const semanticLayout = compilePdfDefinition(normalizeDocument({
  metadata: { title: "Semantic pagination fixture" },
  questions: [{
    number: 1,
    type: QuestionType.PROGRAMMING,
    stem: [{ type: ContentType.CODE_BLOCK, value: "function small() {\n  return 1;\n}", attributes: { language: "javascript" } }],
    programmingData: {
      language: "javascript",
      currentCode: semanticLongCode,
      testCases: [
        { index: 1, input: "1", expectedOutput: "2", actualOutput: "2", actualOutputAvailable: true },
        { index: 2, input: semanticLongOutput, expectedOutput: semanticLongOutput, actualOutput: semanticLongOutput, actualOutputAvailable: true },
      ],
    },
  }],
}));
const findSemanticNode = (value, predicate) => {
  if (Array.isArray(value)) {
    for (const child of value) {
      const match = findSemanticNode(child, predicate);
      if (match) return match;
    }
  } else if (value && typeof value === "object") {
    if (predicate(value)) return value;
    for (const child of Object.values(value)) {
      const match = findSemanticNode(child, predicate);
      if (match) return match;
    }
  }
  return null;
};
const semanticLongCodeBlock = findSemanticNode(semanticLayout.content, (node) =>
  node.table?.dontBreakRows !== undefined && JSON.stringify(node).includes("value12")
);
const semanticSmallCodeBlock = findSemanticNode(semanticLayout.content, (node) =>
  node.table?.dontBreakRows !== undefined && JSON.stringify(node).includes("small")
);
const semanticLongCase = findSemanticNode(semanticLayout.content, (node) =>
  node.stack?.[0]?.columns?.[0]?.text?.includes("Test Case 2")
);
const semanticSmallCase = findSemanticNode(semanticLayout.content, (node) =>
  node.stack?.[0]?.columns?.[0]?.text?.includes("Test Case 1")
);
assert.equal(semanticLongCodeBlock?.table?.dontBreakRows, false, "long semantic code can split across pages");
assert.equal(semanticSmallCodeBlock?.table?.dontBreakRows, true, "small semantic code remains together");
assert.equal(semanticLongCase?.unbreakable, false, "long semantic test cases can split across pages");
assert.equal(semanticSmallCase?.unbreakable, true, "small semantic test cases remain together");
const normalizedExternalSvg = normalizeDocument({
  metadata: {},
  questions: [{ number: 1, stem: [{
    type: ContentType.SVG,
    attributes: { src: "https://portal.example/diagram.svg", title: "Diagram" },
  }] }],
}).questions[0].stem[0];
assert.equal(normalizedExternalSvg.type, DocNodeType.IMAGE, "external SVG references remain embeddable PDF images");
assert.equal(normalizedExternalSvg.src, "https://portal.example/diagram.svg");

const text = exportAssignmentToText(documentModel);
for (const expected of [
  "Rich Programming Problem",
  "Question 1 — Image processing",
  "A labelled triangle",
  source,
  "Diagram 1: input geometry",
  "Sample values",
  "Input | Output",
  "A = \\frac{b h}{2}",
  "Reference (https://portal.example/reference)",
  "Expected Output:\n3",
  "function area() {\n  return 3;\n}",
]) {
  assert.ok(text.includes(expected), `TXT export retains: ${expected}`);
}
assert.ok(!text.includes("**"), "TXT output does not retain Markdown emphasis markers");

const session = new ExportSession({ document: documentModel });
const exported = await session.run({
  formats: ["markdown", "text", "pdf"],
  autoDownload: false,
  resourceOptions: {
    retries: 0,
    fetchFn: async () => ({
      ok: true,
      headers: { get: () => "image/png" },
      arrayBuffer: async () => imageBytes.buffer,
    }),
  },
});
assert.match(exported.outputs.markdown, /!\[A labelled triangle\]\(assets\/q01-image-01\.png\)/);
assert.ok(exported.outputs.text.includes("A labelled triangle"));
assert.match(exported.outputs.pdf.html, /data:image\/png;base64,AQID/);
assert.match(exported.outputs.pdf.html, /Diagram 1: input geometry/);
assert.match(exported.outputs.pdf.html, /Actual Output/);
assert.match(exported.outputs.pdf.html, /Actual output unavailable/);
assert.match(exported.outputs.pdf.html, /Execution status unavailable/);
assert.ok(exported.outputs.pdf.html.includes("3\n  4"));
assert.match(exported.outputs.pdf.html, /saq-pdf-token-keyword/);
assert.match(exported.outputs.pdf.html, /saq-pdf-code-block is-compact/);
assert.equal(exported.resourceStats.downloaded, 1);

const readerSource = fs.readFileSync(new URL("../src/ui/reader.js", import.meta.url), "utf8");
assert.match(readerSource, /data-act="export-txt"/);
assert.match(readerSource, /Download as PDF/);
assert.match(readerSource, /Download as Markdown/);
assert.match(readerSource, /Download as TXT File/);
const popup = fs.readFileSync(new URL("../extension/popup.html", import.meta.url), "utf8");
assert.match(popup, /icons\/icon-48\.png/);
assert.match(popup, /Acadrix • © made with ❤️ by sh1shank/);

console.log("✓ Programming rich-content Markdown, TXT, PDF, and branding export checks passed");
