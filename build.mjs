#!/usr/bin/env node
// Build = assemble modular src/ into build/run.js (Extension Target) and
// bookmarklet-source.js / bookmarklet.txt / install.html (Bookmarklet Target).
// Zero external dependencies. Run: `node build.mjs`
import { readFileSync, writeFileSync, cpSync, rmSync } from "node:fs";

const extensionManifest = JSON.parse(readFileSync("extension/manifest.json", "utf8"));

// ── Bookmarklet Compatibility Modules ─────────────────────────────────────────
// The bookmarklet is a constrained, URL-encoded platform and must remain a
// lightweight compatibility subset. Only modules strictly required for IITM
// detection, question traversal, and the read-only inspection UI are included here.
// Heavy subsystems (Markdown exporters, PDF generators, offline resource engines,
// advanced extension options) MUST NOT be added to this list.
export const BOOKMARKLET_MODULES = [
  "src/model/types.js",
  "src/model/document.js",
  "src/model/assembler.js",
  "src/utils/dom.js",
  "src/utils/math.js",
  "src/utils/timing.js",
  "src/utils/shortcut.js",
  "src/portal/selectors.js",
  "src/portal/adapter.js",
  "src/extraction/extractor.js",
  "src/traversal/errors.js",
  "src/traversal/traverser.js",
  "src/ui/icons.js",
  "src/ui/shadow.js",
  "src/ui/launcher.js",
  "src/ui/overlay.js",
  "src/ui/reader-content.js",
  "src/ui/reader-interactions.js",
  "src/ui/reader.js",
  "src/core/lifecycle.js",
  "src/core/runtime.js",
];

// ── Extension Modules (Full Platform) ─────────────────────────────────────────
// The browser extension is the primary platform and can host larger modules,
// exporters, background workers, and future pipeline stages.
export const EXTENSION_MODULES = [
  "src/model/types.js",
  "src/model/document.js",
  "src/model/assembler.js",
  "src/utils/dom.js",
  "src/utils/math.js",
  "src/utils/timing.js",
  "src/utils/shortcut.js",
  "src/portal/selectors.js",
  "src/portal/adapter.js",
  "src/parsers/semantic-walker.js",
  "src/extraction/extractor.js",
  "src/extraction/semantic.js",
  "src/bridge/protocol.js",
  "src/exporters/markdown.js",
  "src/bridge/prompt.js",
  "src/bridge/parser.js",
  "src/bridge/answer-state.js",
  "src/bridge/applicator.js",
  "src/exporters/pdf.js",
  "src/resources/types.js",
  "src/resources/naming.js",
  "src/resources/discover.js",
  "src/resources/fetch.js",
  "src/resources/engine.js",
  "src/orchestration/types.js",
  "src/orchestration/bundle.js",
  "src/orchestration/session.js",
  "src/orchestration/orchestrator.js",
  "src/traversal/errors.js",
  "src/traversal/traverser.js",
  "src/ui/icons.js",
  "src/ui/shadow.js",
  "src/ui/launcher.js",
  "src/ui/overlay.js",
  "src/ui/reader-content.js",
  "src/ui/reader-interactions.js",
  "src/ui/reader-ai.js",
  "src/ui/reader-import.js",
  "src/ui/reader.js",
  "src/portal-decor/core.js",
  "src/portal-decor/storage.js",
  "src/portal-decor/capture.js",
  "src/portal-decor/sync.js",
  "src/portal-decor/decorator.js",
  "src/portal-decor/index.js",
  "src/notifications/types.js",
  "src/notifications/evaluator.js",
  "src/notifications/storage.js",
  "src/notifications/scheduler.js",
  "src/core/lifecycle.js",
  "src/core/runtime.js",
];

// ── Target Configuration Manifest ─────────────────────────────────────────────
// Explicitly separates Extension and Bookmarklet module graphs so that future
// heavy subsystems do not inflate the constrained bookmarklet URL.
export const TARGETS = {
  // Target 1: Browser Extension (Full-featured platform)
  extension: {
    name: "Extension (Full)",
    modules: EXTENSION_MODULES,
    entry: "src/index.js",
    output: "build/run.js",
  },

  // Target 2: Browser Bookmarklet (Constrained URL-size platform)
  bookmarklet: {
    name: "Bookmarklet (Lightweight)",
    modules: BOOKMARKLET_MODULES,
    entry: "src/index.js",
    sourceOutput: "bookmarklet/bookmarklet-source.js",
    textOutput: "bookmarklet/bookmarklet.txt",
    installOutput: "bookmarklet/install.html",
  },
};

