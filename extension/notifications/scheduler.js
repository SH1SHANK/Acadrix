/**
 * Acadrix Smart Deadline & Notification System - Chrome Alarms Scheduler & Dispatcher
 * Idempotent reconciliation of assessment deadlines with Chrome Alarms.
 * Strictly event-driven via chrome.alarms.onAlarm, zero polling intervals.
 */

import {
  ALARM_PREFIX,
  SubmissionStatus,
  DeadlineStatus,
  DeadlineSource,
  NotificationCategory,
} from "./types.js";
import {
  determineActionableNotification,
  createNotificationDedupeKey,
  resolveDeadline,
} from "./evaluator.js";
import {
  getNotificationSettings,
  getSentNotifications,
  recordNotificationSent,
} from "./storage.js";
import {
  parseTermId,
  parseCourseCode,
  createExternalAssignmentId,
} from "../portal-decor/core.js";
import { AcademicEventRepository } from "./events.js";
// Storage keys
const SCHEDULER_GRADES_STORAGE_KEY = "acx:grades:v1";
const SCHEDULER_DECOR_STORAGE_KEY = "acx:deadlines:v1";

function getSchedulerStorageArea() {
  try {
    return globalThis.chrome?.storage?.local || null;
  } catch {
    return null;
  }
}

function readSchedulerStorageKey(key) {
  return new Promise((resolve) => {
    const store = getSchedulerStorageArea();
    if (!store?.get) return resolve({});
    try {
      store.get({ [key]: {} }, (res) => resolve(res?.[key] || {}));
    } catch {
      resolve({});
    }
  });
}

function writeSchedulerStorageKey(key, data) {
  return new Promise((resolve) => {
    const store = getSchedulerStorageArea();
    if (!store?.set) return resolve();
    try {
      store.set({ [key]: data }, () => resolve());
    } catch {
      resolve();
    }
  });
}
function getAllAlarms() {
  return new Promise((resolve) => {
    try {
      if (!globalThis.chrome?.alarms?.getAll) return resolve([]);
      globalThis.chrome.alarms.getAll((alarms) => resolve(alarms || []));
    } catch {
      resolve([]);
    }
  });
}

function createAlarm(name, alarmInfo) {
  return new Promise((resolve) => {
    try {
      if (!globalThis.chrome?.alarms?.create) return resolve(false);
      globalThis.chrome.alarms.create(name, alarmInfo);
      resolve(true);
    } catch {
      resolve(false);
    }
  });
}

function clearAlarm(name) {
  return new Promise((resolve) => {
    try {
      if (!globalThis.chrome?.alarms?.clear) return resolve(false);
      globalThis.chrome.alarms.clear(name, (wasCleared) => resolve(Boolean(wasCleared)));
    } catch {
      resolve(false);
    }
  });
}

function createChromeNotification(notificationId, options) {
  return new Promise((resolve) => {
    try {
      if (!globalThis.chrome?.notifications?.create) return resolve(null);
      globalThis.chrome.notifications.create(notificationId, options, (id) => resolve(id || notificationId));
    } catch {
      resolve(null);
    }
  });
}

/**
 * Formats a standardized alarm name.
 *
 * @param {object} params
 * @param {string} params.termId
 * @param {string} params.courseCode
 * @param {string} params.externalAssignmentId
 * @param {string} params.category
 * @returns {string}
 */
export function formatAlarmName({ termId = "default", courseCode = "default", externalAssignmentId, category }) {
  return `${ALARM_PREFIX}${termId}:${courseCode}:${externalAssignmentId}:${category}`;
}

/**
 * Parses a standardized alarm name into components.
 *
 * @param {string} alarmName
 * @returns {{ termId: string, courseCode: string, externalAssignmentId: string, category: string } | null}
 */
