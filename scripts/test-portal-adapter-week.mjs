#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import { IitmPortalAdapter } from "../src/portal/adapter.js";
import { buildExportFilename } from "../src/model/document.js";

const fixture = fs.readFileSync("fixtures/portal-decor/course-page-mad2-in-progress.html", "utf8");
for (const marker of [
  'class="top-bar-title">Sep 2026 - MAD II',
  'class="side-nav-title',
  'class="breadcrumb-item current',
  'class="child-row ng-star-inserted selected"',
  'class="title size-small',
]) assert.match(fixture, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

class MockNode {
  constructor(text = "", parent = null) { this.textContent = text; this.parent = parent; }
  closest(selector) { return selector === ".unit-container" ? this.parent : null; }
  querySelector(selector) {
    if (selector === ".unit-title") return { textContent: "Week 1" };
    return null;
  }
}

function makeDocument({ breadcrumb = "Week 1", selected = true, title = "Week 1 - Graded Assignment 1" } = {}) {
  const unit = new MockNode();
  const child = selected ? new MockNode("", unit) : null;
  return {
    querySelector(selector) {
      if (selector === "nav.breadcrumb .breadcrumb-item.current") return breadcrumb ? { textContent: breadcrumb } : null;
      if (selector === ".child-row.selected") return child;
      if (selector.includes("h1.title")) return { textContent: title };
      return null;
    },
    querySelectorAll(selector) {
      if (selector.includes("h1.title")) return [{ textContent: title, closest: () => null }];
      return [];
    },
  };
}

const adapter = new IitmPortalAdapter(makeDocument());
assert.equal(adapter.getAssessmentWeek(), "Week 1");
assert.equal(buildExportFilename({ course: "Sep 2026 - MAD II", title: "Week 1 - Graded Assignment 1", week: adapter.getAssessmentWeek() }, "pdf"), "MAD II - Week 01 - GA 1.pdf");

assert.equal(new IitmPortalAdapter(makeDocument({ breadcrumb: "", selected: true, title: "GrPA 2" })).getAssessmentWeek(), "Week 1");
assert.equal(new IitmPortalAdapter(makeDocument({ breadcrumb: "", selected: false, title: "Week 1 - Graded Assignment 1" })).getAssessmentWeek(), "Week 1");
assert.equal(buildExportFilename({ course: "Sep 2026 - MAD II", title: "JavaScript Graded Assignment - Simple and Compound Interest", week: "Week 1" }, "pdf"), "MAD II - Week 01 - GA.pdf");

console.log("✓ Portal adapter real-selector week tests passed");
