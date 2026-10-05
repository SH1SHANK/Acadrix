/**
 * Chrome storage persistence layers for Acadrix:
 * 1. "acx:deadlines:v1"    -> Deadline decorations and sidebar metadata
 * 2. "acx:grades:v1"       -> Canonical Grade Model store (Phase 2)
 * 3. "acx:pending-sync:v1" -> Offline synchronization queue (Phase 2/3 bridge)
 */

const PORTAL_DECOR_STORAGE_KEY = "acx:deadlines:v1";
const PORTAL_GRADES_STORAGE_KEY = "acx:grades:v1";
const PORTAL_PENDING_SYNC_STORAGE_KEY = "acx:pending-sync:v1";
const PORTAL_SYNC_STATUS_STORAGE_KEY = "acx:sync-status:v1";

const PORTAL_DECOR_MAX_AGE = 120 * 24 * 60 * 60 * 1000;
const PORTAL_DECOR_STALE_AGE = 24 * 60 * 60 * 1000;

// In-memory fallbacks when chrome.storage.local is unavailable
const memoryStores = {
  [PORTAL_DECOR_STORAGE_KEY]: {},
  [PORTAL_GRADES_STORAGE_KEY]: {},
  [PORTAL_PENDING_SYNC_STORAGE_KEY]: {},
  [PORTAL_SYNC_STATUS_STORAGE_KEY]: {},
};

function getStorageArea() {
  try {
    return globalThis.chrome?.storage?.local || null;
  } catch {
    return null;
  }
}

function readKey(key, callback) {
  const store = getStorageArea();
  if (!store?.get) {
    return callback(structuredClone(memoryStores[key] || {}));
  }
  try {
    store.get({ [key]: {} }, (value) => {
      const data = value?.[key];
      callback(data && typeof data === "object" ? data : structuredClone(memoryStores[key] || {}));
    });
  } catch {
    callback(structuredClone(memoryStores[key] || {}));
  }
}

function writeKey(key, data, callback = () => {}) {
  memoryStores[key] = structuredClone(data || {});
  const store = getStorageArea();
  if (!store?.set) return callback();
  try {
    store.set({ [key]: data }, callback);
  } catch {
    callback();
  }
}

// ============================================================================
// 1. DEADLINES STORE (acx:deadlines:v1) - Preserved for Sidebar Decor
// ============================================================================

function portalDecorPrune(data, now = Date.now()) {
  const result = {};
  for (const [courseKey, entries] of Object.entries(data || {})) {
    const fresh = Object.entries(entries || {})
      .filter(([, entry]) => now - Number(entry?.capturedAt || 0) <= PORTAL_DECOR_MAX_AGE)
      .sort((a, b) => Number(b[1]?.capturedAt || 0) - Number(a[1]?.capturedAt || 0))
      .slice(0, 500);
    if (fresh.length) result[courseKey] = Object.fromEntries(fresh);
  }
  return result;
}

export function isPortalDecorStale(entry, now = Date.now()) {
  return Boolean(entry?.capturedAt && now - Number(entry.capturedAt) > PORTAL_DECOR_STALE_AGE);
}

