/**
 * Structured Error Taxonomy for the IITM Assessment and Programming Assignment Pipeline.
 * Complies with Section 36 of the Programming Assignment Pipeline Specification.
 */

export class AcadrixPipelineError extends Error {
  constructor(message, { code = "PIPELINE_ERROR", context = {}, cause = null } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.context = context;
    if (cause) this.cause = cause;
  }
}

export class AssessmentNotDetectedError extends AcadrixPipelineError {
  constructor(message = "No valid assessment or programming assignment was detected in the active DOM.", context = {}) {
    super(message, { code: "ASSESSMENT_NOT_DETECTED", context });
  }
}

export class UnsupportedAssessmentStateError extends AcadrixPipelineError {
  constructor(message = "The portal is in an unsupported or uninitialized assessment state.", context = {}) {
    super(message, { code: "UNSUPPORTED_ASSESSMENT_STATE", context });
  }
}

export class InstructionsExtractionError extends AcadrixPipelineError {
  constructor(message = "Failed to extract assignment instructions from the portal.", context = {}) {
    super(message, { code: "INSTRUCTIONS_EXTRACTION_ERROR", context });
  }
}

export class QuestionNavigationError extends AcadrixPipelineError {
  constructor(message = "Failed to navigate to the target question.", context = {}) {
    super(message, { code: "QUESTION_NAVIGATION_ERROR", context });
  }
}

export class QuestionReadinessError extends AcadrixPipelineError {
  constructor(message = "Question failed structural readiness validation within the timeout period.", context = {}) {
    super(message, { code: "QUESTION_READINESS_ERROR", context });
  }
}

export class QuestionExtractionError extends AcadrixPipelineError {
  constructor(message = "Failed to extract question semantic content.", context = {}) {
    super(message, { code: "QUESTION_EXTRACTION_ERROR", context });
  }
}

export class TestCasesExtractionError extends AcadrixPipelineError {
  constructor(message = "Failed to extract test cases from the Test Cases tab.", context = {}) {
    super(message, { code: "TEST_CASES_EXTRACTION_ERROR", context });
  }
}

export class LanguageDetectionError extends AcadrixPipelineError {
  constructor(message = "Failed to detect active programming language from editor or dropdown.", context = {}) {
    super(message, { code: "LANGUAGE_DETECTION_ERROR", context });
  }
}

export class UnsupportedLanguageError extends AcadrixPipelineError {
  constructor(message = "The detected programming language is unsupported.", context = {}) {
    super(message, { code: "UNSUPPORTED_LANGUAGE", context });
  }
}

export class LanguageMismatchError extends AcadrixPipelineError {
  constructor(message = "The imported code language does not match the assignment language.", context = {}) {
    super(message, { code: "LANGUAGE_MISMATCH", context });
  }
}

export class EditorNotReadyError extends AcadrixPipelineError {
  constructor(message = "Ace editor is not ready or active session is unavailable.", context = {}) {
    super(message, { code: "EDITOR_NOT_READY", context });
  }
}

export class EditorBoundaryError extends AcadrixPipelineError {
  constructor(message = "Protected editor region resolution failed or markers are ambiguous.", context = {}) {
    super(message, { code: "EDITOR_BOUNDARY_ERROR", context });
  }
}

export class EditorIdentityChangedError extends AcadrixPipelineError {
  constructor(message = "Editor instance was replaced during the operation.", context = {}) {
    super(message, { code: "EDITOR_IDENTITY_CHANGED", context });
  }
}

export class QuestionIdentityChangedError extends AcadrixPipelineError {
  constructor(message = "Logical question identity changed during the operation.", context = {}) {
    super(message, { code: "QUESTION_IDENTITY_CHANGED", context });
  }
}

export class EditorWriteVerificationError extends AcadrixPipelineError {
  constructor(message = "Editor code write verification failed after mutation.", context = {}) {
    super(message, { code: "EDITOR_WRITE_VERIFICATION_FAILED", context });
  }
}

export class TraversalIncompleteError extends AcadrixPipelineError {
  constructor(message = "Question traversal completed partially or missed expected questions.", context = {}) {
    super(message, { code: "TRAVERSAL_INCOMPLETE", context });
  }
}

export class StateRestorationError extends AcadrixPipelineError {
  constructor(message = "Failed to restore user's initial location and active tab after traversal.", context = {}) {
    super(message, { code: "STATE_RESTORATION_ERROR", context });
  }
}
