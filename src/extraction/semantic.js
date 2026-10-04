/**
 * High-Fidelity Semantic Assessment Extractor.
 * 
 * Replaces legacy HTML scraping with structured semantic DOM extraction.
 * Extracts question stem, choice options, types, marks, and review data
 * into the Canonical Document Model without duplicate text or DOM leakage.
 */

import { $$, isEscapedHtml, lowestCommonAncestor } from "../utils/dom.js";
import { IITM_SELECTORS } from "../portal/selectors.js";
import { QuestionType, ContentType } from "../model/types.js";
import { QuestionNode, OptionNode, ContentNode } from "../model/document.js";
import { SemanticWalker } from "../parsers/semantic-walker.js";

export class SemanticExtractor {
  constructor(portal, options = {}) {
    this.portal = portal;
    this.walker = new SemanticWalker(options);
  }

  /**
   * Discovers and classifies the question type from DOM form controls and structure.
   * @param {Element} qRoot
   * @returns {string} One of QuestionType enum values
   */
  detectQuestionType(qRoot) {
    if (!qRoot) return QuestionType.UNKNOWN;

    // Numerical input
    if (qRoot.querySelector("input[type=number]")) {
      return QuestionType.NUMERICAL;
    }

    // Long descriptive text area
    if (qRoot.querySelector("textarea")) {
      return QuestionType.DESCRIPTIVE;
    }

    // Single line text input
    if (qRoot.querySelector("input[type=text]")) {
      return QuestionType.TEXT;
    }

    // Multiple selection (checkboxes or [role=checkbox])
    const checkboxes = qRoot.querySelectorAll("button.choice[role=checkbox], input[type=checkbox], [role=checkbox]");
    if (checkboxes.length > 0) {
      return QuestionType.MSQ;
    }

    // Single selection (radios or [role=radio])
    const radios = qRoot.querySelectorAll("button.choice[role=radio], input[type=radio], [role=radio]");
    if (radios.length > 0 || qRoot.querySelector("fieldset.mcq, .choices[role=radiogroup], [role=radiogroup]")) {
      return QuestionType.MCQ;
    }

    return QuestionType.UNKNOWN;
  }

  /**
   * Extracts marks allocated to the current question if present in the header.
   * @param {Element} view
   * @returns {number|null}
   */
  extractMarks(view) {
    if (!view) return null;
    const marksEl = view.querySelector(".question-marks, .marks, .header .marks");
    const text = marksEl?.textContent || view.textContent || "";
    const m = text.match(/(\d+(?:\.\d+)?)\s*Marks?/i);
    return m ? parseFloat(m[1]) : null;
  }

  /**
   * Extracts semantic ContentNodes and raw HTML for the question stem.
   * Guarantees that option controls (.choice-text.backend-html) and review panels
   * are strictly excluded from the question stem.
   * @param {Element} view
   * @param {Element} qRoot
   * @param {boolean} reviewMode
   * @returns {{ nodes: ContentNode[], rawHtml: string, diagnostics: Object }}
   */
  extractStem(view, qRoot, reviewMode) {
    const rp = reviewMode ? this.portal.getReviewPanel() : null;
    const textSeen = new Set();

    const isInsideControlsOrReview = (el) => {
      if (qRoot && qRoot.contains(el)) return true;
      if (rp && rp.contains(el)) return true;
      if (
        el.closest &&
        el.closest(
          ".choices, [role=radiogroup], .choice, button.choice, label.choice, [role=radio], [role=checkbox], .evaluated-answer"
        )
      ) {
        return true;
      }
      return false;
    };

    // Query .backend-html elements strictly outside question controls and review panel
    const stemElements = $$(IITM_SELECTORS.content.backendHtml, view).filter(
      (el) => !isInsideControlsOrReview(el)
    );

    // Deduplicate responsive DOM variants (e.g. desktop vs mobile view) by normalized text content
    const uniqueStemElements = stemElements.filter((el) => {
      const textSig = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!textSig) return false;
      if (textSeen.has(textSig)) return false;
      textSeen.add(textSig);
      return true;
    });

