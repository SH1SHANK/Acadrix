/**
 * IITM Portal Adapter.
 * Encapsulates all direct DOM inspection and queries on IITM assessment pages.
 * No UI or traversal logic should query IITM selectors directly.
 */

import { $, $$ } from "../utils/dom.js";
import { IITM_SELECTORS } from "./selectors.js";

export class IitmPortalAdapter {
  constructor(doc = typeof document !== "undefined" ? document : null) {
    this.doc = doc;
  }

  /**
   * Returns true if an IITM assessment view is currently active in the DOM.
   */
  detectAssessment() {
    return Boolean(this.getPaginator() && this.getCurrentQuestionElement());
  }

  getPaginator() {
    return $(IITM_SELECTORS.navigation.paginator, this.doc);
  }

  getAssessmentView() {
    return $(IITM_SELECTORS.assessment.view, this.doc);
  }

  getCurrentQuestionElement() {
    return $(IITM_SELECTORS.assessment.root, this.doc);
  }

  /**
   * Queries fresh question chips from the currently active paginator in the DOM.
   * Never caches references across navigation.
   * @returns {HTMLButtonElement[]}
   */
  getQuestionChips() {
    return $$(IITM_SELECTORS.navigation.chip, this.doc);
  }

  /**
   * Extracts the 1-based logical question number from a chip button.
   * Checks explicit text content first, aria-label second, and data attributes third.
   * Never falls back to a window-relative index here.
   * @param {HTMLButtonElement} chip
   * @returns {number|null}
   */
  getChipLogicalNumber(chip) {
    if (!chip) return null;
    const txt = (chip.textContent || "").trim();
    const num = parseInt(txt, 10);
    if (!isNaN(num) && num > 0) return num;

    const aria = chip.getAttribute("aria-label") || "";
    const m = aria.match(/\b(\d+)\b/);
    if (m) return parseInt(m[1], 10);

    const dataNum = chip.getAttribute("data-question-number") || chip.getAttribute("data-index");
    if (dataNum) {
      const parsed = parseInt(dataNum, 10);
      if (!isNaN(parsed) && parsed >= 0) {
        return chip.hasAttribute("data-index") ? parsed + 1 : parsed;
      }
    }

    return null;
  }

  /**
   * Returns the currently active chip element in the DOM.
   * @returns {HTMLButtonElement|null}
   */
  getActiveChip() {
    return $(IITM_SELECTORS.navigation.activeChip, this.doc);
  }

  /**
   * Returns the zero-based index of the active chip in the currently visible window.
   * @returns {number}
   */
  getActiveChipIndex() {
    const list = this.getQuestionChips();
    return list.findIndex(
      (c) =>
        c.classList.contains("active") ||
        c.classList.contains("current") ||
        c.getAttribute("aria-current") === "true" ||
        c.getAttribute("aria-selected") === "true"
    );
  }

  /**
   * Returns the 1-based logical question number of the currently active question.
   * Uses active chip text, falling back to assessment header text.
   * @returns {number|null}
   */
  getActiveLogicalNumber() {
    const activeChip = this.getActiveChip();
    if (activeChip) {
      const chipNum = this.getChipLogicalNumber(activeChip);
      if (chipNum !== null) return chipNum;
    }

    // Fallback: header text (e.g. "Question 3 / 10")
    const view = this.getAssessmentView();
    if (view) {
      const headerEl = $(IITM_SELECTORS.metadata.questionHeader, view);
      const textToMatch = headerEl?.textContent || view.textContent || "";
      const match = textToMatch.match(IITM_SELECTORS.metadata.currentNumberRegex);
      if (match) return parseInt(match[1], 10);
    }

    return null;
  }

  /**
   * Returns the zero-based global question index.
   * @returns {number|null}
   */
  getActiveIndex() {
    const logical = this.getActiveLogicalNumber();
    return logical !== null ? logical - 1 : null;
  }

