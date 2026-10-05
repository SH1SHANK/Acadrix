/**
 * Portal Decor: Sidebar Row Decorator.
 * Renders closed Shadow DOM badges and deadline lines on eligible IITM sidebar rows,
 * and coordinates high-priority graded visual emphasis.
 */

import { IITM_SELECTORS } from "../portal/selectors.js";
import {
  effectiveClass,
  assignmentKey,
  relativeText,
  portalDecorNormalizeText,
  parseTermId,
  parseCourseCode,
} from "./core.js";
import { isPortalDecorStale } from "./storage.js";
import { getCourseKey } from "./capture.js";

const MONTH_NAMES = Object.freeze([
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
]);

const GRADED_CHECK_SVG = `<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" style="margin-right:3px;flex:none;"><path d="M2.5 6.2L4.7 8.4L9.5 3.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const WARNING_ICON_SVG = `<svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true"><path d="M7 0L14 13H0L7 0Z" fill="currentColor"/><path d="M6.25 5H7.75V8.5H6.25V5ZM6.25 9.5H7.75V11H6.25V9.5Z" fill="var(--acx-surface)"/></svg>`;

const ERROR_ICON_SVG = `<svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true"><circle cx="7" cy="7" r="7" fill="currentColor"/><path d="M6.25 3.5H7.75V7.5H6.25V3.5ZM6.25 8.5H7.75V10.5H6.25V8.5Z" fill="var(--acx-surface)"/></svg>`;

export const HOST_DECOR_STYLE_ID = "acx-portal-decor-host-styles";

export const HOST_DECOR_STYLES = `
/* Acadrix Portal Decor: Coordinated Graded Visual Emphasis */
button.child-row[data-acx-graded="true"],
.child-row[data-acx-graded="true"] {
  position: relative !important;
  background-color: rgb(47 75 219 / 0.05) !important;
  border-left: 3px solid #2F4BDB !important;
  transition: background-color 120ms cubic-bezier(0.2, 0, 0, 1) !important;
}

button.child-row[data-acx-graded="true"]:hover,
.child-row[data-acx-graded="true"]:hover {
  background-color: rgb(47 75 219 / 0.10) !important;
}

button.child-row[data-acx-graded="true"].selected,
.child-row[data-acx-graded="true"].selected,
button.child-row[data-acx-graded="true"][aria-selected="true"],
.child-row[data-acx-graded="true"][aria-selected="true"] {
  background-color: rgb(47 75 219 / 0.16) !important;
}

/* Graded Assignment Icon emphasis */
button.child-row[data-acx-graded="true"] app-icon.child-icon,
button.child-row[data-acx-graded="true"] .child-icon,
.child-row[data-acx-graded="true"] app-icon.child-icon,
.child-row[data-acx-graded="true"] .child-icon {
  color: #2F4BDB !important;
}

/* Graded Assignment Title hierarchy: stronger weight, preserves host theme color */
button.child-row[data-acx-graded="true"] .child-title,
.child-row[data-acx-graded="true"] .child-title {
  font-weight: 600 !important;
}

/* Practice and other rows remain neutral */
button.child-row:not([data-acx-graded="true"]),
.child-row:not([data-acx-graded="true"]) {
  border-left: 3px solid transparent !important;
}

/* Dark mode theme support */
@media (prefers-color-scheme: dark) {
  button.child-row[data-acx-graded="true"],
  .child-row[data-acx-graded="true"] {
    background-color: rgb(142 162 255 / 0.10) !important;
    border-left: 3px solid #8EA2FF !important;
  }
  button.child-row[data-acx-graded="true"]:hover,
  .child-row[data-acx-graded="true"]:hover {
    background-color: rgb(142 162 255 / 0.16) !important;
  }
  button.child-row[data-acx-graded="true"].selected,
  .child-row[data-acx-graded="true"].selected,
  button.child-row[data-acx-graded="true"][aria-selected="true"],
  .child-row[data-acx-graded="true"][aria-selected="true"] {
    background-color: rgb(142 162 255 / 0.22) !important;
  }
  button.child-row[data-acx-graded="true"] app-icon.child-icon,
  button.child-row[data-acx-graded="true"] .child-icon,
  .child-row[data-acx-graded="true"] app-icon.child-icon,
  .child-row[data-acx-graded="true"] .child-icon {
    color: #8EA2FF !important;
  }
}

@media (forced-colors: active) {
  button.child-row[data-acx-graded="true"],
  .child-row[data-acx-graded="true"] {
    border-left-color: Highlight !important;
  }
  button.child-row[data-acx-graded="true"] app-icon.child-icon,
  .child-row[data-acx-graded="true"] app-icon.child-icon {
    color: Highlight !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  button.child-row[data-acx-graded="true"],
  .child-row[data-acx-graded="true"] {
    transition: none !important;
  }
}
`;

