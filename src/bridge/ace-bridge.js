/**
 * IITM Programming Assignment Ace Editor Integration Adapter.
 * 
 * Provides an authoritative, event-driven adapter layer between Acadrix and the
 * IITM programming-assignment Ace editor instance.
 * 
 * Reverse-Engineered IITM Editor Contract:
 * - IITM editor hierarchy: app-pa-code-editor -> app-code-editor -> Ace editor.
 * - IITM manages the document as: prefixCode + mainContent + suffixCode.
 * - Protected scaffold regions are marked with `readonly_line` front markers.
 * - In Chrome Extension MV3, Ace executes in the Page Main World, while Acadrix
 *   runs in an Isolated World. The Main-World Bridge safely bridges this boundary
 *   using versioned, structured, serializable CustomEvents.
 * 
 * Invariants Enforced:
 * - Mutates ONLY the resolved editable main-content range via session.replace().
 * - NEVER calls editor.setValue() or session.setValue() (which alter prefix/suffix).
 * - NEVER bypasses or monkey-patches IITM's readonly guard or UndoManager.
 * - getCode() extracts and returns ONLY the student's editable code (never scaffold).
 * - Single-step bounded post-write verification ensuring prefix/suffix integrity.
 * - Zero polling loops, zero retry loops, zero interval watchers.
 * - Dispatches natural DOM input/change events for Angular NgModel / FormControl synchronization.
 * - First-class support for Bash, SQL, Python, Java, JavaScript.
 */

import { $, $$ } from "../utils/dom.js";
import { IITM_SELECTORS } from "../portal/selectors.js";
import {
  normalizeProgrammingLanguage,
  getLanguageMetadata,
  isLanguageCompatible,
} from "./languages.js";
import {
  initPageBridge,
  executePrivilegedWrite,
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_CHANNEL,
  BRIDGE_REQUEST_EVENT,
  BRIDGE_RESPONSE_EVENT,
} from "./page-bridge.js";
import {
  EditorNotReadyError,
  EditorBoundaryError,
  EditorIdentityChangedError,
  QuestionIdentityChangedError,
  EditorWriteVerificationError,
} from "../extraction/errors.js";

/**
 * Structured Error Codes for Programming Editor Operations.
 */
export const EditorErrorCode = Object.freeze({
  EDITOR_NOT_FOUND: "EDITOR_NOT_FOUND",
  EDITOR_NOT_READY: "EDITOR_NOT_READY",
  LANGUAGE_UNKNOWN: "LANGUAGE_UNKNOWN",
  MULTIPLE_EDITORS: "MULTIPLE_EDITORS",
  PROTECTED_REGION_UNKNOWN: "PROTECTED_REGION_UNKNOWN",
  EDITABLE_RANGE_INVALID: "EDITABLE_RANGE_INVALID",
  IMPORT_PARSE_FAILED: "IMPORT_PARSE_FAILED",
  LANGUAGE_MISMATCH: "LANGUAGE_MISMATCH",
  CODE_WRITE_FAILED: "CODE_WRITE_FAILED",
  CODE_WRITE_VERIFICATION_FAILED: "CODE_WRITE_VERIFICATION_FAILED",
  EDITOR_IDENTITY_CHANGED: "EDITOR_IDENTITY_CHANGED",
  QUESTION_IDENTITY_CHANGED: "QUESTION_IDENTITY_CHANGED",
  TEST_CASES_UNAVAILABLE: "TEST_CASES_UNAVAILABLE",
});

/**
 * Programming Editor Readiness States.
 */
export const EditorState = Object.freeze({
  UNKNOWN: "UNKNOWN",
  DETECTED: "DETECTED",
  READY: "READY",
  WRITING: "WRITING",
  VERIFYING: "VERIFYING",
  UNSUPPORTED: "UNSUPPORTED",
  ERROR: "ERROR",
});


/**
 * Student Code Synchronization States.
 */
export const CodeState = Object.freeze({
  UNAVAILABLE: "UNAVAILABLE",
  AVAILABLE: "AVAILABLE",
  MODIFIED: "MODIFIED",
  VERIFIED: "VERIFIED",
});

/**
 * Ensures the main-world bridge script is initialized on the target document.
 * 
 * @param {Document|null} [doc]
 * @returns {boolean}
 */
export function ensureMainWorldBridge(doc = typeof document !== "undefined" ? document : null) {
  if (!doc) return false;
  const win = doc.defaultView || (typeof window !== "undefined" ? window : globalThis);
  if (!win) return false;

  if (win.__ACADRIX_PAGE_BRIDGE_INITIALIZED__) {
    return true;
  }

  try {
    if (doc.head || doc.documentElement) {
      const script = doc.createElement("script");
      script.id = "acadrix-page-bridge-init";
      script.textContent = `(${initPageBridge.toString()})(window);`;
      (doc.head || doc.documentElement).appendChild(script);
      script.remove();
      return true;
    }
  } catch {
    // If inline script is restricted, initialize directly if in same world
    if (typeof initPageBridge === "function") {
      initPageBridge(win);
      return true;
    }
  }

  return false;
}

/**
 * Synchronously or asynchronously sends a request to the Main-World Bridge.
 * 
 * @param {string} operation
 * @param {object} [payload={}]
 * @param {Document|null} [doc=null]
 * @returns {object|null}
 */
