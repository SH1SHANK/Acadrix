/**
 * Acadrix — Extension Background Service Worker.
 *
 * Handles direct PDF generation for the active assessment tab via
 * chrome.debugger + Page.printToPDF, with a strict single-flight lock,
 * sender-tab verification, and guaranteed detach in a finally block.
 * Also runs idempotent settings migration on install / update.
 */
(() => {
  "use strict";

  const DEFAULT_SHORTCUT = "Alt+Q";

  function migrateSettings(store, callback) {
    if (!store?.get || !store?.set) {
      if (typeof callback === "function") callback({});
      return;
    }

    store.get(null, (items = {}) => {
      const oldKeys = ["hideBreadcrumb", "hideBanner", "hideSidebar", "fontName"];
      const hasOldKeys = oldKeys.some((k) => k in items);

      const isMissingDefaults =
        !("theme" in items) ||
        !("compact" in items) ||
        !("readerTextSize" in items) ||
        !("highlightDeadlines" in items) ||
        !("directPdfEnabled" in items) ||
        !("openShortcut" in items) ||
        !("openShortcutEnabled" in items) ||
        !("portalFont" in items);

      if (!hasOldKeys && !isMissingDefaults) {
        if (typeof callback === "function") callback(items);
        return;
      }

      const updates = {};
      const keysToRemove = [];

      // 1. fontName -> portalFont
      if ("fontName" in items) {
        if (!("portalFont" in items)) {
          const rawFont = (items.fontName || "").trim();
          updates.portalFont = /^satoshi(\s*variable)?$/i.test(rawFont) ? "satoshi" : "default";
        }
        keysToRemove.push("fontName");
      } else if (!("portalFont" in items)) {
        updates.portalFont = "default";
      }

      // 2. Remove legacy hide toggles
      for (const key of ["hideBreadcrumb", "hideBanner", "hideSidebar"]) {
        if (key in items) {
          keysToRemove.push(key);
        }
      }

      // 3. Preserve shortcut & derive openShortcutEnabled
      let finalShortcut = items.openShortcut;
      if (finalShortcut === undefined) {
        finalShortcut = items.shortcut !== undefined ? items.shortcut : DEFAULT_SHORTCUT;
      }
      if (items.openShortcutEnabled === false && items.openShortcut === undefined) {
        finalShortcut = "";
      }
      updates.openShortcut = finalShortcut;
      updates.openShortcutEnabled = Boolean(finalShortcut && finalShortcut.trim());

      // 4. Missing defaults
      if (!("theme" in items)) updates.theme = "system";
      if (!("compact" in items)) updates.compact = false;
      if (!("readerTextSize" in items)) updates.readerTextSize = "default";
      if (!("highlightDeadlines" in items)) updates.highlightDeadlines = true;
      if (!("directPdfEnabled" in items)) updates.directPdfEnabled = true;

      const finalize = () => {
        store.set(updates, () => {
          if (typeof callback === "function") callback({ ...items, ...updates });
        });
      };

      if (keysToRemove.length > 0 && typeof store.remove === "function") {
        store.remove(keysToRemove, finalize);
      } else {
        finalize();
      }
    });
  }

  // Expose migration helper for unit testing
  globalThis.__acadrixMigrateSettings = migrateSettings;

  async function getScheduler() {
    if (typeof globalThis.__acadrixScheduler !== "undefined" && globalThis.__acadrixScheduler) {
      return globalThis.__acadrixScheduler;
    }
    try {
      return await import("./notifications/scheduler.js");
    } catch {
      try {
        return await import("../src/notifications/scheduler.js");
      } catch {
        return null;
      }
    }
  }

  async function reconcileDeadlineAlarms(options) {
    const scheduler = await getScheduler();
    if (scheduler?.reconcileDeadlineAlarms) {
      return await scheduler.reconcileDeadlineAlarms(options);
    }
    return { created: 0, cleared: 0, totalActive: 0 };
  }

  async function dispatchAlarmNotification(alarmName, options) {
    const scheduler = await getScheduler();
    if (scheduler?.dispatchAlarmNotification) {
      return await scheduler.dispatchAlarmNotification(alarmName, options);
    }
    return { dispatched: false, reason: "SCHEDULER_UNAVAILABLE" };
  }

  function handleNotificationClick(notificationId) {
    if (typeof chrome !== "undefined" && chrome.tabs) {
      chrome.tabs.query({ url: "*://*.study.iitm.ac.in/*" }, (tabs) => {
        if (tabs && tabs.length > 0 && tabs[0].id) {
          chrome.tabs.update(tabs[0].id, { active: true });
          if (tabs[0].windowId && typeof chrome.windows?.update === "function") {
            chrome.windows.update(tabs[0].windowId, { focused: true });
          }
        } else if (typeof chrome.tabs.create === "function") {
          chrome.tabs.create({ url: "https://study.iitm.ac.in" });
        }
      });
    }
    if (typeof chrome !== "undefined" && typeof chrome.notifications?.clear === "function") {
      chrome.notifications.clear(notificationId);
    }
  }

  globalThis.__acadrixReconcileDeadlineAlarms = reconcileDeadlineAlarms;
  globalThis.__acadrixDispatchAlarmNotification = dispatchAlarmNotification;
  globalThis.__acadrixHandleNotificationClick = handleNotificationClick;

  if (typeof chrome !== "undefined" && chrome.runtime?.onInstalled?.addListener) {
    chrome.runtime.onInstalled.addListener(() => {
      if (chrome.storage?.local) {
        migrateSettings(chrome.storage.local);
      }
      reconcileDeadlineAlarms().catch((err) => {
        console.error("[Acadrix Service Worker] Error reconciling alarms on install:", err);
      });
    });
  }

  if (typeof chrome !== "undefined" && chrome.runtime?.onStartup?.addListener) {
    chrome.runtime.onStartup.addListener(() => {
      reconcileDeadlineAlarms().catch((err) => {
        console.error("[Acadrix Service Worker] Error reconciling alarms on startup:", err);
      });
    });
  }

  if (typeof chrome !== "undefined" && chrome.alarms?.onAlarm?.addListener) {
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm?.name?.startsWith("acx:notify:")) {
        dispatchAlarmNotification(alarm.name).catch((err) => {
          console.error("[Acadrix Service Worker] Error dispatching notification:", err);
        });
      }
    });
  }

  if (typeof chrome !== "undefined" && chrome.notifications?.onClicked?.addListener) {
    chrome.notifications.onClicked.addListener((notificationId) => {
      handleNotificationClick(notificationId);
    });
  }

  let printInFlight = false;

  function invokeDebuggerApi(methodName, ...args) {
    return new Promise((resolve, reject) => {
      if (typeof chrome === "undefined" || !chrome.debugger || typeof chrome.debugger[methodName] !== "function") {
        reject(new Error(`chrome.debugger.${methodName} is not available.`));
        return;
      }

      try {
        let settled = false;
        const done = (err, result) => {
          if (settled) return;
          settled = true;
          if (err) reject(err);
          else resolve(result);
        };

        const maybePromise = chrome.debugger[methodName](...args, (result) => {
          const lastErr = chrome.runtime?.lastError;
          if (lastErr) {
            done(new Error(lastErr.message || String(lastErr)));
          } else {
            done(null, result);
          }
        });

        if (maybePromise && typeof maybePromise.then === "function") {
          maybePromise.then(
            (res) => done(null, res),
            (err) => done(err instanceof Error ? err : new Error(String(err)))
          );
        }
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async function handlePrintToPdfMessage(message, sender, sendResponse) {
    const respond = (payload) => {
      if (typeof sendResponse === "function") {
        sendResponse(payload);
      }
      return payload;
    };

    const senderTabId = sender?.tab?.id;
    if (typeof senderTabId !== "number" || senderTabId < 0) {
      return respond({ ok: false, error: "Missing sender tab: request must originate from a valid browser tab." });
    }

    if (message?.tabId !== undefined && message.tabId !== senderTabId) {
      return respond({ ok: false, error: "Sender tab mismatch: target tab does not match sender tab." });
    }

    if (printInFlight) {
      return respond({ ok: false, error: "A PDF generation session is already in progress." });
    }

    printInFlight = true;
    const target = { tabId: senderTabId };
    let responsePayload;

    try {
      await invokeDebuggerApi("attach", target, "1.3");
      const pdfResult = await invokeDebuggerApi("sendCommand", target, "Page.printToPDF", {
        printBackground: true,
        preferCSSPageSize: true,
        transferMode: "ReturnAsBase64",
      });

      if (!pdfResult || typeof pdfResult.data !== "string" || pdfResult.data.length === 0) {
        throw new Error("Page.printToPDF returned empty PDF data.");
      }

      responsePayload = { ok: true, data: pdfResult.data };
    } catch (err) {
      responsePayload = {
        ok: false,
        error: err?.message || String(err || "Direct PDF generation failed."),
      };
    } finally {
      try {
        await invokeDebuggerApi("detach", target);
      } catch {
        // Ignore detach errors in finally; never leave debugger attached
      }
      printInFlight = false;
    }

    return respond(responsePayload);
  }

  // Expose handler for direct unit/integration testing
  globalThis.__unfoldHandlePrintToPdfMessage = handlePrintToPdfMessage;

  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.type === "RECONCILE_NOTIFICATIONS") {
        reconcileDeadlineAlarms().then(
          (result) => sendResponse({ ok: true, result }),
          (err) => sendResponse({ ok: false, error: err?.message || String(err) })
        );
        return true;
      }

      if (!message || message.type !== "UNFOLD_PRINT_TO_PDF") {
        return false;
      }

      handlePrintToPdfMessage(message, sender).then(
        (response) => sendResponse(response),
        (err) =>
          sendResponse({
            ok: false,
            error: err?.message || String(err || "Direct PDF generation failed."),
          })
      );

      return true; // Keep message channel open for async response
    });
  }
})();
