/**
 * High-Fidelity Semantic DOM Walker.
 * 
 * Transforms arbitrary HTML/DOM nodes into a canonical ContentNode AST.
 * Handles headings, paragraphs, lists, code blocks, math (KaTeX/MathML),
 * tables, figures, images, SVGs, links, and inline text formatting.
 */

import { ContentType, MathType, MathFormat } from "../model/types.js";
import { ContentNode } from "../model/document.js";
import { sanitizeSvgSource, sanitizeMathML } from "../utils/dom.js";

const BLOCK_TAGS = new Set([
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "UL",
  "OL",
  "LI",
  "BLOCKQUOTE",
  "PRE",
  "TABLE",
  "FIGURE",
  "DIV",
  "SECTION",
  "ARTICLE",
  "FIELDSET",
  "FORM",
  "HEADER",
  "FOOTER",
  "ASIDE",
  "MAIN",
  "NAV",
]);

const INLINE_FORMAT_TAGS = {
  B: "bold",
  STRONG: "bold",
  I: "italic",
  EM: "italic",
  U: "underline",
  S: "strike",
  DEL: "strike",
  STRIKE: "strike",
  SUB: "sub",
  SUP: "sup",
};

export class SemanticWalker {
  constructor(options = {}) {
    this.options = {
      collapseWhitespace: true,
      trimStrings: true,
      ...options,
    };
  }

  /**
   * Main entry point: walks a DOM element/fragment and returns an AST with diagnostics.
   * @param {Element|Node} root
   * @returns {{ nodes: ContentNode[], diagnostics: Object }}
   */
  walk(root) {
    const diagnostics = {
      nodeCount: 0,
      mathCount: 0,
      codeBlockCount: 0,
      tableCount: 0,
      imageCount: 0,
      unhandledTags: [],
    };

    if (!root) {
      return { nodes: [], diagnostics };
    }

    const unhandledSet = new Set();
    const nodes = this.walkBlockContainer(root, diagnostics, unhandledSet);
    diagnostics.unhandledTags = Array.from(unhandledSet);
    diagnostics.nodeCount = this.countNodes(nodes);

    return { nodes, diagnostics };
  }

  /**
   * Recursively counts all ContentNode instances in a tree.
   */
  countNodes(nodes) {
    let count = 0;
    for (const node of nodes) {
      count += 1;
      if (node.children && node.children.length > 0) {
        count += this.countNodes(node.children);
      }
    }
    return count;
  }

