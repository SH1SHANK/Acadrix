#!/usr/bin/env node
import assert from "node:assert/strict";
import { ContentNode, OptionNode, QuestionNode, AssignmentDocument } from "../src/model/document.js";
import { QuestionType, ContentType } from "../src/model/types.js";
import { assignmentFingerprint } from "../src/bridge/protocol.js";
import { canonicalNumerical, parseAnswerKey } from "../src/bridge/parser.js";

const questions = [
  new QuestionNode({
    number: 1,
    type: QuestionType.MCQ,
    stem: [new ContentNode({ type: ContentType.TEXT, value: "Choose one." })],
    options: [new OptionNode({ letter: "A" }), new OptionNode({ letter: "B" })],
  }),
  new QuestionNode({
    number: 2,
    type: QuestionType.MSQ,
    stem: [new ContentNode({ type: ContentType.TEXT, value: "Choose many." })],
    options: [new OptionNode({ letter: "A" }), new OptionNode({ letter: "B" }), new OptionNode({ letter: "C" })],
  }),
  new QuestionNode({
    number: 3,
    type: QuestionType.NUMERICAL,
    stem: [new ContentNode({ type: ContentType.TEXT, value: "Calculate." })],
  }),
  new QuestionNode({
    number: 4,
    type: QuestionType.TEXT,
    stem: [new ContentNode({ type: ContentType.TEXT, value: "Explain." })],
  }),
];
const doc = new AssignmentDocument({ metadata: { title: "Parser fixture" }, questions });
const fp = assignmentFingerprint(doc);
const fence = "```";
const payload = (answers = []) => JSON.stringify({ acadrix: 1, fp, answers });
const parse = (answers, raw = payload(answers), existing = null) => parseAnswerKey(raw, doc, { existing });
const answer = (number, type, value) => ({ question: number, type, answer: value });

function assertAnswered(result, number, expected) {
  const entry = result.entries.find((item) => item.number === number);
  assert.equal(entry.status, "answered");
  assert.deepEqual(entry.answer, expected);
}

const valid = [
  ["fenced JSON", `before\n${fence}json\n${payload([answer(1, "MCQ", "B")])}\n${fence}\nafter`, 1],
  ["fenced with tildes", `~~~json\n${payload([answer(1, "MCQ", "B")])}\n~~~`, 1],
  ["trailing prose after fence", `${fence}\n${payload([answer(1, "MCQ", "A")])}\n${fence}\nThis is not JSON`, 1],
  ["last of two fences wins", `${fence}json\n${payload([answer(1, "MCQ", "A")])}\n${fence}\n${fence}json\n${payload([answer(1, "MCQ", "B")])}\n${fence}`, 1],
  ["fence inside JSON string", `${fence}json\n${payload([answer(4, "TEXT", "literal " + fence + " value")])}\n${fence}`, 1],
  ["no fence with prose braces", `prose {not JSON}\n${payload([answer(1, "MCQ", "A")])}`, 1],
  ["braces inside string values", payload([answer(4, "TEXT", "use {x} and }")]), 1],
  ["standalone json copy artifact", `${fence}\njson\n${payload([answer(1, "MCQ", "A")])}\n${fence}`, 1],
];
for (const [name, raw, expectedCount] of valid) {
  const result = parse([], raw);
  assert.equal(result.ok, true, name);
  assert.equal(result.entries.filter((entry) => entry.status === "answered").length, expectedCount, name);
}

for (const raw of ["truncated {\"acadrix\":1", "no JSON here"]) {
  const result = parse([], raw);
  assert.equal(result.ok, false);
  assert.match(result.fatal, /Invalid JSON/);
}

for (const bad of [
  { acadrix: 2, fp, answers: [] },
  { acadrix: 1, answers: [] },
  { acadrix: 1, fp, answers: {} },
]) {
  const result = parse([], JSON.stringify(bad));
  assert.equal(result.ok, false);
  assert.match(result.fatal, /acadrix|answers|fp/);
}

