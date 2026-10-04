/** Shared Reader content renderer. */

import { escapeHtml, sanitizeSvgSource, sanitizeMathML } from "../utils/dom.js";
import { ContentType, MathFormat, MathType } from "../model/types.js";
import { renderVisualMath } from "../utils/math.js";

export function renderContentNodes(nodes, options = {}) {
  if (!Array.isArray(nodes) || nodes.length === 0) return "";
  const { visualMath = false } = options;

  return nodes
    .map((node) => {
      if (!node) return "";

      const attrs = node.attributes || {};
      const childrenHtml =
        node.children && node.children.length > 0
          ? renderContentNodes(node.children, options)
          : "";

      switch (node.type) {
        case ContentType.PARAGRAPH: {
          const content = childrenHtml || escapeHtml(node.value);
          return `<p>${content}</p>`;
        }

        case ContentType.HEADING: {
          const level = Math.min(Math.max(attrs.level || 1, 1), 6);
          const content = childrenHtml || escapeHtml(node.value);
          return `<h${level}>${content}</h${level}>`;
        }

        case ContentType.TEXT: {
          let text = escapeHtml(node.value);
          if (attrs.bold) text = `<strong>${text}</strong>`;
          if (attrs.italic) text = `<em>${text}</em>`;
          if (attrs.underline) text = `<u>${text}</u>`;
          if (attrs.strike) text = `<del>${text}</del>`;
          if (attrs.sub) text = `<sub>${text}</sub>`;
          if (attrs.sup) text = `<sup>${text}</sup>`;
          return text;
        }

        case ContentType.INLINE_CODE:
          return `<code>${escapeHtml(node.value)}</code>`;

        case ContentType.CODE_BLOCK: {
          const lang = attrs.language ? ` class="language-${escapeHtml(attrs.language)}"` : "";
          return `<pre><code${lang}>${escapeHtml(node.value)}</code></pre>`;
        }

        case ContentType.MATH: {
          const format = attrs.format || MathFormat.TEX;
          const isDisplay = attrs.mathType === "display" || attrs.mathType === MathType.DISPLAY;
          const tex = node.value || "";
          const mathml = attrs.mathml || (format === MathFormat.MATHML ? tex : "");

          if (visualMath) {
            return renderVisualMath(tex, {
              isDisplay,
              mathml,
              fallbackText: attrs.texUnavailable ? tex : "",
            });
          }

          if (format === MathFormat.TEX) {
            return isDisplay
              ? `<div class="katex-display math-tex">\\[${escapeHtml(node.value)}\\]</div>`
              : `<span class="katex math-inline">\\(${escapeHtml(node.value)}\\)</span>`;
          } else if (format === MathFormat.MATHML) {
            return `<span class="mathml-wrap">${sanitizeMathML(node.value)}</span>`;
          }
          return `<span class="math-plain">${escapeHtml(node.value)}</span>`;
        }

        case ContentType.LIST: {
          const tag = attrs.ordered ? "ol" : "ul";
          const start = attrs.ordered && attrs.start > 1 ? ` start="${attrs.start}"` : "";
          return `<${tag}${start}>${childrenHtml}</${tag}>`;
        }

        case ContentType.LIST_ITEM: {
          const content = childrenHtml || escapeHtml(node.value);
          return `<li>${content}</li>`;
        }

        case ContentType.BLOCKQUOTE: {
          const content = childrenHtml || escapeHtml(node.value);
          return `<blockquote>${content}</blockquote>`;
        }

        case ContentType.TABLE: {
          const caption = attrs.caption ? `<caption>${escapeHtml(attrs.caption)}</caption>` : "";
          const rows = node.children || [];

          const theadRows = [];
          const tbodyRows = [];

          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const isHeaderRow =
              row.children &&
              row.children.length > 0 &&
              row.children.every((c) => c.attributes?.isHeader);

            if (isHeaderRow && tbodyRows.length === 0) {
              theadRows.push(row);
            } else {
              tbodyRows.push(row);
            }
          }

          let tableInner = caption;
          if (theadRows.length > 0) {
            tableInner += `<thead>${renderContentNodes(theadRows, options)}</thead>`;
          }
          if (tbodyRows.length > 0) {
            tableInner += `<tbody>${renderContentNodes(tbodyRows, options)}</tbody>`;
          } else if (theadRows.length === 0) {
            tableInner += `<tbody>${childrenHtml}</tbody>`;
          }

          return `<div class="saq-table-wrap"><table class="saq-table">${tableInner}</table></div>`;
        }

        case ContentType.TABLE_ROW:
          return `<tr>${childrenHtml}</tr>`;

        case ContentType.TABLE_CELL: {
          const tag = attrs.isHeader ? "th" : "td";
          const colspan = attrs.colspan > 1 ? ` colspan="${attrs.colspan}"` : "";
          const rowspan = attrs.rowspan > 1 ? ` rowspan="${attrs.rowspan}"` : "";
          const validAlign = ["left", "center", "right", "justify"].includes(attrs.align) ? attrs.align : "left";
          const align = validAlign !== "left" ? ` align="${validAlign}" style="text-align:${validAlign};"` : "";
          const content = childrenHtml || escapeHtml(node.value);
          return `<${tag}${colspan}${rowspan}${align}>${content}</${tag}>`;
        }

        case ContentType.IMAGE: {
          const rawSrc = (attrs.src || "").trim();
          const isSafeSrc = /^(https?:|\/|data:image\/)/i.test(rawSrc);
          const src = isSafeSrc ? escapeHtml(rawSrc) : "";
          const alt = escapeHtml(attrs.alt || "");
          const title = attrs.title ? ` title="${escapeHtml(attrs.title)}"` : "";
          const width = attrs.width ? ` width="${escapeHtml(String(attrs.width))}"` : "";
          const height = attrs.height ? ` height="${escapeHtml(String(attrs.height))}"` : "";
          return `<img src="${src}" alt="${alt}"${title}${width}${height} loading="lazy" decoding="async" />`;
        }

        case ContentType.FIGURE: {
          const caption = attrs.caption ? `<figcaption>${escapeHtml(attrs.caption)}</figcaption>` : "";
          return `<figure>${childrenHtml}${caption}</figure>`;
        }

        case ContentType.SVG:
          return `<span class="saq-svg-wrap">${sanitizeSvgSource(node.value || "")}</span>`;

        case ContentType.LINK: {
          const rawHref = (attrs.href || "").trim();
          const isSafeHref = /^(https?:|\/|#|mailto:)/i.test(rawHref);
          const href = isSafeHref ? escapeHtml(rawHref) : "#";
          const title = attrs.title ? ` title="${escapeHtml(attrs.title)}"` : "";
          const content = childrenHtml || escapeHtml(node.value);
          return `<a href="${href}"${title} target="_blank" rel="noopener noreferrer">${content}</a>`;
        }

        case ContentType.LINE_BREAK:
          return `<br />`;

        case ContentType.HTML_BLOCK:
          return node.value || "";

        default:
          return childrenHtml || escapeHtml(node.value || "");
      }
    })
    .join("");
}
