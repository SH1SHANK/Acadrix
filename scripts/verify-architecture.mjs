#!/usr/bin/env node
/**
 * Architecture-Level Verification Script.
 * Ensures the codebase adheres to Phase 1.1 boundaries and prevents regressions.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let passed = true;

function fail(msg) {
  console.error(`❌ [Architecture Error] ${msg}`);
  passed = false;
}

function check(desc, fn) {
  try {
    fn();
    console.log(`✓ ${desc}`);
  } catch (e) {
    fail(`${desc}: ${e.message}`);
  }
}

function getAllFiles(dir, exts = [".js", ".mjs"]) {
  let files = [];
  for (const item of readdirSync(dir)) {
    const full = join(dir, item);
    if (statSync(full).isDirectory()) {
      files = files.concat(getAllFiles(full, exts));
    } else if (exts.some((ext) => item.endsWith(ext))) {
      files.push(full);
    }
  }
  return files;
}

const srcFiles = getAllFiles("src");

// 1. Verify answer proxy infrastructure has been completely purged
check("No answer-proxy functions remain in src/", () => {
  const forbiddenPatterns = [
    /\bproxy\s*\(/,
    /\bwaitSaved\s*\(/,
    /\bisSaved\s*\(/,
    /\bbakeValues\s*\(/,
    /\bSAVE_TIMEOUT\b/,
    /\bis-syncing\b/,
    /\bsaq-unsaved\b/,
    /app-save-status.*wait/,
  ];

  for (const file of srcFiles) {
    const content = readFileSync(file, "utf8");
    for (const pat of forbiddenPatterns) {
      if (pat.test(content)) {
        throw new Error(`File ${file} contains forbidden answer-proxy pattern: ${pat}`);
      }
    }
  }
});

// 2. Verify UI modules do NOT import IITM_SELECTORS directly
check("UI modules do not directly depend on IITM selectors", () => {
  const uiFiles = getAllFiles("src/ui");
  for (const file of uiFiles) {
    const content = readFileSync(file, "utf8");
    if (content.includes("IITM_SELECTORS") || content.includes("../portal/selectors.js")) {
      throw new Error(`UI file ${file} directly imports IITM_SELECTORS; must go through portal adapter`);
    }
  }
});

// 3. Verify Shadow DOM encapsulation is used in UI
check("UI uses Shadow DOM encapsulation", () => {
  const shadowFile = "src/ui/shadow.js";
  const content = readFileSync(shadowFile, "utf8");
  if (!content.includes("attachShadow") || !content.includes("unfold-root")) {
    throw new Error(`${shadowFile} must implement attachShadow on unfold-root`);
  }
});

// 4. Verify Document Model contract is established and rawHtml is legacy-only
check("Canonical Document Model contract classes exist with legacy boundary", () => {
  const docFile = "src/model/document.js";
  const content = readFileSync(docFile, "utf8");
  const requiredClasses = ["AssignmentDocument", "QuestionNode", "OptionNode", "ContentNode"];
  for (const cls of requiredClasses) {
    if (!content.includes(`class ${cls}`)) {
      throw new Error(`${docFile} missing contract class: ${cls}`);
    }
  }
  if (!content.includes("legacyMigrationData")) {
    throw new Error(`${docFile} must explicitly mark rawHtml as legacyMigrationData`);
  }
});

// 5. Verify dedicated Document Assembler exists
check("AssignmentAssembler exists and decouples document creation", () => {
  const assemblerFile = "src/model/assembler.js";
  const content = readFileSync(assemblerFile, "utf8");
  if (!content.includes("class AssignmentAssembler")) {
    throw new Error(`${assemblerFile} must define class AssignmentAssembler`);
  }
});

// 6. Verify QuestionTraverser does NOT construct or import AssignmentDocument
check("QuestionTraverser is decoupled from document assembly", () => {
  const traverserFile = "src/traversal/traverser.js";
  const content = readFileSync(traverserFile, "utf8");
  if (/^\s*import\b.*?\bAssignmentDocument\b/m.test(content) || /\bnew\s+AssignmentDocument\b/.test(content) || content.includes("../model/document.js")) {
    throw new Error(`${traverserFile} must not import or construct AssignmentDocument; traversal only exposes questions`);
  }
  if (/^\s*import\b.*?\bAssessmentExtractor\b/m.test(content) || /\bnew\s+AssessmentExtractor\b/.test(content) || content.includes("../extraction/extractor.js")) {
    throw new Error(`${traverserFile} must not depend on AssessmentExtractor`);
  }
});

// 7. Verify Portal Adapter encapsulates DOM queries
check("Portal adapter exists and encapsulates assessment queries", () => {
  const adapterFile = "src/portal/adapter.js";
  const content = readFileSync(adapterFile, "utf8");
  const requiredMethods = ["detectAssessment", "getQuestionChips", "getCurrentQuestionElement"];
  for (const method of requiredMethods) {
    if (!content.includes(method)) {
      throw new Error(`${adapterFile} missing required method: ${method}`);
    }
  }
});

// 8. Verify no unsupported CSS pseudo-selectors (:contains) are used in src/
check("No unsupported :contains pseudo-selectors exist in src/", () => {
  for (const file of srcFiles) {
    const rawContent = readFileSync(file, "utf8");
    // Strip multi-line and single-line comments
    const stripped = rawContent
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    if (/:contains\b/.test(stripped)) {
      throw new Error(`File ${file} contains unsupported non-standard CSS selector :contains`);
    }
  }
});

// 9. Verify Bookmarklet Target Boundary & Architectural Membership
check("Bookmarklet target contains only allowed compatibility modules", () => {
  const buildMjsContent = readFileSync("build.mjs", "utf8");
  if (!buildMjsContent.includes("BOOKMARKLET_MODULES") || !buildMjsContent.includes("EXTENSION_MODULES")) {
    throw new Error("build.mjs must maintain distinct BOOKMARKLET_MODULES and EXTENSION_MODULES lists");
  }

  // Define future/extension-only module patterns that must NEVER enter bookmarklet
  const forbiddenBookmarkletPatterns = [
    /\bsrc\/exporters\//,
    /\bsrc\/parsers\//,
    /\bsrc\/resources\//,
    /\bsrc\/orchestration\//,
    /\bmarkdown\b/i,
    /\bpdf\b/i,
  ];

  const match = buildMjsContent.match(/(?:const|export const)\s+BOOKMARKLET_MODULES\s*=\s*\[([\s\S]*?)\];/);
  if (!match) {
    throw new Error("Could not parse BOOKMARKLET_MODULES in build.mjs");
  }
  const bookmarkletModuleList = match[1];

  for (const pattern of forbiddenBookmarkletPatterns) {
    if (pattern.test(bookmarkletModuleList)) {
      throw new Error(`BOOKMARKLET_MODULES contains forbidden extension-only module pattern: ${pattern}`);
    }
  }

  // Verify that bookmarklet still contains all essential traversal & portal dependencies
  const requiredBookmarkletModules = [
    "src/portal/selectors.js",
    "src/portal/adapter.js",
    "src/traversal/errors.js",
    "src/traversal/traverser.js",
    "src/core/runtime.js",
    "src/core/lifecycle.js",
  ];

  for (const mod of requiredBookmarkletModules) {
    if (!bookmarkletModuleList.includes(mod)) {
      throw new Error(`BOOKMARKLET_MODULES is missing required dependency: ${mod}`);
    }
  }

  const requiredSharedReaderModules = [
    "src/ui/reader-content.js",
    "src/ui/reader-interactions.js",
  ];
  for (const mod of requiredSharedReaderModules) {
    if (!bookmarkletModuleList.includes(mod)) {
      throw new Error(`BOOKMARKLET_MODULES is missing shared Reader module: ${mod}`);
    }
    if (!buildMjsContent.match(/(?:const|export const)\s+EXTENSION_MODULES\s*=\s*\[([\s\S]*?)\];/)?.[1]?.includes(mod)) {
      throw new Error(`EXTENSION_MODULES is missing shared Reader module: ${mod}`);
    }
  }

  if (bookmarkletModuleList.includes("src/ui/reader-ai.js")) {
    throw new Error("BOOKMARKLET_MODULES must not contain extension-only src/ui/reader-ai.js");
  }
  if (bookmarkletModuleList.includes("src/ui/reader-import.js")) {
    throw new Error("BOOKMARKLET_MODULES must not contain extension-only src/ui/reader-import.js");
  }
});

// 9a. Verify Reader shared/extension-only boundary
check("Reader shared code is marker-free and extension-only code stays isolated", () => {
  const readerContent = readFileSync("src/ui/reader.js", "utf8");
  const forbiddenReaderStrings = ["@extension-only", "saq-ai", "copy-ai", "generateAiPrompt", "chrome."];
  for (const str of forbiddenReaderStrings) {
    if (readerContent.includes(str)) {
      throw new Error(`src/ui/reader.js contains extension-only Reader string: "${str}"`);
    }
  }

  const buildMjsContent = readFileSync("build.mjs", "utf8");
  const extensionMatch = buildMjsContent.match(/(?:const|export const)\s+EXTENSION_MODULES\s*=\s*\[([\s\S]*?)\];/);
  if (!extensionMatch?.[1]?.includes("src/ui/reader-ai.js")) {
    throw new Error("EXTENSION_MODULES must contain src/ui/reader-ai.js");
  }
});

// 9b. Verify Extension-Only Marker Balancing and Nesting Safety
check("Extension-only comment markers are strictly balanced with zero nesting across all source files", () => {
  const allSourceFiles = [...srcFiles, "bookmarklet/styles.css"];
  const startMarker = "/* @extension-only-start */";
  const endMarker = "/* @extension-only-end */";

  for (const file of allSourceFiles) {
    const content = readFileSync(file, "utf8");
    const regex = /\/\*\s*@extension-only-(start|end)\s*\*\//g;
    let match;
    let depth = 0;
    let starts = 0;
    let ends = 0;

    while ((match = regex.exec(content)) !== null) {
      const type = match[1];
      if (type === "start") {
        starts++;
        depth++;
        if (depth > 1) {
          throw new Error(`File ${file} contains nested @extension-only-start marker at char ${match.index}`);
        }
      } else if (type === "end") {
        ends++;
        depth--;
        if (depth < 0) {
          throw new Error(`File ${file} contains unmatched @extension-only-end marker at char ${match.index}`);
        }
      }
    }

    if (depth !== 0 || starts !== ends) {
      throw new Error(`File ${file} has unbalanced extension-only markers (${starts} starts, ${ends} ends)`);
    }
  }
});

