/**
 * Acadrix AI Prompt Serializer.
 * Functional entry point for converting AssignmentDocuments into LLM-optimized prompts.
 */

import { MarkdownExporter, exportAssignmentToPrompt } from "../exporters/markdown.js";

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
 * @param {import("../model/document.js").AssignmentDocument} assignmentDoc
 * @param {Object} [options]
 * @param {Object} [options.scope] - { type: "all" } | { type: "range", start: number, end: number } | { type: "single", number: number }
 * @returns {{ prompt: string, tokenEstimate: number, figureQuestions: number[], questionCount: number }}
 */
export function generateAiPrompt(assignmentDoc, options = {}) {
  const exporter = new MarkdownExporter({
    mode: "prompt",
    scope: options.scope || null,
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

export { exportAssignmentToPrompt };
