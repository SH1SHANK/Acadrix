// Toolbar popup: manage extension settings and trigger assessment Reader / sync operations.
const QUIZ_HOST = /(^|\.)(study\.iitm\.ac\.in|onlinedegree\.iitm\.ac\.in|iitm\.ac\.in)$/i;
const DEFAULT_SHORTCUT = "Alt+Q";
const DEFAULT_SUPABASE_URL = "https://aocrcrdmwmdtthrwypii.supabase.co";
const DEFAULT_GRADE_SYNC_SECRET = "acx_grade_sync_secret_7f8e9d0c1b2a3b4c5d6e7f8a9b0c1d2e";
const DEFAULT_SYNC_ENDPOINT = "/functions/v1/grade-sync";

// ── DOM References ────────────────────────────────────────────────────────────
const openBtn = document.getElementById("open");
const openStatus = document.getElementById("openStatus");
const portalBadge = document.getElementById("portalBadge");
const extractedCountEl = document.getElementById("extractedCount");
const coursesCountEl = document.getElementById("coursesCount");
const pendingBadge = document.getElementById("pendingBadge");
const syncBadge = document.getElementById("syncBadge");
const lastSyncTimeEl = document.getElementById("lastSyncTime");
const syncFeedback = document.getElementById("syncFeedback");
const manualSyncBtn = document.getElementById("manualSyncBtn");
const shortcutBtn = document.getElementById("shortcut");
const shortcutClear = document.getElementById("shortcutClear");
const headMenuToggle = document.getElementById("headMenuToggle");
const headMenu = document.getElementById("headMenu");
const clearDeadlinesBtn = document.getElementById("clearDeadlines");
const clearGradesBtn = document.getElementById("clearGrades");

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

// ── Header Menu Toggle ────────────────────────────────────────────────────────
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

// ── Tab & Navigation Helpers ──────────────────────────────────────────────────
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

// ── Relative / Localized Time Formatter ───────────────────────────────────────
function formatRelativeTime(isoString) {
  if (!isoString) return "Never";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "Never";

    const now = Date.now();
    const diffMs = now - d.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);

    if (diffSec < 45) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;

    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Never";
  }
}

// ── Settings Migration & Persistence ──────────────────────────────────────────
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

// ── Unified Operational State Model ───────────────────────────────────────────
let operationalState = {
  tab: {
    isIitm: false,
    isAssessment: false,
    isGradesPage: false,
    isReaderOpen: false,
    version: "",
    hasRuntime: false,
  },
  local: {
    totalRecords: 0,
    courseCount: 0,
    pendingCount: 0,
  },
  sync: {
    lastSuccessfulSync: null,
    lastSyncAttempt: null,
    lastSyncStatus: "NEVER_SYNCED", // NEVER_SYNCED | SYNCING | SYNCED | FAILED | AUTH_ERROR | OFFLINE
    lastSyncError: null,
    lastSyncedCount: 0,
  },
  isSyncing: false,
};

function updateBadgeElement(el, text, variant) {
  if (!el) return;
  el.textContent = text;
  el.className = "acx-badge";
  if (variant === "success") el.classList.add("acx-badge-success");
  else if (variant === "warning") el.classList.add("acx-badge-warning");
  else if (variant === "error") el.classList.add("acx-badge-error");
  else if (variant === "info") el.classList.add("acx-badge-info");
  else el.classList.add("acx-badge-neutral");
}

