#!/usr/bin/env node
/**
 * Test Suite: Interactive AI Answer Review UI, State Model & Portal Applicator.
 */

import { strict as assert } from "node:assert";
import { QuestionType, ContentType } from "../src/model/types.js";
import { AssignmentDocument, QuestionNode, OptionNode, ContentNode } from "../src/model/document.js";
import { assignmentFingerprint } from "../src/bridge/protocol.js";
import {
  AnswerState,
  STATUS_CONFIG,
  computeAnswerState,
  isValidNumerical,
  normalizeSelection,
} from "../src/bridge/answer-state.js";
import {
  summarizeReviewState,
  applyAnswersToPortal,
} from "../src/bridge/applicator.js";

let passed = 0;
let failed = 0;

function test(desc, fn) {
  try {
    fn();
    console.log(`✓ ${desc}`);
    passed++;
  } catch (err) {
    console.error(`❌ ${desc}:`, err);
    failed++;
  }
}

async function testAsync(desc, fn) {
  try {
    await fn();
    console.log(`✓ ${desc}`);
    passed++;
  } catch (err) {
    console.error(`❌ ${desc}:`, err);
    failed++;
  }
}

console.log("\nStarting Interactive Answer Review & Applicator Verification Suite...\n");

// ── 1. Numerical & Type Validation ──────────────────────────────────────────
test("Numerical input validates integer, decimal, negative, and scientific notation", () => {
  assert.equal(isValidNumerical("42"), true);
  assert.equal(isValidNumerical("42.5"), true);
  assert.equal(isValidNumerical("-12.34"), true);
  assert.equal(isValidNumerical("1.5e-4"), true);
  assert.equal(isValidNumerical("-2.5E+3"), true);
  assert.equal(isValidNumerical("0"), true);
  assert.equal(isValidNumerical("0.0"), true);

  // Invalid formats
  assert.equal(isValidNumerical(""), false);
  assert.equal(isValidNumerical("   "), false);
  assert.equal(isValidNumerical("abc"), false);
  assert.equal(isValidNumerical("12.34.56"), false);
  assert.equal(isValidNumerical("12a"), false);
  assert.equal(isValidNumerical("1e4e5"), false);
});

// ── 2. Answer State Deterministic Classification ────────────────────────────
test("Answer state classifies UNANSWERED, AI_SUGGESTED, AI_MATCHED, USER_SELECTED, USER_OVERRIDDEN, INVALID", () => {
  // MCQ
  assert.equal(
    computeAnswerState({ type: "MCQ", aiEntry: null, userSelection: null }),
    AnswerState.UNANSWERED
  );
  assert.equal(
    computeAnswerState({ type: "MCQ", aiEntry: { status: "answered", answer: "D" }, userSelection: null }),
    AnswerState.AI_SUGGESTED
  );
  assert.equal(
    computeAnswerState({ type: "MCQ", aiEntry: { status: "answered", answer: "D" }, userSelection: "D" }),
    AnswerState.AI_MATCHED
  );
  assert.equal(
    computeAnswerState({ type: "MCQ", aiEntry: { status: "answered", answer: "D" }, userSelection: "B" }),
    AnswerState.USER_OVERRIDDEN
  );
  assert.equal(
    computeAnswerState({ type: "MCQ", aiEntry: null, userSelection: "B" }),
    AnswerState.USER_SELECTED
  );
  assert.equal(
    computeAnswerState({ type: "MCQ", aiEntry: { status: "invalid", reason: "bad" }, userSelection: "B" }),
    AnswerState.INVALID
  );

  // MSQ
  assert.equal(
    computeAnswerState({ type: "MSQ", aiEntry: { status: "answered", answer: ["B", "C"] }, userSelection: ["C", "B"] }),
    AnswerState.AI_MATCHED
  );
  assert.equal(
    computeAnswerState({ type: "MSQ", aiEntry: { status: "answered", answer: ["B", "C"] }, userSelection: ["A", "C"] }),
    AnswerState.USER_OVERRIDDEN
  );
  assert.equal(
    computeAnswerState({ type: "MSQ", aiEntry: { status: "answered", answer: ["B", "C"] }, userSelection: [] }),
    AnswerState.AI_SUGGESTED
  );
  assert.equal(
    computeAnswerState({ type: "MSQ", aiEntry: null, userSelection: ["A", "D"] }),
    AnswerState.USER_SELECTED
  );

  // Numerical
  assert.equal(
    computeAnswerState({ type: "NUMERICAL", aiEntry: { status: "answered", answer: "42.5" }, userSelection: "42.5" }),
    AnswerState.AI_MATCHED
  );
  assert.equal(
    computeAnswerState({ type: "NUMERICAL", aiEntry: { status: "answered", answer: "42.5" }, userSelection: "42.50" }),
    AnswerState.AI_MATCHED
  );
  assert.equal(
    computeAnswerState({ type: "NUMERICAL", aiEntry: { status: "answered", answer: "42.5" }, userSelection: "10" }),
    AnswerState.USER_OVERRIDDEN
  );
  assert.equal(
    computeAnswerState({ type: "NUMERICAL", aiEntry: { status: "answered", answer: "42.5" }, userSelection: "invalid_num" }),
    AnswerState.INVALID
  );
  assert.equal(
    computeAnswerState({ type: "NUMERICAL", aiEntry: { status: "answered", answer: "42.5" }, userSelection: "" }),
    AnswerState.AI_SUGGESTED
  );
});

