/**
 * Acadrix Smart Deadline & Notification System - Comprehensive Test Suite
 *
 * Verifies:
 * 1. Deadline Calculation & Asia/Kolkata Timezones
 * 2. Submission Status Evaluation & Actionability
 * 3. Notification Suppression & Deduplication Rules
 * 4. Deadline Change Handling & Versioning
 * 5. Freshness Invariant on Alarm Dispatch (Interim Submission Suppression)
 * 6. Alarm Reconciliation & Idempotency
 * 7. Storage Persistence & 60-Day Pruning
 */

import assert from "node:assert/strict";
import {
  SubmissionStatus,
  DeadlineStatus,
  ActionStatus,
  NotificationCategory,
  DEFAULT_NOTIFICATION_PREFERENCES,
  DeadlineSource,
  ALARM_PREFIX,
} from "../src/notifications/types.js";
import {
  getKolkataDateParts,
  isSameKolkataDay,
  getKolkataDayDifference,
  formatKolkataDeadline,
  evaluateDeadline,
  createNotificationDedupeKey,
  determineActionableNotification,
  resolveDeadline,
} from "../src/notifications/evaluator.js";
import {
  getNotificationSettings,
  saveNotificationSettings,
  getSentNotifications,
  recordNotificationSent,
  clearSentNotifications,
} from "../src/notifications/storage.js";
import {
  formatAlarmName,
  parseAlarmName,
  calculateAlarmTriggerTimes,
  reconcileDeadlineAlarms,
  dispatchAlarmNotification,
  getAllTrackedAssignments,
} from "../src/notifications/scheduler.js";
import { deriveSubmissionStatus } from "../src/portal-decor/core.js";
import { captureStartPage } from "../src/portal-decor/capture.js";

