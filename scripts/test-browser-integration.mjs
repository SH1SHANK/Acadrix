#!/usr/bin/env node
/**
 * Node DOM Simulation Integration Test Suite.
 *
 * Classification: Node DOM Simulation (NOT a real browser).
 * Uses a lightweight in-memory MockElement/ShadowDOM implementation in Node
 * to deterministically test the UnfoldRuntime, ReaderDrawer, and ExportOrchestrator
 * state machine and DOM wiring:
 * 1. Portal detection and launcher rendering in Shadow DOM
 * 2. Reader opening and full assessment traversal/extraction
 * 3. Reader UI rendering (blocks, equations, options, timer, actions)
 * 4. User-triggered export actions (Markdown, PDF, Bundle)
 * 5. Temporary <a download> removal and URL.revokeObjectURL cleanup
 * 6. Button busy-state management, duplicate-click blocking, and error recovery
 * 7. Dismiss and keyboard shortcut navigation (Escape)
 * 8. Clean runtime destruction
 *
 * Note: Real-browser verification in headless Google Chrome is executed separately
 * by `scripts/test-real-browser.mjs`.
 */

import { UnfoldRuntime } from "../src/core/runtime.js";
import { LifecycleState } from "../src/core/lifecycle.js";
import { SemanticExtractor } from "../src/extraction/semantic.js";
import { portalAdapter } from "../src/portal/adapter.js";

let passed = true;

async function check(desc, fn) {
  try {
    await fn();
    console.log(`✓ ${desc}`);
  } catch (e) {
    console.error(`❌ ${desc}: ${e.message}\n${e.stack}`);
    passed = false;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

// ── Minimal In-Memory DOM for Node DOM Simulation Testing ───────────────────

class MockClassList {
  constructor(owner) {
    this.owner = owner;
    this._classes = new Set();
  }
  add(...names) {
    for (const n of names) {
      if (n) this._classes.add(n);
    }
  }
  remove(...names) {
    for (const n of names) {
      if (n) this._classes.delete(n);
    }
  }
  toggle(name, force) {
    if (force !== undefined) {
      if (force) this.add(name);
      else this.remove(name);
      return force;
    }
    if (this.contains(name)) {
      this.remove(name);
      return false;
    }
    this.add(name);
    return true;
  }
  contains(name) {
    return this._classes.has(name);
  }
  get value() {
    return Array.from(this._classes).join(" ");
  }
  toString() {
    return this.value;
  }
}

class MockElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.nodeName = this.tagName;
    this.nodeType = 1;
    this.id = "";
    this.classList = new MockClassList(this);
    this.attributes = new Map();
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.childNodes = [];
    this.parentNode = null;
    this._listeners = new Map();
    this._shadowRoot = null;
    this._innerHTML = "";
    this._textContent = "";
  }

  get className() {
    return this.classList.value;
  }

  set className(val) {
    this.classList._classes.clear();
    String(val || "")
      .split(/\s+/)
      .filter(Boolean)
      .forEach((c) => this.classList.add(c));
  }

  get href() {
    return this.getAttribute("href") || "";
  }

  set href(val) {
    this.setAttribute("href", String(val));
  }

  get download() {
    return this.getAttribute("download") || "";
  }

  set download(val) {
    this.setAttribute("download", String(val));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, val) {
    this.attributes.set(name, String(val));
    if (name === "id") this.id = String(val);
    if (name === "class") this.className = String(val);
    if (name.startsWith("data-")) {
      const prop = name.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
      this.dataset[prop] = String(val);
    }
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "class") this.classList._classes.clear();
    if (name.startsWith("data-")) {
      const prop = name.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
      delete this.dataset[prop];
    }
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  appendChild(child) {
    if (!child) return child;
    child.parentNode = this;
    this.children.push(child);
    this.childNodes.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    const nIdx = this.childNodes.indexOf(child);
    if (nIdx !== -1) this.childNodes.splice(nIdx, 1);
    return child;
  }

  replaceChildren(...newChildren) {
    while (this.children.length > 0) {
      this.removeChild(this.children[0]);
    }
    for (const c of newChildren) {
      this.appendChild(c);
    }
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  attachShadow({ mode = "open" } = {}) {
    this._shadowRoot = new MockElement("shadow-root");
    this._shadowRoot.host = this;
    return this._shadowRoot;
  }

  get shadowRoot() {
    return this._shadowRoot;
  }

  addEventListener(type, cb, options) {
    if (!this._listeners.has(type)) {
      this._listeners.set(type, new Set());
    }
    this._listeners.get(type).add(cb);
  }

  removeEventListener(type, cb) {
    if (this._listeners.has(type)) {
      this._listeners.get(type).delete(cb);
    }
  }

  dispatchEvent(event) {
    if (!event.target) {
      event.target = this;
    }
    event.currentTarget = this;
    const listeners = this._listeners.get(event.type);
    if (listeners) {
      for (const cb of Array.from(listeners)) {
        cb(event);
      }
    }
    if (event.bubbles && this.parentNode) {
      this.parentNode.dispatchEvent(event);
    }
    return !event.defaultPrevented;
  }

  click() {
    const ev = {
      type: "click",
      target: this,
      bubbles: true,
      defaultPrevented: false,
      preventDefault: () => {
        ev.defaultPrevented = true;
      },
      stopPropagation: () => {},
    };
    this.dispatchEvent(ev);
  }

  focus() {}

  get textContent() {
    if (this.children.length === 0) return this._textContent;
    return this.children.map((c) => c.textContent).join(" ");
  }

  set textContent(val) {
    this._textContent = String(val);
    this.children = [];
    this.childNodes = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(html) {
    this._innerHTML = html;
    parseHtmlIntoMockElement(html, this);
  }

  getElementById(id) {
    return querySelectorMock(this, `#${id}`);
  }

  contains(node) {
    if (!node) return false;
    let curr = node;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentNode;
    }
    return false;
  }

  cloneNode(deep = false) {
    const clone = new MockElement(this.tagName);
    clone.id = this.id;
    clone.className = this.className;
    clone.style = { ...this.style };
    for (const [k, v] of this.attributes) clone.attributes.set(k, v);
    clone._innerHTML = this._innerHTML;
    clone._textContent = this._textContent;
    if (deep) {
      for (const child of this.children) {
        const childClone = child.cloneNode(true);
        clone.appendChild(childClone);
      }
    }
    return clone;
  }

  querySelector(selector) {
    return querySelectorMock(this, selector);
  }

  querySelectorAll(selector) {
    return querySelectorAllMock(this, selector);
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (matchesSelector(curr, selector)) return curr;
      curr = curr.parentNode;
    }
    return null;
  }
}

