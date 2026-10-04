// Toolbar popup: manage extension settings and trigger assessment Reader.
const QUIZ_HOST = /(^|\.)(study\.iitm\.ac\.in|onlinedegree\.iitm\.ac\.in)$/i;
const DEFAULT_SHORTCUT = "Alt+Q";

const openBtn = document.getElementById("open");
const openStatus = document.getElementById("openStatus");
const shortcutBtn = document.getElementById("shortcut");
const shortcutClear = document.getElementById("shortcutClear");
const headMenuToggle = document.getElementById("headMenuToggle");
const headMenu = document.getElementById("headMenu");
const mf = typeof chrome !== "undefined" && chrome?.runtime?.getManifest
  ? chrome.runtime.getManifest()
  : { version: "0.2.0", homepage_url: "" };

const verEl = document.getElementById("ver");
if (verEl) verEl.textContent = "v" + (mf.version || "0.2.0");
const repo = document.getElementById("repo");
if (mf.homepage_url && repo) {
  repo.href = mf.homepage_url;
  repo.hidden = false;
}

const setHeadMenu = (open) => {
  if (!headMenuToggle || !headMenu) return;
  headMenu.hidden = !open;
  headMenuToggle.setAttribute("aria-expanded", String(open));
};
headMenuToggle?.addEventListener("click", () => {
  setHeadMenu(headMenu?.hidden ?? true);
});
window.addEventListener("pointerdown", (event) => {
  if (!headMenu?.hidden && !headMenu.contains(event.target) && event.target !== headMenuToggle) {
    setHeadMenu(false);
  }
});
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || headMenu?.hidden) return;
  setHeadMenu(false);
  headMenuToggle?.focus?.();
});

const activeTab = async () => {
  if (typeof chrome === "undefined" || !chrome.tabs?.query) return null;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
};

// Label by e.code (physical key), so e.g. macOS Option+Q resolves to "Q".
const keyName = (e) => {
  const c = e.code || "";
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit[0-9]$/.test(c)) return c.slice(5);
  if (/^Numpad[0-9]$/.test(c)) return "Num" + c.slice(6);
  if (/^F\d{1,2}$/.test(c)) return c;
  const names = {
    Space: "Space",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Escape: "Esc",
  };
  if (names[c]) return names[c];
  const k = e.key || "";
  return k.length === 1 ? k.toUpperCase() : k;
};

const shortcutFromEvent = (e) => {
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return "";
  const key = keyName(e);
  const parts = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");
  if (!parts.length && !/^F\d{1,2}$/.test(key)) return "";
  parts.push(key);
  return parts.join("+");
};

// ── Settings Migration & Sync ────────────────────────────────────────────────
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

const toggles = [...document.querySelectorAll("input[type=checkbox][data-key]")];
const selects = [...document.querySelectorAll("select[data-key]")];
const store = typeof chrome !== "undefined" ? chrome.storage?.local : null;

let currentShortcut = DEFAULT_SHORTCUT;
let recordingShortcut = false;

const renderShortcut = (value = currentShortcut) => {
  currentShortcut = typeof value === "string" ? value : "";
  if (!shortcutBtn) return;
  if (recordingShortcut) {
    shortcutBtn.textContent = "Press keys";
    shortcutBtn.classList.add("is-listening");
    shortcutBtn.setAttribute("aria-label", "Recording shortcut: press desired keys or Escape to cancel");
  } else {
    shortcutBtn.textContent = currentShortcut || "Off";
    shortcutBtn.classList.remove("is-listening");
    shortcutBtn.setAttribute("aria-label", `Shortcut keys: ${currentShortcut || "Disabled"}`);
  }
};

const stopRecording = () => {
  recordingShortcut = false;
  window.removeEventListener("keydown", onShortcutKey, true);
  renderShortcut();
};

function onShortcutKey(e) {
  e.preventDefault();
  e.stopPropagation();
  if (e.key === "Escape") {
    stopRecording();
    return;
  }
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
  if (e.key === "Backspace" || e.key === "Delete") {
    store?.set({ openShortcut: "", openShortcutEnabled: false });
    currentShortcut = "";
    stopRecording();
    return;
  }
  const next = shortcutFromEvent(e);
  if (!next) {
    if (shortcutBtn) shortcutBtn.textContent = "Add modifier";
    setTimeout(() => renderShortcut(), 700);
    return;
  }
  store?.set({ openShortcut: next, openShortcutEnabled: true });
  currentShortcut = next;
  stopRecording();
}

