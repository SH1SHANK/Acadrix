#!/usr/bin/env node
import assert from "node:assert/strict";
import { IitmPortalAdapter } from "../src/portal/adapter.js";
import { IITM_SELECTORS } from "../src/portal/selectors.js";
import { GradedAssignmentNavigation } from "../src/portal/assignment-navigation.js";

class TestElement {
  constructor(tagName = "div", text = "") {
    this.tagName = tagName.toUpperCase();
    this.className = "";
    this.classList = {
      remove: (...names) => {
        this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(" ");
      },
    };
    this.attributes = new Map();
    this.style = {};
    this.children = [];
    this.parentNode = null;
    this.disabled = false;
    this._text = text;
    this.listeners = new Map();
    this.clickCount = 0;
  }

  get parentElement() { return this.parentNode; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.children;
    return siblings[siblings.indexOf(this) + 1] || null;
  }
  get textContent() { return this.children.length ? this.children.map((child) => child.textContent).join("") : this._text; }
  set textContent(value) { this._text = String(value); this.replaceChildren(); }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  hasAttribute(name) { return this.attributes.has(name); }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  insertBefore(child, before) {
    const index = this.children.indexOf(before);
    child.parentNode = this;
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }
  replaceChildren(...children) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    for (const child of children) this.appendChild(child);
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }
  querySelector(selector) {
    if (selector === ".child-title") return this.children.find((child) => child.className === "child-title") || null;
    if (selector.includes("btn-secondary")) return this.children.find((child) => child.className.includes("btn-secondary")) || null;
    return null;
  }
  querySelectorAll(selector) {
    if (selector.includes("data-acx-graded") || selector.includes("data-acx-mode")) return this.gradedRows;
    return [];
  }
  cloneNode(deep = false) {
    const clone = new TestElement(this.tagName, this._text);
    clone.className = this.className;
    clone.style = { ...this.style };
    clone.disabled = this.disabled;
    for (const [name, value] of this.attributes) clone.attributes.set(name, value);
    if (deep) for (const child of this.children) clone.appendChild(child.cloneNode(true));
    return clone;
  }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }
  click() {
    this.clickCount += 1;
    for (const callback of this.listeners.get("click") || []) {
      callback({ preventDefault() {} });
    }
  }
}

function makeRow(title, { selected = false, graded = true } = {}) {
  const row = new TestElement("button");
  row.className = `child-row${selected ? " selected" : ""}`;
  row.setAttribute("type", "button");
  if (graded) row.setAttribute("data-acx-graded", "true");
  const titleElement = new TestElement("div", title);
  titleElement.className = "child-title";
  row.appendChild(titleElement);
  return row;
}

const weeklyGraded = makeRow("Week 1 Graded Assignment - 1");
const grpa1 = makeRow("GrPA 1", { selected: true });
const grpa2 = makeRow("GrPA 2");
const practice = makeRow("Week 1 Practice Assignment", { graded: false });
let selectedRow = grpa1;
const sidebar = new TestElement("aside");
sidebar.gradedRows = [weeklyGraded, grpa1, grpa2];
sidebar.querySelector = (selector) => selector.includes("child-row.selected") ? selectedRow : null;

const main = new TestElement("main");
const assessmentView = new TestElement("app-assessment-question-view");
const portalSecondaryButton = new TestElement("button");
portalSecondaryButton.className = "btn btn-secondary btn-shape-box btn-size-small btn-icon-only";
portalSecondaryButton.setAttribute("aria-label", "Back to start page");
portalSecondaryButton.setAttribute("style", "width: 35px; height: 35px;");
assessmentView.appendChild(portalSecondaryButton);
main.appendChild(assessmentView);
const doc = {
  createElement: (tagName) => new TestElement(tagName),
  querySelector(selector) {
    if (selector === IITM_SELECTORS.decor.sidebarContainer) return sidebar;
    if (selector === IITM_SELECTORS.assessment.view) return assessmentView;
    return null;
  },
  querySelectorAll() { return []; },
};
const adapter = new IitmPortalAdapter(doc);

const state = adapter.getGradedAssignmentNavigation();
assert.equal(state.current.title, "GrPA 1");
assert.equal(state.previous.title, "Week 1 Graded Assignment - 1");
assert.equal(state.next.title, "GrPA 2");
assert.equal(adapter.navigateGradedAssignment("next"), true);
assert.equal(grpa2.clickCount, 1, "navigation should activate the real portal row");
assert.equal(adapter.navigateGradedAssignment("unknown"), false);

selectedRow = practice;
assert.equal(adapter.getGradedAssignmentNavigation(), null, "practice assignments must not get graded navigation");
selectedRow = grpa1;

const navigation = new GradedAssignmentNavigation(adapter);
assert.equal(navigation.update(), true);
const nav = main.children[0];
assert.equal(nav.getAttribute("aria-label"), "Graded assignment navigation");
assert.equal(nav.getAttribute("data-acx-assignment-navigation"), "true");
assert.equal(nav.children.length, 2);
assert.ok(nav.children.every((button) => button.className.includes("btn-secondary")), "controls inherit the portal's native secondary button class");
assert.ok(nav.children.every((button) => !button.className.includes("btn-icon-only")), "navigation controls show their text labels");
assert.ok(nav.children.every((button) => !button.hasAttribute("style")), "navigation controls do not keep the icon button's fixed inline dimensions");
assert.ok(nav.children.every((button) => button.getAttribute("type") === "button"), "navigation controls are explicit buttons");
assert.match(nav.children[0].textContent, /Previous: Week 1 Graded Assignment - 1/);
assert.match(nav.children[1].textContent, /Next: GrPA 2/);
assert.equal(nav.children[0].getAttribute("aria-label"), "Previous graded assignment: Week 1 Graded Assignment - 1");
assert.equal(nav.children[1].getAttribute("aria-label"), "Next graded assignment: GrPA 2");
assert.equal(navigation.update(), true);
assert.equal(main.children.filter((child) => child.getAttribute?.("data-acx-assignment-navigation")).length, 1, "updates must not duplicate the control row");
nav.children[0].click();
assert.equal(weeklyGraded.clickCount, 1);

selectedRow = weeklyGraded;
assert.equal(navigation.update(), true);
const firstAssignmentNav = main.children[0];
assert.equal(firstAssignmentNav.children[0].disabled, true, "previous is disabled at the first graded assignment");
assert.equal(firstAssignmentNav.children[1].disabled, false);

navigation.destroy();
assert.equal(main.children.includes(firstAssignmentNav), false, "destroy removes injected portal controls");
console.log("✓ Graded assignment navigation adapter and controls passed");