const DECOR_STYLES = `
:host {
  display: block;
  pointer-events: none;
  user-select: none;
  --acx-font-ui: "Satoshi Variable", "Satoshi", system-ui, -apple-system, "Segoe UI", sans-serif;
  --acx-accent: #2F4BDB;
  --acx-accent-hover: #2540C2;
  --acx-accent-subtle: rgb(47 75 219 / 0.08);
  --acx-accent-border: rgb(47 75 219 / 0.30);
  --acx-surface: #FFFFFF;
  --acx-surface-sunken: #F3F3F0;
  --acx-text: #16181D;
  --acx-text-muted: #5B606B;
  --acx-border: #E4E4DF;
  --acx-warning: #9A6700;
  --acx-error: #C62828;
  --acx-radius-sm: 4px;
  --acx-border-width: 1px;
  --acx-border-width-strong: 2px;
  --acx-space-0: 0px;
  --acx-space-1: 4px;
  --acx-space-2: 8px;
  --acx-tracking-overline: 0.04em;
}

@media (prefers-color-scheme: dark) {
  :host {
    --acx-accent: #8EA2FF;
    --acx-accent-hover: #A9B8FF;
    --acx-accent-subtle: rgb(142 162 255 / 0.16);
    --acx-accent-border: rgb(142 162 255 / 0.35);
    --acx-surface: #15181D;
    --acx-surface-sunken: rgb(255 255 255 / 0.08);
    --acx-text: #ECEDEF;
    --acx-text-muted: #A3A8B2;
    --acx-border: rgb(255 255 255 / 0.14);
    --acx-warning: #E3B341;
    --acx-error: #FF7B72;
  }
}

:host-context([data-theme="dark"]),
:host-context(.dark),
:host-context(.theme-dark),
:host-context([class*="dark"]),
:host-context(body[style*="background: #0"]),
:host-context(body[style*="background: rgb(0"]),
:host-context(body[style*="background-color: #0"]),
:host-context(body[style*="background-color: rgb(0"]) {
  --acx-accent: #8EA2FF;
  --acx-accent-hover: #A9B8FF;
  --acx-accent-subtle: rgb(142 162 255 / 0.16);
  --acx-accent-border: rgb(142 162 255 / 0.35);
  --acx-surface: #15181D;
  --acx-surface-sunken: rgb(255 255 255 / 0.08);
  --acx-text: #ECEDEF;
  --acx-text-muted: #A3A8B2;
  --acx-border: rgb(255 255 255 / 0.14);
  --acx-warning: #E3B341;
  --acx-error: #FF7B72;
}

.acx-decor-container {
  display: flex;
  flex-direction: column;
  gap: var(--acx-space-1);
  margin-top: var(--acx-space-1);
  pointer-events: none;
}
.acx-badge-row {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--acx-space-2);
}
.acx-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: var(--acx-radius-sm);
  font-family: var(--acx-font-ui);
  font-size: 10px;
  font-weight: 600;
  line-height: 14px;
  letter-spacing: var(--acx-tracking-overline);
  text-transform: uppercase;
  flex-shrink: 0;
}
.acx-badge-graded {
  color: var(--acx-accent);
  background: var(--acx-accent-subtle);
  border: var(--acx-border-width) solid var(--acx-accent-border);
  box-shadow: 0 1px 2px rgb(47 75 219 / 0.06);
}
.acx-badge-practice {
  color: var(--acx-text-muted);
  background: var(--acx-surface-sunken);
  border: var(--acx-border-width) solid var(--acx-border);
}
.acx-deadline-row {
  display: inline-flex;
  align-items: center;
  gap: var(--acx-space-1);
  font-family: var(--acx-font-ui);
  font-size: 11px;
  line-height: 14px;
  color: var(--acx-text-muted);
  white-space: nowrap;
}
.acx-deadline-row.is-warning {
  color: var(--acx-warning);
  font-weight: 500;
}
.acx-deadline-row.is-error {
  color: var(--acx-error);
  font-weight: 500;
}
.acx-deadline-icon {
  display: inline-flex;
  align-items: center;
  flex: none;
}
.acx-deadline-icon svg {
  width: 12px;
  height: 12px;
}
@media (forced-colors: active) {
  .acx-badge {
    border-color: ButtonText;
  }
}
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
`;

