/**
 * Academic PDF Compilation & Layout Engine.
 * 
 * Transforms a normalized Document AST (DocRoot) into a deterministic,
 * publication-grade pdfmake document definition and compiles it into binary PDF.
 * 
 * Complies with Acadrix DESIGN.md §7 and Sections 10-16 of the PDF Compilation Specification:
 * - A4 geometry with academic margins [36, 44, 36, 44].
 * - Subtle running headers (Course · Week · Assessment | Page X of Y).
 * - Running footers with timestamp and Acadrix LLM-ready provenance.
 * - Outlines / Bookmarks for instant question-by-question navigation.
 * - Monospaced, token-highlighted code blocks preserving exact indentation.
 * - Structured two-column matching question tables.
 * - Intelligent page-breaking (keepWithHeader, unbreakable question stems).
 */

import { DocNodeType, QuestionKind } from "./ast.js";
import { CODE_COLORS } from "./tokenizer.js";
import { setupPdfMakeFonts } from "./fonts.js";
// Acadrix Design System Tokens (from DESIGN.md)
export const ACX_THEME = Object.freeze({
  INK_900: "#16181D",
  INK_600: "#5B606B",
  INK_500: "#6B707B",
  ACCENT: "#2F4BDB",
  ACCENT_SUBTLE: "#F0F3FF",
  ACCENT_BORDER: "#C4CFFF",
  BORDER: "#E4E4DF",
  BORDER_STRONG: "#CFCFC8",
  SURFACE: "#FFFFFF",
  SUNKEN: "#F6F6F4",
  CODE_BG: "#F8F9FA",
  SUCCESS: "#1A7F4B",
  SUCCESS_BG: "#EAF5EF",
  WARNING: "#9A6700",
  ERROR: "#C62828",
});

let pdfMakeInstance = null;

/**
 * Resolves or initializes pdfMake in either browser or Node.js runtime.
 */
export async function resolvePdfMake() {
  let instance = null;
  if (typeof globalThis !== "undefined" && globalThis.pdfMake) {
    instance = globalThis.pdfMake;
  } else if (typeof window !== "undefined" && window.pdfMake) {
    instance = window.pdfMake;
  }
  if (!instance && !pdfMakeInstance) {
    try {
      const pm = await import("pdfmake/build/pdfmake.js");
      const pf = await import("pdfmake/build/vfs_fonts.js");
      instance = pm.default || pm;
      const fonts = pf.default || pf;
      if (instance && fonts) {
        instance.addVirtualFileSystem(fonts);
      }
      pdfMakeInstance = instance;
    } catch (err) {
      console.warn("[Acadrix] Could not load pdfmake dynamically in current environment:", err.message);
    }
  } else if (instance) {
    pdfMakeInstance = instance;
  }

  if (pdfMakeInstance) {
    await setupPdfMakeFonts(pdfMakeInstance);
  }

  return pdfMakeInstance;
}

/**
 * Compiles a Document AST (DocRoot) into a pdfmake document definition.
 * 
 * @param {DocRoot} docRoot
 * @param {Object} [options]
 * @returns {Object} pdfmake document definition
 */