/**
 * Basic HTML parser to construct MockElements from HTML strings.
 */
function parseHtmlIntoMockElement(html, parent) {
  const clean = html.replace(/<!--[\s\S]*?-->/g, "");
  const tagRegex = /<([a-zA-Z0-9-]+)([^>]*)>([\s\S]*?)<\/\1>|<([a-zA-Z0-9-]+)([^>]*)\/>|<(input|img|br|hr)([^>]*)>|([^<]+)/g;
  let match;

  while ((match = tagRegex.exec(clean)) !== null) {
    if (match[8]) {
      const text = match[8].trim();
      if (text) {
        const textNode = new MockElement("span");
        textNode.textContent = text;
        parent.appendChild(textNode);
      }
    } else {
      const tagName = match[1] || match[4] || match[6];
      const rawAttrs = match[2] || match[5] || match[7] || "";
      const innerContent = match[3] || "";

      const el = new MockElement(tagName);
      const attrRegex = /([a-zA-Z0-9-]+)(?:="([^"]*)")?/g;
      let attrMatch;
      while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
        const attrName = attrMatch[1];
        const attrVal = attrMatch[2] !== undefined ? attrMatch[2] : "";
        el.setAttribute(attrName, attrVal);
      }

      if (innerContent) {
        parseHtmlIntoMockElement(innerContent, el);
      }
      parent.appendChild(el);
    }
  }
}

