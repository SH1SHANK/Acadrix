#!/usr/bin/env node
/**
 * Comprehensive Academic Data Architecture & Canonical Events Test Suite.
 *
 * Verifies the canonical weekly assignment deadline feed and architectural
 * negative tests defined in Sections 2, 7-13, 29, and 30 of the Specification:
 * 1. academic_events is the single canonical source of truth
 * 2. Only unscoped weekly assignment deadlines are retrieved
 * 3. Course-specific BPT and project deadlines are excluded
 * 4. Exams and eligibility cutoffs are excluded
 * 7. Event identity strictly uses term_id + ":" + id
 * 8. Wrong term does not resolve foreign events
 * 9. Deleted events remove alarms during reconciliation
 * 10. Changed events reconcile alarms to new trigger times
 * 11. Repeated reconciliation is strictly idempotent
 * 12. Stale cache works when Supabase is unavailable
 * 13. No cache + unavailable Supabase = UNAVAILABLE
 * 14. Portal deadline text is completely ignored
 * 15. Portal grade data is completely ignored
 * 16. No grade scraper runs (captureGrades is deprecated no-op)
 * 17. No deadline scraper runs (captureStartPage is deprecated no-op)
 * 18. No submission status is falsely inferred (submissionStatus is UNKNOWN)
 * 19. Popup uses academic_events-derived data
 * 20. Old grade_records and academic_weeks consumers are removed
 * 21. Architectural negative tests (zero DOM in repository, zero scrapers in notifications)
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AcademicEventRepository,
  RepositoryState,
  normalizeAcademicEvent,
  isAcademicDeadline,
  resolveEventDeadlineIso,
  sortAcademicEvents,
  DEFAULT_SUPABASE_URL,
  DEFAULT_SUPABASE_ANON_KEY,
} from "../src/notifications/events.js";
import {
  SubmissionStatus,
  DeadlineStatus,
  ActionStatus,
  NotificationCategory,
} from "../src/notifications/types.js";
import {
  resolveDeadline,
  evaluateDeadline,
  determineActionableNotification,
  getKolkataDateParts,
} from "../src/notifications/evaluator.js";
import {
  calculateAlarmTriggerTimes,
  formatAlarmName,
  parseAlarmName,
  reconcileDeadlineAlarms,
  getAllTrackedAssignments,
} from "../src/notifications/scheduler.js";
import { captureGrades, captureStartPage } from "../src/portal-decor/capture.js";

let totalChecks = 0;
let passed = true;

async function check(desc, fn) {
  totalChecks++;
  try {
    await fn();
    console.log(`✓ ${desc}`);
  } catch (err) {
    console.error(`❌ ${desc}: ${err.message}\n${err.stack}`);
    passed = false;
  }
}

console.log("\n=======================================================");
console.log("  Acadrix Academic Data Architecture Verification Suite");
console.log("=======================================================\n");

// ── Test 1: the repository requests and enforces the weekly deadline scope ────
await check("Req 1: Supabase requests only course-independent weekly assignment deadlines", async () => {
  let requestedUrl;
  const repo = new AcademicEventRepository({
    cacheKey: "acx:test:weekly-events",
    fetchFn: async (url) => {
      requestedUrl = new URL(url);
      return {
        ok: true,
        json: async () => [
          {
            term_id: "2026-09",
            id: "assignment_weekly_w01",
            course_code: null,
            title: "Week 1 Assignment Submission Deadline",
            event_type: "assignment",
            event_date: "2026-10-11",
            end_time: "2026-10-11T18:29:00.000Z",
          },
          {
            term_id: "2026-09",
            id: "course_assignment_due",
            course_code: "CS2005",
            title: "Course assignment",
            event_type: "assignment",
            event_date: "2026-10-12",
          },
          {
            term_id: "2026-09",
            id: "exam_end_term",
            course_code: null,
            title: "End term exam",
            event_type: "exam",
            event_date: "2027-01-10",
          },
        ],
      };
    },
  });
  const res = await repo.getAcademicEvents({ termId: "2026-09", forceRefresh: true });

  assert.equal(requestedUrl.searchParams.get("term_id"), "eq.2026-09");
  assert.equal(requestedUrl.searchParams.get("course_code"), "is.null");
  assert.equal(requestedUrl.searchParams.get("event_type"), "eq.assignment");
  assert.equal(requestedUrl.searchParams.get("id"), "like.assignment_weekly_%");
  assert.equal(res.events.length, 1, "Non-weekly and course-specific rows must be discarded");
  assert.equal(res.events[0].id, "assignment_weekly_w01");
  assert.equal(res.events[0].courseCode, null);
  assert.equal(res.events[0].source, "SUPABASE");
});

// ── Test 2: academic_events is the canonical source ──────────────────────────
await check("Req 2: public.academic_events remains the canonical weekly deadline source", async () => {
  const repo = new AcademicEventRepository();
  const res = await repo.getAcademicEvents({ termId: "2026-09" });

  assert.equal(res.state, RepositoryState.UP_TO_DATE, "Repository state must be UP_TO_DATE");
  assert.ok(Array.isArray(res.events), "Must return events array");
  assert.ok(res.events.length > 0, "Expected weekly assignment deadlines");
  assert.ok(res.events.every((event) => event.courseCode === null && event.eventType === "assignment" && event.id.startsWith("assignment_weekly_")));
  assert.equal(res.events[0].source, "SUPABASE", "Source must be SUPABASE");
});

// ── Test 3: Weekly assignment deadline resolves correctly ────────────────────
await check("Req 3: Weekly assignment deadline resolves from academic_events", async () => {
  const repo = new AcademicEventRepository();
  const w1 = await repo.getAcademicEvent("assignment_weekly_w01", { termId: "2026-09" });

  assert.ok(w1 !== null, "Week 1 assignment event must exist");
  assert.equal(w1.eventType, "assignment");
  assert.equal(w1.isDeadline, true);
  assert.equal(w1.deadlineIso, "2026-10-11T18:29:00.000Z", "Must resolve 23:59 IST deadline (18:29 UTC)");
});

// ── Req 4-5: course-specific and non-weekly events are excluded ──────────────
await check("Req 4: course-specific BPT and project deadlines are not retrieved", async () => {
  const repo = new AcademicEventRepository();
  assert.equal(await repo.getAcademicEvent("se2001_bpt_01_due", { termId: "2026-09" }), null);
  assert.equal(await repo.getAcademicEvent("cs2006p_git_tracker_deadline", { termId: "2026-09" }), null);
});

await check("Req 5: exams and eligibility cutoffs are not retrieved", async () => {
  const repo = new AcademicEventRepository();
  const { events } = await repo.getAcademicEvents({ termId: "2026-09" });

  assert.ok(events.every((event) => event.eventType === "assignment"));
  assert.equal(await repo.getAcademicEvent("cutoff_week_04", { termId: "2026-09" }), null);
});

// ── Test 7: Event identity uses term_id + ":" + id ───────────────────────────
await check("Req 7: Event identity strictly uses term_id + ':' + id", async () => {
  const raw = {
    term_id: "2026-09",
    id: "assignment_weekly_w02",
    title: "Week 2 Assignment",
    event_type: "assignment",
    event_date: "2026-10-18",
    end_time: "2026-10-18T18:29:00.000Z",
  };
  const norm = normalizeAcademicEvent(raw);
  assert.equal(norm.identity, "2026-09:assignment_weekly_w02", "Identity must be compound termId:id");
});

// ── Test 8: Wrong term does not resolve ──────────────────────────────────────
await check("Req 8: Wrong term does not resolve foreign events", async () => {
  const repo = new AcademicEventRepository();
  const res = await repo.getAcademicEvents({ termId: "1999-01" });

  assert.equal(res.events.length, 0, "Wrong term should return empty events");
});

// ── Test 9 & 10: Alarm Reconciliation (New, Changed, Deleted) ────────────────
await check("Req 9 & 10: Alarm reconciliation handles new, changed, and deleted events", async () => {
  const alarmsMap = new Map();
  const mockChrome = {
    alarms: {
      getAll: (cb) => cb(Array.from(alarmsMap.values())),
      create: (name, info) => alarmsMap.set(name, { name, ...info }),
      clear: (name, cb) => {
        const existed = alarmsMap.delete(name);
        cb?.(existed);
      },
    },
    storage: {
      local: {
        get: (q, cb) => cb({}),
        set: (d, cb) => cb?.(),
      },
    },
  };
  globalThis.chrome = mockChrome;

  const now = new Date("2026-10-06T00:00:00.000Z").getTime();

  // Run 1: Create initial alarms from mock repository
  const mockEventsV1 = [
    {
      termId: "2026-09",
      id: "ev1",
      identity: "2026-09:ev1",
      title: "Assignment 1",
      deadlineIso: "2026-10-11T18:29:00.000Z",
      isDeadline: true,
      submissionStatus: "UNKNOWN",
    },
  ];

  const mockRepoV1 = {
    getUpcomingDeadlines: async () => ({ events: mockEventsV1 }),
  };

  const rec1 = await reconcileDeadlineAlarms({ repository: mockRepoV1, now });
  assert.ok(rec1.created > 0, "Alarms must be created for initial event");
  const initialAlarmCount = alarmsMap.size;
  assert.ok(initialAlarmCount > 0, "Alarms map must be populated");

  // Run 2: Event deadline changed -> old alarms removed, new scheduled
  const mockEventsV2 = [
    {
      termId: "2026-09",
      id: "ev1",
      identity: "2026-09:ev1",
      title: "Assignment 1",
      deadlineIso: "2026-10-09T18:29:00.000Z", // Changed earlier!
      isDeadline: true,
      submissionStatus: "UNKNOWN",
    },
  ];
  const mockRepoV2 = {
    getUpcomingDeadlines: async () => ({ events: mockEventsV2 }),
  };

  const rec2 = await reconcileDeadlineAlarms({ repository: mockRepoV2, now });
  assert.ok(rec2.cleared > 0 || rec2.created > 0, "Alarms must be updated for changed deadline");

  // Run 3: Event deleted -> alarms cleared
  const mockRepoEmpty = {
    getUpcomingDeadlines: async () => ({ events: [] }),
  };
  const rec3 = await reconcileDeadlineAlarms({ repository: mockRepoEmpty, now });
  assert.equal(rec3.totalActive, 0, "All alarms must be cleared when event is removed");
  assert.equal(alarmsMap.size, 0, "Active alarms map must be empty");
});

// ── Test 11: Idempotency ─────────────────────────────────────────────────────
await check("Req 11: Repeated reconciliation is strictly idempotent", async () => {
  const alarmsMap = new Map();
  globalThis.chrome = {
    alarms: {
      getAll: (cb) => cb(Array.from(alarmsMap.values())),
      create: (name, info) => alarmsMap.set(name, { name, ...info }),
      clear: (name, cb) => cb?.(alarmsMap.delete(name)),
    },
    storage: {
      local: {
        get: (q, cb) => cb({}),
        set: (d, cb) => cb?.(),
      },
    },
  };

  const now = new Date("2026-10-06T00:00:00.000Z").getTime();
  const mockRepo = {
    getUpcomingDeadlines: async () => ({
      events: [
        {
          termId: "2026-09",
          id: "ev_idemp",
          identity: "2026-09:ev_idemp",
          title: "Idempotent Quiz",
          deadlineIso: "2026-10-18T18:29:00.000Z",
          isDeadline: true,
          submissionStatus: "UNKNOWN",
        },
      ],
    }),
  };

  const pass1 = await reconcileDeadlineAlarms({ repository: mockRepo, now });
  const pass1Size = alarmsMap.size;
  assert.ok(pass1.created > 0, "Pass 1 creates alarms");

  const pass2 = await reconcileDeadlineAlarms({ repository: mockRepo, now });
  assert.equal(pass2.created, 0, "Pass 2 must create 0 new alarms");
  assert.equal(pass2.cleared, 0, "Pass 2 must clear 0 alarms");
  assert.equal(alarmsMap.size, pass1Size, "Alarm set remains identical");

  const pass3 = await reconcileDeadlineAlarms({ repository: mockRepo, now });
  assert.equal(pass3.created, 0, "Pass 3 must create 0 new alarms");
  assert.equal(alarmsMap.size, pass1Size, "Alarm set remains identical across 3 passes");
});

// ── Test 12: Stale cache fallback ────────────────────────────────────────────
await check("Req 12: Stale cache works when Supabase is unavailable", async () => {
  const cachedData = {
    fetchedAt: "2026-10-05T12:00:00.000Z",
    termId: "2026-09",
    events: [
      normalizeAcademicEvent({
        term_id: "2026-09",
        id: "assignment_weekly_w01",
        course_code: null,
        title: "Cached Week 1 Assignment",
        event_type: "assignment",
        event_date: "2026-10-11",
      }),
    ],
    source: "SUPABASE",
  };

  globalThis.chrome = {
    storage: {
      local: {
        get: (q, cb) => cb({ "acx:events:v2": cachedData }),
        set: (d, cb) => cb?.(),
      },
    },
  };

  // Failing fetchFn simulating network offline
  const failingFetch = async () => {
    throw new Error("Failed to fetch: Network Offline");
  };

  const repo = new AcademicEventRepository({ fetchFn: failingFetch });
  const res = await repo.getAcademicEvents({ termId: "2026-09", forceRefresh: true });

  assert.equal(res.state, RepositoryState.STALE, "State must be STALE when serving cached offline data");
  assert.equal(res.events.length, 1, "Must return cached events");
  assert.equal(res.events[0].id, "assignment_weekly_w01");
});

// ── Test 13: No cache + Unavailable Supabase = UNAVAILABLE ───────────────────
await check("Req 13: No cache + unavailable Supabase = UNAVAILABLE state", async () => {
  globalThis.chrome = {
    storage: {
      local: {
        get: (q, cb) => cb({}),
        set: (d, cb) => cb?.(),
      },
    },
  };

  const failingFetch = async () => {
    throw new Error("Network Error");
  };

  const repo = new AcademicEventRepository({ fetchFn: failingFetch });
  const res = await repo.getAcademicEvents({ termId: "2026-09", forceRefresh: true });

  assert.equal(res.state, RepositoryState.UNAVAILABLE, "State must be UNAVAILABLE");
  assert.equal(res.events.length, 0, "Zero events returned");
  assert.ok(res.error !== null, "Error must be recorded");
});

// ── Test 14 & 15: Portal text and grades completely ignored ──────────────────
await check("Req 14 & 15: Portal deadline text and grade scores are completely ignored", async () => {
  const portalAssessment = {
    title: "Assignment 1",
    dueDateText: "Due Oct 11, 11:59 PM (portal scrape)",
    yourScore: 95,
    peerAverage: 82,
    source: "grades", // Old scrape source
  };

  const resolved = resolveDeadline(portalAssessment);
  // Without canonical academic event deadlineIso or end_time, it must NOT parse dueDateText
  assert.equal(resolved.deadlineIso, null, "Portal dueDateText alone must NEVER determine deadlineIso");
  assert.notEqual(resolved.source, "PORTAL", "Source must never be PORTAL");
});

// ── Test 16 & 17: Scraper functions are deprecated no-ops ────────────────────
await check("Req 16 & 17: captureGrades and captureStartPage are strictly non-scraping no-ops", async () => {
  const dummyDoc = {
    querySelector: () => {
      throw new Error("DOM querySelector MUST NOT be called by scrapers!");
    },
    querySelectorAll: () => {
      throw new Error("DOM querySelectorAll MUST NOT be called by scrapers!");
    },
  };

  const startRes = await captureStartPage(dummyDoc, {});
  assert.equal(startRes, null, "captureStartPage must be no-op returning null");

  const gradeRes = await captureGrades(dummyDoc, {});
  assert.equal(gradeRes.ok, false, "captureGrades must be no-op returning ok: false");
  assert.equal(gradeRes.records.length, 0, "captureGrades must return 0 records");
});

// ── Test 18: Submission status is strictly UNKNOWN ───────────────────────────
await check("Req 18: Submission status is strictly UNKNOWN (no false inference)", async () => {
  const event = normalizeAcademicEvent({
    term_id: "2026-09",
    id: "assignment_w1",
    title: "Week 1",
    event_type: "assignment",
    event_date: "2026-10-11",
  });

  assert.equal(event.submissionStatus, "UNKNOWN", "Submission status must be UNKNOWN");
});

// ── Test 19: Deterministic sorting ───────────────────────────────────────────
await check("Req 19: Deterministic event sorting follows Section 21 specification", async () => {
  const now = new Date("2026-10-10T12:00:00+05:30");

  const events = [
    { title: "Standard upcoming", deadlineIso: "2026-10-25T18:29:00.000Z", isDeadline: true, isHardCutoff: false, importance: "medium" },
    { title: "Due tomorrow", deadlineIso: "2026-10-11T18:29:00.000Z", isDeadline: true, isHardCutoff: false, importance: "medium" },
    { title: "Overdue hard cutoff", deadlineIso: "2026-10-08T18:29:00.000Z", isDeadline: true, isHardCutoff: true, importance: "critical" },
    { title: "Overdue normal", deadlineIso: "2026-10-09T18:29:00.000Z", isDeadline: true, isHardCutoff: false, importance: "medium" },
  ];

  const sorted = sortAcademicEvents(events, now);
  assert.equal(sorted[0].title, "Overdue hard cutoff", "Rank 1: Overdue hard cutoff");
  assert.equal(sorted[1].title, "Overdue normal", "Rank 2: Overdue standard deadline");
  assert.equal(sorted[2].title, "Due tomorrow", "Rank 3: Due tomorrow");
  assert.equal(sorted[3].title, "Standard upcoming", "Rank 4: Later deadline");
});

// ── Test 20: Negative Architecture Tests ─────────────────────────────────────
await check("Req 20 & 21: Architectural Negative Tests (Zero DOM in repo, zero scrapers in notifications)", async () => {
  const eventsContent = readFileSync("src/notifications/events.js", "utf8");
  assert(!eventsContent.includes("querySelector"), "events.js must never query DOM");
  assert(!eventsContent.includes("document."), "events.js must never access document");
  assert(!eventsContent.includes("grade_records"), "events.js must not reference grade_records table");
  assert(!eventsContent.includes("academic_weeks"), "events.js must not reference academic_weeks table");

  const schedulerContent = readFileSync("src/notifications/scheduler.js", "utf8");
  assert(!schedulerContent.includes("captureGrades"), "scheduler.js must not import or call captureGrades");
  assert(!schedulerContent.includes("captureStartPage"), "scheduler.js must not import or call captureStartPage");
  assert(!schedulerContent.includes("querySelector"), "scheduler.js must never query DOM");
});

console.log("\n=======================================================");
if (!passed) {
  console.error("❌ Some academic architecture tests failed!");
  process.exit(1);
} else {
  console.log(`✓ All ${totalChecks} Academic Architecture tests passed successfully!\n`);
}
