/* Restyle the IITM portal via reversible CSS — injects font overrides when enabled.
   Storage-driven, so popup toggles are live. Quiz answering/timer/submit untouched. */
(() => {
  "use strict";
  const store = (() => { try { return chrome.storage?.local; } catch { return null; } })();
  if (!store) return; // not in the extension (e.g. bookmarklet) — nothing to do

  // Portal font: applies Satoshi Variable to the portal when portalFont === "satoshi".
  const satoshiFontRule = `
    body, body *:not(mat-icon):not(.material-icons):not([class*="app-icon"]):not(.icon-container):not(i):not(code):not(pre):not(kbd):not(samp):not(.ace_editor):not(.ace_editor *):not(.hljs):not(.hljs *) {
      font-family: "Satoshi Variable", "Satoshi", system-ui, sans-serif !important;
    }
    /* code stays monospace: the Ace editor and highlight.js (.hljs) blocks are
       excluded above; re-assert for plain semantic code tags too. */
    body code, body pre, body kbd, body samp, body tt {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important;
    }
    body pre *, body code * { font-family: inherit !important; }`;

  const setStyle = (id, css) => {
    let el = document.getElementById(id);
    if (css) {
      if (!el) {
        el = document.createElement("style");
        el.id = id;
        (document.head || document.documentElement).appendChild(el);
      }
      el.textContent = css;
    } else if (el) {
      el.remove();
    }
  };

  const applyFont = (portalFont, isEnabled) => {
    setStyle("saq-cz-font", isEnabled && portalFont === "satoshi" ? satoshiFontRule : "");
  };

  const defaults = { enabled: true, portalFont: "default" };
  let enabled = true;
  let currentFont = "default";

  store.get(defaults, (v) => {
    enabled = v.enabled ?? true;
    currentFont = v.portalFont || "default";
    applyFont(currentFont, enabled);
  });

  chrome.storage.onChanged?.addListener((c) => {
    let changed = false;
    if (c.enabled) {
      enabled = c.enabled.newValue ?? true;
      changed = true;
    }
    if (c.portalFont) {
      currentFont = c.portalFont.newValue || "default";
      changed = true;
    }
    if (changed) {
      applyFont(currentFont, enabled);
    }
  });
})();
