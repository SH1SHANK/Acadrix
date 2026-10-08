/**
 * Canonical Answer Stream Serializer & Parser for Normal (Non-Programming) Assignments.
 * 
 * Defines the indexed, human-readable, deterministic answer interchange protocol:
 * - Format: `<question-number>: <answer>`
 * - Empty answer is represented as `N:`.
 * - Multi-select (MSQ) options are comma-separated: `2: B,C`.
 * - Colons inside text answers are preserved (splits only on the first `:`).
 * - Multiline text answers are supported via `N: <<<\ncontent\n>>>`.
 * - Validates missing, duplicate, and unknown question numbers.
 * - Backwards compatible with legacy semicolon streams and JSON answer keys.
 */

import { QuestionType } from "../model/types.js";
import { isMsqType, isMcqType, isNumericalType, isTextType } from "./answer-state.js";

const TYPE_NAMES = Object.freeze({
  [QuestionType.MCQ]: "MCQ",
  [QuestionType.MSQ]: "MSQ",
  [QuestionType.NUMERICAL]: "NUMERICAL",
  [QuestionType.TEXT]: "TEXT",
  [QuestionType.DESCRIPTIVE]: "DESCRIPTIVE",
  [QuestionType.UNKNOWN]: "UNKNOWN",
  mcq: "MCQ",
  msq: "MSQ",
  numerical: "NUMERICAL",
  text: "TEXT",
  descriptive: "DESCRIPTIVE",
  unknown: "UNKNOWN",
});

/**
 * Validates and canonicalizes a numerical string.
 * @param {string|number} value
 * @returns {string|null}
 */
export function canonicalNumerical(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const trimmed = String(value).trim();
  if (!/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(trimmed)) return null;
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  if (unsigned.toLowerCase().includes("e")) {
    return trimmed;
  }
  let [whole, fraction = ""] = unsigned.split(".");
  whole = whole.replace(/^0+(?=\d)/, "") || "0";
  fraction = fraction.replace(/0+$/, "");
  const canonical = fraction ? `${whole}.${fraction}` : whole;
  return negative && canonical !== "0" ? `-${canonical}` : canonical;
}

/**
 * Escapes legacy semicolon records (backwards compatibility).
 */
export function escapeAnswerRecord(text) {
  if (text === null || text === undefined) return "";
  return String(text).replace(/\\/g, "\\\\").replace(/;/g, "\\;");
}

/**
 * Unescapes legacy semicolon records (backwards compatibility).
 */
export function unescapeAnswerRecord(text) {
  if (!text) return "";
  let result = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\\" && i + 1 < text.length) {
      const next = text[i + 1];
      if (next === ";" || next === "\\") {
        result += next;
        i += 2;
        continue;
      }
    }
    result += text[i];
    i++;
  }
  return result;
}

/**
 * Serializes an array of answers or question states into the canonical indexed answer stream.
 * 
 * Format:
 * 1: A
 * 2: B,C
 * 3: 1000
 * 4: here
 * 5:
 * 6: <<<
 * multiline text
 * >>>
 * 
 * @param {Array<object|string|number>|object} items Questions, Document, or Answers
 * @param {object} [options]
 * @returns {string} Indexed answer stream
 */
export function serializeAssignmentAnswers(items, options = {}) {
  let list = [];
  if (items && Array.isArray(items.questions)) {
    list = items.questions;
  } else if (Array.isArray(items)) {
    list = items;
  } else if (items instanceof Map) {
    list = Array.from(items.entries()).map(([k, v]) => ({ number: k, answer: v }));
  } else {
    return "";
  }

  const lines = [];
  for (let idx = 0; idx < list.length; idx++) {
    const item = list[idx];
    const qNum = item && item.number !== undefined && item.number !== null
      ? item.number
      : (idx + 1);

    let val = item;
    if (typeof item === "object" && item !== null && !Array.isArray(item)) {
      if (item.answer !== undefined) val = item.answer;
      else if (item.selection !== undefined) val = item.selection;
      else if (item.userSelection !== undefined) val = item.userSelection;
      else if (item.value !== undefined) val = item.value;
      else if (item.savedAnswer !== undefined) val = item.savedAnswer;
      else if (item.options && Array.isArray(item.options)) {
        const selected = item.options.filter((o) => o.selected);
        if (selected.length > 0) {
          val = selected.map((o) => String(o.letter || "").trim().toUpperCase());
          if (val.length === 1 && !isMsqType(item.type)) val = val[0];
        } else {
          val = null;
        }
      } else {
        val = null;
      }
    }

    if (val === null || val === undefined || val === "") {
      lines.push(`${qNum}:`);
      continue;
    }

    if (Array.isArray(val)) {
      const clean = val
        .map((v) => String(v).trim().toUpperCase())
        .filter(Boolean)
        .sort()
        .join(",");
      lines.push(`${qNum}: ${clean}`);
      continue;
    }

    const strVal = String(val).trim();
    if (!strVal) {
      lines.push(`${qNum}:`);
      continue;
    }

    if (strVal.includes("\n")) {
      lines.push(`${qNum}: <<<\n${strVal}\n>>>`);
    } else {
      lines.push(`${qNum}: ${strVal}`);
    }
  }

  return lines.join("\n");
}

