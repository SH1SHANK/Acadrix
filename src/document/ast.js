/**
 * Canonical Document AST (Abstract Syntax Tree) for Acadrix.
 * 
 * Provides a rich, semantic, decoupled intermediate document representation
 * between raw assessment extraction and downstream compilation targets (PDF,
 * Markdown, Plaintext, Diagnostics, LLM Ingestion).
 * 
 * Complies with Section 5 of the Acadrix PDF Compilation Pipeline Specification.
 */

export const DocNodeType = Object.freeze({
  DOCUMENT: "document",
  METADATA: "metadata",
  QUESTION: "question",
  OPTION: "option",
  HEADING: "heading",
  PARAGRAPH: "paragraph",
  CODE: "code",
  TABLE: "table",
  TABLE_ROW: "table_row",
  TABLE_CELL: "table_cell",
  MATCHING: "matching",
  LIST: "list",
  LIST_ITEM: "list_item",
  MATH: "math",
  IMAGE: "image",
  FIGURE: "figure",
  SVG: "svg",
  CALLOUT: "callout",
  PAGE_BREAK: "page_break",
  SPACER: "spacer",
  TEST_CASE: "test_case",
  PROGRAMMING: "programming",
  // Inlines
  INLINE_TEXT: "inline_text",
  INLINE_CODE: "inline_code",
  INLINE_MATH: "inline_math",
  INLINE_LINK: "inline_link",
  INLINE_BREAK: "inline_break",
});

export const QuestionKind = Object.freeze({
  MCQ: "MCQ",
  MSQ: "MSQ",
  NUMERICAL: "NUMERICAL",
  TEXT: "TEXT",
  DESCRIPTIVE: "DESCRIPTIVE",
  MATCHING: "MATCHING",
  PROGRAMMING: "PROGRAMMING",
  UNKNOWN: "UNKNOWN",
});

/**
 * Base Document AST Node.
 */
export class DocNode {
  constructor({ type, attributes = {}, provenance = null } = {}) {
    if (!type) throw new TypeError("DocNode requires a type");
    this.type = type;
    this.attributes = attributes ? { ...attributes } : {};
    this.provenance = provenance ? { ...provenance } : null;
  }
}

/**
 * Root Document AST Node.
 */
export class DocRoot extends DocNode {
  constructor({
    metadata = {},
    blocks = [],
    diagnostics = null,
    provenance = null,
  } = {}) {
    super({ type: DocNodeType.DOCUMENT, provenance });
    this.metadata = metadata instanceof MetadataBlock ? metadata : new MetadataBlock(metadata);
    this.blocks = Array.isArray(blocks) ? blocks : [];
    this.diagnostics = diagnostics || {
      expectedQuestions: 0,
      extractedQuestions: 0,
      renderedQuestions: 0,
      warnings: [],
      questions: {},
    };
  }

  get questions() {
    return this.blocks.filter((b) => b instanceof QuestionBlock || b.type === DocNodeType.QUESTION);
  }

  addBlock(block) {
    if (block) this.blocks.push(block);
  }
}

/**
 * Document-level Metadata Block.
 */
export class MetadataBlock extends DocNode {
  constructor({
    title = "IITM Assessment",
    course = "",
    week = "",
    totalQuestions = 0,
    totalMarks = null,
    timestamp = new Date().toISOString(),
    url = "",
    term = "",
    assignmentKind = "",
    attributes = {},
    provenance = null,
  } = {}) {
    super({ type: DocNodeType.METADATA, attributes, provenance });
    this.title = title;
    this.course = course;
    this.week = week;
    this.totalQuestions = totalQuestions;
    this.totalMarks = totalMarks;
    this.timestamp = timestamp;
    this.url = url;
    this.term = term;
    this.assignmentKind = assignmentKind;
  }
}

/**
 * Semantic Question Block.
 */
export class QuestionBlock extends DocNode {
  constructor({
    number = 1,
    label = "",
    kind = QuestionKind.UNKNOWN,
    marks = null,
    negativeMarks = null,
    stem = [],
    options = [],
    matching = null,
    status = { answered: false, flagged: false },
    review = null,
    metadata = {},
    provenance = null,
  } = {}) {
    super({ type: DocNodeType.QUESTION, attributes: metadata, provenance });
    this.number = number;
    this.label = label || `Question ${number}`;
    this.kind = kind;
    this.marks = marks;
    this.negativeMarks = negativeMarks;
    this.stem = Array.isArray(stem) ? stem : [];
    this.options = Array.isArray(options) ? options : [];
    this.matching = matching instanceof MatchingBlock ? matching : (matching ? new MatchingBlock(matching) : null);
    this.status = status ? { ...status } : { answered: false, flagged: false };
    this.review = review ? { ...review } : null;
  }
}

/**
 * Option Block for choice questions.
 */
export class OptionBlock extends DocNode {
  constructor({
    id = "",
    letter = "",
    content = [],
    selected = false,
    isCorrect = null,
    feedback = null,
    provenance = null,
  } = {}) {
    super({ type: DocNodeType.OPTION, provenance });
    this.id = id;
    this.letter = letter;
    this.content = Array.isArray(content) ? content : (content ? [content] : []);
    this.selected = Boolean(selected);
    this.isCorrect = isCorrect;
    this.feedback = feedback;
  }
}