export function requestMainWorldBridge(operation, payload = {}, doc = typeof document !== "undefined" ? document : null) {
  const win = doc?.defaultView || (typeof window !== "undefined" ? window : globalThis);
  if (!win || typeof win.dispatchEvent !== "function") {
    return null;
  }

  ensureMainWorldBridge(doc);

  const requestId = "req_" + Math.random().toString(36).slice(2, 11) + "_" + Date.now();
  let syncResponse = null;

  const handler = (evt) => {
    if (
      evt.detail &&
      evt.detail.source === "acadrix-page-bridge" &&
      evt.detail.channel === BRIDGE_CHANNEL &&
      evt.detail.version === BRIDGE_PROTOCOL_VERSION &&
      evt.detail.requestId === requestId
    ) {
      syncResponse = evt.detail;
    }
  };

  win.addEventListener(BRIDGE_RESPONSE_EVENT, handler, { once: true });

  try {
    win.dispatchEvent(
      new CustomEvent(BRIDGE_REQUEST_EVENT, {
        detail: {
          source: "acadrix",
          channel: BRIDGE_CHANNEL,
          version: BRIDGE_PROTOCOL_VERSION,
          requestId,
          operation,
          payload,
        },
      })
    );
  } finally {
    win.removeEventListener(BRIDGE_RESPONSE_EVENT, handler);
  }

  return syncResponse;
}

/**
 * Helper to construct an Ace Range instance when available or a structural range fallback.
 * 
 * @param {object} session Ace Editor Session
 * @param {{ row: number, column: number }} start
 * @param {{ row: number, column: number }} end
 * @returns {object} Ace Range or { start, end }
 */
export function createAceRange(session, start, end) {
  const RangeConstructor =
    session?.getSelection?.()?.getRange?.()?.constructor ||
    (typeof globalThis !== "undefined" && globalThis.ace?.Range) ||
    (typeof window !== "undefined" && window.ace?.Range) ||
    null;

  if (RangeConstructor) {
    try {
      return new RangeConstructor(start.row, start.column, end.row, end.column);
    } catch {
      // Fall through to plain object
    }
  }

  return {
    start: { row: start.row, column: start.column },
    end: { row: end.row, column: end.column },
  };
}

/**
 * Parses row indices covered by an Ace marker.
 * Handles both inclusive (end.column > 0) and exclusive (end.column === 0) row bounds.
 * 
 * @param {object} marker Ace Marker definition
 * @param {number} totalRows Total lines in Ace session
 * @returns {number[]} Array of covered 0-indexed row numbers
 */
export function getCoveredRowsFromMarker(marker, totalRows) {
  if (!marker?.range && marker?.startRow === undefined) return [];
  const range = marker.range;
  const startRow = Math.max(0, range?.start?.row ?? marker.startRow ?? 0);
  let endRow = Math.max(startRow, range?.end?.row ?? marker.endRow ?? startRow);
  const endCol = range?.end?.column ?? (marker.endRow !== undefined && !range ? 1 : 0);

  // In Ace: Range(0, 0, 2, 0) covers row 0 and row 1 (row 2 col 0 is exclusive boundary)
  if (endCol === 0 && endRow > startRow) {
    endRow = endRow - 1;
  }

  const rows = [];
  for (let r = startRow; r <= endRow; r++) {
    if (r < totalRows) rows.push(r);
  }
  return rows;
}

/**
 * Deterministically resolves the editable main-content range of an Ace session
 * based on IITM's `readonly_line` front markers.
 * 
 * @param {object} session Ace Editor Session
 * @returns {{
 *   range: { start: { row: number, column: number }, end: { row: number, column: number } },
 *   hasPrefix: boolean,
 *   hasSuffix: boolean,
 *   prefixRange: { start: { row: number, column: number }, end: { row: number, column: number } } | null,
 *   suffixRange: { start: { row: number, column: number }, end: { row: number, column: number } } | null,
 *   isGuarded: boolean,
 *   isAmbiguous: boolean
 * }}
 */
