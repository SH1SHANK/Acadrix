/**
 * Portal Decor: Metadata Capture for Start Page and Authoritative IITM Grades.
 * Pure DOM reader that populates the local store without touching host page state.
 */

import { IITM_SELECTORS } from "../portal/selectors.js";
import {
  parseDeadline,
  effectiveClass,
  classifyByTitle,
  assignmentKey,
  portalDecorNormalizeText,
  parseScore,
  deriveGradeStatus,
  deriveSubmissionStatus,
  parseAssignmentType,
  parseTermId,
  parseCourseCode,
  createExternalAssignmentId,
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
 * @param {Function|number} [now]
 * @returns {Promise<object|null>}
 */
export async function captureStartPage(doc, store, now = () => Date.now()) {
  const root = doc.querySelector?.(IITM_SELECTORS.decor.startPageRoot);
  if (!root) return null;

  const courseKey = getCourseKey(doc);
  const titleEl = doc.querySelector?.(IITM_SELECTORS.decor.startPageTitle) ||
    doc.querySelector?.("button.child-row.selected .child-title, .child-row.selected .child-title, button.child-row.active .child-title");
  
  // Try breadcrumbs, parent title, or active unit header
  let unit = "";
  const unitEl = doc.querySelector?.(IITM_SELECTORS.decor.startPageBreadcrumb);
  if (unitEl?.textContent) {
    unit = portalDecorNormalizeText(unitEl.textContent);
  }
  if (!unit) {
    const activeHeader = doc.querySelector?.(".unit-header.active .unit-title, .unit-header[aria-expanded='true'] .unit-title, .unit-container:has(.child-row.selected) .unit-title, .unit-title");
    unit = activeHeader?.textContent ? portalDecorNormalizeText(activeHeader.textContent) : "";
  }

  const title = titleEl?.textContent ? portalDecorNormalizeText(titleEl.textContent) : "";

  if (!courseKey || !title) return null;

  if (!unit) {
    const weekMatch = title.match(/\bweek[\s\-_:]*(\d{1,2})\b/i);
    if (weekMatch) {
      unit = `Week ${weekMatch[1]}`;
    }
  }
  if (!unit) return null;

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

  // Also check top-level timer if not found in card rows
  if (!deadlineRaw) {
    const topTimer = doc.querySelector?.(IITM_SELECTORS.decor.startPageDeadline);
    if (topTimer) {
      deadlineRaw = portalDecorNormalizeText(topTimer.textContent || "");
    }
  }

  const parsed = deadlineRaw ? parseDeadline(deadlineRaw) : { raw: "", iso: null, tz: null };
  const mode = effectiveClass(modeRaw, title);
  const key = assignmentKey(courseKey, unit, title);
  const capturedAt = typeof now === "function" ? now() : Number(now || Date.now());
  const capturedAtIso = new Date(capturedAt).toISOString();

  // Determine submission status from start page evidence
  let submissionStatus = "UNKNOWN";
  const timerEl = doc.querySelector?.(IITM_SELECTORS.metadata?.timer || "app-submission-timer");
  const timerText = timerEl?.textContent ? portalDecorNormalizeText(timerEl.textContent) : "";
  const rootText = root?.textContent ? portalDecorNormalizeText(root.textContent) : "";

  if (/submission recorded|submitted/i.test(timerText) || /submission recorded/i.test(rootText)) {
    submissionStatus = "SUBMITTED";
  } else if (/time remaining/i.test(timerText) || (/start assessment/i.test(rootText) && /time remaining/i.test(rootText))) {
    submissionStatus = "NOT_SUBMITTED";
  } else {
    const startBtn = doc.querySelector?.("button.start-btn, button.btn-primary, button");
    const startBtnText = startBtn?.textContent ? portalDecorNormalizeText(startBtn.textContent) : "";
    if (/start assessment/i.test(startBtnText) && /time remaining/i.test(rootText)) {
      submissionStatus = "NOT_SUBMITTED";
    }
  }

  if (store?.capture) {
    return store.capture(courseKey, key, {
      mode,
      modeRaw,
      deadlineIso: parsed.iso,
      deadlineRaw: parsed.raw,
      source: "start",
      deadlineSource: parsed.iso ? "PORTAL" : null,
      deadlineVerifiedAt: parsed.iso ? capturedAtIso : null,
      submissionStatus,
      submissionStatusSource: "start",
      submissionCheckedAt: capturedAtIso,
      capturedAt,
    });
  }
  return null;
}

/**
 * Captures authoritative grade data from the IITM Grades page.
 * Transforms into Canonical Grade Records, deduplicates desktop/mobile representations,
 * and persists to acx:grades:v1 and acx:pending-sync:v1.
 * 
 * @param {Document|Element} doc
 * @param {object} [gradesStore] Canonical grade store (acx:grades:v1)
 * @param {object} [pendingQueue] Offline pending sync queue (acx:pending-sync:v1)
 * @param {object} [decorStore] Legacy deadlines store (acx:deadlines:v1)
 * @param {Function|number} [now]
 * @returns {Promise<{ ok: boolean, reason?: string, termId?: string, courseCode?: string, records: Array<object> }>}
 */
export async function captureGrades(
  doc,
  gradesStore = null,
  pendingQueue = null,
  decorStore = null,
  now = () => Date.now(),
) {
  const root = doc.querySelector?.(IITM_SELECTORS.decor.gradesRoot);
  if (!root) {
    return { ok: false, reason: "NOT_GRADES_PAGE", records: [] };
  }

  const courseKey = getCourseKey(doc);
  if (!courseKey) {
    return { ok: false, reason: "MISSING_COURSE_CONTEXT", records: [] };
  }

  const termId = parseTermId(courseKey);
  const courseCode = parseCourseCode(courseKey);

  const modules = doc.querySelectorAll?.(IITM_SELECTORS.decor.gradesModule) || [];
  if (modules.length === 0) {
    // If root exists but modules container is completely missing/empty, signal DOM not ready
    return { ok: false, reason: "DOM_NOT_READY", termId, courseCode, records: [] };
  }

  const capturedTimestamp = typeof now === "function" ? now() : Number(now || Date.now());
  const capturedAtIso = new Date(capturedTimestamp).toISOString();
  const nowDate = new Date(capturedTimestamp);

  const dedupeMap = new Map();
  const orderedKeys = [];

  for (const mod of modules) {
    const unitEl = mod.querySelector?.(IITM_SELECTORS.decor.gradesModuleTitle);
    const unitTitle = unitEl?.textContent ? portalDecorNormalizeText(unitEl.textContent) : "";
    if (!unitTitle) continue;

    const desktopItems = mod.querySelectorAll?.(IITM_SELECTORS.decor.gradesDesktopItem) || [];
    const mobileItems = mod.querySelectorAll?.(IITM_SELECTORS.decor.gradesMobileItem) || [];

    // Helper to process an item row (desktop or mobile)
    const processItem = (item, isMobile = false) => {
      const titleLink = isMobile
        ? item.querySelector?.(IITM_SELECTORS.decor.gradesMobileTitle)
        : item.querySelector?.(IITM_SELECTORS.decor.gradesItemTitleLink);

      const title = titleLink?.textContent ? portalDecorNormalizeText(titleLink.textContent) : "";
      if (!title) return;

      const externalAssignmentId = createExternalAssignmentId(
        termId,
        courseCode,
        unitTitle,
        title,
        titleLink,
      );

      const subtitle = item.querySelector?.(IITM_SELECTORS.decor.gradesItemSubtitle);
      const assignmentType = parseAssignmentType(subtitle?.textContent || "");
      let deadlineIso = null;
      let deadlineRaw = "";
      let evaluationStatus = "normal";

      const pendingEl = subtitle?.querySelector?.(IITM_SELECTORS.decor.gradesPendingExclude);
      const isPending = pendingEl ? isElementVisible(pendingEl) : false;
      const pendingText = pendingEl?.textContent ? portalDecorNormalizeText(pendingEl.textContent) : "";

      if (isPending && /due date pending/i.test(pendingText)) {
        deadlineRaw = "Due Date Pending";
        deadlineIso = null;
        evaluationStatus = "Due Date Pending";
      } else if (isPending && /evaluation pending/i.test(pendingText)) {
        evaluationStatus = "Evaluation Pending";
      }

      if (subtitle) {
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
          if (!deadlineRaw) deadlineRaw = parsed.raw;
          deadlineIso = parsed.iso;
        }
      }

      let yourScoreObj = { score: null, raw: "" };
      let peerAvgObj = { score: null, raw: "" };
      let medianScoreObj = { score: null, raw: "" };

      if (!isMobile) {
        const valueEls = item.querySelectorAll?.(IITM_SELECTORS.decor.gradesDesktopItemValue) || [];
        yourScoreObj = parseScore(valueEls[0]?.textContent || "");
        peerAvgObj = parseScore(valueEls[1]?.textContent || "");
        medianScoreObj = parseScore(valueEls[2]?.textContent || "");
      } else {
        const valueEls = item.querySelectorAll?.(IITM_SELECTORS.decor.gradesMobileItemValue) || [];
        for (const valEl of valueEls) {
          const text = portalDecorNormalizeText(valEl.textContent || "");
          if (/your score/i.test(text)) {
            yourScoreObj = parseScore(text);
          } else if (/peer average/i.test(text)) {
            peerAvgObj = parseScore(text);
          } else if (/median score/i.test(text)) {
            medianScoreObj = parseScore(text);
          }
        }
      }

      if (yourScoreObj.score !== null) {
        evaluationStatus = "Evaluated";
      }

      const scoreStatus = deriveGradeStatus(
        yourScoreObj.score,
        evaluationStatus,
        deadlineIso,
        nowDate,
      );

      const submissionStatus = deriveSubmissionStatus({
        yourScore: yourScoreObj.score,
        evaluationStatus,
        deadlineIso,
        now: nowDate,
      });

      // Construct canonical record
      const record = {
        termId,
        courseCode,
        externalAssignmentId,
        canonicalAssessmentId: null, // Separated from formula recognition in Phase 2
        module: unitTitle,
        title,
        assignmentType,
        yourScore: yourScoreObj.score,
        yourScoreRaw: yourScoreObj.raw || null,
        peerAverage: peerAvgObj.score,
        medianScore: medianScoreObj.score,
        scoreStatus,
        evaluationStatus,
        submissionStatus,
        submissionStatusSource: "grades",
        submissionCheckedAt: capturedAtIso,
        dueDate: deadlineIso,
        dueDateText: deadlineRaw || null,
        source: "grades",
        deadlineSource: deadlineIso ? "PORTAL" : null,
        deadlineVerifiedAt: deadlineIso ? capturedAtIso : null,
        capturedAt: capturedAtIso,
      };

      // Deduplicate desktop/mobile representations conservatively
      if (dedupeMap.has(externalAssignmentId)) {
        const existing = dedupeMap.get(externalAssignmentId);
        const merged = {
          ...existing,
          ...record,
          yourScore: record.yourScore !== null ? record.yourScore : existing.yourScore,
          yourScoreRaw: record.yourScoreRaw || existing.yourScoreRaw,
          peerAverage: record.peerAverage !== null ? record.peerAverage : existing.peerAverage,
          medianScore: record.medianScore !== null ? record.medianScore : existing.medianScore,
          submissionStatus:
            existing.submissionStatus === "SUBMITTED" || record.submissionStatus === "SUBMITTED"
              ? "SUBMITTED"
              : record.submissionStatus !== "UNKNOWN"
              ? record.submissionStatus
              : existing.submissionStatus || "UNKNOWN",
          submissionStatusSource: record.submissionStatusSource || existing.submissionStatusSource,
          submissionCheckedAt: record.submissionCheckedAt || existing.submissionCheckedAt,
          dueDate: record.dueDate || existing.dueDate,
          dueDateText: record.dueDateText || existing.dueDateText,
          deadlineSource: record.deadlineSource || existing.deadlineSource || null,
          deadlineVerifiedAt: record.deadlineVerifiedAt || existing.deadlineVerifiedAt || null,
        };
        dedupeMap.set(externalAssignmentId, merged);
      } else {
        dedupeMap.set(externalAssignmentId, record);
        orderedKeys.push(externalAssignmentId);
      }
    };

    // 1. Process Desktop rows
    if (desktopItems.length > 0) {
      for (const item of desktopItems) {
        processItem(item, false);
      }
    }

    // 2. Process Mobile rows (merged & deduplicated against desktop)
    if (mobileItems.length > 0) {
      for (const item of mobileItems) {
        processItem(item, true);
      }
    }
  }

  // Preserve deterministic portal order
  const canonicalRecords = orderedKeys.map((key) => dedupeMap.get(key));

  // 1. Persist to Canonical Grade Store (acx:grades:v1)
  if (gradesStore?.saveCourseGrades) {
    await gradesStore.saveCourseGrades(termId, courseCode, canonicalRecords);
  }

  // 2. Enqueue into Offline Pending Queue (acx:pending-sync:v1)
  if (pendingQueue?.enqueue) {
    await pendingQueue.enqueue(canonicalRecords);
  }

  // 3. Backward Compatibility: Populate decorStore for Sidebar Decorator
  if (decorStore?.capture) {
    for (const rec of canonicalRecords) {
      const mode = classifyByTitle(rec.title);
      const decorKey = assignmentKey(courseKey, rec.module, rec.title);
      await decorStore.capture(courseKey, decorKey, {
        id: decorKey,
        courseKey,
        module: rec.module,
        assignmentId: decorKey,
        title: rec.title,
        type: rec.assignmentType,
        mode,
        modeRaw: "",
        dueDate: rec.dueDate,
        dueDateText: rec.dueDateText,
        deadlineIso: rec.dueDate,
        deadlineRaw: rec.dueDateText,
        yourScore: rec.yourScore,
        yourScoreRaw: rec.yourScoreRaw,
        peerAverage: rec.peerAverage,
        medianScore: rec.medianScore,
        scoreStatus: rec.scoreStatus,
        evaluationStatus: rec.evaluationStatus,
        submissionStatus: rec.submissionStatus,
        submissionStatusSource: rec.submissionStatusSource,
        submissionCheckedAt: rec.submissionCheckedAt,
        source: "grades",
        capturedAt: capturedTimestamp,
        deadlineSource: rec.deadlineSource,
        deadlineVerifiedAt: rec.deadlineVerifiedAt,
      });
    }
  }
  return {
    ok: true,
    termId,
    courseCode,
    courseKey,
    records: canonicalRecords,
  };
}