/**
 * Structured Test Case Block for Programming Assignments.
 */
export class TestCaseBlock extends DocNode {
  constructor({
    id = "",
    index = 1,
    input = "",
    expectedOutput = "",
    description = "",
    isSample = true,
    isVisible = true,
    provenance = null,
  } = {}) {
    super({ type: DocNodeType.TEST_CASE, provenance });
    this.id = id || `tc-${index}`;
    this.index = index;
    this.input = typeof input === "string" ? input : String(input || "");
    this.expectedOutput = typeof expectedOutput === "string" ? expectedOutput : String(expectedOutput || "");
    this.description = description || "";
    this.isSample = Boolean(isSample);
    this.isVisible = Boolean(isVisible);
  }
}

/**
 * First-Class Programming Assignment Block.
 */
export class ProgrammingAssignmentBlock extends DocNode {
  constructor({
    id = "",
    number = 1,
    label = "",
    marks = null,
    negativeMarks = null,
    language = "javascript",
    problem = [],
    images = [],
    testCases = [],
    starterCode = null,
    currentCode = "",
    capabilities = { canRun: true, canSubmit: true, hasSolution: false },
    context = {},
    provenance = null,
  } = {}) {
    super({ type: DocNodeType.PROGRAMMING, provenance });
    this.id = id;
    this.number = number;
    this.label = label || `Programming Assignment ${number}`;
    this.kind = QuestionKind.PROGRAMMING;
    this.marks = marks;
    this.negativeMarks = negativeMarks;
    this.language = (language || "javascript").toLowerCase().trim();
    this.problem = Array.isArray(problem) ? problem : [];
    this.images = Array.isArray(images) ? images : [];
    this.testCases = Array.isArray(testCases)
      ? testCases.map((tc, idx) => (tc instanceof TestCaseBlock ? tc : new TestCaseBlock({ index: idx + 1, ...tc })))
      : [];
    this.starterCode = starterCode !== undefined ? starterCode : null;
    this.currentCode = currentCode || "";
    this.capabilities = {
      canRun: capabilities?.canRun ?? true,
      canSubmit: capabilities?.canSubmit ?? true,
      hasSolution: capabilities?.hasSolution ?? false,
    };
    this.context = context || {};
  }
}
/**
 * Structured Two-Column Matching Block.
 */
export class MatchingBlock extends DocNode {
  constructor({
    leftTitle = "List I",
    rightTitle = "List II",
    pairs = [],
    provenance = null,
  } = {}) {
    super({ type: DocNodeType.MATCHING, provenance });
    this.leftTitle = leftTitle;
    this.rightTitle = rightTitle;
    this.pairs = Array.isArray(pairs) ? pairs : [];
  }
}

/**
 * Heading Block.
 */
export class HeadingBlock extends DocNode {
  constructor({ level = 1, text = "", inlines = [], provenance = null } = {}) {
    super({ type: DocNodeType.HEADING, provenance });
    this.level = Math.max(1, Math.min(6, parseInt(level, 10) || 1));
    this.text = text;
    this.inlines = Array.isArray(inlines) ? inlines : [];
  }
}

/**
 * Paragraph Block.
 */
export class ParagraphBlock extends DocNode {
  constructor({ text = "", inlines = [], provenance = null } = {}) {
    super({ type: DocNodeType.PARAGRAPH, provenance });
    this.text = text;
    this.inlines = Array.isArray(inlines) ? inlines : [];
  }
}

/**
 * First-Class Code Block.
 */
export class CodeBlock extends DocNode {
  constructor({
    language = "text",
    code = "",
    lineCount = 0,
    tokens = null,
    provenance = null,
  } = {}) {
    super({ type: DocNodeType.CODE, provenance });
    this.language = (language || "text").toLowerCase().trim();
    this.code = code || "";
    this.lineCount = lineCount || (code ? code.split("\n").length : 0);
    this.tokens = tokens; // Array of TokenLine or pre-tokenized runs
  }
}

/**
 * Table Block.
 */
export class TableBlock extends DocNode {
  constructor({
    caption = "",
    headerRows = 1,
    widths = null,
    rows = [],
    provenance = null,
  } = {}) {
    super({ type: DocNodeType.TABLE, provenance });
    this.caption = caption;
    this.headerRows = headerRows;
    this.widths = widths;
    this.rows = Array.isArray(rows) ? rows : [];
  }
}

/**
 * Table Row Block.
 */
export class TableRowBlock extends DocNode {
  constructor({ cells = [], provenance = null } = {}) {
    super({ type: DocNodeType.TABLE_ROW, provenance });
    this.cells = Array.isArray(cells) ? cells : [];
  }
}

/**
 * Table Cell Block.
 */
