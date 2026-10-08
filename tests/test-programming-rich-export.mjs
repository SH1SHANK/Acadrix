#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import { ContentType, QuestionType } from "../src/model/types.js";
import { ExportSession, createPdfDataUrlResourceMap } from "../src/orchestration/session.js";
import { exportAssignmentToText } from "../src/exporters/plain-text.js";
import { normalizeDocument } from "../src/document/normalizer.js";
import { applyResolvedImageDataUrls } from "../src/document/compiler.js";
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
        testCases: [{ index: 1, description: "basic", input: "2 3", expectedOutput: "3" }],
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
assert.ok(normalizedFigure, "figure survives semantic PDF normalization");
assert.equal(normalizedFigure.caption, "Diagram 1: input geometry");
assert.equal(normalizedFigure.children[0].src, source);
applyResolvedImageDataUrls(normalized, dataUrlMap);
assert.equal(normalizedFigure.children[0].dataUrl, "data:image/png;base64,AQID");
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
assert.equal(exported.resourceStats.downloaded, 1);

const readerSource = fs.readFileSync(new URL("../src/ui/reader.js", import.meta.url), "utf8");
assert.match(readerSource, /data-act="export-txt"/);
assert.match(readerSource, /Download as PDF/);
assert.match(readerSource, /Download as Markdown/);
assert.match(readerSource, /Download as TXT File/);
const popup = fs.readFileSync(new URL("../extension/popup.html", import.meta.url), "utf8");
assert.match(popup, /icons\/icon-48\.png/);
assert.match(popup, /© 2026 civiks · MIT License/);

console.log("✓ Programming rich-content Markdown, TXT, PDF, and branding export checks passed");