export function parseAlarmName(alarmName) {
  if (!alarmName || typeof alarmName !== "string" || !alarmName.startsWith(ALARM_PREFIX)) {
    return null;
  }
  const rest = alarmName.slice(ALARM_PREFIX.length);
  const parts = rest.split(":");
  if (parts.length < 4) return null;

  return {
    termId: parts[0],
    courseCode: parts[1],
    externalAssignmentId: parts.slice(2, parts.length - 1).join(":"),
    category: parts[parts.length - 1],
  };
}

/**
 * Calculates future trigger timestamps for an assignment's deadline.
 *
 * @param {object} params
 * @param {string} params.deadlineIso
 * @param {number|Date} [params.now]
 * @returns {Array<{ category: string, triggerTime: number }>}
 */
export function calculateAlarmTriggerTimes({ deadlineIso, now = Date.now() }) {
  if (!deadlineIso) return [];
  const deadlineMs = new Date(deadlineIso).getTime();
  if (isNaN(deadlineMs)) return [];

  const currentMs = typeof now === "function" ? now() : Number(now || Date.now());

  const candidates = [
    {
      category: NotificationCategory.WINDOW_3_DAYS,
      triggerTime: deadlineMs - 72 * 3600 * 1000,
    },
    {
      category: NotificationCategory.WINDOW_24_HOURS,
      triggerTime: deadlineMs - 24 * 3600 * 1000,
    },
    {
      category: NotificationCategory.WINDOW_6_HOURS,
      triggerTime: deadlineMs - 6 * 3600 * 1000,
    },
    {
      category: NotificationCategory.WINDOW_OVERDUE,
      triggerTime: deadlineMs + 60 * 1000, // 1 minute after deadline
    },
  ];

  return candidates.filter((c) => c.triggerTime > currentMs);
}

/**
 * Collects all tracked assignments from grades and decor storage.
 * Authoritative grades store takes precedence over decor store.
 *
 * @param {object} [options]
 * @param {object} [options.gradesStore]
 * @param {object} [options.deadlinesStore]
 * @returns {Promise<Array<object>>}
 */