export function resolveEditableRange(session) {
  if (!session || typeof session.getLength !== "function") {
    return {
      range: { start: { row: 0, column: 0 }, end: { row: 0, column: 0 } },
      hasPrefix: false,
      hasSuffix: false,
      prefixRange: null,
      suffixRange: null,
      isGuarded: false,
      isAmbiguous: false,
    };
  }

  const totalRows = session.getLength();
  const getLastCol = (row) => {
    if (row < 0 || row >= totalRows) return 0;
    return typeof session.getLine === "function" ? (session.getLine(row) || "").length : 0;
  };

  // Discover readonly markers from front and regular markers
  const frontMarkers = (typeof session.getMarkers === "function" ? session.getMarkers(true) : null) || {};
  const backMarkers = (typeof session.getMarkers === "function" ? session.getMarkers(false) : null) || {};
  const defaultMarkers = (typeof session.getMarkers === "function" ? session.getMarkers() : null) || {};
  const rawFront = session.$frontMarkers || {};
  const rawBack = session.$backMarkers || {};
  const rawMarkers = session.markers || {};
  const allMarkers = {
    ...defaultMarkers,
    ...rawBack,
    ...backMarkers,
    ...rawFront,
    ...frontMarkers,
    ...rawMarkers,
  };

  const isReadonlyMarker = (m) => {
    if (!m) return false;
    const clazz = typeof m.clazz === "string" ? m.clazz : "";
    const type = typeof m.type === "string" ? m.type : "";
    return (
      /(readonly|read-only|protected|locked)/i.test(clazz) ||
      /(readonly|read-only|protected|locked)/i.test(type) ||
      Boolean(m.readonly || m.readOnly || m.isReadonly || m.isReadOnly)
    );
  };

  const readonlyMarkers = Object.values(allMarkers).filter(isReadonlyMarker);

  // Also inspect direct session readonly ranges if attached
  const directRanges = Array.isArray(session.readonlyRanges)
    ? session.readonlyRanges
    : Array.isArray(session.$readonlyRanges)
    ? session.$readonlyRanges
    : [];

  for (const r of directRanges) {
    if (r?.start && r?.end) {
      readonlyMarkers.push({
        range: r,
        clazz: "readonly_line",
        type: "fullLine",
      });
    }
  }

  if (readonlyMarkers.length === 0) {
    const lastRow = Math.max(0, totalRows - 1);
    const result = {
      range: {
        start: { row: 0, column: 0 },
        end: { row: lastRow, column: getLastCol(lastRow) },
      },
      hasPrefix: false,
      hasSuffix: false,
      prefixRange: null,
      suffixRange: null,
      isGuarded: false,
      isAmbiguous: false,
    };
    return result;
  }

  // Get covered row sets for each marker
  const markerRowSets = readonlyMarkers
    .map((m) => ({
      marker: m,
      rows: getCoveredRowsFromMarker(m, totalRows),
    }))
    .filter((m) => m.rows.length > 0);

  const allReadonlyRows = new Set();
  for (const item of markerRowSets) {
    for (const r of item.rows) allReadonlyRows.add(r);
  }

  // 1. Prefix: contiguous from row 0 upwards
  let prefixEndRow = -1;
  let advancedPrefix = true;
  while (advancedPrefix) {
    advancedPrefix = false;
    for (const item of markerRowSets) {
      const minRow = Math.min(...item.rows);
      const maxRow = Math.max(...item.rows);
      if (minRow <= prefixEndRow + 1 && maxRow > prefixEndRow) {
        prefixEndRow = maxRow;
        advancedPrefix = true;
      }
    }
  }

  // 2. Suffix: contiguous from totalRows - 1 downwards
  let suffixStartRow = totalRows;
  let advancedSuffix = true;
  while (advancedSuffix) {
    advancedSuffix = false;
    for (const item of markerRowSets) {
      const minRow = Math.min(...item.rows);
      const maxRow = Math.max(...item.rows);
      if (maxRow >= suffixStartRow - 1 && minRow < suffixStartRow) {
        if (minRow > prefixEndRow || (markerRowSets.length > 1 && item.rows[0] > 0)) {
          suffixStartRow = minRow;
          advancedSuffix = true;
        }
      }
    }
  }

  if (markerRowSets.length === 1 && prefixEndRow === totalRows - 1) {
    suffixStartRow = totalRows;
  }

  const hasPrefix = prefixEndRow >= 0;
  const hasSuffix =
    suffixStartRow < totalRows &&
    (suffixStartRow > prefixEndRow || (markerRowSets.length > 1 && suffixStartRow >= prefixEndRow));

  let isAmbiguous = false;
  for (let r = prefixEndRow + 1; r < suffixStartRow; r++) {
    if (allReadonlyRows.has(r)) {
      isAmbiguous = true;
      break;
    }
  }

  let startRow = hasPrefix ? prefixEndRow + 1 : 0;
  let startCol = 0;
  let endRow = hasSuffix ? suffixStartRow - 1 : Math.max(0, totalRows - 1);
  let endCol = endRow >= 0 ? getLastCol(endRow) : 0;

  if (startRow > endRow) {
    startRow = Math.min(startRow, Math.max(0, totalRows - 1));
    endRow = startRow;
    startCol = 0;
    endCol = 0;
  }

  const prefixRange = hasPrefix
    ? { start: { row: 0, column: 0 }, end: { row: prefixEndRow, column: getLastCol(prefixEndRow) } }
    : null;

  const suffixRange = hasSuffix
    ? { start: { row: suffixStartRow, column: 0 }, end: { row: totalRows - 1, column: getLastCol(totalRows - 1) } }
    : null;

  const result = {
    range: {
      start: { row: startRow, column: startCol },
      end: { row: endRow, column: endCol },
    },
    hasPrefix,
    hasSuffix,
    prefixRange,
    suffixRange,
    isGuarded: true,
    isAmbiguous,
  };

  return result;
}

/**
 * Validates Ace session invariants strictly per Section 3 of Contract:
 * - session exists
 * - session.getValue is a function
 * - session.getLength, session.getLines, or session.getLine is a function
 * - session.getMarkers is a function, or session.$frontMarkers/markers object exists
 * 
 * @param {object} session
 * @returns {boolean}
 */
export function validateAceSessionInvariants(session) {
  if (!session || typeof session !== "object") return false;
  if (typeof session.getValue !== "function") return false;
  const hasLineApi =
    typeof session.getLength === "function" ||
    typeof session.getLines === "function" ||
    typeof session.getLine === "function";
  if (!hasLineApi) return false;
  const hasMarkerApi =
    typeof session.getMarkers === "function" ||
    Boolean(session.$frontMarkers) ||
    Boolean(session.markers);
  return Boolean(hasMarkerApi);
}

/**
 * Resolves the authoritative Ace Context for a given target, container, or document root.
 * Integrates directly with the Main-World Bridge to cross isolated-world extension boundaries.
 * 
 * @param {any} [target]
 * @returns {{
 *   editor: object|null,
 *   session: object|null,
 *   document: object|null,
 *   identity: string|null,
 *   container: Element|null,
 *   hasAceDom: boolean,
 *   hasAceInstance: boolean,
 *   isReady: boolean,
 *   source: string,
 *   snapshot?: object|null
 * }}
 */
