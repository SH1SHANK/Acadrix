/**
 * Canonical Answer Review State Model.
 * Provides deterministic answer state classification and validation.
 */

import { QuestionType } from "../model/types.js";
import { canonicalNumerical } from "./parser.js";

export const AnswerState = Object.freeze({
  UNANSWERED: "UNANSWERED",
  AI_SUGGESTED: "AI_SUGGESTED",
  AI_MATCHED: "AI_MATCHED",
  USER_SELECTED: "USER_SELECTED",
  USER_OVERRIDDEN: "USER_OVERRIDDEN",
  INVALID: "INVALID",
});

export const STATUS_CONFIG = Object.freeze({
  [AnswerState.AI_MATCHED]: {
    label: "AI Match",
    badgeClass: "is-ai-matched",
    tone: "success",
  },
  [AnswerState.USER_OVERRIDDEN]: {
    label: "Overridden",
    badgeClass: "is-overridden",
    tone: "warning",
  },
  [AnswerState.AI_SUGGESTED]: {
    label: "AI Suggested",
    badgeClass: "is-ai-suggested",
    tone: "info",
  },
  [AnswerState.USER_SELECTED]: {
    label: "Selected",
    badgeClass: "is-user-selected",
    tone: "accent",
  },
  [AnswerState.UNANSWERED]: {
    label: "Unanswered",
    badgeClass: "is-unanswered",
    tone: "muted",
  },
  [AnswerState.INVALID]: {
    label: "Invalid",
    badgeClass: "is-invalid",
    tone: "error",
  },
});

export function isMsqType(type) {
  const t = String(type || "").toLowerCase();
  return (
    t === "msq" ||
    t === "multiple_choice" ||
    t === "multiple-choice" ||
    t === "checkbox" ||
    t === QuestionType.MSQ
  );
}

export function isNumericalType(type) {
  const t = String(type || "").toLowerCase();
  return (
    t === "numerical" ||
    t === "numeric" ||
    t === "number" ||
    t === QuestionType.NUMERICAL
  );
}

export function isTextType(type) {
  const t = String(type || "").toLowerCase();
  return (
    t === "text" ||
    t === "short_answer" ||
    t === QuestionType.TEXT
  );
}

export function isMcqType(type) {
  if (isMsqType(type) || isNumericalType(type) || isTextType(type)) return false;
  const t = String(type || "").toLowerCase();
  return (
    t === "mcq" ||
    t === "single_choice" ||
    t === "single-choice" ||
    t === "radio" ||
    t === QuestionType.MCQ ||
    t === "unknown" ||
    t === ""
  );
}

/**
 * Validates whether a numerical string is a valid integer, decimal, negative, or scientific notation.
 */
export function isValidNumerical(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  return /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value.trim());
}

/**
 * Normalizes user selection according to question type.
 */
export function normalizeSelection(type, value) {
  if (isMsqType(type)) {
    if (!Array.isArray(value)) return [];
    return [
      ...new Set(
        value
          .map((v) =>
            String(v || "")
              .replace(/^[\s(]+|[.\s):]+$/g, "")
              .trim()
              .toUpperCase()
          )
          .filter(Boolean)
      ),
    ].sort();
  }
  if (isNumericalType(type) || isTextType(type)) {
    if (typeof value !== "string") return "";
    return value.trim();
  }
  if (isMcqType(type)) {
    if (typeof value !== "string" || !value.trim()) return null;
    return value.replace(/^[\s(]+|[.\s):]+$/g, "").trim().toUpperCase();
  }
  return value ?? null;
}

/**
 * Computes the deterministic AnswerState for a question given its AI suggestion and user selection.
 * @param {Object} params
 * @param {string} params.type - Question type (MCQ, MSQ, NUMERICAL, TEXT, etc.)
 * @param {Object|null} params.aiEntry - AI entry from parseAnswerKey
 * @param {any} params.userSelection - Current user selection
 * @returns {string} One of AnswerState enum values
 */
export function computeAnswerState({ type, aiEntry, userSelection }) {
  // 1. Invalid status checks
  if (aiEntry && aiEntry.status === "invalid") {
    return AnswerState.INVALID;
  }
  if (isNumericalType(type) && typeof userSelection === "string" && userSelection.trim() !== "") {
    if (!isValidNumerical(userSelection)) {
      return AnswerState.INVALID;
    }
  }

  // 2. Presence checks
  const hasAi = Boolean(aiEntry && aiEntry.status === "answered" && aiEntry.answer !== null);

  let hasUser = false;
  if (isMsqType(type)) {
    hasUser = Boolean(Array.isArray(userSelection) && userSelection.length > 0);
  } else if (isNumericalType(type) || isTextType(type)) {
    hasUser = Boolean(typeof userSelection === "string" && userSelection.trim().length > 0);
  } else if (isMcqType(type)) {
    hasUser = Boolean(userSelection && typeof userSelection === "string" && userSelection.trim().length > 0);
  }

  if (!hasAi && !hasUser) return AnswerState.UNANSWERED;
  if (!hasAi && hasUser) return AnswerState.USER_SELECTED;
  if (hasAi && !hasUser) return AnswerState.AI_SUGGESTED;

  // 3. Comparison checks (both AI answer and user selection exist)
  const aiAns = aiEntry.answer;
  let matches = false;

  if (isMsqType(type)) {
    const userSorted = [...(userSelection || [])]
      .map((s) => String(s).replace(/^[\s(]+|[.\s):]+$/g, "").trim().toUpperCase())
      .filter(Boolean)
      .sort()
      .join(",");
    const aiSorted = (Array.isArray(aiAns) ? aiAns : [aiAns])
      .map((s) => String(s).replace(/^[\s(]+|[.\s):]+$/g, "").trim().toUpperCase())
      .filter(Boolean)
      .sort()
      .join(",");
    matches = userSorted === aiSorted;
  } else if (isNumericalType(type)) {
    const userCanonical = canonicalNumerical(userSelection);
    const aiCanonical = canonicalNumerical(String(aiAns));
    if (userCanonical !== null && aiCanonical !== null) {
      matches = userCanonical === aiCanonical;
    }
    if (!matches && isValidNumerical(userSelection) && isValidNumerical(String(aiAns))) {
      matches = Math.abs(parseFloat(userSelection) - parseFloat(String(aiAns))) < 1e-9;
    }
  } else if (isTextType(type)) {
    matches = String(userSelection).trim().toLowerCase() === String(aiAns).trim().toLowerCase();
  } else if (isMcqType(type)) {
    const normUser = String(userSelection).replace(/^[\s(]+|[.\s):]+$/g, "").trim().toUpperCase();
    const normAi = String(aiAns).replace(/^[\s(]+|[.\s):]+$/g, "").trim().toUpperCase();
    matches = normUser === normAi;
  }

  return matches ? AnswerState.AI_MATCHED : AnswerState.USER_OVERRIDDEN;
}
