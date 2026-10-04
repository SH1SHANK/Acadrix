#!/usr/bin/env node
/**
 * Comprehensive test suite for Acadrix Extension Popup, Settings Migration,
 * Active Page Status Probe, and Runtime Handshake.
 */

import { readFileSync } from "node:fs";
import vm from "node:vm";

let passed = true;

function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed");
}

async function check(desc, fn) {
  try {
    await fn();
    console.log(`✓ ${desc}`);
  } catch (error) {
    passed = false;
    console.error(`❌ ${desc}: ${error.message}`);
  }
}

// ── Mock Chrome Storage Implementation ───────────────────────────────────────
function createMockStore(initialData = {}) {
  const store = { ...initialData };
  let getCalls = 0;
  let setCalls = 0;
  let removeCalls = 0;
  const setLog = [];
  const removeLog = [];

  return {
    data: store,
    getStats: () => ({ getCalls, setCalls, removeCalls, setLog, removeLog }),
    get(keys, callback) {
      getCalls++;
      if (!keys) {
        callback({ ...store });
      } else if (typeof keys === "string") {
        callback({ [keys]: store[keys] });
      } else if (Array.isArray(keys)) {
        const res = {};
        for (const k of keys) if (k in store) res[k] = store[k];
        callback(res);
      } else if (typeof keys === "object") {
        const res = { ...keys };
        for (const k of Object.keys(keys)) {
          if (k in store) res[k] = store[k];
        }
        callback(res);
      }
    },
    set(items, callback) {
      setCalls++;
      setLog.push({ ...items });
      Object.assign(store, items);
      if (typeof callback === "function") callback();
    },
    remove(keys, callback) {
      removeCalls++;
      const arr = Array.isArray(keys) ? keys : [keys];
      removeLog.push([...arr]);
      for (const k of arr) delete store[k];
      if (typeof callback === "function") callback();
    },
  };
}

// ── 1. Settings Migration Tests ───────────────────────────────────────────────
const backgroundSource = readFileSync("extension/background.js", "utf8");
const bgContext = {
  console,
  chrome: { runtime: { onInstalled: { addListener() {} } } },
  globalThis: {},
};
vm.runInNewContext(backgroundSource, bgContext);
const migrateSettings = bgContext.globalThis.__acadrixMigrateSettings;

await check("Migration: fresh install populates all required defaults with single write cycle", async () => {
  const store = createMockStore({});
  await new Promise((resolve) => migrateSettings(store, resolve));

  const stats = store.getStats();
  assert(stats.setCalls === 1, "Must perform exactly 1 set call on empty store");
  assert(stats.removeCalls === 0, "Must perform 0 remove calls on empty store");
  assert(store.data.theme === "system", "theme default must be system");
  assert(store.data.compact === false, "compact default must be false");
  assert(store.data.readerTextSize === "default", "readerTextSize default must be default");
  assert(store.data.highlightDeadlines === true, "highlightDeadlines default must be true");
  assert(store.data.directPdfEnabled === true, "directPdfEnabled default must be true");
  assert(store.data.openShortcut === "Alt+Q", "openShortcut default must be Alt+Q");
  assert(store.data.openShortcutEnabled === true, "openShortcutEnabled default must be true");
  assert(store.data.portalFont === "default", "portalFont default must be default");
});

await check("Migration: steady-state executes ZERO storage writes and ZERO deletes", async () => {
  const store = createMockStore({
    theme: "dark",
    compact: true,
    readerTextSize: "large",
    highlightDeadlines: false,
    directPdfEnabled: true,
    openShortcut: "Alt+S",
    openShortcutEnabled: true,
    portalFont: "satoshi",
  });

  await new Promise((resolve) => migrateSettings(store, resolve));
  const stats = store.getStats();
  assert(stats.getCalls === 1, "Must check store once");
  assert(stats.setCalls === 0, "Steady-state must perform ZERO set calls");
  assert(stats.removeCalls === 0, "Steady-state must perform ZERO remove calls");
  assert(store.data.theme === "dark", "Existing values must be preserved");
  assert(store.data.portalFont === "satoshi", "Existing portalFont must be preserved");
});