export function resolveAceContext(target = null) {
  // 1. Direct AceContext passthrough
  if (target && target._isAceContext) {
    return target;
  }

  // 2. Direct ProgrammingEditorAdapter passthrough
  if (target && target.context && target.context._isAceContext) {
    return target.context;
  }

  // 3. Direct Ace Editor instance passed (e.g. in test harness)
  if (target && typeof target.getValue === "function" && typeof target.getSession === "function") {
    const session = target.getSession();
    if (validateAceSessionInvariants(session)) {
      return createAceContext(target, session, target.container || null, "direct-editor");
    }
  }

  // 4. Direct Ace Session passed (e.g. in test harness)
  if (target && validateAceSessionInvariants(target)) {
    const editor = target.editor || (target.container?.env?.editor) || null;
    return createAceContext(editor, target, target.container || null, "direct-session");
  }

  // 5. DOM Resolution
  const doc = (target && target.nodeType === 9)
    ? target
    : (target?.ownerDocument || (typeof document !== "undefined" ? document : null));
  const root = (target && target.nodeType === 1) ? target : doc;

  if (!root && !doc) {
    return createUnresolvedAceContext(null, false, "no-dom-root");
  }

  // Check if direct ace.env.editor is visible in the current world
  const primaryAce =
    root?.querySelector?.("app-pa-code-editor .ace_editor, app-pa-code-editor .ace-container") ||
    (doc && doc !== root ? doc.querySelector?.("app-pa-code-editor .ace_editor, app-pa-code-editor .ace-container") : null);

  if (primaryAce) {
    const editor = primaryAce.env?.editor || primaryAce._editor || primaryAce.editor;
    const session = editor?.getSession?.() || editor?.session;
    if (editor && validateAceSessionInvariants(session)) {
      return createAceContext(editor, session, primaryAce, "dom-env-editor");
    }
  }

  // 6. Cross execution-world boundary via Main-World Bridge
  const bridgeResponse = requestMainWorldBridge("getSnapshot", {}, doc);
  if (bridgeResponse && bridgeResponse.ok && bridgeResponse.data && bridgeResponse.data.isReady) {
    const data = bridgeResponse.data;
    return createBridgeAceContext(data, primaryAce || root, doc);
  }

  // Candidate elements inspection fallback (for unit tests / mock DOMs)
  const candidates = [];
  const addCandidate = (el) => {
    if (el && el.nodeType === 1 && !candidates.includes(el)) {
      candidates.push(el);
    }
  };

  if (root?.nodeType === 1) {
    addCandidate(root);
  }

  const primarySelectors = IITM_SELECTORS.programming?.aceContainer || ".ace-container, .ace_editor, [id^='app-code-editor']";
  const singleAce = root?.querySelector?.(primarySelectors);
  if (singleAce) addCandidate(singleAce);
  const aceEls = root?.querySelectorAll?.(primarySelectors) || [];
  for (const el of aceEls) addCandidate(el);

  const hasAceDom = candidates.some((el) =>
    el.classList?.contains?.("ace_editor") ||
    el.classList?.contains?.("ace-container") ||
    Boolean(el.querySelector?.(".ace_editor, .ace-container"))
  );

  const primaryContainer =
    candidates.find((c) => c.classList?.contains?.("ace_editor") || c.classList?.contains?.("ace-container")) ||
    candidates[0] ||
    null;

  const extractFromObject = (obj) => {
    if (!obj || typeof obj !== "object") return null;

    if (typeof obj.getValue === "function" && typeof obj.getSession === "function") {
      const sess = obj.getSession();
      if (validateAceSessionInvariants(sess)) return { editor: obj, session: sess };
    }

    if (validateAceSessionInvariants(obj)) {
      return { editor: obj.editor || null, session: obj };
    }

    if (obj.env?.editor && typeof obj.env.editor.getValue === "function") {
      const ed = obj.env.editor;
      const sess = ed.getSession?.() || ed.session || obj.env.session;
      if (validateAceSessionInvariants(sess)) return { editor: ed, session: sess, source: "dom-env-editor" };
    }

    if (obj.editor && typeof obj.editor.getValue === "function") {
      const ed = obj.editor;
      const sess = ed.getSession?.() || ed.session;
      if (validateAceSessionInvariants(sess)) return { editor: ed, session: sess };
    }

    if (obj._editor && typeof obj._editor.getValue === "function") {
      const ed = obj._editor;
      const sess = ed.getSession?.() || ed.session;
      if (validateAceSessionInvariants(sess)) return { editor: ed, session: sess };
    }

    return null;
  };

  for (const el of candidates) {
    const res = extractFromObject(el);
    if (res && res.session) {
      return createAceContext(res.editor, res.session, el, res.source || "dom-property");
    }
  }

  // Global window.ace.edit() fallback
  const aceGlobal =
    (typeof globalThis !== "undefined" && globalThis.ace) ||
    (typeof window !== "undefined" && window.ace) ||
    null;

  if (aceGlobal && typeof aceGlobal.edit === "function") {
    for (const el of candidates) {
      if (el.classList?.contains?.("ace_editor") || el.id?.startsWith("app-code-editor")) {
        try {
          const ed = aceGlobal.edit(el);
          if (ed && typeof ed.getValue === "function") {
            const sess = ed.getSession?.() || ed.session;
            if (validateAceSessionInvariants(sess)) {
              return createAceContext(ed, sess, el, "global-ace-edit");
            }
          }
        } catch {}
      }
    }
  }

  return createUnresolvedAceContext(primaryContainer, hasAceDom, "unresolved");
}

function createBridgeAceContext(snapshot, container, doc = null) {
  const identity = snapshot.editorIdentity || (container?.id ? `container-${container.id}` : "ace-editor");
  return {
    _isAceContext: true,
    editor: null,
    session: null,
    document: doc || container?.ownerDocument || (container?.nodeType === 9 ? container : null),
    identity,
    container: container || null,
    hasAceDom: true,
    hasAceInstance: true,
    isReady: true,
    source: "main-world-bridge",
    snapshot,
  };
}

function createAceContext(editor, session, container, source) {
  let identity = null;
  if (editor?.id) identity = `editor-${editor.id}`;
  else if (session?.id) identity = `session-${session.id}`;
  else if (container?.id) identity = `container-${container.id}`;
  else if (typeof session.getLength === "function") identity = `session-len-${session.getLength()}`;
  else identity = `ace-session-${Date.now()}`;

  const doc = session.getDocument?.() || session.doc || null;

  return {
    _isAceContext: true,
    editor: editor || null,
    session,
    document: doc,
    identity,
    container: container || editor?.container || null,
    hasAceDom: true,
    hasAceInstance: true,
    isReady: true,
    source,
  };
}

