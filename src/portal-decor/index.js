/**
 * Portal Decor: Top-level Lifecycle Coordinator.
 * Manages store, capture cycles, sidebar observers, and storage synchronization.
 */

import {
  createPortalDecorStore,
  createPortalGradesStore,
  createPendingSyncQueue,
  PORTAL_DECOR_STORAGE_KEY,
  PORTAL_GRADES_STORAGE_KEY,
} from "./storage.js";
import { captureStartPage, captureGrades, getCourseKey } from "./capture.js";
import { syncGradesToSupabase, fetchDeadlinesFromSupabase } from "./sync.js";
import { decorateSidebar, createSidebarObserver, removeHostStyles } from "./decorator.js";
import { IITM_SELECTORS } from "../portal/selectors.js";
import { parseTermId, parseCourseCode } from "./core.js";

/**
 * Initializes portal decoration subsystem.
 * @param {object} options
 * @returns {{ store: object, gradesStore: object, pendingQueue: object, syncGrades: Function, runCycle: Function, destroy: Function }}
 */
export function initPortalDecor({
  doc = typeof document !== "undefined" ? document : null,
  store = null,
  gradesStore = null,
  pendingQueue = null,
  now = () => Date.now(),
} = {}) {
  if (!doc) {
    return {
      store: null,
      gradesStore: null,
      pendingQueue: null,
      syncGrades: async () => ({ ok: false, syncedCount: 0, failedCount: 0 }),
      runCycle: async () => {},
      destroy: () => {},
    };
  }

  const decorStore = store || createPortalDecorStore(now);
  const portalGradesStore = gradesStore || createPortalGradesStore(now);
  const portalPendingQueue = pendingQueue || createPendingSyncQueue();
  let isDestroyed = false;
  let observer = null;
  let storageListener = null;
  let highlightDeadlinesEnabled = true;

  function removeAllDecorations() {
    try {
      removeHostStyles(doc);
      const rows = doc.querySelectorAll?.(IITM_SELECTORS.decor.decorCleanTargets);
      rows?.forEach?.((el) => {
        el.removeAttribute?.("data-acx-graded");
        el.removeAttribute?.("data-acx-mode");
      });
      const decors = doc.querySelectorAll?.(IITM_SELECTORS.decor.decorHost);
      decors?.forEach?.((el) => {
        if (el.hasAttribute?.(IITM_SELECTORS.decor.decorAttr)) {
          el.remove();
        }
      });
    } catch {}
  }

  function startObserver() {
    if (!observer && highlightDeadlinesEnabled && !isDestroyed) {
      observer = createSidebarObserver(doc, () => {
        if (highlightDeadlinesEnabled) runCycle();
      });
    }
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  let isRunning = false;

  async function runCycle() {
    if (isDestroyed || !highlightDeadlinesEnabled || isRunning) return;
    isRunning = true;
    try {
      const startResult = await captureStartPage(doc, decorStore, now);
      const gradeResult = await captureGrades(doc, portalGradesStore, portalPendingQueue, decorStore, now);

      if (startResult || (gradeResult?.ok && gradeResult.records?.length > 0)) {
        try {
          if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({ type: "RECONCILE_NOTIFICATIONS" }, () => {
              if (chrome.runtime?.lastError) {}
            });
          }
        } catch {}
      }

      if (gradeResult?.ok) {
        syncGradesToSupabase({
          gradesStore: portalGradesStore,
          pendingQueue: portalPendingQueue,
        }).catch((err) => {
          console.warn("[Acadrix] Grade sync background error:", err);
        });
      } else {
        // If not on grades page, check if decor store has any deadlines for current course; if not, fetch deadlines from Supabase in background
        const courseKey = getCourseKey(doc);
        if (courseKey) {
          const termId = parseTermId(courseKey);
          const courseCode = parseCourseCode(courseKey);
          const allDecors = await decorStore.getAll();
          const hasDeadlines = Boolean(allDecors?.[courseKey] && Object.values(allDecors[courseKey]).some((d) => d.deadlineIso));
          if (!hasDeadlines) {
            fetchDeadlinesFromSupabase({
              termId,
              courseCode,
              decorStore,
            }).then((res) => {
              if (res?.ok && res.deadlines?.length > 0 && highlightDeadlinesEnabled && !isDestroyed) {
                decorateSidebar(doc, decorStore, now, portalGradesStore);
                try {
                  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
                    chrome.runtime.sendMessage({ type: "RECONCILE_NOTIFICATIONS" }, () => {
                      if (chrome.runtime?.lastError) {}
                    });
                  }
                } catch {}
              }
            }).catch(() => {});
          }
        }
      }
      await decorateSidebar(doc, decorStore, now, portalGradesStore);
    } catch (err) {
      console.warn("[Acadrix] portal-decor cycle error:", err);
    } finally {
      isRunning = false;
    }
  }

  // Check initial highlightDeadlines preference
  try {
    if (typeof chrome !== "undefined" && chrome?.storage?.local) {
      chrome.storage.local.get({ highlightDeadlines: true }, (items) => {
        if (isDestroyed) return;
        highlightDeadlinesEnabled = items.highlightDeadlines ?? true;
        if (highlightDeadlinesEnabled) {
          runCycle();
          startObserver();
        } else {
          removeAllDecorations();
          stopObserver();
        }
      });
    } else {
      runCycle();
      startObserver();
    }
  } catch {
    runCycle();
    startObserver();
  }

  // Listen for storage changes from other tabs, popup, or background
  try {
    if (typeof chrome !== "undefined" && chrome?.storage?.onChanged) {
      storageListener = (changes, areaName) => {
        if (isDestroyed) return;
        if (areaName === "local" || !areaName) {
          if ("highlightDeadlines" in changes) {
            highlightDeadlinesEnabled = changes.highlightDeadlines.newValue ?? true;
            if (highlightDeadlinesEnabled) {
              startObserver();
              runCycle();
            } else {
              stopObserver();
              removeAllDecorations();
            }
          } else if (PORTAL_DECOR_STORAGE_KEY in changes || PORTAL_GRADES_STORAGE_KEY in changes) {
            if (highlightDeadlinesEnabled) {
              decorateSidebar(doc, decorStore, now, portalGradesStore);
            }
          }
        }
      };
      chrome.storage.onChanged.addListener(storageListener);
    }
  } catch {}

  const onPageHide = () => destroy();
  const onNavChange = () => {
    if (highlightDeadlinesEnabled && !isDestroyed) {
      runCycle();
    }
  };
  const onOnline = () => {
    if (!isDestroyed) {
      syncGradesToSupabase({
        gradesStore: portalGradesStore,
        pendingQueue: portalPendingQueue,
      }).catch(() => {});
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("popstate", onNavChange);
    window.addEventListener("hashchange", onNavChange);
    window.addEventListener("online", onOnline);
    window.addEventListener("pagehide", onPageHide, { once: true });
  }

  function destroy() {
    if (isDestroyed) return;
    isDestroyed = true;

    stopObserver();

    if (storageListener && typeof chrome !== "undefined" && chrome?.storage?.onChanged) {
      try {
        chrome.storage.onChanged.removeListener(storageListener);
      } catch {}
      storageListener = null;
    }

    if (typeof window !== "undefined") {
      window.removeEventListener("popstate", onNavChange);
      window.removeEventListener("hashchange", onNavChange);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pagehide", onPageHide);
    }

    removeAllDecorations();
  }

  return {
    store: decorStore,
    gradesStore: portalGradesStore,
    pendingQueue: portalPendingQueue,
    syncGrades: (opts = {}) =>
      syncGradesToSupabase({
        gradesStore: portalGradesStore,
        pendingQueue: portalPendingQueue,
        ...opts,
      }),
    runCycle,
    destroy,
  };
}