export function compilePdfDefinition(docRoot, options = {}) {
  const meta = docRoot.metadata || {};
  const docTitle = meta.title || "Academic Assessment";
  const courseStr = meta.course ? meta.course.toUpperCase() : "";
  const weekStr = meta.week ? `WEEK ${meta.week}` : "";
  const headerContext = [courseStr, weekStr, docTitle].filter(Boolean).join("  ·  ");

  const content = [];

  // 1. Assessment Cover / Header Block
  if (options.includeHeader !== false) {
    content.push(createDocumentHeader(meta, options));
  }

  // 2. Question Blocks
  const questions = docRoot.questions;
  for (let idx = 0; idx < questions.length; idx++) {
    const q = questions[idx];
    const isLast = idx === questions.length - 1;
    content.push(createQuestionDefinition(q, isLast, options, idx));
  }

  // 3. pdfmake Document Definition Object
  return {
    pageSize: "A4",
    pageOrientation: "portrait",
    pageMargins: [36, 46, 36, 46],

    // Running Header (pages > 1)
    header: function (currentPage, pageCount) {
      if (currentPage === 1) return null;
      return {
        margin: [36, 20, 36, 0],
        columns: [
          {
            text: headerContext,
            fontSize: 7.5,
            color: ACX_THEME.INK_600,
            bold: true,
            characterSpacing: 0.5,
          },
          {
            text: `PAGE ${currentPage} OF ${pageCount}`,
            fontSize: 7.5,
            color: ACX_THEME.INK_500,
            font: "JetBrainsMono",
            alignment: "right",
          },
        ],
      };
    },

    // Running Footer
    footer: function (currentPage, pageCount) {
      return {
        margin: [36, 0, 36, 20],
        columns: [
          {
            text: "Acadrix Academic Assessment  ·  LLM-Ready Document",
            fontSize: 7,
            color: ACX_THEME.INK_500,
          },
          {
            text: `${currentPage} / ${pageCount}`,
            fontSize: 7,
            color: ACX_THEME.INK_500,
            alignment: "right",
            font: "JetBrainsMono",
          },
        ],
      };
    },

    content,

    defaultStyle: {
      font: "Roboto",
      fontSize: 9,
      lineHeight: 1.35,
      color: ACX_THEME.INK_900,
    },

    styles: {
      docTitle: {
        fontSize: 16,
        bold: true,
        color: ACX_THEME.INK_900,
        margin: [0, 0, 0, 6],
      },
      questionTitle: {
        fontSize: 11,
        bold: true,
        color: ACX_THEME.INK_900,
      },
      badge: {
        fontSize: 7.5,
        bold: true,
      },
      tableHeader: {
        fontSize: 8,
        bold: true,
        color: ACX_THEME.INK_900,
        fillColor: ACX_THEME.SUNKEN,
      },
      codeBlock: {
        font: "JetBrainsMono",
        fontSize: 8,
        lineHeight: 1.25,
      },
    },
  };
}

/**
 * Creates the top-level document cover/header section.
 */
function createDocumentHeader(meta, options) {
  const title = options.title || meta.title || "IITM Assessment";
  const badges = [];

  if (meta.course) {
    badges.push(createBadge("COURSE", meta.course, ACX_THEME.ACCENT));
  }
  if (meta.week) {
    badges.push(createBadge("WEEK", meta.week, ACX_THEME.INK_600));
  }
  if (meta.totalQuestions) {
    badges.push(createBadge("QUESTIONS", String(meta.totalQuestions), ACX_THEME.INK_600));
  }
  if (meta.totalMarks !== null && meta.totalMarks !== undefined) {
    badges.push(createBadge("MARKS", String(meta.totalMarks), ACX_THEME.INK_600));
  }

  return {
    margin: [0, 0, 0, 16],
    stack: [
      { text: title, style: "docTitle" },
      badges.length > 0 ? { columns: badges, columnGap: 6, margin: [0, 4, 0, 10] } : null,
      {
        canvas: [
          {
            type: "line",
            x1: 0,
            y1: 0,
            x2: 523, // 595.28 - 2*36
            y2: 0,
            lineWidth: 1,
            lineColor: ACX_THEME.BORDER,
          },
        ],
        margin: [0, 2, 0, 12],
      },
    ].filter(Boolean),
  };
}