export async function getAllTrackedAssignments({
  gradesStore = null,
  deadlinesStore = null,
  repository = null,
  fetchFn = null,
  allowSupabaseFallback = true,
} = {}) {
  // 1. If explicit repository provided:
  if (repository) {
    try {
      const res = await repository.getUpcomingDeadlines();
      const events = Array.isArray(res?.events) ? res.events : [];
      return events.map((ev) => ({
        termId: ev.termId,
        courseCode: ev.courseCode || "",
        externalAssignmentId: ev.id,
        canonicalAssessmentId: ev.identity,
        title: ev.title,
        module: ev.subType || ev.eventType || "",
        dueDate: ev.deadlineIso,
        deadlineIso: ev.deadlineIso,
        dueDateText: ev.timeStr || null,
        deadlineRaw: ev.timeStr || null,
        deadlineSource: "SUPABASE",
        deadlineVerifiedAt: ev.fetchedAt || new Date().toISOString(),
        submissionStatus: ev.submissionStatus || SubmissionStatus.UNKNOWN,
        yourScore: null,
        evaluationStatus: "",
        source: "SUPABASE",
        isHardCutoff: ev.isHardCutoff,
        cutoffType: ev.cutoffType,
        importance: ev.importance,
      }));
    } catch {}
  }

  // 2. Unit-test / Mock Harness Compatibility Fallback
  const assignmentsMap = new Map();
  const gradesData = gradesStore?.getAll
    ? await gradesStore.getAll()
    : await readSchedulerStorageKey(SCHEDULER_GRADES_STORAGE_KEY);

  if (gradesData && typeof gradesData === "object" && Object.keys(gradesData).length > 0) {
    for (const [termId, courseMap] of Object.entries(gradesData)) {
      if (!courseMap || typeof courseMap !== "object") continue;
      for (const [courseCode, assignMap] of Object.entries(courseMap)) {
        if (!assignMap || typeof assignMap !== "object") continue;
        for (const [extId, record] of Object.entries(assignMap)) {
          if (!record || typeof record !== "object") continue;
          const key = `${termId}:${courseCode}:${extId}`;
          const resolved = resolveDeadline(record);
          assignmentsMap.set(key, {
            termId,
            courseCode,
            externalAssignmentId: extId,
            canonicalAssessmentId: record.canonicalAssessmentId || null,
            title: record.title || "Assignment",
            module: record.module || "",
            dueDate: resolved.deadlineIso,
            deadlineIso: resolved.deadlineIso,
            dueDateText: resolved.deadlineRaw || record.dueDateText || null,
            deadlineRaw: resolved.deadlineRaw || record.deadlineRaw || null,
            deadlineSource: record.deadlineSource || resolved.source,
            deadlineVerifiedAt: resolved.verifiedAt,
            submissionStatus: record.submissionStatus || SubmissionStatus.UNKNOWN,
            yourScore: record.yourScore ?? null,
            evaluationStatus: record.evaluationStatus || "",
            source: record.source || "SUPABASE",
          });
        }
      }
    }
  }

  if (assignmentsMap.size > 0) {
    const missingDeadlines = Array.from(assignmentsMap.values()).filter(
      (a) => !a.dueDate || a.deadlineSource === DeadlineSource.UNKNOWN
    );

    if (missingDeadlines.length > 0 && allowSupabaseFallback && typeof fetchFn === "function") {
      try {
        const resp = await fetchFn();
        if (resp?.ok) {
          const body = await resp.json();
          const records = Array.isArray(body) ? body : body?.records || [];
          let storageModified = false;
          for (const assignment of missingDeadlines) {
            const resolved = resolveDeadline(assignment, { supabaseRecords: records });
            if (resolved.deadlineIso) {
              assignment.dueDate = resolved.deadlineIso;
              assignment.deadlineIso = resolved.deadlineIso;
              assignment.dueDateText = resolved.deadlineRaw;
              assignment.deadlineRaw = resolved.deadlineRaw;
              assignment.deadlineSource = DeadlineSource.SUPABASE;
              assignment.deadlineVerifiedAt = resolved.verifiedAt;

              if (gradesData?.[assignment.termId]?.[assignment.courseCode]?.[assignment.externalAssignmentId]) {
                const target = gradesData[assignment.termId][assignment.courseCode][assignment.externalAssignmentId];
                target.dueDate = resolved.deadlineIso;
                target.dueDateText = resolved.deadlineRaw;
                target.deadlineSource = DeadlineSource.SUPABASE;
                target.deadlineVerifiedAt = resolved.verifiedAt;
                storageModified = true;
              }
            }
          }
          if (storageModified && !gradesStore?.saveCourseGrades) {
            await writeSchedulerStorageKey(SCHEDULER_GRADES_STORAGE_KEY, gradesData);
          }
        }
      } catch {}
    }

    return Array.from(assignmentsMap.values());
  }
  // 3. Primary Canonical Path: Query AcademicEventRepository (public.academic_events)
  if (allowSupabaseFallback) {
    try {
      const repo = new AcademicEventRepository({ fetchFn });
      const res = await repo.getUpcomingDeadlines();
      if (res.events && res.events.length > 0) {
        return res.events.map((ev) => ({
          termId: ev.termId,
          courseCode: ev.courseCode || "",
          externalAssignmentId: ev.id,
          canonicalAssessmentId: ev.identity,
          title: ev.title,
          module: ev.subType || ev.eventType || "",
          dueDate: ev.deadlineIso,
          deadlineIso: ev.deadlineIso,
          dueDateText: ev.timeStr || null,
          deadlineRaw: ev.timeStr || null,
          deadlineSource: "SUPABASE",
          deadlineVerifiedAt: ev.fetchedAt || new Date().toISOString(),
          submissionStatus: ev.submissionStatus || SubmissionStatus.UNKNOWN,
          yourScore: null,
          evaluationStatus: "",
          source: "SUPABASE",
          isHardCutoff: ev.isHardCutoff,
          cutoffType: ev.cutoffType,
          importance: ev.importance,
        }));
      }
    } catch {}
  }

  return [];
}