function matchesSelector(el, selector) {
  if (!el || el.nodeType !== 1) return false;
  const groups = selector.split(",").map((s) => s.trim());
  for (const group of groups) {
    const parts = group.split(/(?=[.#\[])/);
    let match = true;
    for (const part of parts) {
      if (!part) continue;
      if (part.startsWith("#")) {
        if (el.id !== part.slice(1)) {
          match = false;
          break;
        }
      } else if (part.startsWith(".")) {
        if (!el.classList.contains(part.slice(1))) {
          match = false;
          break;
        }
      } else if (part.startsWith("[") && part.endsWith("]")) {
        const inner = part.slice(1, -1);
        if (inner.includes("=")) {
          const [k, v] = inner.split("=");
          const cleanV = v.replace(/['"]/g, "");
          if (el.getAttribute(k) !== cleanV) {
            match = false;
            break;
          }
        } else {
          if (!el.hasAttribute(inner)) {
            match = false;
            break;
          }
        }
      } else if (part !== "*") {
        if (el.tagName.toLowerCase() !== part.toLowerCase()) {
          match = false;
          break;
        }
      }
    }
    if (match) return true;
  }
  return false;
}

function querySelectorMock(root, selector) {
  for (const child of root.children) {
    if (matchesSelector(child, selector)) return child;
    const found = querySelectorMock(child, selector);
    if (found) return found;
  }
  return null;
}

function querySelectorAllMock(root, selector, results = []) {
  for (const child of root.children) {
    if (matchesSelector(child, selector)) results.push(child);
    querySelectorAllMock(child, selector, results);
  }
  return results;
}

// ── Set Up Browser Globals ──────────────────────────────────────────────────

function setupBrowserEnvironment() {
  const document = new MockElement("#document");
  const html = new MockElement("html");
  const body = new MockElement("body");
  html.appendChild(body);
  document.appendChild(html);
  document.documentElement = html;
  document.body = body;

  document.createElement = (tag) => new MockElement(tag);
  document.getElementById = (id) => {
    return querySelectorMock(document, `#${id}`);
  };

  const createdObjectUrls = [];
  const revokedObjectUrls = [];

  const window = {
    document,
    innerHeight: 800,
    innerWidth: 1200,
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    alert: () => {},
    print: () => {},
    addEventListener: (t, cb) => document.addEventListener(t, cb),
    removeEventListener: (t, cb) => document.removeEventListener(t, cb),
    location: {
      href: "https://exam.iitm.ac.in/quiz/123",
      origin: "https://exam.iitm.ac.in",
      pathname: "/quiz/123",
    },
    URL: {
      createObjectURL: (blob) => {
        const u = `blob:mock-url-${createdObjectUrls.length + 1}`;
        createdObjectUrls.push(u);
        return u;
      },
      revokeObjectURL: (u) => {
        revokedObjectUrls.push(u);
      },
    },
  };

  globalThis.window = window;
  globalThis.document = document;
  globalThis.alert = window.alert;
  globalThis.HTMLElement = MockElement;
  globalThis.HTMLButtonElement = MockElement;
  globalThis.requestAnimationFrame = window.requestAnimationFrame;
  globalThis.URL.createObjectURL = window.URL.createObjectURL;
  globalThis.URL.revokeObjectURL = window.URL.revokeObjectURL;

  globalThis.MutationObserver = class {
    constructor(cb) {
      this.cb = cb;
    }
    observe() {}
    disconnect() {}
  };

  return { window, document, body, createdObjectUrls, revokedObjectUrls };
}

// ── Test Runner ─────────────────────────────────────────────────────────────

async function runBrowserIntegrationTests() {
  console.log("\nStarting Node DOM Simulation Integration Tests...\n");
  const { window, document, body, createdObjectUrls, revokedObjectUrls } = setupBrowserEnvironment();

  // Downloads tracker
  const triggeredDownloads = [];
  const originalCreateElement = document.createElement;
  document.createElement = (tag) => {
    const el = originalCreateElement(tag);
    if (tag.toLowerCase() === "a") {
      el.click = () => {
        triggeredDownloads.push({
          href: el.getAttribute("href"),
          download: el.getAttribute("download"),
          attachedDuringClick: body.contains(el),
        });
      };
    }
    return el;
  };

  // 1. Build live mock IITM assessment DOM
  const assessmentView = document.createElement("app-assessment-question-view");
  const assessmentContainer = document.createElement("div");
  assessmentContainer.className = "app-assessment-container";

  // Breadcrumb / Title
  const breadcrumb = document.createElement("div");
  breadcrumb.className = "breadcrumb";
  breadcrumb.textContent = "Data Science Quiz 2";
  assessmentContainer.appendChild(breadcrumb);

  // Timer
  const timer = document.createElement("app-submission-timer");
  timer.textContent = "38:42";
  assessmentContainer.appendChild(timer);

  // Paginator with chips
  const paginator = document.createElement("div");
  paginator.className = "chips app-assessment-paginator";

  const chip1 = document.createElement("button");
  chip1.className = "chip active";
  chip1.textContent = "1";
  chip1.setAttribute("aria-current", "true");

  const chip2 = document.createElement("button");
  chip2.className = "chip";
  chip2.textContent = "2";

  chip1.addEventListener("click", () => {
    chip2.classList.remove("active");
    chip2.removeAttribute("aria-current");
    chip1.classList.add("active");
    chip1.setAttribute("aria-current", "true");
    backendHtml.textContent = "What is the expected value of a uniform random variable on [0, 1]?";
  });

  chip2.addEventListener("click", () => {
    chip1.classList.remove("active");
    chip1.removeAttribute("aria-current");
    chip2.classList.add("active");
    chip2.setAttribute("aria-current", "true");
    backendHtml.textContent = "What is the variance of a uniform random variable on [0, 1]?";
  });

  paginator.appendChild(chip1);
  paginator.appendChild(chip2);
  assessmentContainer.appendChild(paginator);

  // Question container
  const questionRoot = document.createElement("app-assessment-question");
  const backendHtml = document.createElement("div");
  backendHtml.className = "backend-html";
  backendHtml.textContent = "What is the expected value of a uniform random variable on [0, 1]?";
  questionRoot.appendChild(backendHtml);

  // Choices
  const choices = document.createElement("div");
  choices.className = "choices";
  const optA = document.createElement("button");
  optA.className = "choice";
  optA.setAttribute("role", "radio");
  optA.textContent = "0.5";
  choices.appendChild(optA);
  questionRoot.appendChild(choices);

  assessmentContainer.appendChild(questionRoot);
  assessmentView.appendChild(assessmentContainer);
  body.appendChild(assessmentView);

  // Point portalAdapter to our mock document
  portalAdapter.doc = document;

  // ── Step 1: Runtime Initialization & Launcher Detection ───────────────────
  let runtime;
  await check("Step 1: Runtime initializes and detects assessment, injecting Shadow DOM launcher", () => {
    runtime = new UnfoldRuntime({ extractor: new SemanticExtractor(portalAdapter) });
    runtime.initialize();

    assert(runtime.lifecycle.state === LifecycleState.ACTIVE, "State should be ACTIVE");
    const hostEl = document.getElementById("unfold-root");
    assert(hostEl !== null, "Shadow host #unfold-root must be attached to document");
    assert(hostEl.shadowRoot !== null, "Shadow root must be created");

    const launcher = hostEl.shadowRoot.querySelector(".saq-launcher");
    assert(launcher !== null, "Launcher button must exist in Shadow DOM");
    assert(launcher.classList.contains("is-shown"), "Launcher should be shown when assessment detected");
  });

  // ── Step 2: Open Unfold & Traverse Assessment ─────────────────────────────
  await check("Step 2: Clicking launcher opens ReaderDrawer and extracts questions", async () => {
    assert(runtime !== null, "Runtime must exist");

    // Click launcher to open
    await runtime.open();
    await new Promise((r) => setTimeout(r, 20));

    assert(runtime.lifecycle.state === LifecycleState.OPEN, "State should be OPEN");
    assert(runtime.activeDocument !== null, "activeDocument must be created");
    assert(runtime.activeDocument.questions.length > 0, "Document must have extracted questions");

    const hostEl = document.getElementById("unfold-root");
    const sheet = hostEl.shadowRoot.querySelector("#saq-sheet");
    assert(sheet !== null, "Reader sheet must be mounted");
    assert(sheet.classList.contains("is-open"), "Reader sheet must have .is-open class");

    // Check header export actions
    const mdBtn = sheet.querySelector("[data-act='export-md']");
    const printBtn = sheet.querySelector("[data-act='print']");
    const bundleBtn = sheet.querySelector("[data-act='export-bundle']");

    assert(mdBtn !== null, "Export Markdown button must be present in Reader header");
    assert(printBtn !== null, "Print/PDF button must be present in Reader header");
    assert(bundleBtn !== null, "Export Bundle button must be present in Reader header");
  });

  // ── Step 3: Trigger Markdown Export From Reader Action ────────────────────
  await check("Step 3: Triggering Markdown export reuses document, cleans up <a>, and revokes Blob URL", async () => {
    const hostEl = document.getElementById("unfold-root");
    const mdBtn = hostEl.shadowRoot.querySelector("[data-act='export-md']");
    assert(mdBtn !== null, "Markdown button exists");

    const preDoc = runtime.activeDocument;
    triggeredDownloads.length = 0;
    createdObjectUrls.length = 0;
    revokedObjectUrls.length = 0;

    // Dispatch click on Markdown button
    mdBtn.click();
    // Allow async export and 250ms URL revocation timer to settle
    await new Promise((r) => setTimeout(r, 300));

    assert(triggeredDownloads.length === 1, "Exactly one file download triggered");
    assert(triggeredDownloads[0].download.endsWith(".md"), "Downloaded file is a .md file");
    assert(triggeredDownloads[0].attachedDuringClick === true, "Temporary <a> was attached during click");
    assert(body.querySelectorAll("a").length === 0, "Temporary <a download> must be removed from DOM");
    assert(createdObjectUrls.length === 1, "One Blob URL created");
    assert(revokedObjectUrls.length === 1, "Blob URL must be revoked via URL.revokeObjectURL");
    assert(revokedObjectUrls[0] === createdObjectUrls[0], "Revoked URL matches created URL");
    assert(runtime.activeDocument === preDoc, "Document was reused without re-traversal");
  });

  // ── Step 4: Trigger Bundle Export From Reader Action ──────────────────────
  await check("Step 4: Triggering Bundle export creates valid ZIP download and cleans up resources", async () => {
    const hostEl = document.getElementById("unfold-root");
    const bundleBtn = hostEl.shadowRoot.querySelector("[data-act='export-bundle']");
    assert(bundleBtn !== null, "Bundle button exists");

    triggeredDownloads.length = 0;
    createdObjectUrls.length = 0;
    revokedObjectUrls.length = 0;

    bundleBtn.click();
    await new Promise((r) => setTimeout(r, 300));

    assert(triggeredDownloads.length === 1, "Exactly one file download triggered for bundle");
    assert(triggeredDownloads[0].download.endsWith(".zip"), "Downloaded file is a .zip file");
    assert(body.querySelectorAll("a").length === 0, "Temporary <a download> removed after bundle download");
    assert(revokedObjectUrls.length === 1, "Bundle Blob URL revoked after download");
  });

  // ── Step 5: Export Buttons Busy State & Duplicate Click Blocking ──────────
  await check("Step 5: Export buttons disable while busy and block duplicate clicks", async () => {
    const hostEl = document.getElementById("unfold-root");
    const sheet = hostEl.shadowRoot.querySelector("#saq-sheet");

    // Verify setExporting method toggles disabled on all export buttons
    runtime.reader.setExporting(true);
    const mdBtn = sheet.querySelector("[data-act='export-md']");
    const printBtn = sheet.querySelector("[data-act='print']");
    const bundleBtn = sheet.querySelector("[data-act='export-bundle']");

    assert(mdBtn.hasAttribute("disabled"), "Markdown button has disabled attribute during export");
    assert(printBtn.hasAttribute("disabled"), "Print button has disabled attribute during export");
    assert(bundleBtn.hasAttribute("disabled"), "Bundle button has disabled attribute during export");
    assert(mdBtn.classList.contains("is-busy"), "Button has is-busy class");

    // Simulate duplicate handleExportAction call while orchestrator is busy
    runtime.orchestrator.activeSession = { state: "rendering" };
    triggeredDownloads.length = 0;
    await runtime.handleExportAction("markdown");
    assert(triggeredDownloads.length === 0, "Duplicate handleExportAction call must be ignored while orchestrator.isBusy() is true");

    runtime.orchestrator.activeSession = null;
    runtime.reader.setExporting(false);
    assert(!mdBtn.hasAttribute("disabled"), "Button re-enabled after export finishes");
    assert(!mdBtn.classList.contains("is-busy"), "is-busy removed");
  });

  // ── Step 5b: "Copy for AI" Popover (§4) ───────────────────────────────────
  await check("Step 5b: Copy for AI popover supports scopes, partial extraction warning, preview, clipboard copy, and layered Escape", async () => {
    const hostEl = document.getElementById("unfold-root");
    const sheet = hostEl.shadowRoot.querySelector("#saq-sheet");
    const copyAiBtn = sheet.querySelector("[data-act='copy-ai']");
    const popover = sheet.querySelector("#saq-ai-popover");

    assert(copyAiBtn !== null, "Copy for AI button must exist in Reader header");
    assert(popover !== null, "#saq-ai-popover must exist in Reader sheet");
    assert(!runtime.reader.isAiPopoverOpen(), "Popover starts closed");

    // 1. Open popover via button click
    copyAiBtn.click();
    assert(runtime.reader.isAiPopoverOpen(), "Clicking Copy for AI opens popover");
    assert(copyAiBtn.getAttribute("aria-expanded") === "true", "Trigger aria-expanded is true");

    // 2. Preview toggle and keyboard-scrollable <pre tabindex="0">
    const previewPre = popover.querySelector("[data-ai-preview]");
    const previewToggle = popover.querySelector("[data-act='ai-preview-toggle']");
    assert(previewPre.getAttribute("tabindex") === "0", "Preview <pre> must have tabindex='0'");
    assert(previewPre.hasAttribute("hidden"), "Preview starts collapsed");
    previewToggle.click();
    assert(!previewPre.hasAttribute("hidden"), "Clicking preview toggle reveals preview");
    assert(previewPre.textContent.includes("<assignment>"), "Preview contains serialized prompt");

    // 3. Copy to clipboard + aria-live="polite" feedback
    let copiedText = "";
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (txt) => {
          copiedText = txt;
          return Promise.resolve();
        },
      },
    });
    const copyConfirmBtn = popover.querySelector("[data-act='ai-copy-confirm']");
    const savePdfBtn = popover.querySelector("[data-act='ai-save-pdf']");
    const liveStatus = popover.querySelector("[data-ai-live-status]");
    assert(savePdfBtn !== null, "Save PDF button must exist in Copy for AI popover");
    assert(liveStatus.getAttribute("aria-live") === "polite", "Live status region has aria-live='polite'");

    await runtime.reader.copyAiPrompt();
    assert(copiedText.includes("You are solving an assessment."), "Clipboard received prompt text");
    assert(copiedText.includes("- Output ONLY the final answers in one fenced code block tagged json, with no other text."), "Prompt uses single no-reasoning rule");
    assert(liveStatus.classList.contains("is-visible"), "Live status becomes visible after copy");
    assert(liveStatus.textContent.includes("Copied to clipboard"), "Live status announces Copied to clipboard");

    // 4. Scope validation (invalid range start > end disables copy and PDF buttons and shows warning)
    runtime.reader.aiScopeState.type = "range";
    const startInput = popover.querySelector("[data-ai-input='start']");
    const endInput = popover.querySelector("[data-ai-input='end']");
    if (startInput) startInput.setAttribute("value", "5");
    if (endInput) endInput.setAttribute("value", "1");
    runtime.reader.updateAiPopoverState();
    const rangeErr = popover.querySelector("[data-ai-range-error]");
    assert(!rangeErr.hasAttribute("hidden"), "Invalid range shows validation error");
    assert(copyConfirmBtn.hasAttribute("disabled"), "Copy button disabled when range invalid");
    assert(savePdfBtn.hasAttribute("disabled"), "Save PDF button disabled when range invalid");

    // Restore valid Single scope (Q1) and verify session memory across close/reopen
    runtime.reader.aiScopeState.type = "single";
    runtime.reader.aiScopeState.single = 1;
    const singleInput = popover.querySelector("[data-ai-input='single']");
    if (singleInput) singleInput.setAttribute("value", "1");
    runtime.reader.updateAiPopoverState();
    assert(!copyConfirmBtn.hasAttribute("disabled"), "Copy button enabled for valid Single Q1");
    assert(!savePdfBtn.hasAttribute("disabled"), "Save PDF button enabled for valid Single Q1");
    assert(previewPre.textContent.includes("Q1 ["), "Single Q1 prompt includes Q1");

    // 5. Layered Escape key: first Escape closes ONLY the popover; Reader remains open
    runtime.handleKeydown({
      key: "Escape",
      preventDefault: () => {},
      stopPropagation: () => {},
    });
    assert(!runtime.reader.isAiPopoverOpen(), "First Escape closes AI popover");
    assert(runtime.reader.isOpen(), "Reader drawer remains open after first Escape");

    // Reopen and confirm session memory preserved Single scope
    runtime.reader.openAiPopover();
    assert(runtime.reader.aiScopeState.type === "single" && runtime.reader.aiScopeState.single === 1, "Popover remembers last selected scope in session");
    runtime.reader.closeAiPopover();

    // 6. Partial extraction warning ("N of M extracted")
    const partialDoc = {
      metadata: { ...runtime.activeDocument.metadata, totalQuestions: 10 },
      questions: runtime.activeDocument.questions,
    };
    const partialHtml = runtime.reader.buildAiPopoverHtml(partialDoc);
    assert(partialHtml.includes("of 10 extracted"), "Partial extraction shows 'N of 10 extracted'");
    assert(partialHtml.includes("data-ai-partial-warn"), "Partial extraction renders warning banner");
  });

  // ── Step 5c: Real Portal DOM Metadata, Review-Mode PDF Non-Leak, and Popover Hint ──
  await check("Step 5c: Extracts real IITM portal h1.title + .side-nav-title, verifies review-mode PDF non-leak, and updates figure hint on fallback", async () => {
    const { buildExportFilename, AssignmentDocument, QuestionNode, ContentNode } = await import("../src/model/document.js");
    const { ContentType, QuestionType } = await import("../src/model/types.js");
    const { renderPdfDocument } = await import("../src/exporters/pdf.js");

    // 1. Test real IITM portal DOM elements provided by user:
    // <h1 _ngcontent-ng-c3910198653="" class="title size-small ng-star-inserted"> Week 1 - Graded Assignment 1 </h1>
    // <div _ngcontent-ng-c2904555830="" class="side-nav-title ng-star-inserted">Sep 2026 - MAD II</div>
    const prevBreadcrumb = body.querySelector(".breadcrumb");
    const prevBreadcrumbText = prevBreadcrumb ? prevBreadcrumb.textContent : "";
    if (prevBreadcrumb) prevBreadcrumb.remove();

    const sideNav = document.createElement("div");
    sideNav.className = "side-nav-title ng-star-inserted";
    sideNav.textContent = "Sep 2026 - MAD II";

    const h1Title = document.createElement("h1");
    h1Title.className = "title size-small ng-star-inserted";
    h1Title.textContent = " Week 1 - Graded Assignment 1 ";

    body.appendChild(sideNav);
    body.appendChild(h1Title);

    const extractedTitle = portalAdapter.getAssessmentTitle();
    const extractedCourse = portalAdapter.getCourseName();
    assert(extractedTitle === "Week 1 - Graded Assignment 1", `Expected 'Week 1 - Graded Assignment 1', got '${extractedTitle}'`);
    assert(extractedCourse === "MAD II", `Expected 'MAD II', got '${extractedCourse}'`);
    assert(
      buildExportFilename({ title: extractedTitle, course: extractedCourse }, "pdf") === "MAD II - Week 01 - GA 1.pdf",
      "Real IITM portal DOM produces 'MAD II - Week 01 - GA 1.pdf'"
    );

    sideNav.remove();
    h1Title.remove();
    if (prevBreadcrumb && prevBreadcrumbText) {
      prevBreadcrumb.textContent = prevBreadcrumbText;
      assessmentContainer.appendChild(prevBreadcrumb);
    }

    // 2. Verify review-mode.html PDF non-leak (default options and saveAiPdf options)
    const reviewDoc = new AssignmentDocument({
      metadata: {
        title: "IITM Assessment — Review Mode Fixture",
        course: "MAD II",
        isReview: true,
        totalQuestions: 1,
        totalMarks: 1,
      },
      questions: [
        new QuestionNode({
          index: 0,
          number: 1,
          label: "Question 1",
          type: QuestionType.MCQ,
          marks: 1,
          stem: [
            new ContentNode({
              type: ContentType.PARAGRAPH,
              value: "What is the time complexity of binary search on a sorted array of n elements?",
            }),
          ],
          options: [
            { index: 0, letter: "A", selected: true, isCorrect: true, content: [new ContentNode({ type: ContentType.TEXT, value: "O(log n)" })] },
            { index: 1, letter: "B", selected: false, isCorrect: false, content: [new ContentNode({ type: ContentType.TEXT, value: "O(n)" })] },
          ],
          review: {
            mode: "evaluated",
            isCorrect: true,
            score: 1,
            statusText: "Answer is Correct",
            feedback: "Binary search halves the search space on each comparison.",
          },
        }),
      ],
    });
    const reviewPdfHtml = renderPdfDocument(reviewDoc);
    assert(!reviewPdfHtml.includes("Answer is Correct"), "Default PDF must NOT leak review statusText");
    assert(!reviewPdfHtml.includes("Binary search halves"), "Default PDF must NOT leak review feedback");
    assert(!reviewPdfHtml.includes("Existing Selection"), "Default PDF must NOT leak selected option");
    assert(!reviewPdfHtml.includes('<div class="saq-pdf-review-box">'), "Default PDF must NOT render review box");

    // 3. Verify popover figure warning hint omits "choose Save as PDF" when direct PDF is available,
    // and includes it on the fallback path.
    const figDoc = new AssignmentDocument({
      metadata: { title: "Week 1 - Graded Assignment 1", course: "MAD II", totalQuestions: 1 },
      questions: [
        new QuestionNode({
          index: 0,
          number: 1,
          label: "Question 1",
          type: QuestionType.MCQ,
          stem: [
            new ContentNode({ type: ContentType.IMAGE, attributes: { src: "https://exam.iitm.ac.in/fig.png", alt: "Fig" } }),
          ],
          options: [{ index: 0, letter: "A", content: [new ContentNode({ type: ContentType.TEXT, value: "Opt A" })] }],
        }),
      ],
    });
    runtime.reader.documentModel = figDoc;
    runtime.reader.aiScopeState = { type: "all", start: 1, end: 1, single: 1 };

    const prevChrome = globalThis.chrome;
    globalThis.chrome = { runtime: { sendMessage: () => {} } };
    runtime.reader.setPdfFallbackMode(false);
    runtime.reader.updateAiPopoverState();
    const hostEl = document.getElementById("unfold-root");
    const figWarnEl = hostEl.shadowRoot.querySelector("[data-ai-fig-warn]");
    assert(
      figWarnEl.textContent.includes("save PDF and attach in chat alongside prompt") &&
        !figWarnEl.textContent.includes("choose Save as PDF"),
      "Direct PDF mode must omit 'choose Save as PDF' in figure warning"
    );

    runtime.reader.setPdfFallbackMode(true);
    runtime.reader.updateAiPopoverState();
    assert(
      figWarnEl.textContent.includes("click Save PDF, choose Save as PDF, and attach in chat"),
      "Fallback mode must include 'choose Save as PDF' in figure warning"
    );
    globalThis.chrome = prevChrome;
  });

  // ── Step 6: Dismiss & Escape Key ──────────────────────────────────────────
  await check("Hygiene: rapid open requests produce one Reader DOM", async () => {
    runtime.close();
    runtime.reader.destroy();
    runtime.invalidateDocument();
    runtime.lifecycle.transition(LifecycleState.ACTIVE);

    const originalTraverseAll = runtime.traverser.traverseAll.bind(runtime.traverser);
    let traversalCalls = 0;
    runtime.traverser.traverseAll = async (...args) => {
      traversalCalls++;
      return originalTraverseAll(...args);
    };
    await Promise.all([runtime.open(), runtime.open()]);
    runtime.traverser.traverseAll = originalTraverseAll;

    const hostEl = document.getElementById("unfold-root");
    assert(traversalCalls === 1, "Rapid open requests must traverse exactly once");
    assert(hostEl.shadowRoot.querySelectorAll("#saq-backdrop").length === 1, "Rapid open must leave one backdrop");
    assert(hostEl.shadowRoot.querySelectorAll("#saq-sheet").length === 1, "Rapid open must leave one sheet");
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  await check("Hygiene: opening an open Reader focuses it without re-traversal", async () => {
    let showCalls = 0;
    const originalShow = runtime.reader.show.bind(runtime.reader);
    const originalTraverseAll = runtime.traverser.traverseAll.bind(runtime.traverser);
    runtime.reader.show = (...args) => {
      showCalls++;
      return originalShow(...args);
    };
    let traversalCalls = 0;
    runtime.traverser.traverseAll = async (...args) => {
      traversalCalls++;
      return originalTraverseAll(...args);
    };

    await runtime.open();

    runtime.reader.show = originalShow;
    runtime.traverser.traverseAll = originalTraverseAll;
    assert(showCalls === 1, "Opening an open Reader must refocus the existing drawer");
    assert(traversalCalls === 0, "Opening an open Reader must not re-traverse");
  });

  await check("Hygiene: traversal errors reset the guard and allow a later open", async () => {
    runtime.close();
    runtime.reader.destroy();
    runtime.invalidateDocument();
    runtime.lifecycle.transition(LifecycleState.ACTIVE);
    const originalTraverseAll = runtime.traverser.traverseAll;
    let attempts = 0;
    runtime.traverser.traverseAll = async (...args) => {
      attempts++;
      if (attempts === 1) throw Object.assign(new Error("boom"), { name: "TraversalError" });
      return originalTraverseAll.call(runtime.traverser, ...args);
    };
    await runtime.open();
    assert(runtime.lifecycle.state === LifecycleState.ACTIVE, "Traversal error must return runtime to ACTIVE");
    await runtime.open();
    runtime.traverser.traverseAll = originalTraverseAll;
    assert(attempts === 2, "A later open must extract again after a traversal error");
  });

  await check("Hygiene: navigation timeout resets the guard and allows a later open", async () => {
    runtime.close();
    runtime.reader.destroy();
    runtime.invalidateDocument();
    runtime.lifecycle.transition(LifecycleState.ACTIVE);
    const originalTraverseAll = runtime.traverser.traverseAll;
    let attempts = 0;
    runtime.traverser.traverseAll = async (...args) => {
      attempts++;
      if (attempts === 1) throw Object.assign(new Error("timeout"), { name: "NavigationTimeoutError" });
      return originalTraverseAll.call(runtime.traverser, ...args);
    };
    await runtime.open();
    assert(runtime.lifecycle.state === LifecycleState.ACTIVE, "Navigation timeout must return runtime to ACTIVE");
    await runtime.open();
    runtime.traverser.traverseAll = originalTraverseAll;
    assert(attempts === 2, "A later open must extract again after a navigation timeout");
  });

  await check("Hygiene: cancellation resets the guard and allows a later open", async () => {
    runtime.close();
    runtime.reader.destroy();
    runtime.invalidateDocument();
    runtime.lifecycle.transition(LifecycleState.ACTIVE);
    const originalTraverseAll = runtime.traverser.traverseAll;
    let attempts = 0;
    runtime.traverser.traverseAll = async (...args) => {
      attempts++;
      if (attempts === 1) throw Object.assign(new Error("cancelled"), { name: "TraversalCancellationError" });
      return originalTraverseAll.call(runtime.traverser, ...args);
    };
    await runtime.open();
    assert(runtime.lifecycle.state === LifecycleState.ACTIVE, "Cancellation must return runtime to ACTIVE");
    await runtime.open();
    runtime.traverser.traverseAll = originalTraverseAll;
    assert(attempts === 2, "A later open must extract again after cancellation");
  });

  await check("Hygiene: explicit refresh replaces content without duplicating Reader DOM", async () => {
    const originalTraverseAll = runtime.traverser.traverseAll.bind(runtime.traverser);
    let traversalCalls = 0;
    runtime.traverser.traverseAll = async (...args) => {
      traversalCalls++;
      return originalTraverseAll(...args);
    };
    await runtime.refresh();
    runtime.traverser.traverseAll = originalTraverseAll;
    const hostEl = document.getElementById("unfold-root");
    assert(traversalCalls === 1, "Explicit refresh must re-traverse once");
    assert(hostEl.shadowRoot.querySelectorAll("#saq-backdrop").length === 1, "Refresh must leave one backdrop");
    assert(hostEl.shadowRoot.querySelectorAll("#saq-sheet").length === 1, "Refresh must leave one sheet");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert(runtime.reader.isOpen(), "Reader must remain open after refresh");
  });

  // ── Step 6: Dismiss & Escape Key ──────────────────────────────────────────
  await check("Step 6: Dismissing Reader closes drawer and restores launcher", () => {
    runtime.close();

    const hostEl = document.getElementById("unfold-root");
    const sheet = hostEl.shadowRoot.querySelector("#saq-sheet");
    assert(!sheet.classList.contains("is-open"), "Sheet is closed");
    assert(runtime.lifecycle.state === LifecycleState.ACTIVE, "State returns to ACTIVE");

    const launcher = hostEl.shadowRoot.querySelector(".saq-launcher");
    assert(launcher.classList.contains("is-shown"), "Launcher is visible again");
  });

  // ── Step 7: Teardown & Destruction ────────────────────────────────────────
  await check("Step 7: Destroying runtime cleanly removes DOM and observers", () => {
    runtime.destroy();
    assert(runtime.lifecycle.state === LifecycleState.DESTROYED, "Lifecycle transitions to DESTROYED");
    const hostEl = document.getElementById("unfold-root");
    assert(hostEl === null, "Shadow host #unfold-root is completely removed from DOM");
  });

  await check("Hygiene: destroy removes all Reader nodes and is idempotent", async () => {
    const teardownRuntime = new UnfoldRuntime({ extractor: new SemanticExtractor(portalAdapter) });
    teardownRuntime.initialize();
    await teardownRuntime.open();
    teardownRuntime.destroy();
    teardownRuntime.destroy();
    assert(document.querySelectorAll("[id^='saq-']").length === 0, "Destroy must remove every #saq-* node");
  });

  if (!passed) {
    console.error("\nNode DOM Simulation Integration Tests FAILED.");
    process.exit(1);
  } else {
    console.log("\n==================================================");
    console.log("✓ All Node DOM Simulation Integration Tests Passed!");
    console.log("==================================================\n");
  }
}

runBrowserIntegrationTests();