await check("Migration: removes legacy hide toggles and maps Satoshi fontName", async () => {
  const store = createMockStore({
    hideBreadcrumb: true,
    hideBanner: false,
    hideSidebar: true,
    fontName: "Satoshi Variable",
    shortcut: "Alt+X",
  });

  await new Promise((resolve) => migrateSettings(store, resolve));
  assert(!("hideBreadcrumb" in store.data), "hideBreadcrumb must be deleted");
  assert(!("hideBanner" in store.data), "hideBanner must be deleted");
  assert(!("hideSidebar" in store.data), "hideSidebar must be deleted");
  assert(!("fontName" in store.data), "fontName must be deleted");
  assert(store.data.portalFont === "satoshi", "Satoshi Variable fontName must map to satoshi");
  assert(store.data.openShortcut === "Alt+X", "Legacy shortcut must migrate to openShortcut");
  assert(store.data.openShortcutEnabled === true, "Derived openShortcutEnabled must be true for non-empty shortcut");
});

await check("Migration: maps unknown fontName to default and disables empty shortcut", async () => {
  const store = createMockStore({
    fontName: "Comic Sans MS",
    openShortcut: "",
    openShortcutEnabled: false,
  });

  await new Promise((resolve) => migrateSettings(store, resolve));
  assert(store.data.portalFont === "default", "Unknown fontName must map to default");
  assert(store.data.openShortcut === "", "Empty openShortcut must remain empty");
  assert(store.data.openShortcutEnabled === false, "openShortcutEnabled must remain false");
});

await check("Migration: derives openShortcutEnabled correctly from legacy openShortcutEnabled: false", async () => {
  const store = createMockStore({
    shortcut: "Alt+Q",
    openShortcutEnabled: false,
  });

  await new Promise((resolve) => migrateSettings(store, resolve));
  assert(store.data.openShortcut === "", "When openShortcutEnabled was false, openShortcut must become empty");
  assert(store.data.openShortcutEnabled === false, "Derived openShortcutEnabled must be false");
});