function createBadge(label, val, color) {
  return {
    width: "auto",
    table: {
      body: [
        [
          {
            text: [
              { text: `${label}: `, color: ACX_THEME.INK_500, fontSize: 7, bold: true },
              { text: val, color: ACX_THEME.INK_900, fontSize: 7.5, bold: true },
            ],
            fillColor: ACX_THEME.SUNKEN,
            margin: [4, 2, 4, 2],
          },
        ],
      ],
    },
    layout: {
      hLineWidth: () => 1,
      vLineWidth: () => 1,
      hLineColor: () => ACX_THEME.BORDER,
      vLineColor: () => ACX_THEME.BORDER,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
  };
}

/**
 * Creates the definition for a single question.
 */
function createQuestionDefinition(q, isLast, options, idx = 0) {
  const parts = [];

  // Question header + badges
  const kindLabel = q.kind && q.kind !== QuestionKind.UNKNOWN ? q.kind : "QUESTION";
  const marksLabel = q.marks !== null && q.marks !== undefined ? `${q.marks} Mark${q.marks === 1 ? "" : "s"}` : "";
  const metaLabel = [kindLabel, marksLabel].filter(Boolean).join("  ·  ");

  const headerStack = [
    {
      columns: [
        {
          text: `Question ${q.number}`,
          style: "questionTitle",
          width: "*",
          outline: true, // Native PDF bookmark outline!
          id: `q-${q.number}-${idx}`,
        },
        {
          text: metaLabel,
          fontSize: 8,
          bold: true,
          color: ACX_THEME.ACCENT,
          alignment: "right",
          width: "auto",
          margin: [0, 2, 0, 0],
        },
      ],
      margin: [0, 0, 0, 6],
    },
  ];

  // If question stem has an initial paragraph, include it in the unbreakable header stack
  // so the title is NEVER orphaned at page bottom!
  const stemBlocks = q.stem || [];
  let remainingStem = stemBlocks;

  if (stemBlocks.length > 0 && stemBlocks[0].type === DocNodeType.PARAGRAPH) {
    headerStack.push(renderBlock(stemBlocks[0], options));
    remainingStem = stemBlocks.slice(1);
  }

  parts.push({
    unbreakable: true,
    stack: headerStack,
  });

  // Remaining stem blocks
  for (const block of remainingStem) {
    parts.push(renderBlock(block, options));
  }

  // Options
  if (Array.isArray(q.options) && q.options.length > 0) {
    parts.push(renderOptions(q.options, options));
  }

  // Divider between questions
  if (!isLast) {
    parts.push({
      canvas: [
        {
          type: "line",
          x1: 0,
          y1: 0,
          x2: 523,
          y2: 0,
          lineWidth: 0.5,
          lineColor: ACX_THEME.BORDER,
        },
      ],
      margin: [0, 10, 0, 12],
    });
  }

  return {
    margin: [0, 4, 0, isLast ? 8 : 4],
    stack: parts,
  };
}

/**
 * Renders an individual DocNode block.
 */
function renderBlock(block, options) {
  if (!block) return { text: "" };

  switch (block.type) {
    case DocNodeType.PARAGRAPH:
      return renderParagraph(block, options);

    case DocNodeType.HEADING:
      return {
        text: block.text || "",
        fontSize: block.level === 1 ? 12 : block.level === 2 ? 10.5 : 9.5,
        bold: true,
        color: ACX_THEME.INK_900,
        margin: [0, 4, 0, 3],
      };

    case DocNodeType.CODE:
      return renderCodeBlock(block);

    case DocNodeType.MATCHING:
      return renderMatchingTable(block);

    case DocNodeType.TABLE:
      return renderTable(block);

    case DocNodeType.LIST:
      return renderList(block);

    case DocNodeType.MATH:
      return renderMathBlock(block);

    case DocNodeType.IMAGE:
      return renderImageBlock(block, options);

    case DocNodeType.FIGURE: {
      const stack = block.children.map((child) => renderBlock(child, options));
      if (block.caption) {
        stack.push({ text: block.caption, italics: true, fontSize: 8, color: ACX_THEME.INK_600, alignment: "center" });
      }
      return { stack, margin: [0, 4, 0, 6] };
    }

    case DocNodeType.SVG:
      return renderSvgBlock(block);

    case DocNodeType.CALLOUT:
      return {
        table: {
          widths: ["*"],
          body: [
            [
              {
                stack: [
                  block.title ? { text: block.title, bold: true, fontSize: 8.5, margin: [0, 0, 0, 2] } : null,
                  ...block.body.map((b) => renderBlock(b, options)),
                ].filter(Boolean),
                fillColor: ACX_THEME.SUNKEN,
                margin: [8, 6, 8, 6],
              },
            ],
          ],
        },
        layout: "noBorders",
        margin: [0, 4, 0, 6],
      };

    case DocNodeType.PAGE_BREAK:
      return { text: "", pageBreak: "before" };

    case DocNodeType.SPACER:
      return { text: "", margin: [0, block.height || 4, 0, 0] };

    default:
      return { text: block.text || block.value || "", margin: [0, 2, 0, 2] };
  }
}

function renderParagraph(p, options = {}) {
  if (Array.isArray(p.inlines) && p.inlines.some((inline) => inline?.type === DocNodeType.IMAGE)) {
    const stack = [];
    let textRuns = [];
    const flushText = () => {
      if (textRuns.length === 0) return;
      stack.push({ text: textRuns, margin: [0, 2, 0, 4] });
      textRuns = [];
    };
    for (const inline of p.inlines) {
      if (inline?.type === DocNodeType.IMAGE) {
        flushText();
        stack.push(renderImageBlock(inline, options));
      } else {
        textRuns.push(renderInline(inline));
      }
    }
    flushText();
    return { stack, margin: [0, 2, 0, 4] };
  }

  if (Array.isArray(p.inlines) && p.inlines.length > 0) {
    // Direct string emission if single plain inline text
    if (p.inlines.length === 1 && p.inlines[0].type === DocNodeType.INLINE_TEXT) {
      const inl = p.inlines[0];
      if (!inl.bold && !inl.italic && !inl.underline && !inl.strike && !inl.sub && !inl.sup) {
        return {
          text: inl.text || "",
          margin: [0, 2, 0, 4],
        };
      }
    }

    const inlineTexts = p.inlines.map((inl) => renderInline(inl));
    return {
      text: inlineTexts,
      margin: [0, 2, 0, 4],
    };
  }
  return {
    text: p.text || "",
    margin: [0, 2, 0, 4],
  };
}

function renderInline(inl) {
  if (!inl) return "";
  switch (inl.type) {
    case DocNodeType.INLINE_CODE:
      return {
        text: inl.code || "",
        font: "JetBrainsMono",
        fontSize: 8,
        color: ACX_THEME.ACCENT,
      };

    case DocNodeType.INLINE_MATH:
      return {
        text: inl.text || inl.tex || "",
        italics: true,
      };

    case DocNodeType.INLINE_LINK:
      return {
        text: inl.text || "",
        color: ACX_THEME.ACCENT,
        decoration: "underline",
        link: inl.url,
      };

    case DocNodeType.INLINE_BREAK:
      return "\n";

    default: {
      return {
        text: inl.text || "",
        bold: Boolean(inl.bold),
        italics: Boolean(inl.italic),
        decoration: inl.underline ? "underline" : inl.strike ? "lineThrough" : undefined,
      };
    }
  }
}

/**
 * Renders a monospaced code block with syntax highlighted tokens.
 */
function renderCodeBlock(codeBlock) {
  const tokenLines = codeBlock.tokens || [];
  const textRuns = [];

  for (let lineIdx = 0; lineIdx < tokenLines.length; lineIdx++) {
    const lineTokens = tokenLines[lineIdx];
    for (const tok of lineTokens) {
      if (!tok.text) continue;
      const prev = textRuns.length > 0 ? textRuns[textRuns.length - 1] : null;
      const tokColor = tok.color || ACX_THEME.INK_900;
      const tokBold = Boolean(tok.bold);

      // Merge with previous token if color and bold match
      if (
        prev &&
        (prev.color || ACX_THEME.INK_900) === tokColor &&
        Boolean(prev.bold) === tokBold
      ) {
        prev.text += tok.text;
      } else {
        const run = { text: tok.text };
        if (tokColor !== ACX_THEME.INK_900) {
          run.color = tokColor;
        }
        if (tokBold) {
          run.bold = true;
        }
        textRuns.push(run);
      }
    }
    if (lineIdx < tokenLines.length - 1) {
      if (textRuns.length > 0) {
        textRuns[textRuns.length - 1].text += "\n";
      } else {
        textRuns.push({ text: "\n" });
      }
    }
  }

  const content = textRuns.length > 0 ? textRuns : [{ text: codeBlock.code || "" }];

  return {
    margin: [0, 4, 0, 6],
    table: {
      widths: ["*"],
      body: [
        [
          {
            text: content,
            style: "codeBlock",
            fillColor: ACX_THEME.CODE_BG,
            margin: [8, 6, 8, 6],
          },
        ],
      ],
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => ACX_THEME.BORDER,
      vLineColor: () => ACX_THEME.BORDER,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
  };
}

/**
 * Renders a structured two-column matching question table.
 */
function renderMatchingTable(matching) {
  const headerRow = [
    { text: matching.leftTitle || "List I", style: "tableHeader", margin: [6, 4, 6, 4] },
    { text: matching.rightTitle || "List II", style: "tableHeader", margin: [6, 4, 6, 4] },
  ];

  const bodyRows = [headerRow];

  for (const pair of matching.pairs || []) {
    bodyRows.push([
      {
        text: [
          { text: `${pair.leftMarker}. `, bold: true, color: ACX_THEME.ACCENT },
          { text: pair.leftText },
        ],
        margin: [6, 4, 6, 4],
      },
      {
        text: [
          { text: `${pair.rightMarker}. `, bold: true, color: ACX_THEME.ACCENT },
          { text: pair.rightText },
        ],
        margin: [6, 4, 6, 4],
      },
    ]);
  }

  return {
    margin: [0, 4, 0, 8],
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths: ["38%", "62%"],
      body: bodyRows,
    },
    layout: {
      hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length ? 1 : 0.5),
      vLineWidth: () => 0,
      hLineColor: () => ACX_THEME.BORDER,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
  };
}

/**
 * Renders a standard table.
 */
function renderTable(tableBlock) {
  const rows = tableBlock.rows || [];
  if (rows.length === 0) return { text: "" };

  const bodyRows = [];
  const colCount = Math.max(...rows.map((r) => r.cells.length), 1);
  const widths = tableBlock.widths || Array(colCount).fill("*");

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const row = rows[rIdx];
    const cells = row.cells.map((c) => {
      const isH = c.isHeader || rIdx === 0;
      return {
        text: c.text || "",
        bold: isH,
        fillColor: isH ? ACX_THEME.SUNKEN : undefined,
        alignment: c.align || "left",
        colSpan: c.colspan || 1,
        rowSpan: c.rowspan || 1,
        margin: [4, 3, 4, 3],
        fontSize: 8,
      };
    });
    bodyRows.push(cells);
  }

  return {
    margin: [0, 4, 0, 6],
    table: {
      headerRows: tableBlock.headerRows || 1,
      dontBreakRows: true,
      widths,
      body: bodyRows,
    },
    layout: {
      hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length ? 1 : 0.5),
      vLineWidth: () => 0.5,
      hLineColor: () => ACX_THEME.BORDER,
      vLineColor: () => ACX_THEME.BORDER,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
  };
}