export function ensureHostStyles(doc) {
  const targetDoc = (typeof doc !== "undefined" && (doc?.ownerDocument || doc)) || null;
  if (!targetDoc || !targetDoc.head) return;
  if (targetDoc.getElementById?.(HOST_DECOR_STYLE_ID)) return;
  try {
    const styleEl = targetDoc.createElement("style");
    styleEl.id = HOST_DECOR_STYLE_ID;
    styleEl.textContent = HOST_DECOR_STYLES;
    targetDoc.head.appendChild(styleEl);
  } catch {}
}

export function removeHostStyles(doc) {
  const targetDoc = (typeof doc !== "undefined" && (doc?.ownerDocument || doc)) || null;
  const styleEl = targetDoc?.getElementById?.(HOST_DECOR_STYLE_ID);
  if (styleEl) {
    try {
      styleEl.remove();
    } catch {}
  }
}

/**
 * Formats full deadline text, relative time, and warning/error state.
 * @param {string|null} deadlineIso
 * @param {number|undefined} capturedAt
 * @param {Date|number} now
 * @returns {object|null}
 */
export function formatDeadlineLine(deadlineIso, capturedAt, now = new Date()) {
  if (!deadlineIso) return null;
  const due = new Date(deadlineIso);
  const nowDate = now instanceof Date ? now : new Date(now);
  if (isNaN(due.getTime()) || isNaN(nowDate.getTime())) return null;

  const currentYear = nowDate.getFullYear();
  const dueYear = due.getFullYear();
  const monthStr = MONTH_NAMES[due.getMonth()];
  const day = due.getDate();
  let hours = due.getHours();
  const minutes = String(due.getMinutes()).padStart(2, "0");
  const meridiem = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  const timeStr = `${hours}:${minutes} ${meridiem} IST`;

  const dateStr = dueYear === currentYear ? `${monthStr} ${day}` : `${monthStr} ${day}, ${dueYear}`;
  const baseDue = `Due ${dateStr}, ${timeStr}`;
  const rel = relativeText(deadlineIso, nowDate);
  let text = rel ? `${baseDue} · ${rel}` : baseDue;

  if (capturedAt && isPortalDecorStale({ capturedAt }, nowDate.getTime())) {
    const capDate = new Date(capturedAt);
    if (!isNaN(capDate.getTime())) {
      const capMonth = MONTH_NAMES[capDate.getMonth()];
      const capDay = capDate.getDate();
      text += ` · as of ${capMonth} ${capDay}`;
    }
  }

  const diff = due.getTime() - nowDate.getTime();
  let state = "normal";
  if (diff < 0) {
    state = "error";
  } else if (diff < 48 * 60 * 60 * 1000) {
    state = "warning";
  }

  return { text, state };
}

