/**
 * Visual Mathematics Rendering Utility.
 * 
 * Uses KaTeX for canonical MATH node rendering.
 * Priority order:
 * 1. Original TeX (rendered via KaTeX)
 * 2. MathML fallback (sanitized native MathML Core)
 * 3. Plain text fallback (clean italic/serif representation)
 */

import katex from "katex";
import { escapeHtml, sanitizeMathML } from "./dom.js";

/**
 * Renders mathematical expressions visually using KaTeX with MathML fallback.
 * 
 * @param {string} tex LaTeX TeX source
 * @param {Object} [options]
 * @param {boolean} [options.isDisplay=false]
 * @param {string} [options.mathml=""]
 * @param {string} [options.fallbackText=""]
 * @returns {string} Visual HTML string
 */
export function renderVisualMath(tex, { isDisplay = false, mathml = "", fallbackText = "" } = {}) {
  const cleanTex = (tex || "").trim();

  // Priority 1: Original TeX via KaTeX
  if (cleanTex) {
    const k = typeof katex !== "undefined" && katex?.renderToString
      ? katex
      : (typeof globalThis !== "undefined" && globalThis.katex?.renderToString
          ? globalThis.katex
          : (typeof window !== "undefined" && (window.katex || window.parent?.katex)));

    if (k && typeof k.renderToString === "function") {
      try {
        return k.renderToString(cleanTex, {
          displayMode: isDisplay,
          throwOnError: true,
          output: "htmlAndMathml",
        });
      } catch {
        // Fall through to MathML fallback on unrenderable TeX
      }
    }
  }

  // Priority 2: MathML fallback
  if (mathml && typeof mathml === "string" && mathml.trim()) {
    const sanitized = sanitizeMathML(mathml.trim());
    if (sanitized) {
      const wrapTag = isDisplay ? "div" : "span";
      const wrapCls = isDisplay ? "katex-display math-display" : "katex math-inline";
      return `<${wrapTag} class="${wrapCls}">${sanitized}</${wrapTag}>`;
    }
  }

  // Priority 3: Plain text fallback
  const rawText = fallbackText || cleanTex || "";
  return `<span class="math-plain">${escapeHtml(rawText)}</span>`;
}
