/**
 * IITM Portal Adapter.
 * Encapsulates all direct DOM inspection and queries on IITM assessment pages.
 * No UI or traversal logic should query IITM selectors directly.
 */

import { $, $$ } from "../utils/dom.js";
import { IITM_SELECTORS } from "./selectors.js";

/**
 * Normalized Portal Page Types.
 */
export const PortalPageType = Object.freeze({
  ASSESSMENT: "ASSESSMENT",
  PROGRAMMING_ASSIGNMENT_INFO: "PROGRAMMING_ASSIGNMENT_INFO",
  PROGRAMMING_ASSIGNMENT: "PROGRAMMING_ASSIGNMENT",
  COURSE_CONTENT: "COURSE_CONTENT",
  GRADES: "GRADES",
  UNKNOWN: "UNKNOWN",
});

/**
 * Determines whether the FAB (and shortcut) should be enabled for a given page type.
 * @param {string} pageType
 * @returns {boolean}
 */
export function isFabEligible(pageType) {
  return (
    pageType === PortalPageType.ASSESSMENT ||
    pageType === PortalPageType.PROGRAMMING_ASSIGNMENT
  );
}

export class IitmPortalAdapter {
  constructor(doc = typeof document !== "undefined" ? document : null) {
    this.doc = doc;
  }

  /**
   * Identifies the current portal page type from the DOM.
   * First-class support for Standard Assessments and Programming Assignments.
   * @param {Document|Element} [root]
   * @returns {string} One of PortalPageType values
   */
  detectPageType(root = this.doc) {
    if (!root || typeof root.querySelector !== "function") return PortalPageType.UNKNOWN;

    // The assignment overview and the active coding route can share metadata and
    // sometimes the outer PA wrapper. Require a coding surface inside that wrapper;
    // a title, deadline, resume CTA, or wrapper alone is not editor evidence.
    const paView = $(IITM_SELECTORS.programming?.view || "app-programming-assignment-view, .programming-assignment-view", root);
    const hasPaView = Boolean(paView);
    const hasPaOverview = Boolean(
      $("app-pa-start-page, .pa-start-page, app-pa-instructions, .pa-instructions", root)
    );
    const paRoot = paView || root;
    const hasPaQuestion = Boolean(
      $(IITM_SELECTORS.programming?.questionRoot || "app-pa-question, .pa-question", paRoot)
    );
    const paEditor = $(IITM_SELECTORS.programming?.editorRoot || "app-pa-code-editor, app-code-editor, .pa-code-editor", paRoot);
    const hasPaEditor = Boolean(paEditor);
    const hasAce = Boolean(
      $(IITM_SELECTORS.programming?.aceContainer || ".ace-container, .ace_editor", paEditor || paRoot)
    );
    const hasRunBtn = Boolean(
      $(IITM_SELECTORS.programming?.runCodeButton || "button[aria-label='Run Code']", paRoot)
    );
    const hasPaTabs = $$(IITM_SELECTORS.programming?.tabItem || "button[role=tab], .tab-item", paRoot).some(
      (b) => /test\s*cases|question/i.test(b.textContent || "")
    );
    const hasCodingSurface = Boolean(
      hasPaEditor ||
      (hasPaQuestion && hasAce) ||
      (hasAce && (hasRunBtn || hasPaTabs))
    );
    const hasResumeAction = $$("button, a, [role='button']", root).some((el) => {
      const label = el.getAttribute?.("aria-label") || "";
      return /^resume assignment$/i.test((el.textContent || label).trim());
    });

    if ((hasPaOverview || hasResumeAction) && !hasCodingSurface) {
      return PortalPageType.PROGRAMMING_ASSIGNMENT_INFO;
    }
    if (hasPaView && hasCodingSurface) {
      return PortalPageType.PROGRAMMING_ASSIGNMENT;
    }

    // 2. Standard Assessment check
    const hasAssessmentView = Boolean($(IITM_SELECTORS.assessment.view, root));
    const hasAssessmentRoot = Boolean($(IITM_SELECTORS.assessment.root, root));
    const hasPaginator = Boolean($(IITM_SELECTORS.navigation.paginator, root));

    if (hasAssessmentView || (hasPaginator && hasAssessmentRoot) || hasAssessmentRoot) {
      return PortalPageType.ASSESSMENT;
    }

    // 3. Grades / Scores view
    if ($("app-grades, .grades-view, app-score-card, .score-card-container", root)) {
      return PortalPageType.GRADES;
    }

    // 4. Course Content / Videos / Syllabus
    if ($("app-course-content, .course-content, app-unit-view, .unit-content, app-video-player", root)) {
      return PortalPageType.COURSE_CONTENT;
    }

    return PortalPageType.UNKNOWN;
  }