/**
 * Creates a closed shadow root host element with the given decoration data.
 * Places the deadline text directly beside the badge in the same line.
 * @param {Document} doc
 * @param {object} config
 * @returns {Element}
 */
export function createDecorHost(doc, { effective, deadlineInfo, entry = null }) {
  const host = doc.createElement(IITM_SELECTORS.decor.decorHost);
  host.setAttribute(IITM_SELECTORS.decor.decorAttr, "true");

  const shadow = host.attachShadow({ mode: "closed" });

  const styleEl = doc.createElement("style");
  styleEl.textContent = DECOR_STYLES;
  shadow.appendChild(styleEl);

  const container = doc.createElement("div");
  container.className = "acx-decor-container";

  const badgeRow = doc.createElement("div");
  badgeRow.className = "acx-badge-row";

  // 1. Graded / Practice badge
  if (effective === "graded") {
    const badge = doc.createElement("span");
    badge.className = "acx-badge acx-badge-graded";
    if (entry?.yourScore !== null && entry?.yourScore !== undefined && Number.isFinite(entry.yourScore)) {
      const scoreDisplay = entry.yourScoreRaw && entry.yourScoreRaw.includes("%") ? entry.yourScoreRaw : `${entry.yourScore}%`;
      badge.innerHTML = `${GRADED_CHECK_SVG}<span>Graded · ${scoreDisplay}</span>`;
    } else {
      badge.innerHTML = `${GRADED_CHECK_SVG}<span>Graded</span>`;
    }
    badgeRow.appendChild(badge);
  } else if (effective === "practice") {
    const badge = doc.createElement("span");
    badge.className = "acx-badge acx-badge-practice";
    badge.textContent = "Practice";
    badgeRow.appendChild(badge);
  }

  // 2. Deadline placed beside the badge in the same row
  if (deadlineInfo) {
    const deadlineEl = doc.createElement("span");
    deadlineEl.className = "acx-deadline-row";
    if (deadlineInfo.state === "warning") {
      deadlineEl.classList.add("is-warning");
      const iconSpan = doc.createElement("span");
      iconSpan.className = "acx-deadline-icon";
      iconSpan.innerHTML = WARNING_ICON_SVG;
      deadlineEl.appendChild(iconSpan);
    } else if (deadlineInfo.state === "error") {
      deadlineEl.classList.add("is-error");
      const iconSpan = doc.createElement("span");
      iconSpan.className = "acx-deadline-icon";
      iconSpan.innerHTML = ERROR_ICON_SVG;
      deadlineEl.appendChild(iconSpan);
    }
    const textSpan = doc.createElement("span");
    textSpan.textContent = deadlineInfo.text;
    deadlineEl.appendChild(textSpan);
    badgeRow.appendChild(deadlineEl);
  }

  if (badgeRow.childNodes.length > 0) {
    container.appendChild(badgeRow);
  }

  shadow.appendChild(container);
  return host;
}

/**
 * Decorates eligible IITM sidebar child rows.
 * @param {Document|Element} doc
 * @param {object} store
 * @param {Function|number} now
 * @returns {Promise<void>}
 */