function createUnresolvedAceContext(container, hasAceDom, source) {
  return {
    _isAceContext: true,
    editor: null,
    session: null,
    document: null,
    identity: null,
    container: container || null,
    hasAceDom: Boolean(hasAceDom),
    hasAceInstance: false,
    isReady: false,
    source,
  };
}

/**
 * Resolves the active Ace editor instance for a container element or document root.
 * 
 * @param {Element} [container]
 * @returns {object|null} Ace Editor instance
 */
export function getAceEditorInstance(container = null) {
  const ctx = resolveAceContext(container);
  if (ctx.editor) return ctx.editor;
  if (ctx.session) {
    return {
      session: ctx.session,
      getSession: () => ctx.session,
      getValue: () => ctx.session.getValue(),
      id: ctx.identity,
      container: ctx.container,
    };
  }
  return null;
}

// Module-level write lock to prevent concurrent import races
let isWritingCode = false;

// Module-level registry to preserve initial starter code per editor/question identity
const starterCodeRegistry = new Map();


/**
 * Canonical Programming Assignment Editor Adapter.
 * 
 * Provides an authoritative abstraction for reading and writing student code
 * to the IITM Ace editor while preserving protected prefix and suffix scaffold.
 */
export class ProgrammingEditorAdapter {
  /**
   * @param {Element|object} [containerOrEditor]
   */
  constructor(containerOrEditor = null) {
    if (containerOrEditor && containerOrEditor._isAceContext) {
      this.context = containerOrEditor;
    } else {
      this.context = resolveAceContext(containerOrEditor);
    }

    this.editor = this.context.editor;
    this.session = this.context.session;
    this.container = this.context.container;
    this.snapshot = this.context.snapshot || null;
  }

  /**
   * Checks if the Ace editor session is resolved and operational.
   * @returns {boolean}
   */
  isReady() {
    return Boolean(this.context.isReady);
  }

  /**
   * Returns current editor state enum.
   * @returns {string} EditorState value
   */
  getState() {
    if (this.isReady()) return EditorState.READY;
    if (this.context.hasAceDom || this.container || this.editor) return EditorState.DETECTED;
    return EditorState.UNKNOWN;
  }

  /**
   * Returns a unique identity token for the current Ace instance/session, or null if unresolved.
   * @returns {string|null}
   */
  getEditorIdentity() {
    if (!this.isReady()) return null;
    if (this.snapshot?.editorIdentity) return this.snapshot.editorIdentity;
    if (this.editor?.id) return `editor-${this.editor.id}`;
    if (this.session?.id) return `session-${this.session.id}`;
    if (this.container?.id) return `container-${this.container.id}`;
    return this.context?.identity ?? null;
  }

  /**
   * Returns the active logical question identity associated with this editor.
   * @returns {string|number}
   */
  getQuestionIdentity() {
    if (this.container && typeof this.container.closest === "function") {
      const qRoot = this.container.closest("app-pa-question, .pa-question, app-assessment-question");
      if (qRoot) {
        const id = qRoot.getAttribute("data-question-id") || qRoot.getAttribute("id");
        if (id) return id;
      }
    }
    const doc =
      this.container?.ownerDocument ||
      (this.container?.nodeType === 9 ? this.container : null) ||
      (typeof document !== "undefined" ? document : null);
    if (doc) {
      const activeChip = $(IITM_SELECTORS.navigation?.activeChip, doc);
      const text = (activeChip?.textContent || "").trim();
      const num = parseInt(text, 10);
      if (!isNaN(num)) return num;
    }
    return 1;
  }

