/**
 * Academic Assessment Normalization Pipeline.
 * 
 * Bridges raw extraction and canonical document AST:
 * - Detects and eliminates line-number gutter artifacts (e.g. 12345678910111213).
 * - Identifies tables misused as code layout and reconstructs clean, indented code blocks.
 * - Detects matching questions and structures them into clean two-column MatchingBlocks.
 * - Accurately classifies question semantics (MCQ, MSQ, NUMERICAL, TEXT, DESCRIPTIVE, MATCHING).
 * - Normalizes options, code formatting, math representations, and Unicode typography.
 * - Tracks diagnostics without altering source academic meaning.
 */

import { QuestionType, ContentType, MathType, MathFormat } from "../model/types.js";
import {
  DocNodeType,
  QuestionKind,
  DocRoot,
  MetadataBlock,
  QuestionBlock,
  OptionBlock,
  MatchingBlock,
  HeadingBlock,
  ParagraphBlock,
  CodeBlock,
  TableBlock,
  TableRowBlock,
  TableCellBlock,
  ListBlock,
  ListItemBlock,
  MathBlock,
  ImageBlock,
  FigureBlock,
  SvgBlock,
  CalloutBlock,
  PageBreakBlock,
  SpacerBlock,
  InlineText,
  InlineCode,
  InlineMath,
  InlineLink,
  InlineBreak,
} from "./ast.js";
import { tokenizeCode } from "./tokenizer.js";
import { normalizeProgrammingLanguage } from "../bridge/languages.js";

// HTML Entity Decoding
const HTML_ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&ndash;": "–",
  "&mdash;": "—",
  "&hellip;": "…",
  "&times;": "×",
  "&divide;": "÷",
};

export function decodeHtmlEntities(str) {
  if (typeof str !== "string") return "";
  return str.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp|ndash|mdash|hellip|times|divide);/g, (match) => {
    return HTML_ENTITIES[match] || match;
  });
}

/**
 * Normalizes unicode spaces and cleans invisible characters.
 */
export function normalizeUnicodeText(text) {
  if (typeof text !== "string") return "";
  return decodeHtmlEntities(text)
    .replace(/[\u200B-\u200D\uFEFF]/g, "") // Strip zero-width characters
    .replace(/\u00A0/g, " "); // Non-breaking space to regular space
}

/**
 * Detects if a text string is a concatenated line-number gutter artifact.
 * Example: "12345678910111213" or "1 2 3 4 5 6 7 8 9 10 11 12 13"
 */
export function isLineNumberGutter(text) {
  if (!text || typeof text !== "string") return false;
  const clean = text.trim();
  // Sequential concatenated numbers: 123456789101112...
  if (/^123456789(?:10)?(?:11)?(?:12)?(?:13)?(?:14)?(?:15)?(?:16)?(?:17)?(?:18)?(?:19)?(?:20)?/.test(clean)) {
    return true;
  }
  // Space/newline separated sequential numbers: 1 2 3 4 5...
  const tokens = clean.split(/\s+/);
  if (tokens.length >= 3 && tokens.every((t, i) => String(i + 1) === t)) {
    return true;
  }
  return false;
}

/**
 * Heuristically infers programming language from code content if unspecified.
 */
