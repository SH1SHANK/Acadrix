/** Strict, DOM-free answer-key parser for the extension answer protocol. */

import { QuestionType } from "../model/types.js";
import { assignmentFingerprint } from "./protocol.js";

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

function lineStartAt(text, index) {
  return index === 0 || text[index - 1] === "\n";
}

function fenceAt(text, index) {
  if (!lineStartAt(text, index) || !["`", "~"].includes(text[index])) return null;
  const marker = text[index];
  let end = index;
  while (text[end] === marker) end++;
  if (end - index < 3) return null;
  const lineEnd = text.indexOf("\n", end);
  const header = text.slice(end, lineEnd === -1 ? text.length : lineEnd).trim().toLowerCase();
  if (header && header !== "json") return null;
  return { marker, length: end - index, contentStart: lineEnd === -1 ? text.length : lineEnd + 1 };
}

function findClosingFence(text, opening) {
  let inString = false;
  let escaped = false;
  for (let index = opening.contentStart; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (!lineStartAt(text, index) || text[index] !== opening.marker) continue;
    let end = index;
    while (text[end] === opening.marker) end++;
    const lineEnd = text.indexOf("\n", end);
    const trailing = text.slice(end, lineEnd === -1 ? text.length : lineEnd).trim();
    if (end - index >= opening.length && !trailing) {
      return { start: opening.contentStart, end: index };
    }
  }
  return null;
}

function extractLastFence(text) {
  let result = null;
  for (let index = 0; index < text.length; index++) {
    const opening = fenceAt(text, index);
    if (!opening) continue;
    const closing = findClosingFence(text, opening);
    if (closing) result = text.slice(closing.start, closing.end);
  }
  return result;
}

function extractLastBalancedObject(text) {
  let inString = false;
  let escaped = false;
  let depth = 0;
  let rootStart = -1;
  let lastComplete = null;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      if (depth === 0) rootStart = index;
      depth++;
    } else if (char === "}" && depth > 0) {
      depth--;
      if (depth === 0 && rootStart !== -1) {
        lastComplete = { start: rootStart, end: index + 1 };
      }
    }
  }

  if (depth > 0 && rootStart !== -1) return text.slice(rootStart);
  return lastComplete ? text.slice(lastComplete.start, lastComplete.end) : null;
}

function extractPayloadText(rawText) {
  const text = typeof rawText === "string" ? rawText : "";
  const extracted = extractLastFence(text) ?? extractLastBalancedObject(text);
  if (extracted === null) return "";
  return extracted.replace(/^[ \t]*json[ \t]*\r?\n/i, "");
}

function parseJson(rawText) {
  const payloadText = extractPayloadText(rawText);
  try {
    return { value: JSON.parse(payloadText), payloadText };
  } catch (error) {
    return {
      fatal: `Invalid JSON: ${error?.message || "Unable to parse answer key"}`,
      payloadText,
    };
  }
}

function questionMap(documentModel) {
  const map = new Map();
  for (const question of documentModel?.questions || []) {
    if (Number.isInteger(question?.number)) map.set(question.number, question);
  }
  return map;
}

function issue(number, reason, status = "invalid") {
  return { number, status, reason };
}

function invalid(number, type, reason) {
  return { number, type, status: "invalid", answer: null, reason };
}

function missing(number, type, reason = "No answer provided") {
  return { number, type, status: "missing", answer: null, reason };
}

function answered(number, type, answer) {
  return { number, type, status: "answered", answer, reason: "" };
}

function canonicalNumerical(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) return null;
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  let [whole, fraction = ""] = unsigned.split(".");
  whole = whole.replace(/^0+(?=\d)/, "") || "0";
  fraction = fraction.replace(/0+$/, "");
  const canonical = fraction ? `${whole}.${fraction}` : whole;
  return negative && canonical !== "0" ? `-${canonical}` : canonical;
}

