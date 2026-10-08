/**
 * Acadrix — Academic Synchronization & Deadlines Client.
 * 
 * Conforms to the Simplified Academic Data Architecture:
 * - Grade sync is deprecated and removed; grades are strictly out of scope.
 * - Deadlines are fetched exclusively from public.academic_events via AcademicEventRepository.
 */

import { createPortalSyncStatusStore, PORTAL_SYNC_STATUS_STORAGE_KEY } from "./storage.js";
import { classifyByTitle, assignmentKey } from "./core.js";
import { AcademicEventRepository } from "../notifications/events.js";

export const DEFAULT_SYNC_SUPABASE_URL = "https://aocrcrdmwmdtthrwypii.supabase.co";
export { DEFAULT_SYNC_SUPABASE_URL as DEFAULT_SUPABASE_URL };
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
  let supabaseUrl = DEFAULT_SYNC_SUPABASE_URL;
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
 * Formats a grade record into IngestGradeRecord schema (pure utility).
 * @param {object} record
 * @returns {object|null}
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
    yourScore: typeof record.yourScore === "number" && !isNaN(record.yourScore) ? record.yourScore : null,
    yourScoreRaw:
      record.yourScoreRaw !== undefined && record.yourScoreRaw !== null
        ? String(record.yourScoreRaw).trim()
        : null,
    peerAverage:
      typeof record.peerAverage === "number" && !isNaN(record.peerAverage) ? record.peerAverage : null,
    medianScore:
      typeof record.medianScore === "number" && !isNaN(record.medianScore) ? record.medianScore : null,
    scoreStatus:
      record.scoreStatus && String(record.scoreStatus).trim().length > 0
        ? String(record.scoreStatus).trim()
        : "UNRELEASED",
    evaluationStatus:
      record.evaluationStatus && String(record.evaluationStatus).trim().length > 0
        ? String(record.evaluationStatus).trim()
        : "normal",
    dueDate: record.dueDate ? new Date(record.dueDate).toISOString() : null,
    dueDateText:
      record.dueDateText !== undefined && record.dueDateText !== null
        ? String(record.dueDateText).trim()
        : null,
    source: record.source && String(record.source).trim().length > 0 ? String(record.source).trim() : "grades",
    capturedAt: record.capturedAt ? new Date(record.capturedAt).toISOString() : new Date().toISOString(),
  };
}

/**
 * @deprecated Grade synchronization removed (§4). Grades are out of scope for Acadrix.
 */
export async function syncGradesToSupabase({
  gradesStore,
  pendingQueue,
  syncStatusStore,
} = {}) {
  const statusStore = syncStatusStore || createPortalSyncStatusStore();
  if (pendingQueue?.clear) {
    await pendingQueue.clear();
  }
  if (statusStore?.updateStatus) {
    await statusStore.updateStatus({
      lastSuccessfulSync: new Date().toISOString(),
      lastSyncAttempt: new Date().toISOString(),
      lastSyncStatus: "SUCCESS",
      lastSyncError: null,
      pendingCount: 0,
    });
  }
  return {
    ok: true,
    syncedCount: 0,
    failedCount: 0,
    orphanCount: 0,
    results: [],
    reason: "GRADES_REMOVED",
  };
}

/**
 * Fetches canonical assessment deadlines from Supabase public.academic_events.
 * 
 * @param {object} options
 * @param {string} options.termId
 * @param {string} [options.courseCode]
 * @param {object} [options.decorStore]
 * @param {string} [options.supabaseUrl]
 * @param {Function} [options.fetchFn]
 * @returns {Promise<{ ok: boolean, deadlines?: Array<object>, error?: string }>}
 */
export async function fetchDeadlinesFromSupabase({
  termId,
  courseCode,
  decorStore = null,
  supabaseUrl,
  fetchFn = globalThis.fetch,
} = {}) {
  if (!termId) return { ok: false, error: "Missing termId" };

  try {
    const repo = new AcademicEventRepository({
      supabaseUrl: supabaseUrl || DEFAULT_SYNC_SUPABASE_URL,
      fetchFn: fetchFn || globalThis.fetch,
    });

    const res = await repo.getUpcomingDeadlines({ termId });
    const events = res.events || [];

    const matchedEvents = events.filter((e) => {
      if (!e.deadlineIso) return false;
      if (!e.courseCode) return true; // Term-wide events apply to all courses
      return !courseCode || e.courseCode.toLowerCase() === courseCode.toLowerCase();
    });

    const deadlines = matchedEvents.map((r) => ({
      externalAssignmentId: r.id,
      module: r.subType || r.eventType || "",
      title: r.title,
      assignmentType: r.eventType || "Assignment",
      dueDate: r.deadlineIso,
      dueDateText: r.timeStr || null,
    }));

    if (decorStore?.capture && courseCode) {
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
          source: "SUPABASE",
          capturedAt: Date.now(),
        });
      }
    }

    return { ok: true, deadlines };
  } catch (err) {
    return { ok: false, error: err?.message || "Failed to fetch deadlines from Supabase" };
  }
}