function renderOperationalUI() {
  const isOnline = typeof navigator === "undefined" || navigator.onLine !== false;
  const { tab, local, sync, isSyncing } = operationalState;

  // 1. Portal Context Badge
  if (!isOnline) {
    updateBadgeElement(portalBadge, "Offline", "warning");
  } else if (tab.isAssessment && tab.isReaderOpen) {
    updateBadgeElement(portalBadge, "Reader Active", "info");
  } else if (tab.isAssessment) {
    updateBadgeElement(portalBadge, "Assessment Ready", "success");
  } else if (tab.isGradesPage) {
    updateBadgeElement(portalBadge, "Grades View", "info");
  } else if (tab.isIitm) {
    updateBadgeElement(portalBadge, "IITM Portal", "neutral");
  } else {
    updateBadgeElement(portalBadge, "Outside Portal", "neutral");
  }

  // 2. Local Storage Statistics
  if (extractedCountEl) extractedCountEl.textContent = String(local.totalRecords);
  if (coursesCountEl) {
    coursesCountEl.textContent = local.courseCount === 1
      ? "1 course tracked"
      : `${local.courseCount} courses tracked`;
  }
  if (pendingBadge) {
    if (local.pendingCount > 0) {
      updateBadgeElement(pendingBadge, `${local.pendingCount} pending`, "warning");
    } else {
      updateBadgeElement(pendingBadge, "0 pending", "neutral");
    }
  }

  // 3. Supabase Cloud Sync Card
  const effectiveSyncStatus = isSyncing ? "SYNCING" : (!isOnline ? "OFFLINE" : sync.lastSyncStatus);
  if (syncBadge) {
    switch (effectiveSyncStatus) {
      case "SYNCED":
        updateBadgeElement(syncBadge, "Synced", "success");
        break;
      case "SYNCING":
        updateBadgeElement(syncBadge, "Syncing...", "info");
        break;
      case "FAILED":
        updateBadgeElement(syncBadge, "Sync failed", "error");
        break;
      case "AUTH_ERROR":
        updateBadgeElement(syncBadge, "Auth error", "error");
        break;
      case "OFFLINE":
        updateBadgeElement(syncBadge, "Offline", "warning");
        break;
      default:
        updateBadgeElement(syncBadge, "Not synced", "neutral");
        break;
    }
  }

  if (lastSyncTimeEl) {
    lastSyncTimeEl.textContent = formatRelativeTime(sync.lastSuccessfulSync);
  }

  if (syncFeedback) {
    if (effectiveSyncStatus === "FAILED" || effectiveSyncStatus === "AUTH_ERROR") {
      syncFeedback.textContent = sync.lastSyncError || "Synchronization encountered an error.";
      syncFeedback.hidden = false;
    } else {
      syncFeedback.hidden = true;
      syncFeedback.textContent = "";
    }
  }

  if (manualSyncBtn) {
    manualSyncBtn.disabled = isSyncing;
    manualSyncBtn.textContent = isSyncing
      ? "Syncing..."
      : (effectiveSyncStatus === "FAILED" || effectiveSyncStatus === "AUTH_ERROR" ? "Retry" : "Sync now");
  }

  // 4. Primary Hero Action Button
  if (openBtn && openStatus) {
    if (tab.isAssessment) {
      if (tab.isReaderOpen) {
        openBtn.disabled = false;
        openBtn.textContent = "Focus Reader";
        openStatus.textContent = "Reader is open";
      } else {
        openBtn.disabled = false;
        openBtn.textContent = "Open Reader";
        openStatus.textContent = "Assessment ready";
      }
    } else {
      openBtn.disabled = true;
      openBtn.textContent = "Open Reader";
      openStatus.textContent = "Not on an assessment page";
    }
  }
}