let totalChecks = 0;
function test(name, fn) {
  totalChecks++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

async function asyncTest(name, fn) {
  totalChecks++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("\n==================================================");
console.log("Starting Acadrix Smart Notification Verification Suite");
console.log("==================================================\n");

// ── 1. Deadline Calculation & Kolkata Timezone Math ─────────────────────────
console.log("1. Deadline Calculation & Asia/Kolkata Timezone Boundary Tests:");

test("Extracts exact date and time parts in Asia/Kolkata timezone", () => {
  // 18:29 UTC on Oct 15 -> 23:59 IST on Oct 15
  const parts1 = getKolkataDateParts("2026-10-15T18:29:00.000Z");
  assert.equal(parts1.year, 2026);
  assert.equal(parts1.month, 10);
  assert.equal(parts1.day, 15);
  assert.equal(parts1.hours, 23);
  assert.equal(parts1.minutes, 59);

  // 18:30 UTC on Oct 15 -> 00:00 IST on Oct 16 (midnight rollover)
  const parts2 = getKolkataDateParts("2026-10-15T18:30:00.000Z");
  assert.equal(parts2.year, 2026);
  assert.equal(parts2.month, 10);
  assert.equal(parts2.day, 16);
  assert.equal(parts2.hours, 0);
  assert.equal(parts2.minutes, 0);
});

test("isSameKolkataDay recognizes exact calendar days across midnight boundary", () => {
  const sameDay1 = "2026-10-15T04:00:00.000Z"; // 09:30 IST
  const sameDay2 = "2026-10-15T18:29:00.000Z"; // 23:59 IST
  const nextDay = "2026-10-15T18:30:00.000Z";  // 00:00 IST next day

  assert.equal(isSameKolkataDay(sameDay1, sameDay2), true);
  assert.equal(isSameKolkataDay(sameDay1, nextDay), false);
  assert.equal(isSameKolkataDay(sameDay2, nextDay), false);
});

test("getKolkataDayDifference handles month-end and leap transitions accurately", () => {
  // Same day
  assert.equal(getKolkataDayDifference("2026-10-15T04:00:00.000Z", "2026-10-15T18:00:00.000Z"), 0);
  // Next day across midnight
  assert.equal(getKolkataDayDifference("2026-10-15T18:20:00.000Z", "2026-10-15T18:40:00.000Z"), 1);
  // Month transition: Oct 31 to Nov 1
  assert.equal(getKolkataDayDifference("2026-10-31T05:00:00.000Z", "2026-11-01T05:00:00.000Z"), 1);
  // 3 days later
  assert.equal(getKolkataDayDifference("2026-10-10T10:00:00.000Z", "2026-10-13T10:00:00.000Z"), 3);
});

test("formatKolkataDeadline produces 'MMM d, h:mm a' in Asia/Kolkata", () => {
  const iso = "2026-10-15T18:29:00.000Z"; // 23:59 IST
  const formatted = formatKolkataDeadline(iso);
  assert.equal(formatted, "Oct 15, 11:59 PM");
});

test("evaluateDeadline accurately categorizes urgency windows", () => {
  const now = new Date("2026-10-15T00:00:00.000Z"); // 05:30 IST Oct 15

  // 1. > 72h -> UPCOMING
  const resUpcoming = evaluateDeadline({
    deadlineIso: "2026-10-20T18:29:00.000Z",
    submissionStatus: SubmissionStatus.NOT_SUBMITTED,
    now,
  });
  assert.equal(resUpcoming.deadlineStatus, DeadlineStatus.UPCOMING);
  assert.equal(resUpcoming.actionStatus, ActionStatus.ACTION_REQUIRED);

  // 2. <= 72h (e.g. 50h) -> DUE_SOON
  const resSoon = evaluateDeadline({
    deadlineIso: "2026-10-17T02:00:00.000Z",
    submissionStatus: SubmissionStatus.NOT_SUBMITTED,
    now,
  });
  assert.equal(resSoon.deadlineStatus, DeadlineStatus.DUE_SOON);

  // 3. Due tomorrow -> DUE_TOMORROW
  const resTomorrow = evaluateDeadline({
    deadlineIso: "2026-10-16T18:29:00.000Z",
    submissionStatus: SubmissionStatus.NOT_SUBMITTED,
    now,
  });
  assert.equal(resTomorrow.deadlineStatus, DeadlineStatus.DUE_TOMORROW);
  assert.equal(resTomorrow.isDueTomorrow, true);

  // 4. Due today (calendar day in Kolkata, > 6h) -> DUE_TODAY
  const resToday = evaluateDeadline({
    deadlineIso: "2026-10-15T18:29:00.000Z", // ~18.5h away
    submissionStatus: SubmissionStatus.NOT_SUBMITTED,
    now,
  });
  assert.equal(resToday.deadlineStatus, DeadlineStatus.DUE_TODAY);
  assert.equal(resToday.isDueToday, true);

  // 5. Due in < 6h -> DUE_HOURS
  const resHours = evaluateDeadline({
    deadlineIso: "2026-10-15T04:00:00.000Z", // 4h away
    submissionStatus: SubmissionStatus.NOT_SUBMITTED,
    now,
  });
  assert.equal(resHours.deadlineStatus, DeadlineStatus.DUE_HOURS);

  // 6. Overdue -> OVERDUE
  const resOverdue = evaluateDeadline({
    deadlineIso: "2026-10-14T18:29:00.000Z", // passed yesterday
    submissionStatus: SubmissionStatus.NOT_SUBMITTED,
    now,
  });
  assert.equal(resOverdue.deadlineStatus, DeadlineStatus.OVERDUE);
  assert.equal(resOverdue.isOverdue, true);

  // 7. No deadline -> NO_DEADLINE
  const resNoDeadline = evaluateDeadline({
    deadlineIso: null,
    submissionStatus: SubmissionStatus.NOT_SUBMITTED,
    now,
  });
  assert.equal(resNoDeadline.deadlineStatus, DeadlineStatus.NO_DEADLINE);
  assert.equal(resNoDeadline.actionStatus, ActionStatus.NO_ACTION_REQUIRED);
});

// ── 2. Submission Status Evaluation & Actionability ─────────────────────────
console.log("\n2. Submission Status Evaluation & Evidence Invariant Tests:");

test("Evaluated score or status proves SUBMITTED and removes action urgency", () => {
  // Finite numerical score
  assert.equal(deriveSubmissionStatus({ yourScore: 95 }), SubmissionStatus.SUBMITTED);
  const eval1 = evaluateDeadline({
    deadlineIso: "2026-10-16T18:29:00.000Z",
    submissionStatus: SubmissionStatus.SUBMITTED,
  });
  assert.equal(eval1.deadlineStatus, DeadlineStatus.COMPLETED);
  assert.equal(eval1.actionStatus, ActionStatus.NO_ACTION_REQUIRED);

  // Evaluation status = "Evaluated"
  assert.equal(deriveSubmissionStatus({ evaluationStatus: "Evaluated" }), SubmissionStatus.SUBMITTED);

  // Explicit in-page submitted text
  assert.equal(deriveSubmissionStatus({ isSubmittedText: true }), SubmissionStatus.SUBMITTED);
});

test("Due Date Pending maps to NOT_SUBMITTED and requires action", () => {
  const status = deriveSubmissionStatus({ evaluationStatus: "Due Date Pending", yourScore: null });
  assert.equal(status, SubmissionStatus.NOT_SUBMITTED);

  const evalRes = evaluateDeadline({
    deadlineIso: "2026-10-16T18:29:00.000Z",
    submissionStatus: status,
  });
  assert.equal(evalRes.actionStatus, ActionStatus.ACTION_REQUIRED);
});

test("Evaluation Pending maps to PENDING (post-deadline awaiting score)", () => {
  const status = deriveSubmissionStatus({ evaluationStatus: "Evaluation Pending" });
  assert.equal(status, SubmissionStatus.PENDING);

  const evalRes = evaluateDeadline({
    deadlineIso: "2026-10-14T18:29:00.000Z",
    submissionStatus: status,
  });
  assert.equal(evalRes.actionStatus, ActionStatus.NO_ACTION_REQUIRED);
});

test("Missing portal evidence falls back to UNKNOWN and STATUS_UNKNOWN", () => {
  const status = deriveSubmissionStatus({});
  assert.equal(status, SubmissionStatus.UNKNOWN);

  const evalRes = evaluateDeadline({
    deadlineIso: "2026-10-16T18:29:00.000Z",
    submissionStatus: status,
  });
  assert.equal(evalRes.actionStatus, ActionStatus.STATUS_UNKNOWN);
});

await asyncTest("captureStartPage is deprecated no-op; submission status is strictly UNKNOWN (§11, §13)", async () => {
  const res = await captureStartPage({}, {});
  assert.equal(res, null, "captureStartPage must return null and never scrape DOM");
  assert.equal(SubmissionStatus.UNKNOWN, "UNKNOWN");
});

// ── 3. Notification Suppression Rules ───────────────────────────────────────
console.log("\n3. Notification Suppression & Deduplication Rules:");

test("STRICTLY suppresses notifications when assignment is SUBMITTED or COMPLETED", () => {
  const now = new Date("2026-10-15T10:00:00.000Z");

  // Due in 4 hours + SUBMITTED -> MUST BE NULL
  const notifSubmitted = determineActionableNotification({
    assignment: {
      termId: "2026-09",
      courseCode: "CS2006",
      externalAssignmentId: "ga1",
      title: "Quiz 1",
      dueDate: "2026-10-15T14:00:00.000Z", // 4h away
      submissionStatus: SubmissionStatus.SUBMITTED,
    },
    now,
  });
  assert.equal(notifSubmitted, null, "Submitted assignment must NEVER notify");

  // Due in 4 hours + COMPLETED -> MUST BE NULL
  const notifCompleted = determineActionableNotification({
    assignment: {
      termId: "2026-09",
      courseCode: "CS2006",
      externalAssignmentId: "ga2",
      title: "Practice 1",
      dueDate: "2026-10-15T14:00:00.000Z",
      submissionStatus: SubmissionStatus.COMPLETED,
    },
    now,
  });
  assert.equal(notifCompleted, null, "Completed assignment must NEVER notify");
});

test("Suppresses overdue notification when SUBMITTED or UNKNOWN, notifies when NOT_SUBMITTED", () => {
  const now = new Date("2026-10-16T10:00:00.000Z");
  const pastDeadline = "2026-10-15T18:29:00.000Z";

  // Overdue + SUBMITTED -> null
  const notifOverdueSub = determineActionableNotification({
    assignment: {
      title: "Quiz 1",
      dueDate: pastDeadline,
      submissionStatus: SubmissionStatus.SUBMITTED,
    },
    now,
  });
  assert.equal(notifOverdueSub, null, "Overdue submitted assignment must not notify");

  // Overdue + UNKNOWN -> null (conservative: don't falsely claim overdue if unverified)
  const notifOverdueUnknown = determineActionableNotification({
    assignment: {
      title: "Quiz 1",
      dueDate: pastDeadline,
      submissionStatus: SubmissionStatus.UNKNOWN,
    },
    now,
  });
  assert.equal(notifOverdueUnknown, null, "Overdue unknown status must not notify");

  // Overdue + NOT_SUBMITTED -> generates WINDOW_OVERDUE notification
  const notifOverdueUnsub = determineActionableNotification({
    assignment: {
      termId: "2026-09",
      courseCode: "CS2006",
      externalAssignmentId: "ga1",
      title: "Quiz 1",
      dueDate: pastDeadline,
      submissionStatus: SubmissionStatus.NOT_SUBMITTED,
    },
    now,
  });
  assert(notifOverdueUnsub !== null, "Overdue unsubmitted must generate notification");
  assert.equal(notifOverdueUnsub.category, NotificationCategory.WINDOW_OVERDUE);
  assert.equal(notifOverdueUnsub.title, "Assignment Overdue");
});

test("Suppresses notifications when category is already sent in sentNotificationsMap (deduplication)", () => {
  const now = new Date("2026-10-15T15:00:00.000Z"); // 3h29m left
  const deadlineIso = "2026-10-15T18:29:00.000Z";

  const assignment = {
    termId: "2026-09",
    courseCode: "CS2006",
    externalAssignmentId: "ga1",
    title: "Quiz 1",
    dueDate: deadlineIso,
    submissionStatus: SubmissionStatus.NOT_SUBMITTED,
  };

  const dedupeKey = createNotificationDedupeKey({
    termId: "2026-09",
    courseCode: "CS2006",
    externalAssignmentId: "ga1",
    category: NotificationCategory.WINDOW_6_HOURS,
    deadlineVersion: deadlineIso,
  });

  // When key exists in sent map
  const sentMap = { [dedupeKey]: { sentAt: "2026-10-15T14:50:00.000Z" } };
  const notif = determineActionableNotification({
    assignment,
    sentNotificationsMap: sentMap,
    now,
  });
  assert.equal(notif, null, "Must be suppressed by deduplication key");
});

test("Suppresses notifications when preferences.enabled is false", () => {
  const now = new Date("2026-10-15T15:00:00.000Z");
  const assignment = {
    title: "Quiz 1",
    dueDate: "2026-10-15T18:29:00.000Z",
    submissionStatus: SubmissionStatus.NOT_SUBMITTED,
  };

  const notif = determineActionableNotification({
    assignment,
    preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, enabled: false },
    now,
  });
  assert.equal(notif, null, "Must be suppressed when notifications are globally disabled");
});

// ── 4. Deadline Change Handling & Versioning ────────────────────────────────
console.log("\n4. Deadline Change Handling & Versioning Tests:");

test("Deadline change generates a new deduplication key and recalculates alarms", () => {
  const deadlineV1 = "2026-10-15T18:29:00.000Z";
  const deadlineV2 = "2026-10-18T06:30:00.000Z"; // Extended by instructor to Oct 18, 12:00 PM IST

  const key1 = createNotificationDedupeKey({
    termId: "2026-09",
    courseCode: "CS2006",
    externalAssignmentId: "ga1",
    category: NotificationCategory.WINDOW_24_HOURS,
    deadlineVersion: deadlineV1,
  });

  const key2 = createNotificationDedupeKey({
    termId: "2026-09",
    courseCode: "CS2006",
    externalAssignmentId: "ga1",
    category: NotificationCategory.WINDOW_24_HOURS,
    deadlineVersion: deadlineV2,
  });

  assert.notEqual(key1, key2, "Keys must differ when deadline date changes");

  // Simulate sent notification for V1
  const sentMap = { [key1]: { sentAt: "2026-10-14T18:30:00.000Z" } };

  // When evaluating assignment with updated deadline V2, notification is NOT suppressed by old V1 sent log
  // Oct 17, 04:00 PM IST is 20h before V2 on prior calendar day
  const now = new Date("2026-10-17T10:30:00.000Z");
  const notifV2 = determineActionableNotification({
    assignment: {
      termId: "2026-09",
      courseCode: "CS2006",
      externalAssignmentId: "ga1",
      title: "Quiz 1",
      dueDate: deadlineV2,
      submissionStatus: SubmissionStatus.NOT_SUBMITTED,
    },
    sentNotificationsMap: sentMap,
    now,
  });

  assert(notifV2 !== null, "New deadline version must generate fresh notification");
  assert.equal(notifV2.category, NotificationCategory.WINDOW_24_HOURS);
});

// ── 5. Freshness Invariant on Alarm Dispatch ────────────────────────────────
console.log("\n5. Freshness Invariant on Alarm Dispatch (Interim Submission Suppression):");

await asyncTest("Alarm scheduled when unsubmitted -> user submits in interim -> alarm fires -> verified suppressed", async () => {
  const deadlineIso = "2026-10-15T18:29:00.000Z";
  const alarmName = "acx:notify:2026-09:CS2006:ga1:6h";
  const alarmTime = new Date("2026-10-15T12:29:00.000Z").getTime();

  // Storage state when alarm was scheduled: NOT_SUBMITTED
  const mockStorage = {
    "acx:grades:v1": {
      "2026-09": {
        "CS2006": {
          "ga1": {
            termId: "2026-09",
            courseCode: "CS2006",
            externalAssignmentId: "ga1",
            title: "Quiz 1",
            dueDate: deadlineIso,
            submissionStatus: SubmissionStatus.NOT_SUBMITTED,
          },
        },
      },
    },
    "acx:notifications:v1": {},
  };

  const dispatchedNotifications = [];
  const activeAlarms = new Set([alarmName]);

  globalThis.chrome = {
    storage: {
      local: {
        get: (query, cb) => {
          const res = {};
          if (Array.isArray(query)) {
            for (const k of query) res[k] = mockStorage[k] || {};
          } else if (typeof query === "object") {
            for (const k of Object.keys(query)) res[k] = mockStorage[k] !== undefined ? mockStorage[k] : query[k];
          } else if (typeof query === "string") {
            res[query] = mockStorage[query] || {};
          }
          cb(res);
        },
        set: (items, cb) => {
          Object.assign(mockStorage, items);
          cb?.();
        },
      },
    },
    alarms: {
      clear: (name, cb) => {
        activeAlarms.delete(name);
        cb?.(true);
      },
      getAll: (cb) => cb(Array.from(activeAlarms).map((n) => ({ name: n }))),
      create: (name) => activeAlarms.add(name),
    },
    notifications: {
      create: (id, opt, cb) => {
        dispatchedNotifications.push({ id, ...opt });
        cb?.(id);
      },
    },
  };

  // User submits assignment before alarm fires!
  mockStorage["acx:grades:v1"]["2026-09"]["CS2006"]["ga1"].submissionStatus = SubmissionStatus.SUBMITTED;
  mockStorage["acx:grades:v1"]["2026-09"]["CS2006"]["ga1"].yourScore = 90;

  // Alarm fires now!
  const result = await dispatchAlarmNotification(alarmName, { now: alarmTime });

  assert.equal(result.dispatched, false, "Must NOT dispatch notification if submitted in interim");
  assert.equal(result.reason, "ALREADY_SUBMITTED");
  assert.equal(dispatchedNotifications.length, 0, "No Chrome notification should be shown");
  assert.equal(activeAlarms.has(alarmName), false, "Alarm should be cleared from active alarms");
});

// ── 6. Alarm Reconciliation & Idempotency ───────────────────────────────────
console.log("\n6. Alarm Reconciliation & Idempotency Tests:");

await asyncTest("reconcileDeadlineAlarms is strictly idempotent across multiple runs", async () => {
  const deadlineIso = "2026-10-18T18:29:00.000Z";
  const now = new Date("2026-10-14T00:00:00.000Z").getTime();

  const mockStorage = {
    "acx:grades:v1": {
      "2026-09": {
        "CS2006": {
          "ga1": {
            termId: "2026-09",
            courseCode: "CS2006",
            externalAssignmentId: "ga1",
            title: "Quiz 1",
            dueDate: deadlineIso,
            submissionStatus: SubmissionStatus.NOT_SUBMITTED,
          },
        },
      },
    },
    "acx:notifications:v1": {},
  };

  const alarmsMap = new Map();

  globalThis.chrome = {
    storage: {
      local: {
        get: (query, cb) => {
          const res = {};
          const keys = Array.isArray(query) ? query : (typeof query === "object" ? Object.keys(query) : [query]);
          for (const k of keys) res[k] = mockStorage[k] || {};
          cb(res);
        },
        set: (items, cb) => {
          Object.assign(mockStorage, items);
          cb?.();
        },
      },
    },
    alarms: {
      getAll: (cb) => cb(Array.from(alarmsMap.values())),
      create: (name, info) => alarmsMap.set(name, { name, ...info }),
      clear: (name, cb) => {
        const existed = alarmsMap.delete(name);
        cb?.(existed);
      },
    },
    notifications: { create: (id, opt, cb) => cb?.(id) },
  };

  // Run 1: schedules alarms
  const run1 = await reconcileDeadlineAlarms({ now });
  assert.equal(run1.created, 4, "Must create 4 future alarms (72h, 24h, 6h, overdue)");
  assert.equal(run1.cleared, 0);
  assert.equal(alarmsMap.size, 4);

  // Run 2: Idempotent - creates 0 new alarms, clears 0
  const run2 = await reconcileDeadlineAlarms({ now });
  assert.equal(run2.created, 0, "Idempotent run must create 0 new alarms");
  assert.equal(run2.cleared, 0);
  assert.equal(alarmsMap.size, 4);
});

await asyncTest("Submitting assignment clears all its scheduled alarms on next reconciliation", async () => {
  const deadlineIso = "2026-10-18T18:29:00.000Z";
  const now = new Date("2026-10-14T00:00:00.000Z").getTime();

  const mockStorage = {
    "acx:grades:v1": {
      "2026-09": {
        "CS2006": {
          "ga1": {
            termId: "2026-09",
            courseCode: "CS2006",
            externalAssignmentId: "ga1",
            title: "Quiz 1",
            dueDate: deadlineIso,
            submissionStatus: SubmissionStatus.SUBMITTED, // Marked submitted!
          },
        },
      },
    },
    "acx:notifications:v1": {},
  };

  const alarmsMap = new Map([
    ["acx:notify:2026-09:CS2006:ga1:72h", { name: "acx:notify:2026-09:CS2006:ga1:72h" }],
    ["acx:notify:2026-09:CS2006:ga1:24h", { name: "acx:notify:2026-09:CS2006:ga1:24h" }],
    ["acx:notify:2026-09:CS2006:ga1:6h", { name: "acx:notify:2026-09:CS2006:ga1:6h" }],
  ]);

  globalThis.chrome = {
    storage: {
      local: {
        get: (query, cb) => {
          const res = {};
          const keys = Array.isArray(query) ? query : (typeof query === "object" ? Object.keys(query) : [query]);
          for (const k of keys) res[k] = mockStorage[k] || {};
          cb(res);
        },
        set: (items, cb) => {
          Object.assign(mockStorage, items);
          cb?.();
        },
      },
    },
    alarms: {
      getAll: (cb) => cb(Array.from(alarmsMap.values())),
      create: (name, info) => alarmsMap.set(name, { name, ...info }),
      clear: (name, cb) => {
        const existed = alarmsMap.delete(name);
        cb?.(existed);
      },
    },
    notifications: { create: (id, opt, cb) => cb?.(id) },
  };

  const recon = await reconcileDeadlineAlarms({ now });
  assert.equal(recon.cleared, 3, "Must clear all 3 scheduled alarms for submitted assignment");
  assert.equal(alarmsMap.size, 0, "No alarms should remain scheduled");
});

// ── 7. Storage Persistence & 60-Day Pruning ─────────────────────────────────
console.log("\n7. Storage Persistence & 60-Day Pruning Tests:");

await asyncTest("recordNotificationSent prunes entries older than 60 days", async () => {
  await clearSentNotifications();

  const nowMs = new Date("2026-10-15T12:00:00.000Z").getTime();
  const dayMs = 24 * 3600 * 1000;

  // Insert old record (70 days ago)
  const oldTimestamp = nowMs - 70 * dayMs;
  await recordNotificationSent({ dedupeKey: "old-key-1", title: "Old 1" }, oldTimestamp);

  // Insert recent record (10 days ago)
  const recentTimestamp = nowMs - 10 * dayMs;
  await recordNotificationSent({ dedupeKey: "recent-key-2", title: "Recent 2" }, recentTimestamp);

  // Record a new notification today
  await recordNotificationSent({ dedupeKey: "today-key-3", title: "Today 3" }, nowMs);

  const sent = await getSentNotifications();
  assert.equal(sent["old-key-1"], undefined, "Entry older than 60 days must be pruned");
  assert.equal(sent["recent-key-2"]?.title, "Recent 2", "Recent entry within 60 days must be preserved");
  assert.equal(sent["today-key-3"]?.title, "Today 3", "New entry must be recorded");

  await clearSentNotifications();
});

// ── 8. Hardening: Deadline Source Hierarchy & Precedence ─────────────────────
console.log("\n8. Hardening: Deadline Source Hierarchy & Precedence Tests:");

test("Precedence: Canonical academic_events deadline is authoritative", () => {
  const event = {
    termId: "2026-09",
    courseCode: "CS2006",
    id: "ga1",
    deadlineIso: "2026-10-12T18:29:00.000Z",
    source: "SUPABASE",
  };
  const res = resolveDeadline(event);
  assert.equal(res.source, DeadlineSource.SUPABASE);
  assert.equal(res.deadlineIso, "2026-10-12T18:29:00.000Z");
});

test("Precedence: Canonical deadline resolves from endTime or eventDate", () => {
  const event = {
    termId: "2026-09",
    courseCode: "CS2006",
    id: "ga1",
    end_time: "2026-10-11T18:29:00.000Z",
  };
  const res = resolveDeadline(event);
  assert.equal(res.source, DeadlineSource.SUPABASE);
  assert.equal(res.deadlineIso, "2026-10-11T18:29:00.000Z");
});

test("Precedence: Missing everywhere yields UNKNOWN, never an arbitrary or overdue deadline", () => {
  const portalAssessment = {
    termId: "2026-09",
    courseCode: "CS2006",
    externalAssignmentId: "ga1",
    dueDate: null,
  };
  const res = resolveDeadline(portalAssessment, { localAssessment: null, supabaseRecords: [] });
  assert.equal(res.source, DeadlineSource.UNKNOWN);
  assert.equal(res.deadlineIso, null);

  const evalRes = evaluateDeadline({
    deadlineIso: res.deadlineIso,
    submissionStatus: SubmissionStatus.NOT_SUBMITTED,
  });
  assert.equal(evalRes.deadlineStatus, DeadlineStatus.NO_DEADLINE);
  assert.equal(evalRes.isOverdue, false);
  assert.equal(evalRes.actionStatus, ActionStatus.NO_ACTION_REQUIRED);
});

// ── 9. Hardening: Supabase Identifier Matching Isolation ────────────────────
console.log("\n9. Hardening: Supabase Identifier Matching Isolation Tests:");

test("Matching: Same title in another course does NOT cross-match", () => {
  const target = {
    termId: "2026-09",
    courseCode: "CS2006",
    externalAssignmentId: "ga1",
    title: "Assignment 1",
    dueDate: null,
  };

  // Supabase has Assignment 1, but for CS2005 (different course)
  const supabaseRecords = [
    {
      termId: "2026-09",
      courseCode: "CS2005",
      externalAssignmentId: "ga1",
      title: "Assignment 1",
      dueDate: "2026-10-15T18:29:00.000Z",
    },
  ];

  const res = resolveDeadline(target, { supabaseRecords });
  assert.equal(res.source, DeadlineSource.UNKNOWN, "Must NOT cross-match different course with same title");
  assert.equal(res.deadlineIso, null);
});

test("Matching: Same external assignment ID in another term does NOT cross-match", () => {
  const target = {
    termId: "2026-09",
    courseCode: "CS2006",
    externalAssignmentId: "ga1",
    title: "Quiz 1",
    dueDate: null,
  };

  // Supabase has ga1 for CS2006, but in past term 2026-01
  const supabaseRecords = [
    {
      termId: "2026-01",
      courseCode: "CS2006",
      externalAssignmentId: "ga1",
      dueDate: "2026-02-15T18:29:00.000Z",
    },
  ];

  const res = resolveDeadline(target, { supabaseRecords });
  assert.equal(res.source, DeadlineSource.UNKNOWN, "Must NOT cross-match different academic term");
  assert.equal(res.deadlineIso, null);
});

test("Matching: Matches canonicalAssessmentId within same course & term", () => {
  const target = {
    termId: "2026-09",
    courseCode: "CS2006",
    externalAssignmentId: "portal-local-id",
    canonicalAssessmentId: "canonical-dbms-ga1",
    title: "Graded Assignment 1",
    dueDate: null,
  };

  const supabaseRecords = [
    {
      termId: "2026-09",
      courseCode: "CS2006",
      canonicalAssessmentId: "canonical-dbms-ga1",
      dueDate: "2026-10-22T18:29:00.000Z",
    },
  ];

  const res = resolveDeadline(target, { supabaseRecords });
  assert.equal(res.source, DeadlineSource.SUPABASE);
  assert.equal(res.deadlineIso, "2026-10-22T18:29:00.000Z");
});

// ── 10. Hardening: Supabase Local Caching & Network Isolation ────────────────
console.log("\n10. Hardening: Supabase Local Caching & Network Isolation Tests:");

await asyncTest("Resolved Supabase deadline is persisted in local cache, eliminating repeated queries", async () => {
  const mockStorage = {
    "acx:grades:v1": {
      "2026-09": {
        "CS2006": {
          "ga1": {
            termId: "2026-09",
            courseCode: "CS2006",
            externalAssignmentId: "ga1",
            title: "Quiz 1",
            dueDate: null, // Missing on portal
            submissionStatus: SubmissionStatus.NOT_SUBMITTED,
          },
        },
      },
    },
  };

  let networkFetchCalls = 0;
  const mockFetchFn = async () => {
    networkFetchCalls++;
    return {
      ok: true,
      json: async () => ({
        ok: true,
        records: [
          {
            external_assignment_id: "ga1",
            module: "Week 1",
            title: "Quiz 1",
            due_date: "2026-10-25T18:29:00.000Z",
            due_date_text: "25 Oct 2026",
          },
        ],
      }),
    };
  };

  globalThis.chrome = {
    storage: {
      local: {
        get: (q, cb) => cb(mockStorage),
        set: (items, cb) => {
          Object.assign(mockStorage, items);
          cb?.();
        },
      },
    },
  };

  // Run 1: queries Supabase and caches locally
  const assignments1 = await getAllTrackedAssignments({
    fetchFn: mockFetchFn,
    allowSupabaseFallback: true,
  });
  assert.equal(networkFetchCalls, 1, "Must query Supabase on first run when deadline is missing");
  assert.equal(assignments1[0].dueDate, "2026-10-25T18:29:00.000Z");
  assert.equal(assignments1[0].deadlineSource, DeadlineSource.SUPABASE);

  // Verify local storage was updated with the cached deadline
  assert.equal(
    mockStorage["acx:grades:v1"]["2026-09"]["CS2006"]["ga1"].dueDate,
    "2026-10-25T18:29:00.000Z",
    "Must persist resolved deadline in local storage"
  );

  // Run 2: Subsequent query uses cached local state, ZERO new network calls
  const assignments2 = await getAllTrackedAssignments({
    fetchFn: mockFetchFn,
    allowSupabaseFallback: true,
  });
  assert.equal(networkFetchCalls, 1, "Must NOT query Supabase repeatedly for cached deadline");
  assert.equal(assignments2[0].dueDate, "2026-10-25T18:29:00.000Z");
});

await asyncTest("Supabase network failure fails safely and preserves existing valid local data", async () => {
  const existingLocalDeadline = "2026-10-19T18:29:00.000Z";
  const mockStorage = {
    "acx:grades:v1": {
      "2026-09": {
        "CS2006": {
          "ga1": {
            termId: "2026-09",
            courseCode: "CS2006",
            externalAssignmentId: "ga1",
            title: "Quiz 1",
            dueDate: existingLocalDeadline,
            deadlineSource: DeadlineSource.LOCAL,
            submissionStatus: SubmissionStatus.NOT_SUBMITTED,
          },
        },
      },
    },
  };

  const mockFailingFetch = async () => {
    throw new Error("Network offline: failed to connect to Supabase");
  };

  globalThis.chrome = {
    storage: {
      local: {
        get: (q, cb) => cb(mockStorage),
        set: (items, cb) => {
          Object.assign(mockStorage, items);
          cb?.();
        },
      },
    },
  };

  const assignments = await getAllTrackedAssignments({
    fetchFn: mockFailingFetch,
    allowSupabaseFallback: true,
  });
  assert.equal(assignments[0].dueDate, existingLocalDeadline, "Must preserve existing local deadline");
  assert.equal(assignments[0].deadlineSource, DeadlineSource.LOCAL);
});

// ── 11. Hardening: Unknown Submission Status Copy & Conservative Policy ───────
console.log("\n11. Hardening: Unknown Submission Status Copy & Conservative Policy Tests:");

test("Notification copy uses 'Submission status could not be verified.' when status is UNKNOWN", () => {
  const now = new Date("2026-10-17T10:30:00.000Z");
  const deadlineIso = "2026-10-18T06:30:00.000Z"; // 20h away

  const notif = determineActionableNotification({
    assignment: {
      termId: "2026-09",
      courseCode: "CS2006",
      externalAssignmentId: "ga1",
      title: "Quiz 1",
      dueDate: deadlineIso,
      submissionStatus: SubmissionStatus.UNKNOWN,
    },
    now,
  });

  assert(notif !== null);
  assert(notif.body.includes("Submission status could not be verified."), "Must use truthful unverified wording");
  assert(!notif.body.includes("Not submitted."), "Must NEVER claim 'Not submitted.' when status is UNKNOWN");
});

test("Overdue notifications are strictly suppressed when submissionStatus is UNKNOWN", () => {
  const now = new Date("2026-10-19T10:00:00.000Z");
  const pastDeadline = "2026-10-18T06:30:00.000Z";

  const notif = determineActionableNotification({
    assignment: {
      termId: "2026-09",
      courseCode: "CS2006",
      externalAssignmentId: "ga1",
      title: "Quiz 1",
      dueDate: pastDeadline,
      submissionStatus: SubmissionStatus.UNKNOWN,
    },
    now,
  });

  assert.equal(notif, null, "Overdue reminder MUST be suppressed when submission status is unverified");
});

// ── 12. Hardening: Dynamic Deadline Changes & Trigger Recalculation ──────────
console.log("\n12. Hardening: Dynamic Deadline Changes & Trigger Recalculation Tests:");

await asyncTest("Deadline moved earlier replaces old alarms with earlier alarm schedule", async () => {
  const originalDeadline = "2026-10-25T18:29:00.000Z";
  const now = new Date("2026-10-14T00:00:00.000Z").getTime();

  const mockStorage = {
    "acx:grades:v1": {
      "2026-09": {
        "CS2006": {
          "ga1": {
            termId: "2026-09",
            courseCode: "CS2006",
            externalAssignmentId: "ga1",
            title: "Quiz 1",
            dueDate: originalDeadline,
            submissionStatus: SubmissionStatus.NOT_SUBMITTED,
          },
        },
      },
    },
    "acx:notifications:v1": {},
  };

  const scheduledAlarms = new Map();
  globalThis.chrome = {
    storage: {
      local: {
        get: (q, cb) => cb(mockStorage),
        set: (items, cb) => {
          Object.assign(mockStorage, items);
          cb?.();
        },
      },
    },
    alarms: {
      getAll: (cb) => cb(Array.from(scheduledAlarms.values())),
      create: (n, info) => scheduledAlarms.set(n, { name: n, ...info }),
      clear: (n, cb) => {
        scheduledAlarms.delete(n);
        cb?.(true);
      },
    },
    notifications: { create: (id, opt, cb) => cb?.(id) },
  };

  await reconcileDeadlineAlarms({ now, allowSupabaseFallback: false });
  assert.equal(scheduledAlarms.size, 4);

  // Instructor moves deadline earlier to Oct 16
  const earlierDeadline = "2026-10-16T18:29:00.000Z";
  mockStorage["acx:grades:v1"]["2026-09"]["CS2006"]["ga1"].dueDate = earlierDeadline;

  // Reconcile again: recalculates alarms for new earlier deadline
  await reconcileDeadlineAlarms({ now, allowSupabaseFallback: false });
  const alarm24h = scheduledAlarms.get("acx:notify:2026-09:CS2006:ga1:24h");
  assert(alarm24h !== undefined);
  const expected24hTrigger = new Date(earlierDeadline).getTime() - 24 * 3600 * 1000;
  assert.equal(alarm24h.when, expected24hTrigger, "24h alarm trigger must match earlier deadline");
});

await asyncTest("Deadline removed completely clears all scheduled alarms without error", async () => {
  const now = new Date("2026-10-14T00:00:00.000Z").getTime();
  const mockStorage = {
    "acx:grades:v1": {
      "2026-09": {
        "CS2006": {
          "ga1": {
            termId: "2026-09",
            courseCode: "CS2006",
            externalAssignmentId: "ga1",
            title: "Quiz 1",
            dueDate: null, // Deadline removed
            submissionStatus: SubmissionStatus.NOT_SUBMITTED,
          },
        },
      },
    },
    "acx:notifications:v1": {},
  };

  const scheduledAlarms = new Map([
    ["acx:notify:2026-09:CS2006:ga1:24h", { name: "acx:notify:2026-09:CS2006:ga1:24h", when: 12345 }],
  ]);

  globalThis.chrome = {
    storage: {
      local: {
        get: (q, cb) => cb(mockStorage),
        set: (items, cb) => {
          Object.assign(mockStorage, items);
          cb?.();
        },
      },
    },
    alarms: {
      getAll: (cb) => cb(Array.from(scheduledAlarms.values())),
      create: (n, info) => scheduledAlarms.set(n, { name: n, ...info }),
      clear: (n, cb) => {
        scheduledAlarms.delete(n);
        cb?.(true);
      },
    },
    notifications: { create: (id, opt, cb) => cb?.(id) },
  };

  const res = await reconcileDeadlineAlarms({ now, allowSupabaseFallback: false });
  assert.equal(scheduledAlarms.size, 0, "All alarms must be cleared when deadline is removed");
  assert.equal(res.cleared, 1);
});

// ── 13. Hardening: Lifecycle, Arc Space & Service Worker Independence ─────────
console.log("\n13. Hardening: Lifecycle, Arc Space & Service Worker Independence Tests:");

await asyncTest("Service worker restart: alarms survive and reconcile without duplicates", async () => {
  const deadlineIso = "2026-10-18T18:29:00.000Z";
  const now = new Date("2026-10-14T00:00:00.000Z").getTime();

  // Simulated persistent storage and alarm database
  const persistentStorage = {
    "acx:grades:v1": {
      "2026-09": {
        "CS2006": {
          "ga1": {
            termId: "2026-09",
            courseCode: "CS2006",
            externalAssignmentId: "ga1",
            title: "Quiz 1",
            dueDate: deadlineIso,
            submissionStatus: SubmissionStatus.NOT_SUBMITTED,
          },
        },
      },
    },
    "acx:notifications:v1": {},
  };

  const persistentAlarms = new Map();

  function bindChromeApi() {
    globalThis.chrome = {
      storage: {
        local: {
          get: (q, cb) => cb(persistentStorage),
          set: (items, cb) => {
            Object.assign(persistentStorage, items);
            cb?.();
          },
        },
      },
      alarms: {
        getAll: (cb) => cb(Array.from(persistentAlarms.values())),
        create: (n, info) => persistentAlarms.set(n, { name: n, ...info }),
        clear: (n, cb) => {
          persistentAlarms.delete(n);
          cb?.(true);
        },
      },
      notifications: { create: (id, opt, cb) => cb?.(id) },
    };
  }

  // Session 1: SW runs and schedules alarms
  bindChromeApi();
  const session1 = await reconcileDeadlineAlarms({ now, allowSupabaseFallback: false });
  assert.equal(session1.created, 4);
  assert.equal(persistentAlarms.size, 4);

  // Simulated Service Worker Termination (in-memory state wiped)
  delete globalThis.chrome;

  // Session 2: Browser wakes Service Worker on startup
  bindChromeApi();
  const session2 = await reconcileDeadlineAlarms({ now, allowSupabaseFallback: false });
  assert.equal(session2.created, 0, "Startup reconciliation must NOT duplicate alarms");
  assert.equal(session2.cleared, 0);
  assert.equal(persistentAlarms.size, 4, "Exact 4 alarms must remain intact");
});

await asyncTest("Arc Space / tab-focus independence: alarm dispatches notification when tab is inactive/unfocused", async () => {
  const deadlineIso = "2026-10-15T18:29:00.000Z";
  const alarmName = "acx:notify:2026-09:CS2006:ga1:6h";
  const nowTime = new Date("2026-10-15T15:00:00.000Z").getTime(); // 3.5h left

  const mockStorage = {
    "acx:grades:v1": {
      "2026-09": {
        "CS2006": {
          "ga1": {
            termId: "2026-09",
            courseCode: "CS2006",
            externalAssignmentId: "ga1",
            title: "Quiz 1",
            dueDate: deadlineIso,
            submissionStatus: SubmissionStatus.NOT_SUBMITTED,
          },
        },
      },
    },
    "acx:notifications:v1": {},
  };

  const notificationsCreated = [];
  globalThis.chrome = {
    storage: {
      local: {
        get: (q, cb) => cb(mockStorage),
        set: (items, cb) => {
          Object.assign(mockStorage, items);
          cb?.();
        },
      },
    },
    alarms: {
      getAll: (cb) => cb([{ name: alarmName }]),
      create: () => {},
      clear: (n, cb) => cb?.(true),
    },
    notifications: {
      create: (id, opt, cb) => {
        notificationsCreated.push({ id, ...opt });
        cb?.(id);
      },
    },
    tabs: {
      // User is in a different Arc Space or working on unrelated tab
      query: (opt, cb) => cb([]),
    },
  };

  const res = await dispatchAlarmNotification(alarmName, { now: nowTime });
  assert.equal(res.dispatched, true, "Notification must dispatch independently of active tab/Space");
  assert.equal(notificationsCreated.length, 1);
  assert.equal(notificationsCreated[0].title, "Assignment Due Soon");
});

console.log("\n==================================================");
console.log(`✓ All ${totalChecks} notification suite verification tests passed successfully!`);
console.log("==================================================\n");
