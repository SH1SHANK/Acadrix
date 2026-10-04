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
} from "../src/portal-decor/core.js";
import { createPortalDecorStore, isPortalDecorStale } from "../src/portal-decor/storage.js";

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
assert.equal(parseDeadline("Feb 30, 2026 11:59 PM IST").iso, null);
assert.equal(parseDeadline("Feb 28, 2026 12:00 AM IST").iso, "2026-02-28T00:00:00+05:30");
assert.equal(parseDeadline("Feb 28, 2026 12:00 PM IST").iso, "2026-02-28T12:00:00+05:30");
assert.equal(parseDeadline("Oct 11, 2026 11:59 PM PST").iso, null);
assert.equal(parseDeadline("Due Date Pending").iso, null);
assert.equal(parseDeadline("Oct 11, 2026").iso, null);

assert.equal(classifyByTitle("AQ 1.1 - Not Graded"), "practice");
assert.equal(classifyByTitle("Practice Assignment - 1"), "practice");
assert.equal(classifyByTitle("JavaScript Graded Assignment"), "graded");
assert.equal(classifyByTitle("PPA 1"), "unknown");
assert.equal(classifyByMode("Graded"), "graded");
assert.equal(classifyByMode("Practice"), "unknown");
assert.equal(effectiveClass("Graded", "Practice Assignment - 1"), "graded");
assert.equal(effectiveClass("", "AQ 1.1 - Not Graded"), "practice");

const course = "Sep 2026 - System Commands";
assert.equal(assignmentKey(course, "Week 1", "  JavaScript\nGraded Assignment  "), assignmentKey(course, " week 1 ", "JavaScript Graded Assignment"));
const now = new Date("2026-10-10T18:59:00.000Z");
assert.equal(relativeText("2026-10-10T19:58:00.000Z", now), "Due in under 1 hour");
assert.equal(relativeText("2026-10-10T19:59:00.000Z", now), "Due in 1 hours");
assert.equal(relativeText("2026-10-11T18:58:00.000Z", now), "Due in 23 hours");
assert.equal(relativeText("2026-10-11T18:59:00.000Z", now), "Due in 1 days");
assert.equal(relativeText("2026-10-10T18:58:59.000Z", now), "Past due");

let backing = {};
globalThis.chrome = {
  storage: {
    local: {
      get(_defaults, callback) { callback({ "acx:deadlines:v1": backing }); },
      set(value, callback) { backing = value["acx:deadlines:v1"]; callback?.(); },
      remove(_key, callback) { backing = {}; callback?.(); },
    },
  },
};
let tick = 1_700_000_000_000;
const store = createPortalDecorStore(() => tick);
await store.capture(course, "a", { mode: "unknown", modeRaw: "", deadlineIso: "2026-10-11T23:59:00+05:30", deadlineRaw: "x", source: "grades" });
tick += 1000;
await store.capture(course, "a", { mode: "graded", modeRaw: "Graded", deadlineIso: null, deadlineRaw: "Due Date Pending", source: "start" });
const saved = await store.get(course, "a");
assert.equal(saved.mode, "graded");
assert.equal(saved.deadlineIso, null);
assert.equal(isPortalDecorStale({ capturedAt: tick - 25 * 60 * 60 * 1000 }, tick), true);
assert.equal(isPortalDecorStale({ capturedAt: tick - 2 * 60 * 60 * 1000 }, tick), false);
await store.clear();
assert.deepEqual(backing, {});

for (let i = 0; i < 505; i++) {
  backing.a ||= {};
  backing.a[`key-${i}`] = { capturedAt: tick + i, deadlineIso: null };
}
assert.equal(Object.keys(await store.getAll()).length, 1);
assert.equal(Object.keys((await store.getAll()).a).length, 500);
backing.a.old = { capturedAt: tick - 121 * 24 * 60 * 60 * 1000, deadlineIso: null };
assert.equal((await store.getAll()).a.old, undefined);

globalThis.chrome.storage.local.get = () => { throw new Error("storage unavailable"); };
globalThis.chrome.storage.local.set = () => { throw new Error("storage unavailable"); };
const fallback = createPortalDecorStore(() => tick);
await fallback.capture(course, "fallback", { source: "grades", deadlineIso: null, deadlineRaw: "" });
assert.equal((await fallback.get(course, "fallback")).source, "grades");

console.log("✓ Portal decor core and storage tests passed");