function renderList(listBlock) {
  const items = (listBlock.items || []).map((item, idx) => {
    const marker = listBlock.ordered ? `${(listBlock.start || 1) + idx}. ` : "• ";
    return {
      columns: [
        { text: marker, width: 14, color: ACX_THEME.INK_500, bold: true },
        { text: item.text || "", width: "*" },
      ],
      margin: [0, 1, 0, 2],
    };
  });

  return {
    margin: [8, 2, 0, 4],
    stack: items,
  };
}

function renderMathBlock(mathBlock) {
  const textVal = mathBlock.tex || mathBlock.fallbackText || "";
  return {
    text: textVal,
    alignment: mathBlock.display ? "center" : "left",
    italics: true,
    margin: mathBlock.display ? [0, 4, 0, 6] : [0, 1, 0, 1],
  };
}

function renderImageBlock(imgBlock, options) {
  const src = imgBlock.dataUrl || imgBlock.src;
  const image = typeof src === "string" && src.startsWith("data:image/")
    ? {
        image: src,
        width: Math.min(imgBlock.width || 360, 480),
        alignment: "center",
        margin: [0, 4, 0, 6],
      }
    : {
        table: {
          widths: ["*"],
          body: [[{
            text: [
              { text: "[Figure: ", bold: true, color: ACX_THEME.INK_600 },
              { text: imgBlock.alt || imgBlock.caption || "Image Asset", color: ACX_THEME.INK_900 },
              { text: "]" },
            ],
            alignment: "center",
            fillColor: ACX_THEME.SUNKEN,
            margin: [8, 10, 8, 10],
          }]],
        },
        layout: "noBorders",
        margin: [0, 4, 0, 6],
      };

  if (!imgBlock.caption) return image;
  return {
    stack: [image, { text: imgBlock.caption, italics: true, fontSize: 8, color: ACX_THEME.INK_600, alignment: "center" }],
    margin: [0, 4, 0, 6],
  };
}