function validateAnswer(question, rawAnswer) {
  const type = TYPE_NAMES[question.type] || String(question.type || "UNKNOWN").toUpperCase();
  if (type !== "MCQ" && type !== "MSQ" && type !== "NUMERICAL" && type !== "TEXT") {
    return invalid(question.number, type, "unsupported type");
  }

  if (rawAnswer === null) return missing(question.number, type, "model could not determine");

  const validLetters = new Set((question.options || []).map((option) => String(option.letter || "").trim().toUpperCase()));
  if (type === "MCQ") {
    if (typeof rawAnswer !== "string") return invalid(question.number, type, "MCQ answer must be one option letter");
    const value = rawAnswer.trim().toUpperCase();
    if (!/^[A-Z]$/.test(value) || !validLetters.has(value)) return invalid(question.number, type, "MCQ answer must be one existing option letter");
    return answered(question.number, type, value);
  }

  if (type === "MSQ") {
    if (!Array.isArray(rawAnswer)) return invalid(question.number, type, "MSQ answer must be an array of option letters");
    if (rawAnswer.length === 0 || rawAnswer.some((value) => typeof value !== "string")) {
      return invalid(question.number, type, "MSQ answer must contain one or more option letters");
    }
    const values = rawAnswer.map((value) => value.trim().toUpperCase());
    if (values.some((value) => !/^[A-Z]$/.test(value) || !validLetters.has(value))) {
      return invalid(question.number, type, "MSQ answer contains an invalid option letter");
    }
    return answered(question.number, type, [...new Set(values)].sort());
  }

  if (type === "NUMERICAL") {
    const value = canonicalNumerical(rawAnswer);
    return value === null
      ? invalid(question.number, type, "Numerical answer must be a plain decimal string")
      : answered(question.number, type, value);
  }

  if (typeof rawAnswer !== "string" || !rawAnswer.trim()) {
    return invalid(question.number, type, "Text answer must be a non-empty string");
  }
  return answered(question.number, type, rawAnswer.trim());
}

function existingEntries(existing) {
  if (Array.isArray(existing)) return existing;
  if (Array.isArray(existing?.entries)) return existing.entries;
  return [];
}

/**
 * Parses and strictly validates an AI answer key against a canonical document.
 * `existing` may be the prior return value, enabling in-memory append/replace.
 */
export function parseAnswerKey(rawText, documentModel, { existing = null } = {}) {
  const fp = assignmentFingerprint(documentModel);
  const prior = existingEntries(existing);
  const priorFp = existing?.fp || existing?.fingerprint || null;
  if (priorFp && priorFp !== fp) {
    return { ok: false, fatal: "This answer key is for a different assignment. Copy the prompt again.", entries: prior, replaced: [], issues: [] };
  }

  const parsed = parseJson(rawText);
  if (parsed.fatal) return { ok: false, fatal: parsed.fatal, entries: prior, replaced: [], issues: [] };
  const payload = parsed.value;
  if (!payload || payload.acadrix !== 1 || typeof payload.fp !== "string" || !Array.isArray(payload.answers)) {
    return { ok: false, fatal: "Answer key must contain acadrix 1, an fp string, and an answers array.", entries: prior, replaced: [], issues: [] };
  }
  if (payload.fp !== fp) {
    return { ok: false, fatal: "This answer key is for a different assignment. Copy the prompt again.", entries: prior, replaced: [], issues: [] };
  }

  const questions = questionMap(documentModel);
  const byNumber = new Map();
  const duplicateNumbers = new Set();
  for (const item of payload.answers) {
    const number = item && Number.isInteger(item.question) ? item.question : null;
    if (number === null) continue;
    if (byNumber.has(number)) duplicateNumbers.add(number);
    byNumber.set(number, item);
  }

  const fresh = new Map();
  const issues = [];
  for (const [number, item] of byNumber) {
    const question = questions.get(number);
    if (!question) {
      const invalidEntry = invalid(number, String(item?.type || "UNKNOWN"), "unknown question");
      fresh.set(number, invalidEntry);
      issues.push(issue(number, invalidEntry.reason));
      continue;
    }
    const expectedType = TYPE_NAMES[question.type] || String(question.type || "UNKNOWN");
    if (item?.type !== expectedType) {
      const invalidEntry = invalid(number, expectedType, "type mismatch");
      fresh.set(number, invalidEntry);
      issues.push(issue(number, invalidEntry.reason));
      continue;
    }
    if (duplicateNumbers.has(number)) {
      const invalidEntry = invalid(number, expectedType, "duplicate entries");
      fresh.set(number, invalidEntry);
      issues.push(issue(number, invalidEntry.reason));
      continue;
    }
    const entry = validateAnswer(question, item?.answer);
    fresh.set(number, entry);
    if (entry.status !== "answered") issues.push(issue(number, entry.reason, entry.status));
  }

  const replaced = [];
  const merged = new Map(prior.map((entry) => [entry.number, entry]));
  for (const [number, entry] of fresh) {
    if (merged.has(number)) replaced.push(number);
    merged.set(number, entry);
  }
  const entries = [...questions.keys()].map((number) => {
    if (merged.has(number)) return merged.get(number);
    const question = questions.get(number);
    const type = TYPE_NAMES[question.type] || String(question.type || "UNKNOWN");
    const entry = missing(number, type);
    issues.push(issue(number, entry.reason, entry.status));
    return entry;
  });
  for (const [number, entry] of merged) {
    if (!questions.has(number)) entries.push(entry);
  }

  return { ok: true, fatal: null, entries, replaced, issues };
}

export { canonicalNumerical, extractPayloadText };