// ── 3. Review State Summarizer ──────────────────────────────────────────────
test("Summarize review state computes correct counts and ready totals", () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Test Quiz", totalQuestions: 4 },
    questions: [
      new QuestionNode({ number: 1, type: QuestionType.MCQ }),
      new QuestionNode({ number: 2, type: QuestionType.MSQ }),
      new QuestionNode({ number: 3, type: QuestionType.NUMERICAL }),
      new QuestionNode({ number: 4, type: QuestionType.TEXT }),
    ],
  });

  const selectionsMap = new Map([
    [1, "D"],       // AI Match
    [2, ["A", "C"]],// User Override (AI is ["B", "C"])
    [3, ""],        // AI Suggested (no selection)
    [4, "User Ans"],// User Selected (no AI answer)
  ]);

  const aiMap = new Map([
    [1, { status: "answered", answer: "D" }],
    [2, { status: "answered", answer: ["B", "C"] }],
    [3, { status: "answered", answer: "42.5" }],
  ]);

  const summary = summarizeReviewState(doc, selectionsMap, aiMap);
  assert.equal(summary.total, 4);
  assert.equal(summary.ready, 3); // Q1, Q2, Q4
  assert.equal(summary.aiMatched, 1); // Q1
  assert.equal(summary.userOverridden, 1); // Q2
  assert.equal(summary.userSelected, 1); // Q4
  assert.equal(summary.aiSuggested, 1); // Q3
  assert.equal(summary.unanswered, 0);
  assert.equal(summary.invalid, 0);
});