function renderSvgBlock(svgBlock) {
  if (!svgBlock.svg || typeof svgBlock.svg !== "string" || !svgBlock.svg.includes("<svg")) {
    return { text: "" };
  }
  try {
    return {
      svg: svgBlock.svg,
      width: Math.min(svgBlock.width || 360, 480),
      alignment: "center",
      margin: [0, 4, 0, 6],
    };
  } catch {
    return {
      text: svgBlock.caption ? `[Diagram: ${svgBlock.caption}]` : "[Vector Graphic]",
      italics: true,
      color: ACX_THEME.INK_500,
      alignment: "center",
      margin: [0, 4, 0, 6],
    };
  }
}

/**
 * Renders multiple choice options in clean academic cards.
 */
function renderOptions(options, renderOpts) {
  const optionRows = [];

  for (const opt of options) {
    const optParts = [];
    if (Array.isArray(opt.content) && opt.content.length > 0) {
      for (const b of opt.content) {
        optParts.push(renderBlock(b, renderOpts));
      }
    } else {
      optParts.push({ text: opt.text || "", fontSize: 8.5 });
    }

    optionRows.push({
      columns: [
        {
          width: 18,
          table: {
            body: [
              [
                {
                  text: opt.letter,
                  bold: true,
                  fontSize: 7.5,
                  alignment: "center",
                  color: opt.selected ? ACX_THEME.ACCENT : ACX_THEME.INK_900,
                  fillColor: opt.selected ? ACX_THEME.ACCENT_SUBTLE : ACX_THEME.SUNKEN,
                  margin: [0, 2, 0, 2],
                },
              ],
            ],
          },
          layout: {
            hLineWidth: () => 1,
            vLineWidth: () => 1,
            hLineColor: () => (opt.selected ? ACX_THEME.ACCENT_BORDER : ACX_THEME.BORDER),
            vLineColor: () => (opt.selected ? ACX_THEME.ACCENT_BORDER : ACX_THEME.BORDER),
            paddingLeft: () => 0,
            paddingRight: () => 0,
            paddingTop: () => 0,
            paddingBottom: () => 0,
          },
        },
        {
          width: "*",
          stack: optParts,
          margin: [4, 1, 0, 0],
        },
      ],
      margin: [0, 2, 0, 3],
    });
  }

  return {
    margin: [0, 4, 0, 4],
    dontBreakRows: true,
    stack: optionRows,
  };
}