  /**
   * Returns true if an IITM assessment view (Standard or Programming) is currently active in the DOM.
   */
  detectAssessment() {
    return isFabEligible(this.detectPageType());
  }

  isProgrammingAssignment() {
    return this.detectPageType() === PortalPageType.PROGRAMMING_ASSIGNMENT;
  }

  isStandardAssessment() {
    return this.detectPageType() === PortalPageType.ASSESSMENT;
  }

  getProgrammingView() {
    return $(IITM_SELECTORS.programming?.view || "app-programming-assignment-view, .programming-assignment-view", this.doc);
  }

  /**
   * Resolves canonical capabilities supported on the current page.
   * @returns {object}
   */
  getPageCapabilities() {
    const pageType = this.detectPageType();
    if (pageType === PortalPageType.PROGRAMMING_ASSIGNMENT) {
      return {
        canReadAssessment: true,
        canReadProgrammingAssignment: true,
        canCopyQuestion: true,
        canCopyStarterCode: true,
        canCopyTestCases: true,
        canCopyCurrentCode: true,
        canEditProgrammingCode: true,
        canApplyAnswers: false,
      };
    }
    if (pageType === PortalPageType.ASSESSMENT) {
      return {
        canReadAssessment: true,
        canReadProgrammingAssignment: false,
        canCopyQuestion: true,
        canCopyStarterCode: false,
        canCopyTestCases: false,
        canCopyCurrentCode: false,
        canEditProgrammingCode: false,
        canApplyAnswers: true,
      };
    }
    return {
      canReadAssessment: false,
      canReadProgrammingAssignment: false,
      canCopyQuestion: false,
      canCopyStarterCode: false,
      canCopyTestCases: false,
      canCopyCurrentCode: false,
      canEditProgrammingCode: false,
      canApplyAnswers: false,
    };
  }

  getPaginator() {
    return $(IITM_SELECTORS.navigation.paginator, this.doc);
  }

  getAssessmentView() {
    return $(IITM_SELECTORS.assessment.view, this.doc);
  }

/* @extension-only-start */
  /**
   * Returns neighboring graded assignments in the current course outline.
   * The active selection must itself be marked as graded by the portal decorator.
   * @returns {{ current: { row: Element, title: string }, previous: { row: Element, title: string }|null, next: { row: Element, title: string }|null }|null}
   */
  getGradedAssignmentNavigation() {
    const sidebar = $(IITM_SELECTORS.decor?.sidebarContainer || "#side-nav-content", this.doc);
    if (!sidebar) return null;

    const gradedRows = $$(IITM_SELECTORS.decor?.gradedAssignmentRows || "button.child-row[data-acx-graded='true']", sidebar);
    const selectedRow = $(IITM_SELECTORS.metadata.selectedChildRow, sidebar);
    const currentIndex = gradedRows.findIndex((row) => row === selectedRow);
    if (currentIndex < 0) return null;

    const getAssignment = (row) => {
      if (!row) return null;
      const titleEl = $(IITM_SELECTORS.decor?.childTitle || ".child-title", row);
      const title = (titleEl?.textContent || "").replace(/\s+/g, " ").trim();
      return title ? { row, title } : null;
    };

    const current = getAssignment(gradedRows[currentIndex]);
    if (!current) return null;
    return {
      current,
      previous: getAssignment(gradedRows[currentIndex - 1]),
      next: getAssignment(gradedRows[currentIndex + 1]),
    };
  }

  /** Returns the assignment view position and a portal-native secondary button prototype. */
  getAssignmentNavigationMount() {
    const pageType = this.detectPageType();
    const view = pageType === PortalPageType.PROGRAMMING_ASSIGNMENT
      ? this.getProgrammingView()
      : pageType === PortalPageType.ASSESSMENT
        ? this.getAssessmentView()
        : null;
    const parent = view?.parentElement || view?.parentNode || null;
    const portalButton = "button.btn.btn-secondary, button.btn-secondary";
    const buttonPrototype = view?.querySelector?.(portalButton)
      || $(portalButton, parent)
      || $(portalButton, this.doc);
    return parent && view && buttonPrototype
      ? { parent, before: view, buttonPrototype }
      : null;
  }

