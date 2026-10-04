/**
 * Assessment Extraction Boundary.
 * 
 * TEMPORARY LEGACY ADAPTER (Phase 1):
 * Wraps raw HTML snapshotting behind the Canonical Document Model contract.
 * In Phase 3, this will be replaced with a true semantic AST extractor (TreeWalker,
 * LaTeX recovery, code blocks, tables, and asset bundling).
 */

import { $$, isEscapedHtml, lowestCommonAncestor } from "../utils/dom.js";
import { IITM_SELECTORS } from "../portal/selectors.js";
import { QuestionNode } from "../model/document.js";

export class AssessmentExtractor {
  constructor(portal) {
    this.portal = portal;
  }

  /**
   * Captures the question stem from the active assessment view.
   */
  grabStem(reviewMode = false) {
    const view = this.portal.getAssessmentView();
    const q = this.portal.getCurrentQuestionElement();
    if (!view || !q) return "";

    const rp = reviewMode ? this.portal.getReviewPanel() : null;
    const seen = new Set();

    const stems = $$(IITM_SELECTORS.content.backendHtml, view)
      .filter((el) => !q.contains(el) && !(rp && rp.contains(el)))
      .map((el) => el.outerHTML)
      .filter((html) => !seen.has(html) && seen.add(html)); // Deduplicate responsive variants

    if (stems.length) return stems.join("");

    const leg = q.querySelector(IITM_SELECTORS.content.legend);
    if (leg) {
      const content = isEscapedHtml(leg) ? leg.textContent : leg.innerHTML;
      return `<div>${content}</div>`;
    }

    return "";
  }

  /**
   * Captures the options/answer controls HTML from the active assessment view.
   * Strips any interactive bindings so it acts purely as a read-only snapshot.
   */
  grabOptions(reviewMode = false) {
    const q = this.portal.getCurrentQuestionElement();
    if (!q) return "";

    if (!reviewMode) {
      // Clone element to prevent any mutations on live form
      const clone = q.cloneNode(true);
      // Make all inputs read-only / disabled
      clone.querySelectorAll("input, textarea, select, button").forEach((el) => {
        el.setAttribute("disabled", "true");
        el.setAttribute("tabindex", "-1");
      });
      return clone.innerHTML;
    }

    const rp = this.portal.getReviewPanel();
    if (rp) return rp.outerHTML;

    // Fallback: lowest common ancestor of review banner and question
    const view = this.portal.getAssessmentView();
    const banner = $$("*", view)
      .filter(
        (e) =>
          IITM_SELECTORS.metadata.reviewDetectRegex.test(e.textContent || "") && !e.contains(q)
      )
      .sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length)[0];

    const target = banner ? lowestCommonAncestor(banner, q) : q;
    return target ? target.outerHTML : q.outerHTML;
  }

  /**
   * Captures the active question into a Canonical QuestionNode.
   */
  captureCurrentQuestion(index = 0, reviewMode = false) {
    const stemHtml = this.grabStem(reviewMode);
    const optsHtml = this.grabOptions(reviewMode);

    return QuestionNode.fromLegacySnapshot({
      stemHtml,
      optsHtml,
      index,
      isReview: reviewMode,
    });
  }
}
