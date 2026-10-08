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

      // 2. Remove legacy hide toggles & deprecated grade store keys
      for (const key of ["hideBreadcrumb", "hideBanner", "hideSidebar", "acx:grades:v1", "acx:pending-sync:v1"]) {
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

      if (message?.type === "ACADRIX_ENSURE_PDF_LIBS") {
        const senderTabId = sender?.tab?.id;
        if (senderTabId && typeof chrome.scripting?.executeScript === "function") {
          chrome.scripting
            .executeScript({
              target: { tabId: senderTabId },
              files: [
                "vendor/pdfmake.min.js",
                "vendor/vfs_fonts.js",
                "vendor/pdf-lib.min.js",
              ],
            })
            .then(
              () => sendResponse({ ok: true }),
              (err) => sendResponse({ ok: false, error: err?.message || String(err) })
            );
          return true;
        }
      }

      if (message?.type === "ACADRIX_PROGRAMMING_WRITE") {
        const senderTabId = sender?.tab?.id;
        if (!senderTabId || typeof chrome.scripting?.executeScript !== "function") {
          sendResponse({ ok: false, error: "Scripting API or valid sender tab unavailable." });
          return true;
        }

        chrome.scripting
          .executeScript({
            target: { tabId: senderTabId },
            world: "MAIN",
            func: (payload) => {
              const sel = [
                "app-pa-code-editor .ace_editor",
                "app-pa-code-editor .ace-container",
                "app-code-editor .ace_editor",
                "app-code-editor .ace-container",
                ".ace-container.ace_editor",
                "[id^='app-code-editor-']",
              ];
              let aceEl = null;
              for (const s of sel) {
                aceEl = document.querySelector(s);
                if (aceEl) break;
              }
              if (!aceEl) {
                return { ok: false, error: "Ace editor DOM element not found.", errorCode: "EDITOR_NOT_FOUND" };
              }
              const editor = aceEl.env?.editor || aceEl._editor || aceEl.editor || (window.ace?.edit ? window.ace.edit(aceEl) : null);
              if (!editor) {
                return { ok: false, error: "Ace editor instance not found on element.", errorCode: "EDITOR_NOT_READY" };
              }
              const session = editor.getSession ? editor.getSession() : editor.session;
              if (!session || typeof session.getValue !== "function") {
                return { ok: false, error: "Ace edit session not found.", errorCode: "EDITOR_NOT_READY" };
              }

              const currentId = editor.id ? `editor-${editor.id}` : (aceEl.id ? `container-${aceEl.id}` : "ace-editor");
              if (payload.editorIdentity && payload.editorIdentity !== currentId) {
                return { ok: false, error: `Editor identity mismatch: expected "${payload.editorIdentity}", found "${currentId}".`, errorCode: "EDITOR_IDENTITY_CHANGED" };
              }

              if (payload.questionNumber !== undefined && payload.questionNumber !== null) {
                const activeChip = document.querySelector("div.chips button.chip.is-active, div.chips button.chip[aria-selected='true'], button.chip.is-active");
                const activeNum = activeChip ? parseInt((activeChip.textContent || "").trim(), 10) : null;
                if (activeNum !== null && !isNaN(activeNum) && activeNum !== payload.questionNumber) {
                  return { ok: false, error: `Question identity mismatch: expected Q${payload.questionNumber}, found Q${activeNum}.`, errorCode: "QUESTION_IDENTITY_CHANGED" };
                }
              }

              const totalRows = session.getLength();
              const frontMarkers = (typeof session.getMarkers === "function" ? session.getMarkers(true) : null) || {};
              const defaultMarkers = (typeof session.getMarkers === "function" ? session.getMarkers() : null) || {};
              const allMarkers = { ...defaultMarkers, ...frontMarkers, ...(session.$frontMarkers || {}) };
              const readonlyMarkers = Object.values(allMarkers).filter((m) => {
                if (!m) return false;
                const c = typeof m.clazz === "string" ? m.clazz : "";
                const t = typeof m.type === "string" ? m.type : "";
                return /(readonly|read-only|protected|locked)/i.test(c) || /(readonly|read-only|protected|locked)/i.test(t);
              });

              let prefixEndRow = -1;
              for (const m of readonlyMarkers) {
                const startRow = Math.max(0, m.range?.start?.row ?? m.startRow ?? 0);
                const endRow = Math.max(startRow, m.range?.end?.row ?? m.endRow ?? startRow);
                const endCol = m.range?.end?.column ?? (m.endRow !== undefined && !m.range ? 1 : 0);
                const effectiveEnd = (endCol === 0 && endRow > startRow) ? endRow - 1 : endRow;
                if (startRow <= prefixEndRow + 1 && effectiveEnd > prefixEndRow) {
                  prefixEndRow = effectiveEnd;
                }
              }

              let suffixStartRow = totalRows;
              for (const m of readonlyMarkers) {
                const startRow = Math.max(0, m.range?.start?.row ?? m.startRow ?? 0);
                const endRow = Math.max(startRow, m.range?.end?.row ?? m.endRow ?? startRow);
                if (startRow > prefixEndRow && startRow < suffixStartRow) {
                  suffixStartRow = startRow;
                }
              }

              const hasPrefix = prefixEndRow >= 0;
              const hasSuffix = suffixStartRow < totalRows && suffixStartRow > prefixEndRow;
              const editStartRow = hasPrefix ? prefixEndRow + 1 : 0;
              const editEndRow = hasSuffix ? suffixStartRow - 1 : Math.max(0, totalRows - 1);
              const getLastCol = (r) => (typeof session.getLine === "function" ? (session.getLine(r) || "").length : 0);

              const originalPrefix = hasPrefix ? session.getLines(0, prefixEndRow).join("\n") : null;
              const originalSuffix = hasSuffix ? session.getLines(suffixStartRow, totalRows - 1).join("\n") : null;

              const RangeCtor = session.getSelection?.()?.getRange?.()?.constructor || window.ace?.Range;
              const startObj = { row: editStartRow, column: 0 };
              const endObj = { row: editEndRow, column: getLastCol(editEndRow) };
              const aceRange = RangeCtor ? new RangeCtor(startObj.row, startObj.column, endObj.row, endObj.column) : { start: startObj, end: endObj };

              session.replace(aceRange, payload.code);

              try {
                const textarea = aceEl.querySelector("textarea.ace_text-input, textarea") || aceEl;
                textarea.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
                textarea.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
              } catch {}

              const postTotal = session.getLength();
              const postPrefix = hasPrefix ? session.getLines(0, prefixEndRow).join("\n") : null;
              if (originalPrefix !== null && postPrefix !== originalPrefix) {
                return { ok: false, error: "Protected prefix was altered.", errorCode: "CODE_WRITE_VERIFICATION_FAILED" };
              }
              const postSuffix = hasSuffix ? session.getLines(postTotal - (totalRows - suffixStartRow), postTotal - 1).join("\n") : null;
              if (originalSuffix !== null && postSuffix !== originalSuffix) {
                return { ok: false, error: "Protected suffix was altered.", errorCode: "CODE_WRITE_VERIFICATION_FAILED" };
              }

              return {
                ok: true,
                data: {
                  code: payload.code,
                  verified: true,
                  editorIdentity: currentId,
                },
              };
            },
            args: [message.payload],
          })
          .then(
            (results) => {
              const res = results?.[0]?.result;
              sendResponse(res || { ok: false, error: "No execution result from main world.", errorCode: "EXECUTION_EMPTY" });
            },
            (err) => {
              sendResponse({ ok: false, error: err?.message || String(err), errorCode: "SCRIPTING_FAILED" });
            }
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