export function createPortalDecorStore(now = () => Date.now()) {
  const read = () => new Promise((resolve) => readKey(PORTAL_DECOR_STORAGE_KEY, resolve));
  const write = (data) => new Promise((resolve) => writeKey(PORTAL_DECOR_STORAGE_KEY, data, resolve));

  return {
    async getAll() {
      const loaded = await read();
      const data = portalDecorPrune(loaded, now());
      if (JSON.stringify(data) !== JSON.stringify(loaded)) await write(data);
      return data;
    },
    async get(courseKey, key) {
      const data = await this.getAll();
      return data?.[courseKey]?.[key] || null;
    },
    async capture(courseKey, key, incoming) {
      const data = await this.getAll();
      const previous = data[courseKey]?.[key] || {};
      const incomingAt = Number(incoming.capturedAt || now());
      const previousAt = Number(previous.capturedAt || 0);
      const next = { ...previous, ...incoming, capturedAt: incomingAt };

      if (incomingAt < previousAt) {
        next.deadlineIso = previous.deadlineIso;
        next.deadlineRaw = previous.deadlineRaw;
        next.source = previous.source;
        if (previous.yourScore !== undefined) {
          next.yourScore = previous.yourScore;
          next.yourScoreRaw = previous.yourScoreRaw;
          next.peerAverage = previous.peerAverage;
          next.medianScore = previous.medianScore;
          next.scoreStatus = previous.scoreStatus;
          next.evaluationStatus = previous.evaluationStatus;
        }
      }

      if (incoming.mode === undefined && previous.mode !== undefined) next.mode = previous.mode;
      if (incoming.modeRaw === undefined && previous.modeRaw !== undefined) next.modeRaw = previous.modeRaw;
      if (incoming.source === "grades" && previous.mode !== undefined && previous.mode !== "unknown") {
        next.mode = previous.mode;
        next.modeRaw = previous.modeRaw;
      }
      if (incoming.yourScore === undefined || (incoming.yourScore === null && incoming.source === "start")) {
        if (previous.yourScore !== undefined && previous.yourScore !== null) {
          next.yourScore = previous.yourScore;
          next.yourScoreRaw = previous.yourScoreRaw;
          next.scoreStatus = previous.scoreStatus || "GRADED";
        }
      }
      if (incoming.peerAverage === undefined && previous.peerAverage !== undefined) {
        next.peerAverage = previous.peerAverage;
      }
      if (incoming.medianScore === undefined && previous.medianScore !== undefined) {
        next.medianScore = previous.medianScore;
      }
      if (previous.submissionStatus === "SUBMITTED" && incoming.submissionStatus !== "SUBMITTED") {
        next.submissionStatus = previous.submissionStatus;
        next.submissionStatusSource = previous.submissionStatusSource;
        next.submissionCheckedAt = previous.submissionCheckedAt;
      }
      if ((!incoming.deadlineIso || incoming.deadlineIso === "") && previous.deadlineIso) {
        next.deadlineIso = previous.deadlineIso;
        next.deadlineRaw = previous.deadlineRaw;
        next.dueDate = previous.dueDate || previous.deadlineIso;
        next.dueDateText = previous.dueDateText || previous.deadlineRaw;
        next.deadlineSource = previous.deadlineSource || "LOCAL";
        next.deadlineVerifiedAt = previous.deadlineVerifiedAt || previous.capturedAt;
      }

      data[courseKey] ||= {};
      data[courseKey][key] = next;
      await write(portalDecorPrune(data, now()));
      return next;
    },
    async clear() {
      memoryStores[PORTAL_DECOR_STORAGE_KEY] = {};
      const store = getStorageArea();
      if (!store?.remove) return;
      try {
        await new Promise((resolve) => store.remove(PORTAL_DECOR_STORAGE_KEY, resolve));
      } catch {}
    },
  };
}

// ============================================================================
// 2. CANONICAL GRADE STORE (acx:grades:v1) - Single-User Authoritative Grades
// ============================================================================

export function createPortalGradesStore(now = () => Date.now()) {
  const read = () => new Promise((resolve) => readKey(PORTAL_GRADES_STORAGE_KEY, resolve));
  const write = (data) => new Promise((resolve) => writeKey(PORTAL_GRADES_STORAGE_KEY, data, resolve));

  return {
    async getAll() {
      const data = await read();
      return (data && typeof data === "object") ? data : {};
    },
    async getCourseGrades(termId, courseCode) {
      const data = await this.getAll();
      const courseMap = data?.[termId]?.[courseCode] || {};
      return Object.values(courseMap);
    },
    async saveCourseGrades(termId, courseCode, records) {
      const data = await this.getAll();
      data[termId] ||= {};
      const prevCourse = data[termId][courseCode] || {};
      data[termId][courseCode] = {};

      for (const rec of records) {
        if (rec && rec.externalAssignmentId) {
          const prev = prevCourse[rec.externalAssignmentId];
          const cloned = structuredClone(rec);
          if (prev?.submissionStatus === "SUBMITTED" && cloned.submissionStatus !== "SUBMITTED") {
            cloned.submissionStatus = "SUBMITTED";
            cloned.submissionStatusSource = prev.submissionStatusSource;
            cloned.submissionCheckedAt = prev.submissionCheckedAt;
          }
          if ((!cloned.dueDate || cloned.dueDate === "") && prev?.dueDate) {
            cloned.dueDate = prev.dueDate;
            cloned.dueDateText = prev.dueDateText;
            cloned.deadlineSource = prev.deadlineSource || "LOCAL";
            cloned.deadlineVerifiedAt = prev.deadlineVerifiedAt || prev.capturedAt;
          }
          data[termId][courseCode][rec.externalAssignmentId] = cloned;
        }
      }

      await write(data);
      return Object.values(data[termId][courseCode]);
    },
    async captureRecord(record) {
      if (!record?.termId || !record?.courseCode || !record?.externalAssignmentId) {
        return null;
      }
      const data = await this.getAll();
      data[record.termId] ||= {};
      data[record.termId][record.courseCode] ||= {};
      const prev = data[record.termId]?.[record.courseCode]?.[record.externalAssignmentId];
      const cloned = structuredClone(record);
      if (prev?.submissionStatus === "SUBMITTED" && cloned.submissionStatus !== "SUBMITTED") {
        cloned.submissionStatus = "SUBMITTED";
        cloned.submissionStatusSource = prev.submissionStatusSource;
        cloned.submissionCheckedAt = prev.submissionCheckedAt;
      }
      if ((!cloned.dueDate || cloned.dueDate === "") && prev?.dueDate) {
        cloned.dueDate = prev.dueDate;
        cloned.dueDateText = prev.dueDateText;
        cloned.deadlineSource = prev.deadlineSource || "LOCAL";
        cloned.deadlineVerifiedAt = prev.deadlineVerifiedAt || prev.capturedAt;
      }
      data[record.termId][record.courseCode][record.externalAssignmentId] = cloned;
      await write(data);
      return record;
    },
    async clear() {
      memoryStores[PORTAL_GRADES_STORAGE_KEY] = {};
      const store = getStorageArea();
      if (!store?.remove) return;
      try {
        await new Promise((resolve) => store.remove(PORTAL_GRADES_STORAGE_KEY, resolve));
      } catch {}
    },
  };
}

