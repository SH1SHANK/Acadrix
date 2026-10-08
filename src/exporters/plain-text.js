import { ContentType, QuestionType } from "../model/types.js";

function textForInline(node) {
  if (!node) return "";
  switch (node.type) {
    case ContentType.LINE_BREAK:
      return "\n";
    case ContentType.INLINE_CODE:
      return node.value || "";
    case ContentType.MATH:
      return node.value || node.attributes?.mathml || "";
    case ContentType.LINK: {
      const label = node.children?.length
        ? node.children.map(textForInline).join("")
        : node.value || "";
      const href = node.attributes?.href || "";
      return href && href !== label ? `${label} (${href})` : label || href;
    }
    case ContentType.IMAGE: {
      const alt = node.attributes?.alt || node.attributes?.title || "Image";
      const src = node.attributes?.src || "";
      return src ? `[Image: ${alt}] (${src})` : `[Image: ${alt}]`;
    }
    default:
      if (node.children?.length) return node.children.map(textForInline).join("");
      return node.value || "";
  }
}

function textForBlock(node, depth = 0) {
  if (!node) return "";
  const children = node.children || [];
  switch (node.type) {
    case ContentType.PARAGRAPH:
    case ContentType.HEADING:
      return children.length ? children.map(textForInline).join("") : node.value || "";
    case ContentType.TEXT:
    case ContentType.INLINE_CODE:
    case ContentType.CODE:
    case ContentType.CODE_BLOCK:
    case ContentType.MATH:
      return node.value || "";
    case ContentType.LINE_BREAK:
      return "\n";
    case ContentType.LIST: {
      const ordered = Boolean(node.attributes?.ordered);
      const start = Number(node.attributes?.start) || 1;
      return children.map((item, index) => {
        const marker = ordered ? `${start + index}.` : "-";
        const itemText = item.children?.length
          ? item.children.map((child) => textForBlock(child, depth + 1)).join("\n")
          : item.value || "";
        const lines = itemText.split("\n");
        return `${"  ".repeat(depth)}${marker} ${lines[0] || ""}${lines.slice(1).map((line) => `\n${"  ".repeat(depth + 1)}${line}`).join("")}`;
      }).join("\n");
    }
    case ContentType.LIST_ITEM:
    case ContentType.BLOCKQUOTE:
      return children.length ? children.map((child) => textForBlock(child, depth)).join("\n") : node.value || "";
    case ContentType.TABLE: {
      const rows = children.map((row) => (row.children || []).map((cell) => {
        return cell.children?.length ? cell.children.map(textForInline).join("") : cell.value || "";
      }).join(" | "));
      return [node.attributes?.caption, ...rows].filter(Boolean).join("\n");
    }
    case ContentType.FIGURE: {
      const body = children.map((child) => textForBlock(child, depth)).filter(Boolean);
      if (node.attributes?.caption) body.push(node.attributes.caption);
      return body.join("\n");
    }
    case ContentType.IMAGE:
    case ContentType.LINK:
      return textForInline(node);
    case ContentType.SVG: {
      const src = node.attributes?.src || node.attributes?.url || "";
      const title = node.attributes?.title || node.attributes?.caption || "Diagram";
      return src ? `[SVG: ${title}] (${src})` : node.value || `[SVG: ${title}]`;
    }
    case ContentType.CALLOUT:
      return [node.attributes?.title, ...children.map((child) => textForBlock(child, depth))].filter(Boolean).join("\n");
    case ContentType.HTML_BLOCK:
      return node.value || "";
    default:
      return children.length ? children.map((child) => textForBlock(child, depth)).join("\n") : node.value || "";
  }
}

/** Serialize an AssignmentDocument as readable plain text, without Markdown syntax. */
export function exportAssignmentToText(assignmentDoc) {
  if (!assignmentDoc || !Array.isArray(assignmentDoc.questions)) {
    throw new TypeError("AssignmentDocument with questions array is required for text export.");
  }

  const metadata = assignmentDoc.metadata || {};
  const sections = [];
  const header = [metadata.title || assignmentDoc.title || "Assignment"];
  if (metadata.course) header.push(`Course: ${metadata.course}`);
  if (metadata.week) header.push(metadata.week);
  sections.push(header.join("\n"));

  for (const question of assignmentDoc.questions) {
    const label = question.label || `Question ${question.number}`;
    const questionParts = [label];
    if (question.type) {
      const type = question.type === QuestionType.PROGRAMMING ? "Programming" : question.type;
      questionParts[0] = `${label} (${type})`;
    }
    if (question.marks !== null && question.marks !== undefined) {
      questionParts.push(`Marks: ${question.marks}`);
    }
    const stem = (question.stem || []).map((node) => textForBlock(node)).filter((text) => text !== "");
    if (stem.length) questionParts.push(stem.join("\n\n"));

    if (question.options?.length) {
      questionParts.push("Options:");
      question.options.forEach((option, index) => {
        const marker = option.letter || String.fromCharCode(65 + index);
        const content = option.content?.map(textForInline).join("") || option.value || "";
        questionParts.push(`${marker}. ${content}`);
      });
    }

    const programming = question.programmingData;
    if (programming) {
      if (programming.language) questionParts.push(`Language: ${programming.language}`);
      if (programming.testCases?.length) {
        questionParts.push("Test Cases:");
        programming.testCases.forEach((testCase, index) => {
          questionParts.push(`Case ${testCase.index || index + 1}${testCase.description ? ` (${testCase.description})` : ""}`);
          questionParts.push(`Input:\n${testCase.input || ""}`);
          questionParts.push(`Expected Output:\n${testCase.expectedOutput || ""}`);
        });
      }
      const code = programming.currentCode || programming.starterCode;
      if (code) questionParts.push(`Code:\n${code}`);
    }
    sections.push(questionParts.join("\n\n"));
  }

  const separator = "-".repeat(72);
  return `${sections.join(`\n\n${separator}\n\n`).trim()}\n`;
}
