/**
 * High-Fidelity Programming Assignment Extractor, State Machine, & Traversal Engine.
 * 
 * Provides dedicated, production-hardened extraction for IIT Madras programming assignments:
 * - Multi-signal assessment state detection (INSTRUCTIONS, QUESTION, TEST_CASES, LOADING, UNKNOWN)
 * - Strict separation: Instructions are metadata, NEVER questions
 * - Multi-question traversal supporting paginator windows (forward/rewind) without polling
 * - State restoration: preserves and restores user's initial question, tab, and paginator location
 * - Extracts problem statements as semantic ContentNode AST with images and math
 * - First-class language extraction & normalization for Bash, SQL, Python, Java, JavaScript
 * - Tab-switching adapter for Test Cases tab without fixed sleeps
 * - Reads current code from Ace editor instance via ProgrammingEditorAdapter
 * - Generates canonical AssignmentDocument with diagnostics and AssessmentFamily.PROGRAMMING
 * - Read-only traversal with zero answer mutation, zero auto-run, zero auto-submit
 */

import { $, $$ } from "../utils/dom.js";
import { IITM_SELECTORS } from "../portal/selectors.js";
import { QuestionType, ContentType, AssessmentFamily } from "../model/types.js";
import {
  AssignmentDocument,
  QuestionNode,
  ContentNode,
  TestCaseNode,
  ProgrammingAssignmentData,
} from "../model/document.js";
import { SemanticWalker } from "../parsers/semantic-walker.js";
import { resolveAceContext, getAceEditorInstance, ProgrammingEditorAdapter, requestMainWorldBridge } from "../bridge/ace-bridge.js";
import { normalizeProgrammingLanguage } from "../bridge/languages.js";
import {
  AssessmentNotDetectedError,
  QuestionReadinessError,
  TraversalIncompleteError,
  StateRestorationError,
} from "./errors.js";

/**
 * Assessment View States.
 */
export const AssessmentState = Object.freeze({
  INSTRUCTIONS: "INSTRUCTIONS",
  QUESTION: "QUESTION",
  TEST_CASES: "TEST_CASES",
  SOLUTION: "SOLUTION",
  LOADING: "LOADING",
  UNKNOWN: "UNKNOWN",
  ERROR: "ERROR",
});

/**
 * Extraction Completeness Status.
 */
export const ExtractionStatus = Object.freeze({
  COMPLETE: "COMPLETE",
  PARTIAL: "PARTIAL",
  FAILED: "FAILED",
});

/**
 * Extraction Operation Lifecycle States.
 */
export const ExtractionState = Object.freeze({
  IDLE: "IDLE",
  DETECTING: "DETECTING",
  CAPTURING_INSTRUCTIONS: "CAPTURING_INSTRUCTIONS",
  ENUMERATING: "ENUMERATING",
  NAVIGATING: "NAVIGATING",
  EXTRACTING_QUESTION: "EXTRACTING_QUESTION",
  EXTRACTING_TEST_CASES: "EXTRACTING_TEST_CASES",
  VALIDATING: "VALIDATING",
  RESTORING: "RESTORING",
  SUCCESS: "SUCCESS",
  PARTIAL: "PARTIAL",
  ERROR: "ERROR",
  CANCELLED: "CANCELLED",
});

export class ProgrammingAssignmentExtractor {
  constructor(doc = typeof document !== "undefined" ? document : null, options = {}) {
    this.doc = doc;
    this.options = {
      tabSwitchTimeoutMs: 3000,
      navigationTimeoutMs: 4000,
      walker: null,
      ...options,
    };
    this.walker = this.options.walker || new SemanticWalker();
    this.state = ExtractionState.IDLE;
  }

  /**
   * Returns true if the DOM currently contains an active programming assignment view.
   * Uses multiple independent signals to avoid false positives.
   * 
   * @param {Document|Element} [root]
   * @returns {boolean}
   */
  isProgrammingAssignment(root = this.doc) {
    if (!root || typeof root.querySelector !== "function") return false;

    const hasView = Boolean(
      $(IITM_SELECTORS.programming?.view || "app-programming-assignment-view, .programming-assignment-view", root)
    );
    const hasQuestionRoot = Boolean(
      $(IITM_SELECTORS.programming?.questionRoot || "app-pa-question, .pa-question", root)
    );
    const hasEditorRoot = Boolean(
      $(IITM_SELECTORS.programming?.editorRoot || "app-pa-code-editor, app-code-editor, .pa-code-editor", root)
    );
    const hasAce = Boolean($(IITM_SELECTORS.programming?.aceContainer || ".ace_editor, .ace-container", root));

    // Overview/instructions are metadata pages, never an active coding surface.
    return hasView || (hasQuestionRoot && (hasEditorRoot || hasAce)) || (hasEditorRoot && hasAce);
  }

  /**
   * Detects the current active assessment state from the DOM.
   * @param {Element} [root]
   * @returns {string} AssessmentState enum value
   */
  detectCurrentState(root = this.doc) {
    if (!root) {
      return AssessmentState.UNKNOWN;
    }

    // Check for Instructions screen
    const instructionsPanel = $(
      "app-pa-instructions, .instructions-panel, .pa-instructions, app-assessment-instructions",
      root
    );
    const activeChip = $(IITM_SELECTORS.navigation?.activeChip, root);
    const activeChipText = (activeChip?.textContent || "").toLowerCase();
    const activeChipAria = (activeChip?.getAttribute("aria-label") || "").toLowerCase();

    if (
      instructionsPanel ||
      activeChipText.includes("instruction") ||
      activeChipAria.includes("instruction")
    ) {
      return AssessmentState.INSTRUCTIONS;
    }

    // Check for active tab item
    const activeTab = $(IITM_SELECTORS.programming?.tabActive || "button[role=tab][aria-selected='true']", root);
    if (activeTab) {
      const tabText = (activeTab.textContent || "").toLowerCase();
      if (tabText.includes("test") && tabText.includes("case")) {
        return AssessmentState.TEST_CASES;
      }
      if (tabText.includes("solution")) {
        return AssessmentState.SOLUTION;
      }
      if (tabText.includes("question")) {
        return AssessmentState.QUESTION;
      }
    }

    // Check for Test Cases tab active or test cases container rendered
    if ($("app-pa-testcases, .pa-testcases", root)) {
      return AssessmentState.TEST_CASES;
    }

    // Check for Solution active
    if ($("app-pa-solution, .pa-solution", root)) {
      return AssessmentState.SOLUTION;
    }

    // Check for Question active
    if ($(IITM_SELECTORS.programming?.questionRoot || "app-pa-question, .pa-question", root)) {
      return AssessmentState.QUESTION;
    }

    // Check for loading spinner
    if ($(".loading, .spinner, mat-spinner, .mat-progress-spinner", root)) {
      return AssessmentState.LOADING;
    }

    // Check for error panel
    if ($(".error-panel, .pa-error, .is-error-state", root)) {
      return AssessmentState.ERROR;
    }

    return AssessmentState.UNKNOWN;
  }

