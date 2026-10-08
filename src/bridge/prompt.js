/**
 * Acadrix AI Prompt Serializer.
 * Functional entry points for converting Standard and Programming AssignmentDocuments
 * into LLM-optimized prompts and clipboard exports.
 */

import { MarkdownExporter, exportAssignmentToPrompt } from "../exporters/markdown.js";
import { normalizeProgrammingLanguage } from "./languages.js";
import { QuestionType, AssessmentFamily } from "../model/types.js";
/**
 * Estimates token count from character count (~chars / 4).
 * @param {string} text
 * @returns {number}
 */
export function estimateTokenCount(text) {
  if (typeof text !== "string") return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Generates an LLM-optimized prompt from an AssignmentDocument with scope selection and token estimation.
 * Routes programming assignments to serializeProgrammingPrompt to preserve full context.
 * @param {import("../model/document.js").AssignmentDocument} assignmentDoc
 * @param {Object} [options]
 * @param {Object} [options.scope] - { type: "all" } | { type: "range", start: number, end: number } | { type: "single", number: number }
 * @returns {{ prompt: string, tokenEstimate: number, figureQuestions: number[], questionCount: number }}
 */
export function generateAiPrompt(assignmentDoc, options = {}) {
  const isProgramming =
    assignmentDoc?.metadata?.family === AssessmentFamily.PROGRAMMING ||
    assignmentDoc?.questions?.some(
      (q) => q.type === QuestionType.PROGRAMMING || q.family === AssessmentFamily.PROGRAMMING || Boolean(q.programmingData)
    );

  if (isProgramming) {
    const prompt = serializeProgrammingPrompt(assignmentDoc, options);
    const tokenEstimate = estimateTokenCount(prompt);
    return {
      prompt,
      tokenEstimate,
      figureQuestions: [],
      questionCount: assignmentDoc?.questions?.length || 1,
    };
  }

  const exporter = new MarkdownExporter({
    mode: "prompt",
    scope: options.scope || null,
    responseFormat: options.responseFormat,
  });

  const prompt = exporter.exportDocument(assignmentDoc);
  const tokenEstimate = estimateTokenCount(prompt);
  const figureQuestions = exporter.figureQuestionNumbers || [];
  const questionCount = exporter.exportedQuestions ? exporter.exportedQuestions.length : 0;

  return {
    prompt,
    tokenEstimate,
    figureQuestions,
    questionCount,
  };
}


/**
 * Serializes a programming assignment document into an LLM-optimized prompt.
 * First-class support for Bash, SQL, Python, Java, and JavaScript.
 *
 * @param {import("../model/document.js").AssignmentDocument} programmingDoc
 * @param {object} [options]
 * @param {boolean} [options.includeInstructions=true] Include general instructions if present
 * @param {boolean} [options.includeQuestion=true] Include problem statement
 * @param {boolean} [options.includeImages=true] Include question images/diagrams
 * @param {boolean} [options.includeExamples=true] Include examples if present
 * @param {boolean} [options.includeConstraints=true] Include constraints if present
 * @param {boolean} [options.includeTestCases=true] Include test cases
 * @param {boolean} [options.includeStarterCode=true] Include starter code if present
 * @param {boolean} [options.includePrefixCode=true] Include protected prefix code if present
 * @param {boolean} [options.includeSuffixCode=true] Include protected suffix code if present
 * @param {boolean} [options.includeCurrentCode=false] Include student current code
 * @param {boolean} [options.includeReturnInstructions=true] Include return/output instructions

 * @returns {string} Serialized prompt
 */
export function serializeProgrammingPrompt(programmingDoc, options = {}) {
  if (!programmingDoc) return "";

  const {
    includeInstructions = true,
    includeQuestion = true,
    includeImages = true,
    includeExamples = true,
    includeConstraints = true,
    includeTestCases = true,
    includeStarterCode = true,
    includePrefixCode = true,
    includeSuffixCode = true,
    includeCurrentCode = false,
    includeReturnInstructions = true,
  } = options;

  const meta = programmingDoc.metadata || {};
  const questions = Array.isArray(programmingDoc.questions) ? programmingDoc.questions : [];
  const question = questions[0] || null;
  const pData = question?.programmingData || {};
  const title = meta.title || question?.label || "Programming Assignment";
  const rawLang = pData.language || "javascript";
  const lang = normalizeProgrammingLanguage(rawLang) || rawLang;
  const starterCode = pData.starterCode;
  const currentCode = pData.currentCode;
  const prefixCode = pData.prefixCode;
  const suffixCode = pData.suffixCode;

  const exporter = new MarkdownExporter({ mode: "standard" });
  const problemMd = question?.stem ? exporter.serializeBlockNodes(question.stem) : "";

  // Deterministic section order
  const parts = [
    `# Acadrix Programming Assignment\n# ${title}`,
  ];

  // 1. Assignment Metadata
  const metaLines = [`## Assignment Metadata`];
  if (meta.course) metaLines.push(`Course: ${meta.course}`);
  metaLines.push(`Assignment: ${title}`);
  if (meta.week) metaLines.push(`Week: ${meta.week}`);
  metaLines.push(`Language: ${lang}`);
  parts.push(metaLines.join("\n"));
  if (includeInstructions) {
    const instNodes = meta.instructions || pData.instructions;
    if (Array.isArray(instNodes) && instNodes.length > 0) {
      const instMd = exporter.serializeBlockNodes(instNodes);
      if (instMd) parts.push(`## Instructions\n\n${instMd}`);
    } else if (typeof instNodes === "string" && instNodes.trim()) {
      parts.push(`## Instructions\n\n${instNodes.trim()}`);
    }
  }

  // 4. Problem Statement
  if (includeQuestion && problemMd) {
    parts.push(`## Problem Statement\n\n${problemMd}`);
  }

  // 5. Images / diagrams
  if (includeImages && Array.isArray(pData.images) && pData.images.length > 0) {
    const unseenImages = pData.images.filter(
      (img) => !problemMd.includes(img.src) && !problemMd.includes(img.alt)
    );
    if (unseenImages.length > 0) {
      const imgLines = unseenImages.map((img) => {
        const alt = img.alt || "Question diagram";
        const cap = img.caption ? `\n*${img.caption}*` : "";
        return `![${alt}](${img.src})${cap}`;
      });
      parts.push(`## Images / Diagrams\n\n${imgLines.join("\n\n")}`);
    }
  }

  // 6. Examples
  if (includeExamples && Array.isArray(pData.examples) && pData.examples.length > 0) {
    const exParts = pData.examples.map((ex, i) => {
      if (typeof ex === "string") return `### Example ${i + 1}\n${ex}`;
      const inStr = ex.input ? `**Input:**\n\`\`\`text\n${ex.input}\n\`\`\`` : "";
      const outStr = ex.output ? `**Output:**\n\`\`\`text\n${ex.output}\n\`\`\`` : "";
      const expStr = ex.explanation ? `**Explanation:** ${ex.explanation}` : "";
      return [`### Example ${i + 1}`, inStr, outStr, expStr].filter(Boolean).join("\n\n");
    });
    parts.push(`## Examples\n\n${exParts.join("\n\n")}`);
  }

  // 7. Constraints
  if (includeConstraints && Array.isArray(pData.constraints) && pData.constraints.length > 0) {
    const constrList = pData.constraints.map((c) => `- ${typeof c === "string" ? c : String(c)}`).join("\n");
    parts.push(`## Constraints\n\n${constrList}`);
  }

  // 8. Test Cases
  if (includeTestCases) {
    const tcParts = [];
    if (Array.isArray(pData.testCases) && pData.testCases.length > 0) {
      pData.testCases.forEach((tc, idx) => {
        if (tc.raw) {
          tcParts.push(`### Test Case ${tc.index || idx + 1}\n\`\`\`text\n${tc.raw}\n\`\`\``);
          return;
        }
        const header = tc.description
          ? `### Test Case ${tc.index || idx + 1} (${tc.description})`
          : `### Test Case ${tc.index || idx + 1}`;
        tcParts.push(header);
        if (tc.input !== undefined && tc.input !== null) {
          tcParts.push(`**Input:**\n\`\`\`text\n${tc.input}\n\`\`\``);
        }
        if (tc.expectedOutput !== undefined && tc.expectedOutput !== null) {
          tcParts.push(`**Expected Output:**\n\`\`\`text\n${tc.expectedOutput}\n\`\`\``);
        }
      });
    }
    const testCasesMd = tcParts.length > 0 ? tcParts.join("\n\n") : "No visible test cases.";
    parts.push(`## Test Cases\n\n${testCasesMd}`);
  }

  // 9. Starter Code
  const codeToInclude = starterCode || (!includeCurrentCode ? currentCode : "");
  if (includeStarterCode && codeToInclude && codeToInclude.trim().length > 0) {
    const heading = starterCode ? "Starter Code" : "Starter / Current Code";
    parts.push(`## ${heading}\n\`\`\`${lang}\n${codeToInclude.trim()}\n\`\`\``);
  }

  // 10. Protected Prefix Code
  if (includePrefixCode && prefixCode !== null && prefixCode !== undefined && prefixCode.length > 0) {
    parts.push(
      `## Protected Prefix Code\n/* Protected Assignment Prefix: Do not modify */\n\`\`\`${lang}\n${prefixCode}\n\`\`\``
    );
  }

  // 11. Protected Suffix Code
  if (includeSuffixCode && suffixCode !== null && suffixCode !== undefined && suffixCode.length > 0) {
    parts.push(
      `## Protected Suffix Code\n/* Protected Assignment Suffix: Do not modify */\n\`\`\`${lang}\n${suffixCode}\n\`\`\``
    );
  }

  // 12. Return Instructions
  if (includeReturnInstructions) {
    const returnInst = pData.returnInstructions ||
      `Return only the completed, working ${lang} code for direct pasting into the editor.`;
    parts.push(`## Return Instructions\n${returnInst.trim()}`);
  }

  // 13. Current Student Code (optional, e.g. for debugging/review prompts)
  if (includeCurrentCode && currentCode && currentCode.length > 0 && currentCode !== starterCode) {
    parts.push(`## Current Student Code\n\`\`\`${lang}\n${currentCode}\n\`\`\``);
  }

  // 14. Task
  parts.push(
    `## Task\n### Task\nSolve the programming assignment and return only the editable solution code for direct pasting into Acadrix's code editor. Do not wrap the solution in an Acadrix JSON or HTML format, and do not include explanatory text.\nThe editable solution must replace only the editable/main code region.\nDo not modify protected prefix or suffix code.`
  );


  return parts.join("\n\n");
}

/**
 * Copies the problem statement, examples, and constraints.
 * @param {import("../model/document.js").AssignmentDocument} doc
 * @returns {string}
 */
export function copyQuestion(doc) {
  if (!doc) return "";
  const meta = doc.metadata || {};
  const question = doc.questions?.[0] || null;
  const pData = question?.programmingData || {};
  const title = meta.title || question?.label || "Programming Assignment";
  const rawLang = pData.language || "javascript";
  const lang = normalizeProgrammingLanguage(rawLang) || rawLang;

  const exporter = new MarkdownExporter({ mode: "standard" });
  const problemMd = question?.stem ? exporter.serializeBlockNodes(question.stem) : "";

  const parts = [`# ${title}`];
  if (meta.course) parts.push(`**Course:** ${meta.course}`);
  if (meta.week) parts.push(`**Context:** ${meta.week}`);
  parts.push(`**Language:** \`${lang}\``);
  if (problemMd) parts.push(`## Problem Statement\n\n${problemMd}`);

  if (Array.isArray(pData.examples) && pData.examples.length > 0) {
    const exParts = pData.examples.map((ex, i) => {
      if (typeof ex === "string") return `### Example ${i + 1}\n${ex}`;
      const inStr = ex.input ? `**Input:**\n\`\`\`text\n${ex.input}\n\`\`\`` : "";
      const outStr = ex.output ? `**Output:**\n\`\`\`text\n${ex.output}\n\`\`\`` : "";
      return [`### Example ${i + 1}`, inStr, outStr].filter(Boolean).join("\n\n");
    });
    parts.push(`## Examples\n\n${exParts.join("\n\n")}`);
  }

  if (Array.isArray(pData.constraints) && pData.constraints.length > 0) {
    const constrList = pData.constraints.map((c) => `- ${c}`).join("\n");
    parts.push(`## Constraints\n\n${constrList}`);
  }

  return parts.join("\n\n");
}

/**
 * Copies immutable starter code.
 * @param {import("../model/document.js").AssignmentDocument} doc
 * @returns {string}
 */
export function copyStarterCode(doc) {
  if (!doc) return "";
  const pData = doc.questions?.[0]?.programmingData || {};
  return pData.starterCode || "";
}
/**
 * Copies protected prefix code.
 * @param {import("../model/document.js").AssignmentDocument} doc
 * @returns {string}
 */
export function copyPrefixCode(doc) {
  if (!doc) return "";
  const pData = doc.questions?.[0]?.programmingData || {};
  return pData.prefixCode || "";
}

/**
 * Copies protected suffix code.
 * @param {import("../model/document.js").AssignmentDocument} doc
 * @returns {string}
 */
export function copySuffixCode(doc) {
  if (!doc) return "";
  const pData = doc.questions?.[0]?.programmingData || {};
  return pData.suffixCode || "";
}


/**
 * Copies test cases formatted in Markdown.
 * @param {import("../model/document.js").AssignmentDocument} doc
 * @returns {string}
 */
export function copyTestCases(doc) {
  if (!doc) return "";
  const meta = doc.metadata || {};
  const question = doc.questions?.[0] || null;
  const pData = question?.programmingData || {};
  const title = meta.title || question?.label || "Programming Assignment";

  const tcParts = [];
  if (Array.isArray(pData.testCases) && pData.testCases.length > 0) {
    pData.testCases.forEach((tc, idx) => {
      const header = tc.description ? `### Test Case ${tc.index || idx + 1} (${tc.description})` : `### Test Case ${tc.index || idx + 1}`;
      tcParts.push(header);
      if (tc.input !== undefined && tc.input !== null) {
        tcParts.push(`**Input:**\n\`\`\`text\n${tc.input}\n\`\`\``);
      }
      if (tc.expectedOutput !== undefined && tc.expectedOutput !== null) {
        tcParts.push(`**Expected Output:**\n\`\`\`text\n${tc.expectedOutput}\n\`\`\``);
      }
    });
  }
  const testCasesMd = tcParts.length > 0 ? tcParts.join("\n\n") : "No visible test cases.";
  return `## Test Cases — ${title}\n\n${testCasesMd}`;
}

/**
 * Copies current live student code.
 * @param {import("../model/document.js").AssignmentDocument} doc
 * @returns {string}
 */
export function copyCurrentCode(doc) {
  if (!doc) return "";
  const pData = doc.questions?.[0]?.programmingData || {};
  return pData.currentCode || pData.starterCode || "";
}

/**
 * Copies the complete contextual AI prompt (Problem + Instructions + Starter Code + Test Cases + Return Instructions).
 * @param {import("../model/document.js").AssignmentDocument} doc
 * @param {object} [options]
 * @returns {string}
 */
export function copyAiContext(doc, options = {}) {
  return serializeProgrammingPrompt(doc, {
    includeInstructions: true,
    includeQuestion: true,
    includeImages: true,
    includeExamples: true,
    includeConstraints: true,
    includeTestCases: true,
    includeStarterCode: true,
    includePrefixCode: true,
    includeSuffixCode: true,
    includeCurrentCode: false,
    includeReturnInstructions: true,
    ...options,
  });
}

/**
 * Copies the complete assignment as Markdown.
 * @param {import("../model/document.js").AssignmentDocument} doc
 * @returns {string}
 */
export function copyFullAssignment(doc) {
  if (!doc) return "";
  const isProgramming =
    doc?.metadata?.family === AssessmentFamily.PROGRAMMING ||
    doc?.questions?.some((q) => q.type === QuestionType.PROGRAMMING || Boolean(q.programmingData));

  if (isProgramming) {
    return serializeProgrammingPrompt(doc, {
      includeInstructions: true,
      includeQuestion: true,
      includeImages: true,
      includeExamples: true,
      includeConstraints: true,
      includeTestCases: true,
      includeStarterCode: true,
      includePrefixCode: true,
      includeSuffixCode: true,
      includeCurrentCode: true,
      includeReturnInstructions: true,
    });
  }
  const exporter = new MarkdownExporter({ mode: "standard" });
  return exporter.exportDocument(doc);
}

/**
 * Formats a programming assignment into a clean prompt or contextual payload.
 * (Backwards compatibility wrapper around granular helpers and serializer)
 *
 * @param {import("../model/document.js").AssignmentDocument} programmingDoc
 * @param {object} [options]
 * @param {"full"|"problem"|"testcases"|"code"|"starter"|"prefix"|"suffix"} [options.mode="full"]
 * @returns {string} Formatted text
 */
export function formatProgrammingPrompt(programmingDoc, { mode = "full" } = {}) {
  if (!programmingDoc) return "";
  switch (mode) {
    case "problem":
      return copyQuestion(programmingDoc);
    case "testcases":
      return copyTestCases(programmingDoc);
    case "code":
      return copyCurrentCode(programmingDoc);
    case "starter":
      return copyStarterCode(programmingDoc);
    case "prefix":
      return copyPrefixCode(programmingDoc);
    case "suffix":
      return copySuffixCode(programmingDoc);
    case "full":
    default:
      return copyAiContext(programmingDoc);
  }
}

export { exportAssignmentToPrompt };

