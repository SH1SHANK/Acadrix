/**
 * IITM Portal Answer Applicator.
 * Safely traverses the assessment paginator and applies validated user selections
 * directly to native IITM portal form controls (radios, checkboxes, numerical/text inputs).
 * 
 * Safety Invariants:
 * - NEVER clicks IITM submit or save buttons.
 * - Enforces assignment fingerprint stale-state protection before executing.
 * - Restores the user's originally active question and paginator window.
 */

import { QuestionType } from "../model/types.js";
import { assignmentFingerprint } from "./protocol.js";
import {
  computeAnswerState,
  AnswerState,
  isValidNumerical,
  isMcqType,
  isMsqType,
  isNumericalType,
  isTextType,
} from "./answer-state.js";

/**
 * Summarizes the current answer review status across all questions.
 */
export function summarizeReviewState(documentModel, selectionsMap = new Map(), aiEntriesMap = new Map()) {
  const questions = documentModel?.questions || [];
  let ready = 0;
  let aiMatched = 0;
  let userOverridden = 0;
  let userSelected = 0;
  let aiSuggested = 0;
  let unanswered = 0;
  let invalid = 0;
  const issues = [];

  for (const q of questions) {
    const userSelection = selectionsMap.get(q.number) ?? null;
    const aiEntry = aiEntriesMap.get(q.number) ?? null;
    const state = computeAnswerState({ type: q.type, aiEntry, userSelection });

    if (state === AnswerState.AI_MATCHED) {
      aiMatched++;
      ready++;
    } else if (state === AnswerState.USER_OVERRIDDEN) {
      userOverridden++;
      ready++;
    } else if (state === AnswerState.USER_SELECTED) {
      userSelected++;
      ready++;
    } else if (state === AnswerState.AI_SUGGESTED) {
      aiSuggested++;
    } else if (state === AnswerState.INVALID) {
      invalid++;
      issues.push({ number: q.number, reason: "Invalid answer format or value" });
    } else {
      unanswered++;
    }
  }

  return {
    total: questions.length,
    ready,
    aiMatched,
    userOverridden,
    userSelected,
    aiSuggested,
    unanswered,
    invalid,
    issues,
  };
}

/**
 * Applies all ready user selections to the actual IITM assessment form controls.
 * @param {Object} params
 * @param {import("../portal/adapter.js").IitmPortalAdapter} params.portal
 * @param {import("../traversal/traverser.js").QuestionTraverser} params.traverser
 * @param {import("../model/document.js").AssignmentDocument} params.documentModel
 * @param {Map<number, any>} params.selectionsMap
 * @param {Map<number, any>} [params.aiEntriesMap]
 * @param {Function} [params.onProgress]
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<{ ok: boolean, appliedCount: number, error?: string }>}
 */