// ── 4. Portal Applicator Execution ──────────────────────────────────────────
await testAsync("Portal applicator navigates questions and sets portal controls without auto-submitting", async () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Portal Integration", totalQuestions: 3 },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        options: [new OptionNode({ letter: "A" }), new OptionNode({ letter: "B" })],
      }),
      new QuestionNode({
        number: 2,
        type: QuestionType.MSQ,
        options: [new OptionNode({ letter: "A" }), new OptionNode({ letter: "B" }), new OptionNode({ letter: "C" })],
      }),
      new QuestionNode({
        number: 3,
        type: QuestionType.NUMERICAL,
      }),
    ],
  });

  // Mock Portal DOM
  let activeQuestionNum = 1;
  function makeMockChoice(letter) {
    const classes = new Set();
    return {
      textContent: `${letter}. Option ${letter}`,
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        toggle: (c) => (classes.has(c) ? classes.delete(c) : classes.add(c)),
        contains: (c) => classes.has(c),
        has: (c) => classes.has(c),
      },
      getAttribute: (attr) => (attr === "aria-checked" ? (classes.has("selected") ? "true" : "false") : null),
      querySelector: () => null,
      click() {
        if (this.classList.contains("selected")) {
          this.classList.remove("selected");
        } else {
          this.classList.add("selected");
        }
      },
    };
  }

  const mcqChoices = [makeMockChoice("A"), makeMockChoice("B")];
  const msqChoices = [makeMockChoice("A"), makeMockChoice("B"), makeMockChoice("C")];
  const numInput = { value: "", dispatchEvent(e) {} };

  const mockQRoot = {
    querySelectorAll(selector) {
      if (activeQuestionNum === 1) return mcqChoices;
      if (activeQuestionNum === 2) return msqChoices;
      return [];
    },
    querySelector(selector) {
      if (activeQuestionNum === 3) return numInput;
      return null;
    },
  };

  const mockPortal = {
    detectAssessment: () => true,
    getActiveLogicalNumber: () => activeQuestionNum,
    getCurrentQuestionElement: () => mockQRoot,
    getQuestionChips: () => [
      { textContent: "1" },
      { textContent: "2" },
      { textContent: "3" },
    ],
    getChipLogicalNumber: (chip) => parseInt(chip.textContent, 10),
    canAdvanceWindow: () => false,
    canRewindWindow: () => false,
  };

  const mockTraverser = {
    async navigateToQuestion(chip, logicalNum) {
      activeQuestionNum = logicalNum;
    },
    async restoreLocation(targetNum) {
      activeQuestionNum = targetNum;
    },
  };

  const selectionsMap = new Map([
    [1, "B"],
    [2, ["A", "C"]],
    [3, "99.9"],
  ]);

  const progressEvents = [];
  const result = await applyAnswersToPortal({
    portal: mockPortal,
    traverser: mockTraverser,
    documentModel: doc,
    selectionsMap,
    onProgress: (p) => progressEvents.push(p),
  });

  assert.equal(result.ok, true);
  assert.equal(result.appliedCount, 3);
  assert.equal(progressEvents.length, 3);

  // Check MCQ B selected
  assert.equal(mcqChoices[1].classList.has("selected"), true);
  assert.equal(mcqChoices[0].classList.has("selected"), false);

  // Check MSQ A and C selected, B not selected
  assert.equal(msqChoices[0].classList.has("selected"), true);
  assert.equal(msqChoices[1].classList.has("selected"), false);
  assert.equal(msqChoices[2].classList.has("selected"), true);

  // Check Numerical input populated
  assert.equal(numInput.value, "99.9");

  // Check restored location
  assert.equal(activeQuestionNum, 1);
});