// 9c. Verify Built Bookmarklet Target is Purged of Extension-Only Features and APIs
check("Built bookmarklet target is strictly purged of extension-only APIs and features", () => {
  const sourcePath = "bookmarklet/bookmarklet-source.js";
  const textPath = "bookmarklet/bookmarklet.txt";
  const builtSource = readFileSync(sourcePath, "utf8");
  const builtText = readFileSync(textPath, "utf8");

  const forbiddenStrings = [
    "saq-ai",
    "copy-ai",
    "generateAiPrompt",
    "reader-import",
    "parseAnswerKey",
    "assignmentFingerprint",
    "saq-import",
    "acx-import",
    "chrome.debugger",
    "chrome.runtime",
    "sendPrintToPdfRuntimeMessage",
  ];

  for (const str of forbiddenStrings) {
    if (builtSource.includes(str)) {
      throw new Error(`Built bookmarklet source (${sourcePath}) contains forbidden extension-only string: "${str}"`);
    }
    // Also verify decoded bookmarklet URL text
    const decodedText = decodeURIComponent(builtText);
    if (decodedText.includes(str)) {
      throw new Error(`Built bookmarklet text (${textPath}) contains forbidden extension-only string: "${str}"`);
    }
  }
});

// 9e. Verify the extension-only answer protocol cannot cross into host or bookmarklet layers
check("Answer protocol stays DOM-free, storage-free, and extension-only", () => {
  const bridgeFiles = getAllFiles("src/bridge");
  const forbiddenBridgePatterns = [
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
    /\bsendBeacon\s*\(/,
    /\beval\s*\(/,
    /\bnew\s+Function\b/,
    /\bchrome\.storage\b/,
    /\blocalStorage\b/,
    /\bsessionStorage\b/,
    /\bindexedDB\b/,
    /from\s+["'][^"']*rawHtml/,
  ];
  for (const file of bridgeFiles) {
    const content = readFileSync(file, "utf8");
    for (const pattern of forbiddenBridgePatterns) {
      if (pattern.test(content)) throw new Error(`${file} contains forbidden protocol dependency: ${pattern}`);
    }
  }

  const buildMjsContent = readFileSync("build.mjs", "utf8");
  const bookmarkletModules = buildMjsContent.match(/(?:const|export const)\s+BOOKMARKLET_MODULES\s*=\s*\[([\s\S]*?)\];/)?.[1] || "";
  if (
    bookmarkletModules.includes("src/bridge/protocol.js") ||
    bookmarkletModules.includes("src/bridge/parser.js") ||
    bookmarkletModules.includes("src/ui/reader-import.js")
  ) {
    throw new Error("Answer protocol modules must remain absent from BOOKMARKLET_MODULES");
  }
  const extensionModules = buildMjsContent.match(/(?:const|export const)\s+EXTENSION_MODULES\s*=\s*\[([\s\S]*?)\];/)?.[1] || "";
  for (const moduleName of ["src/bridge/protocol.js", "src/bridge/parser.js", "src/ui/reader-import.js"]) {
    if (!extensionModules.includes(moduleName)) throw new Error(`EXTENSION_MODULES is missing ${moduleName}`);
  }
  const builtSource = readFileSync("bookmarklet/bookmarklet-source.js", "utf8");
  for (const marker of ["reader-import", "parseAnswerKey", "assignmentFingerprint", "saq-import", "acx-import"]) {
    if (builtSource.includes(marker)) throw new Error(`Bookmarklet contains extension-only answer marker: ${marker}`);
  }
});

// 9d. Verify Built Bookmarklet Target Retains All Required Core Features
check("Built bookmarklet target retains all required core features and UI components", () => {
  const sourcePath = "bookmarklet/bookmarklet-source.js";
  const builtSource = readFileSync(sourcePath, "utf8");

  const requiredFeatureMarkers = [
    "ReaderDrawer",
    "All Questions",
    "saq-sheet",
    "saq-backdrop",
    "saq-launcher",
    "Markdown and Bundle export are available in the Acadrix Chrome Extension.",
    "printWithIntelligentTitle",
    "buildExportFilename",
    "window.print",
  ];

  for (const marker of requiredFeatureMarkers) {
    if (!builtSource.includes(marker)) {
      throw new Error(`Built bookmarklet source is missing required feature marker: "${marker}"`);
    }
  }
});

// 10. Verify Markdown exporter has zero DOM, portal, or browser dependencies
check("Markdown exporter is strictly decoupled from DOM, browser, and portal", () => {
  const exporterFile = "src/exporters/markdown.js";
  const content = readFileSync(exporterFile, "utf8");

  const forbiddenDomPatterns = [
    /\bIitmPortalAdapter\b/,
    /\bQuestionTraverser\b/,
    /\bwindow\b/,
    /\bHTMLElement\b/,
    /\binnerHTML\b/,
    /\bouterHTML\b/,
    /\bdocument\.(?:querySelector|querySelectorAll|getElementById|getElementsBy|createElement|body|head|addEventListener)\b/,
  ];

  for (const pat of forbiddenDomPatterns) {
    if (pat.test(content)) {
      throw new Error(`${exporterFile} contains forbidden DOM/browser pattern: ${pat}`);
    }
  }

  // Ensure exportAssignmentToMarkdown and MarkdownExporter are exported
  if (!content.includes("export function exportAssignmentToMarkdown") || !content.includes("export class MarkdownExporter")) {
    throw new Error(`${exporterFile} must export exportAssignmentToMarkdown and MarkdownExporter`);
  }
});

// 11. Verify Resource Engine has zero DOM, portal, or browser dependencies
check("Resource Engine is strictly decoupled from DOM, browser, and portal", () => {
  const resourceFiles = getAllFiles("src/resources");
  if (resourceFiles.length === 0) {
    throw new Error("No files found in src/resources");
  }

  const forbiddenDomPatterns = [
    /\bIitmPortalAdapter\b/,
    /\bQuestionTraverser\b/,
    /\bwindow\b/,
    /\bHTMLElement\b/,
    /\bHTMLImageElement\b/,
    /\binnerHTML\b/,
    /\bouterHTML\b/,
    /\bdocument\.(?:querySelector|querySelectorAll|getElementById|getElementsBy|createElement|body|head|addEventListener)\b/,
  ];

  for (const file of resourceFiles) {
    const content = readFileSync(file, "utf8");
    for (const pat of forbiddenDomPatterns) {
      if (pat.test(content)) {
        throw new Error(`${file} contains forbidden DOM/browser pattern: ${pat}`);
      }
    }
  }

  const engineFile = "src/resources/engine.js";
  const engineContent = readFileSync(engineFile, "utf8");
  if (!engineContent.includes("export class ResourceEngine") || !engineContent.includes("export async function buildAssignmentBundle")) {
    throw new Error(`${engineFile} must export ResourceEngine and buildAssignmentBundle`);
  }
});

// 12. Verify PDF exporter is decoupled from IITM DOM, portal, and traversal
check("PDF exporter is strictly decoupled from IITM DOM, portal, and traversal", () => {
  const pdfFile = "src/exporters/pdf.js";
  const content = readFileSync(pdfFile, "utf8");

  const forbiddenIitmPatterns = [
    /\bIitmPortalAdapter\b/,
    /\bQuestionTraverser\b/,
    /\bIITM_SELECTORS\b/,
    /app-question\b/,
    /app-assessment\b/,
    /\bdocument\.(?:querySelector|querySelectorAll|getElementById|getElementsBy)\b/,
  ];

  for (const pat of forbiddenIitmPatterns) {
    if (pat.test(content)) {
      throw new Error(`${pdfFile} contains forbidden IITM/portal pattern: ${pat}`);
    }
  }

  // Ensure PDFRenderer, renderPdfDocument, exportPdf, and PDF_CSS are exported
  const requiredExports = ["PDFRenderer", "renderPdfDocument", "exportPdf", "PDF_CSS"];
  for (const exp of requiredExports) {
    if (!content.includes(exp)) {
      throw new Error(`${pdfFile} must export ${exp}`);
    }
  }
});

// 13. Verify Export Orchestration layer decoupling and clean bookmarklet boundaries
check("Export Orchestration is decoupled from IITM DOM and isolated from bookmarklet", () => {
  const orchestrationFiles = getAllFiles("src/orchestration");
  if (orchestrationFiles.length === 0) {
    throw new Error("No files found in src/orchestration");
  }

  const forbiddenIitmPatterns = [
    /\bIITM_SELECTORS\b/,
    /app-question\b/,
    /app-assessment\b/,
  ];

  for (const file of orchestrationFiles) {
    const content = readFileSync(file, "utf8");
    for (const pat of forbiddenIitmPatterns) {
      if (pat.test(content)) {
        throw new Error(`${file} contains forbidden IITM/portal pattern: ${pat}`);
      }
    }
  }

  // Reader must not import orchestrator directly
  const readerContent = readFileSync("src/ui/reader.js", "utf8");
  if (readerContent.includes("ExportOrchestrator") || readerContent.includes("../orchestration/")) {
    throw new Error("src/ui/reader.js must not directly import or reference ExportOrchestrator");
  }

  // Required exports from orchestration
  const orchestratorContent = readFileSync("src/orchestration/orchestrator.js", "utf8");
  if (!orchestratorContent.includes("export class ExportOrchestrator") || !orchestratorContent.includes("export async function exportAssignment")) {
    throw new Error("src/orchestration/orchestrator.js must export ExportOrchestrator and exportAssignment");
  }

  const sessionContent = readFileSync("src/orchestration/session.js", "utf8");
  if (!sessionContent.includes("export class ExportSession")) {
    throw new Error("src/orchestration/session.js must export ExportSession");
  }
});

// 14. Verify Portal Decor module purity and isolation
check("Portal decor is strictly read-and-decorate without network, navigation, or portal DOM mutation", () => {
  const decorFiles = getAllFiles("src/portal-decor");
  if (decorFiles.length === 0) {
    throw new Error("No files found in src/portal-decor");
  }

  const forbiddenDecorPatterns = [
    /\.click\s*\(/,
    /\bdispatchEvent\s*\(/,
    /\blocation\s*=/,
    /\blocation\.(?:assign|replace|href)\b/,
    /\bhistory\./,
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
    /\bsendBeacon\s*\(/,
    /\beval\s*\(/,
    /\bnew\s+Function\b/,
    /document\.write/,
  ];

  for (const file of decorFiles) {
    const content = readFileSync(file, "utf8");
    for (const pat of forbiddenDecorPatterns) {
      if (pat.test(content)) {
        throw new Error(`File ${file} contains forbidden portal-decor pattern: ${pat}`);
      }
    }

    // Check for raw selector strings: querySelector / querySelectorAll must use IITM_SELECTORS
    const rawSelectorMatch = content.match(/\.(?:querySelector|querySelectorAll)\s*\(\s*["'`][^"'`]+["'`]\s*\)/);
    if (rawSelectorMatch) {
      throw new Error(`File ${file} contains raw selector string in querySelector: ${rawSelectorMatch[0]}; must use IITM_SELECTORS`);
    }
  }
});

// 15. Verify Portal Decor is isolated from bookmarklet and has zero cross-layer coupling
check("Portal decor is isolated from bookmarklet and decoupled from Reader/exporters/bridge", () => {
  const buildMjsContent = readFileSync("build.mjs", "utf8");
  const bookmarkletModules = buildMjsContent.match(/(?:const|export const)\s+BOOKMARKLET_MODULES\s*=\s*\[([\s\S]*?)\];/)?.[1] || "";
  if (bookmarkletModules.includes("src/portal-decor")) {
    throw new Error("Portal decor modules must remain absent from BOOKMARKLET_MODULES");
  }

  const extensionModules = buildMjsContent.match(/(?:const|export const)\s+EXTENSION_MODULES\s*=\s*\[([\s\S]*?)\];/)?.[1] || "";
  const requiredDecorModules = [
    "src/portal-decor/core.js",
    "src/portal-decor/storage.js",
    "src/portal-decor/capture.js",
    "src/portal-decor/decorator.js",
    "src/portal-decor/index.js",
  ];
  for (const mod of requiredDecorModules) {
    if (!extensionModules.includes(mod)) {
      throw new Error(`EXTENSION_MODULES is missing required portal-decor module: ${mod}`);
    }
  }

  const builtSource = readFileSync("bookmarklet/bookmarklet-source.js", "utf8");
  const builtText = readFileSync("bookmarklet/bookmarklet.txt", "utf8");
  const decodedText = decodeURIComponent(builtText);
  const forbiddenDecorMarkers = [
    "acx:deadlines:v1",
    "initPortalDecor",
    "createPortalDecorStore",
    "captureGrades",
    "captureStartPage",
    "decorateSidebar",
    "createSidebarObserver",
    "isPortalDecorStale",
  ];

  for (const marker of forbiddenDecorMarkers) {
    if (builtSource.includes(marker)) {
      throw new Error(`Bookmarklet source contains extension-only portal decor marker: "${marker}"`);
    }
    if (decodedText.includes(marker)) {
      throw new Error(`Bookmarklet text contains extension-only portal decor marker: "${marker}"`);
    }
  }

  // Cross-layer import isolation: portal-decor must not import from UI, exporters, bridge, extraction, resources, orchestration
  const decorFiles = getAllFiles("src/portal-decor");
  const forbiddenDecorImports = [
    /from\s+["'][^"']*\/(?:ui|exporters|bridge|extraction|resources|orchestration)\//,
    /from\s+["'][^"']*\/(?:reader|markdown|pdf|prompt|parser|engine|bundle|extractor)\b/,
  ];
  for (const file of decorFiles) {
    const content = readFileSync(file, "utf8");
    for (const pat of forbiddenDecorImports) {
      if (pat.test(content)) {
        throw new Error(`${file} contains forbidden cross-layer import: ${pat}`);
      }
    }
  }

  // Other subsystems (ui, exporters, bridge, extraction, resources, orchestration) must not import from portal-decor
  const otherFiles = [
    ...getAllFiles("src/ui"),
    ...getAllFiles("src/exporters"),
    ...getAllFiles("src/bridge"),
    ...getAllFiles("src/extraction"),
    ...getAllFiles("src/resources"),
    ...getAllFiles("src/orchestration"),
  ];
  for (const file of otherFiles) {
    const content = readFileSync(file, "utf8");
    if (content.includes("portal-decor")) {
      throw new Error(`${file} must not import or reference portal-decor`);
    }
  }
});

if (!passed) {
  console.error("\nArchitecture verification FAILED.");
  process.exit(1);
} else {
  console.log("\nAll architecture verification checks passed successfully.\n");
}
