/**
 * Portal Decor: Metadata Capture for Start Page and Grades.
 * Pure DOM reader that populates the portal-decor store without touching host state.
 */

import { IITM_SELECTORS } from "../portal/selectors.js";
import {
  parseDeadline,
  effectiveClass,
  classifyByTitle,
  assignmentKey,
  portalDecorNormalizeText,
} from "./core.js";

/**
 * Extracts the active course key from top bar or side navigation.
 * @param {Document|Element} root
 * @returns {string} Normalized course key (e.g. "Sep 2026 - MAD II")
 */
export function getCourseKey(root = document) {
  const topBar = root.querySelector?.(IITM_SELECTORS.decor.topBarTitle);
  const topText = topBar?.textContent ? portalDecorNormalizeText(topBar.textContent) : "";
  if (topText) return topText;
  const sideNav = root.querySelector?.(IITM_SELECTORS.decor.sideNavTitle);
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
 * Captures assessment metadata from an active assessment start page.
 * @param {Document|Element} doc
 * @param {object} store
 * @param {Function|number} now
 * @returns {Promise<object|null>}
 */
export async function captureStartPage(doc, store, now = () => Date.now()) {
  const root = doc.querySelector?.(IITM_SELECTORS.decor.startPageRoot);
  if (!root) return null;

  const courseKey = getCourseKey(doc);
  const titleEl = doc.querySelector?.(IITM_SELECTORS.decor.startPageTitle);
  const unitEl = doc.querySelector?.(IITM_SELECTORS.decor.startPageBreadcrumb);

  const title = titleEl?.textContent ? portalDecorNormalizeText(titleEl.textContent) : "";
  const unit = unitEl?.textContent ? portalDecorNormalizeText(unitEl.textContent) : "";

  if (!courseKey || !title || !unit) return null;

  let modeRaw = "";
  let deadlineRaw = "";

  const rows = doc.querySelectorAll?.(IITM_SELECTORS.decor.startPageCardRow) || [];
  for (const row of rows) {
    const keyEl = row.querySelector?.(IITM_SELECTORS.decor.startPageKey);
    const valEl = row.querySelector?.(IITM_SELECTORS.decor.startPageValue);
    const keyText = keyEl?.textContent ? portalDecorNormalizeText(keyEl.textContent) : "";
    if (keyText.toLowerCase() === "mode") {
      modeRaw = valEl?.textContent ? portalDecorNormalizeText(valEl.textContent) : "";
    } else if (keyText.toLowerCase() === "deadline") {
      const dueLabel = valEl?.querySelector?.(IITM_SELECTORS.decor.startPageDeadline);
      deadlineRaw = portalDecorNormalizeText(dueLabel?.textContent || valEl?.textContent || "");
    }
  }

  const parsed = deadlineRaw ? parseDeadline(deadlineRaw) : { raw: "", iso: null, tz: null };
  const mode = effectiveClass(modeRaw, title);
  const key = assignmentKey(courseKey, unit, title);
  const capturedAt = typeof now === "function" ? now() : Number(now || Date.now());

  return store.capture(courseKey, key, {
    mode,
    modeRaw,
    deadlineIso: parsed.iso,
    deadlineRaw: parsed.raw,
    source: "start",
    capturedAt,
  });
}

/**
 * Captures deadline and grade information from the grades page.
 * @param {Document|Element} doc
 * @param {object} store
 * @param {Function|number} now
 * @returns {Promise<Array<object>|null>}
 */
export async function captureGrades(doc, store, now = () => Date.now()) {
  const root = doc.querySelector?.(IITM_SELECTORS.decor.gradesRoot);
  if (!root) return null;

  const courseKey = getCourseKey(doc);
  if (!courseKey) return null;

  const modules = doc.querySelectorAll?.(IITM_SELECTORS.decor.gradesModule) || [];
  const capturedAt = typeof now === "function" ? now() : Number(now || Date.now());
  const results = [];

  for (const mod of modules) {
    const unitEl = mod.querySelector?.(IITM_SELECTORS.decor.gradesModuleTitle);
    const unitTitle = unitEl?.textContent ? portalDecorNormalizeText(unitEl.textContent) : "";
    if (!unitTitle) continue;

    const items = mod.querySelectorAll?.(IITM_SELECTORS.decor.gradesDesktopItem) || [];
    for (const item of items) {
      const titleLink = item.querySelector?.(IITM_SELECTORS.decor.gradesItemTitleLink);
      const title = titleLink?.textContent ? portalDecorNormalizeText(titleLink.textContent) : "";
      if (!title) continue;

      const subtitle = item.querySelector?.(IITM_SELECTORS.decor.gradesItemSubtitle);
      let deadlineIso = null;
      let deadlineRaw = "";

      const pendingEl = subtitle?.querySelector?.(IITM_SELECTORS.decor.gradesPendingExclude);
      const isPending = pendingEl ? isElementVisible(pendingEl) : false;

      if (isPending) {
        deadlineRaw = "Due Date Pending";
        deadlineIso = null;
      } else if (subtitle) {
        let ownText = "";
        for (const child of subtitle.childNodes || []) {
          if (child === pendingEl) continue;
          if (child.nodeType === 3) {
            ownText += child.nodeValue || "";
          } else if (child.nodeType === 1 && child !== pendingEl) {
            ownText += child.textContent || "";
          }
        }
        const dueMatch = ownText.match(/\(Due:\s*(.+?)\)/i);
        if (dueMatch) {
          const rawMatch = portalDecorNormalizeText(dueMatch[1]);
          const parsed = parseDeadline(rawMatch);
          deadlineRaw = parsed.raw;
          deadlineIso = parsed.iso;
        }
      }

      const mode = classifyByTitle(title);
      const key = assignmentKey(courseKey, unitTitle, title);

      const captured = await store.capture(courseKey, key, {
        mode,
        modeRaw: "",
        deadlineIso,
        deadlineRaw,
        source: "grades",
        capturedAt,
      });
      results.push(captured);
    }
  }

  return results;
}