export async function decorateSidebar(doc, store, now = () => Date.now(), gradesStore = null) {
  const courseKey = getCourseKey(doc);
  if (!courseKey) return;

  ensureHostStyles(doc);

  const unitContainers = doc.querySelectorAll?.(IITM_SELECTORS.decor.unitContainer) || [];
  const nowDate = typeof now === "function" ? new Date(now()) : new Date(now);

  const termId = parseTermId(courseKey);
  const courseCode = parseCourseCode(courseKey);

  // Pre-fetch stored course grades if gradesStore is provided
  let courseGrades = [];
  if (gradesStore?.getCourseGrades) {
    try {
      courseGrades = await gradesStore.getCourseGrades(termId, courseCode);
    } catch {}
  }

  for (const unitContainer of unitContainers) {
    const unitTitleEl = unitContainer.querySelector?.(IITM_SELECTORS.decor.unitTitle);
    const unitTitle = unitTitleEl?.textContent ? portalDecorNormalizeText(unitTitleEl.textContent) : "";
    if (!unitTitle) continue;

    const childRows = unitContainer.querySelectorAll?.(IITM_SELECTORS.decor.childRow) || [];
    for (const row of childRows) {
      const typeEl = row.querySelector?.(IITM_SELECTORS.decor.childType);
      const typeText = typeEl?.textContent ? portalDecorNormalizeText(typeEl.textContent) : "";

      const titleEl = row.querySelector?.(IITM_SELECTORS.decor.childTitle);
      const title = titleEl?.textContent ? portalDecorNormalizeText(titleEl.textContent) : "";

      const isEligible =
        /^(?:Assignment|Programming Assignment|Activity|Activity Question|Quiz|Assessment)$/i.test(typeText) ||
        /\b(?:assignment|grpa|ppa|ga|pa|activity|quiz|oppe)\b/i.test(title);

      // Query all existing decor elements in this row
      const existingDecors = row.querySelectorAll?.(
        IITM_SELECTORS.decor.decorAllElements
      ) || [];

      if (!isEligible || !title || !typeEl) {
        existingDecors.forEach((el) => el.remove());
        row.removeAttribute?.("data-acx-graded");
        row.removeAttribute?.("data-acx-mode");
        continue;
      }

      const key = assignmentKey(courseKey, unitTitle, title);
      let entry = await store.get(courseKey, key);

      // Fallback to gradesStore if entry is missing or has no deadline
      if ((!entry || !entry.deadlineIso) && courseGrades && courseGrades.length > 0) {
        const normTitle = portalDecorNormalizeText(title).toLowerCase();
        const normUnit = portalDecorNormalizeText(unitTitle).toLowerCase();

        // 1. Exact title match
        let matched = courseGrades.find(
          (r) => portalDecorNormalizeText(r.title).toLowerCase() === normTitle
        );

        // 2. Substring title match within course
        if (!matched) {
          matched = courseGrades.find((r) => {
            const rTitle = portalDecorNormalizeText(r.title).toLowerCase();
            return rTitle.includes(normTitle) || normTitle.includes(rTitle);
          });
        }

        // 3. Module/Week match fallback: if in same module/week and has dueDate
        if (!matched && normUnit) {
          const weekMatch = normUnit.match(/\bweek[\s\-_:]*(\d{1,2})\b/i);
          const weekNum = weekMatch ? weekMatch[1] : null;

          matched = courseGrades.find((r) => {
            const rMod = portalDecorNormalizeText(r.module).toLowerCase();
            const rWeekMatch = rMod.match(/\bweek[\s\-_:]*(\d{1,2})\b/i);
            const rWeekNum = rWeekMatch ? rWeekMatch[1] : null;
            if (weekNum && rWeekNum && weekNum === rWeekNum && r.dueDate) {
              return true;
            }
            return rMod === normUnit && r.dueDate;
          });
        }

        if (matched) {
          const mode = effectiveClass(entry?.modeRaw || "", title || matched.title);
          entry = {
            id: key,
            courseKey,
            module: unitTitle,
            assignmentId: key,
            title,
            type: matched.assignmentType || typeText,
            mode,
            modeRaw: entry?.modeRaw || "",
            dueDate: matched.dueDate,
            dueDateText: matched.dueDateText,
            deadlineIso: matched.dueDate,
            deadlineRaw: matched.dueDateText,
            yourScore: matched.yourScore !== undefined && matched.yourScore !== null ? matched.yourScore : (entry?.yourScore ?? null),
            yourScoreRaw: matched.yourScoreRaw !== undefined && matched.yourScoreRaw !== null ? matched.yourScoreRaw : (entry?.yourScoreRaw ?? null),
            peerAverage: matched.peerAverage !== undefined ? matched.peerAverage : (entry?.peerAverage ?? null),
            medianScore: matched.medianScore !== undefined ? matched.medianScore : (entry?.medianScore ?? null),
            scoreStatus: matched.scoreStatus || entry?.scoreStatus || "UNRELEASED",
            evaluationStatus: matched.evaluationStatus || entry?.evaluationStatus || "normal",
            source: "grades_fallback",
            capturedAt: entry?.capturedAt || Number(matched.capturedAt ? new Date(matched.capturedAt).getTime() : now()),
          };

          // Cache back to decor store
          if (store?.capture) {
            await store.capture(courseKey, key, entry);
          }
        }
      }

      const effective = effectiveClass(entry?.modeRaw, title);
      const deadlineIso = entry?.deadlineIso || entry?.dueDate || null;
      const deadlineInfo = deadlineIso
        ? formatDeadlineLine(deadlineIso, entry?.capturedAt, nowDate)
        : (entry?.deadlineRaw || entry?.dueDateText ? { text: entry.deadlineRaw || entry.dueDateText, state: "normal" } : null);

      const shouldDecorate =
        effective === "graded" ||
        effective === "practice" ||
        (effective === "unknown" && Boolean(deadlineInfo));

      if (!shouldDecorate) {
        existingDecors.forEach((el) => el.remove());
        row.removeAttribute?.("data-acx-graded");
        row.removeAttribute?.("data-acx-mode");
        continue;
      }

      if (effective === "graded") {
        row.setAttribute?.("data-acx-graded", "true");
        row.setAttribute?.("data-acx-mode", "graded");
      } else if (effective === "practice") {
        row.removeAttribute?.("data-acx-graded");
        row.setAttribute?.("data-acx-mode", "practice");
      } else {
        row.removeAttribute?.("data-acx-graded");
        row.removeAttribute?.("data-acx-mode");
      }

      const newHost = createDecorHost(doc.ownerDocument || doc, {
        effective,
        deadlineInfo,
        entry,
      });

      // Purge all existing decor hosts before inserting the single new host
      const currentDecors = row.querySelectorAll?.(
        IITM_SELECTORS.decor.decorAllElements
      ) || [];
      currentDecors.forEach((el) => el.remove());

      typeEl.insertAdjacentElement("afterend", newHost);
    }
  }
}