function stripExtensionOnlyBlocks(text) {
  return text.replace(/\/\* @extension-only-start \*\/[\s\S]*?\/\* @extension-only-end \*\//g, "");
}

function transformModule(code, isBookmarklet = false) {
  const source = isBookmarklet ? stripExtensionOnlyBlocks(code) : code;
  return source
    // Remove import statements
    .replace(/^import\s+[^;]+;\s*$/gm, "")
    // Remove export keywords from declarations
    .replace(/^export\s+(async\s+function|const|class|function|let|var)\s+/gm, "$1 ")
    // Remove standalone export statements like `export { ... }` or `export default ...`
    .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, "")
    .replace(/^export\s+default\s+[^;]+;\s*$/gm, "")
    .trim();
}

/**
 * Safely strips comments from JS code without altering string or regex literals.
 */
function stripCommentsSafely(code) {
  return code.replace(
    /("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`)|(\/\*[\s\S]*?\*\/|\/\/[^\r\n]*)/g,
    (match, str) => {
      if (str) return str;
      return "";
    }
  );
}

/**
 * Minifies CSS for compact bookmarklet inlining.
 */
function minifyCss(cssText) {
  return cssText
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}:;,>+~])\s*/g, "$1")
    .replace(/;\}/g, "}")
    .trim();
}

/**
 * Prepares lightweight, compact JavaScript for bookmarklet URL encoding.
 */
function cleanBookmarkletCode(code) {
  const stripped = stripCommentsSafely(code);
  return stripped
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function bundleTarget(targetConfig, isBookmarklet = false) {
  const parts = [];

  for (const modPath of targetConfig.modules) {
    const raw = readFileSync(modPath, "utf8");
    const transformed = transformModule(raw, isBookmarklet);
    parts.push(`  // ── [Module: ${modPath}] ──\n  ${transformed.replace(/\n/g, "\n  ")}`);
  }

  // Add entry point code
  const indexRaw = readFileSync(targetConfig.entry, "utf8");
  const indexTransformed = transformModule(indexRaw, isBookmarklet);
  parts.push(`  // ── [Entry: ${targetConfig.entry}] ──\n  ${indexTransformed.replace(/\n/g, "\n  ")}`);

  return `/**
 * Acadrix — ${targetConfig.name}.
 * Auto-generated by build.mjs from modular src/ files.
 * Do not edit directly; modify files in src/.
 */
(() => {
  "use strict";

  const __CSS__ = __CSS_PLACEHOLDER__;

${parts.join("\n\n")}
})();
`;
}

// 0) Assemble static extension files into build/
cpSync("src/notifications", "extension/notifications", { recursive: true });
rmSync("build", { recursive: true, force: true });
cpSync("extension", "build", { recursive: true });
const css = readFileSync("src/ui/styles.css", "utf8");
writeFileSync("bookmarklet/styles.css", css);

// 1) Build Target: Extension
const extensionTemplate = bundleTarget(TARGETS.extension, false);
const extensionRunJs = extensionTemplate
  .replaceAll("__SAQ_VERSION__", extensionManifest.version)
  .replace("__CSS_PLACEHOLDER__", JSON.stringify(css));
writeFileSync(TARGETS.extension.output, extensionRunJs);
writeFileSync("extension/run.js", extensionRunJs);

// 2) Build Target: Bookmarklet
const bookmarkletTemplate = bundleTarget(TARGETS.bookmarklet, true);
// Output unminified readable source for developer inspection
const bookmarkletSource = bookmarkletTemplate.replace("__CSS_PLACEHOLDER__", "__CSS__");
writeFileSync(TARGETS.bookmarklet.sourceOutput, bookmarkletSource);

// Output compact URL-encoded bookmarklet
const bookmarkletCss = stripExtensionOnlyBlocks(css);
const minifiedCss = minifyCss(bookmarkletCss);
const bookmarkletInlined = bookmarkletTemplate.replace("__CSS_PLACEHOLDER__", JSON.stringify(minifiedCss));
const compactBookmarkletCode = cleanBookmarkletCode(bookmarkletInlined);
const bookmarkletUrl = "javascript:" + encodeURIComponent(compactBookmarkletCode);
writeFileSync(TARGETS.bookmarklet.textOutput, bookmarkletUrl);

// 3) Update Drag-to-install page
const esc = bookmarkletUrl
  .replace(/&/g, "&amp;")
  .replace(/"/g, "&quot;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;");

const html = readFileSync(TARGETS.bookmarklet.installOutput, "utf8").replace(
  /href="javascript[^"]*"/,
  `href="${esc}"`
);
writeFileSync(TARGETS.bookmarklet.installOutput, html);

console.log(`built: ${TARGETS.extension.output} (${extensionRunJs.length} chars)`);
console.log(`built: ${TARGETS.bookmarklet.textOutput} (${bookmarkletUrl.length} chars)`);
console.log(`built: ${TARGETS.bookmarklet.sourceOutput} (${bookmarkletSource.length} chars)`);
console.log(`built: ${TARGETS.bookmarklet.installOutput}`);