export async function applyAnswersToPortal({
  portal,
  traverser,
  documentModel,
  selectionsMap = new Map(),
  aiEntriesMap = new Map(),
  onProgress = null,
  signal = null,
}) {
  if (!portal || !traverser || !documentModel) {
    return { ok: false, appliedCount: 0, error: "Missing portal or traverser dependency." };
  }

  // 1. Stale-state check: verify assessment is present and matching
  if (!portal.detectAssessment()) {
    return {
      ok: false,
      appliedCount: 0,
      error: "No active IITM assessment detected. Open the assessment page first.",
    };
  }

  const currentFp = assignmentFingerprint(documentModel);
  if (!currentFp) {
    return {
      ok: false,
      appliedCount: 0,
      error: "Unable to verify assignment fingerprint.",
    };
  }

  // 2. Identify questions with non-empty selections ready to apply
  const questionsToApply = [];
  for (const q of documentModel.questions || []) {
    const sel = selectionsMap.get(q.number);
    const aiEntry = aiEntriesMap.get(q.number);
    const state = computeAnswerState({ type: q.type, aiEntry, userSelection: sel });

    if (state === AnswerState.INVALID) {
      continue;
    }

    let hasValue = false;
    if (isMcqType(q.type)) {
      hasValue = typeof sel === "string" && sel.trim().length > 0;
    } else if (isMsqType(q.type)) {
      hasValue = Array.isArray(sel) && sel.length > 0;
    } else if (isNumericalType(q.type) || isTextType(q.type)) {
      hasValue = typeof sel === "string" && sel.trim().length > 0;
    }

    if (hasValue) {
      questionsToApply.push({ question: q, selection: sel });
    }
  }

  if (questionsToApply.length === 0) {
    return { ok: true, appliedCount: 0, error: "No answers selected to apply." };
  }

  // 3. Record user's original active question for exact restoration
  const originalLogicalNumber = portal.getActiveLogicalNumber() || 1;
  let appliedCount = 0;

  try {
    for (let idx = 0; idx < questionsToApply.length; idx++) {
      if (signal?.aborted) {
        throw new Error("Answer application cancelled by user");
      }

      const { question, selection } = questionsToApply[idx];
      const targetNumber = question.number;

      if (onProgress) {
        onProgress({
          current: idx + 1,
          total: questionsToApply.length,
          questionNumber: targetNumber,
        });
      }

      // Navigate to question if not currently active
      if (portal.getActiveLogicalNumber() !== targetNumber) {
        // Find matching chip in visible paginator or advance/rewind to it
        let chip = portal.getQuestionChips().find(
          (c) => portal.getChipLogicalNumber(c) === targetNumber
        );

        if (!chip) {
          // Window search
          let attempts = 0;
          while (attempts++ < 15) {
            const chips = portal.getQuestionChips();
            chip = chips.find((c) => portal.getChipLogicalNumber(c) === targetNumber);
            if (chip) break;

            const numbers = chips.map((c) => portal.getChipLogicalNumber(c)).filter((n) => n !== null);
            const minV = numbers.length ? Math.min(...numbers) : 1;
            const maxV = numbers.length ? Math.max(...numbers) : 1;

            if (targetNumber < minV && portal.canRewindWindow()) {
              await traverser.rewindWindow();
            } else if (targetNumber > maxV && portal.canAdvanceWindow()) {
              await traverser.advanceWindow();
            } else {
              break;
            }
          }
        }

        if (chip) {
          await traverser.navigateToQuestion(chip, targetNumber, 3500, signal);
        } else {
          console.warn(`[Acadrix Applicator] Could not navigate to question ${targetNumber}`);
          continue;
        }
      }

      // Ensure question DOM is populated
      const qRoot = portal.getCurrentQuestionElement();
      if (!qRoot) continue;

      // Apply to MCQ
      if (isMcqType(question.type)) {
        const targetLetter = String(selection).trim().toUpperCase();
        const choices = Array.from(qRoot.querySelectorAll("button.choice, [role=radio], .choice"));
        for (let i = 0; i < choices.length; i++) {
          const ch = choices[i];
          const letterEl = ch.querySelector?.(".choice-letter, .letter");
          let letter = letterEl ? letterEl.textContent.trim().replace(/^[\s(]+|[.\s):]+$/g, "").toUpperCase() : "";
          if (!letter) letter = String.fromCharCode(65 + i);

          if (letter === targetLetter) {
            const isChecked =
              ch.getAttribute?.("aria-checked") === "true" ||
              ch.getAttribute?.("aria-selected") === "true" ||
              ch.getAttribute?.("checked") === "true" ||
              (ch.hasAttribute?.("checked") && ch.getAttribute?.("checked") !== "false") ||
              ch.classList?.contains?.("selected") ||
              ch.classList?.contains?.("is-selected") ||
              ch.classList?.contains?.("active") ||
              Boolean(ch.querySelector?.("input:checked, .checkbox.checked, .radio.checked, .choice-indicator.checked"));

            if (!isChecked) {
              ch.click();
            }
            appliedCount++;
            break;
          }
        }
      }
      // Apply to MSQ
      else if (isMsqType(question.type)) {
        const targetSet = new Set((selection || []).map((s) => String(s).trim().toUpperCase()));
        const choices = Array.from(qRoot.querySelectorAll("button.choice, [role=checkbox], [role=radio], .choice"));
        for (let i = 0; i < choices.length; i++) {
          const ch = choices[i];
          const letterEl = ch.querySelector?.(".choice-letter, .letter");
          let letter = letterEl ? letterEl.textContent.trim().replace(/^[\s(]+|[.\s):]+$/g, "").toUpperCase() : "";
          if (!letter) letter = String.fromCharCode(65 + i);

          const isChecked =
            ch.getAttribute?.("aria-checked") === "true" ||
            ch.getAttribute?.("aria-selected") === "true" ||
            ch.getAttribute?.("checked") === "true" ||
            (ch.hasAttribute?.("checked") && ch.getAttribute?.("checked") !== "false") ||
            ch.classList?.contains?.("selected") ||
            ch.classList?.contains?.("is-selected") ||
            ch.classList?.contains?.("active") ||
            Boolean(ch.querySelector?.("input:checked, .checkbox.checked, .radio.checked, .choice-indicator.checked"));
          const shouldCheck = targetSet.has(letter);

          if (shouldCheck && !isChecked) {
            ch.click();
          } else if (!shouldCheck && isChecked) {
            ch.click();
          }
        }
        appliedCount++;
      }
      // Apply to NUMERICAL
      else if (isNumericalType(question.type)) {
        const input = qRoot.querySelector(
          "textarea[inputmode='decimal'], textarea[inputmode='numeric'], textarea.textarea-field, textarea, input[type=number], input[inputmode='decimal'], input[type=text]"
        );
        if (input) {
          input.value = String(selection).trim();
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          appliedCount++;
        }
      }
      // Apply to TEXT
      else if (isTextType(question.type)) {
        const input = qRoot.querySelector("input[type=text], textarea");
        if (input) {
          input.value = String(selection).trim();
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          appliedCount++;
        }
      }
    }
  } finally {
    // 4. Always restore user to their original position
    try {
      await traverser.restoreLocation(originalLogicalNumber);
    } catch (err) {
      console.warn("[Acadrix Applicator] Failed to restore original location:", err);
    }
  }

  return { ok: true, appliedCount };
}

