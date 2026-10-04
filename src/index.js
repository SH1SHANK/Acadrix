/**
 * Unfold IITM — Main Content Entry Point.
 * 
 * Assembles and launches the Unfold runtime.
 * Provides backwards-compatible handles for toolbar popup and bookmarklet execution.
 */

import { UnfoldRuntime } from "./core/runtime.js";

// __CSS__ placeholder will be inlined by build.mjs
const CSS = typeof __CSS__ !== "undefined" ? __CSS__ : "";

(() => {
  "use strict";

  // Prevent duplicate execution
  if (window.__unfold) {
    window.__unfold.detect();
    return;
  }

  const runtime = new UnfoldRuntime({ css: CSS });
  window.__unfold = runtime;

  // Primary manual open handle
  window.__unfoldOpen = () => runtime.open();

  // Backwards compatibility alias for popup.js and existing scripts
  window.__saqOpen = window.__unfoldOpen;

  runtime.initialize();

  // If invoked via bookmarklet in the page execution world, auto-open if quiz is present
  const inExtension = (() => {
    try {
      return Boolean(typeof chrome !== "undefined" && chrome?.runtime?.id);
    } catch {
      return false;
    }
  })();

  if (!inExtension && runtime.portal.detectAssessment()) {
    runtime.open();
  }
})();