  /**
   * Returns total question count reported by the assessment view.
   * @returns {number|null}
   */
  getTotalQuestionCount() {
    const view = this.getAssessmentView();
    if (!view) return null;
    const match = (view.textContent || "").match(IITM_SELECTORS.metadata.totalCountRegex);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Returns a unique identity string for the current visible paginator window.
   * E.g. "1-5" or comma-separated numbers of currently visible chips.
   * @returns {string}
   */
  getPaginatorWindowIdentity() {
    const chips = this.getQuestionChips();
    if (!chips.length) return "empty";
    const numbers = chips.map((c) => this.getChipLogicalNumber(c)).filter((n) => n !== null);
    if (!numbers.length) return `count-${chips.length}`;
    return `${numbers[0]}..${numbers[numbers.length - 1]}`;
  }

  /**
   * Returns the smallest stable ancestor element that survives question container replacement.
   * Typically the parent element of <app-assessment-question-view> or the assessment main element.
   * @returns {HTMLElement}
   */
  getStableAssessmentAncestor() {
    const view = this.getAssessmentView();
    if (view && view.parentElement) {
      return view.parentElement;
    }
    const paginator = this.getPaginator();
    if (paginator && paginator.parentElement) {
      return paginator.parentElement;
    }
    const main = $(IITM_SELECTORS.declutter.main, this.doc);
    if (main) return main;
    return view || this.doc.body;
  }

  /**
   * Helper to check if a navigation button is interactive and not disabled.
   * @param {Element|null} btn
   * @returns {boolean}
   */
  isButtonEnabled(btn) {
    if (!btn) return false;
    if (btn.disabled || btn.hasAttribute("disabled")) return false;
    if (btn.getAttribute("aria-disabled") === "true") return false;
    if (
      btn.classList.contains("disabled") ||
      btn.classList.contains("mat-button-disabled")
    ) {
      return false;
    }
    return true;
  }

  /**
   * Discovers the "Next Page / Window" button in the assessment paginator.
   * Uses standard CSS selectors, descendant icon/text inspection, and DOM positioning.
   * Never relies on non-standard pseudo-selectors like :contains().
   * @returns {HTMLButtonElement|null}
   */
  getNextWindowButton() {
    const paginator = this.getPaginator();

    // 1. Direct standard class/attribute match inside paginator or document
    const root = paginator || this.doc;
    const directMatch = $(IITM_SELECTORS.navigation.nextWindow, root);
    if (directMatch) return directMatch;

    if (!paginator) return null;

    // 2. Query non-chip buttons in the paginator and inspect attributes/descendants in JavaScript
    const candidateButtons = Array.from(paginator.querySelectorAll("button:not(.chip)"));
    for (const btn of candidateButtons) {
      const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
      const title = (btn.getAttribute("title") || "").toLowerCase();
      const text = (btn.textContent || "").trim().toLowerCase();

      if (
        aria.includes("next") ||
        title.includes("next") ||
        text.includes("next") ||
        text === ">" ||
        text === "»" ||
        text === "›"
      ) {
        return btn;
      }

      // Check descendant icons (Angular Material <mat-icon>, FontAwesome <i>, etc.)
      const icon = btn.querySelector("mat-icon, i, span, svg");
      if (icon) {
        const iconText = (icon.textContent || "").trim().toLowerCase();
        const iconName = (icon.getAttribute("data-icon") || "").toLowerCase();
        if (
          iconText.includes("chevron_right") ||
          iconText.includes("navigate_next") ||
          iconText.includes("arrow_forward") ||
          iconText.includes("keyboard_arrow_right") ||
          iconName.includes("right") ||
          iconName.includes("next")
        ) {
          return btn;
        }
      }
    }

    // 3. Positional fallback: last .arrow-btn in paginator
    const arrowButtons = Array.from(paginator.querySelectorAll("button.arrow-btn"));
    if (arrowButtons.length >= 2) {
      return arrowButtons[arrowButtons.length - 1];
    } else if (arrowButtons.length === 1) {
      const chips = this.getQuestionChips();
      if (chips.length > 0) {
        const lastChip = chips[chips.length - 1];
        if (typeof arrowButtons[0].compareDocumentPosition === "function") {
          const pos = arrowButtons[0].compareDocumentPosition(lastChip);
          if (pos & 2 /* Node.DOCUMENT_POSITION_PRECEDING */) {
            return arrowButtons[0];
          }
        } else {
          return arrowButtons[0];
        }
      }
    }

    return null;
  }

  /**
   * Discovers the "Previous Page / Window" button in the assessment paginator.
   * Uses standard CSS selectors, descendant icon/text inspection, and DOM positioning.
   * Never relies on non-standard pseudo-selectors like :contains().
   * @returns {HTMLButtonElement|null}
   */
  getPrevWindowButton() {
    const paginator = this.getPaginator();

    // 1. Direct standard class/attribute match inside paginator or document
    const root = paginator || this.doc;
    const directMatch = $(IITM_SELECTORS.navigation.prevWindow, root);
    if (directMatch) return directMatch;

    if (!paginator) return null;

    // 2. Query non-chip buttons in the paginator and inspect attributes/descendants in JavaScript
    const candidateButtons = Array.from(paginator.querySelectorAll("button:not(.chip)"));
    for (const btn of candidateButtons) {
      const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
      const title = (btn.getAttribute("title") || "").toLowerCase();
      const text = (btn.textContent || "").trim().toLowerCase();

      if (
        aria.includes("prev") ||
        title.includes("prev") ||
        text.includes("prev") ||
        text === "<" ||
        text === "«" ||
        text === "‹"
      ) {
        return btn;
      }

      // Check descendant icons
      const icon = btn.querySelector("mat-icon, i, span, svg");
      if (icon) {
        const iconText = (icon.textContent || "").trim().toLowerCase();
        const iconName = (icon.getAttribute("data-icon") || "").toLowerCase();
        if (
          iconText.includes("chevron_left") ||
          iconText.includes("navigate_before") ||
          iconText.includes("arrow_back") ||
          iconText.includes("keyboard_arrow_left") ||
          iconName.includes("left") ||
          iconName.includes("prev")
        ) {
          return btn;
        }
      }
    }

    // 3. Positional fallback: first .arrow-btn in paginator
    const arrowButtons = Array.from(paginator.querySelectorAll("button.arrow-btn"));
    if (arrowButtons.length >= 2) {
      return arrowButtons[0];
    } else if (arrowButtons.length === 1) {
      const chips = this.getQuestionChips();
      if (chips.length > 0) {
        const firstChip = chips[0];
        if (typeof arrowButtons[0].compareDocumentPosition === "function") {
          const pos = arrowButtons[0].compareDocumentPosition(firstChip);
          if (pos & 4 /* Node.DOCUMENT_POSITION_FOLLOWING */) {
            return arrowButtons[0];
          }
        } else {
          return arrowButtons[0];
        }
      }
    }

    return null;
  }

  /**
   * Checks whether the paginator has an active next-window control.
   * @returns {boolean}
   */
  canAdvanceWindow() {
    const btn = this.getNextWindowButton();
    return this.isButtonEnabled(btn);
  }

  /**
   * Triggers click on the next-window button.
   * @returns {boolean} True if click was dispatched
   */
  advanceWindow() {
    if (!this.canAdvanceWindow()) return false;
    const btn = this.getNextWindowButton();
    btn?.click();
    return true;
  }

  /**
   * Checks whether the paginator has an active previous-window control.
   * @returns {boolean}
   */
  canRewindWindow() {
    const btn = this.getPrevWindowButton();
    return this.isButtonEnabled(btn);
  }

  /**
   * Triggers click on the previous-window button.
   * @returns {boolean} True if click was dispatched
   */
  rewindWindow() {
    if (!this.canRewindWindow()) return false;
    const btn = this.getPrevWindowButton();
    btn?.click();
    return true;
  }

  isReviewMode() {
    const hasEvaluated = Boolean($(IITM_SELECTORS.assessment.evaluatedAnswer, this.doc));
    const view = this.getAssessmentView();
    const hasReviewText = Boolean(
      view && IITM_SELECTORS.metadata.reviewDetectRegex.test(view.textContent || "")
    );
    return hasEvaluated || hasReviewText;
  }

  getSubmissionTimerText() {
    const timerEl = $(IITM_SELECTORS.metadata.timer, this.doc);
    return (timerEl?.textContent || "").replace(/\s+/g, " ").trim();
  }

  getReviewPanel() {
    const q = this.getCurrentQuestionElement();
    return q?.closest(IITM_SELECTORS.assessment.evaluatedRightPanel) || null;
  }

  /**
   * Verifies that the current question container is structurally present and populated.
   * @returns {boolean}
   */
  isQuestionStructurallyReady() {
    const q = this.getCurrentQuestionElement();
    if (!q) return false;
    // Check that question element is in DOM and has children or meaningful content
    return q.children.length > 0 || (q.textContent || "").trim().length > 0;
  }

  /**
   * Generates a fast text signature of the current question for settling/readiness.
   */
  getQuestionTextSignature() {
    const q = this.getCurrentQuestionElement();
    return (q?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
  }

  /**
   * Discovers the assessment title from page headers or breadcrumbs, excluding question stem headings.
   * @returns {string}
   */
  getAssessmentTitle() {
    const candidates = $$(
      IITM_SELECTORS.metadata.assessmentTitle || ".assignment-title, .assessment-title, h1.title, .breadcrumb, h1, h2",
      this.doc
    );
    const titleEl = candidates.find(
      (el) => !el.closest?.(".question-body, .backend-html, app-assessment-question")
    ) || candidates[0];
    return (titleEl?.textContent || "").replace(/\s+/g, " ").trim() || "Assignment";
  }

  /**
   * Discovers the course name from the portal sidebar or course header (e.g. ".side-nav-title"),
   * stripping any leading term prefix like "Sep 2026 - ".
   * @returns {string}
   */
  getCourseName() {
    const el = $(IITM_SELECTORS.metadata.courseTitle || ".side-nav-title, .course-title, .header-course-title", this.doc);
    const raw = (el?.textContent || "").replace(/\s+/g, " ").trim();
    if (!raw) return "";
    return raw
      .replace(
        /^\s*(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}\s*[-–—:]\s*/i,
        ""
      )
      .trim();
  }

  /**
   * Discovers the assessment week string following the fallback order:
   * 1. Header subtitle (e.g. "Week 1" in .course-content .subtitle) [PROVISIONAL: pending real course-content-graded.html fixture]
   * 2. Assessment title (e.g. "Week 1 Graded Assignment - 1")
   * 3. Sidebar's active .unit-header (or expanded unit-container's .unit-header) [PROVISIONAL: pending real sidebar-week1.html fixture]
   *
   * Note: Selectors for subtitle and sidebar unit-headers are provisional guesses
   * and must be verified against real portal DOM captures once fixtures are provided.
   * @returns {string}
   */
  getAssessmentWeek() {
    const weekRe = /\bweek[\s\-_:]*(\d{1,2})\b/i;

    // 1. Header subtitle
    const subtitleCandidates = $$(
      IITM_SELECTORS.metadata.assessmentSubtitle ||
        ".course-content .subtitle, .subtitle, .unit-subtitle, .header-subtitle, .assignment-subtitle",
      this.doc
    );
    for (const el of subtitleCandidates) {
      if (el.closest?.(".question-body, .backend-html, app-assessment-question")) continue;
      const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
      const m = txt.match(weekRe);
      if (m) return `Week ${m[1]}`;
    }

    // 2. Assessment title
    const titleTxt = this.getAssessmentTitle();
    const titleMatch = titleTxt.match(weekRe);
    if (titleMatch) {
      return `Week ${titleMatch[1]}`;
    }

    // 3. Sidebar's active .unit-header
    const unitContainers = $$(".unit-container", this.doc);
    for (const container of unitContainers) {
      const hasActiveChild =
        container.classList?.contains("active") ||
        Boolean(
          $(
            ".child-row.active, .child-row.selected, .child-row[aria-current='true'], .unit-header.active, .unit-header[aria-expanded='true'], .child-container",
            container
          )
        );
      if (hasActiveChild) {
        const header = $(".unit-header", container);
        const txt = (header?.textContent || "").replace(/\s+/g, " ").trim();
        const m = txt.match(weekRe);
        if (m) return `Week ${m[1]}`;
      }
    }

    const activeHeaders = $$(".unit-header.active, .unit-header[aria-expanded='true']", this.doc);
    for (const header of activeHeaders) {
      const txt = (header.textContent || "").replace(/\s+/g, " ").trim();
      const m = txt.match(weekRe);
      if (m) return `Week ${m[1]}`;
    }

    return "";
  }
}

export const portalAdapter = new IitmPortalAdapter();