export { serializeAssignmentAnswers as serializeAnswerStream };

export function validateQuestionAnswer(question, rawAnswer) {
  const type = TYPE_NAMES[question.type] || String(question.type || "UNKNOWN").toUpperCase();
  const qNum = question.number;

  if (rawAnswer === null || rawAnswer === undefined || rawAnswer === "") {
    return { number: qNum, type, status: "missing", answer: null, reason: "No answer provided" };
  }

  const validLetters = new Set(
    (question.options || []).map((option) => String(option.letter || "").trim().toUpperCase())
  );

  if (type === "MCQ") {
    const value = String(rawAnswer).trim().toUpperCase();
    if (!/^[A-Z]$/.test(value)) {
      return { number: qNum, type, status: "invalid", answer: null, reason: "MCQ answer must be one option letter" };
    }
    if (validLetters.size > 0 && !validLetters.has(value)) {
      return { number: qNum, type, status: "invalid", answer: null, reason: "MCQ answer must be one existing option letter" };
    }
    return { number: qNum, type, status: "answered", answer: value, reason: "" };
  }

  if (type === "MSQ") {
    let values = [];
    if (Array.isArray(rawAnswer)) {
      values = rawAnswer.map((v) => String(v).trim().toUpperCase()).filter(Boolean);
    } else {
      values = String(rawAnswer)
        .split(/[,;\s]+/)
        .map((v) => v.trim().toUpperCase())
        .filter(Boolean);
    }
    if (values.length === 0) {
      return { number: qNum, type, status: "invalid", answer: null, reason: "MSQ answer must contain one or more option letters" };
    }
    if (values.some((v) => !/^[A-Z]$/.test(v) || (validLetters.size > 0 && !validLetters.has(v)))) {
      return { number: qNum, type, status: "invalid", answer: null, reason: "MSQ answer contains an invalid option letter" };
    }
    const uniqueSorted = [...new Set(values)].sort();
    return { number: qNum, type, status: "answered", answer: uniqueSorted, reason: "" };
  }

  if (type === "NUMERICAL") {
    const canonical = canonicalNumerical(rawAnswer);
    if (canonical === null) {
      return { number: qNum, type, status: "invalid", answer: null, reason: "Numerical answer must be a plain decimal string" };
    }
    return { number: qNum, type, status: "answered", answer: canonical, reason: "" };
  }

  const textVal = String(rawAnswer).trim();
  if (!textVal) {
    return { number: qNum, type, status: "missing", answer: null, reason: "No answer provided" };
  }
  return { number: qNum, type, status: "answered", answer: textVal, reason: "" };
}

/**
 * Parses raw text containing indexed answers, legacy semicolon streams, or JSON.
 * 
 * @param {string} rawText Raw input text
 * @param {object} [options]
 * @param {object} [options.documentModel] Canonical AssignmentDocument model
 * @param {number} [options.expectedCount] Expected number of logical questions
 * @returns {{
 *   ok: boolean,
 *   answers: Map<number, string>|string[],
 *   entries: Array<{ number: number, type: string, status: string, answer: any, reason: string }>,
 *   count: number,
 *   expectedCount?: number,
 *   duplicates: number[],
 *   unknowns: number[],
 *   missing: number[],
 *   issues: Array<{ number: number, reason: string, status?: string }>,
 *   error?: string,
 *   warnings?: string[],
 *   isLegacy?: boolean
 * }}
 */