// ============================================================================
// 3. PENDING SYNC QUEUE (acx:pending-sync:v1) - Deduplicated Sync Queue
// ============================================================================

export function createPendingSyncQueue() {
  const read = () => new Promise((resolve) => readKey(PORTAL_PENDING_SYNC_STORAGE_KEY, resolve));
  const write = (data) => new Promise((resolve) => writeKey(PORTAL_PENDING_SYNC_STORAGE_KEY, data, resolve));

  return {
    async getPending() {
      const data = await read();
      return (data && typeof data === "object") ? Object.values(data) : [];
    },
    async enqueue(items) {
      const data = await read();
      const list = Array.isArray(items) ? items : [items];
      const nowIso = new Date().toISOString();

      for (const item of list) {
        if (!item?.termId || !item?.courseCode || !item?.externalAssignmentId) continue;
        const queueKey = `${item.termId}:${item.courseCode}:${item.externalAssignmentId}`;
        data[queueKey] = {
          key: queueKey,
          termId: item.termId,
          courseCode: item.courseCode,
          externalAssignmentId: item.externalAssignmentId,
          queuedAt: item.capturedAt || nowIso,
        };
      }

      await write(data);
      return Object.values(data);
    },
    async dequeue(keys) {
      const data = await read();
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) {
        delete data[k];
      }
      await write(data);
      return Object.values(data);
    },
    async clear() {
      memoryStores[PORTAL_PENDING_SYNC_STORAGE_KEY] = {};
      const store = getStorageArea();
      if (!store?.remove) return;
      try {
        await new Promise((resolve) => store.remove(PORTAL_PENDING_SYNC_STORAGE_KEY, resolve));
      } catch {}
    },
  };
}

// ============================================================================
// 4. SYNC STATUS STORE (acx:sync-status:v1) - Operational Sync Metadata
// ============================================================================

export function createPortalSyncStatusStore() {
  const read = () => new Promise((resolve) => readKey(PORTAL_SYNC_STATUS_STORAGE_KEY, resolve));
  const write = (data) => new Promise((resolve) => writeKey(PORTAL_SYNC_STATUS_STORAGE_KEY, data, resolve));

  const defaultStatus = {
    lastSuccessfulSync: null,
    lastSyncAttempt: null,
    lastSyncStatus: "NEVER_SYNCED", // NEVER_SYNCED | SYNCING | SYNCED | FAILED | AUTH_ERROR | OFFLINE
    lastSyncError: null,
    lastSyncedCount: 0,
  };

  return {
    async getStatus() {
      const data = await read();
      return (data && typeof data === "object" && Object.keys(data).length > 0)
        ? { ...defaultStatus, ...data }
        : structuredClone(defaultStatus);
    },
    async updateStatus(updates = {}) {
      const current = await this.getStatus();
      const next = {
        ...current,
        ...updates,
      };
      // Invariant: Never erase lastSuccessfulSync on failed sync attempts unless explicitly set
      if (!updates.lastSuccessfulSync && current.lastSuccessfulSync) {
        next.lastSuccessfulSync = current.lastSuccessfulSync;
      }
      await write(next);
      return next;
    },
    async clear() {
      memoryStores[PORTAL_SYNC_STATUS_STORAGE_KEY] = {};
      const store = getStorageArea();
      if (!store?.remove) return;
      try {
        await new Promise((resolve) => store.remove(PORTAL_SYNC_STATUS_STORAGE_KEY, resolve));
      } catch {}
    },
  };
}

export {
  PORTAL_DECOR_STORAGE_KEY,
  PORTAL_GRADES_STORAGE_KEY,
  PORTAL_PENDING_SYNC_STORAGE_KEY,
  PORTAL_SYNC_STATUS_STORAGE_KEY,
};
