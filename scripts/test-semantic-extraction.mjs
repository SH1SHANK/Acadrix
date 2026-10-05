#!/usr/bin/env node
/**
 * Semantic DOM Extractor Verification Suite.
 * 
 * Tests Phase 3 objectives:
 * - Scoped semantic DOM traversal via SemanticWalker
 * - Canonical ContentNode AST generation for all 13 semantic categories:
 *   1. Paragraphs & div equivalence
 *   2. Text with inline formatting (bold, italic, underline, strike, sub, sup, nested)
 *   3. Lists (ordered, unordered, nested)
 *   4. Blockquotes
 *   5. Links with attributes and formatted children
 *   6. Code blocks (preserving exact whitespace/indentation) and inline code
 *   7. KaTeX TeX annotation extraction (atomic, no .katex-html duplication)
 *   8. MathML fallback
 *   9. Tables (caption, thead, tbody, th, td, colspan, rowspan, align)
 *   10. Figures & Images (src, alt, title, dimensions, figcaption)
 *   11. SVGs (viewBox, dimensions, title)
 *   12. Mixed realistic question stem with diagnostics
 *   13. Mixed options (OptionNode.content: ContentNode[], selection state)
 * - Model-driven Reader UI HTML rendering (renderContentNodes)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ContentType, MathType, MathFormat, QuestionType } from "../src/model/types.js";
import { ContentNode, OptionNode, QuestionNode } from "../src/model/document.js";
import { SemanticWalker } from "../src/parsers/semantic-walker.js";
import { SemanticExtractor } from "../src/extraction/semantic.js";
import { renderContentNodes } from "../src/ui/reader.js";

let passed = true;

function check(desc, fn) {
  try {
    fn();
    console.log(`✓ ${desc}`);
  } catch (e) {
    console.error(`❌ ${desc}: ${e.message}`);
    passed = false;
  }
}

// ── Lightweight Deterministic DOM Parser for Node Testing ────────────────────

class TestDOMNode {
  constructor(nodeType, tagName = "") {
    this.nodeType = nodeType; // 1: Element, 3: Text, 8: Comment
    this.tagName = tagName.toUpperCase();
    this.childNodes = [];
    this.parentElement = null;
    this.attributes = Object.create(null);
    this._textContent = "";
  }

  get children() {
    return this.childNodes.filter((c) => c.nodeType === 1);
  }

  getAttribute(name) {
    return this.attributes[name.toLowerCase()] ?? null;
  }

  hasAttribute(name) {
    return name.toLowerCase() in this.attributes;
  }

  setAttribute(name, value) {
    this.attributes[name.toLowerCase()] = String(value);
  }

  get classList() {
    const self = this;
    return {
      contains(cls) {
        const classAttr = self.getAttribute("class") || "";
        return classAttr.split(/\s+/).includes(cls);
      },
    };
  }

  get textContent() {
    if (this.nodeType === 3) return this._textContent;
    if (this.nodeType === 8) return "";
    return this.childNodes.map((c) => c.textContent).join("");
  }

  set textContent(val) {
    this.childNodes = [];
    this._textContent = val;
    if (val) {
      const textNode = new TestDOMNode(3);
      textNode._textContent = val;
      textNode.parentElement = this;
      this.childNodes.push(textNode);
    }
  }

  get outerHTML() {
    if (this.nodeType === 3) return this._textContent;
    if (this.nodeType === 8) return `<!--${this._textContent}-->`;
    const tag = this.tagName.toLowerCase();
    const attrs = Object.entries(this.attributes)
      .map(([k, v]) => ` ${k}="${v}"`)
      .join("");
    const inner = this.innerHTML;
    const voidTags = new Set(["img", "br", "hr", "input", "col", "meta", "link"]);
    if (voidTags.has(tag)) return `<${tag}${attrs} />`;
    return `<${tag}${attrs}>${inner}</${tag}>`;
  }

  get innerHTML() {
    return this.childNodes.map((c) => c.outerHTML).join("");
  }

  appendChild(child) {
    child.parentElement = this;
    this.childNodes.push(child);
    return child;
  }

  cloneNode(deep = false) {
    const clone = new TestDOMNode(this.nodeType, this.tagName);
    clone._textContent = this._textContent;
    clone.attributes = { ...this.attributes };
    if (deep) {
      for (const child of this.childNodes) {
        clone.appendChild(child.cloneNode(true));
      }
    }
    return clone;
  }

  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.childNodes.indexOf(this);
      if (idx !== -1) this.parentElement.childNodes.splice(idx, 1);
      this.parentElement = null;
    }
  }

  contains(other) {
    if (!other) return false;
    let curr = other;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentElement;
    }
    return false;
  }

  matches(selector) {
    return matchesSelector(this, selector);
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (curr.nodeType === 1 && matchesSelector(curr, selector)) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 1) {
          if (matchesSelector(child, selector)) {
            results.push(child);
          }
          walk(child);
        }
      }
    };
    walk(this);
    return results;
  }
}

function matchesSelector(el, sel) {
  const parts = sel.trim().split(/\s*,\s*/);
  return parts.some((part) => matchSingleSelector(el, part));
}

function matchSingleSelector(el, sel) {
  // Support compound selector with ancestor (e.g. ".choices label.choice")
  const tokens = sel.trim().split(/\s+/);
  if (tokens.length > 1) {
    // Check right-to-left
    let target = el;
    for (let i = tokens.length - 1; i >= 0; i--) {
      if (!target) return false;
      if (!matchSimpleToken(target, tokens[i])) {
        if (i === tokens.length - 1) return false;
        // Search ancestors
        let found = null;
        let p = target.parentElement;
        while (p) {
          if (matchSimpleToken(p, tokens[i])) {
            found = p;
            break;
          }
          p = p.parentElement;
        }
        if (!found) return false;
        target = found;
      } else {
        target = target.parentElement;
      }
    }
    return true;
  }

  return matchSimpleToken(el, sel);
}