// ── 2. Popup UI & Active Tab Status Probe Simulation ─────────────────────────
function makeElement(tag = "div", attrs = {}) {
  return {
    tagName: tag.toUpperCase(),
    disabled: Boolean(attrs.disabled),
    textContent: attrs.textContent || "",
    value: attrs.value || "",
    checked: Boolean(attrs.checked),
    hidden: Boolean(attrs.hidden),
    href: attrs.href || "",
    dataset: { ...attrs.dataset },
    attributes: new Map(),
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); },
      toggle(c, force) {
        if (force === undefined) {
          if (this._classes.has(c)) this._classes.delete(c);
          else this._classes.add(c);
        } else if (force) this._classes.add(c);
        else this._classes.delete(c);
      },
    },
    setAttribute(k, v) { this.attributes.set(k, String(v)); },
    getAttribute(k) { return this.attributes.get(k) || null; },
    removeAttribute(k) { this.attributes.delete(k); },
    hasAttribute(k) { return this.attributes.has(k); },
    addEventListener(type, listener) {
      this.listeners ??= {};
      this.listeners[type] = listener;
    },
    click() {
      if (this.listeners?.click) this.listeners.click({ target: this, preventDefault() {}, stopPropagation() {} });
    },
    contains(other) { return this === other; },
    closest() { return { remove() {} }; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

async function setupPopupEnvironment({ tabUrl = "https://study.iitm.ac.in/quiz/1", probeResult = null, tabVersion = "0.2.0" }) {
  const elements = new Map([
    ["open", makeElement("button", { textContent: "Open Reader", disabled: true })],
    ["openStatus", makeElement("div", { textContent: "Checking page status..." })],
    ["shortcut", makeElement("button", { textContent: "Alt+Q" })],
    ["shortcutClear", makeElement("button", { textContent: "Clear" })],
    ["headMenuToggle", makeElement("button")],
    ["headMenu", makeElement("div", { hidden: true })],
    ["ver", makeElement("span")],
    ["repo", makeElement("a", { hidden: true })],
    ["clearDeadlines", makeElement("button", { textContent: "Clear" })],
  ]);

  const checkboxes = [
    makeElement("input", { dataset: { key: "compact" }, checked: false }),
    makeElement("input", { dataset: { key: "highlightDeadlines" }, checked: true }),
    makeElement("input", { dataset: { key: "directPdfEnabled" }, checked: true }),
  ];

  const selects = [
    makeElement("select", { dataset: { key: "theme" }, value: "system" }),
    makeElement("select", { dataset: { key: "readerTextSize" }, value: "default" }),
    makeElement("select", { dataset: { key: "portalFont" }, value: "default" }),
  ];

  const store = createMockStore({
    theme: "system",
    compact: false,
    readerTextSize: "default",
    highlightDeadlines: true,
    directPdfEnabled: true,
    openShortcut: "Alt+Q",
    openShortcutEnabled: true,
    portalFont: "default",
  });

  const storageListeners = [];
  const scriptCalls = [];
  let openCalls = 0;
  let destroyCalls = 0;

  const pageWindow = {
    __saqVersion: tabVersion,
    __saqOpen: () => { openCalls++; },
    __unfold: {
      destroy: () => { destroyCalls++; },
      portal: { detectAssessment: () => Boolean(probeResult?.assessment) },
      reader: { isOpen: () => Boolean(probeResult?.readerOpen) },
    },
    __saqStatus: () => probeResult || { assessment: false, readerOpen: false },
    close() {},
    addEventListener() {},
    removeEventListener() {},
  };

  const context = {
    console,
    URL,
    setTimeout,
    clearTimeout,
    window: pageWindow,
    document: {
      getElementById(id) { return elements.get(id) || null; },
      querySelectorAll(selector) {
        if (selector.includes("input[type=checkbox]")) return checkboxes;
        if (selector.includes("select")) return selects;
        return [];
      },
      querySelector(selector) {
        if (selector.includes('select[data-key="theme"]')) return selects[0];
        if (selector.includes('input[data-key="compact"]')) return checkboxes[0];
        if (selector.includes('select[data-key="readerTextSize"]')) return selects[1];
        if (selector.includes('input[data-key="highlightDeadlines"]')) return checkboxes[1];
        if (selector.includes('input[data-key="directPdfEnabled"]')) return checkboxes[2];
        if (selector.includes('select[data-key="portalFont"]')) return selects[2];
        return null;
      },
      documentElement: {
        attributes: new Map(),
        setAttribute(k, v) { this.attributes.set(k, v); },
        removeAttribute(k) { this.attributes.delete(k); },
      },
    },
    chrome: {
      runtime: { getManifest: () => ({ version: "0.2.0", homepage_url: "https://github.com/acadrix" }) },
      tabs: { query: async () => [{ id: 42, url: tabUrl }] },
      storage: {
        local: store,
        onChanged: {
          addListener(fn) { storageListeners.push(fn); },
        },
      },
      scripting: {
        executeScript: async (details) => {
          if (details.files) {
            scriptCalls.push(`inject:${details.files.join(",")}`);
            pageWindow.__saqVersion = "0.2.0";
            return [{ result: undefined }];
          }
          scriptCalls.push("execute:function");
          const res = details.func.call(pageWindow);
          return [{ result: res }];
        },
      },
    },
  };

  const popupSource = readFileSync("extension/popup.js", "utf8");
  vm.runInNewContext(popupSource, context, { filename: "extension/popup.js" });

  // Allow async status probe & microtasks to run
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  return {
    elements,
    checkboxes,
    selects,
    store,
    storageListeners,
    scriptCalls,
    pageWindow,
    context,
    getOpenCalls: () => openCalls,
    getDestroyCalls: () => destroyCalls,
  };
}

// ── Status Probe Tests ───────────────────────────────────────────────────────
await check("Status Probe: non-quiz host disables Open button and shows 'Not on an assessment page'", async () => {
  const env = await setupPopupEnvironment({ tabUrl: "https://google.com/search" });
  const openBtn = env.elements.get("open");
  const openStatus = env.elements.get("openStatus");
  assert(openBtn.disabled === true, "Open button must be disabled on non-quiz URL");
  assert(openBtn.textContent === "Open Reader", "Open button text must be 'Open Reader'");
  assert(openStatus.textContent === "Not on an assessment page", "Status must indicate non-assessment page");
});

await check("Status Probe: quiz host with no assessment active disables Open button", async () => {
  const env = await setupPopupEnvironment({
    tabUrl: "https://study.iitm.ac.in/courses/math1",
    probeResult: { assessment: false, readerOpen: false },
  });
  const openBtn = env.elements.get("open");
  const openStatus = env.elements.get("openStatus");
  assert(openBtn.disabled === true, "Open button must be disabled when no assessment is active");
  assert(openStatus.textContent === "Not on an assessment page", "Status must be 'Not on an assessment page'");
});

await check("Status Probe: quiz host with assessment detected enables Open button and shows 'Assessment ready'", async () => {
  const env = await setupPopupEnvironment({
    tabUrl: "https://study.iitm.ac.in/quiz/assignment-4",
    probeResult: { assessment: true, readerOpen: false },
  });
  const openBtn = env.elements.get("open");
  const openStatus = env.elements.get("openStatus");
  assert(openBtn.disabled === false, "Open button must be enabled when assessment is detected");
  assert(openBtn.textContent === "Open Reader", "Open button text must be 'Open Reader'");
  assert(openStatus.textContent === "Assessment ready", "Status must indicate 'Assessment ready'");
});

await check("Status Probe: quiz host with Reader already open shows 'Focus Reader' and 'Reader is open'", async () => {
  const env = await setupPopupEnvironment({
    tabUrl: "https://study.iitm.ac.in/quiz/assignment-4",
    probeResult: { assessment: true, readerOpen: true },
  });
  const openBtn = env.elements.get("open");
  const openStatus = env.elements.get("openStatus");
  assert(openBtn.disabled === false, "Open button must be enabled when Reader is open");
  assert(openBtn.textContent === "Focus Reader", "Open button text must change to 'Focus Reader'");
  assert(openStatus.textContent === "Reader is open", "Status must indicate 'Reader is open'");
});

// ── Injected-Runtime Handshake Tests ─────────────────────────────────────────
await check("Handshake: matching runtime version opens directly without reinjection", async () => {
  const env = await setupPopupEnvironment({
    tabVersion: "0.2.0",
    probeResult: { assessment: true, readerOpen: false },
  });
  env.elements.get("open").click();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert(env.getOpenCalls() === 1, "Must open runtime exactly once");
  assert(env.getDestroyCalls() === 0, "Must not destroy matching runtime");
  assert(!env.scriptCalls.includes("inject:run.js"), "Must not reinject run.js");
});

await check("Handshake: mismatched runtime version is destroyed and reinjected", async () => {
  const env = await setupPopupEnvironment({
    tabVersion: "0.1.0",
    probeResult: { assessment: true, readerOpen: false },
  });
  env.elements.get("open").click();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert(env.getDestroyCalls() === 1, "Must destroy stale runtime");
  assert(env.scriptCalls.includes("inject:run.js"), "Must inject run.js");
  assert(env.getOpenCalls() === 1, "Must open new runtime");
});

// ── UI Interaction & Storage Event Tests ─────────────────────────────────────
await check("UI Interactions: clear deadlines button triggers store.remove for acx:deadlines:v1", async () => {
  const env = await setupPopupEnvironment({});
  const clearBtn = env.elements.get("clearDeadlines");
  clearBtn.click();
  const stats = env.store.getStats();
  assert(stats.removeCalls === 1, "Must call store.remove on Clear click");
  assert(stats.removeLog[0].includes("acx:deadlines:v1"), "Must remove acx:deadlines:v1 key");
});

await check("UI Interactions: storage.onChanged event dynamically updates popup controls", async () => {
  const env = await setupPopupEnvironment({});
  const listener = env.storageListeners[0];
  assert(typeof listener === "function", "Storage change listener must be registered");

  listener({
    compact: { newValue: true },
    theme: { newValue: "dark" },
    readerTextSize: { newValue: "large" },
    highlightDeadlines: { newValue: false },
    directPdfEnabled: { newValue: false },
    portalFont: { newValue: "satoshi" },
    openShortcut: { newValue: "Ctrl+Shift+K" },
  }, "local");

  assert(env.checkboxes[0].checked === true, "compact toggle must reflect changed value");
  assert(env.selects[0].value === "dark", "theme select must reflect dark");
  assert(env.context.document.documentElement.attributes.get("data-theme") === "dark", "documentElement must have data-theme='dark'");
  assert(env.selects[1].value === "large", "textSize select must reflect large");
  assert(env.checkboxes[1].checked === false, "highlightDeadlines toggle must reflect false");
  assert(env.checkboxes[2].checked === false, "directPdfEnabled toggle must reflect false");
  assert(env.selects[2].value === "satoshi", "portalFont select must reflect satoshi");
  assert(env.elements.get("shortcut").textContent === "Ctrl+Shift+K", "shortcut button must reflect new keys");
});

if (!passed) {
  console.error("\nPopup runtime regression tests FAILED.");
  process.exit(1);
} else {
  console.log("\nAll Popup Runtime, Migration & Probe tests passed successfully!\n");
}