const applyPopupTheme = (theme) => {
  if (theme === "light" || theme === "dark") {
    document.documentElement.setAttribute("data-theme", theme);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
};

if (store) {
  migrateSettings(store, (settings) => {
    toggles.forEach((t) => {
      const key = t.dataset.key;
      if (key in settings) {
        t.checked = Boolean(settings[key]);
      }
    });
    selects.forEach((s) => {
      const key = s.dataset.key;
      if (key in settings) {
        s.value = settings[key];
      }
    });
    applyPopupTheme(settings.theme);
    renderShortcut(settings.openShortcut);
  });

  toggles.forEach((t) =>
    t.addEventListener("change", () => {
      store.set({ [t.dataset.key]: t.checked });
    })
  );

  selects.forEach((s) =>
    s.addEventListener("change", () => {
      store.set({ [s.dataset.key]: s.value });
      if (s.dataset.key === "theme") applyPopupTheme(s.value);
    })
  );

  shortcutBtn?.addEventListener("click", () => {
    if (recordingShortcut) {
      stopRecording();
      return;
    }
    recordingShortcut = true;
    renderShortcut();
    window.addEventListener("keydown", onShortcutKey, true);
  });

  shortcutClear?.addEventListener("click", () => {
    store.set({ openShortcut: "", openShortcutEnabled: false });
    currentShortcut = "";
    renderShortcut("");
  });

  const clearDeadlinesBtn = document.getElementById("clearDeadlines");
  clearDeadlinesBtn?.addEventListener("click", () => {
    store.remove("acx:deadlines:v1", () => {
      if (clearDeadlinesBtn) {
        clearDeadlinesBtn.textContent = "Cleared";
        setTimeout(() => {
          clearDeadlinesBtn.textContent = "Clear";
        }, 1200);
      }
    });
  });

  chrome.storage.onChanged?.addListener((changes, areaName) => {
    if (areaName && areaName !== "local") return;
    if (changes.openShortcut && !recordingShortcut) {
      renderShortcut(changes.openShortcut.newValue);
    }
    if (changes.theme) {
      const themeSelect = document.querySelector('select[data-key="theme"]');
      if (themeSelect) themeSelect.value = changes.theme.newValue || "system";
      applyPopupTheme(changes.theme.newValue);
    }
    if (changes.compact) {
      const compactToggle = document.querySelector('input[data-key="compact"]');
      if (compactToggle) compactToggle.checked = Boolean(changes.compact.newValue);
    }
    if (changes.readerTextSize) {
      const textSizeSelect = document.querySelector('select[data-key="readerTextSize"]');
      if (textSizeSelect) textSizeSelect.value = changes.readerTextSize.newValue || "default";
    }
    if (changes.highlightDeadlines) {
      const hlToggle = document.querySelector('input[data-key="highlightDeadlines"]');
      if (hlToggle) hlToggle.checked = Boolean(changes.highlightDeadlines.newValue);
    }
    if (changes.directPdfEnabled) {
      const pdfToggle = document.querySelector('input[data-key="directPdfEnabled"]');
      if (pdfToggle) pdfToggle.checked = Boolean(changes.directPdfEnabled.newValue);
    }
    if (changes.portalFont) {
      const fontSelect = document.querySelector('select[data-key="portalFont"]');
      if (fontSelect) fontSelect.value = changes.portalFont.newValue || "default";
    }
  });
} else {
  toggles.forEach((t) => t.closest(".row")?.remove());
  selects.forEach((s) => s.closest(".row")?.remove());
  shortcutBtn?.closest(".row")?.remove();
  document.getElementById("clearDeadlines")?.closest(".row")?.remove();
}

// ── Active Page Status Probe ─────────────────────────────────────────────────
(async () => {
  if (!openBtn || !openStatus) return;
  const tab = await activeTab();
  let host = "";
  try {
    host = new URL(tab?.url || "").hostname;
  } catch {}

  if (!tab?.id || !QUIZ_HOST.test(host)) {
    openBtn.disabled = true;
    openBtn.textContent = "Open Reader";
    openStatus.textContent = "Not on an assessment page";
    return;
  }

  try {
    const probeResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const hasRuntime = typeof window.__saqOpen === "function";
        const status = typeof window.__saqStatus === "function"
          ? window.__saqStatus()
          : {
              assessment: Boolean(window.__unfold?.portal?.detectAssessment?.()),
              readerOpen: Boolean(window.__unfold?.reader?.isOpen?.()),
            };
        return {
          version: window.__saqVersion || "",
          hasRuntime,
          assessment: Boolean(status?.assessment),
          readerOpen: Boolean(status?.readerOpen),
        };
      },
    });

    const info = probeResults?.[0]?.result || {};
    if (!info.assessment) {
      openBtn.disabled = true;
      openBtn.textContent = "Open Reader";
      openStatus.textContent = "Not on an assessment page";
    } else if (info.readerOpen) {
      openBtn.disabled = false;
      openBtn.textContent = "Focus Reader";
      openStatus.textContent = "Reader is open";
    } else {
      openBtn.disabled = false;
      openBtn.textContent = "Open Reader";
      openStatus.textContent = "Assessment ready";
    }
  } catch {
    openBtn.disabled = false;
    openBtn.textContent = "Open Reader";
    openStatus.textContent = "Assessment ready";
  }
})();

openBtn?.addEventListener("click", async () => {
  const tab = await activeTab();
  if (!tab?.id) return;
  try {
    const checkResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        return {
          version: window.__saqVersion || "",
          hasRuntime: typeof window.__saqOpen === "function",
        };
      },
    });

    const pageRuntime = checkResult?.[0]?.result || {};
    if (pageRuntime.version === mf.version && pageRuntime.hasRuntime) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.__saqOpen(),
      });
    } else {
      if (pageRuntime.version && pageRuntime.version !== mf.version) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            try { window.__unfold?.destroy?.(); } catch {}
          },
        });
      }
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["run.js"] });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.__saqOpen(),
      });
    }
    window.close();
  } catch (e) {
    if (openStatus) openStatus.textContent = "Couldn't open — reload & retry";
    console.warn("[Acadrix] popup inject failed:", e);
  }
});