const cases = [
  ["MCQ lowercase and padding", answer(1, "MCQ", " b "), "B"],
  ["MCQ option label rejected", answer(1, "MCQ", "Option B"), null],
  ["MCQ multiple letters rejected", answer(1, "MCQ", "B, C"), null],
  ["MCQ numeric label rejected", answer(1, "MCQ", "2"), null],
  ["MCQ out-of-range rejected", answer(1, "MCQ", "C"), null],
  ["MSQ sorted and deduplicated", answer(2, "MSQ", ["c", "A", "a"]), ["A", "C"]],
  ["MSQ string rejected", answer(2, "MSQ", "A"), null],
  ["MSQ empty rejected", answer(2, "MSQ", []), null],
  ["MSQ invalid letter rejected", answer(2, "MSQ", ["A", "D"]), null],
  ["numerical canonical decimal", answer(3, "NUMERICAL", "42.50"), "42.5"],
  ["numerical negative zero", answer(3, "NUMERICAL", "-0"), "0"],
  ["numerical leading zeros", answer(3, "NUMERICAL", "0042"), "42"],
  ["numerical trailing point rejected", answer(3, "NUMERICAL", "42."), null],
  ["numerical leading dot rejected", answer(3, "NUMERICAL", ".5"), null],
  ["numerical plus sign rejected", answer(3, "NUMERICAL", "+5"), null],
  ["numerical exponent rejected", answer(3, "NUMERICAL", "1e3"), null],
  ["numerical comma rejected", answer(3, "NUMERICAL", "1,000"), null],
  ["numerical fraction rejected", answer(3, "NUMERICAL", "3/4"), null],
  ["numerical units rejected", answer(3, "NUMERICAL", "12 m/s"), null],
  ["numerical JSON number rejected", answer(3, "NUMERICAL", 42), null],
  ["text empty rejected", answer(4, "TEXT", "  "), null],
  ["text preserves safe content", answer(4, "TEXT", "<img onerror=alert(1)>"), "<img onerror=alert(1)>"] ,
];
for (const [name, item, expected] of cases) {
  const result = parse([item]);
  if (expected === null) {
    assert.equal(result.entries.find((entry) => entry.number === item.question).status, "invalid", name);
  } else {
    assertAnswered(result, item.question, expected);
  }
}

assert.equal(canonicalNumerical("42.50"), "42.5");
assert.equal(canonicalNumerical("-0"), "0");
assert.equal(canonicalNumerical("0042"), "42");
assert.equal(canonicalNumerical("42."), null);
assert.equal(canonicalNumerical(".5"), null);
assert.equal(canonicalNumerical("+5"), null);
assert.equal(canonicalNumerical("1e3"), null);
assert.equal(canonicalNumerical("1,000"), null);

// Null answer => Missing ("model could not determine")
const nullAnswerResult = parse([answer(1, "MCQ", null)]);
const nullEntry = nullAnswerResult.entries.find((entry) => entry.number === 1);
assert.equal(nullEntry.status, "missing");
assert.match(nullEntry.reason, /model could not determine/i);

const missing = parse([answer(1, "MCQ", "A")]);
assert.equal(missing.entries.find((entry) => entry.number === 2).status, "missing");
assert.equal(missing.entries.find((entry) => entry.number === 4).status, "missing");

const unknown = parse([{ question: 99, type: "MCQ", answer: "A" }]);
assert.equal(unknown.issues.find((item) => item.number === 99).reason, "unknown question");

const mismatch = parse([answer(1, "MSQ", ["A"])]);
assert.equal(mismatch.entries.find((entry) => entry.number === 1).reason, "type mismatch");

const duplicate = parse([answer(1, "MCQ", "A"), answer(1, "MCQ", "B")]);
assert.equal(duplicate.entries.find((entry) => entry.number === 1).reason, "duplicate entries");

// Unsupported question type in document (DESCRIPTIVE, UNKNOWN)
const docWithDescriptive = new AssignmentDocument({
  metadata: { title: "Descriptive doc" },
  questions: [
    new QuestionNode({
      number: 1,
      type: QuestionType.DESCRIPTIVE,
      stem: [new ContentNode({ type: ContentType.TEXT, value: "Write an essay." })],
    }),
  ],
});
const descriptiveFp = assignmentFingerprint(docWithDescriptive);
const descResult = parseAnswerKey(
  JSON.stringify({ acadrix: 1, fp: descriptiveFp, answers: [{ question: 1, type: "DESCRIPTIVE", answer: "my essay" }] }),
  docWithDescriptive
);
assert.equal(descResult.entries[0].status, "invalid");
assert.equal(descResult.entries[0].reason, "unsupported type");

const prior = parse([answer(1, "MCQ", "A")]);
const replacement = parse([answer(1, "MCQ", "B")], payload([answer(1, "MCQ", "B")]), prior);
assert.equal(replacement.ok, true);
assert.deepEqual(replacement.replaced, [1]);
assertAnswered(replacement, 1, "B");

const wrongFpPayload = JSON.stringify({ acadrix: 1, fp: "00000000", answers: [answer(1, "MCQ", "B")] });
const wrongFp = parse([], wrongFpPayload, prior);
assert.equal(wrongFp.ok, false);
assert.deepEqual(wrongFp.entries, prior.entries);

console.log("✓ Parser extraction, validation, merge, and fatal-error tests passed");