/**
 * Sets form input value across Angular / React forms using native prototype setter
 * and dispatches all relevant events for complete reactive form synchronization.
 */
function setNativeInputValue(input, val) {
  if (!input) return;
  const strVal = String(val ?? "");
  try {
    const proto =
      typeof HTMLTextAreaElement !== "undefined" && input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : typeof HTMLInputElement !== "undefined" && input instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : Object.getPrototypeOf(input);
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor?.set) {
      descriptor.set.call(input, strVal);
    } else {
      input.value = strVal;
    }
  } catch {
    input.value = strVal;
  }
  input.dispatchEvent(new Event("focus", { bubbles: true }));
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  if (typeof KeyboardEvent !== "undefined") {
    input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  } else {
    input.dispatchEvent(new Event("keyup", { bubbles: true }));
  }
  input.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
}

/**
 * Triggers a click on a choice element using full synthetic pointer and mouse event dispatch
 * followed by .click() to ensure Angular and browser radio/checkbox handlers fire.
 */
function triggerChoiceElementClick(choiceEl) {
  if (!choiceEl) return;
  try {
    choiceEl.focus?.({ preventScroll: true });
  } catch {}
  if (typeof PointerEvent !== "undefined") {
    choiceEl.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true }));
  }
  if (typeof MouseEvent !== "undefined") {
    choiceEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, composed: true }));
  } else {
    choiceEl.dispatchEvent(new Event("mousedown", { bubbles: true, cancelable: true, composed: true }));
  }
  try {
    choiceEl.click?.();
  } catch {}
  if (typeof PointerEvent !== "undefined") {
    choiceEl.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, composed: true }));
  }
  if (typeof MouseEvent !== "undefined") {
    choiceEl.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, composed: true }));
  } else {
    choiceEl.dispatchEvent(new Event("mouseup", { bubbles: true, cancelable: true, composed: true }));
  }
  choiceEl.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}

/**
 * Determines if a portal choice element is currently checked/selected.
 */
function isPortalChoiceChecked(ch) {
  if (!ch) return false;
  return (
    ch.getAttribute("aria-checked") === "true" ||
    ch.getAttribute("aria-selected") === "true" ||
    ch.getAttribute("checked") === "true" ||
    (ch.hasAttribute("checked") && ch.getAttribute("checked") !== "false") ||
    ch.classList.contains("selected") ||
    ch.classList.contains("is-selected") ||
    ch.classList.contains("active") ||
    Boolean(ch.querySelector("input:checked, .checkbox.checked, .radio.checked, .choice-indicator.checked"))
  );
}

let portalSyncQueue = Promise.resolve();