  /**
   * Extracts assignment-level instructions if present.
   * Instructions are metadata and NEVER a question.
   * 
   * @param {Element} [root]
   * @returns {ContentNode[]|null}
   */
  extractInstructions(root = this.doc) {
    if (!root) return null;
    const instEl = $(
      "app-pa-instructions .backend-html, .instructions-panel .backend-html, app-pa-instructions, .instructions-panel, .pa-instructions, app-assessment-instructions",
      root
    );
    if (!instEl) {

      return null;
    }

    const { nodes } = this.walker.walk(instEl);
    if (nodes && nodes.length > 0) {

      return nodes;
    }

    const text = (instEl.textContent || "").trim();
    if (text) {

      return [new ContentNode({ type: ContentType.PARAGRAPH, value: text })];
    }
    return null;
  }

  /**
   * Extracts metadata: title, course, week, and deadline.
   * @param {Element} [view]
   * @returns {{ title: string, week: string, course: string, deadline: string|null, url: string }}
   */
  extractMetadata(view = this.doc) {
    const root = view || this.doc;

    // 1. Title
    const titleEl =
      $(IITM_SELECTORS.programming?.headerTitle, root) ||
      $(IITM_SELECTORS.metadata?.assessmentTitle, root);
    const title = (titleEl?.textContent || "").replace(/\s+/g, " ").trim() || "Programming Assignment";

    // 2. Week / Parent title
    const breadcrumbEl =
      $(IITM_SELECTORS.programming?.breadcrumb, root) ||
      $(IITM_SELECTORS.metadata?.breadcrumbCurrent, root);
    let week = (breadcrumbEl?.textContent || "").replace(/\s+/g, " ").trim();
    if (!week) {
      const match = title.match(/\bweek[\s\-_:]*(\d{1,2})\b/i);
      if (match) week = `Week ${match[1]}`;
    }

    // 3. Course
    const courseEl = $(IITM_SELECTORS.metadata?.courseTitle, root);
    const course = (courseEl?.textContent || "").replace(/\s+/g, " ").trim();

    // 4. Timer / Deadline
    const timerEl = $(IITM_SELECTORS.programming?.timer, root);
    const deadline = (timerEl?.textContent || "").replace(/\s+/g, " ").trim() || null;

    const url = typeof window !== "undefined" ? window.location?.href || "" : "";
    return { title, week, course, deadline, url };
  }

  /**
   * Extracts semantic problem statement ContentNodes from app-pa-question.
   * @param {Element} [view]
   * @returns {{ nodes: ContentNode[], rawHtml: string, diagnostics: Object }}
   */
  extractProblem(view = this.doc) {
    const root = view || this.doc;
    const problemEl =
      $(IITM_SELECTORS.programming?.problemContent, root) ||
      $(IITM_SELECTORS.content?.backendHtml, $(IITM_SELECTORS.programming?.questionRoot, root));

    if (!problemEl) {
      return {
        nodes: [new ContentNode({ type: ContentType.PARAGRAPH, value: "No problem statement found." })],
        rawHtml: "",
        diagnostics: { warnings: ["Problem statement element not found"] },
      };
    }

    const rawHtml = problemEl.outerHTML || "";
    let { nodes, diagnostics } = this.walker.walk(problemEl);
    if (!nodes || nodes.length === 0) {
      const text = (problemEl.textContent || "").trim();
      if (text) {
        nodes = [new ContentNode({ type: ContentType.PARAGRAPH, value: text })];
      }
    }

    return { nodes: nodes || [], rawHtml, diagnostics };
  }
  /**
   * Discovers and extracts image references within the problem container.
   * @param {Element} [view]
   * @returns {Array<{ id: string, src: string, alt: string, width: number|null, height: number|null }>}
   */
  extractImages(view = this.doc) {
    const root = view || this.doc;
    const problemEl =
      $(IITM_SELECTORS.programming?.problemContent, root) ||
      $(IITM_SELECTORS.programming?.questionRoot, root);

    if (!problemEl) return [];

    const imgEls = $$("img", problemEl);
    const images = [];

    for (let idx = 0; idx < imgEls.length; idx++) {
      const el = imgEls[idx];
      let src =
        el.getAttribute?.("data-src") ||
        el.getAttribute?.("data-lazy-src") ||
        el.getAttribute?.("data-original") ||
        el.currentSrc ||
        el.getAttribute?.("src") ||
        "";
      const currentSrc = el.currentSrc || src;
      let absoluteUrl = src;

      if (src && !src.startsWith("data:") && !src.startsWith("blob:") && typeof window !== "undefined") {
        try {
          absoluteUrl = new URL(src, window.location.href).href;
          src = absoluteUrl;
        } catch {
          // Keep original src
        }
      }

      const alt = el.getAttribute?.("alt") || `Figure ${idx + 1}`;
      const title = el.getAttribute?.("title") || "";
      const width = parseInt(el.getAttribute?.("width") || String(el.naturalWidth || el.clientWidth || 0), 10) || null;
      const height = parseInt(el.getAttribute?.("height") || String(el.naturalHeight || el.clientHeight || 0), 10) || null;

      let caption = "";
      const figure = el.closest ? el.closest("figure") : null;
      if (figure) {
        const figcap = figure.querySelector("figcaption");
        if (figcap) caption = (figcap.textContent || "").trim();
      }

      const isDataUrl = Boolean(src && src.startsWith("data:"));
      const isBlobUrl = Boolean(src && src.startsWith("blob:"));
      const isRemote = Boolean(src && !isDataUrl && !isBlobUrl);

      images.push({
        id: `img-${idx + 1}`,
        src,
        currentSrc,
        absoluteUrl,
        alt,
        title,
        width: width && width > 0 ? width : null,
        height: height && height > 0 ? height : null,
        caption,
        isDataUrl,
        isBlobUrl,
        isRemote,
      });
    }

    return images;
  }

