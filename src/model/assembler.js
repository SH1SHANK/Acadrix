/**
 * Assignment Document Assembler.
 * 
 * Owns the dedicated responsibility of aggregating QuestionNode objects into
 * a canonical AssignmentDocument.
 * Decouples question traversal and extraction from document construction.
 */

import { AssignmentDocument } from "./document.js";

export class AssignmentAssembler {
  constructor(metadata = {}) {
    this.metadata = metadata;
    this.questions = [];
  }

  /**
   * Adds an extracted QuestionNode to the assembly pipeline.
   * @param {QuestionNode} questionNode
   */
  addQuestion(questionNode) {
    if (!questionNode) return;
    this.questions.push(questionNode);
  }

  /**
   * Finalizes and builds the immutable AssignmentDocument instance.
   * @returns {AssignmentDocument}
   */
  build() {
    return new AssignmentDocument({
      metadata: {
        ...this.metadata,
        totalQuestions: this.metadata.totalQuestions || this.questions.length,
      },
      questions: this.questions,
    });
  }
}