async function executeApplySingleQuestion({ portal, traverser, question, selection }) {
  if (!portal || !portal.detectAssessment() || !question) return false;

  const targetNumber = question.number;
  if (portal.getActiveLogicalNumber && portal.getActiveLogicalNumber() !== targetNumber) {
    if (traverser) {
      let chip = portal.getQuestionChips().find(
        (c) => portal.getChipLogicalNumber(c) === targetNumber
      );
      if (!chip) {
        let attempts = 0;
        while (attempts++ < 15) {
          const chips = portal.getQuestionChips();
          chip = chips.find((c) => portal.getChipLogicalNumber(c) === targetNumber);
          if (chip) break;
          const numbers = chips.map((c) => portal.getChipLogicalNumber(c)).filter((n) => n !== null);
          const minV = numbers.length ? Math.min(...numbers) : 1;
          const maxV = numbers.length ? Math.max(...numbers) : 1;
          if (targetNumber < minV && portal.canRewindWindow()) {
            await traverser.rewindWindow();
          } else if (targetNumber > maxV && portal.canAdvanceWindow()) {
            await traverser.advanceWindow();
          } else {
            break;
          }
        }
      }
      if (chip) {
        await traverser.navigateToQuestion(chip, targetNumber, 3500);
      }
    }
  }

  const qRoot = portal.getCurrentQuestionElement();
  if (!qRoot) return false;

  const isMsq = isMsqType(question.type);
  const isNum = isNumericalType(question.type);
  const isTxt = isTextType(question.type);
  const hasOptions = Array.isArray(question.options) && question.options.length > 0;
  const isMcq = isMcqType(question.type) || (!isMsq && hasOptions);

  if (isMcq) {
    const targetLetter = String(selection || "").replace(/^[\s(]+|[.\s):]+$/g, "").trim().toUpperCase();
    if (targetLetter) {
      const choices = Array.from(qRoot.querySelectorAll("button.choice, [role=radio], .choice"));
      for (let i = 0; i < choices.length; i++) {
        const ch = choices[i];
        const letterEl = ch.querySelector?.(".choice-letter, .letter");
        let letter = letterEl ? letterEl.textContent.trim().replace(/^[\s(]+|[.\s):]+$/g, "").toUpperCase() : "";
        if (!letter) letter = String.fromCharCode(65 + i);

        if (letter === targetLetter) {
          if (!isPortalChoiceChecked(ch)) {
            triggerChoiceElementClick(ch);
          }
          break;
        }
      }
    } else {
      const clearBtn = qRoot.querySelector(".clear-selection, button.clear-selection, .choice-clear, button[aria-label*='clear' i]");
      if (clearBtn) {
        triggerChoiceElementClick(clearBtn);
      }
    }
  } else if (isMsq) {
    const targetSet = new Set(
      (Array.isArray(selection) ? selection : [selection])
        .filter(Boolean)
        .map((s) => String(s).replace(/^[\s(]+|[.\s):]+$/g, "").trim().toUpperCase())
    );
    const choices = Array.from(qRoot.querySelectorAll("button.choice, [role=checkbox], [role=radio], .choice"));
    for (let i = 0; i < choices.length; i++) {
      const ch = choices[i];
      const letterEl = ch.querySelector?.(".choice-letter, .letter");
      let letter = letterEl ? letterEl.textContent.trim().replace(/^[\s(]+|[.\s):]+$/g, "").toUpperCase() : "";
      if (!letter) letter = String.fromCharCode(65 + i);

      const isChecked = isPortalChoiceChecked(ch);
      const shouldCheck = targetSet.has(letter);

      if (shouldCheck && !isChecked) {
        triggerChoiceElementClick(ch);
      } else if (!shouldCheck && isChecked) {
        triggerChoiceElementClick(ch);
      }
    }
  } else if (isNum || isTxt) {
    const input = qRoot.querySelector(
      "textarea[inputmode='decimal'], textarea[inputmode='numeric'], textarea.textarea-field, app-textarea textarea, textarea, input[type=number], input[inputmode='decimal'], input[type=text], .textarea-field"
    );
    if (input) {
      setNativeInputValue(input, selection ?? "");
    }
  }

  return true;
}

/**
 * Directly applies a single question's selection to the IITM portal form control in real-time.
 * Serialized via a queue to eliminate navigation collisions.
 */
export function applySingleQuestionToPortal({
  portal,
  traverser,
  question,
  selection,
}) {
  portalSyncQueue = portalSyncQueue.then(async () => {
    return executeApplySingleQuestion({ portal, traverser, question, selection });
  }).catch((err) => {
    console.warn("[Acadrix Applicator] Queue error applying Q" + question?.number, err);
    return false;
  });

  return portalSyncQueue;
}
