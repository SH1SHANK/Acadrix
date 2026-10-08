/**
 * Acadrix — Main Content Entry Point.
 * 
 * Assembles and launches the Acadrix runtime.
 * Provides backwards-compatible handles for toolbar popup and bookmarklet execution.
 */

import { AcadrixRuntime, UnfoldRuntime } from "./core/runtime.js";

// __CSS__ placeholder will be inlined by build.mjs
const CSS = typeof __CSS__ !== "undefined" ? __CSS__ : "";

(() => {
  "use strict";

  // Prevent duplicate execution
  if (window.__acadrix || window.__unfold) {
    (window.__acadrix || window.__unfold).detect();
    return;
  }

  const runtime = new AcadrixRuntime({ css: CSS });
  window.__acadrix = runtime;
  window.__unfold = runtime;

  // Primary manual open handle
  window.__acadrixOpen = () => runtime.open();
  window.__unfoldOpen = window.__acadrixOpen;

  // Backwards compatibility alias for popup.js and existing scripts
  window.__saqOpen = window.__acadrixOpen;

  /* @extension-only-start */
  window.__saqStatus = () => ({
    assessment: Boolean(runtime.portal?.detectAssessment?.()),
    readerOpen: Boolean(runtime.reader?.isOpen?.()),
  });
  /* @extension-only-end */

  runtime.initialize();

  // If invoked via bookmarklet in the page execution world, auto-open if quiz is present
  let isExtensionBundle = false;
  /* @extension-only-start */
  isExtensionBundle = true;
  /* @extension-only-end */

  if (!isExtensionBundle && runtime.portal.detectAssessment()) {
    runtime.open();
  }
})();
