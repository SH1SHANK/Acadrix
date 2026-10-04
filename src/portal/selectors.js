/**
 * Centralized IITM Portal Selectors.
 * Categorized strictly by architectural domain.
 * Derived from observed IITM portal DOM structures.
 */

export const IITM_SELECTORS = Object.freeze({
  // Assessment boundaries & root containers
  assessment: {
    view: "app-assessment-question-view",
    root: "app-assessment-question",
    evaluatedAnswer: ".evaluated-answer",
    evaluatedRightPanel: ".evaluated-answer, .panel.right-panel, .cell",
  },

  // Paginator & navigation controls
  navigation: {
    paginator: "div.chips, .app-assessment-paginator, .assessment-paginator",
    chip: "div.chips button.chip, .chips button.chip, button.chip",
    activeChip: "div.chips button.chip.active, button.chip.active, button.chip.current, button.chip[aria-current='true'], button.chip[aria-selected='true']",
    nextWindow: "button.paginator-next, button.next-page, button[aria-label*='Next' i], button[aria-label*='next' i], .chips-nav-next, .paginator-next, button.next",
    prevWindow: "button.paginator-prev, button.prev-page, button[aria-label*='Prev' i], button[aria-label*='prev' i], .chips-nav-prev, .paginator-prev, button.prev",
  },

  // Question metadata & timers
  metadata: {
    timer: "app-submission-timer",
    saveStatus: "app-save-status",
    questionHeader: ".question-header, .question-label, .header .question-header",
    assessmentTitle: ".assignment-title, .assessment-title, h1.title, .breadcrumb, h1, h2",
    assessmentSubtitle: ".course-content .subtitle, .subtitle, .unit-subtitle, .header-subtitle, .assignment-subtitle",
    breadcrumbCurrent: "nav.breadcrumb .breadcrumb-item.current",
    selectedChildRow: ".child-row.selected",
    unitContainer: ".unit-container",
    unitTitle: ".unit-title",
    activeUnitHeader: ".unit-header.active, .unit-header[aria-expanded='true'], .unit-container.active .unit-header, .unit-container:has(.child-row.active) .unit-header, .unit-header",
    courseTitle: ".side-nav-title, .course-title, .header-course-title",
    totalCountRegex: /Question\s+\d+\s*\/\s*(\d+)/i,
    currentNumberRegex: /Question\s+(\d+)/i,
    reviewDetectRegex: /Answer is (Correct|Incorrect)|Score\s*:\s*\d/,
  },

  // Question content & prompt areas
  content: {
    backendHtml: ".backend-html",
    legend: "legend, .choices-legend",
    feedback: ".feedback",
    feedbackTitle: ".title",
  },

  // Answer controls (for read-only inspection)
  controls: {
    optionRole: "[role=radio], [role=checkbox]",
    textInput: "textarea, input[type=text], input[type=number]",
  },

  // Choice & Option controls (real observed IITM structures)
  choices: {
    container: ".choices, [role=radiogroup]",
    choice: "button.choice[role=radio], button.choice[role=checkbox], .choices [role=radio], .choices [role=checkbox], [role=radio], [role=checkbox], button.choice, label.choice, .choice",
    choiceLetter: ".choice-letter, .letter",
    choiceText: ".choice-text.backend-html, .choice-text, .backend-html, .text",
    auxiliaryIgnore: ".clear-selection, button.clear-selection, .choice-clear, .choice-indicator, .indicator, .mat-radio-container, .mat-checkbox-inner-container",
  },

  // Declutter layout elements
  declutter: {
    breadcrumb: ".breadcrumb",
    infoBanner: ".info-banner",
    sidebar: "nav.app-bar, .side-nav, #side-nav-content",
    main: "main.app-main",
  },
});