// ── Upcoming Deadlines Component ──────────────────────────────────────────────
function renderUpcomingDeadlines(grades = {}, deadlines = {}) {
  const upcomingList = document.getElementById("upcomingList");
  const upcomingEmpty = document.getElementById("upcomingEmpty");
  if (!upcomingList || !upcomingEmpty) return;

  const assignmentsMap = new Map();
  const now = new Date();
  const nowMs = now.getTime();

  const getKolkataParts = (d) => {
    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        hourCycle: "h23",
      });
      const parts = {};
      for (const { type, value } of formatter.formatToParts(d)) {
        if (type !== "literal") parts[type] = parseInt(value, 10);
      }
      return parts;
    } catch {
      return null;
    }
  };

  const nowParts = getKolkataParts(now);

  // 1. Gather from authoritative grades store
  for (const [termId, courseObj] of Object.entries(grades)) {
    if (!courseObj || typeof courseObj !== "object") continue;
    for (const [courseCode, assignObj] of Object.entries(courseObj)) {
      if (!assignObj || typeof assignObj !== "object") continue;
      for (const [extId, record] of Object.entries(assignObj)) {
        if (!record || !record.dueDate) continue;
        const key = `${termId}:${courseCode}:${extId}`;
        const source = record.deadlineSource || (record.source === "supabase_deadlines" ? "SUPABASE" : (record.source === "grades" || record.source === "start" ? "PORTAL" : "LOCAL"));
        assignmentsMap.set(key, {
          title: record.title || "Assignment",
          courseCode: courseCode || "",
          dueDate: record.dueDate,
          deadlineSource: source,
          deadlineVerifiedAt: record.deadlineVerifiedAt || record.submissionCheckedAt || record.capturedAt || null,
          submissionStatus: record.submissionStatus || "UNKNOWN",
          submissionCheckedAt: record.submissionCheckedAt || record.capturedAt || null,
        });
      }
    }
  }
  // 2. Gather from legacy/sidebar deadlines store if not already present
  for (const [courseKey, assignMap] of Object.entries(deadlines)) {
    if (!assignMap || typeof assignMap !== "object") continue;
    for (const [decorKey, record] of Object.entries(assignMap)) {
      if (!record || (!record.dueDate && !record.deadlineIso)) continue;
      const key = `${courseKey}:${decorKey}`;
      const exists = Array.from(assignmentsMap.values()).some(
        (a) => a.title.toLowerCase() === (record.title || decorKey).toLowerCase()
      );
      if (!exists) {
        const source = record.deadlineSource || (record.source === "supabase_deadlines" ? "SUPABASE" : (record.source === "grades" || record.source === "start" ? "PORTAL" : "LOCAL"));
        assignmentsMap.set(key, {
          title: record.title || decorKey,
          courseCode: record.courseCode || "",
          dueDate: record.dueDate || record.deadlineIso,
          deadlineSource: source,
          deadlineVerifiedAt: record.deadlineVerifiedAt || record.submissionCheckedAt || (record.capturedAt ? new Date(record.capturedAt).toISOString() : null),
          submissionStatus: record.submissionStatus || "UNKNOWN",
          submissionCheckedAt: record.submissionCheckedAt || (record.capturedAt ? new Date(record.capturedAt).toISOString() : null),
        });
      }
    }
  }
  const items = Array.from(assignmentsMap.values());
  if (items.length === 0) {
    upcomingEmpty.hidden = false;
    upcomingList.innerHTML = "";
    return;
  }

  // Evaluate & prioritize
  const evaluated = items.map((item) => {
    const dueTime = new Date(item.dueDate).getTime();
    const isSubmitted = item.submissionStatus === "SUBMITTED" || item.submissionStatus === "COMPLETED";
    const diffMs = dueTime - nowMs;
    const isOverdue = diffMs < 0;

    let dayDiff = null;
    const dueParts = getKolkataParts(new Date(item.dueDate));
    if (nowParts && dueParts) {
      const d1 = Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day);
      const d2 = Date.UTC(dueParts.year, dueParts.month - 1, dueParts.day);
      dayDiff = Math.round((d2 - d1) / 86400000);
    }

    let tier = 4;
    let badgeText = "";
    let badgeClass = "acx-badge-neutral";

    if (isSubmitted) {
      tier = 5;
      badgeText = "Submitted";
      badgeClass = "acx-badge-success";
    } else if (isOverdue) {
      tier = 1;
      badgeText = "Overdue";
      badgeClass = "acx-badge-error";
    } else if (dayDiff === 0) {
      tier = 2;
      badgeText = "Due Today";
      badgeClass = "acx-badge-warning";
    } else if (dayDiff === 1 || diffMs <= 24 * 3600 * 1000) {
      tier = 3;
      badgeText = "Due Tomorrow";
      badgeClass = "acx-badge-accent";
    } else {
      tier = 4;
      badgeClass = "acx-badge-neutral";
      if (diffMs <= 72 * 3600 * 1000) {
        badgeText = "Due Soon";
      } else {
        try {
          badgeText = new Intl.DateTimeFormat("en-US", {
            timeZone: "Asia/Kolkata",
            month: "short",
            day: "numeric",
          }).format(new Date(item.dueDate));
        } catch {
          badgeText = "Upcoming";
        }
      }
    }

    let freshnessText = "Not verified recently";
    const verifiedTimestamp = item.deadlineVerifiedAt || item.submissionCheckedAt;
    if (verifiedTimestamp) {
      freshnessText = `Checked ${formatRelativeTime(verifiedTimestamp)}`;
    }
    const sourceLabel = item.deadlineSource === "SUPABASE" ? " · via Supabase" : "";
    const metaDisplay = `${freshnessText}${sourceLabel}`;

    return {
      ...item,
      dueTime,
      tier,
      badgeText,
      badgeClass,
      freshnessText,
      metaDisplay,
    };
  });
  // Sort deterministically:
  // 1. Tier ascending (1 to 5)
  // 2. dueTime ascending
  // 3. title alphabetically
  evaluated.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.dueTime !== b.dueTime) return a.dueTime - b.dueTime;
    return a.title.localeCompare(b.title);
  });

  const displayItems = evaluated.slice(0, 4);
  upcomingEmpty.hidden = true;
  upcomingList.innerHTML = "";

  for (const it of displayItems) {
    const itemEl = document.createElement("div");
    itemEl.className = "upcoming-item";

    const bodyEl = document.createElement("div");
    bodyEl.className = "upcoming-item-body";

    const titleEl = document.createElement("span");
    titleEl.className = "upcoming-item-title";
    titleEl.textContent = it.courseCode ? `${it.courseCode} · ${it.title}` : it.title;
    titleEl.title = titleEl.textContent;

    const metaEl = document.createElement("span");
    metaEl.className = "upcoming-item-meta";
    metaEl.textContent = it.metaDisplay;
    metaEl.title = `Source: ${it.deadlineSource || "Local"} · ${it.freshnessText}`;
    bodyEl.appendChild(titleEl);
    bodyEl.appendChild(metaEl);

    const badgeEl = document.createElement("span");
    badgeEl.className = `acx-badge ${it.badgeClass}`;
    badgeEl.textContent = it.badgeText;

    itemEl.appendChild(bodyEl);
    itemEl.appendChild(badgeEl);
    upcomingList.appendChild(itemEl);
  }
}