  /**
   * Extracts return and output instructions if present in question or metadata.
   * @param {Element} [view]
   * @returns {string}
   */
  extractReturnInstructions(view = this.doc) {
    const root = view || this.doc;
    if (!root) return "";

    const el = $(IITM_SELECTORS.programming?.returnInstructions, root);
    if (el) {
      return (el.textContent || "").trim();
    }

    const problemEl =
      $(IITM_SELECTORS.programming?.problemContent, root) ||
      $(IITM_SELECTORS.programming?.questionRoot, root);

    if (problemEl) {
      const candidates = $$("p, li, div", problemEl);
      for (const cand of candidates) {
        const text = (cand.textContent || "").trim();
        if (
          /^return\s*(?:the\s*)?instructions?[:\s]*/i.test(text) ||
          /^output\s*format[:\s]*/i.test(text) ||
          /^return\s*only\s+/i.test(text)
        ) {
          return text;
        }
      }
    }

    return "";
  }

  /**
   * Extracts examples from question content.
   * @param {Element} [view]
   * @returns {Array<{ input?: string, output?: string, explanation?: string }>}
   */
  extractExamples(view = this.doc) {
    const root = view || this.doc;
    const problemEl =
      $(IITM_SELECTORS.programming?.problemContent, root) ||
      $(IITM_SELECTORS.programming?.questionRoot, root);
    if (!problemEl) return [];

    const examples = [];
    const exampleSections = $$(".example, .example-block, [data-section='example']", problemEl);
    for (let i = 0; i < exampleSections.length; i++) {
      const sec = exampleSections[i];
      const inEl = $(".input, pre.input, .example-input", sec);
      const outEl = $(".output, pre.output, .example-output", sec);
      const expEl = $(".explanation, .example-explanation", sec);
      examples.push({
        input: (inEl?.textContent ?? "").trim(),
        output: (outEl?.textContent ?? "").trim(),
        explanation: (expEl?.textContent ?? "").trim(),
      });
    }

    return examples;
  }

  /**
   * Extracts constraints from question content.
   * @param {Element} [view]
   * @returns {string[]}
   */
  extractConstraints(view = this.doc) {
    const root = view || this.doc;
    const problemEl =
      $(IITM_SELECTORS.programming?.problemContent, root) ||
      $(IITM_SELECTORS.programming?.questionRoot, root);
    if (!problemEl) return [];

    const constraints = [];
    const constraintLists = $$(".constraints ul li, .constraints ol li, ul.constraints li", problemEl);
    for (const li of constraintLists) {
      const text = (li.textContent || "").trim();
      if (text) constraints.push(text);
    }

    return constraints;
  }

