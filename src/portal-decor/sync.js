/**
 * Acadrix — Extension Grade Synchronization Client (Phase 3).
 *
 * Connects Acadrix's local canonical grade store ("acx:grades:v1") and offline
 * pending queue ("acx:pending-sync:v1") to the Supabase single-user ingestion
 * Edge Function (POST /functions/v1/grade-sync).
 *
 * Architecture Invariants:
 * 1. Single-user, single-tenant, unidirectional: IITM -> Acadrix -> Supabase -> Acdence (read-only).
 * 2. Queue is a dirty index only: values are resolved live from acx:grades:v1 at sync time.
 * 3. Security: Authenticated strictly via GRADE_SYNC_SECRET (x-sync-secret header).
 * 4. Idempotent: Network/server failures preserve pending queue items; successes dequeue atomically.
 * 5. Concurrency protection: Single-flight lock prevents overlapping sync requests.
 */

import { createPortalSyncStatusStore, PORTAL_SYNC_STATUS_STORAGE_KEY } from "./storage.js";
import { classifyByTitle, assignmentKey } from "./core.js";

export const DEFAULT_SUPABASE_URL = "https://aocrcrdmwmdtthrwypii.supabase.co";
export const DEFAULT_SYNC_ENDPOINT = "/functions/v1/grade-sync";
export const DEFAULT_GRADE_SYNC_SECRET = "acx_grade_sync_secret_7f8e9d0c1b2a3b4c5d6e7f8a9b0c1d2e";

let isSyncInProgress = false;

/**
 * Returns whether a synchronization operation is currently in-flight.
 * @returns {boolean}
 */
export function isSyncActive() {
  return isSyncInProgress;
}

/**
 * Retrieves the sync configuration from chrome.storage.local with defaults.
 * @returns {Promise<{ supabaseUrl: string, syncSecret: string }>}
 */
export async function getSyncConfiguration() {
  let supabaseUrl = DEFAULT_SUPABASE_URL;
  let syncSecret = DEFAULT_GRADE_SYNC_SECRET;

  try {
    if (typeof chrome !== "undefined" && chrome?.storage?.local?.get) {
      const stored = await new Promise((resolve) => {
        chrome.storage.local.get(
          ["supabaseUrl", "gradeSyncSecret", "acx:grade-sync-secret", "gradeSyncUrl"],
          (items) => resolve(items || {})
        );
      });

      if (stored.supabaseUrl || stored.gradeSyncUrl) {
        supabaseUrl = stored.supabaseUrl || stored.gradeSyncUrl;
      }
      if (stored.gradeSyncSecret || stored["acx:grade-sync-secret"]) {
        syncSecret = stored.gradeSyncSecret || stored["acx:grade-sync-secret"];
      }
    }
  } catch {}

  return {
    supabaseUrl: (supabaseUrl || DEFAULT_SUPABASE_URL).replace(/\/+$/, ""),
    syncSecret: syncSecret || DEFAULT_GRADE_SYNC_SECRET,
  };
}

/**
 * Formats a canonical grade record into the strict IngestGradeRecord schema
 * expected by the Supabase grade-sync Edge Function.
 *
 * @param {object} record Canonical grade record from acx:grades:v1
 * @returns {object} Formatted ingest record
 */
export function formatIngestRecord(record) {
  if (!record) return null;

  return {
    externalAssignmentId: String(record.externalAssignmentId || "").trim(),
    canonicalAssessmentId:
      record.canonicalAssessmentId && String(record.canonicalAssessmentId).trim().length > 0
        ? String(record.canonicalAssessmentId).trim()
        : null,
    module: String(record.module || "").trim(),
    title: String(record.title || "").trim(),
    assignmentType:
      record.assignmentType && String(record.assignmentType).trim().length > 0
        ? String(record.assignmentType).trim()
        : "Assignment",
    yourScore: typeof record.yourScore === "number" && Number.isFinite(record.yourScore) ? record.yourScore : null,
    yourScoreRaw:
      record.yourScoreRaw !== undefined && record.yourScoreRaw !== null
        ? String(record.yourScoreRaw).trim()
        : null,
    peerAverage:
      typeof record.peerAverage === "number" && Number.isFinite(record.peerAverage)
        ? record.peerAverage
        : null,
    medianScore:
      typeof record.medianScore === "number" && Number.isFinite(record.medianScore)
        ? record.medianScore
        : null,
    scoreStatus:
      record.scoreStatus && String(record.scoreStatus).trim().length > 0
        ? String(record.scoreStatus).trim()
        : "UNRELEASED",
    evaluationStatus:
      record.evaluationStatus && String(record.evaluationStatus).trim().length > 0
        ? String(record.evaluationStatus).trim()
        : "normal",
    dueDate: record.dueDate || record.dueDateIso || null,
    dueDateText: record.dueDateText || record.dueDateRaw || null,
    source: record.source && String(record.source).trim().length > 0 ? String(record.source).trim() : "grades",
    capturedAt: record.capturedAt || null,
  };
}