// ── Refresh Local and Sync Stores ─────────────────────────────────────────────
async function refreshStorageData() {
  if (!store?.get) return;

  return new Promise((resolve) => {
    store.get(
      ["acx:grades:v1", "acx:deadlines:v1", "acx:pending-sync:v1", "acx:sync-status:v1"],
      (items = {}) => {
        const grades = items["acx:grades:v1"] || {};
        const deadlines = items["acx:deadlines:v1"] || {};
        const pending = items["acx:pending-sync:v1"] || {};
        const syncStatus = items["acx:sync-status:v1"] || {};
        let totalRecords = 0;
        const courses = new Set();

        for (const [termId, courseObj] of Object.entries(grades)) {
          if (courseObj && typeof courseObj === "object") {
            for (const [courseCode, assignObj] of Object.entries(courseObj)) {
              if (assignObj && typeof assignObj === "object") {
                courses.add(`${termId}:${courseCode}`);
                totalRecords += Object.keys(assignObj).length;
              }
            }
          }
        }

        const pendingCount = Object.keys(pending).length;

        operationalState.local = {
          totalRecords,
          courseCount: courses.size,
          pendingCount,
        };

        operationalState.sync = {
          lastSuccessfulSync: syncStatus.lastSuccessfulSync || null,
          lastSyncAttempt: syncStatus.lastSyncAttempt || null,
          lastSyncStatus: syncStatus.lastSyncStatus || "NEVER_SYNCED",
          lastSyncError: syncStatus.lastSyncError || null,
          lastSyncedCount: syncStatus.lastSyncedCount || 0,
        };

        renderUpcomingDeadlines(grades, deadlines);
        renderOperationalUI();
        resolve();
      }
    );
  });
}

// ── Trigger Supabase Grade Sync ────────────────────────────────────────────────
let syncExecutionLock = false;

