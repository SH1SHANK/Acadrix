/**
 * Types and Enums for the Canonical Assignment Document Model.
 * Establishes the contract for all extraction and export layers.
 */

export const AssessmentFamily = Object.freeze({
  STANDARD: "standard",
  PROGRAMMING: "programming",
});

export const QuestionType = Object.freeze({
  MCQ: "single_choice",
  MSQ: "multiple_choice",
  NUMERICAL: "numerical",
  TEXT: "text",
  DESCRIPTIVE: "descriptive",
  MATCHING: "matching",
  PROGRAMMING: "programming",
  UNKNOWN: "unknown",
});

export const ContentType = Object.freeze({
  PARAGRAPH: "paragraph",
  HEADING: "heading",
  LIST: "list",
  LIST_ITEM: "list_item",
  BLOCKQUOTE: "blockquote",
  CODE_BLOCK: "code_block",
  INLINE_CODE: "inline_code",
  MATH: "math",
  TABLE: "table",
  TABLE_ROW: "table_row",
  TABLE_CELL: "table_cell",
  FIGURE: "figure",
  IMAGE: "image",
  SVG: "svg",
  LINK: "link",
  LINE_BREAK: "line_break",
  TEXT: "text",
  CODE: "code", // Retained for backwards compatibility
  HTML_BLOCK: "html_block", // Retained for backwards compatibility
  CALLOUT: "callout",
  MATCHING: "matching",
  TEST_CASE: "test_case",
  PAGE_BREAK: "page_break",
  SPACER: "spacer",
});
export const MathType = Object.freeze({
  INLINE: "inline",
  DISPLAY: "display",
});

export const MathFormat = Object.freeze({
  TEX: "tex",
  MATHML: "mathml",
  TEXT: "text",
});