export function parseAssignmentAnswers(rawText, options = {}) {
  if (typeof rawText !== "string") {
    return {
      ok: false,
      answers: [],
      entries: [],
      count: 0,
      duplicates: [],
      unknowns: [],
      missing: [],
      issues: [],
      error: "Input must be a string.",
    };
  }

  const documentModel = options.documentModel || null;
  const questionsList = documentModel?.questions || [];
  const questionsMap = new Map();
  questionsList.forEach((q, idx) => {
    const qNum = q.number !== undefined && q.number !== null ? q.number : (idx + 1);
    questionsMap.set(qNum, q);
  });

  const expectedCount =
    options.expectedCount !== undefined
      ? options.expectedCount
      : questionsList.length > 0
      ? questionsList.length
      : null;

  const trimmed = rawText.trim();
  if (!trimmed) {
    if (expectedCount && expectedCount > 0) {
      return {
        ok: false,
        answers: [],
        entries: [],
        count: 0,
        expectedCount,
        duplicates: [],
        unknowns: [],
        missing: Array.from(questionsMap.keys()),
        issues: [],
        error: `Expected ${expectedCount} answers, received 0.`,
      };
    }
    return { ok: true, answers: [], entries: [], count: 0, expectedCount: 0, duplicates: [], unknowns: [], missing: [], issues: [] };
  }

  // 1. Check for legacy JSON format fallback
  if (trimmed.startsWith("{") && (trimmed.includes('"acadrix"') || trimmed.includes('"answers"'))) {
    try {
      const parsedJson = JSON.parse(trimmed);
      if (parsedJson && Array.isArray(parsedJson.answers)) {
        const answersList = [];
        const rawMap = new Map();
        for (const item of parsedJson.answers) {
          const num = item && item.question !== undefined ? item.question : answersList.length + 1;
          const ans = item?.answer !== null && item?.answer !== undefined
            ? (Array.isArray(item.answer) ? item.answer.join(",") : String(item.answer))
            : "";
          rawMap.set(num, ans);
          answersList.push(ans);
        }

        const entries = [];
        const issues = [];
        for (const [qNum, q] of questionsMap) {
          const rawAns = rawMap.get(qNum);
          const entry = validateQuestionAnswer(q, rawAns);
          entries.push(entry);
          if (entry.status !== "answered") {
            issues.push({ number: qNum, reason: entry.reason, status: entry.status });
          }
        }

        return {
          ok: true,
          answers: answersList,
          entries,
          count: rawMap.size,
          expectedCount: expectedCount ?? rawMap.size,
          duplicates: [],
          unknowns: [],
          missing: [],
          issues,
          isLegacy: true,
        };
      }
    } catch {}
  }

  // 2. Check for legacy semicolon-only format fallback (e.g. "A;\nB,C;\n1000;")
  const rawLines = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const hasIndexedPattern = rawLines.some((l) => /^\s*\d+\s*:/.test(l));

  if (!hasIndexedPattern && rawLines.some((l) => l.trim().endsWith(";"))) {
    const legacyAnswers = [];
    for (let idx = 0; idx < rawLines.length; idx++) {
      const rawLine = rawLines[idx].trim();
      if (!rawLine) {
        legacyAnswers.push("");
        continue;
      }
      let lineText = rawLine;
      if (lineText.endsWith(";")) {
        let backslashCount = 0;
        for (let j = lineText.length - 2; j >= 0 && lineText[j] === "\\"; j--) {
          backslashCount++;
        }
        if (backslashCount % 2 === 0) {
          lineText = lineText.slice(0, -1);
        }
      }
      legacyAnswers.push(unescapeAnswerRecord(lineText).trim());
    }

    const entries = [];
    const issues = [];
    questionsList.forEach((q, idx) => {
      const qNum = q.number !== undefined && q.number !== null ? q.number : (idx + 1);
      const rawAns = legacyAnswers[idx];
      const entry = validateQuestionAnswer(q, rawAns);
      entries.push(entry);
      if (entry.status !== "answered") {
        issues.push({ number: qNum, reason: entry.reason, status: entry.status });
      }
    });

    return {
      ok: expectedCount === null || legacyAnswers.length === expectedCount,
      answers: legacyAnswers,
      entries,
      count: legacyAnswers.length,
      expectedCount: expectedCount ?? legacyAnswers.length,
      duplicates: [],
      unknowns: [],
      missing: [],
      issues,
      isLegacy: true,
      error: expectedCount !== null && legacyAnswers.length !== expectedCount
        ? `Expected ${expectedCount} answers, received ${legacyAnswers.length}.`
        : undefined,
    };
  }

  // 3. Parse Canonical Indexed Answer Stream (`N: <answer>`, `N: <<<\nmultiline\n>>>`)
  const seenNumbers = new Set();
  const duplicateSet = new Set();
  const records = new Map(); // number -> answer string
  const warnings = [];

  let inMultiline = false;
  let multilineNum = null;
  let multilineBuffer = [];

  for (let idx = 0; idx < rawLines.length; idx++) {
    const line = rawLines[idx];
    const trimmedLine = line.trim();

    if (inMultiline) {
      if (trimmedLine === ">>>") {
        records.set(multilineNum, multilineBuffer.join("\n"));
        inMultiline = false;
        multilineNum = null;
        multilineBuffer = [];
      } else {
        multilineBuffer.push(line);
      }
      continue;
    }

    if (!trimmedLine) {
      continue;
    }

    // Check multiline opening: `6: <<<`
    const multilineOpenMatch = line.match(/^\s*(\d+)\s*:\s*<<<\s*$/);
    if (multilineOpenMatch) {
      const qNum = parseInt(multilineOpenMatch[1], 10);
      if (seenNumbers.has(qNum)) {
        duplicateSet.add(qNum);
      }
      seenNumbers.add(qNum);
      multilineNum = qNum;
      inMultiline = true;
      multilineBuffer = [];
      continue;
    }

    // Standard single-line record: `1: A`, `2: B,C`, `3: 1000`, `4: colon: in: answer`, `5:`
    const singleMatch = line.match(/^\s*(\d+)\s*:(.*)$/);
    if (singleMatch) {
      const qNum = parseInt(singleMatch[1], 10);
      const rest = singleMatch[2];

      if (seenNumbers.has(qNum)) {
        duplicateSet.add(qNum);
      }
      seenNumbers.add(qNum);

      const trimmedRest = rest.trim();
      // Handle inline closed <<<...>>>
      if (trimmedRest.startsWith("<<<") && trimmedRest.endsWith(">>>") && trimmedRest.length >= 6) {
        const inner = trimmedRest.slice(3, -3).trim();
        records.set(qNum, inner);
      } else {
        records.set(qNum, trimmedRest);
      }
      continue;
    }

    warnings.push(`Unrecognized line ${idx + 1}: "${trimmedLine}"`);
  }

  // Handle unclosed multiline block
  if (inMultiline && multilineNum !== null) {
    records.set(multilineNum, multilineBuffer.join("\n"));
    warnings.push(`Unclosed multiline block for question ${multilineNum} (missing '>>>').`);
  }

  const duplicates = Array.from(duplicateSet).sort((a, b) => a - b);
  const unknowns = [];
  const missing = [];
  const entries = [];
  const issues = [];

  if (questionsMap.size > 0) {
    for (const qNum of records.keys()) {
      if (!questionsMap.has(qNum)) {
        unknowns.push(qNum);
      }
    }
    unknowns.sort((a, b) => a - b);

    for (const [qNum, question] of questionsMap) {
      if (!records.has(qNum)) {
        missing.push(qNum);
        const type = TYPE_NAMES[question.type] || String(question.type || "UNKNOWN");
        const entry = { number: qNum, type, status: "missing", answer: null, reason: "No answer provided" };
        entries.push(entry);
        issues.push({ number: qNum, reason: entry.reason, status: entry.status });
      } else if (duplicateSet.has(qNum)) {
        const type = TYPE_NAMES[question.type] || String(question.type || "UNKNOWN");
        const entry = { number: qNum, type, status: "invalid", answer: null, reason: "duplicate entries" };
        entries.push(entry);
        issues.push({ number: qNum, reason: entry.reason, status: entry.status });
      } else {
        const rawAns = records.get(qNum);
        const entry = validateQuestionAnswer(question, rawAns);
        entries.push(entry);
        if (entry.status !== "answered") {
          issues.push({ number: qNum, reason: entry.reason, status: entry.status });
        }
      }
    }

    for (const unkNum of unknowns) {
      const entry = { number: unkNum, type: "UNKNOWN", status: "invalid", answer: records.get(unkNum), reason: "unknown question" };
      entries.push(entry);
      issues.push({ number: unkNum, reason: entry.reason, status: entry.status });
    }
  }

  const answersArray = Array.from(records.values());

  return {
    ok: issues.filter((i) => i.status === "invalid").length === 0 && unknowns.length === 0 && duplicates.length === 0,
    answers: answersArray,
    entries,
    count: records.size,
    expectedCount: expectedCount ?? records.size,
    duplicates,
    unknowns,
    missing,
    issues,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

export { parseAssignmentAnswers as parseAnswerStream };

