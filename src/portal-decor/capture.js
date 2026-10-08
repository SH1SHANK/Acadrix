/**
 * Portal Decor: Course Detection & Visibility Helpers.
 * 
 * Grade scraping and start-page deadline scraping have been completely removed.
 * Authoritative academic dates and deadlines come exclusively from
 * Supabase public.academic_events via AcademicEventRepository (§11, §12).
 */

import { IITM_SELECTORS } from "../portal/selectors.js";
import { portalDecorNormalizeText } from "./core.js";

/**
 * Extracts the active course key from top bar or side navigation.
 * @param {Document|Element} root
 * @returns {string} Normalized course key (e.g. "Sep 2026 - MAD II")
 */
export function getCourseKey(root = document) {
  if (!root) return "";
  const topBar = root.querySelector?.(IITM_SELECTORS.decor?.topBarTitle || ".top-bar-title");
  const topText = topBar?.textContent ? portalDecorNormalizeText(topBar.textContent) : "";
  if (topText) return topText;
  const sideNav = root.querySelector?.(IITM_SELECTORS.decor?.sideNavTitle || ".side-nav-title");
  return sideNav?.textContent ? portalDecorNormalizeText(sideNav.textContent) : "";
}

/**
 * Checks whether an element is actively rendered and visible in DOM.
 * @param {Element} el
 * @returns {boolean}
 */
export function isElementVisible(el) {
  if (!el) return false;
  try {
    const win = el.ownerDocument?.defaultView || (typeof window !== "undefined" ? window : null);
    if (win?.getComputedStyle) {
      const style = win.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        return false;
      }
    }
    if (typeof el.getClientRects === "function") {
      const rects = el.getClientRects();
      if (rects && typeof rects.length === "number") {
        return rects.length > 0;
      }
    }
  } catch {}
  return true;
}

/**
 * @deprecated Scraping removed (§11). Deadlines are sourced from public.academic_events.
 */
export async function captureStartPage() {
  return null;
}

/**
 * @deprecated Scraping removed (§12). Grades are out of scope for Acadrix.
 */
export async function captureGrades() {
  return { ok: false, reason: "GRADE_SCRAPING_REMOVED", records: [] };
}