/**
 * Synchronizes pending grade records from local storage to the Supabase Edge Function.
 *
 * @param {object} options
 * @param {object} options.gradesStore Instance of createPortalGradesStore()
 * @param {object} options.pendingQueue Instance of createPendingSyncQueue()
 * @param {object} [options.syncStatusStore] Instance of createPortalSyncStatusStore()
 * @param {string} [options.supabaseUrl] Custom Supabase URL
 * @param {string} [options.syncSecret] Custom sync secret
 * @param {Function} [options.fetchFn] Custom fetch function (for unit testing)
 * @returns {Promise<{ ok: boolean, syncedCount: number, failedCount: number, orphanCount?: number, results?: Array<object>, error?: string, busy?: boolean, syncStatus?: object }>}
 */
export async function syncGradesToSupabase({
  gradesStore,
  pendingQueue,
  syncStatusStore,
  supabaseUrl,
  syncSecret,
  fetchFn = globalThis.fetch,
} = {}) {
  const statusStore = syncStatusStore || createPortalSyncStatusStore();

  if (!gradesStore || !pendingQueue) {
    const err = "Missing required stores (gradesStore and pendingQueue are mandatory)";
    try {
      await statusStore.updateStatus({
        lastSyncAttempt: new Date().toISOString(),
        lastSyncStatus: "FAILED",
        lastSyncError: err,
      });
    } catch {}
    return {
      ok: false,
      error: err,
      syncedCount: 0,
      failedCount: 0,
    };
  }

  // 1. Single-Flight Concurrency Guard
  if (isSyncInProgress) {
    return {
      ok: false,
      busy: true,
      reason: "SYNC_IN_PROGRESS",
      syncedCount: 0,
      failedCount: 0,
    };
  }

  isSyncInProgress = true;

  try {
    // Check network connectivity if available
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      await statusStore.updateStatus({
        lastSyncAttempt: new Date().toISOString(),
        lastSyncStatus: "OFFLINE",
        lastSyncError: "Device is offline",
      });
      return {
        ok: false,
        error: "Device is offline",
        syncedCount: 0,
        failedCount: 0,
      };
    }

    await statusStore.updateStatus({
      lastSyncAttempt: new Date().toISOString(),
      lastSyncStatus: "SYNCING",
    });

    // 2. Read pending queue items
    const pendingItems = await pendingQueue.getPending();
    if (!pendingItems || pendingItems.length === 0) {
      const current = await statusStore.getStatus();
      const nextStatus = current.lastSuccessfulSync ? "SYNCED" : "NEVER_SYNCED";
      await statusStore.updateStatus({
        lastSyncStatus: nextStatus,
        lastSyncError: null,
      });
      return {
        ok: true,
        syncedCount: 0,
        failedCount: 0,
        results: [],
        message: "Pending queue is empty",
      };
    }

    // 3. Resolve sync configuration
    const config = await getSyncConfiguration();
    const finalUrl = (supabaseUrl || config.supabaseUrl || DEFAULT_SUPABASE_URL).replace(/\/+$/, "");
    const finalSecret = syncSecret !== undefined ? syncSecret : (config.syncSecret || DEFAULT_GRADE_SYNC_SECRET);

    if (!finalSecret) {
      const err = "GRADE_SYNC_SECRET is not configured";
      await statusStore.updateStatus({
        lastSyncAttempt: new Date().toISOString(),
        lastSyncStatus: "AUTH_ERROR",
        lastSyncError: err,
      });
      return {
        ok: false,
        error: err,
        syncedCount: 0,
        failedCount: pendingItems.length,
      };
    }

    // 4. Resolve LIVE canonical records from acx:grades:v1 (Queue is a dirty index only)
    const allGrades = await gradesStore.getAll();
    const groups = new Map(); // groupKey -> { termId, courseCode, keys: [], records: [] }
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

      const liveRecord = allGrades?.[termId]?.[courseCode]?.[externalAssignmentId];
      if (!liveRecord) {
        // Queued item has no matching canonical record in acx:grades:v1
        orphanKeys.push(queueKey);
        continue;
      }

      const groupKey = `${termId}:${courseCode}`;
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          termId,
          courseCode,
          keys: [],
          records: [],
        });
      }

      const group = groups.get(groupKey);
      group.keys.push(queueKey);
      group.records.push(liveRecord);
    }

    // 5. Clean up orphan queue keys safely
    if (orphanKeys.length > 0) {
      await pendingQueue.dequeue(orphanKeys);
    }

    if (groups.size === 0) {
      const current = await statusStore.getStatus();
      const nextStatus = current.lastSuccessfulSync ? "SYNCED" : "NEVER_SYNCED";
      await statusStore.updateStatus({
        lastSyncStatus: nextStatus,
        lastSyncError: null,
      });
      return {
        ok: true,
        syncedCount: 0,
        failedCount: 0,
        orphanCount: orphanKeys.length,
        results: [],
      };
    }

    // 6. Execute atomic batch HTTP POST per (termId, courseCode) group
    let totalSynced = 0;
    let totalFailed = 0;
    let hasAuthError = false;
    let firstErrorMessage = null;
    const batchResults = [];
    const endpoint = `${finalUrl}${DEFAULT_SYNC_ENDPOINT}`;

    for (const [groupKey, group] of groups.entries()) {
      const formattedRecords = group.records.map(formatIngestRecord).filter(Boolean);

      if (formattedRecords.length === 0) {
        await pendingQueue.dequeue(group.keys);
        continue;
      }

      const payload = {
        termId: group.termId,
        courseCode: group.courseCode,
        records: formattedRecords,
      };

      try {
        const response = await fetchFn(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-sync-secret": finalSecret,
          },
          body: JSON.stringify(payload),
        });

        let responseBody = null;
        try {
          responseBody = await response.json();
        } catch {}

        if (response.ok && responseBody?.ok) {
          // Success! Dequeue ONLY the synchronized keys for this group
          await pendingQueue.dequeue(group.keys);
          totalSynced += formattedRecords.length;
          batchResults.push({
            group: groupKey,
            ok: true,
            syncedCount: formattedRecords.length,
            upserted: responseBody.upserted ?? formattedRecords.length,
          });
        } else {
          // Failure: Preserve keys in queue for next cycle/retry
          totalFailed += formattedRecords.length;
          const errMsg = responseBody?.error || `HTTP ${response.status}`;
          if (!firstErrorMessage) firstErrorMessage = errMsg;
          if (response.status === 401 || response.status === 403) {
            hasAuthError = true;
          }
          batchResults.push({
            group: groupKey,
            ok: false,
            status: response.status,
            error: errMsg,
            details: responseBody?.details || null,
            failedCount: formattedRecords.length,
          });
        }
      } catch (netErr) {
        // Network or fetch exception: Preserve keys in queue for offline retry
        totalFailed += formattedRecords.length;
        const errMsg = netErr?.message || "Network request failed";
        if (!firstErrorMessage) firstErrorMessage = errMsg;
        batchResults.push({
          group: groupKey,
          ok: false,
          error: errMsg,
          failedCount: formattedRecords.length,
        });
      }
    }

    const nowIso = new Date().toISOString();
    let finalSyncStatus = "SYNCED";

    if (totalFailed === 0 && totalSynced > 0) {
      finalSyncStatus = "SYNCED";
      await statusStore.updateStatus({
        lastSuccessfulSync: nowIso,
        lastSyncAttempt: nowIso,
        lastSyncStatus: "SYNCED",
        lastSyncError: null,
        lastSyncedCount: totalSynced,
      });
    } else if (totalFailed > 0) {
      finalSyncStatus = hasAuthError ? "AUTH_ERROR" : "FAILED";
      await statusStore.updateStatus({
        lastSyncAttempt: nowIso,
        lastSyncStatus: finalSyncStatus,
        lastSyncError: firstErrorMessage || "Synchronization failed",
        lastSyncedCount: totalSynced,
      });
    }

    return {
      ok: totalFailed === 0,
      syncedCount: totalSynced,
      failedCount: totalFailed,
      orphanCount: orphanKeys.length,
      results: batchResults,
      syncStatus: await statusStore.getStatus(),
    };
  } finally {
    isSyncInProgress = false;
  }
}