  /** Activates the requested adjacent assignment via its real portal sidebar button. */
  navigateGradedAssignment(direction) {
    if (direction !== "previous" && direction !== "next") return false;
    const assignment = this.getGradedAssignmentNavigation()?.[direction];
    if (!assignment?.row || assignment.row.disabled || typeof assignment.row.click !== "function") return false;
    assignment.row.click();
    return true;
  }
/* @extension-only-end */

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
    const view = this.getAssessmentView() || this.getProgrammingView();
    if (view) {
      const match = (view.textContent || "").match(IITM_SELECTORS.metadata.totalCountRegex);
      if (match) return parseInt(match[1], 10);
    }
    const chips = this.getQuestionChips();
    if (chips.length > 0) return chips.length;
    if (this.isProgrammingAssignment()) return 1;
    return null;
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
   * Discovers the assessment title from active side-nav items, page headers, or breadcrumbs,
   * excluding question stem headings and choices.
   * @returns {string}
   */
  getAssessmentTitle() {
    // 1. Selected or active child item in sidebar (most specific title)
    const selectedChild = $(
      "button.child-row.selected .child-title, .child-row.selected .child-title, button.child-row.active .child-title, .child-row.active .child-title",
      this.doc
    );
    const selectedText = (selectedChild?.textContent || "").replace(/\s+/g, " ").trim();
    if (selectedText && !/^(assignment|assessment|quiz)$/i.test(selectedText)) {
      return selectedText;
    }

    // 2. Unit view / start page title bar or mobile header
    const titleBarEl = $(
      "app-title-bar h1.title, app-title-bar .title, .title-bar-container .title, .mobile-header .title-group .title, .mobile-header .title, app-pa-start-page h1, app-programming-assignment-view h1, .assignment-title, .assessment-title",
      this.doc
    );
    const titleBarText = (titleBarEl?.textContent || "").replace(/\s+/g, " ").trim();
    if (titleBarText && !/^(assignment|assessment|quiz)$/i.test(titleBarText)) {
      return titleBarText;
    }

    // 3. General candidates, excluding question body, choices, backend HTML
    const candidates = $$(
      IITM_SELECTORS.metadata.assessmentTitle || ".assignment-title, .assessment-title, h1.title, .breadcrumb, h1, h2",
      this.doc
    );
    for (const el of candidates) {
      if (el.closest?.(".question-body, .backend-html, app-assessment-question, .choices, .feedback, .info-banner")) {
        continue;
      }
      const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (txt && txt !== "Assignment" && txt !== "IIT Madras" && !txt.startsWith("IITM Assessment")) {
        return txt;
      }
    }

    return selectedText || titleBarText || "Assignment";
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

  /** Discovers the assessment unit/week from the real portal's sidebar, breadcrumb, or title. */
  getAssessmentWeek() {
    const weekRe = /\bweek[\s\-_:]*(\d{1,2})\b/i;

    // 1. Unit container of the active/selected child row
    const selected = $(IITM_SELECTORS.metadata.selectedChildRow || "button.child-row.selected, .child-row.selected, .child-row.active", this.doc);
    const unit = selected?.closest?.(IITM_SELECTORS.metadata.unitContainer || ".unit-container");
    const unitText = unit ? ($(IITM_SELECTORS.metadata.unitTitle || ".unit-title", unit)?.textContent || "") : "";
    const unitMatch = unitText.replace(/\s+/g, " ").trim().match(weekRe);
    if (unitMatch) return `Week ${unitMatch[1]}`;

    // 2. Mobile header parent title
    const parentTitle = $(".mobile-header .parent-title, .parent-title", this.doc);
    const parentMatch = (parentTitle?.textContent || "").replace(/\s+/g, " ").trim().match(weekRe);
    if (parentMatch) return `Week ${parentMatch[1]}`;

    // 3. Breadcrumbs
    const breadcrumb = $(IITM_SELECTORS.metadata.breadcrumbCurrent || "nav.breadcrumb .breadcrumb-item.current", this.doc);
    const breadcrumbMatch = (breadcrumb?.textContent || "").replace(/\s+/g, " ").trim().match(weekRe);
    if (breadcrumbMatch) return `Week ${breadcrumbMatch[1]}`;

    const breadcrumbs = $$("nav.breadcrumb .breadcrumb-item, .breadcrumb span", this.doc);
    for (const b of breadcrumbs) {
      const bMatch = (b.textContent || "").replace(/\s+/g, " ").trim().match(weekRe);
      if (bMatch) return `Week ${bMatch[1]}`;
    }

    // 4. Active unit header
    const activeHeader = $(IITM_SELECTORS.metadata.activeUnitHeader, this.doc);
    const activeText = (activeHeader?.textContent || "").replace(/\s+/g, " ").trim();
    const activeMatch = activeText.match(weekRe);
    if (activeMatch) return `Week ${activeMatch[1]}`;

    // 5. Title match
    const titleMatch = this.getAssessmentTitle().match(weekRe);
    if (titleMatch) return `Week ${titleMatch[1]}`;
    return "";
  }
}

export const portalAdapter = new IitmPortalAdapter();
