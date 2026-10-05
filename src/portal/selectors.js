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
    assessmentTitle: "button.child-row.selected .child-title, button.child-row.active .child-title, app-title-bar h1.title, app-title-bar .title, .title-bar-container .title, .mobile-header .title-group .title, .mobile-header .title, app-pa-start-page h1, app-programming-assignment-view h1, .assignment-title, .assessment-title, h1.title, .breadcrumb, h1, h2",
    assessmentSubtitle: ".course-content .subtitle, .subtitle, .unit-subtitle, .header-subtitle, .assignment-subtitle",
    breadcrumbCurrent: "nav.breadcrumb .breadcrumb-item.current",
    selectedChildRow: "button.child-row.selected, .child-row.selected, button.child-row.active, .child-row.active",
    unitContainer: ".unit-container",
    unitTitle: ".unit-title",
    activeUnitHeader: ".unit-header.active, .unit-header[aria-expanded='true'], .unit-container.active .unit-header, .unit-container:has(.child-row.active) .unit-header, .unit-container:has(.child-row.selected) .unit-header, .unit-header",
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
  },/* @extension-only-start */

  // Portal decoration & deadline selectors (Extension only)
  decor: {
    courseKey: ".top-bar-title, .side-nav-title",
    topBarTitle: ".top-bar-title",
    sideNavTitle: ".side-nav-title",
    sidebarContainer: "#side-nav-content, app-course-outline-side-nav, .side-nav-content, .side-nav",
    unitContainer: ".unit-container",
    unitHeader: ".unit-header",
    unitTitle: ".unit-header .unit-title, .unit-title",
    childContainer: ".child-container",
    childRow: "button.child-row, .child-row",
    childType: ".child-type",
    childTitle: ".child-title",
    startPageRoot: "app-assessment-start-page, app-pa-start-page, app-programming-assignment-view, .pa-start-page",
    startPageTitle: "app-title-bar h1.title, app-title-bar .title, .title-bar-container .title, .mobile-header .title-group .title, .mobile-header .title, h1.title, .title.size-small, h1",
    startPageBreadcrumb: "nav.breadcrumb .breadcrumb-item.current, nav.breadcrumb .breadcrumb-item, .mobile-header .parent-title, .breadcrumb span",
    startPageCardRow: ".card-row, .card-rows .card-row, .pa-card-row, .info-row",
    startPageKey: ".key",
    startPageValue: ".value",
    startPageDeadline: "app-submission-timer .due-label, app-submission-timer, .due-label, .submission-timer",
    gradesRoot: "app-grades, .grades",
    gradesModule: ".module-container",
    gradesModuleTitle: ".module-title",
    gradesDesktopContainer: ".desktop-container",
    gradesDesktopItem: ".desktop-container .item:not(.column-header)",
    gradesItemTitleLink: ".item-title a",
    gradesItemSubtitle: ".item-subtitle",
    gradesPendingExclude: ".due-date-pending-or-evaluation-pending",
    gradesDesktopItemValue: ".item-value",
    gradesMobileContainer: ".mobile-container",
    gradesMobileItem: ".mobile-item-container",
    gradesMobileTitle: ".mobile-title",
    gradesMobileItemValue: ".mobile-item-value",
    decorHost: "acx-portal-decor",
    decorAttr: "data-acx-decor",
    decorCleanTargets: "[data-acx-graded], [data-acx-mode]",
    decorAllElements: "acx-portal-decor, [data-acx-decor]",
  },/* @extension-only-end */
});