/**
 * Reconciles Chrome Alarms with tracked deadlines.
 * Idempotent: safe to run on startup, data capture, or preference change.
 *
 * @param {object} [options]
 * @param {object} [options.gradesStore]
 * @param {object} [options.deadlinesStore]
 * @param {number|Date} [options.now]
 * @returns {Promise<{ created: number, cleared: number, totalActive: number }>}
 */
export async function reconcileDeadlineAlarms({
  gradesStore = null,
  deadlinesStore = null,
  repository = null,
  fetchFn = null,
  allowSupabaseFallback = true,
  now = Date.now(),
} = {}) {
  const currentMs = typeof now === "function" ? now() : Number(now || Date.now());
  const preferences = await getNotificationSettings();

  const allAlarms = await getAllAlarms();
  const existingAcxAlarms = allAlarms.filter((a) => a.name?.startsWith(ALARM_PREFIX));
  const existingMap = new Map(existingAcxAlarms.map((a) => [a.name, a]));

  let clearedCount = 0;
  let createdCount = 0;

  // If notifications are disabled entirely, wipe all active Acadrix alarms
  if (!preferences.enabled) {
    for (const [alarmName] of existingMap) {
      await clearAlarm(alarmName);
      clearedCount++;
    }
    return { created: 0, cleared: clearedCount, totalActive: 0 };
  }

  const assignments = await getAllTrackedAssignments({
    gradesStore,
    deadlinesStore,
    repository,
    fetchFn,
    allowSupabaseFallback,
  });
  const sentMap = await getSentNotifications();
  const desiredAlarmNames = new Set();

  for (const assignment of assignments) {
    const { termId, courseCode, externalAssignmentId, submissionStatus } = assignment;
    const deadlineIso = assignment.dueDate || assignment.deadlineIso;

    // Invariant: If submitted or completed, or no deadline, clear all existing alarms for this assignment
    const isFinished =
      submissionStatus === SubmissionStatus.SUBMITTED ||
      submissionStatus === SubmissionStatus.COMPLETED;

    if (isFinished || !deadlineIso) {
      for (const [alarmName] of existingMap) {
        const parsed = parseAlarmName(alarmName);
        if (
          parsed &&
          parsed.termId === termId &&
          parsed.courseCode === courseCode &&
          parsed.externalAssignmentId === externalAssignmentId
        ) {
          await clearAlarm(alarmName);
          existingMap.delete(alarmName);
          clearedCount++;
        }
      }
      continue;
    }

    // Compute future alarm trigger times
    const triggerTimes = calculateAlarmTriggerTimes({ deadlineIso, now: currentMs });

    for (const { category, triggerTime } of triggerTimes) {
      // Check category preferences
      if (category === NotificationCategory.WINDOW_3_DAYS && !preferences.notify3Days) continue;
      if (category === NotificationCategory.WINDOW_24_HOURS && !preferences.notify24Hours) continue;
      if (category === NotificationCategory.WINDOW_6_HOURS && !preferences.notify6Hours) continue;
      if (category === NotificationCategory.WINDOW_OVERDUE && !preferences.notifyOverdue) continue;

      // Check deduplication
      const dedupeKey = createNotificationDedupeKey({
        termId,
        courseCode,
        externalAssignmentId,
        category,
        deadlineVersion: deadlineIso,
      });

      if (sentMap[dedupeKey]) {
        // Already sent, do not schedule
        continue;
      }

      const alarmName = formatAlarmName({ termId, courseCode, externalAssignmentId, category });
      desiredAlarmNames.add(alarmName);

      const existingAlarm = existingMap.get(alarmName);
      if (!existingAlarm) {
        await createAlarm(alarmName, { when: triggerTime });
        createdCount++;
      } else {
        const currentAlarmTime = existingAlarm.when !== undefined ? existingAlarm.when : existingAlarm.scheduledTime;
        if (currentAlarmTime !== undefined && Math.abs(currentAlarmTime - triggerTime) > 1000) {
          // Deadline changed: replace old alarm with new trigger time
          await clearAlarm(alarmName);
          await createAlarm(alarmName, { when: triggerTime });
          createdCount++;
        }
      }
    }
  }
  // Clear obsolete alarms that are no longer in desired set
  for (const [alarmName] of existingMap) {
    if (!desiredAlarmNames.has(alarmName)) {
      await clearAlarm(alarmName);
      clearedCount++;
    }
  }

  return {
    created: createdCount,
    cleared: clearedCount,
    totalActive: desiredAlarmNames.size,
  };
}