export class TableCellBlock extends DocNode {
  constructor({
    content = [],
    text = "",
    isHeader = false,
    colspan = 1,
    rowspan = 1,
    align = "left",
    provenance = null,
  } = {}) {
    super({ type: DocNodeType.TABLE_CELL, provenance });
    this.content = Array.isArray(content) ? content : (content ? [content] : []);
    this.text = text;
    this.isHeader = Boolean(isHeader);
    this.colspan = colspan || 1;
    this.rowspan = rowspan || 1;
    this.align = align || "left";
  }
}

/**
 * List Block.
 */
export class ListBlock extends DocNode {
  constructor({
    ordered = false,
    start = 1,
    items = [],
    provenance = null,
  } = {}) {
    super({ type: DocNodeType.LIST, provenance });
    this.ordered = Boolean(ordered);
    this.start = start || 1;
    this.items = Array.isArray(items) ? items : [];
  }
}

/**
 * List Item Block.
 */
export class ListItemBlock extends DocNode {
  constructor({
    text = "",
    inlines = [],
    children = [],
    provenance = null,
  } = {}) {
    super({ type: DocNodeType.LIST_ITEM, provenance });
    this.text = text;
    this.inlines = Array.isArray(inlines) ? inlines : [];
    this.children = Array.isArray(children) ? children : [];
  }
}

/**
 * Mathematical Block (Display Math).
 */
export class MathBlock extends DocNode {
  constructor({
    tex = "",
    mathml = "",
    display = false,
    fallbackText = "",
    provenance = null,
  } = {}) {
    super({ type: DocNodeType.MATH, provenance });
    this.tex = tex;
    this.mathml = mathml;
    this.display = Boolean(display);
    this.fallbackText = fallbackText;
  }
}

/**
 * Image Block.
 */
export class ImageBlock extends DocNode {
  constructor({
    src = "",
    dataUrl = "",
    alt = "",
    caption = "",
    width = null,
    height = null,
    provenance = null,
  } = {}) {
    super({ type: DocNodeType.IMAGE, provenance });
    this.src = src;
    this.dataUrl = dataUrl;
    this.alt = alt;
    this.caption = caption;
    this.width = width;
    this.height = height;
  }
}

/**
 * SVG Block.
 */
export class FigureBlock extends DocNode {
  constructor({ children = [], caption = "", provenance = null } = {}) {
    super({ type: DocNodeType.FIGURE, provenance });
    this.children = Array.isArray(children) ? children : [];
    this.caption = caption;
  }
}

/**
 * SVG Block.
 */
export class SvgBlock extends DocNode {
  constructor({
    svg = "",
    caption = "",
    width = null,
    height = null,
    provenance = null,
  } = {}) {
    super({ type: DocNodeType.SVG, provenance });
    this.svg = svg;
    this.caption = caption;
    this.width = width;
    this.height = height;
  }
}

/**
 * Callout / Admonition Block.
 */
export class CalloutBlock extends DocNode {
  constructor({
    kind = "info",
    title = "",
    body = [],
    provenance = null,
  } = {}) {
    super({ type: DocNodeType.CALLOUT, provenance });
    this.kind = kind; // 'info' | 'warning' | 'note'
    this.title = title;
    this.body = Array.isArray(body) ? body : [];
  }
}

/**
 * Explicit Page Break Block.
 */
export class PageBreakBlock extends DocNode {
  constructor({ provenance = null } = {}) {
    super({ type: DocNodeType.PAGE_BREAK, provenance });
  }
}

/**
 * Typographic Spacer Block.
 */
export class SpacerBlock extends DocNode {
  constructor({ height = 8, provenance = null } = {}) {
    super({ type: DocNodeType.SPACER, provenance });
    this.height = height;
  }
}

// ── Inline Nodes ─────────────────────────────────────────────────────────────

export class InlineText extends DocNode {
  constructor({
    text = "",
    bold = false,
    italic = false,
    underline = false,
    strike = false,
    sub = false,
    sup = false,
    provenance = null,
  } = {}) {
    super({ type: DocNodeType.INLINE_TEXT, provenance });
    this.text = text;
    this.bold = Boolean(bold);
    this.italic = Boolean(italic);
    this.underline = Boolean(underline);
    this.strike = Boolean(strike);
    this.sub = Boolean(sub);
    this.sup = Boolean(sup);
  }
}

export class InlineCode extends DocNode {
  constructor({ code = "", provenance = null } = {}) {
    super({ type: DocNodeType.INLINE_CODE, provenance });
    this.code = code;
  }
}

export class InlineMath extends DocNode {
  constructor({
    tex = "",
    mathml = "",
    text = "",
    provenance = null,
  } = {}) {
    super({ type: DocNodeType.INLINE_MATH, provenance });
    this.tex = tex;
    this.mathml = mathml;
    this.text = text;
  }
}

export class InlineLink extends DocNode {
  constructor({
    text = "",
    url = "",
    children = [],
    provenance = null,
  } = {}) {
    super({ type: DocNodeType.INLINE_LINK, provenance });
    this.text = text;
    this.url = url;
    this.children = Array.isArray(children) ? children : [];
  }
}

export class InlineBreak extends DocNode {
  constructor({ provenance = null } = {}) {
    super({ type: DocNodeType.INLINE_BREAK, provenance });
  }
}
