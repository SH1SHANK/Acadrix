#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  parseDeadline,
  classifyByTitle,
  classifyByMode,
  effectiveClass,
  assignmentKey,
  relativeText,
  parseScore,
  deriveGradeStatus,
  parseAssignmentType,
  parseTermId,
  parseCourseCode,
  createExternalAssignmentId,
} from "../src/portal-decor/core.js";
import {
  createPortalDecorStore,
  createPortalGradesStore,
  createPendingSyncQueue,
  isPortalDecorStale,
} from "../src/portal-decor/storage.js";
import { captureGrades, captureStartPage } from "../src/portal-decor/capture.js";

const fixture = fs.readFileSync("fixtures/portal-decor/grades-week1.html", "utf8");
const sidebarFixture = fs.readFileSync("fixtures/portal-decor/sidebar-week1.html", "utf8");
const startFixture = fs.readFileSync("fixtures/portal-decor/start-page-graded.html", "utf8");
const courseFixture = fs.readFileSync("fixtures/portal-decor/course-page-mad2-in-progress.html", "utf8");
assert.match(fixture, /class="desktop-container/);
assert.match(fixture, /class="mobile-container/);
assert.match(fixture, /due-date-pending-or-evaluation-pending/);
assert.match(sidebarFixture, /class="side-nav-title[^>]*>Sep 2026 - MAD II/);
assert.match(sidebarFixture, /class="unit-header" aria-expanded="true"/);
assert.match(startFixture, /<span[^>]*class="key"[^>]*>Mode<\/span>/);
assert.match(startFixture, />Graded<\/span>/);
assert.match(startFixture, /class="due-label/);

const sidebarTitles = [...sidebarFixture.matchAll(/class="child-title">([^<]+)<\/div>\s*<div[^>]*class="child-type">([^<]+)</g)]
  .filter(([, , type]) => /^(Assignment|Programming Assignment)$/i.test(type.trim()))
  .map(([, title]) => title.trim());
const gradeTitles = [...fixture.matchAll(/class="item-title"><a[^>]*>([^<]+)<\/a>/g)].map(([, title]) => title.trim());
const sidebarWeek = sidebarFixture.match(/class="unit-title">(Week 1)<\/span>/)?.[1];
const gradesWeek = fixture.match(/class="module-title">\s*(Week 1)\s*<\/div>/)?.[1];
const startWeek = courseFixture.match(/class="breadcrumb-item current[^"]*"[^>]*>\s*(Week 1)\s*<\/span>/)?.[1];
assert.equal(sidebarWeek, gradesWeek);
assert.equal(gradesWeek, startWeek);
const sharedTitles = [...new Set(sidebarTitles.filter((title) => gradeTitles.includes(title)))];
assert.ok(sharedTitles.length > 0);
for (const title of sharedTitles) {
  const sidebarKey = assignmentKey("Sep 2026 - MAD II", sidebarWeek, title);
  const gradesKey = assignmentKey("Sep 2026 - MAD II", gradesWeek, title);
  assert.equal(sidebarKey, gradesKey);
}
const startTitle = courseFixture.match(/<h1[^>]*class="title size-small[^"]*"[^>]*>\s*([^<]+?)\s*<\/h1>/)?.[1];
assert.equal(startTitle, "Week 1 - Graded Assignment 1");
assert.ok(sharedTitles.includes(startTitle));
assert.equal(
  assignmentKey("Sep 2026 - MAD II", startWeek, startTitle),
  assignmentKey("Sep 2026 - MAD II", gradesWeek, startTitle)
);

assert.deepEqual(parseDeadline("Oct 11, 2026 at 11:59 PM IST"), {
  raw: "Oct 11, 2026 at 11:59 PM IST",
  iso: "2026-10-11T23:59:00+05:30",
  tz: "IST",
});
assert.deepEqual(parseDeadline("Dec 31, 2026 11:59 PM IST"), {
  raw: "Dec 31, 2026 11:59 PM IST",
  iso: "2026-12-31T23:59:00+05:30",
  tz: "IST",
});
assert.deepEqual(parseDeadline("Dec 31, 2026, 11:59 PM IST"), {
  raw: "Dec 31, 2026, 11:59 PM IST",
  iso: "2026-12-31T23:59:00+05:30",
  tz: "IST",
});
assert.deepEqual(parseDeadline("31 Dec 2026 11:59 PM IST"), {
  raw: "31 Dec 2026 11:59 PM IST",
  iso: "2026-12-31T23:59:00+05:30",
  tz: "IST",
});
assert.deepEqual(parseDeadline("Due: Oct 11, 2026 at 11:59 PM IST"), {
  raw: "Due: Oct 11, 2026 at 11:59 PM IST",
  iso: "2026-10-11T23:59:00+05:30",
  tz: "IST",
});
assert.equal(parseDeadline("Feb 30, 2026 11:59 PM IST").iso, null);
assert.equal(parseDeadline("Feb 28, 2026 12:00 AM IST").iso, "2026-02-28T00:00:00+05:30");
assert.equal(parseDeadline("Feb 28, 2026 12:00 PM IST").iso, "2026-02-28T12:00:00+05:30");
assert.equal(parseDeadline("Oct 11, 2026 11:59 PM PST").iso, null);
assert.equal(parseDeadline("Due Date Pending").iso, null);
assert.equal(parseDeadline("Oct 11, 2026").iso, null);

// ── Score Parsing & Grade Status Tests ─────────────────────────────────────────
assert.deepEqual(parseScore("94%"), { score: 94, raw: "94%" });
assert.deepEqual(parseScore("100"), { score: 100, raw: "100" });
assert.deepEqual(parseScore("0"), { score: 0, raw: "0" });
assert.deepEqual(parseScore("81.5%"), { score: 81.5, raw: "81.5%" });
assert.deepEqual(parseScore("-"), { score: null, raw: "-" });
assert.deepEqual(parseScore(""), { score: null, raw: "" });
assert.deepEqual(parseScore(null), { score: null, raw: "" });
assert.deepEqual(parseScore("Your Score: 85%"), { score: 85, raw: "85%" });
assert.deepEqual(parseScore("Your Score: -"), { score: null, raw: "-" });
assert.deepEqual(parseScore("Peer Average: 91%"), { score: 91, raw: "91%" });
assert.deepEqual(parseScore("Median Score: 100"), { score: 100, raw: "100" });

assert.equal(deriveGradeStatus(94, "Evaluated", "2026-10-11T23:59:00+05:30"), "GRADED");
assert.equal(deriveGradeStatus(0, "Evaluated", "2026-10-11T23:59:00+05:30"), "GRADED");
assert.equal(deriveGradeStatus(null, "Evaluation Pending", "2026-10-11T23:59:00+05:30"), "PENDING");
assert.equal(deriveGradeStatus(null, "Due Date Pending", null), "UNRELEASED");
const refNow = new Date("2026-10-15T00:00:00Z");
assert.equal(deriveGradeStatus(null, "normal", "2026-10-11T23:59:00+05:30", refNow), "PENDING");
assert.equal(deriveGradeStatus(null, "normal", "2026-10-20T23:59:00+05:30", refNow), "UNRELEASED");

assert.equal(parseAssignmentType("Programming Assignment (Due: Oct 11, 2026)"), "Programming Assignment");
assert.equal(parseAssignmentType("Assignment (Due: Dec 31, 2026)"), "Assignment");
assert.equal(parseAssignmentType("PPA 1 (Due: Dec 31, 2026)"), "Programming Assignment");
assert.equal(parseAssignmentType("Activity Questions 1.1"), "Activity Question");

assert.equal(classifyByTitle("AQ 1.1 - Not Graded"), "practice");
assert.equal(classifyByTitle("Practice Assignment - 1"), "practice");
assert.equal(classifyByTitle("JavaScript Graded Assignment"), "graded");
assert.equal(classifyByTitle("PPA 1"), "practice");
assert.equal(classifyByTitle("GrPA 2"), "graded");
assert.equal(classifyByTitle("Activity Questions 1.1"), "practice");
assert.equal(classifyByTitle("Week 1 Practice Assignment - 1 - Not Graded"), "practice");
assert.equal(classifyByMode("Graded"), "graded");
assert.equal(classifyByMode("Practice"), "unknown");
assert.equal(effectiveClass("Graded", "Practice Assignment - 1"), "graded");
assert.equal(effectiveClass("", "AQ 1.1 - Not Graded"), "practice");

assert.equal(parseTermId("Sep 2026 - MAD II"), "2026-09");
assert.equal(parseTermId("September 2026"), "2026-09");
assert.equal(parseTermId("2026-09"), "2026-09");
assert.equal(parseTermId("Jan 2027"), "2027-01");
assert.equal(parseTermId("Oct 2025"), "2025-10");
assert.equal(parseTermId(""), "2026-09");

assert.equal(parseCourseCode("Sep 2026 - MAD II"), "CS2006");
assert.equal(parseCourseCode("Sep 2026 - MAD 2"), "CS2006");
assert.equal(parseCourseCode("Sep 2026 - MAD 2 Project"), "CS2006P");
assert.equal(parseCourseCode("Sep 2026 - System Commands"), "SE2001");
assert.equal(parseCourseCode("Programming Concepts using Java"), "CS2005");
assert.equal(parseCourseCode("Business Data Management"), "MS2001");
assert.equal(parseCourseCode("MA1001 Mathematics 1"), "MA1001");

assert.equal(
  createExternalAssignmentId("2026-09", "CS2006", "Week 1", "GA 1", { getAttribute: (k) => k === "data-id" ? "ga1_unique" : null }),
  "ga1_unique"
);
assert.equal(
  createExternalAssignmentId("2026-09", "CS2006", "Week 1", "GA 1", { getAttribute: (k) => k === "href" ? "/assessment/quiz_12345" : null }),
  "quiz_12345"
);
assert.equal(
  createExternalAssignmentId("2026-09", "CS2006", "Week 1", "JavaScript Graded Assignment"),
  "2026_09_cs2006_week_1_javascript_graded_assignment"
);

const course = "Sep 2026 - System Commands";
assert.equal(assignmentKey(course, "Week 1", "  JavaScript\nGraded Assignment  "), assignmentKey(course, " week 1 ", "JavaScript Graded Assignment"));
const now = new Date("2026-10-10T18:59:00.000Z");
assert.equal(relativeText("2026-10-10T19:58:00.000Z", now), "Due in under 1 hour");
assert.equal(relativeText("2026-10-10T19:59:00.000Z", now), "Due in 1 hours");
assert.equal(relativeText("2026-10-11T18:58:00.000Z", now), "Due in 23 hours");
assert.equal(relativeText("2026-10-11T18:59:00.000Z", now), "Due in 1 days");
assert.equal(relativeText("2026-10-10T18:58:59.000Z", now), "Past due");

let backing = {
  "acx:deadlines:v1": {},
  "acx:grades:v1": {},
  "acx:pending-sync:v1": {},
};
globalThis.chrome = {
  storage: {
    local: {
      get(defaults, callback) {
        const res = {};
        for (const [k, def] of Object.entries(defaults || {})) {
          res[k] = backing[k] !== undefined ? structuredClone(backing[k]) : def;
        }
        callback(res);
      },
      set(value, callback) {
        for (const [k, v] of Object.entries(value || {})) {
          backing[k] = structuredClone(v);
        }
        callback?.();
      },
      remove(key, callback) {
        if (Array.isArray(key)) {
          key.forEach((k) => { backing[k] = {}; });
        } else {
          backing[key] = {};
        }
        callback?.();
      },
    },
  },
};
let tick = 1_700_000_000_000;
const store = createPortalDecorStore(() => tick);
const gradesStore = createPortalGradesStore(() => tick);
const pendingQueue = createPendingSyncQueue();

// ── Test Cases 1 to 8 ─────────────────────────────────────────────────────────

// Case 1: Initial extraction with `Your Score: -`, `Peer Average: 94%`, `Median Score: 100`
const case1Key = assignmentKey(course, "Week 1", "JavaScript Graded Assignment");
await store.capture(course, case1Key, {
  module: "Week 1",
  title: "JavaScript Graded Assignment",
  type: "Programming Assignment",
  mode: "graded",
  deadlineIso: "2026-10-11T23:59:00+05:30",
  deadlineRaw: "Oct 11, 2026 at 11:59 PM IST",
  yourScore: null,
  yourScoreRaw: "-",
  peerAverage: 94,
  medianScore: 100,
  scoreStatus: "UNRELEASED",
  evaluationStatus: "Due Date Pending",
  source: "grades",
});

const c1 = await store.get(course, case1Key);
assert.equal(c1.yourScore, null, "Case 1: yourScore should be null when unreleased");
assert.equal(c1.yourScoreRaw, "-");
assert.equal(c1.peerAverage, 94, "Case 1: peerAverage should be 94");
assert.equal(c1.medianScore, 100, "Case 1: medianScore should be 100");
assert.equal(c1.scoreStatus, "UNRELEASED");

// Case 2: Update with `Your Score: 94%`
tick += 1000;
await store.capture(course, case1Key, {
  yourScore: 94,
  yourScoreRaw: "94%",
  scoreStatus: "GRADED",
  evaluationStatus: "Evaluated",
  source: "grades",
});

const c2 = await store.get(course, case1Key);
assert.equal(c2.yourScore, 94, "Case 2: yourScore should update to 94");
assert.equal(c2.yourScoreRaw, "94%");
assert.equal(c2.scoreStatus, "GRADED");
assert.equal(c2.peerAverage, 94, "Case 2: peerAverage should be retained");
assert.equal(c2.medianScore, 100, "Case 2: medianScore should be retained");

// Case 3 & 4: Persistence across reloads and no duplicate entries on repeated captures
const allBefore = await store.getAll();
assert.equal(Object.keys(allBefore[course]).length, 1);
tick += 1000;
await store.capture(course, case1Key, {
  yourScore: 94,
  yourScoreRaw: "94%",
  scoreStatus: "GRADED",
  source: "grades",
});
const allAfter = await store.getAll();
assert.equal(Object.keys(allAfter[course]).length, 1, "Case 3 & 4: repeated captures must not duplicate records");

// Case 5: Desktop + Mobile DOM deduplication via captureGrades
function parseGradesFixtureToMockDoc(html, courseTitle = "Sep 2026 - MAD II") {
  const topBar = { textContent: courseTitle };
  const gradesRoot = { isConnected: true };
  
  const desktopBlock = html.split('class="desktop-container')[1]?.split('class="mobile-container')[0] || "";
  const desktopItemChunks = desktopBlock.split(/class="item ng-star-inserted">/).slice(1);
  
  const desktopItems = desktopItemChunks.map((chunk) => {
    const titleMatch = chunk.match(/class="item-title"><a[^>]*>([^<]+)<\/a>/);
    const subtitleMatch = chunk.match(/class="item-subtitle">([\s\S]*?)<\/div><\/div>/);
    const pendingMatch = chunk.match(/class="due-date-pending-or-evaluation-pending">\s*([^<]+?)\s*<\/div>/);
    const valueMatches = [...chunk.matchAll(/class="item-value[^"]*">([\s\S]*?)<\/div>/g)].map((m) =>
      m[1].replace(/<!---->|\s+/g, " ").trim()
    );

    const pendingEl = pendingMatch ? { textContent: pendingMatch[1] } : null;
    const subtitleEl = subtitleMatch
      ? {
          textContent: subtitleMatch[1].replace(/<!---->|\s+/g, " ").trim(),
          childNodes: [
            {
              nodeType: 3,
              nodeValue: subtitleMatch[1]
                .replace(/<div[\s\S]*?<\/div>/, "")
                .replace(/<!---->|\s+/g, " ")
                .trim(),
            },
            ...(pendingEl ? [pendingEl] : []),
          ],
          querySelector: (sel) => (sel.includes("pending") ? pendingEl : null),
        }
      : null;

    const titleLink = titleMatch ? { textContent: titleMatch[1].trim() } : null;
    const valueEls = valueMatches.map((v) => ({ textContent: v }));

    return {
      querySelector: (sel) => {
        if (sel.includes("item-title a")) return titleLink;
        if (sel.includes("item-subtitle")) return subtitleEl;
        return null;
      },
      querySelectorAll: (sel) => {
        if (sel.includes("item-value")) return valueEls;
        return [];
      },
    };
  });

  const mobileBlock = html.split('class="mobile-container')[1] || "";
  const mobileItemChunks = mobileBlock.split(/class="mobile-item-container ng-star-inserted">/).slice(1);

  const mobileItems = mobileItemChunks.map((chunk) => {
    const titleMatch = chunk.match(/class="mobile-title">\s*([^<]+?)\s*<\/a>/);
    const subtitleMatch = chunk.match(/class="item-subtitle">([\s\S]*?)<\/div>/);
    const pendingMatch = chunk.match(/class="due-date-pending-or-evaluation-pending">\s*([^<]+?)\s*<\/div>/);
    const valMatches = [...chunk.matchAll(/class="mobile-item-value[^"]*">([\s\S]*?)<\/div>/g)].map((m) =>
      m[1].replace(/<!---->|\s+/g, " ").trim()
    );

    const pendingEl = pendingMatch ? { textContent: pendingMatch[1] } : null;
    const subtitleEl = subtitleMatch
      ? {
          textContent: subtitleMatch[1].replace(/<!---->|\s+/g, " ").trim(),
          childNodes: [
            {
              nodeType: 3,
              nodeValue: subtitleMatch[1]
                .replace(/<div[\s\S]*?<\/div>/, "")
                .replace(/<!---->|\s+/g, " ")
                .trim(),
            },
            ...(pendingEl ? [pendingEl] : []),
          ],
          querySelector: (sel) => (sel.includes("pending") ? pendingEl : null),
        }
      : null;

    const titleLink = titleMatch ? { textContent: titleMatch[1].trim() } : null;
    const valueEls = valMatches.map((v) => ({ textContent: v }));

    return {
      querySelector: (sel) => {
        if (sel.includes("mobile-title")) return titleLink;
        if (sel.includes("item-subtitle")) return subtitleEl;
        return null;
      },
      querySelectorAll: (sel) => {
        if (sel.includes("mobile-item-value")) return valueEls;
        return [];
      },
    };
  });

  const moduleContainer = {
    querySelector: (sel) => {
      if (sel.includes("module-title")) return { textContent: "Week 1" };
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel.includes("desktop-container .item")) return desktopItems;
      if (sel.includes("mobile-item-container")) return mobileItems;
      return [];
    },
  };

  return {
    querySelector: (sel) => {
      if (sel.includes("top-bar-title") || sel.includes("side-nav-title")) return topBar;
      if (sel.includes("grades") || sel.includes("app-grades")) return gradesRoot;
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel.includes("module-container")) return [moduleContainer];
      return [];
    },
  };
}

const mockDoc = parseGradesFixtureToMockDoc(fixture, "Sep 2026 - MAD II");
const extractedResult = await captureGrades(mockDoc, gradesStore, pendingQueue, store, () => tick);
assert.equal(extractedResult.ok, false, "captureGrades must be deprecated no-op (§12)");
assert.equal(extractedResult.records.length, 0, "No records scraped from grades page");

// Populate sample decor for store isolation and pruning verification
const jsDecorKey = assignmentKey("Sep 2026 - MAD II", "Week 1", "JavaScript Graded Assignment - Simple and Compound Interest");
await store.capture("Sep 2026 - MAD II", jsDecorKey, {
  id: jsDecorKey,
  type: "Programming Assignment",
  peerAverage: 91,
  medianScore: 100,
  yourScore: null,
  capturedAt: tick,
});

await store.capture("Sep 2026 - MAD II", assignmentKey("Sep 2026 - MAD II", "Week 1", "AQ 1.1: Activity Questions 1 - Not Graded"), {
  yourScore: null,
  capturedAt: tick,
});

const jsGraded = await store.get("Sep 2026 - MAD II", jsDecorKey);
assert.ok(jsGraded, "Legacy decor store must be updated for sidebar badges");
assert.equal(jsGraded.type, "Programming Assignment");
// Case 6: Course/Module isolation
const course2 = "Sep 2026 - Machine Learning";
const kCourse1 = assignmentKey(course, "Week 1", "Assignment 1");
const kCourse2 = assignmentKey(course2, "Week 1", "Assignment 1");
const kCourse1Week2 = assignmentKey(course, "Week 2", "Assignment 1");
assert.notEqual(kCourse1, kCourse2, "Case 6: different courses must have different keys");
assert.notEqual(kCourse1, kCourse1Week2, "Case 6: different weeks must have different keys");

// Case 7: Non-destructive upsert when visiting start page
await store.capture("Sep 2026 - MAD II", jsGraded.id, {
  yourScore: 98,
  yourScoreRaw: "98%",
  scoreStatus: "GRADED",
  source: "grades",
});
// Simulate visiting assessment start page (which does not have grade scores)
await store.capture("Sep 2026 - MAD II", jsGraded.id, {
  source: "start",
  mode: "graded",
  modeRaw: "Graded",
  deadlineIso: "2026-10-11T23:59:00+05:30",
  deadlineRaw: "Oct 11, 2026 at 11:59 PM IST",
});
const preserved = await store.get("Sep 2026 - MAD II", jsGraded.id);
assert.equal(preserved.yourScore, 98, "Case 7: yourScore must be preserved across start page visits");
assert.equal(preserved.peerAverage, 91, "Case 7: peerAverage must be preserved");
assert.equal(preserved.mode, "graded");

// Case 8: Pending score remains null (not 0)
const aq1 = await store.get(
  "Sep 2026 - MAD II",
  assignmentKey("Sep 2026 - MAD II", "Week 1", "AQ 1.1: Activity Questions 1 - Not Graded")
);
assert.equal(aq1.yourScore, null, "Case 8: pending score must remain null, never 0");
assert.notEqual(aq1.yourScore, 0, "Case 8: pending score must not be 0");

await store.clear();
await gradesStore.clear();
await pendingQueue.clear();
assert.deepEqual(backing["acx:deadlines:v1"], {});
assert.deepEqual(backing["acx:grades:v1"], {});
assert.deepEqual(backing["acx:pending-sync:v1"], {});

for (let i = 0; i < 505; i++) {
  backing["acx:deadlines:v1"].a ||= {};
  backing["acx:deadlines:v1"].a[`key-${i}`] = { capturedAt: tick + i, deadlineIso: null };
}
assert.equal(Object.keys(await store.getAll()).length, 1);
assert.equal(Object.keys((await store.getAll()).a).length, 500);
backing["acx:deadlines:v1"].a.old = { capturedAt: tick - 121 * 24 * 60 * 60 * 1000, deadlineIso: null };
assert.equal((await store.getAll()).a.old, undefined);

globalThis.chrome.storage.local.get = () => { throw new Error("storage unavailable"); };
globalThis.chrome.storage.local.set = () => { throw new Error("storage unavailable"); };
const fallback = createPortalDecorStore(() => tick);
await fallback.capture(course, "fallback", { source: "grades", deadlineIso: null, deadlineRaw: "" });
assert.equal((await fallback.get(course, "fallback")).source, "grades");

// ============================================================================
// PHASE 3 SYNCHRONIZATION TESTS (Acadrix -> Supabase grade-sync Edge Function)
// ============================================================================
import {
  syncGradesToSupabase,
  formatIngestRecord,
  getSyncConfiguration,
  isSyncActive,
  DEFAULT_SUPABASE_URL,
  DEFAULT_GRADE_SYNC_SECRET,
} from "../src/portal-decor/sync.js";
import { initPortalDecor } from "../src/portal-decor/index.js";

// Restore mock chrome.storage.local with clean backing
backing = {
  "acx:deadlines:v1": {},
  "acx:grades:v1": {},
  "acx:pending-sync:v1": {},
  gradeSyncSecret: "test_secret_mock_123",
  supabaseUrl: "https://aocrcrdmwmdtthrwypii.supabase.co",
};

globalThis.chrome = {
  storage: {
    local: {
      get(defaults, callback) {
        const res = {};
        for (const [k, def] of Object.entries(defaults || {})) {
          res[k] = backing[k] !== undefined ? structuredClone(backing[k]) : def;
        }
        callback(res);
      },
      set(value, callback) {
        for (const [k, v] of Object.entries(value || {})) {
          backing[k] = structuredClone(v);
        }
        callback?.();
      },
      remove(key, callback) {
        if (Array.isArray(key)) {
          key.forEach((k) => { delete backing[k]; });
        } else {
          delete backing[key];
        }
        callback?.();
      },
    },
  },
};

const testGradesStore = createPortalGradesStore(() => tick);
const testPendingQueue = createPendingSyncQueue();
await testGradesStore.clear();
await testPendingQueue.clear();

// ── Phase 3 Test 1: formatIngestRecord Schema & Normalization ─────────────────
const formattedComplete = formatIngestRecord({
  termId: "2026-09",
  courseCode: "CS2006",
  externalAssignmentId: "cs2006_ga_01",
  canonicalAssessmentId: "cs2006_pa_01",
  module: "Week 1",
  title: "JavaScript Graded Assignment",
  assignmentType: "Programming Assignment",
  yourScore: 94.5,
  yourScoreRaw: "94.5%",
  peerAverage: 91,
  medianScore: 100,
  scoreStatus: "GRADED",
  evaluationStatus: "Evaluated",
  dueDate: "2026-10-11T23:59:00+05:30",
  dueDateText: "Oct 11, 2026 at 11:59 PM IST",
  source: "grades",
  capturedAt: "2026-10-05T12:00:00.000Z",
});

assert.equal(formattedComplete.externalAssignmentId, "cs2006_ga_01");
assert.equal(formattedComplete.canonicalAssessmentId, "cs2006_pa_01");
assert.equal(formattedComplete.module, "Week 1");
assert.equal(formattedComplete.title, "JavaScript Graded Assignment");
assert.equal(formattedComplete.assignmentType, "Programming Assignment");
assert.equal(formattedComplete.yourScore, 94.5);
assert.equal(formattedComplete.yourScoreRaw, "94.5%");
assert.equal(formattedComplete.peerAverage, 91);
assert.equal(formattedComplete.medianScore, 100);
assert.equal(formattedComplete.scoreStatus, "GRADED");
assert.equal(formattedComplete.evaluationStatus, "Evaluated");
assert.equal(formattedComplete.dueDate, "2026-10-11T18:29:00.000Z");
assert.equal(formattedComplete.dueDateText, "Oct 11, 2026 at 11:59 PM IST");
assert.equal(formattedComplete.source, "grades");

// Unreleased / null score formatting
const formattedNull = formatIngestRecord({
  externalAssignmentId: "cs2006_ga_02",
  module: "Week 2",
  title: "GA 2",
  yourScore: null,
  yourScoreRaw: "-",
});
assert.equal(formattedNull.yourScore, null);
assert.equal(formattedNull.yourScoreRaw, "-");
assert.equal(formattedNull.canonicalAssessmentId, null);
assert.equal(formattedNull.assignmentType, "Assignment");

// ── Phase 3 Test 2: syncGradesToSupabase is Deprecated No-Op (§4) ─────────────
await testPendingQueue.enqueue([{ termId: "2026-09", courseCode: "CS2006", externalAssignmentId: "item1" }]);
assert.equal((await testPendingQueue.getPending()).length, 1);

const syncResult = await syncGradesToSupabase({
  gradesStore: testGradesStore,
  pendingQueue: testPendingQueue,
});

assert.equal(syncResult.ok, true, "Sync must report success");
assert.equal(syncResult.reason, "GRADES_REMOVED", "Must report GRADES_REMOVED");
assert.equal((await testPendingQueue.getPending()).length, 0, "Pending queue must be cleared");

// ── Phase 3 Test 3: Coordinator Integration Lifecycle ─────────────────────────
const coordinator = initPortalDecor({
  doc: mockDoc,
  store,
  gradesStore: testGradesStore,
  pendingQueue: testPendingQueue,
  now: () => tick,
});

assert.ok(typeof coordinator.syncGrades === "function", "Coordinator must expose syncGrades()");
assert.ok(typeof coordinator.runCycle === "function", "Coordinator must expose runCycle()");
coordinator.destroy();

// ============================================================================
// PROGRAMMING ASSIGNMENT & SUPABASE / GRADES STORE FALLBACK TESTS
// ============================================================================
import { fetchDeadlinesFromSupabase } from "../src/portal-decor/sync.js";
import { decorateSidebar, createDecorHost } from "../src/portal-decor/decorator.js";

// Test 1: Programming Assignment Start Page Scraping (<app-pa-start-page>)
const mockPaDoc = {
  querySelector: (sel) => {
    if (sel.includes("top-bar-title") || sel.includes("side-nav-title")) {
      return { textContent: "Sep 2026 - MAD II" };
    }
    if (sel.includes("app-assessment-start-page") || sel.includes("app-pa-start-page") || sel.includes("app-programming-assignment-view")) {
      return { isConnected: true };
    }
    if (sel.includes("app-title-bar h1.title") || sel.includes("h1")) {
      return { textContent: "JavaScript Graded Assignment - Simple and Compound Interest" };
    }
    if (sel.includes("nav.breadcrumb") || sel.includes("parent-title")) {
      return { textContent: "Week 1" };
    }
    if (sel.includes("app-submission-timer")) {
      return { textContent: "Oct 11, 2026 11:59 PM IST" };
    }
    return null;
  },
  querySelectorAll: () => [],
};

const paCaptureStore = createPortalDecorStore(() => tick);
const paResult = await captureStartPage(mockPaDoc, paCaptureStore, () => tick);
assert.equal(paResult, null, "captureStartPage must be deprecated no-op (§11)");

// Test 2: ISO Date String in parseDeadline
assert.deepEqual(parseDeadline("2026-10-11T23:59:00+05:30"), {
  raw: "2026-10-11T23:59:00+05:30",
  iso: "2026-10-11T23:59:00+05:30",
  tz: "IST",
});

// Test 3: Weekly Activity and Activity Questions Classification
assert.equal(classifyByTitle("Weekly Activity 1.1"), "practice");
assert.equal(classifyByTitle("Activity 1.2"), "practice");
assert.equal(classifyByTitle("Activity Questions 1.3"), "practice");
assert.equal(parseAssignmentType("Weekly Activity 1.1"), "Activity Question");

// Test 4: fetchDeadlinesFromSupabase Unit Test (Only Deadlines, Never Grades)
const testGradesUntouchedStore = createPortalGradesStore(() => tick);
const testFetchDecorStore = createPortalDecorStore(() => tick);
await testGradesUntouchedStore.clear();
await testFetchDecorStore.clear();
const mockFetchSupabaseDeadlines = async (url) => {
  return {
    ok: true,
    status: 200,
    json: async () => [
      {
        term_id: "2026-09",
        course_code: "CS2006",
        id: "cs2006_week1_grpa1",
        sub_type: "Week 1",
        title: "GrPA 1 - JavaScript Basics",
        event_type: "assignment",
        end_time: "2026-10-11T18:29:00.000Z",
        event_date: "2026-10-11",
      },
    ],
  };
};

const fetchRes = await fetchDeadlinesFromSupabase({
  termId: "2026-09",
  courseCode: "CS2006",
  decorStore: testFetchDecorStore,
  syncSecret: "test_sync_secret_xyz",
  fetchFn: mockFetchSupabaseDeadlines,
});

assert.equal(fetchRes.ok, true);
assert.equal(fetchRes.deadlines.length, 1);
assert.equal(fetchRes.deadlines[0].dueDate, "2026-10-11T18:29:00.000Z");

// Verify that gradesStore was completely untouched (authoritative grades are strictly from portal)
const storedGradesEmpty = await testGradesUntouchedStore.getCourseGrades("2026-09", "CS2006");
assert.equal(storedGradesEmpty.length, 0, "Grades store must remain empty when fetching deadlines from Supabase");

// Verify that decorStore received the deadline
const fetchedDecor = await testFetchDecorStore.get(
  "2026-09 - CS2006",
  assignmentKey("2026-09 - CS2006", "Week 1", "GrPA 1 - JavaScript Basics")
);
assert.ok(fetchedDecor, "decorStore must have the deadline populated");
assert.equal(fetchedDecor.deadlineIso, "2026-10-11T18:29:00.000Z");
assert.equal(fetchedDecor.source, "SUPABASE");

// Test 5: decorateSidebar fallback to authoritative portal gradesStore
const mockSidebarDoc = (() => {
  let attachedHosts = [];
  const typeEl = {
    textContent: "Programming Assignment",
    insertAdjacentElement(pos, el) {
      attachedHosts.push(el);
    },
  };
  const childRowEl = {
    attributes: {},
    setAttribute(k, v) { this.attributes[k] = v; },
    removeAttribute(k) { delete this.attributes[k]; },
    querySelector(sel) {
      if (sel.includes("child-type")) return typeEl;
      if (sel.includes("child-title")) return { textContent: "GrPA 1 - JavaScript Basics" };
      return null;
    },
    querySelectorAll(sel) {
      if (sel.includes("acx-portal-decor") || sel.includes("data-acx-decor")) {
        return attachedHosts;
      }
      return [];
    },
    insertAdjacentElement(pos, el) {
      attachedHosts.push(el);
    },
  };

  const unitContainerEl = {
    querySelector(sel) {
      if (sel.includes("unit-title")) return { textContent: "Week 1" };
      return null;
    },
    querySelectorAll(sel) {
      if (sel.includes("child-row")) return [childRowEl];
      return [];
    },
  };

  return {
    createElement(tag) {
      let attrs = {};
      let children = [];
      let shadowRootObj = null;
      return {
        tagName: tag.toUpperCase(),
        className: "",
        textContent: "",
        innerHTML: "",
        setAttribute(k, v) { attrs[k] = v; },
        getAttribute(k) { return attrs[k]; },
        hasAttribute(k) { return k in attrs; },
        removeAttribute(k) { delete attrs[k]; },
        classList: {
          add(c) { this.classes = this.classes || new Set(); this.classes.add(c); },
          contains(c) { return Boolean(this.classes?.has(c)); },
        },
        appendChild(child) { children.push(child); return child; },
        get childNodes() { return children; },
        attachShadow({ mode }) {
          shadowRootObj = {
            mode,
            children: [],
            appendChild(c) { this.children.push(c); return c; },
          };
          return shadowRootObj;
        },
        get shadowRoot() { return shadowRootObj; },
      };
    },
    querySelector(sel) {
      if (sel.includes("top-bar-title") || sel.includes("side-nav-title")) {
        return { textContent: "Sep 2026 - MAD II" };
      }
      return null;
    },
    querySelectorAll(sel) {
      if (sel.includes("unit-container")) return [unitContainerEl];
      return [];
    },
    head: { appendChild: () => {} },
    getElementById: () => null,
    childRowEl,
    attachedHosts,
  };
})();

// Authoritative local grades store populated from portal scraping
const localAuthoritativeGradesStore = createPortalGradesStore(() => tick);
await localAuthoritativeGradesStore.captureRecord({
  termId: "2026-09",
  courseCode: "CS2006",
  externalAssignmentId: "cs2006_week1_grpa1",
  module: "Week 1",
  title: "GrPA 1 - JavaScript Basics",
  assignmentType: "Programming Assignment",
  yourScore: 98,
  yourScoreRaw: "98%",
  peerAverage: 88,
  medianScore: 95,
  scoreStatus: "GRADED",
  evaluationStatus: "Evaluated",
  dueDate: "2026-10-11T23:59:00+05:30",
  dueDateText: "Oct 11, 2026 at 11:59 PM IST",
});

const emptyDecorStore = createPortalDecorStore(() => tick);
// decorStore is completely empty for this assignment
assert.equal(
  await emptyDecorStore.get("Sep 2026 - MAD II", assignmentKey("Sep 2026 - MAD II", "Week 1", "GrPA 1 - JavaScript Basics")),
  null
);

// Run decorateSidebar with authoritative local gradesStore as fallback
await decorateSidebar(mockSidebarDoc, emptyDecorStore, () => new Date("2026-10-05T00:00:00Z"), localAuthoritativeGradesStore);

// Verify that the row was decorated as graded and cached
assert.equal(mockSidebarDoc.childRowEl.attributes["data-acx-graded"], "true");
assert.equal(mockSidebarDoc.attachedHosts.length, 1);
const cachedEntry = await emptyDecorStore.get(
  "Sep 2026 - MAD II",
  assignmentKey("Sep 2026 - MAD II", "Week 1", "GrPA 1 - JavaScript Basics")
);
assert.ok(cachedEntry, "Entry must be populated and cached via gradesStore fallback");
assert.equal(cachedEntry.deadlineIso, "2026-10-11T23:59:00+05:30");
assert.equal(cachedEntry.yourScore, 98);

await testGradesStore.clear();
await testPendingQueue.clear();

console.log("✓ All Portal decor core, storage, grade extraction, Phase 3 synchronization, and programming assignment fallback tests passed");




