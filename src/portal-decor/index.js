/**
 * Portal Decor: Top-level Lifecycle Coordinator.
 * Manages store, capture cycles, sidebar observers, and storage synchronization.
 */

import { createPortalDecorStore, PORTAL_DECOR_STORAGE_KEY } from "./storage.js";
import { captureStartPage, captureGrades } from "./capture.js";
import { decorateSidebar, createSidebarObserver } from "./decorator.js";
import { IITM_SELECTORS } from "../portal/selectors.js";

/**
 * Initializes portal decoration subsystem.
 * @param {object} options
 * @returns {{ store: object, runCycle: Function, destroy: Function }}
 */
export function initPortalDecor({
  doc = typeof document !== "undefined" ? document : null,
  store = null,
  now = () => Date.now(),
} = {}) {
  if (!doc) {
    return {
      store: null,
      runCycle: async () => {},
      destroy: () => {},
    };
  }

  const decorStore = store || createPortalDecorStore(now);
  let isDestroyed = false;
  let observer = null;
  let storageListener = null;
  let highlightDeadlinesEnabled = true;

  function removeAllDecorations() {
    try {
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

  async function runCycle() {
    if (isDestroyed || !highlightDeadlinesEnabled) return;
    try {
      await captureStartPage(doc, decorStore, now);
      await captureGrades(doc, decorStore, now);
      await decorateSidebar(doc, decorStore, now);
    } catch (err) {
      console.warn("[Acadrix] portal-decor cycle error:", err);
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
          } else if (PORTAL_DECOR_STORAGE_KEY in changes) {
            if (highlightDeadlinesEnabled) {
              decorateSidebar(doc, decorStore, now);
            }
          }
        }
      };
      chrome.storage.onChanged.addListener(storageListener);
    }
  } catch {}

  const onPageHide = () => destroy();
  if (typeof window !== "undefined") {
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
      window.removeEventListener("pagehide", onPageHide);
    }

    removeAllDecorations();
  }

  return {
    store: decorStore,
    runCycle,
    destroy,
  };
}