  /**
   * Walks child nodes of a block-level container, grouping consecutive inline elements into PARAGRAPH nodes.
   */
  walkBlockContainer(container, diagnostics, unhandledSet) {
    const result = [];
    let inlineBuffer = [];

    const flushInlineBuffer = () => {
      if (inlineBuffer.length === 0) return;
      const inlineNodes = this.processInlineNodes(inlineBuffer, diagnostics, unhandledSet);
      inlineBuffer = [];

      // Check if inline nodes contain meaningful content
      if (inlineNodes.length > 0) {
        const textVal = inlineNodes.map((n) => n.value || "").join("");
        if (textVal.trim().length > 0 || inlineNodes.some((n) => n.type !== ContentType.TEXT)) {
          result.push(
            new ContentNode({
              type: ContentType.PARAGRAPH,
              value: textVal.trim(),
              children: inlineNodes,
            })
          );
        }
      }
    };

    const childNodes = Array.from(container.childNodes || []);

    for (const child of childNodes) {
      if (child.nodeType === 8 /* COMMENT_NODE */) {
        continue;
      }

      if (child.nodeType === 3 /* TEXT_NODE */) {
        inlineBuffer.push(child);
        continue;
      }

      if (child.nodeType === 1 /* ELEMENT_NODE */) {
        const tag = (child.tagName || "").toUpperCase();

        // Check if atomic block
        if (this.isAtomicMath(child)) {
          // If KaTeX display math, flush buffer and treat as block
          if (this.isDisplayMath(child)) {
            flushInlineBuffer();
            const mathNode = this.parseMath(child, diagnostics);
            result.push(mathNode);
          } else {
            // Inline math stays in inline buffer
            inlineBuffer.push(child);
          }
          continue;
        }

        if (tag === "PRE") {
          flushInlineBuffer();
          result.push(this.parseCodeBlock(child, diagnostics));
          continue;
        }

        if (tag === "TABLE") {
          flushInlineBuffer();
          result.push(this.parseTable(child, diagnostics, unhandledSet));
          continue;
        }

        if (tag === "FIGURE") {
          flushInlineBuffer();
          result.push(this.parseFigure(child, diagnostics, unhandledSet));
          continue;
        }

        if (tag === "IMG") {
          flushInlineBuffer();
          result.push(this.parseImage(child, diagnostics));
          continue;
        }

        if (tag === "UL" || tag === "OL") {
          flushInlineBuffer();
          result.push(this.parseList(child, diagnostics, unhandledSet));
          continue;
        }

        if (/^H[1-6]$/.test(tag)) {
          flushInlineBuffer();
          result.push(this.parseHeading(child, diagnostics, unhandledSet));
          continue;
        }

        if (tag === "BLOCKQUOTE") {
          flushInlineBuffer();
          result.push(this.parseBlockquote(child, diagnostics, unhandledSet));
          continue;
        }

        if (tag === "P") {
          flushInlineBuffer();
          const pNode = this.parseParagraph(child, diagnostics, unhandledSet);
          if (pNode) result.push(pNode);
          continue;
        }

        if (tag === "DIV" || tag === "SECTION" || tag === "ARTICLE" || tag === "FIELDSET") {
          // Check if contains nested block elements
          if (this.containsBlockElements(child)) {
            flushInlineBuffer();
            const innerBlocks = this.walkBlockContainer(child, diagnostics, unhandledSet);
            result.push(...innerBlocks);
          } else {
            // Contains only inline content -> treat as inline buffer or paragraph
            flushInlineBuffer();
            const pNode = this.parseParagraph(child, diagnostics, unhandledSet);
            if (pNode) result.push(pNode);
          }
          continue;
        }

        if (tag === "HR") {
          flushInlineBuffer();
          // Skip divider or treat as separator
          continue;
        }

        // Inline elements (e.g. span, strong, em, a, code, img, svg, br)
        inlineBuffer.push(child);
      }
    }

    flushInlineBuffer();
    return result;
  }

