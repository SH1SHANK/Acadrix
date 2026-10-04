/**
 * Portal Decor: Sidebar Row Decorator.
 * Renders closed Shadow DOM badges and deadline lines on eligible IITM sidebar rows.
 */

import { IITM_SELECTORS } from "../portal/selectors.js";
import {
  effectiveClass,
  assignmentKey,
  relativeText,
  portalDecorNormalizeText,
} from "./core.js";
import { isPortalDecorStale } from "./storage.js";
import { getCourseKey } from "./capture.js";

const MONTH_NAMES = Object.freeze([
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
]);

const WARNING_ICON_SVG = `<svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true"><path d="M7 0L14 13H0L7 0Z" fill="currentColor"/><path d="M6.25 5H7.75V8.5H6.25V5ZM6.25 9.5H7.75V11H6.25V9.5Z" fill="var(--acx-surface, #FFF)"/></svg>`;

const ERROR_ICON_SVG = `<svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true"><circle cx="7" cy="7" r="7" fill="currentColor"/><path d="M6.25 3.5H7.75V7.5H6.25V3.5ZM6.25 8.5H7.75V10.5H6.25V8.5Z" fill="var(--acx-surface, #FFF)"/></svg>`;

const DECOR_STYLES = `
:host {
  display: block;
  pointer-events: none;
  user-select: none;
}
.acx-decor-container {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 3px;
  pointer-events: none;
}
.acx-badge-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.acx-accent-bar {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--acx-accent, #2F4BDB);
}
.acx-badge {
  display: inline-flex;
  align-items: center;
  padding: 0 4px;
  border-radius: var(--acx-radius-sm, 4px);
  font-family: var(--acx-font-ui, "Satoshi Variable", "Satoshi", system-ui, sans-serif);
  font-size: 10px;
  font-weight: 600;
  line-height: 14px;
  letter-spacing: var(--acx-tracking-overline, 0.04em);
  text-transform: uppercase;
}
.acx-badge-graded {
  color: var(--acx-accent, #2F4BDB);
  background: var(--acx-accent-subtle, rgb(47 75 219 / 0.08));
  border: 1px solid var(--acx-accent, #2F4BDB);
}
.acx-badge-practice {
  color: var(--acx-text-muted, #5B606B);
  background: var(--acx-surface-sunken, #F3F3F0);
  border: 1px solid var(--acx-border, #E4E4DF);
}
.acx-deadline-row {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--acx-font-ui, "Satoshi Variable", "Satoshi", system-ui, sans-serif);
  font-size: 11px;
  line-height: 14px;
  color: var(--acx-text-muted, #5B606B);
}
.acx-deadline-row.is-warning {
  color: var(--acx-warning, #9A6700);
  font-weight: 500;
}
.acx-deadline-row.is-error {
  color: var(--acx-error, #C62828);
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
  .acx-accent-bar {
    background: Highlight;
  }
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
 * @param {Document} doc
 * @param {object} config
 * @returns {Element}
 */
export function createDecorHost(doc, { effective, deadlineInfo }) {
  const host = doc.createElement(IITM_SELECTORS.decor.decorHost);
  host.setAttribute(IITM_SELECTORS.decor.decorAttr, "true");

  const shadow = host.attachShadow({ mode: "closed" });

  const styleEl = doc.createElement("style");
  styleEl.textContent = DECOR_STYLES;
  shadow.appendChild(styleEl);

  const container = doc.createElement("div");
  container.className = "acx-decor-container";

  if (effective === "graded") {
    const accentBar = doc.createElement("div");
    accentBar.className = "acx-accent-bar";
    accentBar.setAttribute("aria-hidden", "true");
    container.appendChild(accentBar);

    const badgeRow = doc.createElement("div");
    badgeRow.className = "acx-badge-row";
    const badge = doc.createElement("span");
    badge.className = "acx-badge acx-badge-graded";
    badge.textContent = "Graded";
    badgeRow.appendChild(badge);
    container.appendChild(badgeRow);
  } else if (effective === "practice") {
    const badgeRow = doc.createElement("div");
    badgeRow.className = "acx-badge-row";
    const badge = doc.createElement("span");
    badge.className = "acx-badge acx-badge-practice";
    badge.textContent = "Practice";
    badgeRow.appendChild(badge);
    container.appendChild(badgeRow);
  }

  if (deadlineInfo && (effective === "graded" || effective === "unknown")) {
    const deadlineRow = doc.createElement("div");
    deadlineRow.className = "acx-deadline-row";
    if (deadlineInfo.state === "warning") {
      deadlineRow.classList.add("is-warning");
      const iconSpan = doc.createElement("span");
      iconSpan.className = "acx-deadline-icon";
      iconSpan.innerHTML = WARNING_ICON_SVG;
      deadlineRow.appendChild(iconSpan);
    } else if (deadlineInfo.state === "error") {
      deadlineRow.classList.add("is-error");
      const iconSpan = doc.createElement("span");
      iconSpan.className = "acx-deadline-icon";
      iconSpan.innerHTML = ERROR_ICON_SVG;
      deadlineRow.appendChild(iconSpan);
    }
    const textSpan = doc.createElement("span");
    textSpan.textContent = deadlineInfo.text;
    deadlineRow.appendChild(textSpan);
    container.appendChild(deadlineRow);
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
export async function decorateSidebar(doc, store, now = () => Date.now()) {
  const courseKey = getCourseKey(doc);
  if (!courseKey) return;

  const unitContainers = doc.querySelectorAll?.(IITM_SELECTORS.decor.unitContainer) || [];
  const nowDate = typeof now === "function" ? new Date(now()) : new Date(now);

  for (const unitContainer of unitContainers) {
    const unitTitleEl = unitContainer.querySelector?.(IITM_SELECTORS.decor.unitTitle);
    const unitTitle = unitTitleEl?.textContent ? portalDecorNormalizeText(unitTitleEl.textContent) : "";
    if (!unitTitle) continue;

    const childRows = unitContainer.querySelectorAll?.(IITM_SELECTORS.decor.childRow) || [];
    for (const row of childRows) {
      const typeEl = row.querySelector?.(IITM_SELECTORS.decor.childType);
      const typeText = typeEl?.textContent ? portalDecorNormalizeText(typeEl.textContent) : "";

      const isEligible = /^(Assignment|Programming Assignment)$/i.test(typeText);
      const existingDecor = row.querySelector?.(IITM_SELECTORS.decor.decorHost);

      if (!isEligible) {
        if (existingDecor) existingDecor.remove();
        continue;
      }

      const titleEl = row.querySelector?.(IITM_SELECTORS.decor.childTitle);
      const title = titleEl?.textContent ? portalDecorNormalizeText(titleEl.textContent) : "";
      if (!title || !typeEl) continue;

      const key = assignmentKey(courseKey, unitTitle, title);
      const entry = await store.get(courseKey, key);

      const effective = effectiveClass(entry?.modeRaw, title);
      const deadlineInfo = entry?.deadlineIso
        ? formatDeadlineLine(entry.deadlineIso, entry.capturedAt, nowDate)
        : null;

      const shouldDecorate =
        effective === "graded" ||
        effective === "practice" ||
        (effective === "unknown" && Boolean(deadlineInfo));

      if (!shouldDecorate) {
        if (existingDecor) existingDecor.remove();
        continue;
      }

      const newHost = createDecorHost(doc.ownerDocument || doc, {
        effective,
        deadlineInfo,
      });

      if (existingDecor) {
        existingDecor.replaceWith(newHost);
      } else {
        typeEl.insertAdjacentElement("afterend", newHost);
      }
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
  const target =
    doc.querySelector?.(IITM_SELECTORS.decor.sidebarContainer) ||
    doc.body ||
    doc.documentElement;
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