/**
 * Fetches canonical assessment deadlines from Supabase Edge Function (GET /functions/v1/grade-sync?termId=...&courseCode=...).
 * Portal grades are strictly authoritative and NEVER fetched from Supabase.
 * Only deadlines are populated into decorStore (acx:deadlines:v1) when not yet scraped from the DOM.
 *
 * @param {object} options
 * @param {string} options.termId
 * @param {string} options.courseCode
 * @param {object} [options.decorStore] Instance of createPortalDecorStore()
 * @param {string} [options.supabaseUrl]
 * @param {string} [options.syncSecret]
 * @param {Function} [options.fetchFn]
 * @returns {Promise<{ ok: boolean, deadlines?: Array<object>, error?: string }>}
 */
export async function fetchDeadlinesFromSupabase({
  termId,
  courseCode,
  decorStore = null,
  supabaseUrl,
  syncSecret,
  fetchFn = globalThis.fetch,
} = {}) {
  if (!termId || !courseCode) return { ok: false, error: "Missing termId or courseCode" };

  try {
    const config = await getSyncConfiguration();
    const finalUrl = (supabaseUrl || config.supabaseUrl || DEFAULT_SUPABASE_URL).replace(/\/+$/, "");
    const finalSecret = syncSecret !== undefined ? syncSecret : (config.syncSecret || DEFAULT_GRADE_SYNC_SECRET);

    if (!finalSecret) return { ok: false, error: "Missing sync secret" };

    const endpoint = `${finalUrl}${DEFAULT_SYNC_ENDPOINT}?termId=${encodeURIComponent(termId)}&courseCode=${encodeURIComponent(courseCode)}`;
    const response = await fetchFn(endpoint, {
      method: "GET",
      headers: {
        "x-sync-secret": finalSecret,
      },
    });

    if (!response.ok) {
      return { ok: false, status: response.status, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    if (!data?.ok || !Array.isArray(data?.records)) {
      return { ok: false, error: "Invalid response format" };
    }

    const deadlines = data.records
      .filter((r) => r && (r.due_date || r.due_date_text))
      .map((r) => ({
        externalAssignmentId: r.external_assignment_id,
        module: r.module || "",
        title: r.title || "",
        assignmentType: r.assignment_type || "Assignment",
        dueDate: r.due_date || null,
        dueDateText: r.due_date_text || null,
      }));

    if (decorStore?.capture) {
      const courseKey = `${termId} - ${courseCode}`;
      for (const item of deadlines) {
        const mode = classifyByTitle(item.title);
        const decorKey = assignmentKey(courseKey, item.module, item.title);
        await decorStore.capture(courseKey, decorKey, {
          id: decorKey,
          courseKey,
          module: item.module,
          assignmentId: decorKey,
          title: item.title,
          type: item.assignmentType,
          mode,
          modeRaw: "",
          dueDate: item.dueDate,
          dueDateText: item.dueDateText,
          deadlineIso: item.dueDate,
          deadlineRaw: item.dueDateText,
          source: "supabase_deadlines",
          capturedAt: Date.now(),
        });
      }
    }

    return { ok: true, deadlines };
  } catch (err) {
    return { ok: false, error: err?.message || "Failed to fetch deadlines from Supabase" };
  }
}