/**
 * Dispatches a notification when an alarm fires.
 * Evaluates fresh state immediately before notifying.
 *
 * @param {string} alarmName
 * @param {object} [options]
 * @param {number|Date} [options.now]
 * @returns {Promise<{ dispatched: boolean, reason?: string, notificationId?: string, dedupeKey?: string }>}
 */
export async function dispatchAlarmNotification(alarmName, { now = Date.now(), fetchFn = null } = {}) {
  const parsed = parseAlarmName(alarmName);
  if (!parsed) {
    return { dispatched: false, reason: "INVALID_ALARM_NAME" };
  }

  const { termId, courseCode, externalAssignmentId, category } = parsed;
  const currentMs = typeof now === "function" ? now() : Number(now || Date.now());

  // 1. Freshness & Re-evaluation Invariant:
  // Re-read latest assignment state from storage
  const assignments = await getAllTrackedAssignments({ fetchFn, allowSupabaseFallback: false });
  const assignment = assignments.find(
    (a) =>
      a.termId === termId &&
      a.courseCode === courseCode &&
      a.externalAssignmentId === externalAssignmentId
  );

  if (!assignment) {
    // Assignment removed or unknown
    await clearAlarm(alarmName);
    return { dispatched: false, reason: "ASSIGNMENT_NOT_FOUND" };
  }

  // Check if submitted between alarm creation and alarm firing
  if (
    assignment.submissionStatus === SubmissionStatus.SUBMITTED ||
    assignment.submissionStatus === SubmissionStatus.COMPLETED
  ) {
    await clearAlarm(alarmName);
    return { dispatched: false, reason: "ALREADY_SUBMITTED" };
  }

  // 2. Check current settings
  const preferences = await getNotificationSettings();
  if (!preferences.enabled) {
    return { dispatched: false, reason: "NOTIFICATIONS_DISABLED" };
  }

  // 3. Evaluate actionability & deduplication
  const sentMap = await getSentNotifications();
  const notif = determineActionableNotification({
    assignment,
    sentNotificationsMap: sentMap,
    preferences,
    now: currentMs,
  });

  if (!notif) {
    await clearAlarm(alarmName);
    return { dispatched: false, reason: "NOT_ACTIONABLE_OR_DEDUPED" };
  }

  // 4. Dispatch notification
  const notificationId = `acx:notif:${termId}:${courseCode}:${externalAssignmentId}:${category}`;
  const isUrgent =
    category === NotificationCategory.WINDOW_6_HOURS ||
    category === NotificationCategory.WINDOW_OVERDUE;

  await createChromeNotification(notificationId, {
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title: notif.title,
    message: notif.body,
    priority: isUrgent ? 2 : 1,
    requireInteraction: isUrgent,
  });

  // 5. Record sent deduplication record
  await recordNotificationSent(notif, currentMs);

  return {
    dispatched: true,
    notificationId,
    dedupeKey: notif.dedupeKey,
  };
}