function matchSimpleToken(el, token) {
  if (token === "*") return true;

  // Tag name
  const tagMatch = token.match(/^[a-zA-Z0-9_-]+/);
  if (tagMatch) {
    if (el.tagName !== tagMatch[0].toUpperCase()) return false;
    token = token.slice(tagMatch[0].length);
  }

  // Classes
  const classMatches = token.match(/\.[a-zA-Z0-9_-]+/g);
  if (classMatches) {
    for (const c of classMatches) {
      const clsName = c.slice(1);
      if (!el.classList.contains(clsName)) return false;
      token = token.replace(c, "");
    }
  }

  // Attributes: [name], [name=val], [name*='val'], [name^='val']
  const attrMatches = token.match(/\[([a-zA-Z0-9_-]+)(?:([*^$]?=)(["']?)(.*?)\3)?\]/g);
  if (attrMatches) {
    for (const a of attrMatches) {
      const m = a.match(/\[([a-zA-Z0-9_-]+)(?:([*^$]?=)(["']?)(.*?)\3)?\]/);
      if (!m) return false;
      const attrName = m[1].toLowerCase();
      const op = m[2];
      const expectedVal = m[4];

      if (!el.hasAttribute(attrName)) return false;
      if (op) {
        const actualVal = el.getAttribute(attrName) || "";
        if (op === "=" && actualVal.toLowerCase() !== expectedVal.toLowerCase()) return false;
        if (op === "*=" && !actualVal.toLowerCase().includes(expectedVal.toLowerCase())) return false;
        if (op === "^=" && !actualVal.toLowerCase().startsWith(expectedVal.toLowerCase())) return false;
      }
    }
  }

  return true;
}

function parseHtmlToDom(html) {
  const root = new TestDOMNode(1, "ROOT");
  const stack = [root];
  const voidTags = new Set(["IMG", "BR", "HR", "INPUT", "COL", "META", "LINK"]);

  let i = 0;
  while (i < html.length) {
    // 1. Comment
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i);
      const text = end === -1 ? html.slice(i + 4) : html.slice(i + 4, end);
      const commentNode = new TestDOMNode(8);
      commentNode._textContent = text;
      stack[stack.length - 1].appendChild(commentNode);
      i = end === -1 ? html.length : end + 3;
      continue;
    }

    // 2. End tag </tag>
    if (html.startsWith("</", i)) {
      const end = html.indexOf(">", i);
      const tag = html.slice(i + 2, end).trim().toUpperCase();
      // Find matching tag in stack
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s].tagName === tag) {
          stack.length = s; // pop back to parent
          break;
        }
      }
      i = end === -1 ? html.length : end + 1;
      continue;
    }

    // 3. Start tag <tag ...>
    if (html[i] === "<") {
      const end = html.indexOf(">", i);
      if (end !== -1) {
        const rawTagContent = html.slice(i + 1, end).trim();
        const selfClosing = rawTagContent.endsWith("/");
        const cleanContent = selfClosing ? rawTagContent.slice(0, -1).trim() : rawTagContent;

        const spaceIdx = cleanContent.search(/\s/);
        const tagName = spaceIdx === -1 ? cleanContent : cleanContent.slice(0, spaceIdx);
        const attrStr = spaceIdx === -1 ? "" : cleanContent.slice(spaceIdx).trim();

        const el = new TestDOMNode(1, tagName);

        // Parse attributes
        const attrRegex = /([a-zA-Z0-9_:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
        let match;
        while ((match = attrRegex.exec(attrStr)) !== null) {
          const name = match[1];
          const val = match[2] ?? match[3] ?? match[4] ?? "";
          el.setAttribute(name, val);
        }

        stack[stack.length - 1].appendChild(el);

        // Special handling for <pre>: preserve raw text inside <pre><code> verbatim
        if (el.tagName === "PRE") {
          const preClose = html.toLowerCase().indexOf("</pre>", end + 1);
          if (preClose !== -1) {
            const preInnerHtml = html.slice(end + 1, preClose);
            // Check if contains <code>
            const codeStartMatch = preInnerHtml.match(/^<code([^>]*)>/i);
            if (codeStartMatch) {
              const codeEl = new TestDOMNode(1, "CODE");
              const codeAttrStr = codeStartMatch[1];
              let codeMatch;
              while ((codeMatch = attrRegex.exec(codeAttrStr)) !== null) {
                codeEl.setAttribute(codeMatch[1], codeMatch[2] ?? codeMatch[3] ?? codeMatch[4] ?? "");
              }
              const codeCloseIdx = preInnerHtml.toLowerCase().indexOf("</code>");
              const codeContent = codeCloseIdx !== -1
                ? preInnerHtml.slice(codeStartMatch[0].length, codeCloseIdx)
                : preInnerHtml.slice(codeStartMatch[0].length);
              codeEl.textContent = codeContent;
              el.appendChild(codeEl);
            } else {
              el.textContent = preInnerHtml;
            }
            i = preClose + 6;
            continue;
          }
        }

        if (!voidTags.has(el.tagName) && !selfClosing) {
          stack.push(el);
        }

        i = end + 1;
        continue;
      }
    }

    // 4. Text node
    const nextTag = html.indexOf("<", i);
    const text = nextTag === -1 ? html.slice(i) : html.slice(i, nextTag);
    if (text.length > 0) {
      const textNode = new TestDOMNode(3);
      textNode._textContent = text;
      stack[stack.length - 1].appendChild(textNode);
    }
    i = nextTag === -1 ? html.length : nextTag;
  }

  return root.childNodes.length === 1 ? root.childNodes[0] : root;
}

function loadFixtureDom(relativePath) {
  const fullPath = join(process.cwd(), relativePath);
  const html = readFileSync(fullPath, "utf8");
  return parseHtmlToDom(html);
}

// ── Test Suite ───────────────────────────────────────────────────────────────

console.log("\nStarting Phase 3 Semantic Extractor Verification Suite...\n");

const walker = new SemanticWalker();

// 1. Paragraphs & Div Equivalence
check("Category 1: Paragraphs and Div block/inline normalization", () => {
  const dom = loadFixtureDom("fixtures/semantic/paragraphs.html");
  const { nodes, diagnostics } = walker.walk(dom);

  if (nodes.length !== 3) {
    throw new Error(`Expected 3 paragraphs, got ${nodes.length}`);
  }
  nodes.forEach((n) => {
    if (n.type !== ContentType.PARAGRAPH) {
      throw new Error(`Expected ContentType.PARAGRAPH, got ${n.type}`);
    }
  });

  if (!nodes[0].value.includes("First paragraph")) {
    throw new Error(`Paragraph 1 text mismatch: ${nodes[0].value}`);
  }
  if (!nodes[1].value.includes("Second paragraph")) {
    throw new Error(`Paragraph 2 text mismatch: ${nodes[1].value}`);
  }
  if (!nodes[2].value.includes("Third paragraph")) {
    throw new Error(`Paragraph 3 (from div) text mismatch: ${nodes[2].value}`);
  }
});

// 2. Inline Formatting & Nested Styles
check("Category 2: Text formatting (bold, italic, underline, strike, sub, sup, nested)", () => {
  const dom = loadFixtureDom("fixtures/semantic/formatting.html");
  const { nodes } = walker.walk(dom);

  if (nodes.length !== 4) {
    throw new Error(`Expected 4 paragraphs, got ${nodes.length}`);
  }

  // Paragraph 1: bold & italic
  const p1Children = nodes[0].children;
  const boldNode = p1Children.find((c) => c.attributes?.bold);
  const italicNode = p1Children.find((c) => c.attributes?.italic);
  if (!boldNode || boldNode.value !== "bold text") {
    throw new Error("Failed to extract bold text with bold attribute");
  }
  if (!italicNode || italicNode.value !== "italicized text") {
    throw new Error("Failed to extract italic text with italic attribute");
  }

  // Paragraph 2: underline & strike
  const p2Children = nodes[1].children;
  const uNode = p2Children.find((c) => c.attributes?.underline);
  const delNode = p2Children.find((c) => c.attributes?.strike);
  if (!uNode || uNode.value !== "underlined content") {
    throw new Error("Failed to extract underline attribute");
  }
  if (!delNode || delNode.value !== "strikethrough text") {
    throw new Error("Failed to extract strike attribute");
  }

  // Paragraph 3: sub & sup
  const p3Children = nodes[2].children;
  const subNode = p3Children.find((c) => c.attributes?.sub);
  const supNode = p3Children.find((c) => c.attributes?.sup);
  if (!subNode || subNode.value !== "2") {
    throw new Error("Failed to extract subscript node");
  }
  if (!supNode || supNode.value !== "2") {
    throw new Error("Failed to extract superscript node");
  }

  // Paragraph 4: nested bold and italic
  const p4Children = nodes[3].children;
  const nestedNode = p4Children.find((c) => c.attributes?.bold && c.attributes?.italic);
  if (!nestedNode || nestedNode.value !== "nested bold and italic") {
    throw new Error("Failed to extract nested bold and italic attributes");
  }
});

// 3. Lists (Ordered, Unordered, Nested)
check("Category 3: Lists (ordered, unordered, nested)", () => {
  const dom = loadFixtureDom("fixtures/semantic/lists.html");
  const { nodes } = walker.walk(dom);

  const lists = nodes.filter((n) => n.type === ContentType.LIST);
  if (lists.length !== 2) {
    throw new Error(`Expected 2 lists, got ${lists.length}`);
  }

  // Unordered list
  const ul = lists[0];
  if (ul.attributes.ordered !== false) throw new Error("Expected unordered list");
  if (ul.children.length !== 3) throw new Error(`Expected 3 list items in ul, got ${ul.children.length}`);
  if (ul.children[1].value !== "Binary Search") {
    throw new Error(`List item text mismatch: ${ul.children[1].value}`);
  }

  // Ordered list with nested unordered list
  const ol = lists[1];
  if (ol.attributes.ordered !== true) throw new Error("Expected ordered list");
  if (ol.children.length !== 3) throw new Error(`Expected 3 items in ol, got ${ol.children.length}`);

  const item2 = ol.children[1];
  const nestedList = item2.children.find((c) => c.type === ContentType.LIST);
  if (!nestedList) throw new Error("Nested list not found inside item 2");
  if (nestedList.children.length !== 2) {
    throw new Error(`Expected 2 nested list items, got ${nestedList.children.length}`);
  }
});

// 4. Blockquotes
check("Category 4: Blockquotes", () => {
  const dom = loadFixtureDom("fixtures/semantic/blockquote.html");
  const { nodes } = walker.walk(dom);

  const bq = nodes.find((n) => n.type === ContentType.BLOCKQUOTE);
  if (!bq) throw new Error("Blockquote not extracted");
  if (!bq.value.includes("Premature optimization is the root of all evil")) {
    throw new Error(`Blockquote content mismatch: ${bq.value}`);
  }
});

// 5. Links
check("Category 5: Links with href, title, and formatted children", () => {
  const dom = loadFixtureDom("fixtures/semantic/links.html");
  const { nodes } = walker.walk(dom);

  const link1 = nodes[0].children.find((c) => c.type === ContentType.LINK);
  if (!link1) throw new Error("First link not extracted");
  if (link1.attributes.href !== "https://docs.python.org/3/") {
    throw new Error(`Link href mismatch: ${link1.attributes.href}`);
  }
  if (link1.attributes.title !== "Python 3 Documentation") {
    throw new Error(`Link title mismatch: ${link1.attributes.title}`);
  }

  const link2 = nodes[1].children.find((c) => c.type === ContentType.LINK);
  if (!link2) throw new Error("Second link not extracted");
  const link2Child = link2.children.find((c) => c.attributes?.bold);
  if (!link2Child || link2Child.value !== "IIT Madras Portal") {
    throw new Error("Formatted child inside link not preserved");
  }
});

// 6. Code Blocks & Inline Code
check("Category 6: Code blocks preserving exact indentation and inline code", () => {
  const dom = loadFixtureDom("fixtures/semantic/code.html");
  const { nodes, diagnostics } = walker.walk(dom);

  const codeBlock = nodes.find((n) => n.type === ContentType.CODE_BLOCK);
  if (!codeBlock) throw new Error("Code block not found");
  if (codeBlock.attributes.language !== "python") {
    throw new Error(`Expected language python, got: ${codeBlock.attributes.language}`);
  }

  // Verify indentation preservation
  if (!codeBlock.value.includes("    if len(arr) <= 1:")) {
    throw new Error("Code block indentation was modified or collapsed");
  }
  if (!codeBlock.value.includes("\n")) {
    throw new Error("Code block newlines were collapsed");
  }

  // Inline code
  const inlineCode = nodes[2].children.find((c) => c.type === ContentType.INLINE_CODE);
  if (!inlineCode || !inlineCode.value.includes("quicksort([3, 6, 8, 10, 1, 2, 1])")) {
    throw new Error("Inline code not correctly extracted");
  }

  if (diagnostics.codeBlockCount !== 1) {
    throw new Error(`Diagnostics codeBlockCount mismatch: ${diagnostics.codeBlockCount}`);
  }
});

// 7. Math (KaTeX TeX annotation & Display Mode)
check("Category 7: KaTeX math with TeX annotation & no duplicate text", () => {
  const dom = loadFixtureDom("fixtures/semantic/math-tex.html");
  const { nodes, diagnostics } = walker.walk(dom);

  if (diagnostics.mathCount !== 2) {
    throw new Error(`Expected 2 math nodes in diagnostics, got ${diagnostics.mathCount}`);
  }

  // Inline math in p1
  const inlineMath = nodes[0].children.find((c) => c.type === ContentType.MATH);
  if (!inlineMath) throw new Error("Inline math not found in p1");
  if (inlineMath.value !== "f(x) = x^2 + 2x + 1") {
    throw new Error(`Inline math TeX mismatch: ${inlineMath.value}`);
  }
  if (inlineMath.attributes.format !== MathFormat.TEX) {
    throw new Error("Math format should be TEX");
  }
  if (inlineMath.attributes.mathType !== MathType.INLINE) {
    throw new Error("Inline math should have MathType.INLINE");
  }

  // Display math
  const displayMath = nodes.find((n) => n.type === ContentType.MATH && n.attributes.mathType === MathType.DISPLAY);
  if (!displayMath) throw new Error("Display math block not found");
  if (displayMath.value !== "\\int_{0}^{1} f(x) dx") {
    throw new Error(`Display math TeX mismatch: ${displayMath.value}`);
  }

  // Verify no duplicate text from .katex-html in rendered text or AST
  const renderedText = nodes[0].value;
  if (renderedText.includes("f(x)=x^2+2x+1")) {
    throw new Error("KaTeX HTML preview text leaked into AST; duplicate text detected!");
  }
});

// 8. MathML Fallback
check("Category 8: MathML fallback when TeX annotation is absent", () => {
  const dom = loadFixtureDom("fixtures/semantic/math-mathml.html");
  const { nodes, diagnostics } = walker.walk(dom);

  const mathNode = nodes.find((n) => n.type === ContentType.MATH);
  if (!mathNode) throw new Error("MathML node not found");
  if (mathNode.attributes.format !== MathFormat.MATHML) {
    throw new Error(`Expected MathFormat.MATHML, got ${mathNode.attributes.format}`);
  }
  if (mathNode.attributes.mathType !== MathType.DISPLAY) {
    throw new Error("Expected display MathML mode");
  }
  if (!mathNode.value.includes("<mrow>") || !mathNode.value.includes("<msup>")) {
    throw new Error(`MathML payload missing markup: ${mathNode.value}`);
  }
});

// 9. Tables
check("Category 9: Table extraction with caption, headers, colspan, rowspan, and align", () => {
  const dom = loadFixtureDom("fixtures/semantic/table.html");
  const { nodes, diagnostics } = walker.walk(dom);

  const table = nodes.find((n) => n.type === ContentType.TABLE);
  if (!table) throw new Error("Table node not extracted");
  if (table.attributes.caption !== "Term Exam Results") {
    throw new Error(`Table caption mismatch: ${table.attributes.caption}`);
  }

  // 3 rows (2 header rows, 2 body rows -> 4 total)
  if (table.children.length !== 4) {
    throw new Error(`Expected 4 table rows, got ${table.children.length}`);
  }

  const row1 = table.children[0];
  const cellRoll = row1.children[0];
  if (cellRoll.attributes.rowspan !== 2 || cellRoll.attributes.isHeader !== true) {
    throw new Error("Rowspan or isHeader mismatch on cellRoll");
  }

  const cellScores = row1.children[1];
  if (cellScores.attributes.colspan !== 2 || cellScores.attributes.align !== "center") {
    throw new Error("Colspan or align mismatch on cellScores");
  }

  if (diagnostics.tableCount !== 1) {
    throw new Error(`Diagnostics tableCount mismatch: ${diagnostics.tableCount}`);
  }
});

// 10. Figures & Images
check("Category 10: Figure and standalone image extraction", () => {
  const dom = loadFixtureDom("fixtures/semantic/figure-image.html");
  const { nodes, diagnostics } = walker.walk(dom);

  const standaloneImg = nodes.find((n) => n.type === ContentType.IMAGE);
  if (!standaloneImg) throw new Error("Standalone image not extracted");
  if (standaloneImg.attributes.src !== "https://study.iitm.ac.in/assets/diagram1.png") {
    throw new Error(`Image src mismatch: ${standaloneImg.attributes.src}`);
  }
  if (standaloneImg.attributes.alt !== "Decision Tree") {
    throw new Error(`Image alt mismatch: ${standaloneImg.attributes.alt}`);
  }
  if (standaloneImg.attributes.width !== "400") {
    throw new Error(`Image width mismatch: ${standaloneImg.attributes.width}`);
  }

  const figure = nodes.find((n) => n.type === ContentType.FIGURE);
  if (!figure) throw new Error("Figure node not extracted");
  if (figure.attributes.caption !== "Figure 1: Binary Classification Confusion Matrix") {
    throw new Error(`Figcaption mismatch: ${figure.attributes.caption}`);
  }
  const figImg = figure.children.find((c) => c.type === ContentType.IMAGE);
  if (!figImg || figImg.attributes.alt !== "Confusion Matrix") {
    throw new Error("Image inside figure not found");
  }

  if (diagnostics.imageCount !== 2) {
    throw new Error(`Diagnostics imageCount mismatch: ${diagnostics.imageCount}`);
  }
});

// 11. SVGs
check("Category 11: Content SVG vector extraction", () => {
  const dom = loadFixtureDom("fixtures/semantic/svg.html");
  const { nodes } = walker.walk(dom);

  const svgNode = nodes[1].children.find((c) => c.type === ContentType.SVG);
  if (!svgNode) throw new Error("SVG node not extracted");
  if (svgNode.attributes.viewBox !== "0 0 100 100") {
    throw new Error(`SVG viewBox mismatch: ${svgNode.attributes.viewBox}`);
  }
  if (svgNode.attributes.title !== "DAG Representation") {
    throw new Error(`SVG title mismatch: ${svgNode.attributes.title}`);
  }
  if (!svgNode.value.includes("<circle")) {
    throw new Error("SVG outerHTML missing circle element");
  }
});

// 12. Mixed Realistic Question Stem & Diagnostics
check("Category 12: Realistic mixed question stem with full diagnostics", () => {
  const dom = loadFixtureDom("fixtures/semantic/mixed-question.html");
  const { nodes, diagnostics } = walker.walk(dom);

  const heading = nodes.find((n) => n.type === ContentType.HEADING);
  if (!heading || heading.attributes.level !== 2) throw new Error("H2 heading missing");

  const mathNode = nodes[1].children.find((c) => c.type === ContentType.MATH);
  if (!mathNode || !mathNode.value.includes("L(\\theta)")) throw new Error("Math node missing");

  const codeNode = nodes.find((n) => n.type === ContentType.CODE_BLOCK);
  if (!codeNode || codeNode.attributes.language !== "python") throw new Error("Python code block missing");

  const tableNode = nodes.find((n) => n.type === ContentType.TABLE);
  if (!tableNode) throw new Error("Table missing");

  const imgNode = nodes.find((n) => n.type === ContentType.IMAGE);
  if (!imgNode) throw new Error("Image missing");

  const listNode = nodes.find((n) => n.type === ContentType.LIST);
  if (!listNode) throw new Error("List missing");

  if (diagnostics.mathCount !== 1) throw new Error(`Diagnostics mathCount: ${diagnostics.mathCount}`);
  if (diagnostics.codeBlockCount !== 1) throw new Error(`Diagnostics codeBlockCount: ${diagnostics.codeBlockCount}`);
  if (diagnostics.tableCount !== 1) throw new Error(`Diagnostics tableCount: ${diagnostics.tableCount}`);
  if (diagnostics.imageCount !== 1) throw new Error(`Diagnostics imageCount: ${diagnostics.imageCount}`);
  if (diagnostics.nodeCount < 10) throw new Error(`Diagnostics nodeCount too low: ${diagnostics.nodeCount}`);
});

// 13. Mixed Options Extraction & Selection State
check("Category 13: Mixed options with semantic content and selection state", () => {
  const dom = loadFixtureDom("fixtures/semantic/mixed-options.html");

  // Create simulated portal adapter pointing to this DOM
  const mockPortal = {
    getAssessmentView: () => dom,
    getCurrentQuestionElement: () => dom.querySelector("app-assessment-question"),
    getReviewPanel: () => null,
    isReviewMode: () => false,
  };

  const extractor = new SemanticExtractor(mockPortal);
  const questionNode = extractor.captureCurrentQuestion(0, false);

  if (questionNode.type !== QuestionType.MCQ) {
    throw new Error(`Expected QuestionType.MCQ, got ${questionNode.type}`);
  }
  if (questionNode.options.length !== 4) {
    throw new Error(`Expected 4 options, got ${questionNode.options.length}`);
  }

  // Option A: math
  const optA = questionNode.options[0];
  if (optA.letter !== "A") throw new Error(`Expected letter A, got ${optA.letter}`);
  const optAMath = optA.content.find((c) => c.type === ContentType.MATH);
  if (!optAMath || optAMath.value !== "O(n^2)") {
    throw new Error("Option A math content mismatch");
  }

  // Option B: code & selected
  const optB = questionNode.options[1];
  if (optB.letter !== "B") throw new Error(`Expected letter B, got ${optB.letter}`);
  if (optB.selected !== true) throw new Error("Option B should be selected");
  const optBCode = optB.content.find((c) => c.type === ContentType.INLINE_CODE);
  if (!optBCode || optBCode.value !== "return None") {
    throw new Error("Option B inline code mismatch");
  }

  // Option C: image
  const optC = questionNode.options[2];
  const optCImg = optC.content.find((c) => c.type === ContentType.IMAGE);
  if (!optCImg || optCImg.attributes.src !== "https://study.iitm.ac.in/assets/opt_c.png") {
    throw new Error("Option C image mismatch");
  }

  // Option D: text
  const optD = questionNode.options[3];
  if (!optD.content[0].value.includes("Plain textual statement")) {
    throw new Error("Option D text mismatch");
  }
});

// 14. Model-Driven Reader HTML Rendering
check("Model-driven Reader HTML rendering via renderContentNodes", () => {
  const ast = [
    new ContentNode({
      type: ContentType.HEADING,
      value: "Test Title",
      attributes: { level: 2 },
    }),
    new ContentNode({
      type: ContentType.PARAGRAPH,
      children: [
        new ContentNode({ type: ContentType.TEXT, value: "Text with " }),
        new ContentNode({
          type: ContentType.TEXT,
          value: "bold",
          attributes: { bold: true },
        }),
        new ContentNode({ type: ContentType.TEXT, value: " and math: " }),
        new ContentNode({
          type: ContentType.MATH,
          value: "x^2",
          attributes: { format: MathFormat.TEX, mathType: MathType.INLINE },
        }),
      ],
    }),
    new ContentNode({
      type: ContentType.CODE_BLOCK,
      value: "console.log('ok');",
      attributes: { language: "js" },
    }),
  ];

  const html = renderContentNodes(ast);

  if (!html.includes("<h2>Test Title</h2>")) {
    throw new Error(`Heading render mismatch: ${html}`);
  }
  if (!html.includes("<strong>bold</strong>")) {
    throw new Error(`Bold render mismatch: ${html}`);
  }
  if (!html.includes('<span class="katex math-inline">\\(x^2\\)</span>')) {
    throw new Error(`Math render mismatch: ${html}`);
  }
  if (!html.includes('<pre><code class="language-js">console.log(&#039;ok&#039;);</code></pre>')) {
    throw new Error(`Code block render mismatch: ${html}`);
  }
});

// 15. Real IITM MCQ Structure Verification
check("Category 15: Real IITM MCQ DOM structure (button.choice[role=radio], .choice-text.backend-html, stem deduplication)", () => {
  const dom = loadFixtureDom("fixtures/semantic/real-iitm-mcq.html");

  const mockPortal = {
    getAssessmentView: () => dom,
    getCurrentQuestionElement: () => dom.querySelector("app-assessment-question"),
    getReviewPanel: () => null,
    isReviewMode: () => false,
    getActiveLogicalNumber: () => 1,
    getActiveChip: () => dom.querySelector(".chip.active"),
  };

  const extractor = new SemanticExtractor(mockPortal);
  const q = extractor.captureCurrentQuestion(0, false);

  // 1. Question Type & Marks
  if (q.type !== QuestionType.MCQ) {
    throw new Error(`Expected QuestionType.MCQ, got ${q.type}`);
  }
  if (q.marks !== 2.5) {
    throw new Error(`Expected 2.5 marks, got ${q.marks}`);
  }
  if (q.number !== 1) {
    throw new Error(`Expected question number 1, got ${q.number}`);
  }

  // 2. Stem Scope & Deduplication
  // Must deduplicate mobile and desktop .backend-html
  if (q.stem.length !== 2) {
    throw new Error(`Expected exactly 2 stem paragraphs after deduplication, got ${q.stem.length}`);
  }
  if (!q.stem[0].value.includes("connected undirected graph")) {
    throw new Error(`Stem paragraph 1 mismatch: ${q.stem[0].value}`);
  }
  if (!q.stem[1].value.includes("Eulerian")) {
    throw new Error(`Stem paragraph 2 mismatch: ${q.stem[1].value}`);
  }
  // Must NOT include option text in stem
  const stemFullText = q.stem.map((s) => s.value).join(" ");
  if (stemFullText.includes("Every vertex has an even degree") || stemFullText.includes("Hamiltonian")) {
    throw new Error("Option text leaked into question stem!");
  }

  // 3. Option Structure
  // Must ignore "Clear Selection" button
  if (q.options.length !== 3) {
    throw new Error(`Expected exactly 3 options (excluding Clear Selection), got ${q.options.length}`);
  }

  // Option A
  const optA = q.options[0];
  if (optA.letter !== "A") throw new Error(`Expected letter A, got ${optA.letter}`);
  if (optA.selected !== false) throw new Error("Option A should not be selected");
  const optAText = optA.content.map((c) => c.value).join(" ");
  if (!optAText.includes("Every vertex has an even degree")) {
    throw new Error(`Option A content mismatch: ${optAText}`);
  }
  if (optAText.includes("radio-circle") || optAText.includes("choice-indicator")) {
    throw new Error("Presentation indicator leaked into Option A content!");
  }

  // Option B (Selected)
  const optB = q.options[1];
  if (optB.letter !== "B") throw new Error(`Expected letter B, got ${optB.letter}`);
  if (optB.selected !== true) throw new Error("Option B should be selected via aria-checked=true and .selected");
  const optBText = optB.content.map((c) => c.value).join(" ");
  if (!optBText.includes("Every vertex has an odd degree")) {
    throw new Error(`Option B content mismatch: ${optBText}`);
  }

  // Option C
  const optC = q.options[2];
  if (optC.letter !== "C") throw new Error(`Expected letter C, got ${optC.letter}`);
  if (optC.selected !== false) throw new Error("Option C should not be selected");
});

// 16. Real IITM MSQ Structure Verification
check("Category 16: Real IITM MSQ DOM structure (button.choice[role=checkbox], multiple selections)", () => {
  const dom = loadFixtureDom("fixtures/semantic/real-iitm-msq.html");

  const mockPortal = {
    getAssessmentView: () => dom,
    getCurrentQuestionElement: () => dom.querySelector("app-assessment-question"),
    getReviewPanel: () => null,
    isReviewMode: () => false,
    getActiveLogicalNumber: () => 2,
    getActiveChip: () => dom.querySelector(".chip.active"),
  };

  const extractor = new SemanticExtractor(mockPortal);
  const q = extractor.captureCurrentQuestion(1, false);

  if (q.type !== QuestionType.MSQ) {
    throw new Error(`Expected QuestionType.MSQ, got ${q.type}`);
  }
  if (q.marks !== 3) {
    throw new Error(`Expected 3 marks, got ${q.marks}`);
  }
  if (q.options.length !== 4) {
    throw new Error(`Expected 4 options, got ${q.options.length}`);
  }

  // A and C selected, B and D unselected
  if (q.options[0].selected !== true) throw new Error("Option A should be selected");
  if (q.options[1].selected !== false) throw new Error("Option B should not be selected");
  if (q.options[2].selected !== true) throw new Error("Option C should be selected");
  if (q.options[3].selected !== false) throw new Error("Option D should not be selected");

  if (!q.options[0].content[0].value.includes("Red-Black Tree")) {
    throw new Error(`Option A text mismatch: ${q.options[0].content[0].value}`);
  }
  if (!q.options[2].content[0].value.includes("AVL Tree")) {
    throw new Error(`Option C text mismatch: ${q.options[2].content[0].value}`);
  }
});

// 17. SVG Safety & Explicit Sanitization Policy
check("Category 17: SVG safety policy strips executable tags and handlers", () => {
  const unsafeSvg = `<div class="backend-html"><svg viewBox="0 0 100 100" onload="alert('pwn')"><title>Safe Diagram</title><script>evil()</script><foreignObject><div>bad</div></foreignObject><a href="javascript:attack()"><circle cx="10" cy="10" r="5" /></a></svg></div>`;
  const dom = loadFixtureDom ? parseHtmlToDom(unsafeSvg) : null;
  const { nodes } = walker.walk(dom);

  const svgNode = nodes.find((n) => n.type === ContentType.SVG) || (nodes[0]?.children?.find((c) => c.type === ContentType.SVG));
  if (!svgNode) throw new Error("SVG node not created");

  const cleanSvg = svgNode.value;
  if (cleanSvg.includes("<script")) {
    throw new Error("SVG sanitizer failed to strip <script> tag!");
  }
  if (cleanSvg.includes("<foreignObject")) {
    throw new Error("SVG sanitizer failed to strip <foreignObject> tag!");
  }
  if (cleanSvg.includes("onload=")) {
    throw new Error("SVG sanitizer failed to strip onload handler!");
  }
  if (cleanSvg.includes("javascript:")) {
    throw new Error("SVG sanitizer failed to strip javascript: URL!");
  }
  if (!cleanSvg.includes("<circle")) {
    throw new Error("Valid circle element was stripped!");
  }
});

// 18. Reader Rendering URL Safety
check("Category 18: Reader rendering neutralizes unsafe javascript: URLs", () => {
  const maliciousAst = [
    new ContentNode({
      type: ContentType.LINK,
      value: "Click me",
      attributes: { href: "javascript:alert(document.cookie)" },
    }),
    new ContentNode({
      type: ContentType.IMAGE,
      attributes: { src: "javascript:evil()", alt: "Evil Img" },
    }),
  ];

  const html = renderContentNodes(maliciousAst);

  if (html.includes('href="javascript:')) {
    throw new Error("Reader rendered unsafe javascript: link href!");
  }
  if (!html.includes('href="#"')) {
    throw new Error("Unsafe link href was not rewritten to '#' safe anchor");
  }
  if (html.includes('src="javascript:')) {
    throw new Error("Reader rendered unsafe javascript: img src!");
  }
});

// 19. Real IITM MCQ DOM Structure Verification
check("Category 19: Real IITM Single Correct MCQ DOM structure (button.choice[role=radio])", () => {
  const mcqHtml = `
  <app-assessment-question-view>
    <div class="question-header">
      <span class="marks">2 Marks</span>
    </div>
    <div class="backend-html">
      <p>Which feature is responsible for non-blocking I/O in JavaScript?</p>
    </div>
    <app-assessment-question>
      <ul _ngcontent-ng-c4216914947="" class="choices" role="radiogroup">
        <button _ngcontent-ng-c4216914947="" class="choice is-default ng-star-inserted" role="radio" aria-checked="false" aria-disabled="false">
          <div _ngcontent-ng-c4216914947="" class="row">
            <span _ngcontent-ng-c4216914947="" class="choice-indicator">
              <span _ngcontent-ng-c4216914947="" class="radio ng-star-inserted"></span>
            </span>
            <span _ngcontent-ng-c4216914947="" class="choice-letter">A.</span>
            <span _ngcontent-ng-c4216914947="" class="choice-text backend-html" style="font-size: 14px;">DOM Manipulation</span>
          </div>
        </button>
        <button _ngcontent-ng-c4216914947="" class="choice is-default ng-star-inserted" role="radio" aria-checked="false" aria-disabled="false">
          <div _ngcontent-ng-c4216914947="" class="row">
            <span _ngcontent-ng-c4216914947="" class="choice-indicator">
              <span _ngcontent-ng-c4216914947="" class="radio ng-star-inserted"></span>
            </span>
            <span _ngcontent-ng-c4216914947="" class="choice-letter">B.</span>
            <span _ngcontent-ng-c4216914947="" class="choice-text backend-html" style="font-size: 14px;">Asynchronous Processing</span>
          </div>
        </button>
        <button _ngcontent-ng-c4216914947="" class="choice is-default ng-star-inserted" role="radio" aria-checked="true" aria-disabled="false">
          <div _ngcontent-ng-c4216914947="" class="row">
            <span _ngcontent-ng-c4216914947="" class="choice-indicator">
              <span _ngcontent-ng-c4216914947="" class="radio ng-star-inserted"></span>
            </span>
            <span _ngcontent-ng-c4216914947="" class="choice-letter">C.</span>
            <span _ngcontent-ng-c4216914947="" class="choice-text backend-html" style="font-size: 14px;">Event Loop</span>
          </div>
        </button>
        <button _ngcontent-ng-c4216914947="" class="choice is-default ng-star-inserted" role="radio" aria-checked="false" aria-disabled="false">
          <div _ngcontent-ng-c4216914947="" class="row">
            <span _ngcontent-ng-c4216914947="" class="choice-indicator">
              <span _ngcontent-ng-c4216914947="" class="radio ng-star-inserted"></span>
            </span>
            <span _ngcontent-ng-c4216914947="" class="choice-letter">D.</span>
            <span _ngcontent-ng-c4216914947="" class="choice-text backend-html" style="font-size: 14px;">All of the above</span>
          </div>
        </button>
      </ul>
    </app-assessment-question>
  </app-assessment-question-view>`;

  const dom = parseHtmlToDom(mcqHtml);
  const mockPortal = {
    getAssessmentView: () => dom.querySelector("app-assessment-question-view"),
    getCurrentQuestionElement: () => dom.querySelector("app-assessment-question"),
    getReviewPanel: () => null,
    isReviewMode: () => false,
    getActiveLogicalNumber: () => 3,
    getActiveChip: () => null,
  };

  const extractor = new SemanticExtractor(mockPortal);
  const q = extractor.captureCurrentQuestion(2, false);

  if (q.type !== QuestionType.MCQ) {
    throw new Error(`Expected QuestionType.MCQ, got ${q.type}`);
  }
  if (q.options.length !== 4) {
    throw new Error(`Expected 4 options, got ${q.options.length}`);
  }
  if (q.options[0].letter !== "A" || q.options[0].selected !== false) {
    throw new Error("Option A error");
  }
  if (q.options[2].letter !== "C" || q.options[2].selected !== true) {
    throw new Error("Option C should be selected with letter C");
  }
  if (!q.options[2].content[0].value.includes("Event Loop")) {
    throw new Error(`Option C text mismatch: ${q.options[2].content[0].value}`);
  }
  if (q.status.answered !== true) {
    throw new Error("Question status should be answered = true");
  }
});

// 20. Real IITM Numerical DOM Structure Verification
check("Category 20: Real IITM Numerical DOM structure (textarea[inputmode=decimal])", () => {
  const numHtml = `
  <app-assessment-question-view>
    <div class="question-header">
      <span class="marks">1.5 Marks</span>
    </div>
    <div class="backend-html">
      <p>Calculate the effective capacity of the buffer in megabytes:</p>
    </div>
    <app-assessment-question>
      <textarea _ngcontent-ng-c3249990249="" class="textarea-field" id="app-textarea-0" placeholder="Enter your answer" inputmode="decimal" aria-describedby="app-textarea-0-help" aria-required="false" aria-invalid="false">42.5</textarea>
    </app-assessment-question>
  </app-assessment-question-view>`;

  const dom = parseHtmlToDom(numHtml);
  const mockPortal = {
    getAssessmentView: () => dom.querySelector("app-assessment-question-view"),
    getCurrentQuestionElement: () => dom.querySelector("app-assessment-question"),
    getReviewPanel: () => null,
    isReviewMode: () => false,
    getActiveLogicalNumber: () => 4,
    getActiveChip: () => null,
  };

  const extractor = new SemanticExtractor(mockPortal);
  const q = extractor.captureCurrentQuestion(3, false);

  if (q.type !== QuestionType.NUMERICAL) {
    throw new Error(`Expected QuestionType.NUMERICAL, got ${q.type}`);
  }
  if (q.marks !== 1.5) {
    throw new Error(`Expected 1.5 marks, got ${q.marks}`);
  }
  if (q.options.length !== 0) {
    throw new Error(`Numerical question should have 0 options, got ${q.options.length}`);
  }
  if (q.status.answered !== true) {
    throw new Error("Question status should be answered = true when textarea has content");
  }
});

if (!passed) {
  console.error("\n❌ Semantic Extractor verification FAILED.\n");
  process.exit(1);
} else {
  console.log("\nAll 20 semantic extractor verification tests passed successfully!\n");
}


