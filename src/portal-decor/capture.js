/**
 * Portal Decor: Course Detection & Visibility Helpers.
 * 
 * Grade scores are stored locally for the grade calculator; deadline scraping
 * remains disabled and authoritative dates come from academic_events.
 */

import { portalDecorNormalizeText } from "./core.js";
import { IITM_SELECTORS } from "../portal/selectors.js";
import { parseCourseCode, parseTermId, createExternalAssignmentId, parseScore } from "./core.js";

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
 * Captures graded assignment scores from the active Grades page into local storage.
 * Never sends student scores to Supabase.
 */
export async function captureGrades(root = document, gradesStore, now = () => Date.now()) {
  if (!root?.querySelector || (!gradesStore?.captureRecord && !gradesStore?.captureRecords)) return { ok: false, reason: "MISSING_STORE", records: [] };
  const courseKey = getCourseKey(root);
  const termId = parseTermId(courseKey);
  const courseCode = parseCourseCode(courseKey, root.querySelector(IITM_SELECTORS.metadata.courseTitle)?.textContent || "");
  if (!courseKey || courseCode === "UNKNOWN_COURSE") return { ok: false, reason: "UNKNOWN_COURSE", records: [] };

  const rows = [...(root.querySelectorAll(IITM_SELECTORS.decor.gradeRows) || [])];
  const records = [];
  for (const row of rows) {
    const titleLink = row.querySelector(IITM_SELECTORS.decor.gradeTitle);
    const title = portalDecorNormalizeText(titleLink?.textContent || "");
    if (!title || /activity questions|not graded/i.test(title)) continue;
    const values = [...(row.querySelectorAll(IITM_SELECTORS.decor.gradeValues) || [])];
    const scoreRaw = portalDecorNormalizeText(values[0]?.textContent || "");
    const { score } = parseScore(scoreRaw);
    if (score === null) continue;
    const module = portalDecorNormalizeText(row.closest?.(".module-container")?.querySelector?.(IITM_SELECTORS.decor.gradeModule)?.textContent || "");
    const record = {
      termId,
      courseCode,
      externalAssignmentId: createExternalAssignmentId(termId, courseCode, module, title, titleLink),
      title,
      module,
      yourScore: score,
      yourScoreRaw: scoreRaw,
      scoreStatus: "GRADED",
      source: "grades-page-local",
      capturedAt: now(),
    };
    records.push(record);
  }
  if (gradesStore.captureRecords) await gradesStore.captureRecords(records);
  else for (const record of records) await gradesStore.captureRecord(record);
  return { ok: true, records };
}
