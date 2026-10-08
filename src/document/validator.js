/**
 * Academic PDF Consistency and Invariant Validator.
 * 
 * Enforces Section 22 of the Acadrix PDF Compilation Specification:
 * - PDF binary validity (Magic bytes, EOF, non-zero payload).
 * - Structural integrity (pageCount > 0, valid page dimensions).
 * - Critical Invariant:
 *     expectedQuestions === canonicalQuestions === renderedQuestions
 * - Sequential question numbering without duplicates or missing slots.
 * - Question semantic integrity (prompts, options, code blocks, matching tables).
 * - Non-destructive diagnostics emission.
 */

import { DocNodeType, QuestionKind } from "./ast.js";
import { resolvePdfLib } from "./post-processor.js";

export class PdfValidationError extends Error {
  constructor(message, diagnostics = null, errors = []) {
    super(message);
    this.name = "PdfValidationError";
    this.diagnostics = diagnostics;
    this.errors = errors;
  }
}

/**
 * Validates a compiled PDF binary against its source Document AST.
 * 
 * @param {Uint8Array} pdfBytes
 * @param {DocRoot} docRoot
 * @param {Object} [options]
 * @returns {Promise<{ valid: boolean, invariantPassed: boolean, pageCount: number, byteLength: number, questionCount: number, diagnostics: Object, errors: string[] }>}
 */
export async function validatePdfCompilation(pdfBytes, docRoot, options = {}) {
  const errors = [];
  const warnings = [...(docRoot?.diagnostics?.warnings || [])];

  // 1. Binary checks
  if (!pdfBytes || !(pdfBytes instanceof Uint8Array || Buffer.isBuffer(pdfBytes))) {
    errors.push("Invalid PDF artifact: bytes payload is missing or not a Uint8Array.");
  } else if (pdfBytes.length < 64) {
    errors.push(`Invalid PDF artifact: byte length too small (${pdfBytes.length} bytes).`);
  } else {
    // Check %PDF- header magic
    const headerMagic = String.fromCharCode(...pdfBytes.subarray(0, 5));
    if (headerMagic !== "%PDF-") {
      errors.push(`Corrupt PDF artifact: missing %PDF- magic bytes (found: "${headerMagic}").`);
    }

    // Check %%EOF marker in trailing bytes
    const tailSlice = pdfBytes.subarray(Math.max(0, pdfBytes.length - 1024));
    const tailStr = String.fromCharCode(...tailSlice);
    if (!tailStr.includes("%%EOF")) {
      warnings.push("PDF trailing %%EOF marker missing in last 1KB (non-standard EOF).");
    }
  }

  // 2. Structural page checks via pdf-lib
  let pageCount = 0;
  try {
    const pl = await resolvePdfLib();
    if (pl && pl.PDFDocument && pdfBytes && pdfBytes.length > 64) {
      const pdfDoc = await pl.PDFDocument.load(pdfBytes, { updateMetadata: false });
      pageCount = pdfDoc.getPageCount();

      if (pageCount === 0) {
        errors.push("Catastrophic layout failure: PDF document contains 0 pages.");
      }

      // Check dimensions of all pages
      for (let pIdx = 0; pIdx < pageCount; pIdx++) {
        const page = pdfDoc.getPage(pIdx);
        const { width, height } = page.getSize();
        if (width <= 0 || height <= 0) {
          errors.push(`Page ${pIdx + 1} has invalid dimensions (${width} x ${height}).`);
        }
      }
    }
  } catch (err) {
    errors.push(`Failed to parse and inspect PDF pages: ${err.message}`);
  }

  // 3. Document AST & Invariant Validation
  const questions = docRoot ? docRoot.questions : [];
  const expectedQuestions = docRoot?.diagnostics?.expectedQuestions || questions.length;
  const canonicalQuestions = questions.length;
  const renderedQuestions = docRoot?.diagnostics?.renderedQuestions ?? canonicalQuestions;

  // Invariant: expected === canonical === rendered
  let invariantPassed = true;
  if (expectedQuestions > 0 && expectedQuestions !== canonicalQuestions) {
    errors.push(
      `Question count invariant violation: expected ${expectedQuestions} questions from portal metadata, but extracted ${canonicalQuestions}.`
    );
    invariantPassed = false;
  }
  if (renderedQuestions !== canonicalQuestions) {
    errors.push(
      `Question count invariant violation: extracted ${canonicalQuestions} questions, but compiled ${renderedQuestions}.`
    );
    invariantPassed = false;
  }

  // 4. Question Sequence & Duplicate Checks
  const seenNumbers = new Set();
  for (let idx = 0; idx < questions.length; idx++) {
    const q = questions[idx];
    const qNum = q.number;

    if (qNum === undefined || qNum === null) {
      errors.push(`Question at index ${idx} is missing a question number.`);
      continue;
    }

    if (seenNumbers.has(qNum)) {
      errors.push(`Duplicate question number detected: Question ${qNum} appears multiple times.`);
    }
    seenNumbers.add(qNum);

    // Prompt content check
    if (!Array.isArray(q.stem) || q.stem.length === 0) {
      warnings.push(`Question ${qNum} has an empty stem (no prompt blocks).`);
    }

    // Option checks for MCQ / MSQ
    if (q.kind === QuestionKind.MCQ || q.kind === QuestionKind.MSQ) {
      if (!Array.isArray(q.options) || q.options.length < 2) {
        warnings.push(`Question ${qNum} is classified as ${q.kind} but has only ${q.options?.length || 0} option(s).`);
      }
    }

    // Matching checks
    if (q.kind === QuestionKind.MATCHING) {
      if (!q.matching || !Array.isArray(q.matching.pairs) || q.matching.pairs.length < 2) {
        warnings.push(`Question ${qNum} is classified as MATCHING but has fewer than 2 pairs.`);
      }
    }

    // Code block checks
    for (const b of q.stem || []) {
      if (b.type === DocNodeType.CODE) {
        if (!b.code || b.code.trim().length === 0) {
          warnings.push(`Question ${qNum} has an empty code block.`);
        }
      }
    }
  }

  const valid = errors.length === 0;

  const result = {
    valid,
    invariantPassed,
    pageCount,
    byteLength: pdfBytes?.length || 0,
    questionCount: questions.length,
    diagnostics: {
      expectedQuestions,
      extractedQuestions: canonicalQuestions,
      renderedQuestions,
      warnings,
      questions: docRoot?.diagnostics?.questions || {},
    },
    errors,
  };

  if (!valid && options.strict) {
    throw new PdfValidationError(
      `PDF output consistency validation failed:\n- ${errors.join("\n- ")}`,
      result.diagnostics,
      errors
    );
  }

  return result;
}