/**
 * Top-Level PDF Compilation Entry Point.
 * 
 * Takes a DocRoot AST (or AssignmentDocument), compiles it via pdfmake,
 * and returns the generated PDF bytes (Uint8Array / Buffer).
 * 
 * @param {DocRoot|AssignmentDocument} document
 * @param {Object} [options]
 * @returns {Promise<Uint8Array>}
 */
export function applyResolvedImageDataUrls(docRoot, resourceMap) {
  if (!resourceMap || !docRoot) return;
  const seen = new Set();
  const resolve = (source) => {
    if (resourceMap instanceof Map) return resourceMap.get(source);
    return typeof resourceMap === "object" ? resourceMap[source] : undefined;
  };
  const visit = (value) => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (value.type === DocNodeType.IMAGE && !value.dataUrl) {
      const resolved = resolve(value.src);
      if (typeof resolved === "string" && resolved.startsWith("data:image/")) {
        value.dataUrl = resolved;
      }
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  };
  visit(docRoot);
}

export async function compilePdfDocument(docInput, options = {}) {
  const pm = await resolvePdfMake();
  if (!pm) {
    throw new Error("pdfmake library is not available in current environment.");
  }

  // If input is not already DocRoot, normalize it
  let docRoot = docInput;
  if (!docRoot || docRoot.type !== DocNodeType.DOCUMENT) {
    const { normalizeDocument } = await import("./normalizer.js");
    docRoot = normalizeDocument(docInput, options);
  }

  applyResolvedImageDataUrls(docRoot, options.resourceMap);
  const docDefinition = compilePdfDefinition(docRoot, options);
  const pdfDoc = pm.createPdf(docDefinition);

  return new Promise((resolve, reject) => {
    try {
      if (typeof pdfDoc.getBuffer === "function") {
        pdfDoc.getBuffer().then(
          (buf) => resolve(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)),
          (err) => reject(err)
        );
      } else if (typeof pdfDoc.getBase64 === "function") {
        pdfDoc.getBase64((b64) => {
          const binStr = atob(b64);
          const bytes = new Uint8Array(binStr.length);
          for (let i = 0; i < binStr.length; i++) {
            bytes[i] = binStr.charCodeAt(i);
          }
          resolve(bytes);
        });
      } else {
        reject(new Error("pdfDoc has neither getBuffer nor getBase64 method."));
      }
    } catch (err) {
      reject(err);
    }
  });
}