  /**
   * Determines whether an element has block-level descendants.
   */
  containsBlockElements(element) {
    if (!element) return false;
    if (element.querySelector) {
      try {
        if (element.querySelector("p, h1, h2, h3, h4, h5, h6, ul, ol, pre, table, figure, blockquote")) {
          return true;
        }
      } catch {
        // Fall through to traversal
      }
    }
    const childNodes = Array.from(element.childNodes || []);
    for (const child of childNodes) {
      if (child.nodeType === 1) {
        const tag = (child.tagName || "").toUpperCase();
        if (
          tag === "P" ||
          /^H[1-6]$/.test(tag) ||
          tag === "UL" ||
          tag === "OL" ||
          tag === "PRE" ||
          tag === "TABLE" ||
          tag === "FIGURE" ||
          tag === "BLOCKQUOTE" ||
          this.containsBlockElements(child)
        ) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Processes a sequence of DOM nodes into a list of inline ContentNodes.
   */
  processInlineNodes(nodes, diagnostics, unhandledSet, activeFormatting = {}) {
    const result = [];

    for (const node of nodes) {
      if (node.nodeType === 8 /* COMMENT */) continue;

      if (node.nodeType === 3 /* TEXT_NODE */) {
        const rawText = node.textContent || "";
        const normalized = this.options.collapseWhitespace
          ? rawText.replace(/\s+/g, " ")
          : rawText;
        if (normalized.length > 0) {
          result.push(
            new ContentNode({
              type: ContentType.TEXT,
              value: normalized,
              attributes: { ...activeFormatting },
            })
          );
        }
        continue;
      }

      if (node.nodeType === 1 /* ELEMENT_NODE */) {
        const tag = (node.tagName || "").toUpperCase();

        // 1. Math
        if (this.isAtomicMath(node)) {
          result.push(this.parseMath(node, diagnostics));
          continue;
        }

        // 2. Inline Code
        if (tag === "CODE") {
          result.push(
            new ContentNode({
              type: ContentType.INLINE_CODE,
              value: node.textContent || "",
            })
          );
          continue;
        }

        // 3. Link
        if (tag === "A") {
          const href = node.getAttribute ? (node.getAttribute("href") || "") : "";
          const title = node.getAttribute ? (node.getAttribute("title") || "") : "";
          const childInline = this.processInlineNodes(
            Array.from(node.childNodes || []),
            diagnostics,
            unhandledSet,
            activeFormatting
          );
          result.push(
            new ContentNode({
              type: ContentType.LINK,
              value: (node.textContent || "").trim(),
              children: childInline,
              attributes: { href, title },
            })
          );
          continue;
        }

        // 4. Image
        if (tag === "IMG") {
          result.push(this.parseImage(node, diagnostics));
          continue;
        }

        // 5. SVG
        if (tag === "SVG") {
          result.push(this.parseSvg(node, diagnostics));
          continue;
        }

        // 6. Line break
        if (tag === "BR") {
          result.push(
            new ContentNode({
              type: ContentType.LINE_BREAK,
              value: "\n",
            })
          );
          continue;
        }

        if (tag === "P") {
          const pChildren = this.processInlineNodes(
            Array.from(node.childNodes || []),
            diagnostics,
            unhandledSet,
            activeFormatting
          );
          result.push(...pChildren);
          result.push(
            new ContentNode({
              type: ContentType.LINE_BREAK,
              value: "\n",
            })
          );
          continue;
        }

        // 7. Inline Formatting Tags
        if (INLINE_FORMAT_TAGS[tag]) {
          const formatKey = INLINE_FORMAT_TAGS[tag];
          const newFormatting = { ...activeFormatting, [formatKey]: true };
          const formattedChildren = this.processInlineNodes(
            Array.from(node.childNodes || []),
            diagnostics,
            unhandledSet,
            newFormatting
          );
          result.push(...formattedChildren);
          continue;
        }

        // 8. Generic Inline Containers (span, font, label, etc.)
        if (tag === "SPAN" || tag === "FONT" || tag === "LABEL" || tag === "MARK") {
          const spanChildren = this.processInlineNodes(
            Array.from(node.childNodes || []),
            diagnostics,
            unhandledSet,
            activeFormatting
          );
          result.push(...spanChildren);
          continue;
        }

        // Unhandled tag
        unhandledSet.add(tag.toLowerCase());
        const fallbackChildren = this.processInlineNodes(
          Array.from(node.childNodes || []),
          diagnostics,
          unhandledSet,
          activeFormatting
        );
        result.push(...fallbackChildren);
      }
    }

    return result;
  }

  /**
   * Parses a paragraph element (<p> or inline <div>).
   */
  parseParagraph(element, diagnostics, unhandledSet) {
    const inlineNodes = this.processInlineNodes(
      Array.from(element.childNodes || []),
      diagnostics,
      unhandledSet
    );

    if (inlineNodes.length === 0) return null;

    const fullText = inlineNodes
      .map((n) => (n.type === ContentType.MATH ? `\\(${n.value}\\)` : (n.value || "")))
      .join("")
      .trim();

    if (fullText.length === 0 && !inlineNodes.some((n) => n.type !== ContentType.TEXT)) {
      return null;
    }

    return new ContentNode({
      type: ContentType.PARAGRAPH,
      value: fullText,
      children: inlineNodes,
    });
  }

  /**
   * Parses a heading (h1-h6).
   */
  parseHeading(element, diagnostics, unhandledSet) {
    const tag = (element.tagName || "").toUpperCase();
    const level = parseInt(tag.replace("H", ""), 10) || 1;
    const inlineNodes = this.processInlineNodes(
      Array.from(element.childNodes || []),
      diagnostics,
      unhandledSet
    );

    const fullText = inlineNodes
      .map((n) => (n.type === ContentType.MATH ? `\\(${n.value}\\)` : (n.value || "")))
      .join("")
      .trim();

    return new ContentNode({
      type: ContentType.HEADING,
      value: fullText,
      children: inlineNodes,
      attributes: { level },
    });
  }

  /**
   * Parses a blockquote.
   */
  parseBlockquote(element, diagnostics, unhandledSet) {
    const innerBlocks = this.walkBlockContainer(element, diagnostics, unhandledSet);

    return new ContentNode({
      type: ContentType.BLOCKQUOTE,
      value: (element.textContent || "").trim(),
      children: innerBlocks,
    });
  }

  /**
   * Parses a list (ul or ol) with nested items.
   */
  parseList(element, diagnostics, unhandledSet) {
    const tag = (element.tagName || "").toUpperCase();
    const ordered = tag === "OL";
    const startAttr = element.getAttribute ? element.getAttribute("start") : null;
    const start = startAttr ? parseInt(startAttr, 10) : 1;

    const itemNodes = [];
    const childNodes = Array.from(element.childNodes || []);

    for (const child of childNodes) {
      if (child.nodeType === 1 && (child.tagName || "").toUpperCase() === "LI") {
        const itemChildren = [];
        let inlineBuf = [];

        const flushInline = () => {
          if (inlineBuf.length > 0) {
            itemChildren.push(
              ...this.processInlineNodes(inlineBuf, diagnostics, unhandledSet)
            );
            inlineBuf = [];
          }
        };

        for (const liChild of Array.from(child.childNodes || [])) {
          if (liChild.nodeType === 1) {
            const liChildTag = (liChild.tagName || "").toUpperCase();
            if (liChildTag === "UL" || liChildTag === "OL") {
              flushInline();
              itemChildren.push(this.parseList(liChild, diagnostics, unhandledSet));
              continue;
            }
          }
          inlineBuf.push(liChild);
        }
        flushInline();

        itemNodes.push(
          new ContentNode({
            type: ContentType.LIST_ITEM,
            value: (child.textContent || "").trim(),
            children: itemChildren,
          })
        );
      }
    }

    return new ContentNode({
      type: ContentType.LIST,
      children: itemNodes,
      attributes: {
        ordered,
        start: ordered ? start : undefined,
      },
    });
  }

  /**
   * Parses a code block (<pre><code> or <pre>), preserving all whitespace and indentation.
   */
  parseCodeBlock(preElement, diagnostics) {
    diagnostics.codeBlockCount += 1;

    let codeEl = null;
    if (preElement.querySelector) {
      codeEl = preElement.querySelector("code");
    } else {
      const child = Array.from(preElement.childNodes || []).find(
        (c) => c.nodeType === 1 && (c.tagName || "").toUpperCase() === "CODE"
      );
      if (child) codeEl = child;
    }

    const targetEl = codeEl || preElement;
    const rawCode = targetEl.textContent || "";

    // Extract language identifier from class
    let language = "text";
    const classAttr =
      (targetEl.getAttribute ? targetEl.getAttribute("class") : "") ||
      (preElement.getAttribute ? preElement.getAttribute("class") : "") ||
      "";

    const langMatch = classAttr.match(/(?:language-|lang-)?([a-zA-Z0-9_+#-]+)/i);
    if (langMatch) {
      const candidate = langMatch[1].toLowerCase();
      if (candidate !== "code" && candidate !== "pre" && candidate !== "hljs") {
        language = candidate;
      }
    }

    return new ContentNode({
      type: ContentType.CODE_BLOCK,
      value: rawCode,
      attributes: {
        language,
      },
    });
  }

  /**
   * Determines if a node is an atomic math expression.
   */
  isAtomicMath(element) {
    if (!element || element.nodeType !== 1) return false;
    const tag = (element.tagName || "").toUpperCase();
    if (tag === "MATH") return true;

    const cls = (element.getAttribute ? element.getAttribute("class") : "") || "";
    if (typeof cls === "string") {
      if (cls.includes("katex") || cls.includes("MathJax") || cls.includes("math-container")) {
        return true;
      }
    }
    return false;
  }

  /**
   * Checks if a math element represents display (block) math.
   */
  isDisplayMath(element) {
    const cls = (element.getAttribute ? element.getAttribute("class") : "") || "";
    if (cls.includes("katex-display") || cls.includes("display")) return true;
    if (element.getAttribute && element.getAttribute("display") === "block") return true;
    if (element.getAttribute && element.getAttribute("mode") === "display") return true;
    if (element.closest && element.closest(".katex-display, [display='block'], [mode='display']")) return true;
    return false;
  }

  /**
   * Parses an atomic math element (KaTeX or MathML) without duplicate text emission.
   */
  parseMath(mathElement, diagnostics) {
    diagnostics.mathCount += 1;
    const isDisplay = this.isDisplayMath(mathElement);

    // 1. Check for TeX annotation in KaTeX or MathML
    let annotation = null;
    if (mathElement.querySelector) {
      annotation =
        mathElement.querySelector("annotation[encoding*='tex' i]") ||
        mathElement.querySelector("annotation[encoding*='TeX']") ||
        mathElement.querySelector("annotation");
    } else {
      // Traverse nodes to find annotation
      const findAnnotation = (n) => {
        if (!n || n.nodeType !== 1) return null;
        if ((n.tagName || "").toUpperCase() === "ANNOTATION") return n;
        for (const c of Array.from(n.childNodes || [])) {
          const res = findAnnotation(c);
          if (res) return res;
        }
        return null;
      };
      annotation = findAnnotation(mathElement);
    }

    if (annotation) {
      const tex = (annotation.textContent || "").trim();
      let mathml = "";
      const mathTag = (mathElement.tagName || "").toUpperCase() === "MATH"
        ? mathElement
        : (mathElement.querySelector ? mathElement.querySelector("math") : null);
      if (mathTag && mathTag.outerHTML) {
        mathml = sanitizeMathML(mathTag.outerHTML);
      }
      return new ContentNode({
        type: ContentType.MATH,
        value: tex,
        attributes: {
          format: MathFormat.TEX,
          mathType: isDisplay ? MathType.DISPLAY : MathType.INLINE,
          ...(mathml ? { mathml } : {}),
        },
      });
    }

    // 2. MathML element without TeX annotation
    const tag = (mathElement.tagName || "").toUpperCase();
    if (tag === "MATH" || (mathElement.querySelector && mathElement.querySelector("math"))) {
      const mathTag = tag === "MATH" ? mathElement : mathElement.querySelector("math");
      const mathmlSource = mathTag.outerHTML || mathTag.textContent || "";
      return new ContentNode({
        type: ContentType.MATH,
        value: mathmlSource,
        attributes: {
          format: MathFormat.MATHML,
          mathType: isDisplay ? MathType.DISPLAY : MathType.INLINE,
        },
      });
    }

    // 3. Fallback: clean text representation with explicit indication that TeX was unavailable
    const fallbackText = (mathElement.textContent || "").trim();
    return new ContentNode({
      type: ContentType.MATH,
      value: fallbackText,
      attributes: {
        format: MathFormat.TEXT,
        mathType: isDisplay ? MathType.DISPLAY : MathType.INLINE,
        texUnavailable: true,
      },
    });
  }

  /**
   * Parses a table element with thead, tbody, tr, th, td, colspan, and rowspan.
   */
  parseTable(tableElement, diagnostics, unhandledSet) {
    diagnostics.tableCount += 1;

    let caption = "";
    if (tableElement.querySelector) {
      const capEl = tableElement.querySelector("caption");
      if (capEl) caption = (capEl.textContent || "").trim();
    }

    const rowNodes = [];
    const findRows = (parent) => {
      const rows = [];
      for (const child of Array.from(parent.childNodes || [])) {
        if (child.nodeType === 1) {
          const tag = (child.tagName || "").toUpperCase();
          if (tag === "TR") {
            rows.push(child);
          } else if (tag === "THEAD" || tag === "TBODY" || tag === "TFOOT") {
            rows.push(...findRows(child));
          }
        }
      }
      return rows;
    };

    const trElements = findRows(tableElement);

    for (const tr of trElements) {
      const cellNodes = [];
      for (const cell of Array.from(tr.childNodes || [])) {
        if (cell.nodeType === 1) {
          const cellTag = (cell.tagName || "").toUpperCase();
          if (cellTag === "TH" || cellTag === "TD") {
            const isHeader = cellTag === "TH" || Boolean(cell.closest && cell.closest("thead"));
            const colspan = cell.getAttribute ? parseInt(cell.getAttribute("colspan"), 10) || 1 : 1;
            const rowspan = cell.getAttribute ? parseInt(cell.getAttribute("rowspan"), 10) || 1 : 1;
            let align = (cell.getAttribute ? (cell.getAttribute("align") || "") : "").toLowerCase().trim();
            if (!align && cell.getAttribute) {
              const style = cell.getAttribute("style") || "";
              const match = style.match(/text-align\s*:\s*(left|center|right|justify)/i);
              if (match) align = match[1].toLowerCase();
            }
            if (!["left", "center", "right", "justify"].includes(align)) {
              align = "left";
            }

            const cellChildren = this.processInlineNodes(
              Array.from(cell.childNodes || []),
              diagnostics,
              unhandledSet
            );

            cellNodes.push(
              new ContentNode({
                type: ContentType.TABLE_CELL,
                value: (cell.textContent || "").trim(),
                children: cellChildren,
                attributes: {
                  isHeader,
                  colspan,
                  rowspan,
                  align,
                },
              })
            );
          }
        }
      }

      rowNodes.push(
        new ContentNode({
          type: ContentType.TABLE_ROW,
          children: cellNodes,
        })
      );
    }

    return new ContentNode({
      type: ContentType.TABLE,
      children: rowNodes,
      attributes: {
        caption,
      },
    });
  }

  /**
   * Parses an image element.
   */
  parseImage(imgElement, diagnostics) {
    diagnostics.imageCount += 1;
    const src =
      (imgElement.getAttribute ? imgElement.getAttribute("data-src") : "") ||
      (imgElement.getAttribute ? imgElement.getAttribute("data-lazy-src") : "") ||
      (imgElement.getAttribute ? imgElement.getAttribute("data-original") : "") ||
      imgElement.currentSrc ||
      (imgElement.getAttribute ? imgElement.getAttribute("src") : "") ||
      "";
    const alt = imgElement.getAttribute ? imgElement.getAttribute("alt") || "" : "";
    const title = imgElement.getAttribute ? imgElement.getAttribute("title") || "" : "";
    const width = imgElement.getAttribute ? imgElement.getAttribute("width") || null : null;
    const height = imgElement.getAttribute ? imgElement.getAttribute("height") || null : null;

    return new ContentNode({
      type: ContentType.IMAGE,
      attributes: {
        src,
        alt,
        title,
        width,
        height,
      },
    });
  }

  /**
   * Parses a figure element containing images and optional figcaption.
   */
  parseFigure(figureElement, diagnostics, unhandledSet) {
    let caption = "";
    if (figureElement.querySelector) {
      const capEl = figureElement.querySelector("figcaption");
      if (capEl) caption = (capEl.textContent || "").trim();
    }

    const children = [];
    for (const child of Array.from(figureElement.childNodes || [])) {
      if (child.nodeType === 1) {
        const tag = (child.tagName || "").toUpperCase();
        if (tag === "FIGCAPTION") continue;
        if (tag === "IMG") {
          children.push(this.parseImage(child, diagnostics));
        } else {
          children.push(...this.walkBlockContainer(child, diagnostics, unhandledSet));
        }
      }
    }

    return new ContentNode({
      type: ContentType.FIGURE,
      children,
      attributes: {
        caption,
      },
    });
  }

  /**
   * Parses an SVG element.
   */
  parseSvg(svgElement, diagnostics) {
    const viewBox = svgElement.getAttribute ? svgElement.getAttribute("viewBox") || "" : "";
    const width = svgElement.getAttribute ? svgElement.getAttribute("width") || "" : "";
    const height = svgElement.getAttribute ? svgElement.getAttribute("height") || "" : "";
    let title = svgElement.getAttribute ? svgElement.getAttribute("aria-label") || "" : "";

    if (svgElement.querySelector) {
      const titleEl = svgElement.querySelector("title");
      if (titleEl) title = (titleEl.textContent || "").trim();
    }

    const rawSvg = svgElement.outerHTML || "";
    const cleanSvg = sanitizeSvgSource(rawSvg);

    return new ContentNode({
      type: ContentType.SVG,
      value: cleanSvg,
      attributes: {
        viewBox,
        width,
        height,
        title,
      },
    });
  }
}
