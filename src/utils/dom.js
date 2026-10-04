/**
 * DOM utility helpers.
 */

export const $ = (selector, root = document) => root ? root.querySelector(selector) : null;

export const $$ = (selector, root = document) => root ? [...root.querySelectorAll(selector)] : [];

export const escapeHtml = (str = "") =>
  str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

export const isEscapedHtml = (el) =>
  el && el.children.length === 0 && /<[a-z!/][^>]*>/i.test(el.textContent);

export const lowestCommonAncestor = (a, b) => {
  if (!a || !b) return null;
  const ancestors = new Set();
  for (let n = a; n; n = n.parentElement) ancestors.add(n);
  for (let n = b; n; n = n.parentElement) if (ancestors.has(n)) return n;
  return null;
};

/**
 * Sanitizes SVG source markup according to strict vector safety policy.
 * Strips executable tags (<script>, <foreignObject>), on* event attributes,
 * javascript: URLs, and unsafe external references.
 */
export const sanitizeSvgSource = (svgSource = "") => {
  if (typeof svgSource !== "string") return "";
  return svgSource
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script\s*>/gi, "")
    .replace(/<foreignObject\b[^<]*(?:(?!<\/foreignObject>)<[^<]*)*<\/foreignObject\s*>/gi, "")
    .replace(/\s+on[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(?:href|xlink:href)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, 'href="#"')
    .replace(/(?:href|xlink:href)\s*=\s*(?:"data:text\/html[^"]*"|'data:text\/html[^']*')/gi, 'href="#"');
};

/**
 * Sanitizes MathML markup by stripping scripts and event handlers.
 */
export const sanitizeMathML = (mathml = "") => {
  if (typeof mathml !== "string") return "";
  return mathml
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script\s*>/gi, "")
    .replace(/\s+on[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(?:href|xlink:href)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, 'href="#"');
};