export function inferCodeLanguage(code) {
  if (!code || typeof code !== "string") return "text";
  const trimmed = code.trim();

  // Python indicators
  if (
    /^(?:import\s+\w+|from\s+\w+\s+import|def\s+\w+\s*\(|class\s+\w+(?:\(.*\))?:)/m.test(trimmed) ||
    /\bprint\s*\(/.test(trimmed) ||
    /:\s*$\n\s+(?:return|if|for|while|pass|print)/m.test(trimmed) ||
    /\bself\.\w+/.test(trimmed)
  ) {
    return "python";
  }

  // Java indicators
  if (
    /\b(?:public|private|protected)\s+(?:static\s+)?(?:void|class|int|String|boolean|double)\b/.test(trimmed) ||
    /\bSystem\.out\.print(?:ln)?\s*\(/.test(trimmed)
  ) {
    return "java";
  }

  // C / C++ indicators
  if (
    /#include\s+[<"]\w+(?:\.\w+)?[>"]/.test(trimmed) ||
    /\bint\s+main\s*\(/.test(trimmed) ||
    /\bprintf\s*\(/.test(trimmed) ||
    /\bstd::/.test(trimmed) ||
    /\bcout\s*<</.test(trimmed)
  ) {
    return "cpp";
  }

  // SQL indicators
  if (/^\s*(?:SELECT|INSERT|UPDATE|DELETE|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/i.test(trimmed)) {
    return "sql";
  }

  // JS/TS indicators
  if (
    /\b(?:const|let|var)\s+\w+\s*=/.test(trimmed) ||
    /\bfunction\s*\w*\s*\(/.test(trimmed) ||
    /=>\s*\{/.test(trimmed) ||
    /\bconsole\.log\s*\(/.test(trimmed)
  ) {
    return "javascript";
  }

  return "text";
}

/**
 * Checks if a table was used purely as a code block layout container.
 * Returns reconstructed code string if true, null otherwise.
 */
export function tryExtractCodeFromTable(tableNode) {
  if (!tableNode || !Array.isArray(tableNode.children) || tableNode.children.length === 0) {
    return null;
  }

  const rows = tableNode.children;

  // Case 1: 2-column table where Column 0 is sequential line numbers (1, 2, 3...)
  // and Column 1 contains code statements
  const hasLineNumCol = rows.every((row, idx) => {
    const cells = row.children || [];
    if (cells.length < 2) return false;
    const col0Text = (cells[0].value || "").trim();
    return col0Text === String(idx + 1);
  });

  if (hasLineNumCol && rows.length >= 2) {
    const codeLines = rows.map((row) => {
      const cells = row.children || [];
      return cells[1] ? (cells[1].value || "") : "";
    });
    return codeLines.join("\n");
  }

  // Case 2: Broken code table where cells contain fragmented Python/Java code
  // e.g. | obj1 | = Demo("IITM") |
  // or | def | __init__(self, str): |
  const allCellTexts = [];
  let codeIndicatorScore = 0;

  for (const row of rows) {
    const rowTexts = (row.children || []).map((c) => (c.value || "").trim());
    const rowCombined = rowTexts.join(" ");
    allCellTexts.push(rowCombined);

    if (
      /\b(?:def|class|return|self|__init__|print|obj1|obj2|Demo|=|\(|\))\b/.test(rowCombined) ||
      /\b(?:public|private|static|void|int|System\.out)\b/.test(rowCombined)
    ) {
      codeIndicatorScore += 1;
    }
  }

  // If majority of rows look like code statements
  if (rows.length >= 2 && codeIndicatorScore >= rows.length * 0.6) {
    return allCellTexts.join("\n");
  }

  return null;
}

/**
 * Detects if a question is a matching question and extracts two columns.
 */
export function tryExtractMatchingQuestion(stemNodes, options) {
  // Check if options are match assignments, e.g. "A-II, B-I, C-IV, D-III"
  let optionsAreMatching = false;
  if (Array.isArray(options) && options.length >= 2) {
    const sampleOpt = options[0];
    const optText = sampleOpt.content
      ? sampleOpt.content.map((c) => c.value || "").join(" ")
      : String(sampleOpt.letter || "");
    if (/[A-D]\s*[-–—:]\s*(?:[I|V|X]+|\d)/i.test(optText) && /,\s*[A-D]\s*[-–—:]/i.test(optText)) {
      optionsAreMatching = true;
    }
  }

  // Find stem text lines that look like:
  // "A. Control Link I. Region of the program..."
  // or "A. Control Link \t I. Region..."
  // or separate items with A., B., C., D. and I., II., III., IV.
  const fullStemText = stemNodes
    .map((n) => n.value || "")
    .join("\n");

  const hasMatchHeading = /match\s+(?:the\s+following|the\s+columns|each\s+item|the\s+abstract)/i.test(fullStemText);

  if (!optionsAreMatching && !hasMatchHeading) {
    return null;
  }

  // Parse lines to extract matching pairs
  // Pattern 1: Combined line e.g. "A. Control Link I. Region of the program where a variable..."
  // or "A. Control Link    I. Pointer to..."
  const pairRegex = /^\s*([A-D])[\.:\)]\s+(.+?)\s+([I|V|X]+|\d+)[\.:\)]\s+(.+)$/im;
  const lines = fullStemText.split("\n");
  const extractedPairs = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(pairRegex);
    if (match) {
      extractedPairs.push({
        leftMarker: match[1].toUpperCase(),
        leftText: match[2].trim(),
        rightMarker: match[3].toUpperCase(),
        rightText: match[4].trim(),
      });
    }
  }

  if (extractedPairs.length >= 2) {
    return new MatchingBlock({
      leftTitle: "List I",
      rightTitle: "List II",
      pairs: extractedPairs,
    });
  }

  // Pattern 2: Two separate lists in the text or table
  // e.g. List 1: A. ..., B. ... and List 2: I. ..., II. ...
  const leftItems = [];
  const rightItems = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const leftMatch = trimmed.match(/^([A-D])[\.:\)]\s+(.+)$/);
    if (leftMatch) {
      leftItems.push({ marker: leftMatch[1].toUpperCase(), text: leftMatch[2].trim() });
      continue;
    }
    const rightMatch = trimmed.match(/^([I|V|X]+|\d+)[\.:\)]\s+(.+)$/);
    if (rightMatch) {
      rightItems.push({ marker: rightMatch[1].toUpperCase(), text: rightMatch[2].trim() });
      continue;
    }
  }

  if (leftItems.length >= 2 && rightItems.length >= 2 && leftItems.length === rightItems.length) {
    const pairs = leftItems.map((left, idx) => ({
      leftMarker: left.marker,
      leftText: left.text,
      rightMarker: rightItems[idx].marker,
      rightText: rightItems[idx].text,
    }));
    return new MatchingBlock({
      leftTitle: "List I",
      rightTitle: "List II",
      pairs,
    });
  }

  return null;
}

/**
 * Converts a canonical ContentNode into a DocNode AST block or inline.
 */
export function transformContentNode(node, diagnostics) {
  if (!node) return null;

  switch (node.type) {
    case ContentType.HEADING: {
      const level = node.attributes?.level || 2;
      const inlines = transformInlineNodes(node.children || [], diagnostics);
      const text = normalizeUnicodeText(node.value || "");
      return new HeadingBlock({ level, text, inlines });
    }

    case ContentType.PARAGRAPH: {
      const inlines = transformInlineNodes(node.children || [], diagnostics);
      const text = normalizeUnicodeText(node.value || "");
      return new ParagraphBlock({ text, inlines });
    }

    case ContentType.CODE_BLOCK:
    case ContentType.CODE: {
      const rawCode = node.value ?? "";
      let lang = (node.attributes?.language || "text").toLowerCase().trim();
      if (lang === "text" || !lang) {
        lang = inferCodeLanguage(rawCode);
      }
      const tokens = tokenizeCode(rawCode, lang);
      return new CodeBlock({
        language: lang,
        code: rawCode,
        lineCount: rawCode ? rawCode.split("\n").length : 0,
        tokens,
      });
    }

    case ContentType.TABLE: {
      // Check if table is actually code layout
      const reconstructedCode = tryExtractCodeFromTable(node);
      if (reconstructedCode) {
        const lang = inferCodeLanguage(reconstructedCode);
        const tokens = tokenizeCode(reconstructedCode, lang);
        diagnostics.warnings.push("Reconstructed code block from table layout");
        return new CodeBlock({
          language: lang,
          code: reconstructedCode,
          tokens,
        });
      }

      const rows = (node.children || []).map((rowNode) => {
        const cells = (rowNode.children || []).map((cellNode) => {
          const cellContent = (cellNode.children || []).length > 0
            ? transformInlineNodes(cellNode.children, diagnostics)
            : [];
          return new TableCellBlock({
            text: normalizeUnicodeText(cellNode.value || ""),
            content: cellContent,
            isHeader: Boolean(cellNode.attributes?.isHeader),
            colspan: cellNode.attributes?.colspan || 1,
            rowspan: cellNode.attributes?.rowspan || 1,
            align: cellNode.attributes?.align || "left",
          });
        });
        return new TableRowBlock({ cells });
      });

      return new TableBlock({
        caption: normalizeUnicodeText(node.attributes?.caption || ""),
        headerRows: 1,
        rows,
      });
    }

    case ContentType.MATCHING: {
      return new MatchingBlock({
        leftTitle: node.attributes?.leftTitle || "List I",
        rightTitle: node.attributes?.rightTitle || "List II",
        pairs: node.attributes?.pairs || [],
      });
    }

    case ContentType.LIST: {
      const items = (node.children || []).map((itemNode) => {
        const inlines = transformInlineNodes(itemNode.children || [], diagnostics);
        return new ListItemBlock({
          text: normalizeUnicodeText(itemNode.value || ""),
          inlines,
        });
      });
      return new ListBlock({
        ordered: Boolean(node.attributes?.ordered),
        start: node.attributes?.start || 1,
        items,
      });
    }

    case ContentType.MATH: {
      const tex = node.value || "";
      const mathml = node.attributes?.mathml || "";
      const display = node.attributes?.mathType === MathType.DISPLAY;
      return new MathBlock({
        tex,
        mathml,
        display,
        fallbackText: tex,
      });
    }

    case ContentType.IMAGE: {
      return new ImageBlock({
        src: node.attributes?.src || node.value || "",
        alt: normalizeUnicodeText(node.attributes?.alt || ""),
        caption: normalizeUnicodeText(node.attributes?.caption || ""),
        width: node.attributes?.width || null,
        height: node.attributes?.height || null,
      });
    }

    case ContentType.FIGURE: {
      return new FigureBlock({
        children: (node.children || []).map((child) => transformContentNode(child, diagnostics)).filter(Boolean),
        caption: normalizeUnicodeText(node.attributes?.caption || ""),
      });
    }

    case ContentType.SVG: {
      const source = node.attributes?.src || node.attributes?.url || "";
      if (source) {
        return new ImageBlock({
          src: source,
          alt: normalizeUnicodeText(node.attributes?.title || node.attributes?.caption || "Diagram"),
          caption: normalizeUnicodeText(node.attributes?.caption || ""),
          width: node.attributes?.width || null,
          height: node.attributes?.height || null,
        });
      }
      return new SvgBlock({
        svg: node.value || "",
        caption: normalizeUnicodeText(node.attributes?.caption || ""),
        width: node.attributes?.width || null,
        height: node.attributes?.height || null,
      });
    }

    case ContentType.CALLOUT: {
      const body = (node.children || []).map((c) => transformContentNode(c, diagnostics)).filter(Boolean);
      return new CalloutBlock({
        kind: node.attributes?.kind || "info",
        title: normalizeUnicodeText(node.attributes?.title || ""),
        body,
      });
    }

    case ContentType.PAGE_BREAK:
      return new PageBreakBlock();

    case ContentType.SPACER:
      return new SpacerBlock({ height: node.attributes?.height || 8 });

    default: {
      // Fallback: wrap value as paragraph
      const text = normalizeUnicodeText(node.value || "");
      if (text.trim().length > 0) {
        return new ParagraphBlock({ text });
      }
      return null;
    }
  }
}

/**
 * Transforms an array of inline ContentNodes into Document AST Inlines.
 */
export function transformInlineNodes(nodes, diagnostics) {
  if (!Array.isArray(nodes)) return [];
  const inlines = [];

  for (const n of nodes) {
    if (!n) continue;

    if (n.type === ContentType.INLINE_CODE) {
      inlines.push(new InlineCode({ code: n.value || "" }));
    } else if (n.type === ContentType.MATH) {
      inlines.push(
        new InlineMath({
          tex: n.value || "",
          mathml: n.attributes?.mathml || "",
          text: n.value || "",
        })
      );
    } else if (n.type === ContentType.LINK) {
      inlines.push(
        new InlineLink({
          text: normalizeUnicodeText(n.value || ""),
          url: n.attributes?.href || "",
        })
      );
    } else if (n.type === ContentType.IMAGE) {
      inlines.push(new ImageBlock({
        src: n.attributes?.src || n.value || "",
        alt: normalizeUnicodeText(n.attributes?.alt || ""),
        caption: normalizeUnicodeText(n.attributes?.caption || ""),
        width: n.attributes?.width || null,
        height: n.attributes?.height || null,
      }));
    } else if (n.type === ContentType.LINE_BREAK) {
      inlines.push(new InlineBreak());
    } else {
      // Plain text or formatted text
      const attrs = n.attributes || {};
      const text = normalizeUnicodeText(n.value || "");
      if (!text) continue;

      const bold = Boolean(attrs.bold);
      const italic = Boolean(attrs.italic);
      const underline = Boolean(attrs.underline);
      const strike = Boolean(attrs.strike);
      const sub = Boolean(attrs.sub);
      const sup = Boolean(attrs.sup);

      // Merge with previous InlineText if formatting matches identically
      const prev = inlines.length > 0 ? inlines[inlines.length - 1] : null;
      if (
        prev &&
        prev instanceof InlineText &&
        prev.bold === bold &&
        prev.italic === italic &&
        prev.underline === underline &&
        prev.strike === strike &&
        prev.sub === sub &&
        prev.sup === sup
      ) {
        prev.text += text;
      } else {
        inlines.push(
          new InlineText({
            text,
            bold,
            italic,
            underline,
            strike,
            sub,
            sup,
          })
        );
      }
    }
  }

  return inlines;
}

/**
 * Classifies the semantic question kind.
 */
export function classifyQuestionKind(questionNode, matchingBlock) {
  if (matchingBlock) {
    return QuestionKind.MATCHING;
  }

  const rawType = questionNode.type || "";
  if (rawType === QuestionType.PROGRAMMING || rawType === "programming" || questionNode.programmingData) {
    return QuestionKind.PROGRAMMING;
  }
  if (rawType === QuestionType.MSQ || rawType === "multiple_choice") {
    return QuestionKind.MSQ;
  }
  if (rawType === QuestionType.NUMERICAL || rawType === "numerical") {
    return QuestionKind.NUMERICAL;
  }
  if (rawType === QuestionType.DESCRIPTIVE || rawType === "descriptive") {
    return QuestionKind.DESCRIPTIVE;
  }
  if (rawType === QuestionType.TEXT || rawType === "text") {
    return QuestionKind.TEXT;
  }
  if (rawType === QuestionType.MCQ || rawType === "single_choice") {
    return QuestionKind.MCQ;
  }
  // Fallback: examine options
  const opts = questionNode.options || [];
  if (opts.length > 0) {
    return QuestionKind.MCQ;
  }

  return QuestionKind.UNKNOWN;
}

/**
 * Normalizes an OptionNode into an OptionBlock.
 */
export function normalizeOption(optNode, index, diagnostics) {
  const letters = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
  const letter = (optNode.letter || letters[index] || String(index + 1)).toUpperCase().trim();

  let contentBlocks = [];
  if (Array.isArray(optNode.content) && optNode.content.length > 0) {
    contentBlocks = optNode.content
      .map((c) => transformContentNode(c, diagnostics))
      .filter(Boolean);
  } else if (optNode.value) {
    contentBlocks = [new ParagraphBlock({ text: normalizeUnicodeText(optNode.value) })];
  }

  return new OptionBlock({
    id: optNode.id || `opt-${letter}`,
    letter,
    content: contentBlocks,
    selected: Boolean(optNode.selected),
    isCorrect: optNode.isCorrect,
    feedback: optNode.feedback,
  });
}

/**
 * Normalizes question stem content nodes, stripping line-number gutter artifacts
 * and restructuring matching sections where applicable.
 */
export function normalizeStemNodes(stemNodes, matchingBlock, diagnostics) {
  if (!Array.isArray(stemNodes)) return [];

  const normalized = [];
  const len = stemNodes.length;

  for (let i = 0; i < len; i++) {
    const node = stemNodes[i];
    if (!node) continue;

    // Check if this node is a concatenated line number gutter preceding a code block
    if (
      (node.type === ContentType.PARAGRAPH || node.type === ContentType.TEXT) &&
      isLineNumberGutter(node.value)
    ) {
      const nextNode = i + 1 < len ? stemNodes[i + 1] : null;
      if (nextNode && (nextNode.type === ContentType.CODE_BLOCK || nextNode.type === ContentType.CODE)) {
        diagnostics.warnings.push("Stripped line-number gutter artifact preceding code block");
        continue; // Drop line number gutter
      }
    }

    const transformed = transformContentNode(node, diagnostics);
    if (transformed) {
      normalized.push(transformed);
    }
  }

  // If a structured matching block was extracted, replace text-based matching lines with the table
  if (matchingBlock) {
    const matchIdx = normalized.findIndex((b) => {
      if (b instanceof ParagraphBlock && b.text) {
        return matchingBlock.pairs.some((p) => b.text.includes(p.leftText));
      }
      return false;
    });

    if (matchIdx !== -1) {
      normalized.splice(matchIdx, 1, matchingBlock);
    } else {
      normalized.push(matchingBlock);
    }
  }
  return normalized;
}

/**
 * Top-Level Normalization Pipeline.
 * 
 * Transforms an AssignmentDocument into a validated, canonical DocRoot AST.
 * 
 * @param {Object} assignmentDoc Canonical AssignmentDocument
 * @param {Object} [options]
 * @returns {DocRoot}
 */
export function normalizeDocument(assignmentDoc, options = {}) {
  if (!assignmentDoc) {
    throw new TypeError("AssignmentDocument is required for normalization.");
  }

  const rawMeta = assignmentDoc.metadata || {};
  const rawQuestions = Array.isArray(assignmentDoc.questions) ? assignmentDoc.questions : [];

  const diagnostics = {
    expectedQuestions: rawMeta.totalQuestions || rawQuestions.length,
    extractedQuestions: rawQuestions.length,
    renderedQuestions: 0,
    warnings: [],
    questions: {},
  };

  // 1. Normalize Document Metadata
  const title = (options.title || rawMeta.title || assignmentDoc.title || "IITM Assessment").trim();
  const course = (rawMeta.course || "").trim();
  const week = (rawMeta.week || "").trim();
  const totalMarks = rawMeta.totalMarks ?? null;
  const timestamp = rawMeta.timestamp || new Date().toISOString();
  const url = rawMeta.url || "";

  const metadataBlock = new MetadataBlock({
    title: normalizeUnicodeText(title),
    course: normalizeUnicodeText(course),
    week: normalizeUnicodeText(week),
    totalQuestions: rawQuestions.length,
    totalMarks,
    timestamp,
    url,
  });

  // 2. Normalize Questions
  const questionBlocks = [];

  for (let idx = 0; idx < rawQuestions.length; idx++) {
    const q = rawQuestions[idx];
    const qNum = q.number !== undefined && q.number !== null ? q.number : idx + 1;
    const qDiagnostics = { warnings: [] };

    // Check for matching question structure
    const matchingBlock = tryExtractMatchingQuestion(q.stem || [], q.options || []);
    const kind = classifyQuestionKind(q, matchingBlock);

    // Normalize stem blocks
    const normalizedStem = normalizeStemNodes(q.stem || [], matchingBlock, qDiagnostics);

    // If programming assignment, append test cases and code blocks to stem
    if (kind === QuestionKind.PROGRAMMING || q.programmingData) {
      const pData = q.programmingData || {};
      const rawLang = pData.language || "javascript";
      const lang = normalizeProgrammingLanguage(rawLang) || rawLang;

      if (Array.isArray(pData.testCases) && pData.testCases.length > 0) {
        normalizedStem.push(new HeadingBlock({ level: 3, text: "Test Cases" }));
        const tcRows = [
          new TableRowBlock({
            cells: [
              new TableCellBlock({ text: "Test Case", isHeader: true }),
              new TableCellBlock({ text: "Input", isHeader: true }),
              new TableCellBlock({ text: "Expected Output", isHeader: true }),
            ],
          }),
        ];

        for (const tc of pData.testCases) {
          const desc = tc.description || `Case ${tc.index}`;
          tcRows.push(
            new TableRowBlock({
              cells: [
                new TableCellBlock({ text: desc }),
                new TableCellBlock({ text: tc.input || "" }),
                new TableCellBlock({ text: tc.expectedOutput || "" }),
              ],
            })
          );
        }

        normalizedStem.push(
          new TableBlock({
            caption: "Visible Test Cases",
            headerRows: 1,
            widths: ["24%", "38%", "38%"],
            rows: tcRows,
          })
        );
      }

      if (pData.currentCode || pData.starterCode) {
        const code = pData.currentCode || pData.starterCode;
        normalizedStem.push(new HeadingBlock({ level: 3, text: "Code" }));
        normalizedStem.push(
          new CodeBlock({
            language: lang,
            code,
            tokens: tokenizeCode(code, lang),
          })
        );
      }
    }

    // Normalize options
    const normalizedOptions = (q.options || []).map((opt, optIdx) =>
      normalizeOption(opt, optIdx, qDiagnostics)
    );
    const questionBlock = new QuestionBlock({
      number: qNum,
      label: q.label || `Question ${qNum}`,
      kind,
      marks: q.marks,
      negativeMarks: q.negativeMarks,
      stem: normalizedStem,
      options: normalizedOptions,
      matching: matchingBlock,
      status: q.status || { answered: false, flagged: false },
      review: q.review || null,
      metadata: q.metadata || {},
    });

    questionBlocks.push(questionBlock);

    if (qDiagnostics.warnings.length > 0) {
      diagnostics.questions[qNum] = qDiagnostics;
      diagnostics.warnings.push(...qDiagnostics.warnings.map((w) => `Q${qNum}: ${w}`));
    }
  }

  diagnostics.renderedQuestions = questionBlocks.length;

  return new DocRoot({
    metadata: metadataBlock,
    blocks: questionBlocks,
    diagnostics,
  });
}