  /**
   * Returns normalized language identifier from active Ace mode or portal selector.
   * Supports Bash, SQL, Python, Java, and JavaScript.
   * @returns {string|null} Canonical language identifier (e.g. "bash", "sql", "python", "java", "javascript") or null
   */
  getLanguage() {
    // 1. From bridge snapshot
    if (this.snapshot?.language) {
      const normalized = normalizeProgrammingLanguage(this.snapshot.language);
      if (normalized) return normalized;
    }

    // 2. From Ace session mode
    const mode = this.session?.getMode?.() || this.session?.$mode;
    if (mode && typeof mode.$id === "string") {
      const rawMode = mode.$id.replace(/^ace\/mode\//, "");
      const normalized = normalizeProgrammingLanguage(rawMode);
      if (normalized) return normalized;
    }

    // 3. From portal language dropdown element
    if (this.container || (typeof document !== "undefined" && document)) {
      const root =
        this.container?.closest?.("app-programming-assignment-view, .unit-view") ||
        (typeof document !== "undefined" ? document : null);
      if (root) {
        const langEl = root.querySelector?.(
          ".language-input .current-value, .language-selection .current-value, .current-value"
        );
        const text = (langEl?.textContent || "").replace(/\s+/g, " ").trim();
        const normalized = normalizeProgrammingLanguage(text);
        if (normalized) return normalized;
      }
    }

    return null;
  }

  /**
   * Resolves the editable range within the current session.
   * @returns {ReturnType<typeof resolveEditableRange>}
   */
  resolveEditableRange() {
    if (this.snapshot?.protectedRegions) {
      return this.snapshot.protectedRegions;
    }
    return resolveEditableRange(this.session);
  }

  /**
   * Returns the resolved editable range coordinates.
   * @returns {{ start: { row: number, column: number }, end: { row: number, column: number } }}
   */
  getEditableRange() {
    return this.resolveEditableRange().range || this.resolveEditableRange().editableRange;
  }

  /**
   * Returns protected regions and their exact text content.
   * @returns {{
   *   prefixRange: object|null,
   *   suffixRange: object|null,
   *   prefixCode: string|null,
   *   suffixCode: string|null,
   *   isGuarded: boolean
   * }}
   */
  getProtectedRegions() {
    if (this._protectedRegions !== undefined) {
      return this._protectedRegions;
    }

    if (!this.isReady()) {
      this._protectedRegions = {
        status: "UNAVAILABLE",
        prefixRange: null,
        suffixRange: null,
        prefixCode: null,
        suffixCode: null,
        hasPrefix: false,
        hasSuffix: false,
        isGuarded: false,
        isAmbiguous: false,
      };
      return this._protectedRegions;
    }

    // From main-world bridge snapshot
    if (this.snapshot?.protectedRegions) {
      const r = this.snapshot.protectedRegions;
      this._protectedRegions = {
        status: (r.hasPrefix || r.hasSuffix) ? "AVAILABLE" : "NONE",
        prefixRange: r.prefixRange || null,
        suffixRange: r.suffixRange || null,
        prefixCode: r.prefixCode || this.snapshot.prefixCode || null,
        suffixCode: r.suffixCode || this.snapshot.suffixCode || null,
        hasPrefix: Boolean(r.hasPrefix),
        hasSuffix: Boolean(r.hasSuffix),
        isGuarded: Boolean(r.isGuarded),
        isAmbiguous: Boolean(r.isAmbiguous),
      };
      return this._protectedRegions;
    }

    // Direct in-memory session inspection
    const resolution = this.resolveEditableRange();
    const { prefixRange, suffixRange, isGuarded, hasPrefix, hasSuffix, isAmbiguous } = resolution;

    let prefixCode = null;
    if (hasPrefix && this.session && prefixRange) {
      if (typeof this.session.getLines === "function") {
        prefixCode = this.session.getLines(prefixRange.start.row, prefixRange.end.row).join("\n");
      } else {
        prefixCode = this.session.getTextRange(prefixRange);
      }
    }

    let suffixCode = null;
    if (hasSuffix && this.session && suffixRange) {
      if (typeof this.session.getLines === "function") {
        suffixCode = this.session.getLines(suffixRange.start.row, suffixRange.end.row).join("\n");
      } else {
        suffixCode = this.session.getTextRange(suffixRange);
      }
    }

    this._protectedRegions = {
      status: (hasPrefix || hasSuffix) ? "AVAILABLE" : "NONE",
      prefixRange,
      suffixRange,
      prefixCode,
      suffixCode,
      hasPrefix,
      hasSuffix,
      isGuarded,
      isAmbiguous,
    };
    return this._protectedRegions;
  }

  /**
   * Returns whether protected regions are defined for this editor.
   * @returns {boolean}
   */
  hasProtectedRegions() {
    if (this.snapshot) {
      return Boolean(this.snapshot.hasProtectedRegions || this.snapshot.hasPrefixCode || this.snapshot.hasSuffixCode);
    }
    return this.hasPrefixCode() || this.hasSuffixCode();
  }

  /**
   * Returns whether a protected prefix region is present in the editor.
   * @returns {boolean}
   */
  hasPrefixCode() {
    if (this.snapshot?.hasPrefixCode !== undefined) {
      return Boolean(this.snapshot.hasPrefixCode || this.snapshot.prefixCode);
    }
    const regions = this.getProtectedRegions();
    return Boolean(regions.hasPrefix || (regions.prefixCode !== null && regions.prefixCode !== undefined));
  }

  /**
   * Returns whether a protected suffix region is present in the editor.
   * @returns {boolean}
   */
  hasSuffixCode() {
    if (this.snapshot?.hasSuffixCode !== undefined) {
      return Boolean(this.snapshot.hasSuffixCode || this.snapshot.suffixCode);
    }
    const regions = this.getProtectedRegions();
    return Boolean(regions.hasSuffix || (regions.suffixCode !== null && regions.suffixCode !== undefined));
  }

  /**
   * Returns the protected prefix code (if any) or null if absent.
   * Preserves exact whitespace, newlines, comments, Unicode.
   * @returns {string|null}
   */
  getPrefixCode() {
    if (this.snapshot?.prefixCode !== undefined) {
      return this.snapshot.prefixCode;
    }
    const regions = this.getProtectedRegions();
    return regions.prefixCode !== undefined ? regions.prefixCode : null;
  }

  /**
   * Returns the protected suffix code (if any) or null if absent.
   * Preserves exact whitespace, newlines, comments, Unicode.
   * @returns {string|null}
   */
  getSuffixCode() {
    if (this.snapshot?.suffixCode !== undefined) {
      return this.snapshot.suffixCode;
    }
    const regions = this.getProtectedRegions();
    return regions.suffixCode !== undefined ? regions.suffixCode : null;
  }

  /**
   * Captures and records the initial starter code at the earliest reliable editor-ready point.
   * Preserves immutability across subsequent edits or imports.
   * @returns {string|null}
   */
  captureStarterCode() {
    if (!this.isReady()) {
      return null;
    }
    const id = this.getEditorIdentity();
    if (!id) return null;
    if (!starterCodeRegistry.has(id)) {
      const code = this.getCode();
      starterCodeRegistry.set(id, code);
      this._starterCode = code;
      return code;
    }
    return starterCodeRegistry.get(id);
  }

  /**
   * Returns the initial starter code supplied by the assignment.
   * @returns {string|null}
   */
  getStarterCode() {
    if (!this.isReady()) return null;
    const id = this.getEditorIdentity();
    if (this._starterCode !== undefined && this._starterCode !== null) {
      return this._starterCode;
    }
    if (id && starterCodeRegistry.has(id)) {
      return starterCodeRegistry.get(id);
    }
    return this.captureStarterCode();
  }

  /**
   * Sets or overrides the recorded starter code.
   * @param {string} code
   */
  setStarterCode(code) {
    const id = this.getEditorIdentity();
    this._starterCode = code;
    if (id) {
      starterCodeRegistry.set(id, code);
    }
  }

  /**
   * Returns structured data for the editor state.
   * @returns {object}
   */
  getEditorData() {
    const isReady = this.isReady();
    const protectedRegions = this.getProtectedRegions();
    const prefixCode = this.getPrefixCode();
    const suffixCode = this.getSuffixCode();
    return {
      prefixCode,
      starterCode: isReady ? (this.getStarterCode() || this.getCode()) : null,
      currentCode: isReady ? this.getCode() : "",
      suffixCode,
      hasPrefixCode: this.hasPrefixCode(),
      hasSuffixCode: this.hasSuffixCode(),
      language: this.getLanguage() || "javascript",
      editorIdentity: this.getEditorIdentity(),
      questionIdentity: this.getQuestionIdentity(),
      isGuarded: Boolean(protectedRegions?.isGuarded),
      isReady,
      protectedRegions,
    };
  }

  /**
   * Reads the full Ace document value (read-only).
   * @returns {string}
   */
  getContent() {
    if (!this.isReady()) return "";
    if (this.snapshot?.fullCode !== undefined) {
      return this.snapshot.fullCode;
    }
    if (this.session && typeof this.session.getValue === "function") {
      return this.session.getValue();
    }
    return "";
  }

  /**
   * Reads only the student's editable/main content.
   * @returns {string}
   */
  getMainContent() {
    return this.getCode();
  }

  /**
   * Reads and returns ONLY the student's editable code (excluding protected prefix/suffix).
   * @returns {string}
   */
  getCode() {
    if (!this.isReady()) {
      return "";
    }
    if (this.snapshot?.currentCode !== undefined) {
      return this.snapshot.currentCode;
    }
    if (this.session && typeof this.session.getValue === "function") {
      const { range } = this.resolveEditableRange();
      return this.session.getTextRange(range);
    }
    return "";
  }


  /**
   * Replaces ONLY the editable main-content range with new code.
   * 
   * @param {string} newCode
   * @param {object} [options]
   * @param {string|null} [options.expectedEditorIdentity]
   * @param {string|null} [options.expectedQuestionIdentity]
   * @returns {{ ok: boolean, code: string, verified?: boolean, error?: string, errorCode?: string }|Promise<{ ok: boolean, code: string, verified?: boolean, error?: string, errorCode?: string }>}
   */
  setCode(newCode, { expectedEditorIdentity = null, expectedQuestionIdentity = null } = {}) {
    this.captureStarterCode();

    if (typeof newCode !== "string") {
      return {
        ok: false,
        code: "",
        error: "Code payload must be a string.",
        errorCode: EditorErrorCode.EDITABLE_RANGE_INVALID,
      };
    }

    if (!this.isReady()) {
      return {
        ok: false,
        code: "",
        error: "Ace editor is not ready or session is unavailable.",
        errorCode: EditorErrorCode.EDITOR_NOT_READY,
      };
    }

    if (isWritingCode) {
      return {
        ok: false,
        code: "",
        error: "Another code write operation is currently in progress.",
        errorCode: EditorErrorCode.CODE_WRITE_FAILED,
      };
    }

    const initialEditorId = this.getEditorIdentity();
    const initialQuestionId = this.getQuestionIdentity();
    if (expectedEditorIdentity && initialEditorId !== expectedEditorIdentity) {
      return {
        ok: false,
        code: this.getCode(),
        error: "Editor identity changed since the Reader snapshot.",
        errorCode: EditorErrorCode.EDITOR_IDENTITY_CHANGED,
      };
    }
    if (
      expectedQuestionIdentity !== null && expectedQuestionIdentity !== undefined &&
      String(initialQuestionId) !== String(expectedQuestionIdentity)
    ) {
      return {
        ok: false,
        code: this.getCode(),
        error: "Question identity changed since the Reader snapshot.",
        errorCode: EditorErrorCode.QUESTION_IDENTITY_CHANGED,
      };
    }
    // 1. If connected via Main-World Bridge, perform write via privileged execution path
    if (this.context.source === "main-world-bridge" || (!this.session && this.snapshot)) {
      // In Chrome Extension MV3, dispatch write to background script for MAIN world execution
      if (typeof chrome !== "undefined" && chrome?.runtime?.sendMessage) {
        isWritingCode = true;
        return new Promise((resolve) => {
          try {
            chrome.runtime.sendMessage(
              {
                type: "ACADRIX_PROGRAMMING_WRITE",
                payload: {
                  editorIdentity: initialEditorId,
                  questionNumber: initialQuestionId,
                  code: newCode,
                },
              },
              (res) => {
                isWritingCode = false;
                if (chrome.runtime.lastError) {
                  resolve({
                    ok: false,
                    code: this.getCode(),
                    error: chrome.runtime.lastError.message || "Failed to communicate with extension background.",
                    errorCode: EditorErrorCode.CODE_WRITE_FAILED,
                  });
                  return;
                }
                if (res && res.ok && res.data) {
                  if (this.snapshot) {
                    this.snapshot.currentCode = newCode;
                    this.snapshot.fullCode =
                      (this.snapshot.prefixCode ? this.snapshot.prefixCode + "\n" : "") +
                      newCode +
                      (this.snapshot.suffixCode ? "\n" + this.snapshot.suffixCode : "");
                  }
                  delete this._protectedRegions;
                  resolve({
                    ok: true,
                    code: newCode,
                    verified: true,
                  });
                } else {
                  resolve({
                    ok: false,
                    code: this.getCode(),
                    error: res?.error || "Failed to write code via privileged main-world execution.",
                    errorCode: res?.errorCode || EditorErrorCode.CODE_WRITE_FAILED,
                  });
                }
              }
            );
          } catch (err) {
            isWritingCode = false;
            resolve({
              ok: false,
              code: this.getCode(),
              error: err?.message || "Failed to dispatch write to background script.",
              errorCode: EditorErrorCode.CODE_WRITE_FAILED,
            });
          }
        });
      }

      // Fallback for Node/test environments where chrome.runtime is undefined
      isWritingCode = true;
      try {
        const doc =
          this.context?.document ||
          (this.container?.nodeType === 9 ? this.container : null) ||
          this.container?.ownerDocument ||
          (typeof document !== "undefined" ? document : null);
        const win =
          doc?.defaultView ||
          this.container?.defaultView ||
          (typeof window !== "undefined" ? window : globalThis);
        let res = null;
        if (typeof executePrivilegedWrite === "function") {
          res = executePrivilegedWrite(
            {
              editorIdentity: initialEditorId,
              questionNumber: initialQuestionId,
              code: newCode,
            },
            win
          );
        } else {
          res = {
            ok: false,
            error: "Privileged write function unavailable.",
            errorCode: EditorErrorCode.CODE_WRITE_FAILED,
          };
        }

        if (res && res.ok && res.data) {
          if (this.snapshot) {
            this.snapshot.currentCode = newCode;
            this.snapshot.fullCode = (this.snapshot.prefixCode ? this.snapshot.prefixCode + "\n" : "") + newCode + (this.snapshot.suffixCode ? "\n" + this.snapshot.suffixCode : "");
          }
          delete this._protectedRegions;
          return {
            ok: true,
            code: newCode,
            verified: true,
          };
        }
        return {
          ok: false,
          code: this.getCode(),
          error: res?.error || "Failed to write code via privileged main-world execution.",
          errorCode: res?.errorCode || EditorErrorCode.CODE_WRITE_FAILED,
        };
      } finally {
        isWritingCode = false;
      }
    }

    // 2. Direct local session mutation
    const resolution = this.resolveEditableRange();
    if (resolution.isAmbiguous) {
      return {
        ok: false,
        code: "",
        error: "Ambiguous or fragmented protected regions detected. Aborting write to prevent scaffold corruption.",
        errorCode: EditorErrorCode.PROTECTED_REGION_UNKNOWN,
      };
    }

    const { range, prefixRange, suffixRange } = resolution;
    const originalPrefix = prefixRange ? this.session.getTextRange(prefixRange) : null;
    const originalSuffix = suffixRange ? this.session.getTextRange(suffixRange) : null;

    isWritingCode = true;
    try {
      const aceRange = createAceRange(this.session, range.start, range.end);
      this.session.replace(aceRange, newCode);
      notifyEditorChange(this.container || this.editor?.container);
      delete this._protectedRegions;

      const postEditorId = this.getEditorIdentity();
      const postQuestionId = this.getQuestionIdentity();

      if (postEditorId !== initialEditorId) {
        return {
          ok: false,
          code: this.getCode(),
          error: "Editor instance replaced during write operation.",
          errorCode: EditorErrorCode.EDITOR_IDENTITY_CHANGED,
        };
      }

      if (postQuestionId !== initialQuestionId) {
        return {
          ok: false,
          code: this.getCode(),
          error: "Question identity changed during write operation.",
          errorCode: EditorErrorCode.QUESTION_IDENTITY_CHANGED,
        };
      }

      // Verification
      const postResolution = this.resolveEditableRange();
      const postPrefix = postResolution.prefixRange ? this.session.getTextRange(postResolution.prefixRange) : null;
      const postSuffix = postResolution.suffixRange ? this.session.getTextRange(postResolution.suffixRange) : null;
      const actualCode = this.getCode();

      if (originalPrefix !== null && postPrefix !== originalPrefix) {
        return {
          ok: false,
          code: actualCode,
          error: "Protected prefix was altered.",
          errorCode: EditorErrorCode.CODE_WRITE_VERIFICATION_FAILED,
        };
      }
      if (originalSuffix !== null && postSuffix !== originalSuffix) {
        return {
          ok: false,
          code: actualCode,
          error: "Protected suffix was altered.",
          errorCode: EditorErrorCode.CODE_WRITE_VERIFICATION_FAILED,
        };
      }
      if (actualCode !== newCode) {
        return {
          ok: false,
          code: actualCode,
          error: "Editable code does not match expected code.",
          errorCode: EditorErrorCode.CODE_WRITE_VERIFICATION_FAILED,
        };
      }

      return {
        ok: true,
        code: actualCode,
        verified: true,
      };
    } catch (err) {
      return {
        ok: false,
        code: "",
        error: err.message || "Failed to replace editable code range.",
        errorCode: EditorErrorCode.CODE_WRITE_FAILED,
      };
    } finally {
      isWritingCode = false;
    }
  }
}

function notifyEditorChange(container) {
  if (!container || typeof container.dispatchEvent !== "function") return;
  try {
    const textarea =
      container.querySelector?.("textarea.ace_text-input, textarea") ||
      $("textarea.ace_text-input, textarea", container);
    const target = textarea || container;

    target.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    target.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
  } catch {}
}

export function readAcePrefixCode(container = null) {
  const adapter = new ProgrammingEditorAdapter(container);
  return adapter.getPrefixCode();
}

export function readAceSuffixCode(container = null) {
  const adapter = new ProgrammingEditorAdapter(container);
  return adapter.getSuffixCode();
}

export function readAceStarterCode(container = null) {
  const adapter = new ProgrammingEditorAdapter(container);
  return adapter.getStarterCode();
}

export function readAceEditorData(container = null) {
  const adapter = new ProgrammingEditorAdapter(container);
  return adapter.getEditorData();
}

export function readAceEditorCode(container = null) {
  const adapter = new ProgrammingEditorAdapter(container);
  return adapter.getCode();
}

export function setAceEditorCode(container, newCode, expectedContext = {}) {
  const adapter = new ProgrammingEditorAdapter(container);
  return adapter.setCode(newCode, expectedContext);
}