    const allNodes = [];
    const allHtml = [];
    let combinedDiagnostics = {
      nodeCount: 0,
      mathCount: 0,
      codeBlockCount: 0,
      tableCount: 0,
      imageCount: 0,
      unhandledTags: [],
    };

    if (uniqueStemElements.length > 0) {
      for (const el of uniqueStemElements) {
        allHtml.push(el.outerHTML);
        const { nodes, diagnostics } = this.walker.walk(el);
        allNodes.push(...nodes);
        this.mergeDiagnostics(combinedDiagnostics, diagnostics);
      }
      return {
        nodes: allNodes,
        rawHtml: allHtml.join(""),
        diagnostics: combinedDiagnostics,
      };
    }

    // Fallback: legend element inside question
    const legendEl = qRoot.querySelector(IITM_SELECTORS.content.legend);
    if (legendEl) {
      const isEscaped = isEscapedHtml(legendEl);
      const rawHtml = isEscaped ? `<div>${legendEl.textContent}</div>` : legendEl.outerHTML;
      const { nodes, diagnostics } = this.walker.walk(legendEl);
      return {
        nodes,
        rawHtml,
        diagnostics,
      };
    }

    return {
      nodes: [],
      rawHtml: "",
      diagnostics: combinedDiagnostics,
    };
  }

  /**
   * Extracts structured OptionNode items with semantic content from question controls.
   * Accurately supports real IITM structures:
   * button.choice[role=radio/checkbox] > .choice-letter, .choice-text.backend-html
   * Excludes auxiliary buttons (e.g. "Clear Selection") and presentation indicators.
   * @param {Element} qRoot
   * @param {number} questionIndex
   * @param {boolean} reviewMode
   * @returns {{ options: OptionNode[], rawHtml: string, diagnostics: Object }}
   */
  extractOptions(qRoot, questionIndex, reviewMode) {
    if (!qRoot) {
      return { options: [], rawHtml: "", diagnostics: {} };
    }

    const rawHtml = this.captureRawOptionsHtml(qRoot, reviewMode);
    const options = [];

    // Query candidate choice elements using robust ARIA and verified IITM classes
    const selector = IITM_SELECTORS.choices?.choice || "[role=radio], [role=checkbox], .choice";
    const rawChoiceElements = $$(selector, qRoot);

    const choiceElements = rawChoiceElements.filter((el) => {
      // Exclude auxiliary buttons such as "Clear Selection"
      if (el.matches && el.matches(IITM_SELECTORS.choices?.auxiliaryIgnore || ".clear-selection")) return false;
      if (el.classList.contains("clear-selection") || el.classList.contains("choice-clear")) return false;
      const text = (el.textContent || "").trim().toLowerCase();
      if (text === "clear selection" || text === "clear") return false;
      return true;
    });

    // Deduplicate by identity
    const uniqueChoiceElements = [];
    const seenElements = new Set();
    for (const el of choiceElements) {
      if (!seenElements.has(el)) {
        seenElements.add(el);
        uniqueChoiceElements.push(el);
      }
    }

    let combinedDiagnostics = {
      nodeCount: 0,
      mathCount: 0,
      codeBlockCount: 0,
      tableCount: 0,
      imageCount: 0,
      unhandledTags: [],
    };

    uniqueChoiceElements.forEach((choiceEl, i) => {
      // 1. Discover option letter (e.g. "A.", "B.", "A", "(A)")
      const letterSelector = IITM_SELECTORS.choices?.choiceLetter || ".choice-letter, .letter";
      const letterEl = choiceEl.querySelector(letterSelector);
      let letter = (letterEl?.textContent || "").trim();
      // Normalize: strip trailing periods, colons, or enclosing parentheses (e.g. "A." -> "A", "(B)" -> "B")
      letter = letter.replace(/^[\s(]+|[.\s):]+$/g, "");
      if (!letter) {
        letter = String.fromCharCode(65 + i);
      }

      // 2. Discover option text container (.choice-text.backend-html or .choice-text)
      const textSelector = IITM_SELECTORS.choices?.choiceText || ".choice-text.backend-html, .choice-text, .text";
      const textEl = choiceEl.querySelector(textSelector);
      let contentNodes = [];

      if (textEl) {
        // Walk ONLY the content-bearing container.
        // This automatically excludes .choice-indicator, radio circles, selection icons, and .choice-letter!
        const { nodes, diagnostics } = this.walker.walk(textEl);
        contentNodes = nodes;
        this.mergeDiagnostics(combinedDiagnostics, diagnostics);
      } else {
        // Fallback: clone choice, prune presentation/indicator/letter elements, then walk
        const clone = choiceEl.cloneNode(true);
        const toPrune = clone.querySelectorAll(
          ".choice-letter, .letter, .choice-indicator, .indicator, .radio-circle, .selection-icon, input, button, svg"
        );
        toPrune.forEach((p) => p.remove());

        const { nodes, diagnostics } = this.walker.walk(clone);
        contentNodes = nodes;
        this.mergeDiagnostics(combinedDiagnostics, diagnostics);
      }

      // If contentNodes are wrapped in a single PARAGRAPH, extract children if appropriate
      if (contentNodes.length === 1 && contentNodes[0].type === ContentType.PARAGRAPH) {
        contentNodes = contentNodes[0].children.length > 0
          ? contentNodes[0].children
          : [new ContentNode({ type: ContentType.TEXT, value: contentNodes[0].value })];
      }

      // 3. Selection state (robust ARIA and class inspection)
      const isSelected =
        choiceEl.getAttribute("aria-checked") === "true" ||
        choiceEl.getAttribute("aria-selected") === "true" ||
        choiceEl.classList.contains("selected") ||
        choiceEl.classList.contains("active") ||
        Boolean(choiceEl.querySelector("input:checked"));

      // 4. Correctness state (review mode)
      let isCorrect = null;
      if (reviewMode) {
        if (choiceEl.classList.contains("correct") || choiceEl.classList.contains("is-correct")) {
          isCorrect = true;
        } else if (choiceEl.classList.contains("incorrect") || choiceEl.classList.contains("is-incorrect")) {
          isCorrect = false;
        }
      }

      options.push(
        new OptionNode({
          id: choiceEl.getAttribute("id") || `opt-${questionIndex + 1}-${i + 1}`,
          letter,
          content: contentNodes,
          selected: isSelected,
          isCorrect,
          feedback: null,
        })
      );
    });

    return {
      options,
      rawHtml,
      diagnostics: combinedDiagnostics,
    };
  }

  /**
   * Helper to capture read-only snapshot of options HTML for legacy fallback.
   */
  captureRawOptionsHtml(qRoot, reviewMode) {
    if (!reviewMode) {
      const clone = qRoot.cloneNode(true);
      clone.querySelectorAll("input, textarea, select, button").forEach((el) => {
        el.setAttribute("disabled", "true");
        el.setAttribute("tabindex", "-1");
      });
      return clone.innerHTML;
    }

    const rp = this.portal.getReviewPanel();
    if (rp) return rp.outerHTML;

    const view = this.portal.getAssessmentView();
    const banner = $$(IITM_SELECTORS.declutter.main || "*", view)
      .filter(
        (e) =>
          IITM_SELECTORS.metadata.reviewDetectRegex.test(e.textContent || "") && !e.contains(qRoot)
      )
      .sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length)[0];

    const target = banner ? lowestCommonAncestor(banner, qRoot) : qRoot;
    return target ? target.outerHTML : qRoot.outerHTML;
  }

  /**
   * Extracts review results (score, status, feedback) if in review mode.
   */
  extractReviewData(view, qRoot) {
    const isReview = this.portal.isReviewMode();
    if (!isReview) return null;

    const feedbackEl = view.querySelector(IITM_SELECTORS.content.feedback);
    const feedbackTitle = feedbackEl?.querySelector(IITM_SELECTORS.content.feedbackTitle);
    const feedbackText = feedbackEl
      ? feedbackEl.textContent.replace(feedbackTitle?.textContent || "", "").trim()
      : null;

    const statusEl = view.querySelector(".status, .evaluated-answer .status");
    const statusText = (statusEl?.textContent || "").trim();
    const isCorrect = statusText.toLowerCase().includes("correct") && !statusText.toLowerCase().includes("incorrect");

    const scoreEl = view.querySelector(".score, .evaluated-answer .score");
    const scoreMatch = (scoreEl?.textContent || "").match(/Score\s*:\s*(\d+(?:\.\d+)?)/i);
    const score = scoreMatch ? parseFloat(scoreMatch[1]) : (isCorrect ? 1 : 0);

    return {
      mode: "evaluated",
      isCorrect,
      score,
      statusText,
      feedback: feedbackText,
    };
  }

  /**
   * Merges two diagnostics summaries.
   */
  mergeDiagnostics(target, source) {
    target.nodeCount += source.nodeCount || 0;
    target.mathCount += source.mathCount || 0;
    target.codeBlockCount += source.codeBlockCount || 0;
    target.tableCount += source.tableCount || 0;
    target.imageCount += source.imageCount || 0;
    if (Array.isArray(source.unhandledTags)) {
      const set = new Set([...target.unhandledTags, ...source.unhandledTags]);
      target.unhandledTags = Array.from(set);
    }
  }

  /**
   * Captures the current question into a Canonical QuestionNode with semantic AST.
   * @param {number} index Zero-based question index
   * @param {boolean} reviewMode
   * @returns {QuestionNode}
   */
  captureCurrentQuestion(index = 0, reviewMode = false) {
    const view = this.portal.getAssessmentView();
    const qRoot = this.portal.getCurrentQuestionElement();
    const isReview = reviewMode || this.portal.isReviewMode();

    const logicalNum = this.portal?.getActiveLogicalNumber ? this.portal.getActiveLogicalNumber() : null;
    const number = logicalNum !== null ? logicalNum : index + 1;
    const label = `Question ${number}`;

    if (!view || !qRoot) {
      return new QuestionNode({
        id: `q-${number}`,
        number,
        label,
        type: QuestionType.UNKNOWN,
        stem: [],
        options: [],
        status: { answered: false, flagged: false },
        review: null,
      });
    }

    const type = this.detectQuestionType(qRoot);
    const marks = this.extractMarks(view);

    const stemResult = this.extractStem(view, qRoot, isReview);
    const optsResult = this.extractOptions(qRoot, index, isReview);
    const reviewData = this.extractReviewData(view, qRoot);

    const combinedDiagnostics = { ...stemResult.diagnostics };
    this.mergeDiagnostics(combinedDiagnostics, optsResult.diagnostics);

    const isFlagged = Boolean(
      (this.portal?.getActiveChip &&
        (this.portal.getActiveChip()?.classList.contains("flagged") ||
          this.portal.getActiveChip()?.getAttribute("aria-label")?.toLowerCase().includes("flagged"))) ||
        qRoot.querySelector(".flagged, [aria-label*='flagged' i]")
    );

    const hasAnswer =
      optsResult.options.some((o) => o.selected) ||
      Boolean(qRoot.querySelector("input:checked, textarea:not(:empty)"));

    return new QuestionNode({
      id: `q-${number}`,
      number,
      label,
      type,
      marks,
      stem: stemResult.nodes,
      options: optsResult.options,
      status: {
        answered: hasAnswer,
        flagged: isFlagged,
      },
      review: reviewData,
      legacyMigrationData: {
        stemHtml: stemResult.rawHtml,
        optsHtml: optsResult.rawHtml,
      },
      metadata: {
        diagnostics: combinedDiagnostics,
      },
    });
  }
}