async function executeGradeSync() {
  if (syncExecutionLock || operationalState.isSyncing) return;
  if (!store?.get || !store?.set) return;

  syncExecutionLock = true;
  operationalState.isSyncing = true;
  renderOperationalUI();

  try {
    const items = await new Promise((resolve) => {
      store.get(
        ["acx:grades:v1", "acx:pending-sync:v1", "acx:sync-status:v1", "supabaseUrl", "gradeSyncSecret"],
        (res) => resolve(res || {})
      );
    });

    const grades = items["acx:grades:v1"] || {};
    const pending = items["acx:pending-sync:v1"] || {};
    const pendingItems = Object.values(pending);
    const existingSyncStatus = items["acx:sync-status:v1"] || {};

    const supabaseUrl = (items.supabaseUrl || DEFAULT_SUPABASE_URL).replace(/\/+$/, "");
    const syncSecret = items.gradeSyncSecret || DEFAULT_GRADE_SYNC_SECRET;

    if (pendingItems.length === 0) {
      operationalState.sync.lastSyncStatus = existingSyncStatus.lastSuccessfulSync ? "SYNCED" : "NEVER_SYNCED";
      operationalState.sync.lastSyncError = null;
      store.set({
        "acx:sync-status:v1": {
          ...existingSyncStatus,
          lastSyncStatus: operationalState.sync.lastSyncStatus,
          lastSyncError: null,
        },
      });
      return;
    }

    if (!syncSecret) {
      const err = "GRADE_SYNC_SECRET is not configured";
      const nextStatus = {
        ...existingSyncStatus,
        lastSyncAttempt: new Date().toISOString(),
        lastSyncStatus: "AUTH_ERROR",
        lastSyncError: err,
      };
      await new Promise((r) => store.set({ "acx:sync-status:v1": nextStatus }, r));
      return;
    }

    // Group pending items by termId & courseCode
    const groups = new Map();
    const orphanKeys = [];

    for (const item of pendingItems) {
      const termId = item?.termId;
      const courseCode = item?.courseCode;
      const externalAssignmentId = item?.externalAssignmentId;
      const queueKey = item?.key || `${termId}:${courseCode}:${externalAssignmentId}`;

      if (!termId || !courseCode || !externalAssignmentId) {
        if (queueKey) orphanKeys.push(queueKey);
        continue;
      }

      const liveRecord = grades?.[termId]?.[courseCode]?.[externalAssignmentId];
      if (!liveRecord) {
        orphanKeys.push(queueKey);
        continue;
      }

      const groupKey = `${termId}:${courseCode}`;
      if (!groups.has(groupKey)) {
        groups.set(groupKey, { termId, courseCode, keys: [], records: [] });
      }
      const grp = groups.get(groupKey);
      grp.keys.push(queueKey);
      grp.records.push(liveRecord);
    }

    // Remove orphan queue items safely
    if (orphanKeys.length > 0) {
      for (const k of orphanKeys) delete pending[k];
      await new Promise((r) => store.set({ "acx:pending-sync:v1": pending }, r));
    }

    if (groups.size === 0) {
      const nextStatus = {
        ...existingSyncStatus,
        lastSyncStatus: existingSyncStatus.lastSuccessfulSync ? "SYNCED" : "NEVER_SYNCED",
        lastSyncError: null,
      };
      await new Promise((r) => store.set({ "acx:sync-status:v1": nextStatus }, r));
      return;
    }

    let totalSynced = 0;
    let totalFailed = 0;
    let firstErrorMessage = null;
    let isAuthError = false;

    const endpoint = `${supabaseUrl}${DEFAULT_SYNC_ENDPOINT}`;

    for (const [, group] of groups.entries()) {
      const formattedRecords = group.records.map((r) => ({
        externalAssignmentId: String(r.externalAssignmentId || "").trim(),
        canonicalAssessmentId: r.canonicalAssessmentId ? String(r.canonicalAssessmentId).trim() : null,
        module: String(r.module || "").trim(),
        title: String(r.title || "").trim(),
        assignmentType: r.assignmentType ? String(r.assignmentType).trim() : "Assignment",
        yourScore: typeof r.yourScore === "number" && Number.isFinite(r.yourScore) ? r.yourScore : null,
        yourScoreRaw: r.yourScoreRaw !== undefined && r.yourScoreRaw !== null ? String(r.yourScoreRaw).trim() : null,
        peerAverage: typeof r.peerAverage === "number" && Number.isFinite(r.peerAverage) ? r.peerAverage : null,
        medianScore: typeof r.medianScore === "number" && Number.isFinite(r.medianScore) ? r.medianScore : null,
        scoreStatus: r.scoreStatus ? String(r.scoreStatus).trim() : "UNRELEASED",
        evaluationStatus: r.evaluationStatus ? String(r.evaluationStatus).trim() : "normal",
        dueDate: r.dueDate || r.dueDateIso || null,
        dueDateText: r.dueDateText || r.dueDateRaw || null,
        source: r.source ? String(r.source).trim() : "grades",
        capturedAt: r.capturedAt || null,
      }));

      const payload = {
        termId: group.termId,
        courseCode: group.courseCode,
        records: formattedRecords,
      };

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-sync-secret": syncSecret,
          },
          body: JSON.stringify(payload),
        });

        let responseBody = null;
        try { responseBody = await response.json(); } catch {}

        if (response.ok && responseBody?.ok) {
          // Dequeue synchronized keys
          for (const k of group.keys) delete pending[k];
          totalSynced += formattedRecords.length;
        } else {
          totalFailed += formattedRecords.length;
          const errMsg = responseBody?.error || `HTTP ${response.status}`;
          if (!firstErrorMessage) firstErrorMessage = errMsg;
          if (response.status === 401 || response.status === 403) isAuthError = true;
        }
      } catch (netErr) {
        totalFailed += formattedRecords.length;
        const errMsg = netErr?.message || "Network request failed";
        if (!firstErrorMessage) firstErrorMessage = errMsg;
      }
    }

    const nowIso = new Date().toISOString();
    let updatedSyncStatus;

    if (totalFailed === 0 && totalSynced > 0) {
      updatedSyncStatus = {
        ...existingSyncStatus,
        lastSuccessfulSync: nowIso,
        lastSyncAttempt: nowIso,
        lastSyncStatus: "SYNCED",
        lastSyncError: null,
        lastSyncedCount: totalSynced,
      };
    } else if (totalFailed > 0) {
      updatedSyncStatus = {
        ...existingSyncStatus,
        lastSyncAttempt: nowIso,
        lastSyncStatus: isAuthError ? "AUTH_ERROR" : "FAILED",
        lastSyncError: firstErrorMessage || "Synchronization failed",
      };
    } else {
      updatedSyncStatus = {
        ...existingSyncStatus,
        lastSyncStatus: existingSyncStatus.lastSuccessfulSync ? "SYNCED" : "NEVER_SYNCED",
        lastSyncError: null,
      };
    }

    await new Promise((r) => {
      store.set({
        "acx:pending-sync:v1": pending,
        "acx:sync-status:v1": updatedSyncStatus,
      }, r);
    });
  } catch (err) {
    console.warn("[Acadrix] Sync execution error:", err);
  } finally {
    operationalState.isSyncing = false;
    syncExecutionLock = false;
    await refreshStorageData();
  }
}