// ── 5. Real IITM Angular DOM Applicator Verification ────────────────────────
await testAsync("Portal applicator accurately targets real IITM Angular DOM choices and numerical textareas", async () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Angular DOM Assessment", totalQuestions: 3 },
    questions: [
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        options: [
          new OptionNode({ letter: "A" }),
          new OptionNode({ letter: "B" }),
          new OptionNode({ letter: "C" }),
          new OptionNode({ letter: "D" }),
        ],
      }),
      new QuestionNode({
        number: 2,
        type: QuestionType.MSQ,
        options: [
          new OptionNode({ letter: "A" }),
          new OptionNode({ letter: "B" }),
        ],
      }),
      new QuestionNode({
        number: 3,
        type: QuestionType.NUMERICAL,
      }),
    ],
  });

  function makeAngularChoice(letter, role, checked = false) {
    let ariaChecked = checked ? "true" : "false";
    const letterSpan = { textContent: `${letter}.` };
    const textSpan = { textContent: `Option content for ${letter}` };
    return {
      tagName: "BUTTON",
      role,
      getAttribute(attr) {
        if (attr === "aria-checked") return ariaChecked;
        if (attr === "role") return role;
        return null;
      },
      hasAttribute(attr) {
        return attr === "aria-checked" || attr === "role";
      },
      querySelector(sel) {
        if (sel.includes("choice-letter") || sel.includes(".letter")) return letterSpan;
        if (sel.includes("choice-text") || sel.includes(".text")) return textSpan;
        return null;
      },
      click() {
        ariaChecked = ariaChecked === "true" ? "false" : "true";
      },
      get currentAriaChecked() {
        return ariaChecked;
      },
    };
  }

  const mcqButtons = [
    makeAngularChoice("A", "radio", false),
    makeAngularChoice("B", "radio", false),
    makeAngularChoice("C", "radio", false),
    makeAngularChoice("D", "radio", false),
  ];

  const msqButtons = [
    makeAngularChoice("A", "checkbox", false),
    makeAngularChoice("B", "checkbox", false),
  ];

  let textareaVal = "";
  let dispatchedEvents = [];
  const numericalTextarea = {
    tagName: "TEXTAREA",
    className: "textarea-field",
    id: "app-textarea-0",
    inputmode: "decimal",
    getAttribute(attr) {
      if (attr === "inputmode") return "decimal";
      if (attr === "class") return "textarea-field";
      if (attr === "id") return "app-textarea-0";
      return null;
    },
    hasAttribute(attr) {
      return attr === "inputmode" || attr === "class" || attr === "id";
    },
    get value() {
      return textareaVal;
    },
    set value(v) {
      textareaVal = v;
    },
    dispatchEvent(e) {
      dispatchedEvents.push(e.type);
    },
  };

  let activeLogical = 1;
  const mockQRoot = {
    querySelectorAll(sel) {
      if (activeLogical === 1) return mcqButtons;
      if (activeLogical === 2) return msqButtons;
      return [];
    },
    querySelector(sel) {
      if (activeLogical === 3 && (sel.includes("textarea") || sel.includes("input"))) {
        return numericalTextarea;
      }
      return null;
    },
  };

  const mockPortal = {
    detectAssessment: () => true,
    getActiveLogicalNumber: () => activeLogical,
    getCurrentQuestionElement: () => mockQRoot,
    getQuestionChips: () => [
      { textContent: "1" },
      { textContent: "2" },
      { textContent: "3" },
    ],
    getChipLogicalNumber: (chip) => parseInt(chip.textContent, 10),
    canAdvanceWindow: () => false,
    canRewindWindow: () => false,
  };

  const mockTraverser = {
    async navigateToQuestion(chip, num) {
      activeLogical = num;
    },
    async restoreLocation(target) {
      activeLogical = target;
    },
  };

  const selectionsMap = new Map([
    [1, "C"],          // MCQ select C
    [2, ["B"]],        // MSQ select B
    [3, "3.14159"],    // Numerical decimal
  ]);

  const result = await applyAnswersToPortal({
    portal: mockPortal,
    traverser: mockTraverser,
    documentModel: doc,
    selectionsMap,
  });

  assert.equal(result.ok, true);
  assert.equal(result.appliedCount, 3);

  // Assert MCQ C was clicked and now aria-checked="true"
  assert.equal(mcqButtons[0].currentAriaChecked, "false");
  assert.equal(mcqButtons[1].currentAriaChecked, "false");
  assert.equal(mcqButtons[2].currentAriaChecked, "true");
  assert.equal(mcqButtons[3].currentAriaChecked, "false");

  // Assert MSQ B was clicked and now aria-checked="true", A is "false"
  assert.equal(msqButtons[0].currentAriaChecked, "false");
  assert.equal(msqButtons[1].currentAriaChecked, "true");

  // Assert Numerical textarea was populated and dispatched input + change events
  assert.equal(numericalTextarea.value, "3.14159");
  assert.deepEqual(dispatchedEvents, ["input", "change"]);

  // Assert restored to Q1
  assert.equal(activeLogical, 1);
});

// ── 6. Normalization and Edge Case Matching ─────────────────────────────────
test("Normalizes option letters with periods, parentheses, and mixed case", () => {
  assert.equal(normalizeSelection("MCQ", "A."), "A");
  assert.equal(normalizeSelection("MCQ", "(B)"), "B");
  assert.equal(normalizeSelection("MCQ", "c"), "C");
  assert.deepEqual(normalizeSelection("MSQ", ["A.", "(B)", "c"]), ["A", "B", "C"]);

  assert.equal(
    computeAnswerState({
      type: "MCQ",
      aiEntry: { status: "answered", answer: "A." },
      userSelection: "A",
    }),
    AnswerState.AI_MATCHED
  );

  assert.equal(
    computeAnswerState({
      type: "unknown",
      aiEntry: null,
      userSelection: "B",
    }),
    AnswerState.USER_SELECTED
  );
});

console.log(`\n==================================================`);
console.log(`✓ All Interactive Answer Review Tests Passed Successfully! (${passed} passed, ${failed} failed)`);
console.log(`==================================================\n`);

if (failed > 0) process.exit(1);
