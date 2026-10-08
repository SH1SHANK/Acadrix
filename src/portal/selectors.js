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
  // Programming assignment boundaries, editors, tabs, and controls
  programming: {
    view: "app-programming-assignment-view, .programming-assignment-view",
    questionRoot: "app-pa-question, .pa-question",
    problemContent: "app-pa-question .backend-html, .pa-question .backend-html, .pa-question",
    tabList: "app-tab-bar [role=tablist], .tab-bar-wrapper [role=tablist], [role=tablist]",
    tabItem: "button[role=tab], .tab-item",
    tabActive: "button[role=tab][aria-selected='true'], button.tab-item.active, button.tab-item[aria-selected='true']",
    tabLabel: ".tab-label, .label",
    tabsContent: ".tabs-content",
    testCasesRoot: "app-pa-testcases, app-pa-test-cases, .pa-testcases, .pa-test-cases, .test-cases, app-test-cases, .test-case-container, .accordion-container",
    testCaseSlider: ".test-case-slider",
    testCasePill: ".test-case-pill, button.test-case-pill",
    testCaseCard: ".test-case-card",
    testCaseDetails: ".test-case-details",
    testCaseBlock: ".test-case-block",
    testCaseBlockTitle: ".title, .wrapper .title",
    testCaseBlockContent: ".content",
    testCaseItem: ".test-case-details, .test-case-block, .test-case, .test-case-item, .test-case-card, .testcase-item",
    testCaseInput: ".test-case-input, .input-content, .test-input, pre.input, .input",
    testCaseOutput: ".test-case-output, .output-content, .test-output, pre.output, .expected-output, .output",
    testCaseDescription: ".test-case-description, .description, .test-description, .title, .header-title",
    accordionHeader: ".accordion-header, button.accordion-header",
    accordionContent: ".accordion-content, .accordion-panel .accordion-content",
    returnInstructions: ".return-instructions, .submission-instructions, [data-section='return-instructions']",
    editorRoot: "app-pa-code-editor, app-code-editor, .pa-code-editor, .code-editor",
    languageValue: ".language-input .current-value, .language-selection .current-value, .current-value",
    aceContainer: ".ace-container, .ace_editor",
    aceTextInput: ".ace_text-input",
    runCodeButton: "button[aria-label='Run Code'], button.btn-ghost:has(.icon-svg), .submission-actions button:first-child",
    submitButton: "button[aria-label='Submit'], button.btn-gradient, .submission-actions button:last-child",
    headerTitle: "app-title-bar h1.title, app-title-bar .title, .mobile-header .title, h1.title, h1",
    breadcrumb: "nav.breadcrumb .breadcrumb-item.current, .mobile-header .parent-title, nav.breadcrumb .breadcrumb-item, .breadcrumb span",
    timer: "app-submission-timer .due-label, app-submission-timer, .submission-timer",
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
    decorHost: "acx-portal-decor",
    decorAttr: "data-acx-decor",
    decorCleanTargets: "[data-acx-graded], [data-acx-mode]",
    decorAllElements: "acx-portal-decor, [data-acx-decor]",
  },/* @extension-only-end */
});