manualSyncBtn?.addEventListener("click", () => {
  executeGradeSync();
});

// ── Initialize Settings, Active Tab Probe & Event Listeners ────────────────────
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

  const notificationsToggle = document.getElementById("notificationsToggle");
  if (notificationsToggle) {
    store.get(["notificationsEnabled", "acx:notification-settings:v1"], (res = {}) => {
      const settingsObj = res["acx:notification-settings:v1"] || {};
      const isEnabled = res.notificationsEnabled !== undefined ? res.notificationsEnabled : (settingsObj.enabled ?? true);
      notificationsToggle.checked = Boolean(isEnabled);
    });

    notificationsToggle.addEventListener("change", () => {
      const enabled = notificationsToggle.checked;
      store.get("acx:notification-settings:v1", (res = {}) => {
        const current = res?.["acx:notification-settings:v1"] || {};
        const updated = { ...current, enabled };
        store.set({
          notificationsEnabled: enabled,
          "acx:notification-settings:v1": updated,
        }, () => {
          if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({ type: "RECONCILE_NOTIFICATIONS" }, () => {
              if (chrome.runtime?.lastError) {}
            });
          }
        });
      });
    });
  }

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

  clearGradesBtn?.addEventListener("click", () => {
    store.remove(["acx:grades:v1", "acx:pending-sync:v1", "acx:sync-status:v1"], () => {
      if (clearGradesBtn) {
        clearGradesBtn.textContent = "Cleared";
        setTimeout(() => {
          clearGradesBtn.textContent = "Clear";
        }, 1200);
      }
      refreshStorageData();
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
    if (changes.notificationsEnabled && notificationsToggle) {
      notificationsToggle.checked = Boolean(changes.notificationsEnabled.newValue);
    }
    if (changes["acx:grades:v1"] || changes["acx:deadlines:v1"] || changes["acx:pending-sync:v1"] || changes["acx:sync-status:v1"]) {
      refreshStorageData();
    }
  });

  refreshStorageData();
} else {
  toggles.forEach((t) => t.closest(".row")?.remove());
  selects.forEach((s) => s.closest(".row")?.remove());
  shortcutBtn?.closest(".row")?.remove();
  clearDeadlinesBtn?.closest(".row")?.remove();
  clearGradesBtn?.closest(".row")?.remove();
}

window.addEventListener("online", () => renderOperationalUI());
window.addEventListener("offline", () => renderOperationalUI());

// ── Active Page Status Probe ─────────────────────────────────────────────────
(async () => {
  if (!openBtn || !openStatus) return;
  const tab = await activeTab();
  let host = "";
  try {
    host = new URL(tab?.url || "").hostname;
  } catch {}

  const isIitm = Boolean(tab?.id && QUIZ_HOST.test(host));
  operationalState.tab.isIitm = isIitm;

  if (!isIitm) {
    operationalState.tab.isAssessment = false;
    operationalState.tab.isGradesPage = false;
    operationalState.tab.isReaderOpen = false;
    renderOperationalUI();
    return;
  }

  try {
    const probeResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const hasRuntime = typeof window.__saqOpen === "function";
        let assessment = false;
        let readerOpen = false;
        let gradesPage = false;

        if (typeof window.__saqStatus === "function") {
          const status = window.__saqStatus();
          assessment = Boolean(status?.assessment);
          readerOpen = Boolean(status?.readerOpen);
          gradesPage = Boolean(status?.gradesPage);
        } else if (window.__unfold?.portal?.detectAssessment) {
          assessment = Boolean(window.__unfold.portal.detectAssessment());
          readerOpen = Boolean(window.__unfold?.reader?.isOpen?.());
        } else {
          // Direct DOM fallback probe if runtime is not yet injected/initialized
          const hasPaginator = Boolean(
            document.querySelector(
              "div.chips, .app-assessment-paginator, .assessment-paginator, app-assessment-question-paginator, .chips-wrap"
            )
          );
          const hasQuestion = Boolean(
            document.querySelector(
              "app-assessment-question, app-assessment-question-view, .short-answer, .choices, [role=radiogroup]"
            )
          );
          assessment = hasPaginator && hasQuestion;
          gradesPage = Boolean(document.querySelector(".desktop-container, .mobile-container, app-grades, .grades-container"));
        }

        return {
          version: window.__saqVersion || "",
          hasRuntime,
          assessment,
          readerOpen,
          gradesPage,
        };
      },
    });

    const info = probeResults?.[0]?.result || {};
    operationalState.tab.isAssessment = Boolean(info.assessment);
    operationalState.tab.isReaderOpen = Boolean(info.readerOpen);
    operationalState.tab.isGradesPage = Boolean(info.gradesPage);
    operationalState.tab.hasRuntime = Boolean(info.hasRuntime);
    operationalState.tab.version = info.version || "";

    renderOperationalUI();
  } catch {
    operationalState.tab.isAssessment = false;
    renderOperationalUI();
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
