#!/usr/bin/env node
/** Regression tests for the extension popup's injected-runtime handshake. */

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

function makeElement() {
  return {
    disabled: false,
    textContent: "",
    hidden: true,
    href: "",
    classList: { toggle() {} },
    addEventListener(type, listener) {
      this.listeners ??= {};
      this.listeners[type] = listener;
    },
    closest() { return { remove() {} }; },
  };
}

async function runPopup({ tabVersion, hasOpen = true, hasDestroy = true, destroyThrows = false }) {
  const elements = new Map([
    ["open", makeElement()],
    ["shortcut", makeElement()],
    ["shortcutClear", makeElement()],
    ["shortcutEnabled", makeElement()],
    ["ver", makeElement()],
    ["repo", makeElement()],
  ]);
  elements.get("shortcutEnabled").checked = true;

  const calls = [];
  let openCalls = 0;
  let destroyCalls = 0;
  const pageWindow = {
    __saqVersion: tabVersion,
    __saqOpen: hasOpen ? () => { openCalls++; } : undefined,
    __unfold: hasDestroy ? {
      destroy: () => {
        destroyCalls++;
        if (destroyThrows) throw new Error("stale runtime");
      },
    } : undefined,
    close() { calls.push("window.close"); },
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
      getElementById(id) { return elements.get(id) || makeElement(); },
      querySelectorAll() { return []; },
    },
    chrome: {
      runtime: { getManifest: () => ({ version: "0.2.0", homepage_url: "" }) },
      tabs: { query: async () => [{ id: 7, url: "https://study.iitm.ac.in/quiz/1" }] },
      storage: {
        local: { get(_defaults, callback) { callback({}); }, set() {} },
        onChanged: { addListener() {} },
      },
      scripting: {
        executeScript: async (details) => {
          if (details.files) {
            calls.push(`inject:${details.files.join(",")}`);
            pageWindow.__saqVersion = "0.2.0";
            pageWindow.__saqOpen = () => { openCalls++; };
            return [{ result: undefined }];
          }
          calls.push("execute:function");
          const result = details.func.call(pageWindow);
          return [{ result }];
        },
      },
    },
  };
  context.document.documentElement = {
    setAttribute() {},
    removeAttribute() {},
  };

  const source = await import("node:fs").then(({ readFileSync }) => readFileSync("extension/popup.js", "utf8"));
  const vm = await import("node:vm");
  vm.runInNewContext(source, context, { filename: "extension/popup.js" });
  elements.get("open").listeners.click();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return { calls, openCalls, destroyCalls };
}

await check("matching runtime version reuses the existing runtime", async () => {
  const result = await runPopup({ tabVersion: "0.2.0" });
  assert(result.openCalls === 1, "matching runtime must open exactly once");
  assert(result.destroyCalls === 0, "matching runtime must not be destroyed");
  assert(!result.calls.includes("inject:run.js"), "matching runtime must not reinject");
});

await check("mismatched runtime is destroyed before reinjection", async () => {
  const result = await runPopup({ tabVersion: "0.1.0" });
  assert(result.destroyCalls === 1, "mismatched runtime must be destroyed once");
  assert(result.calls.includes("inject:run.js"), "mismatched runtime must reinject run.js");
  assert(result.openCalls === 1, "reloaded runtime must open exactly once");
});

await check("missing version reinjects and opens exactly once", async () => {
  const result = await runPopup({ tabVersion: undefined });
  assert(result.destroyCalls === 0, "missing version must not assume a destroy handle");
  assert(result.calls.includes("inject:run.js"), "missing version must reinject run.js");
  assert(result.openCalls === 1, "reloaded runtime must open exactly once");
});

await check("destroy failures do not prevent reinjection", async () => {
  const result = await runPopup({ tabVersion: "0.1.0", destroyThrows: true });
  assert(result.destroyCalls === 1, "stale destroy must be attempted once");
  assert(result.calls.includes("inject:run.js"), "destroy failure must still reinject run.js");
  assert(result.openCalls === 1, "reloaded runtime must open exactly once");
});

if (!passed) process.exit(1);
