#!/usr/bin/env node
/**
 * Fixture & Model Verification Test.
 * Validates that test fixtures contain required IITM DOM structures
 * and that Canonical Document Model classes and Assembler function correctly.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { AssignmentDocument, QuestionNode, OptionNode, ContentNode } from "../src/model/document.js";
import { AssignmentAssembler } from "../src/model/assembler.js";
import { QuestionType, ContentType } from "../src/model/types.js";

let passed = true;

function check(desc, fn) {
  try {
    fn();
    console.log(`✓ ${desc}`);
  } catch (e) {
    console.error(`❌ ${desc}: ${e.message}`);
    passed = false;
  }
}

// 1. Validate Fixtures (Exact Count: 6 fixtures)
check("Test fixtures are present and well-formed (exactly 6 fixtures)", () => {
  const fixturesDir = "fixtures";
  const expectedFixtures = [
    "code-question.html",
    "mcq-basic.html",
    "mcq-with-math.html",
    "question-with-image.html",
    "review-mode.html",
    "table-question.html",
  ];

  const actualFiles = readdirSync(fixturesDir).filter((f) => f.endsWith(".html"));
  if (actualFiles.length !== 6) {
    throw new Error(`Expected exactly 6 fixtures, found ${actualFiles.length}: [${actualFiles.join(", ")}]`);
  }

  for (const name of expectedFixtures) {
    if (!actualFiles.includes(name)) {
      throw new Error(`Missing expected fixture: ${name}`);
    }
    const html = readFileSync(join(fixturesDir, name), "utf8");
    if (!html.includes("app-assessment-question-view")) {
      throw new Error(`Fixture ${name} missing <app-assessment-question-view> root`);
    }
    if (!html.includes("app-assessment-question")) {
      throw new Error(`Fixture ${name} missing <app-assessment-question>`);
    }
    if (!html.includes("chips")) {
      throw new Error(`Fixture ${name} missing paginator chips`);
    }
  }
});

// 2. Validate Document Model Contract Instantiation
check("AssignmentDocument can be instantiated and populated", () => {
  const doc = new AssignmentDocument({
    metadata: { title: "Python Quiz 1", course: "Programming in Python" },
  });

  const q1 = new QuestionNode({
    id: "q-1",
    number: 1,
    label: "Question 1",
    type: QuestionType.MCQ,
    marks: 2.0,
    stem: [
      new ContentNode({
        type: ContentType.PARAGRAPH,
        value: "What is the capital of France?",
      }),
    ],
    options: [
      new OptionNode({ id: "opt-1", letter: "A", content: "Paris", selected: true }),
      new OptionNode({ id: "opt-2", letter: "B", content: "London", selected: false }),
    ],
  });

  doc.addQuestion(q1);

  if (doc.length !== 1) {
    throw new Error(`Expected doc.length 1, got ${doc.length}`);
  }
  if (doc.getQuestion(0).options[0].selected !== true) {
    throw new Error("OptionNode selected state failed");
  }
});

// 3. Validate Dedicated AssignmentAssembler
check("AssignmentAssembler aggregates questions and builds AssignmentDocument", () => {
  const assembler = new AssignmentAssembler({
    title: "Data Science Assignment 1",
    totalQuestions: 2,
  });

  assembler.addQuestion(
    new QuestionNode({
      id: "q-1",
      number: 1,
      stem: [new ContentNode({ value: "First question" })],
    })
  );
  assembler.addQuestion(
    new QuestionNode({
      id: "q-2",
      number: 2,
      stem: [new ContentNode({ value: "Second question" })],
    })
  );

  const doc = assembler.build();
  if (!(doc instanceof AssignmentDocument)) {
    throw new Error("assembler.build() must return an AssignmentDocument instance");
  }
  if (doc.length !== 2) {
    throw new Error(`Expected 2 questions in assembled document, got ${doc.length}`);
  }
  if (doc.metadata.title !== "Data Science Assignment 1") {
    throw new Error(`Metadata title mismatch: ${doc.metadata.title}`);
  }
});

// 4. Validate Legacy Adapter Bridge & Deprecation Flags
check("QuestionNode.fromLegacySnapshot marks legacyMigrationData correctly", () => {
  const qNode = QuestionNode.fromLegacySnapshot({
    stemHtml: "<p>Sample stem</p>",
    optsHtml: "<div>Sample options</div>",
    index: 2,
    isReview: false,
  });

  if (qNode.number !== 3) {
    throw new Error(`Expected question number 3, got ${qNode.number}`);
  }
  if (!qNode.legacyMigrationData || qNode.legacyMigrationData.stemHtml !== "<p>Sample stem</p>") {
    throw new Error("Legacy snapshot legacyMigrationData mismatch");
  }
  // Deprecated getter alias should mirror legacyMigrationData
  if (!qNode.rawHtml || qNode.rawHtml.optsHtml !== "<div>Sample options</div>") {
    throw new Error("Deprecated rawHtml getter mismatch");
  }
  if (qNode.stem.length !== 1 || qNode.stem[0].type !== ContentType.HTML_BLOCK) {
    throw new Error("Stem content node type mismatch");
  }
});

if (!passed) {
  console.error("\nFixture & Model tests FAILED.");
  process.exit(1);
} else {
  console.log("\nAll fixture & model tests passed successfully.\n");
}