  /**
   * Extracts the programming language from the language selector dropdown or Ace session.
   * Supports Bash, SQL, Python, Java, and JavaScript.
   * 
   * @param {Element} [view]
   * @returns {string} Normalized canonical language identifier (e.g. "bash", "sql", "python", "java", "javascript")
   */
  extractLanguage(view = this.doc, aceContext = null) {
    const root = view || this.doc;
    const ctx = aceContext || resolveAceContext(root);

    // 1. Try from Ace session
    if (ctx && ctx.isReady && ctx.session) {
      const mode = ctx.session.getMode?.() || ctx.session.$mode;
      if (mode && typeof mode.$id === "string") {
        const rawMode = mode.$id.replace(/^ace\/mode\//, "");
        const normalized = normalizeProgrammingLanguage(rawMode);
        if (normalized) {
          return normalized;
        }
      }
    }

    // 2. Try from dropdown
    const langEl = $(IITM_SELECTORS.programming?.languageValue, root);
    const raw = (langEl?.textContent || "").replace(/\s+/g, " ").trim();
    const normalized = normalizeProgrammingLanguage(raw);
    if (normalized) {
      return normalized;
    }

    return "javascript";
  }

  /**
   * Extracts execution and solution capabilities from the toolbar and tabs.
   * @param {Element} [view]
   * @returns {{ canRun: boolean, canSubmit: boolean, hasSolution: boolean }}
   */
  extractCapabilities(view = this.doc) {
    const root = view || this.doc;
    const runBtn = $(IITM_SELECTORS.programming?.runCodeButton, root);
    const submitBtn = $(IITM_SELECTORS.programming?.submitButton, root);
    const solutionTab = $$(IITM_SELECTORS.programming?.tabItem, root).find((b) =>
      /solution/i.test(b.textContent || "")
    );

    return {
      canRun: Boolean(runBtn && !runBtn.disabled && runBtn.getAttribute("aria-disabled") !== "true"),
      canSubmit: Boolean(submitBtn && !submitBtn.disabled && submitBtn.getAttribute("aria-disabled") !== "true"),
      hasSolution: Boolean(solutionTab && !solutionTab.disabled && solutionTab.getAttribute("aria-disabled") !== "true"),
    };
  }

  /**
   * Extracts test cases from the DOM, performing semantic tab switching if needed.
   * Preserves and restores the user's active tab state.
   * 
   * @param {Element} [view]
   * @param {object} [options]
   * @param {boolean} [options.activateTab=true]
   * @returns {Promise<TestCaseNode[]>}
   */
  async extractTestCases(view = this.doc, { activateTab = true } = {}) {
    const root = view || this.doc;
    if (!root) {
      return [];
    }

    // 1. Check if test cases container is already rendered in DOM
    const existingTestCasesRoot = $(IITM_SELECTORS.programming?.testCasesRoot, root);
    if (existingTestCasesRoot && existingTestCasesRoot.children?.length > 0) {
      return await this.parseTestCasesFromContainer(existingTestCasesRoot);
    }

    // 2. Locate tab list and tab items
    const tabButtons = $$(IITM_SELECTORS.programming?.tabItem || "button[role=tab], .tab-item", root);
    const testCasesTabBtn = tabButtons.find(
      (btn) =>
        /test\s*cases/i.test(btn.textContent || "") ||
        /test\s*cases/i.test(btn.getAttribute?.("aria-label") || "")
    );

    if (testCasesTabBtn && activateTab && typeof testCasesTabBtn.click === "function") {
      const activeTabBtn =
        tabButtons.find(
          (btn) =>
            btn.getAttribute?.("aria-selected") === "true" ||
            btn.classList?.contains?.("active") ||
            btn.getAttribute?.("aria-pressed") === "true"
        ) || tabButtons.find((btn) => /question/i.test(btn.textContent || ""));

      try {
        testCasesTabBtn.click();
        const container = await this.waitForTestCasesContainer(root, this.options.tabSwitchTimeoutMs);
        if (container) {
          // If public test cases accordion is collapsed, expand it
          const accordionHeaders = $$(
            IITM_SELECTORS.programming?.accordionHeader || ".accordion-header, button.accordion-header",
            container
          );
          for (const hdr of accordionHeaders) {
            if (hdr.getAttribute?.("aria-expanded") === "false" && typeof hdr.click === "function") {
              const title = (hdr.textContent || "").toLowerCase();
              if (title.includes("public") || !title.includes("private")) {
                try {
                  hdr.click();
                } catch {}
              }
            }
          }
          return await this.parseTestCasesFromContainer(container);
        }
      } catch (err) {
        console.warn("[ProgrammingExtractor] Error switching to Test Cases tab:", err.message);
      } finally {
        // Restore previously active tab
        if (activeTabBtn && activeTabBtn !== testCasesTabBtn && typeof activeTabBtn.click === "function") {
          try {
            activeTabBtn.click();
            await this.waitForQuestionContainer(root, this.options.tabSwitchTimeoutMs);
          } catch (restoreErr) {
            console.warn("[ProgrammingExtractor] Error restoring tab:", restoreErr.message);
          }
        }
      }
    }

    return [];
  }

  /**
   * Parses structured TestCaseNode items from rendered container.
   * @param {Element} container
   * @returns {Promise<TestCaseNode[]>}
   */
  async parseTestCasesFromContainer(container) {
    if (!container) return [];

    // 1. Check for pill-slider pattern (.test-case-slider with .test-case-pill)
    const pills = $$(
      IITM_SELECTORS.programming?.testCasePill || ".test-case-slider .test-case-pill, .test-case-pill, button.test-case-pill",
      container
    );

    if (pills.length > 0) {
      const initialPill =
        pills.find(
          (p) => p.classList?.contains?.("is-selected") || p.getAttribute?.("aria-selected") === "true"
        ) || pills[0];

      const testCases = [];
      for (let idx = 0; idx < pills.length; idx++) {
        const pill = pills[idx];
        if (pills.length > 1 && typeof pill.click === "function") {
          try {
            pill.click();
            await new Promise((r) => setTimeout(r, 20));
          } catch {}
        }

        const pillText = (pill.textContent || "").replace(/\s+/g, " ").trim() || `Case ${idx + 1}`;
        const isSample = /sample/i.test(pillText) || idx === 0;
        const status = pill.classList?.contains?.("is-passed")
          ? "passed"
          : pill.classList?.contains?.("is-failed")
          ? "failed"
          : null;

        const detailsRoot = $(IITM_SELECTORS.programming?.testCaseDetails || ".test-case-details", container) || container;
        const blocks = $$(IITM_SELECTORS.programming?.testCaseBlock || ".test-case-block", detailsRoot);

        let input = "";
        let expectedOutput = "";
        let actualOutput = "";

        for (const block of blocks) {
          const titleEl = $(IITM_SELECTORS.programming?.testCaseBlockTitle || ".title, .wrapper .title", block);
          const contentEl = $(IITM_SELECTORS.programming?.testCaseBlockContent || ".content", block);
          const titleText = (titleEl?.textContent || "").toLowerCase();
          const val = (contentEl?.textContent ?? "").replace(/\r\n/g, "\n").trim();

          if (titleText.includes("input")) {
            input = val;
          } else if (titleText.includes("expected")) {
            expectedOutput = val;
          } else if (titleText.includes("actual")) {
            actualOutput = val;
          }
        }

        if (!input && !expectedOutput) {
          const inEl = $(IITM_SELECTORS.programming?.testCaseInput, detailsRoot);
          const outEl = $(IITM_SELECTORS.programming?.testCaseOutput, detailsRoot);
          input = (inEl?.textContent ?? "").replace(/\r\n/g, "\n").trim();
          expectedOutput = (outEl?.textContent ?? "").replace(/\r\n/g, "\n").trim();
        }

        testCases.push(
          new TestCaseNode({
            id: `tc-${idx + 1}`,
            index: idx + 1,
            description: pillText,
            input,
            expectedOutput,
            actualOutput,
            isSample,
            isVisible: true,
            status,
          })
        );
      }

      // Restore initial pill selection
      if (initialPill && typeof initialPill.click === "function") {
        try {
          initialPill.click();
        } catch {}
      }

      if (testCases.length > 0 && testCases.some((tc) => tc.input || tc.expectedOutput)) {
        return testCases;
      }
    }

    // 2. Check for multiple distinct test case cards or items (.test-case-card, .test-case-item, .test-case)
    const items = $$(IITM_SELECTORS.programming?.testCaseItem || ".test-case, .test-case-item, .test-case-card", container);
    const filteredItems = items.filter((el) => {
      if (el.classList?.contains?.("test-case-block") && el.closest?.(".test-case-details, .test-case-card")) {
        return false;
      }
      return true;
    });

    if (filteredItems.length > 0) {
      const testCases = [];
      for (let idx = 0; idx < filteredItems.length; idx++) {
        const itemEl = filteredItems[idx];
        const descEl = $(IITM_SELECTORS.programming?.testCaseDescription || ".description, .title, h3, h4", itemEl);
        let description = (descEl?.textContent || "").replace(/\s+/g, " ").trim() || `Test Case ${idx + 1}`;

        const blocks = $$(IITM_SELECTORS.programming?.testCaseBlock || ".test-case-block", itemEl);
        let input = "";
        let expectedOutput = "";
        let actualOutput = "";

        if (blocks.length > 0) {
          for (const block of blocks) {
            const titleEl = $(IITM_SELECTORS.programming?.testCaseBlockTitle || ".title, .wrapper .title", block);
            const contentEl = $(IITM_SELECTORS.programming?.testCaseBlockContent || ".content", block);
            const titleText = (titleEl?.textContent || "").toLowerCase();
            const val = (contentEl?.textContent ?? "").replace(/\r\n/g, "\n").trim();

            if (titleText.includes("input")) {
              input = val;
            } else if (titleText.includes("expected")) {
              expectedOutput = val;
            } else if (titleText.includes("actual")) {
              actualOutput = val;
            }
          }
        } else {
          const inEl = $(IITM_SELECTORS.programming?.testCaseInput || ".input, pre.input, .test-input", itemEl);
          const outEl = $(IITM_SELECTORS.programming?.testCaseOutput || ".output, pre.output, .test-output, .expected-output", itemEl);
          input = (inEl?.textContent ?? "").replace(/\r\n/g, "\n").trim();
          expectedOutput = (outEl?.textContent ?? "").replace(/\r\n/g, "\n").trim();
        }

        const isSample = /sample|visible/i.test(description) || idx === 0;

        testCases.push(
          new TestCaseNode({
            id: `tc-${idx + 1}`,
            index: idx + 1,
            description,
            input,
            expectedOutput,
            actualOutput,
            isSample,
            isVisible: true,
          })
        );
      }

      if (testCases.length > 0 && testCases.some((tc) => tc.input || tc.expectedOutput)) {
        return testCases;
      }
    }

    // 3. Fallback: <pre> tags
    const pres = $$("pre", container);
    if (pres.length >= 2) {
      const testCases = [];
      for (let i = 0; i < pres.length; i += 2) {
        testCases.push(
          new TestCaseNode({
            id: `tc-${Math.floor(i / 2) + 1}`,
            index: Math.floor(i / 2) + 1,
            description: `Sample Test Case ${Math.floor(i / 2) + 1}`,
            input: (pres[i].textContent || "").trim(),
            expectedOutput: (pres[i + 1]?.textContent || "").trim(),
            isSample: true,
            isVisible: true,
          })
        );
      }
      return testCases;
    }

    // 4. Fallback: raw text preservation
    const rawText = (container.textContent || "").trim();
    if (rawText && !/no\s*test\s*cases/i.test(rawText)) {
      return [
        new TestCaseNode({
          id: "tc-raw-1",
          index: 1,
          description: "Raw Test Cases",
          raw: rawText,
          isSample: true,
          isVisible: true,
        }),
      ];
    }

    return [];
  }

  /**
   * Waits for the test cases container to render via scoped MutationObserver.
   */
  waitForTestCasesContainer(root, timeoutMs = 3000) {
    const sel = IITM_SELECTORS.programming?.testCasesRoot || "app-pa-testcases, app-pa-test-cases, .pa-testcases, .test-cases";

    return new Promise((resolve) => {
      const immediate = $(sel, root);
      if (immediate) {
        return resolve(immediate);
      }

      let observer = null;
      let timer = null;

      const cleanup = () => {
        if (observer) observer.disconnect();
        clearTimeout(timer);
      };

      timer = setTimeout(() => {
        cleanup();
        const fallback = $(sel, root);
        if (!fallback) {
          console.warn(`[ProgrammingExtractor] waitForTestCasesContainer: timed out after ${timeoutMs}ms without matching element.`);
        }
        resolve(fallback);
      }, timeoutMs);

      if (typeof MutationObserver !== "undefined") {
        observer = new MutationObserver(() => {
          const found = $(sel, root);
          if (found) {
            cleanup();
            resolve(found);
          }
        });
        observer.observe(root, { childList: true, subtree: true });
      }
    });
  }

  /**
   * Waits for the question container to render via scoped MutationObserver.
   */
  waitForQuestionContainer(root, timeoutMs = 3000) {
    const sel = IITM_SELECTORS.programming?.questionRoot || "app-pa-question, .pa-question";

    return new Promise((resolve) => {
      const immediate = $(sel, root);
      if (immediate) {
        return resolve(immediate);
      }

      let observer = null;
      let timer = null;

      const cleanup = () => {
        if (observer) observer.disconnect();
        clearTimeout(timer);
      };

      timer = setTimeout(() => {
        cleanup();
        const fallback = $(sel, root);
        if (!fallback) {
          console.warn(`[ProgrammingExtractor] waitForQuestionContainer: timed out after ${timeoutMs}ms without matching element.`);
        }
        resolve(fallback);
      }, timeoutMs);

      if (typeof MutationObserver !== "undefined") {
        observer = new MutationObserver(() => {
          const found = $(sel, root);
          if (found) {
            cleanup();
            resolve(found);
          }
        });
        observer.observe(root, { childList: true, subtree: true });
      }
    });
  }
  /**
   * Dedicated readiness wait for the live Ace editor instance and session.
   * Inspects aceElement.env?.editor and session invariants on every cycle.
   * Bounded by MutationObserver, requestAnimationFrame / interval timers, and timeoutMs.
   * 
   * @param {Element|Document} [root]
   * @param {number} [timeoutMs=3000]
   * @returns {Promise<{ isReady: boolean, timedOut: boolean, state: object }>}
   */
  waitForAceEditor(root = this.doc, timeoutMs = 3000) {
    const doc = (root && root.nodeType === 9) ? root : (typeof document !== "undefined" ? document : null);
    const searchRoot = (root && root.nodeType === 1) ? root : doc;

    const inspectCurrentState = () => {
      if (!searchRoot) {
        return { aceDomFound: false, aceEnvFound: false, aceInstanceFound: false, sessionFound: false, isReady: false };
      }

      const aceElement =
        searchRoot.querySelector?.("app-pa-code-editor .ace_editor, app-pa-code-editor .ace-container") ||
        searchRoot.querySelector?.(".ace-container, .ace_editor") ||
        (doc && doc !== searchRoot ? doc.querySelector?.("app-pa-code-editor .ace_editor") : null);

      const aceDomFound = Boolean(aceElement);
      const aceEnvFound = Boolean(aceElement?.env);
      const editor = aceElement?.env?.editor || aceElement?._editor || aceElement?.editor;
      const aceInstanceFound = Boolean(editor);
      const session = editor?.getSession?.() || editor?.session;
      const sessionFound = Boolean(
        session &&
        typeof session.getValue === "function" &&
        (typeof session.getLength === "function" || typeof session.getLines === "function" || typeof session.getLine === "function") &&
        (typeof session.getMarkers === "function" || Boolean(session.$frontMarkers) || Boolean(session.markers))
      );

      let bridgeReady = false;
      if (!sessionFound && typeof requestMainWorldBridge === "function") {
        try {
          const bridgeResponse = requestMainWorldBridge("ping", {}, doc);
          if (bridgeResponse && bridgeResponse.ok && bridgeResponse.data && bridgeResponse.data.isReady) {
            bridgeReady = true;
          }
        } catch {}
      }

      const isReady = Boolean((aceDomFound && aceInstanceFound && sessionFound) || bridgeReady);
      return { aceDomFound: aceDomFound || bridgeReady, aceEnvFound, aceInstanceFound: aceInstanceFound || bridgeReady, sessionFound: sessionFound || bridgeReady, isReady, aceElement, editor, session, bridgeReady };
    };

    return new Promise((resolve) => {
      const initial = inspectCurrentState();

      if (initial.isReady) {
        return resolve({ isReady: true, timedOut: false, state: initial });
      }

      let observer = null;
      let timer = null;
      let animId = null;
      let pollTimer = null;
      let isDone = false;

      const cleanup = () => {
        isDone = true;
        if (observer) observer.disconnect();
        clearTimeout(timer);
        clearInterval(pollTimer);
        if (typeof cancelAnimationFrame === "function" && animId) {
          cancelAnimationFrame(animId);
        }
      };

      const checkAndComplete = () => {
        if (isDone) return;
        const current = inspectCurrentState();
        if (current.isReady) {
          cleanup();
          resolve({ isReady: true, timedOut: false, state: current });
        }
      };

      // 1. Hard deadline
      timer = setTimeout(() => {
        if (isDone) return;
        const finalState = inspectCurrentState();
        if (!finalState.isReady) {
          console.warn("[ProgrammingExtractor] waitForAceEditor: timed out after " + timeoutMs + "ms");
        }
        cleanup();
        resolve({ isReady: finalState.isReady, timedOut: !finalState.isReady, state: finalState });
      }, timeoutMs);

      // 2. Short-lived MutationObserver on container
      if (typeof MutationObserver !== "undefined" && searchRoot) {
        observer = new MutationObserver(() => {
          checkAndComplete();
        });
        const observeTarget =
          searchRoot.querySelector?.("app-pa-code-editor, app-code-editor") ||
          searchRoot;
        if (observeTarget) {
          try {
            observer.observe(observeTarget, { childList: true, subtree: true, attributes: true });
          } catch {}
        }
      }

      // 3. Fast rAF / interval polling for property attachment (which doesn't mutate DOM attributes)
      const scheduleRaf = () => {
        if (isDone) return;
        checkAndComplete();
        if (!isDone && typeof requestAnimationFrame === "function") {
          animId = requestAnimationFrame(scheduleRaf);
        }
      };

      if (typeof requestAnimationFrame === "function") {
        animId = requestAnimationFrame(scheduleRaf);
      }

      // 4. Interval safety net (every 30ms) for environments where rAF is throttled
      pollTimer = setInterval(() => {
        checkAndComplete();
      }, 30);
    });
  }

  /**
   * Reads the current code from the Ace editor.
   * @param {Element} [view]
   * @returns {string}
   */
  extractCurrentCode(view = this.doc) {
    const root = view || this.doc;
    const adapter = new ProgrammingEditorAdapter(root);
    return adapter.getCode();
  }

  /**
   * Enumerates navigable question targets from the paginator chips.
   * Excludes Instructions chips.
   * 
   * @param {Element} [root]
   * @returns {Array<{ number: number, element: Element, label: string }>}
   */
  enumerateQuestionTargets(root = this.doc) {
    const chips = $$(IITM_SELECTORS.navigation?.chip || "div.chips button.chip, button.chip", root);
    const targets = [];

    for (const chip of chips) {
      const text = (chip.textContent || "").trim();
      const aria = chip.getAttribute("aria-label") || "";

      // Exclude instructions chips
      if (/instruction/i.test(text) || /instruction/i.test(aria)) {
        continue;
      }

      let num = parseInt(text, 10);
      if (isNaN(num)) {
        const m = aria.match(/\b(\d+)\b/);
        if (m) num = parseInt(m[1], 10);
      }

      if (!isNaN(num) && num > 0) {
        targets.push({
          number: num,
          element: chip,
          label: aria || `Question ${num}`,
        });
      }
    }


    return targets;
  }

  /**
   * Navigates to a specific question target by clicking its chip and awaiting structural readiness.
   * 
   * @param {number} targetNumber
   * @param {Element} [root]
   * @returns {Promise<boolean>}
   */
  async navigateToQuestion(targetNumber, root = this.doc) {
    const targets = this.enumerateQuestionTargets(root);
    const target = targets.find((t) => t.number === targetNumber);
    if (!target || typeof target.element?.click !== "function") {
      console.warn(`[ProgrammingExtractor] navigateToQuestion: chip for Question ${targetNumber} not found or not clickable.`);
      return false;
    }

    return new Promise((resolve) => {
      let observer = null;
      let timer = null;

      const cleanup = () => {
        if (observer) observer.disconnect();
        clearTimeout(timer);
      };

      timer = setTimeout(() => {
        cleanup();
        console.warn(`[ProgrammingExtractor] navigateToQuestion: navigation to Question ${targetNumber} timed out after ${this.options.navigationTimeoutMs}ms, proceeding with DOM as-is.`);
        resolve(true); // Proceed even if observer timed out
      }, this.options.navigationTimeoutMs);

      if (typeof MutationObserver !== "undefined") {
        observer = new MutationObserver(() => {
          const activeChip = $(IITM_SELECTORS.navigation?.activeChip, root);
          const activeText = (activeChip?.textContent || "").trim();
          if (parseInt(activeText, 10) === targetNumber) {
            cleanup();
            resolve(true);
          }
        });
        const paginator = $(IITM_SELECTORS.navigation?.paginator, root) || root;
        observer.observe(paginator, { childList: true, subtree: true, attributes: true });
      }

      target.element.click();
    });
  }

  /**
   * Extracts a single Programming QuestionNode from the current active view.
   * 
   * @param {Element} [view]
   * @param {number} [questionNumber=1]
   * @param {object} [options]
   * @returns {Promise<QuestionNode>}
   */
  async extractCurrentQuestionNode(view = this.doc, questionNumber = 1, options = {}) {
    const root = view || this.doc;
    const meta = this.extractMetadata(root);

    // 1. Determine current active tab
    const activeTab = $(IITM_SELECTORS.programming?.tabActive || "button[role=tab][aria-selected='true']", root);
    const isTestCasesActive = activeTab && /test\s*cases/i.test(activeTab.textContent || "");

    // 2. Extract Question content (problem statement, images, return instructions, examples, constraints)
    let problemResult;
    if (isTestCasesActive) {
      const tabButtons = $$(IITM_SELECTORS.programming?.tabItem || "button[role=tab], .tab-item", root);
      const questionTabBtn = tabButtons.find((btn) => /question/i.test(btn.textContent || ""));
      if (questionTabBtn && typeof questionTabBtn.click === "function") {
        try {
          questionTabBtn.click();
          await this.waitForQuestionContainer(root, this.options.tabSwitchTimeoutMs);
        } catch {}
      }
      problemResult = this.extractProblem(root);
    } else {
      problemResult = this.extractProblem(root);
    }

    const { nodes: problemNodes, diagnostics: problemDiagnostics } = problemResult;
    const images = this.extractImages(root);
    const returnInstructions = this.extractReturnInstructions(root);
    const examples = this.extractExamples(root);
    const constraints = this.extractConstraints(root);
    const capabilities = this.extractCapabilities(root);

    // 3, 4, 5. Open Test Cases, extract Test Cases, restore original tab
    const testCases = await this.extractTestCases(root, options);

    // If initial tab was Test Cases, restore to Test Cases tab; otherwise ensure Question editor is ready
    if (isTestCasesActive) {
      const tabButtons = $$(IITM_SELECTORS.programming?.tabItem || "button[role=tab], .tab-item", root);
      const testCasesTabBtn = tabButtons.find((btn) => /test\s*cases/i.test(btn.textContent || ""));
      if (testCasesTabBtn && typeof testCasesTabBtn.click === "function") {
        try {
          testCasesTabBtn.click();
          await this.waitForTestCasesContainer(root, this.options.tabSwitchTimeoutMs);
        } catch {}
      }
    } else {
      // 6. Wait for Question editor to be ready after tab restoration
      await this.waitForQuestionContainer(root, this.options.tabSwitchTimeoutMs);
      await this.waitForAceEditor(root, this.options.tabSwitchTimeoutMs);
    }

    // 7, 8, 9. Resolve CURRENT .ace_editor, CURRENT ace.env.editor, CURRENT session AFTER tab restoration
    const aceContext = resolveAceContext(root);
    const adapter = new ProgrammingEditorAdapter(aceContext);

    // 10. Extract Language and prefix/current/suffix from the CURRENT live editor
    const language = this.extractLanguage(root, aceContext);

    adapter.captureStarterCode();
    const starterCode = adapter.getStarterCode();
    const currentCode = adapter.getCode();
    const prefixCode = adapter.getPrefixCode();
    const suffixCode = adapter.getSuffixCode();
    const hasPrefixCode = adapter.hasPrefixCode();
    const hasSuffixCode = adapter.hasSuffixCode();
    const editorIdentity = adapter.getEditorIdentity();
    const questionIdentity = adapter.getQuestionIdentity();
    const protectedRegions = adapter.getProtectedRegions();
    const isEditorReady = adapter.isReady();

    const hasAceDom = Boolean(
      aceContext.hasAceDom ||
      $(IITM_SELECTORS.programming?.aceContainer || ".ace-container, .ace_editor", root)
    );
    const hasAceInstance = Boolean(aceContext.hasAceInstance);
    // Warnings and extraction completeness determination
    const warnings = [...(problemDiagnostics?.warnings || [])];
    const tabButtons = $$(IITM_SELECTORS.programming?.tabItem || "button[role=tab], .tab-item", root);
    const hasTestCasesTab = tabButtons.some((btn) => /test\s*cases/i.test(btn.textContent || ""));

    if (hasTestCasesTab && testCases.length === 0) {
      warnings.push("Test Cases tab was detected but no test cases could be extracted.");
    }

    let prefixState = "NONE";
    let suffixState = "NONE";

    if (!isEditorReady) {
      prefixState = "UNAVAILABLE";
      suffixState = "UNAVAILABLE";
      if (hasAceDom) {
        warnings.push("Programming editor DOM is present but Ace editor instance was not initialized before the readiness timeout.");
      }
    } else {
      prefixState = hasPrefixCode ? (prefixCode !== null ? "AVAILABLE" : "FAILED") : "NONE";
      suffixState = hasSuffixCode ? (suffixCode !== null ? "AVAILABLE" : "FAILED") : "NONE";

      if (protectedRegions?.hasPrefix && prefixCode === null) {
        warnings.push("Protected prefix region detected in editor but prefix code was not extracted.");
        prefixState = "FAILED";
      }

      if (protectedRegions?.hasSuffix && suffixCode === null) {
        warnings.push("Protected suffix region detected in editor but suffix code was not extracted.");
        suffixState = "FAILED";
      }
    }

    const isPartial =
      (hasAceDom && !isEditorReady) ||
      (hasTestCasesTab && testCases.length === 0) ||
      (protectedRegions?.hasPrefix && prefixCode === null) ||
      (protectedRegions?.hasSuffix && suffixCode === null) ||
      Boolean(
        problemDiagnostics?.warnings?.length > 0 &&
          problemNodes.length === 1 &&
          problemNodes[0].value?.includes("not found")
      );

    const extractionStatus = isPartial ? "PARTIAL" : "COMPLETE";

    const programmingData = new ProgrammingAssignmentData({
      language,
      starterCode: isEditorReady ? starterCode : null,
      currentCode: isEditorReady ? currentCode : "",
      prefixCode: isEditorReady ? prefixCode : null,
      suffixCode: isEditorReady ? suffixCode : null,
      hasPrefixCode: isEditorReady ? hasPrefixCode : false,
      hasSuffixCode: isEditorReady ? hasSuffixCode : false,
      prefixState,
      suffixState,
      returnInstructions,
      testCases,
      examples,
      constraints,
      images,
      capabilities,
      editorIdentity,
      questionIdentity,
      extractionStatus,
      warnings,
      testCasesState: {
        available: testCases.length > 0,
        state: testCases.length > 0 ? "AVAILABLE" : hasTestCasesTab ? "EMPTY" : "UNAVAILABLE",
        cases: testCases,
        raw: "",
      },
    });

    return new QuestionNode({
      number: questionNumber,
      label: meta.title,
      type: QuestionType.PROGRAMMING,
      family: AssessmentFamily.PROGRAMMING,
      marks: null,
      stem: problemNodes,
      options: [],
      programmingData,
      status: { answered: Boolean(currentCode && currentCode.trim()), flagged: false },
      metadata: {
        language,
        testCaseCount: testCases.length,
        imageCount: images.length,
        prefixCodeLength: prefixCode !== null && prefixCode !== undefined ? prefixCode.length : null,
        starterCodeLength: starterCode !== null && starterCode !== undefined ? starterCode.length : null,
        currentCodeLength: currentCode ? currentCode.length : 0,
        suffixCodeLength: suffixCode !== null && suffixCode !== undefined ? suffixCode.length : null,
        extractionStatus,
        diagnostics: {
          ...problemDiagnostics,
          warnings,
          extractionStatus,
          editorIdentity,
          hasAceDom,
          hasAceInstance,
          isEditorReady,
          editorResolutionSource: aceContext.source,
          prefixCodeLength: prefixCode !== null && prefixCode !== undefined ? prefixCode.length : null,
          starterCodeLength: starterCode !== null && starterCode !== undefined ? starterCode.length : null,
          currentCodeLength: currentCode ? currentCode.length : 0,
          suffixCodeLength: suffixCode !== null && suffixCode !== undefined ? suffixCode.length : null,
          protectedRegionDetection: {
            isGuarded: Boolean(protectedRegions?.isGuarded),
            hasPrefix: Boolean(protectedRegions?.hasPrefix),
            hasSuffix: Boolean(protectedRegions?.hasSuffix),
            isAmbiguous: Boolean(protectedRegions?.isAmbiguous),
          },
        },
      },
    });
  }

  /**
   * Main Entry Point: Extracts the complete Programming Assignment into a canonical AssignmentDocument.
   * Handles Instructions, single/multi question traversal, paginator windows, and state restoration.
   * 
   * @param {Element} [view]
   * @param {object} [options]
   * @returns {Promise<AssignmentDocument>}
   */
  async extractAssignment(view = this.doc, options = {}) {
    const root = view || this.doc;
    const startTime = Date.now();
    this.state = ExtractionState.DETECTING;

    if (!this.isProgrammingAssignment(root)) {
      console.error("[ProgrammingExtractor] extractAssignment: isProgrammingAssignment returned false. Aborting extraction.");
      throw new AssessmentNotDetectedError("Active DOM does not contain a programming assignment.", {
        url: typeof window !== "undefined" ? window.location.href : "",
      });
    }

    const meta = this.extractMetadata(root);
    const instructions = this.extractInstructions(root);
    const targets = this.enumerateQuestionTargets(root);

    // If single question view or no paginator targets, extract current view directly
    if (targets.length <= 1) {
      options.onProgress?.(0, 1);
      const qNode = await this.extractCurrentQuestionNode(root, 1, options);
      options.onProgress?.(1, 1);
      const isPartial = qNode.programmingData?.extractionStatus === "PARTIAL";
      this.state = isPartial ? ExtractionState.PARTIAL : ExtractionState.SUCCESS;

      return new AssignmentDocument({
        metadata: {
          title: meta.title,
          course: meta.course,
          week: meta.week,
          totalQuestions: 1,
          family: AssessmentFamily.PROGRAMMING,
          url: meta.url,
          deadline: meta.deadline,
          instructions,
          diagnostics: {
            assessmentType: "PROGRAMMING_ASSIGNMENT",
            language: qNode.programmingData?.language || "javascript",
            expectedQuestionCount: 1,
            extractedQuestionCount: 1,
            failedQuestionIds: [],
            warnings: qNode.programmingData?.warnings || [],
            durationMs: Date.now() - startTime,
            extractionStatus: isPartial ? "PARTIAL" : "COMPLETE",
          },
        },
        questions: [qNode],
      });
    }

    // Multi-Question Traversal
    this.state = ExtractionState.ENUMERATING;
    const activeChip = $(IITM_SELECTORS.navigation?.activeChip, root);
    const initialNum = parseInt((activeChip?.textContent || "").trim(), 10) || 1;

    const questions = [];
    const failedQuestionIds = [];
    const warnings = [];

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      options.onProgress?.(i, targets.length);
      this.state = ExtractionState.NAVIGATING;
      try {
        const navigated = await this.navigateToQuestion(target.number, root);
        if (!navigated) {
          warnings.push(`Navigation to Question ${target.number} did not report completion.`);
        }
        this.state = ExtractionState.EXTRACTING_QUESTION;
        const qNode = await this.extractCurrentQuestionNode(root, target.number, options);
        questions.push(qNode);
      } catch (err) {
        console.error(`[ProgrammingExtractor] Error extracting Question ${target.number}:`, err);
        failedQuestionIds.push(target.number);
        warnings.push(`Failed to extract Question ${target.number}: ${err.message}`);
      }
      options.onProgress?.(i + 1, targets.length);
    }

    // Restore user's initial question location
    this.state = ExtractionState.RESTORING;
    try {
      await this.navigateToQuestion(initialNum, root);
    } catch (restoreErr) {
      console.warn(`[ProgrammingExtractor] Could not restore active question to initial Question ${initialNum}:`, restoreErr);
      warnings.push(`Could not restore active question to initial Question ${initialNum}.`);
    }

    const isPartial =
      questions.length < targets.length ||
      questions.some((q) => q.programmingData?.extractionStatus === "PARTIAL");
    this.state = isPartial ? ExtractionState.PARTIAL : ExtractionState.SUCCESS;


    return new AssignmentDocument({
      metadata: {
        title: meta.title,
        course: meta.course,
        week: meta.week,
        totalQuestions: targets.length,
        family: AssessmentFamily.PROGRAMMING,
        url: meta.url,
        deadline: meta.deadline,
        instructions,
        diagnostics: {
          assessmentType: "PROGRAMMING_ASSIGNMENT",
          language: questions[0]?.programmingData?.language || "javascript",
          expectedQuestionCount: targets.length,
          extractedQuestionCount: questions.length,
          failedQuestionIds,
          warnings,
          durationMs: Date.now() - startTime,
          restorationStatus: "RESTORED",
          extractionStatus: isPartial ? "PARTIAL" : "COMPLETE",
        },
      },
      questions,
    });
  }
}