/**
 * Creates a debounced mutation observer for sidebar DOM updates.
 * @param {Document|Element} doc
 * @param {Function} onMutate
 * @returns {MutationObserver|null}
 */
export function createSidebarObserver(doc, onMutate) {
  const target = (typeof doc !== "undefined" && (doc.body || doc.documentElement)) || null;
  if (!target || typeof MutationObserver === "undefined") return null;

  let timeoutId = null;

  const observer = new MutationObserver((mutations) => {
    const isOnlyOurDecor = mutations.every((m) => {
      const targetEl = m.target;
      if (
        targetEl?.nodeType === 1 &&
        (targetEl.hasAttribute?.(IITM_SELECTORS.decor.decorAttr) ||
          targetEl.tagName?.toLowerCase() === IITM_SELECTORS.decor.decorHost)
      ) {
        return true;
      }
      const added = [...(m.addedNodes || [])];
      const removed = [...(m.removedNodes || [])];
      return (
        added.every(
          (n) =>
            n.nodeType === 1 &&
            (n.hasAttribute?.(IITM_SELECTORS.decor.decorAttr) ||
              n.tagName?.toLowerCase() === IITM_SELECTORS.decor.decorHost)
        ) &&
        removed.every(
          (n) =>
            n.nodeType === 1 &&
            (n.hasAttribute?.(IITM_SELECTORS.decor.decorAttr) ||
              n.tagName?.toLowerCase() === IITM_SELECTORS.decor.decorHost)
        )
      );
    });

    if (isOnlyOurDecor) return;

    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      onMutate();
    }, 50);
  });

  observer.observe(target, { childList: true, subtree: true });
  return observer;
}

