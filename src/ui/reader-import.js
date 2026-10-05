/**
 * Extension-only Reader feature: Interactive AI Answer Review UI, Importer & IITM Portal Applicator.
 * 
 * Provides a guided 5-stage assessment solving workflow:
 * 1. Prepare Prompt (Question selection with Select All / Clear, contextual token/question estimation)
 * 2. Ask AI / Handoff (1-click clipboard prompt copy + instant visual handoff guidance)
 * 3. Import Response (Direct 1-click clipboard paste + validation diagnostics + manual fallback)
 * 4. Two-Phase Validation & Review (Breakdown of detected/matched/valid/issues + per-card status)
 * 5. Apply Answers (Safe, atomic application to IITM portal form controls with confirmation & restoration)
 */

import { ICONS } from "./icons.js";
import { escapeHtml } from "../utils/dom.js";
import { QuestionType } from "../model/types.js";
import { buildExportFilename } from "../model/document.js";
import { generateAiPrompt } from "../bridge/prompt.js";
import { exportAssignmentToMarkdown } from "../exporters/markdown.js";
import { exportPdf } from "../exporters/pdf.js";
import { parseAnswerKey } from "../bridge/parser.js";
import { assignmentFingerprint } from "../bridge/protocol.js";
import {
  AnswerState,
  STATUS_CONFIG,
  computeAnswerState,
  isValidNumerical,
  normalizeSelection,
  isMcqType,
  isMsqType,
  isNumericalType,
  isTextType,
} from "../bridge/answer-state.js";
import {
  summarizeReviewState,
  applyAnswersToPortal,
  applySingleQuestionToPortal,
} from "../bridge/applicator.js";
import { QuestionTraverser } from "../traversal/traverser.js";
import { renderContentNodes } from "./reader-content.js";

const IMPORT_ICONS = {
  apply: '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  import: '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  clipboard: '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg>',
  sparkles: '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>',
  checkCircle: '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  arrowRight: '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
};

export const WorkflowStep = {
  PREPARE: 1,
  ASK_AI: 2,
  IMPORT: 3,
  REVIEW: 4,
};

function formatAiValue(entry) {
  if (!entry) return "";
  if (entry.status === "missing") return "no answer";
  if (entry.status === "invalid") return `invalid — ${entry.reason || "Invalid answer"}`;
  if (Array.isArray(entry.answer)) return entry.answer.join(", ");
  return String(entry.answer ?? "");
}

function makeAiBadge(entry) {
  const badge = document.createElement("span");
  badge.className = "saq-ai-answer-badge";
  badge.setAttribute("data-acx-ai-answer", "true");

  if (entry.status === "missing") {
    badge.textContent = "AI: no answer";
  } else if (entry.status === "invalid") {
    badge.classList.add("is-invalid");
    const icon = document.createElement("span");
    icon.className = "saq-ai-answer-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "!";
    const text = document.createElement("span");
    text.textContent = `AI: invalid — ${entry.reason || "Invalid answer"}`;
    badge.append(icon, text);
  } else {
    const value = formatAiValue(entry);
    badge.textContent = `AI: ${value}`;
  }
  return badge;
}

export function createReaderImportFeature(reader) {
  let currentFingerprint = null;
  let importedEntries = [];
  let portalActivityHandler = null;
  let isSyncingToPortal = false;
  let activeQuestionIndex = 0;
  let scrollObserver = null;
  const selectedQuestions = new Set();
  const userSelections = new Map(); // questionNumber -> selection value
  const ZOOM_STEPS = [0.8, 0.9, 1.0, 1.15, 1.3, 1.5];
  let currentZoomIndex = 2; // 1.0 default

  const applyZoom = (newIndex) => {
    currentZoomIndex = Math.max(0, Math.min(ZOOM_STEPS.length - 1, newIndex));
    const scale = ZOOM_STEPS[currentZoomIndex];
    reader.setZoom?.(scale);
    const valBtn = reader.sheetElement?.querySelector("[data-act='zoom-reset']");
    if (valBtn) valBtn.textContent = `${Math.round(scale * 100)}%`;
  };
  const questionRail = () => reader.sheetElement?.querySelector("#saq-qrail");
  const importPanel = () => reader.sheetElement?.querySelector("#saq-import-panel");
  const importTrigger = () => reader.sheetElement?.querySelector("[data-act='import-answers']");
  const applyDialog = () => reader.sheetElement?.querySelector("#saq-apply-dialog");
  const applyTrigger = () => reader.sheetElement?.querySelector("[data-act='apply-answers']");

  const isImportOpen = () => {
    const node = importPanel();
    return Boolean(node && !node.hasAttribute("hidden"));
  };

  const isApplyOpen = () => {
    const node = applyDialog();
    return Boolean(node && !node.hasAttribute("hidden"));
  };

  const isOpen = () => isImportOpen() || isApplyOpen();

  const getAiEntriesMap = () => {
    return new Map(importedEntries.map((e) => [e.number, e]));
  };

  const inputSyncDebounceTimers = new Map();

  const syncQuestionToPortal = (question, selection, { debounceMs = 0 } = {}) => {
    if (!question) return;
    const portal = reader.portal || reader.shadowHost?.portal;
    const isCurrentActive = portal?.getActiveLogicalNumber && portal.getActiveLogicalNumber() === question.number;

    const doSync = () => {
      try {
        isSyncingToPortal = true;
        const traverser =
          reader.portalTraverser ||
          reader.shadowHost?.runtime?.traverser ||
          (portal && typeof QuestionTraverser === "function" ? new QuestionTraverser(portal) : null);
        if (portal && typeof applySingleQuestionToPortal === "function") {
          applySingleQuestionToPortal({
            portal,
            traverser,
            question,
            selection,
          }).catch((err) => {
            console.warn("[Acadrix Sync] Live sync to portal failed for Q" + question?.number, err);
          }).finally(() => {
            setTimeout(() => {
              isSyncingToPortal = false;
            }, 100);
          });
        } else {
          isSyncingToPortal = false;
        }
      } catch (err) {
        isSyncingToPortal = false;
        console.warn("[Acadrix Sync] Error initiating portal sync:", err);
      }
    };

    if (debounceMs > 0 && !isCurrentActive) {
      if (inputSyncDebounceTimers.has(question.number)) {
        clearTimeout(inputSyncDebounceTimers.get(question.number));
      }
      inputSyncDebounceTimers.set(
        question.number,
        setTimeout(() => {
          inputSyncDebounceTimers.delete(question.number);
          doSync();
        }, debounceMs)
      );
    } else {
      if (inputSyncDebounceTimers.has(question.number)) {
        clearTimeout(inputSyncDebounceTimers.get(question.number));
        inputSyncDebounceTimers.delete(question.number);
      }
      doSync();
    }
  };

  /**
   * Initializes user selections and question selection state from current document model.
   */
  const initSelectionsFromDocument = (documentModel) => {
    userSelections.clear();
    selectedQuestions.clear();
    for (const [idx, q] of (documentModel?.questions || []).entries()) {
      const qNum = Number(q.number) || (idx + 1);
      selectedQuestions.add(qNum);
      if (q.number !== undefined && q.number !== null) selectedQuestions.add(q.number);
      const isMsq = isMsqType(q.type);
      const isMcq = isMcqType(q.type) || (!isMsq && q.options && q.options.length > 0);
      const isNum = isNumericalType(q.type);
      const isTxt = isTextType(q.type);

      if (isMsq) {
        const selOpts = (q.options || [])
          .filter((o) => o.selected)
          .map((o) =>
            String(o.letter || "")
              .replace(/^[\s(]+|[.\s):]+$/g, "")
              .toUpperCase()
          )
          .filter(Boolean);
        userSelections.set(q.number, selOpts.sort());
      } else if (isMcq) {
        const selOpt = q.options?.find((o) => o.selected);
        const letter = selOpt
          ? String(selOpt.letter || "")
              .replace(/^[\s(]+|[.\s):]+$/g, "")
              .toUpperCase()
          : null;
        userSelections.set(q.number, letter);
      } else if (isNum || isTxt) {
        const existingVal = q.savedAnswer || q.userAnswer || q.metadata?.savedAnswer || "";
        userSelections.set(q.number, String(existingVal));
      } else {
        userSelections.set(q.number, null);
      }
    }
  };

  const isQuestionAttempted = (question) => {
    if (!question) return false;
    const val = userSelections.get(question.number);
    if (Array.isArray(val)) return val.length > 0;
    if (typeof val === "string") return val.trim() !== "";
    if (val !== null && val !== undefined) return true;
    if (question.review?.userSelection || question.review?.isAttempted) return true;
    return false;
  };

  /**
   * Renders and updates the Intelligent Question Navigation Rail.
   */
  const renderQuestionRail = () => {
    const sheet = reader.sheetElement;
    if (!sheet || !reader.documentModel) return;

    let rail = questionRail();
    if (!rail) {
      rail = document.createElement("nav");
      rail.id = "saq-qrail";
      rail.className = "saq-qrail";
      rail.setAttribute("aria-label", "Question Navigation Rail");
      const scrollEl = sheet.querySelector(".saq-scroll");
      if (scrollEl && typeof sheet.insertBefore === "function") {
        sheet.insertBefore(rail, scrollEl);
      } else {
        sheet.appendChild(rail);
      }
    }

    const questions = reader.documentModel.questions || [];
    const totalQuestions = questions.length;
    let attemptedCount = 0;

    const pillsHtml = questions
      .map((q, idx) => {
        const attempted = isQuestionAttempted(q);
        if (attempted) attemptedCount++;
        const isCurrent = idx === activeQuestionIndex;
        const aiEntry = getAiEntriesMap().get(q.number);
        const hasAi = aiEntry && aiEntry.status === "answered";

        const stateClasses = [
          "saq-qrail-pill",
          attempted ? "is-attempted" : "is-pending",
          hasAi ? "has-ai" : "",
          isCurrent ? "is-active" : "",
        ]
          .filter(Boolean)
          .join(" ");

        const title = `Question ${q.number || idx + 1}: ${attempted ? "Attempted" : "Pending"}${hasAi ? " · AI answer imported" : ""}`;

        return `
          <button type="button"
                  class="${stateClasses}"
                  data-act="jump-to-q"
                  data-q-index="${idx}"
                  data-q-num="${q.number || idx + 1}"
                  role="tab"
                  aria-selected="${isCurrent ? "true" : "false"}"
                  title="${escapeHtml(title)}">
            <span class="saq-qrail-num">Q${q.number || idx + 1}</span>
            <span class="saq-qrail-dot" aria-hidden="true"></span>
          </button>
        `;
      })
      .join("");

    const pendingCount = Math.max(0, totalQuestions - attemptedCount);

    const curZoom = reader.getZoom?.() || ZOOM_STEPS[currentZoomIndex] || 1.0;

    rail.innerHTML = `
      <div class="saq-qrail-stats">
        <span class="saq-stat-badge is-attempted" title="Attempted questions">
          <span class="saq-stat-dot"></span>
          <span class="saq-stat-text"><strong data-stat-attempted>${attemptedCount}</strong> Attempted</span>
        </span>
        <span class="saq-stat-divider">·</span>
        <span class="saq-stat-badge is-pending" title="Pending questions">
          <span class="saq-stat-dot"></span>
          <span class="saq-stat-text"><strong data-stat-pending>${pendingCount}</strong> Pending</span>
        </span>
      </div>
      <div class="saq-qrail-scroll">
        <div class="saq-qrail-track" role="tablist">
          ${pillsHtml}
        </div>
      </div>
      <div class="saq-qrail-actions" aria-label="View and accessibility options">
        <div class="saq-rail-group" role="group" aria-label="Text zoom controls">
          <button type="button" class="saq-rail-btn" data-act="zoom-out" aria-label="Zoom out content" title="Zoom out (A− / Ctrl+−)">A−</button>
          <button type="button" class="saq-rail-btn saq-rail-zoom-val" data-act="zoom-reset" aria-label="Reset zoom level" title="Reset zoom (100% / Ctrl+0)">${Math.round(curZoom * 100)}%</button>
          <button type="button" class="saq-rail-btn" data-act="zoom-in" aria-label="Zoom in content" title="Zoom in (A+ / Ctrl++)">A+</button>
        </div>
        <div class="saq-rail-group" role="group" aria-label="Question selection options">
          <button type="button" class="saq-rail-btn" data-act="select-all-q" aria-label="Select all questions" title="Select all questions">All</button>
          <button type="button" class="saq-rail-btn" data-act="invert-qselect" aria-label="Invert question selection" title="Invert selection">Invert</button>
          <button type="button" class="saq-rail-btn" data-act="clear-qselect" aria-label="Deselect all questions" title="Deselect all">None</button>
        </div>
      </div>
    `;
    setupScrollObserver();
  };

  const setupScrollObserver = () => {
    const sheet = reader.sheetElement;
    if (!sheet) return;
    const scrollContainer = sheet.querySelector(".saq-scroll");
    if (!scrollContainer) return;

    if (scrollObserver) {
      scrollObserver.disconnect();
      scrollObserver = null;
    }

    if (typeof IntersectionObserver !== "undefined") {
      try {
        scrollObserver = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) {
                const idx = Number(entry.target.dataset.q);
                if (!isNaN(idx) && idx !== activeQuestionIndex) {
                  activeQuestionIndex = idx;
                  updateActivePill(idx);
                }
              }
            }
          },
          {
            root: scrollContainer,
            rootMargin: "-10% 0px -60% 0px",
            threshold: 0.1,
          }
        );

        sheet.querySelectorAll(".saq-block").forEach((block) => {
          scrollObserver.observe(block);
        });
      } catch (_e) {
        // Fallback
      }
    }
  };

  const updateActivePill = (index) => {
    const sheet = reader.sheetElement;
    if (!sheet) return;
    const pills = sheet.querySelectorAll(".saq-qrail-pill");
    pills.forEach((pill) => {
      const pIdx = Number(pill.dataset.qIndex);
      const isCur = pIdx === index;
      pill.classList.toggle("is-active", isCur);
      pill.setAttribute("aria-selected", isCur ? "true" : "false");
      if (isCur && typeof pill.scrollIntoView === "function") {
        pill.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      }
    });
  };

  /**
   * Updates ready-to-apply count badge in reader header & workflow bar.
   */
  const updateReadyBadge = () => {
    const sheet = reader.sheetElement;
    if (!sheet) return;
    const badges = sheet.querySelectorAll("[data-ready-badge]");
    const summary = summarizeReviewState(reader.documentModel, userSelections, getAiEntriesMap());

    badges.forEach((badge) => {
      if (summary.ready > 0) {
        badge.textContent = String(summary.ready);
        badge.removeAttribute("hidden");
      } else {
        badge.setAttribute("hidden", "");
        badge.textContent = "0";
      }
    });
  };

  /**
   * Renders or updates a single question block's interactive controls and status badge.
   */
  const updateQuestionBlock = (block, question, index) => {
    // 0. Clean up any leaked portal form controls inside stem
    const stemEl = block.querySelector(".saq-stem");
    if (stemEl) {
      stemEl.querySelectorAll("textarea, input, select, app-textarea, .textarea-field, .answer-field, .question-controls, .your-answer, label.label-textarea").forEach((el) => el.remove());
    }

    const aiEntriesMap = getAiEntriesMap();
    const aiEntry = aiEntriesMap.get(question.number) || null;
    const userSelection = userSelections.get(question.number);
    const qNum = Number(question.number) || (index + 1);
    const isQuestionSelected = selectedQuestions.has(qNum) || selectedQuestions.has(question.number);
    const state = computeAnswerState({ type: question.type, aiEntry, userSelection });
    const config = STATUS_CONFIG[state] || STATUS_CONFIG[AnswerState.UNANSWERED];

    // 1. Update Header Status Badge & Selection Checkbox
    const header = block.querySelector(".saq-qheader");
    if (header) {
      // Question Selection Toggle
      let selectWrap = header.querySelector(".saq-qselect-wrap");
      if (!selectWrap) {
        selectWrap = document.createElement("div");
        selectWrap.className = "saq-qselect-wrap";
        if (typeof header.prepend === "function") {
          header.prepend(selectWrap);
        } else if (header.children?.[0] && typeof header.insertBefore === "function") {
          header.insertBefore(selectWrap, header.children[0]);
        } else {
          header.appendChild(selectWrap);
        }
      }
      selectWrap.innerHTML = `
        <button type="button" 
                class="saq-qselect-cb ${isQuestionSelected ? "is-checked" : ""}" 
                data-act="toggle-qselect" 
                data-q="${index}" 
                role="checkbox" 
                aria-checked="${isQuestionSelected ? "true" : "false"}" 
                title="${isQuestionSelected ? "Exclude from AI prompt" : "Include in AI prompt"}">
          ${isQuestionSelected ? ICONS.check : ""}
        </button>
      `;

      let statusBadge = header.querySelector(".saq-status-badge");
      if (!statusBadge) {
        statusBadge = document.createElement("span");
        statusBadge.className = "saq-status-badge";
        statusBadge.setAttribute("data-acx-status-badge", "true");
        header.appendChild(statusBadge);
      }
      statusBadge.className = `saq-status-badge ${config.badgeClass}`;
      statusBadge.textContent = config.label;

      // Inert AI answer badge if present
      header.querySelectorAll("[data-acx-ai-answer]").forEach((n) => n.remove());
      if (aiEntry) {
        header.appendChild(makeAiBadge(aiEntry));
      }
    }

    // 2. Render / Update AI Suggestion Sub-Bar
    let aiBar = block.querySelector(".saq-ai-suggestion-bar");
    if (aiEntry && aiEntry.status !== "missing") {
      if (!aiBar) {
        aiBar = document.createElement("div");
        aiBar.className = "saq-ai-suggestion-bar";
        const stem = block.querySelector(".saq-stem");
        if (stem && stem.nextSibling) {
          block.insertBefore(aiBar, stem.nextSibling);
        } else {
          block.appendChild(aiBar);
        }
      }

      const valText = formatAiValue(aiEntry);
      const isInvalid = aiEntry.status === "invalid";
      const canApply = aiEntry.status === "answered" && aiEntry.answer !== null;

      let modelsHtml = "";
      if (Array.isArray(aiEntry.models) && aiEntry.models.length > 0) {
        const modelItems = aiEntry.models
          .map(
            (m) =>
              `<span class="saq-model-pill" title="${escapeHtml(
                m.name || "Model"
              )}">${escapeHtml(m.name || "Model")}: <strong>${escapeHtml(
                String(m.answer)
              )}</strong></span>`
          )
          .join(" ");
        modelsHtml = `<div class="saq-models-breakdown">${modelItems}</div>`;
      }

      aiBar.innerHTML = `
        <div class="saq-ai-suggestion-info">
          <span class="saq-ai-suggestion-label">AI Suggestion</span>
          <span class="saq-ai-suggestion-val ${
            isInvalid ? "is-invalid" : ""
          }">${escapeHtml(valText)}</span>
          ${modelsHtml}
        </div>
        ${
          canApply
            ? `<button type="button" class="saq-btn saq-btn-xs saq-btn-apply-ai" data-act="apply-single-ai" data-q="${index}" title="Apply AI answer to your selection">${ICONS.check}<span>Apply AI</span></button>`
            : ""
        }
      `;
    } else if (aiBar) {
      aiBar.remove();
    }

    // 3. Render / Update Interactive Controls
    const isMsq = isMsqType(question.type);
    const hasOptions = Array.isArray(question.options) && question.options.length > 0;
    const isMcq = isMcqType(question.type) || (!isMsq && hasOptions);
    const isNum = isNumericalType(question.type);
    const isTxt = isTextType(question.type);

    if (isMcq && hasOptions) {
      let optsContainer = block.querySelector(".saq-options");
      if (!optsContainer) {
        optsContainer = document.createElement("div");
        block.appendChild(optsContainer);
      }
      optsContainer.className = "saq-options saq-options-interactive";
      optsContainer.setAttribute("role", "radiogroup");
      optsContainer.setAttribute("aria-label", `Question ${question.number} options`);

      const currentSelectedLetter =
        typeof userSelection === "string"
          ? userSelection.replace(/^[\s(]+|[.\s):]+$/g, "").toUpperCase()
          : null;
      const aiSuggestedLetter =
        aiEntry &&
        aiEntry.status === "answered" &&
        typeof aiEntry.answer === "string"
          ? String(aiEntry.answer).replace(/^[\s(]+|[.\s):]+$/g, "").toUpperCase()
          : null;

      const itemsHtml = (question.options || [])
        .map((opt, optIndex) => {
          const letter = String(opt.letter || "")
            .replace(/^[\s(]+|[.\s):]+$/g, "")
            .toUpperCase();
          const isSelected = Boolean(
            currentSelectedLetter && currentSelectedLetter === letter
          );
          const isAiSuggested = Boolean(
            aiSuggestedLetter && aiSuggestedLetter === letter
          );
          const contentHtml = renderContentNodes(opt.content, { visualMath: true });
          const aiTagHtml = isAiSuggested
            ? `<span class="saq-opt-ai-tag">AI Suggestion</span>`
            : "";

          return `
          <button type="button"
                  class="saq-option ${isSelected ? "is-selected selected" : ""} ${
            isAiSuggested ? "is-ai-suggested" : ""
          }"
                  role="radio"
                  aria-checked="${isSelected ? "true" : "false"}"
                  data-letter="${escapeHtml(letter)}"
                  data-q="${index}"
                  tabindex="${
                    isSelected || (!currentSelectedLetter && optIndex === 0)
                      ? "0"
                      : "-1"
                  }">
            <span class="saq-opt-letter">${escapeHtml(opt.letter || letter)}</span>
            <span class="saq-opt-text">${contentHtml}</span>
            ${aiTagHtml}
          </button>
        `;
        })
        .join("");

      optsContainer.innerHTML = itemsHtml;
    } else if (isMsq && hasOptions) {
      let optsContainer = block.querySelector(".saq-options");
      if (!optsContainer) {
        optsContainer = document.createElement("div");
        block.appendChild(optsContainer);
      }
      optsContainer.className = "saq-options saq-options-interactive";
      optsContainer.setAttribute("role", "group");
      optsContainer.setAttribute("aria-label", `Question ${question.number} options`);

      const currentSelectedSet = new Set(
        (Array.isArray(userSelection) ? userSelection : [userSelection])
          .filter(Boolean)
          .map((s) =>
            String(s).replace(/^[\s(]+|[.\s):]+$/g, "").toUpperCase()
          )
      );
      const aiSuggestedSet = new Set(
        (Array.isArray(aiEntry?.answer) ? aiEntry.answer : [aiEntry?.answer])
          .filter(Boolean)
          .map((s) =>
            String(s).replace(/^[\s(]+|[.\s):]+$/g, "").toUpperCase()
          )
      );

      const itemsHtml = (question.options || [])
        .map((opt) => {
          const letter = String(opt.letter || "")
            .replace(/^[\s(]+|[.\s):]+$/g, "")
            .toUpperCase();
          const isSelected = currentSelectedSet.has(letter);
          const isAiSuggested = aiSuggestedSet.has(letter);
          const contentHtml = renderContentNodes(opt.content, { visualMath: true });
          const aiTagHtml = isAiSuggested
            ? `<span class="saq-opt-ai-tag">AI Suggestion</span>`
            : "";

          return `
          <button type="button"
                  class="saq-option ${isSelected ? "is-selected selected" : ""} ${
            isAiSuggested ? "is-ai-suggested" : ""
          }"
                  role="checkbox"
                  aria-checked="${isSelected ? "true" : "false"}"
                  data-letter="${escapeHtml(letter)}"
                  data-q="${index}"
                  tabindex="0">
            <span class="saq-opt-letter">${escapeHtml(opt.letter || letter)}</span>
            <span class="saq-opt-text">${contentHtml}</span>
            ${aiTagHtml}
          </button>
        `;
        })
        .join("");

      optsContainer.innerHTML = itemsHtml;
    } else if (isNum) {
      let inputWrap = block.querySelector(".saq-answer-input-wrap");
      if (!inputWrap) {
        inputWrap = document.createElement("div");
        inputWrap.className = "saq-answer-input-wrap";
        block.appendChild(inputWrap);
      }

      const valStr = typeof userSelection === "string" ? userSelection : "";
      const isNumInvalid = valStr.trim() !== "" && !isValidNumerical(valStr);

      inputWrap.innerHTML = `
        <label class="saq-input-label" for="saq-num-input-${question.number}">Your Answer:</label>
        <div class="saq-input-row">
          <input type="text"
                 inputmode="decimal"
                 id="saq-num-input-${question.number}"
                 class="saq-num-input ${isNumInvalid ? "is-invalid" : ""}"
                 data-q="${index}"
                 data-type="numerical"
                 placeholder="e.g. 42.5 or -1.5e-3"
                 value="${escapeHtml(valStr)}"
                 autocomplete="off"
                 spellcheck="false" />
          <button type="button" class="saq-btn saq-btn-sm saq-btn-clear" data-act="clear-input" data-q="${index}" title="Clear answer">Clear</button>
        </div>
        ${
          isNumInvalid
            ? `<span class="saq-input-error">Please enter a valid decimal or scientific number</span>`
            : ""
        }
      `;
    } else if (isTxt) {
      let inputWrap = block.querySelector(".saq-answer-input-wrap");
      if (!inputWrap) {
        inputWrap = document.createElement("div");
        inputWrap.className = "saq-answer-input-wrap";
        block.appendChild(inputWrap);
      }

      const valStr = typeof userSelection === "string" ? userSelection : "";

      inputWrap.innerHTML = `
        <label class="saq-input-label" for="saq-text-input-${question.number}">Your Answer:</label>
        <div class="saq-input-row">
          <input type="text"
                 id="saq-text-input-${question.number}"
                 class="saq-text-input"
                 data-q="${index}"
                 data-type="text"
                 placeholder="Type short answer"
                 value="${escapeHtml(valStr)}"
                 autocomplete="off"
                 spellcheck="false" />
          <button type="button" class="saq-btn saq-btn-sm saq-btn-clear" data-act="clear-input" data-q="${index}" title="Clear answer">Clear</button>
        </div>
      `;
    } else {
      let notice = block.querySelector(".saq-unsupported-notice");
      if (!notice) {
        notice = document.createElement("div");
        notice.className = "saq-unsupported-notice";
        notice.innerHTML = `${ICONS.info}<span>Descriptive question — review and answer directly in IITM portal.</span>`;
        block.appendChild(notice);
      }
    }
  };

  /**
   * Enhances all question blocks in the active sheet.
   */
  const enhanceAllQuestionBlocks = () => {
    const sheet = reader.sheetElement;
    if (!sheet || !reader.documentModel) return;

    sheet.querySelectorAll(".saq-block").forEach((block) => {
      const index = Number(block.dataset.q);
      const question = reader.documentModel.questions?.[index];
      if (question) {
        updateQuestionBlock(block, question, index);
      }
    });

    renderQuestionRail();
    updateReadyBadge();
  };

  const renderImportIssues = (result) => {
    const node = importPanel();
    if (!node) return;
    const results = node.querySelector("[data-import-results]");
    const issues = node.querySelector("[data-import-issues]");
    const replaced = node.querySelector("[data-import-replaced]");
    const clear = node.querySelector("[data-act='import-clear']");
    if (!results || !issues || !replaced) return;

    if (result.fatal) {
      results.textContent = result.fatal;
      results.dataset.tone = "error";
    } else {
      const answered = result.entries.filter((e) => e.status === "answered").length;
      const missing = result.entries.filter((e) => e.status === "missing").length;
      const invalid = result.entries.filter((e) => e.status === "invalid").length;
      results.textContent = `✓ ${answered} answered · ${missing} missing · ${invalid} invalid`;
      results.dataset.tone = invalid > 0 ? "warn" : "success";
    }

    issues.replaceChildren();
    for (const item of result.issues || []) {
      const row = document.createElement("li");
      row.textContent = `Q${item.number}: ${item.reason}`;
      issues.appendChild(row);
    }
    replaced.textContent = result.replaced?.length
      ? `Updated existing: ${result.replaced.map((n) => `Q${n}`).join(", ")}`
      : "";
    if (clear) clear.hidden = !importedEntries.length;
  };

  const clearAnswers = (message = "") => {
    importedEntries = [];
    enhanceAllQuestionBlocks();
    const node = importPanel();
    if (node) {
      const resEl = node.querySelector("[data-import-results]");
      if (resEl) {
        resEl.textContent = message;
        resEl.removeAttribute("data-tone");
      }
      node.querySelector("[data-import-issues]")?.replaceChildren();
      const repEl = node.querySelector("[data-import-replaced]");
      if (repEl) repEl.textContent = "";
      const clrEl = node.querySelector("[data-act='import-clear']");
      if (clrEl) clrEl.hidden = true;
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => clearAnswers());
  }

  const openImport = () => {
    closeApplyDialog({ restoreFocus: false });
    const node = importPanel();
    if (!node) return;
    node.removeAttribute("hidden");
    importTrigger()?.setAttribute("aria-expanded", "true");
    const textarea = node.querySelector("textarea");
    textarea?.focus?.({ preventScroll: true });
  };

  const closeImport = ({ restoreFocus = true } = {}) => {
    const node = importPanel();
    if (!node || node.hasAttribute("hidden")) return;
    node.setAttribute("hidden", "");
    importTrigger()?.setAttribute("aria-expanded", "false");
    if (restoreFocus) importTrigger()?.focus?.({ preventScroll: true });
  };

  const openApplyDialog = () => {
    closeImport({ restoreFocus: false });
    const dialog = applyDialog();
    if (!dialog || !reader.documentModel) return;

    const summary = summarizeReviewState(reader.documentModel, userSelections, getAiEntriesMap());

    const readyEl = dialog.querySelector("[data-summary-ready]");
    const matchedEl = dialog.querySelector("[data-summary-matched]");
    const userEl = dialog.querySelector("[data-summary-user]");
    const unansweredEl = dialog.querySelector("[data-summary-unanswered]");
    const issuesEl = dialog.querySelector("[data-summary-issues]");
    const issuesText = dialog.querySelector("[data-summary-issues-text]");
    const confirmBtn = dialog.querySelector("[data-act='apply-confirm']");

    if (readyEl) readyEl.textContent = String(summary.ready);
    if (matchedEl) matchedEl.textContent = String(summary.aiMatched);
    if (userEl) userEl.textContent = String(summary.userOverridden + summary.userSelected);
    if (unansweredEl) unansweredEl.textContent = String(summary.unanswered);

    if (issuesEl && issuesText) {
      if (summary.issues.length > 0) {
        issuesText.textContent = `${summary.issues.length} question(s) have invalid entries and will be skipped.`;
        issuesEl.removeAttribute("hidden");
      } else {
        issuesEl.setAttribute("hidden", "");
        issuesText.textContent = "";
      }
    }

    if (confirmBtn) {
      confirmBtn.removeAttribute("disabled");
      confirmBtn.removeAttribute("aria-busy");
      confirmBtn.classList.remove("is-busy");
    }

    dialog.removeAttribute("hidden");
    applyTrigger()?.setAttribute("aria-expanded", "true");

    const target = confirmBtn || dialog.querySelector(".saq-dialog-content");
    target?.focus?.({ preventScroll: true });
  };

  const closeApplyDialog = ({ restoreFocus = true } = {}) => {
    const dialog = applyDialog();
    if (!dialog || dialog.hasAttribute("hidden")) return;
    dialog.setAttribute("hidden", "");
    applyTrigger()?.setAttribute("aria-expanded", "false");
    if (restoreFocus) applyTrigger()?.focus?.({ preventScroll: true });
  };

  const confirmApply = async () => {
    const dialog = applyDialog();
    const confirmBtn = dialog?.querySelector("[data-act='apply-confirm']");
    if (confirmBtn) {
      confirmBtn.setAttribute("disabled", "true");
      confirmBtn.setAttribute("aria-busy", "true");
      confirmBtn.classList.add("is-busy");
    }

    try {
      const portal = reader.portal || reader.shadowHost?.portal;
      const traverser =
        reader.portalTraverser ||
        reader.shadowHost?.runtime?.traverser ||
        (portal && typeof QuestionTraverser === "function" ? new QuestionTraverser(portal) : null);

      const result = await applyAnswersToPortal({
        portal,
        traverser,
        documentModel: reader.documentModel,
        selectionsMap: userSelections,
        aiEntriesMap: getAiEntriesMap(),
      });

      closeApplyDialog({ restoreFocus: true });

      if (result.ok) {
        reader.notify?.(
          `Applied ${result.appliedCount} answer${result.appliedCount === 1 ? "" : "s"} to IITM portal.`,
          "success",
          4000
        );
      } else {
        reader.notify?.(result.error || "Failed to apply answers to portal.", "error", 4000);
      }

      enhanceAllQuestionBlocks();
      updateReadyBadge();
    } catch (err) {
      closeApplyDialog({ restoreFocus: true });
      reader.notify?.("Error applying answers to portal: " + (err?.message || err), "error", 4000);
    }
  };

  const applySingleAi = (index) => {
    const question = reader.documentModel?.questions?.[index];
    if (!question) return;
    const aiEntry = getAiEntriesMap().get(question.number);
    if (!aiEntry || aiEntry.status !== "answered" || aiEntry.answer === null) return;

    const isMsq = isMsqType(question.type);
    const isNum = isNumericalType(question.type);
    const isTxt = isTextType(question.type);
    let val;

    if (isMsq) {
      const arr = Array.isArray(aiEntry.answer) ? aiEntry.answer : [aiEntry.answer];
      val = [
        ...new Set(
          arr.map((s) =>
            String(s).replace(/^[\s(]+|[.\s):]+$/g, "").trim().toUpperCase()
          )
        ),
      ].sort();
    } else if (isNum || isTxt) {
      val = String(aiEntry.answer);
    } else {
      val = String(aiEntry.answer).replace(/^[\s(]+|[.\s):]+$/g, "").trim().toUpperCase();
    }

    userSelections.set(question.number, val);

    const block = reader.sheetElement?.querySelector(`#saq-q-${index}`);
    if (block) {
      updateQuestionBlock(block, question, index);
    }
    renderQuestionRail();
    updateReadyBadge();

    // Real-time live sync to IITM Portal
    syncQuestionToPortal(question, val);
  };

  const applyAllAi = () => {
    let appliedCount = 0;
    for (let index = 0; index < (reader.documentModel?.questions || []).length; index++) {
      const question = reader.documentModel.questions[index];
      const aiEntry = getAiEntriesMap().get(question?.number);
      if (aiEntry && aiEntry.status === "answered" && aiEntry.answer !== null) {
        applySingleAi(index);
        appliedCount++;
      }
    }
    if (appliedCount > 0) {
      reader.notify?.(`Applied AI suggestions to ${appliedCount} question${appliedCount === 1 ? "" : "s"}.`, "success", 3000);
    } else {
      reader.notify?.("No valid AI suggestions available to apply.", "info", 3000);
    }
  };

  const importAnswersFromText = (text, { autoClose = false } = {}) => {
    const result = parseAnswerKey(text, reader.documentModel, {
      existing: importedEntries.length ? { fp: currentFingerprint, entries: importedEntries } : null,
    });
    if (result.ok) {
      importedEntries = result.entries;
      currentFingerprint = assignmentFingerprint(reader.documentModel);
      enhanceAllQuestionBlocks();
      reader.notify?.("Imported and validated AI answers.", "success", 3000);
      if (autoClose) {
        closeImport({ restoreFocus: true });
      }
    }
    renderImportIssues(result);
  };

  const importAnswers = () => {
    const node = importPanel();
    const textarea = node?.querySelector("textarea");
    if (!node || !textarea) return;
    importAnswersFromText(textarea.value);
  };

  const pasteAndImportFromClipboard = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.readText === "function") {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          const node = importPanel();
          const textarea = node?.querySelector("textarea");
          if (textarea) textarea.value = text;
          importAnswersFromText(text, { autoClose: true });
          return;
        }
      }
    } catch (_err) {
      // Clipboard read rejected / unsupported
    }

    // If direct read failed or empty, guide user to manual paste
    reader.notify?.("Clipboard read unavailable. Please paste your response in the box below.", "info", 4000);
    const textarea = importPanel()?.querySelector("textarea");
    textarea?.focus();
  };

  const copyAiPromptAction = (btn) => {
    if (typeof generateAiPrompt === "function" && reader.documentModel) {
      const scope = selectedQuestions.size === reader.documentModel.questions.length || selectedQuestions.size === 0
        ? null
        : { type: "custom", numbers: Array.from(selectedQuestions) };

      const promptResult = generateAiPrompt(reader.documentModel, { scope });
      if (promptResult?.prompt) {
        reader.writeClipboardText(promptResult.prompt).then((ok) => {
          if (ok) {
            reader.notify?.("AI Prompt copied to clipboard. Ready to paste into ChatGPT, Claude, or Gemini.", "success", 4000);

            if (btn) {
              const origText = btn.innerHTML;
              btn.innerHTML = `${ICONS.check}<span>Copied!</span>`;
              setTimeout(() => {
                if (btn && btn.isConnected) btn.innerHTML = origText;
              }, 2000);
            }
          } else {
            reader.notify?.("Failed to copy prompt to clipboard", "error", 3000);
          }
        });
      }
    }
  };

  // Attach reference to reader
  reader._readerImportFeature = {
    isOpen,
    close: ({ restoreFocus = true } = {}) => {
      closeImport({ restoreFocus: false });
      closeApplyDialog({ restoreFocus });
    },
    clear: clearAnswers,
    userSelections,
    selectedQuestions,
    applySingleAi,
    applyAllAi,
  };

  return {
    renderHeaderActions({ sheet, documentModel }) {
      initSelectionsFromDocument(documentModel);

      // 1. Construct the exact top-bar actions with pristine visual hierarchy
      const actionsContainer = sheet.querySelector(".saq-actions");
      if (actionsContainer) {
        actionsContainer.innerHTML = `
          <span class="saq-clock" title="Time remaining">${ICONS.clock}<span class="saq-clock-val"></span></span>
          <button type="button" class="saq-btn saq-btn-secondary" data-act="import-answers" aria-label="Import AI Response" title="Import structured AI response">
            ${IMPORT_ICONS.import}
            <span>Import</span>
          </button>
          <button type="button" class="saq-btn saq-btn-primary" data-act="copy-questions" aria-label="Copy AI Prompt" title="Copy LLM-optimized prompt with questions">
            ${ICONS.copy}
            <span>Copy Prompt</span>
          </button>
          <div class="saq-split-btn-group" id="saq-export-split">
            <button type="button" class="saq-btn saq-btn-secondary saq-split-main" data-act="copy-md-clipboard" aria-label="Copy Markdown" title="Copy assignment as Markdown">
              ${ICONS.markdown}
              <span>Copy</span>
            </button>
            <button type="button" class="saq-btn saq-btn-secondary saq-split-arrow" data-act="toggle-export-menu" aria-label="More download formats" aria-haspopup="menu" aria-expanded="false" title="Download formats (PDF, Markdown, Bundle)">
              ${ICONS.chevronDown}
            </button>
            <div class="saq-dropdown-menu" id="saq-export-menu" role="menu" hidden>
              <button type="button" class="saq-dropdown-item" data-act="print" role="menuitem" title="Download as PDF">
                ${ICONS.print}
                <span>Download PDF</span>
              </button>
              <button type="button" class="saq-dropdown-item" data-act="export-md" role="menuitem" title="Download as Markdown">
                ${ICONS.markdown}
                <span>Download Markdown</span>
              </button>
              <button type="button" class="saq-dropdown-item" data-act="export-bundle" role="menuitem" title="Download ZIP Bundle">
                ${ICONS.bundle}
                <span>Download Bundle</span>
              </button>
            </div>
          </div>
          <button type="button" class="saq-btn saq-btn-secondary" data-act="refresh" aria-label="Refresh questions from assessment" title="Re-read questions from assessment">${ICONS.refresh}<span>Refresh</span></button>
          <button type="button" class="saq-btn saq-icon" data-act="theme" aria-label="Toggle dark theme" title="Toggle theme">${ICONS.theme}</button>
          <button type="button" class="saq-btn saq-icon saq-btn-close" data-act="dismiss" aria-label="Close reader" title="Close reader (Esc)">${ICONS.close}</button>
          <button type="button" class="saq-btn-apply" data-act="apply-answers" hidden aria-hidden="true"><span class="saq-btn-badge" data-ready-badge hidden>0</span></button>
        `;

        const exportMenu = actionsContainer.querySelector("#saq-export-menu");
        if (exportMenu) {
          exportMenu.querySelectorAll(".saq-dropdown-item").forEach((item) => {
            item.addEventListener("click", (e) => {
              e.preventDefault();
              e.stopPropagation();
              exportMenu.hidden = true;
              exportMenu.setAttribute("hidden", "");
              const splitArrow = sheet.querySelector("[data-act='toggle-export-menu']");
              if (splitArrow) splitArrow.setAttribute("aria-expanded", "false");
              const act = item.dataset.act;
              if (act === "print") {
                if (typeof generateAiPrompt === "function" && reader.documentModel) {
                  const promptResult = generateAiPrompt(reader.documentModel);
                  if (promptResult?.prompt) {
                    reader.writeClipboardText?.(promptResult.prompt);
                  }
                }
                if (reader.onExportCallback) {
                  reader.onExportCallback("pdf");
                } else if (typeof exportPdf === "function" && reader.documentModel) {
                  exportPdf(reader.documentModel, {
                    onFallback: () => reader.setPdfFallbackMode?.(true),
                  }).catch((err) => {
                    console.error("[Acadrix] PDF export failed, falling back to window.print():", err);
                    reader.setPdfFallbackMode?.(true);
                    reader.printFallbackWithTitle?.(reader.documentModel);
                  });
                } else {
                  reader.printFallbackWithTitle?.(reader.documentModel);
                }
              } else if (act === "export-md") {
                if (reader.onExportCallback) {
                  reader.onExportCallback("markdown");
                } else if (typeof exportAssignmentToMarkdown === "function" && reader.documentModel) {
                  const md = exportAssignmentToMarkdown(reader.documentModel);
                  if (md) {
                    const filename = buildExportFilename(reader.documentModel.metadata || {}, "markdown");
                    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                    reader.notify?.("Markdown file downloaded", "success", 3000);
                  }
                }
              } else if (act === "export-bundle") {
                if (reader.onExportCallback) {
                  reader.onExportCallback("bundle");
                } else {
                  reader.notify?.("Bundle export is available in the Acadrix extension", "info", 3000);
                }
              }
            });
          });
        }
      }

      // 2. Mount Intelligent Question Navigation Rail
      renderQuestionRail();

      // 3. Mount Import Response Modal Dialog
      let panelEl = sheet.querySelector("#saq-import-panel");
      if (!panelEl) {
        const container = document.createElement("div");
        container.innerHTML = `
          <aside id="saq-import-panel" class="saq-dialog-modal saq-import-dialog" role="dialog" aria-modal="true" aria-labelledby="saq-import-title" hidden>
            <div class="saq-dialog-backdrop" data-act="import-close"></div>
            <div class="saq-dialog-content">
              <header class="saq-dialog-head">
                <div class="saq-dialog-head-title">
                  <span class="saq-dialog-step-tag">Step 3</span>
                  <span id="saq-import-title" class="saq-dialog-title">Import AI Response</span>
                </div>
                <button type="button" class="saq-btn saq-icon saq-dialog-close" data-act="import-close" aria-label="Close" title="Close (Esc)">${ICONS.close}</button>
              </header>
              <section class="saq-import-body">
                <div class="saq-import-clipboard-row">
                  <button type="button" class="saq-btn saq-btn-primary saq-btn-paste-clipboard" data-act="import-paste-clipboard" title="Read clipboard and import immediately">
                    ${IMPORT_ICONS.clipboard}<span>Paste from Clipboard & Validate</span>
                  </button>
                  <span class="saq-import-or-divider">or paste response manually:</span>
                </div>
                <label class="saq-import-label sr-only" for="saq-import-text">AI JSON Response</label>
                <textarea id="saq-import-text" class="saq-import-textarea" spellcheck="false" autocomplete="off" placeholder='Paste AI JSON response here...'></textarea>
                <div class="saq-import-actions">
                  <button type="button" class="saq-btn saq-btn-primary" data-act="import-submit">Validate & Review</button>
                  <button type="button" class="saq-btn saq-btn-secondary" data-act="import-clear" hidden>Clear</button>
                </div>
                <output class="saq-import-results" data-import-results role="status" aria-live="polite" aria-atomic="true"></output>
                <ul class="saq-import-issues" data-import-issues></ul>
                <p class="saq-import-replaced" data-import-replaced></p>
              </section>
            </div>
          </aside>`;
        panelEl = container.firstElementChild || container.children?.[0];
        if (panelEl) sheet.appendChild(panelEl);
      }

      // 4. Mount Apply Answers Confirmation Dialog
      let dialogEl = sheet.querySelector("#saq-apply-dialog");
      if (!dialogEl) {
        const container = document.createElement("div");
        container.innerHTML = `
          <aside id="saq-apply-dialog" class="saq-dialog-modal" role="dialog" aria-modal="true" aria-labelledby="saq-apply-title" hidden>
            <div class="saq-dialog-backdrop" data-act="apply-cancel"></div>
            <div class="saq-dialog-content">
              <header class="saq-dialog-head">
                <div class="saq-dialog-head-title">
                  <span class="saq-dialog-step-tag">Step 5</span>
                  <span id="saq-apply-title" class="saq-dialog-title">Apply Answers to IITM Portal</span>
                </div>
                <button type="button" class="saq-btn saq-icon saq-dialog-close" data-act="apply-cancel" aria-label="Close dialog" title="Close (Esc)">${ICONS.close}</button>
              </header>
              <div class="saq-dialog-body">
                <div class="saq-apply-summary-grid">
                  <div class="saq-summary-card is-ready">
                    <span class="saq-summary-num" data-summary-ready>0</span>
                    <span class="saq-summary-lbl">Ready to Apply</span>
                  </div>
                  <div class="saq-summary-card is-matched">
                    <span class="saq-summary-num" data-summary-matched>0</span>
                    <span class="saq-summary-lbl">AI Matched</span>
                  </div>
                  <div class="saq-summary-card is-overridden">
                    <span class="saq-summary-num" data-summary-user>0</span>
                    <span class="saq-summary-lbl">User Edited</span>
                  </div>
                  <div class="saq-summary-card">
                    <span class="saq-summary-num" data-summary-unanswered>0</span>
                    <span class="saq-summary-lbl">Unanswered</span>
                  </div>
                </div>
                <div class="saq-apply-issues-warn" data-summary-issues hidden>
                  ${ICONS.warn}<span data-summary-issues-text></span>
                </div>
                <p class="saq-apply-notice">
                  ${ICONS.info}
                  <span>Applies selected answers directly to the active IITM portal form controls without submitting the assessment.</span>
                </p>
              </div>
              <footer class="saq-dialog-footer">
                <button type="button" class="saq-btn saq-btn-secondary" data-act="apply-cancel">Cancel</button>
                <button type="button" class="saq-btn saq-btn-primary" data-act="apply-confirm">${IMPORT_ICONS.apply}<span>Apply to Portal</span></button>
              </footer>
            </div>
          </aside>`;
        dialogEl = container.firstElementChild || container.children?.[0];
        if (dialogEl) sheet.appendChild(dialogEl);
      }

      // 5. Wire input & change listeners for numerical and text inputs
      sheet.addEventListener("input", (e) => {
        const input = e.target.closest?.(".saq-num-input, .saq-text-input");
        if (!input) return;
        const index = Number(input.dataset.q);
        const question = reader.documentModel?.questions?.[index];
        if (!question) return;

        userSelections.set(question.number, input.value);
        const block = sheet.querySelector(`#saq-q-${index}`);
        if (block) {
          const aiEntry = getAiEntriesMap().get(question.number);
          const state = computeAnswerState({ type: question.type, aiEntry, userSelection: input.value });
          const config = STATUS_CONFIG[state] || STATUS_CONFIG[AnswerState.UNANSWERED];
          const badge = block.querySelector(".saq-status-badge");
          if (badge) {
            badge.className = `saq-status-badge ${config.badgeClass}`;
            badge.textContent = config.label;
          }

          if (input.classList.contains("saq-num-input")) {
            const isNumInvalid = input.value.trim() !== "" && !isValidNumerical(input.value);
            input.classList.toggle("is-invalid", isNumInvalid);
            let errorEl = block.querySelector(".saq-input-error");
            if (isNumInvalid) {
              if (!errorEl) {
                errorEl = document.createElement("span");
                errorEl.className = "saq-input-error";
                errorEl.textContent = "Please enter a valid decimal or scientific number";
                input.parentNode.parentNode.appendChild(errorEl);
              }
            } else if (errorEl) {
              errorEl.remove();
            }
          }
        }
        renderQuestionRail();
        updateReadyBadge();
        syncQuestionToPortal(question, input.value, { debounceMs: 300 });
      });

      sheet.addEventListener("change", (e) => {
        const input = e.target.closest?.(".saq-num-input, .saq-text-input");
        if (!input) return;
        const index = Number(input.dataset.q);
        const question = reader.documentModel?.questions?.[index];
        if (!question) return;
        userSelections.set(question.number, input.value);
        syncQuestionToPortal(question, input.value, { debounceMs: 0 });
      });

      // 6. Live bidirectional sync: detect external answer changes in portal while Reader is open
      if (portalActivityHandler && typeof document !== "undefined") {
        document.removeEventListener("click", portalActivityHandler, { capture: true });
        document.removeEventListener("change", portalActivityHandler, { capture: true });
      }

      portalActivityHandler = () => {
        if (!reader.isOpen?.() || !reader.documentModel || isSyncingToPortal) return;
        const portal = reader.portal || reader.shadowHost?.portal;
        const activeNum = portal?.getActiveLogicalNumber?.();
        if (!activeNum) return;
        const qRoot = portal.getCurrentQuestionElement?.();
        if (!qRoot) return;
        const question = reader.documentModel.questions?.find((q) => q.number === activeNum);
        if (!question) return;

        const isMsq = isMsqType(question.type);
        const isNum = isNumericalType(question.type);
        const isTxt = isTextType(question.type);
        const hasOptions = Array.isArray(question.options) && question.options.length > 0;
        const isMcq = isMcqType(question.type) || (!isMsq && hasOptions);

        if (isMcq) {
          const choices = Array.from(qRoot.querySelectorAll("button.choice, [role=radio], .choice"));
          let selectedLetter = null;
          for (let i = 0; i < choices.length; i++) {
            const ch = choices[i];
            const isChecked =
              ch.getAttribute("aria-checked") === "true" ||
              ch.getAttribute("aria-selected") === "true" ||
              ch.getAttribute("checked") === "true" ||
              (ch.hasAttribute("checked") && ch.getAttribute("checked") !== "false") ||
              ch.classList.contains("selected") ||
              ch.classList.contains("is-selected") ||
              ch.classList.contains("active") ||
              Boolean(ch.querySelector("input:checked, .radio.checked, .choice-indicator.checked"));
            if (isChecked) {
              const letterEl = ch.querySelector?.(".choice-letter, .letter");
              selectedLetter = letterEl ? letterEl.textContent.trim().replace(/^[\s(]+|[.\s):]+$/g, "").toUpperCase() : String.fromCharCode(65 + i);
              break;
            }
          }
          if (selectedLetter !== null && selectedLetter !== userSelections.get(question.number)) {
            userSelections.set(question.number, selectedLetter);
            const index = reader.documentModel.questions.indexOf(question);
            const block = sheet.querySelector(`#saq-q-${index}`);
            if (block) updateQuestionBlock(block, question, index);
            renderQuestionRail();
            updateReadyBadge();
          }
        } else if (isMsq) {
          const choices = Array.from(qRoot.querySelectorAll("button.choice, [role=checkbox], [role=radio], .choice"));
          const selectedLetters = [];
          for (let i = 0; i < choices.length; i++) {
            const ch = choices[i];
            const isChecked =
              ch.getAttribute("aria-checked") === "true" ||
              ch.getAttribute("aria-selected") === "true" ||
              ch.getAttribute("checked") === "true" ||
              (ch.hasAttribute("checked") && ch.getAttribute("checked") !== "false") ||
              ch.classList.contains("selected") ||
              ch.classList.contains("is-selected") ||
              ch.classList.contains("active") ||
              Boolean(ch.querySelector("input:checked, .checkbox.checked, .radio.checked, .choice-indicator.checked"));
            if (isChecked) {
              const letterEl = ch.querySelector?.(".choice-letter, .letter");
              const letter = letterEl ? letterEl.textContent.trim().replace(/^[\s(]+|[.\s):]+$/g, "").toUpperCase() : String.fromCharCode(65 + i);
              selectedLetters.push(letter);
            }
          }
          selectedLetters.sort();
          const currentLetters = (userSelections.get(question.number) || []).slice().sort();
          if (JSON.stringify(selectedLetters) !== JSON.stringify(currentLetters)) {
            userSelections.set(question.number, selectedLetters);
            const index = reader.documentModel.questions.indexOf(question);
            const block = sheet.querySelector(`#saq-q-${index}`);
            if (block) updateQuestionBlock(block, question, index);
            renderQuestionRail();
            updateReadyBadge();
          }
        } else if (isNum || isTxt) {
          const inputEl = qRoot.querySelector(
            "textarea[inputmode='decimal'], textarea[inputmode='numeric'], textarea.textarea-field, app-textarea textarea, textarea, input[type=number], input[inputmode='decimal'], input[type=text]"
          );
          if (inputEl && inputEl.value !== undefined && inputEl.value !== userSelections.get(question.number)) {
            userSelections.set(question.number, inputEl.value);
            const index = reader.documentModel.questions.indexOf(question);
            const block = sheet.querySelector(`#saq-q-${index}`);
            if (block) {
              const numInput = block.querySelector(".saq-num-input, .saq-text-input");
              if (numInput && numInput !== document.activeElement && numInput.value !== inputEl.value) {
                numInput.value = inputEl.value;
              }
              updateQuestionBlock(block, question, index);
            }
            renderQuestionRail();
            updateReadyBadge();
          }
        }
      };

      if (typeof document !== "undefined") {
        document.addEventListener("click", portalActivityHandler, { capture: true, passive: true });
        document.addEventListener("change", portalActivityHandler, { capture: true, passive: true });
      }

      enhanceAllQuestionBlocks();
    },

    handleActionClick(e) {
      // 0. Image & Diagram Click -> Open Expand View Lightbox
      const expandImgTrigger = e.target.closest?.("img, .saq-svg-wrap, [data-act='expand-image']");
      if (expandImgTrigger && !e.target.closest?.("button:not([data-act='expand-image']), a, input, textarea")) {
        const img = expandImgTrigger.tagName === "IMG" ? expandImgTrigger : expandImgTrigger.querySelector?.("img");
        const svgWrap = expandImgTrigger.classList?.contains("saq-svg-wrap") ? expandImgTrigger : expandImgTrigger.querySelector?.(".saq-svg-wrap");
        if (img && img.src && !img.closest?.(".saq-lightbox")) {
          e.preventDefault();
          e.stopPropagation();
          const figure = img.closest?.("figure");
          const caption = figure?.querySelector?.("figcaption")?.textContent || img.title || "";
          reader.openLightbox?.({ src: img.src, alt: img.alt || caption, caption });
          return true;
        }
        if (svgWrap && !svgWrap.closest?.(".saq-lightbox")) {
          e.preventDefault();
          e.stopPropagation();
          const figure = svgWrap.closest?.("figure");
          const caption = figure?.querySelector?.("figcaption")?.textContent || "";
          reader.openLightbox?.({ svgHtml: svgWrap.innerHTML, alt: caption || "Diagram", caption });
          return true;
        }
      }
      // 1. Question Selection Toggle
      const qSelectBtn = e.target.closest?.("[data-act='toggle-qselect']");
      if (qSelectBtn) {
        e.preventDefault();
        e.stopPropagation();
        const blockEl = qSelectBtn.closest(".saq-block");
        const index = Number(qSelectBtn.dataset.q ?? blockEl?.dataset.q);
        const question = reader.documentModel?.questions?.[index];
        if (question) {
          const qNum = Number(question.number) || (index + 1);
          if (selectedQuestions.has(qNum) || selectedQuestions.has(question.number)) {
            selectedQuestions.delete(qNum);
            if (question.number !== undefined) selectedQuestions.delete(question.number);
          } else {
            selectedQuestions.add(qNum);
            if (question.number !== undefined) selectedQuestions.add(question.number);
          }
          if (blockEl) updateQuestionBlock(blockEl, question, index);
          renderQuestionRail();
        }
        return true;
      }

      // 2. Interactive Option clicks
      const optBtn = e.target.closest?.(".saq-option, [data-letter]");
      if (optBtn) {
        e.preventDefault();
        e.stopPropagation();
        const blockEl = optBtn.closest(".saq-block");
        const indexStr = optBtn.dataset.q ?? blockEl?.dataset.q ?? blockEl?.id?.replace(/^saq-q-/, "");
        const index = Number(indexStr);
        const rawLetter =
          optBtn.dataset.letter ||
          optBtn.querySelector(".saq-opt-letter")?.textContent ||
          optBtn.textContent;
        const letter = String(rawLetter || "")
          .replace(/^[\s(]+|[.\s):]+$/g, "")
          .trim()
          .toUpperCase();
        const question =
          reader.documentModel?.questions?.[index] ||
          reader.documentModel?.questions?.find((q) => q.number === index || q.number === index + 1);
        if (!question || !letter) return true;

        const isMsq = isMsqType(question.type);
        let newSelection;
        if (isMsq) {
          let currentList = userSelections.get(question.number) || [];
          if (!Array.isArray(currentList))
            currentList = currentList ? [String(currentList)] : [];
          currentList = currentList
            .map((s) => String(s).replace(/^[\s(]+|[.\s):]+$/g, "").trim().toUpperCase())
            .filter(Boolean);
          if (currentList.includes(letter)) {
            currentList = currentList.filter((l) => l !== letter);
          } else {
            currentList = [...currentList, letter].sort();
          }
          newSelection = currentList;
          userSelections.set(question.number, newSelection);
        } else {
          // MCQ / Single Choice
          newSelection = letter;
          userSelections.set(question.number, newSelection);
        }

        const block = blockEl || reader.sheetElement?.querySelector(`#saq-q-${index}`);
        if (block) {
          updateQuestionBlock(block, question, index);
        }
        renderQuestionRail();
        updateReadyBadge();

        // Real-time live sync to IITM Portal
        syncQuestionToPortal(question, newSelection);
        return true;
      }

      // Outside dropdown / dialog handling
      const splitGroup = reader.sheetElement?.querySelector("#saq-export-split");
      const exportMenu = reader.sheetElement?.querySelector("#saq-export-menu");
      const splitArrow = reader.sheetElement?.querySelector("[data-act='toggle-export-menu']");
      if (exportMenu && !exportMenu.hasAttribute("hidden") && !exportMenu.hidden && splitGroup && !splitGroup.contains(e.target)) {
        exportMenu.hidden = true;
        exportMenu.setAttribute("hidden", "");
        if (splitArrow) splitArrow.setAttribute("aria-expanded", "false");
      }

      // 3. Action buttons
      const btn = e.target.closest?.("[data-act]");
      if (!btn) {
        if (isImportOpen() && !importPanel()?.querySelector(".saq-dialog-content")?.contains(e.target)) closeImport({ restoreFocus: false });
        if (isApplyOpen() && !applyDialog()?.querySelector(".saq-dialog-content")?.contains(e.target)) closeApplyDialog({ restoreFocus: false });
        return false;
      }

      const action = btn.dataset.act;

      // Jump to Question in Viewport
      if (action === "jump-to-q") {
        e.preventDefault();
        const index = Number(btn.dataset.qIndex ?? btn.dataset.q);
        const blockEl = reader.sheetElement?.querySelector(`#saq-q-${index}`);
        if (blockEl) {
          blockEl.scrollIntoView({ behavior: "smooth", block: "start" });
          activeQuestionIndex = index;
          updateActivePill(index);
        }
        return true;
      }

      // Toggle Export dropdown
      if (action === "toggle-export-menu") {
        e.preventDefault();
        e.stopPropagation();
        if (exportMenu) {
          const isExpanded = btn.getAttribute("aria-expanded") === "true";
          btn.setAttribute("aria-expanded", String(!isExpanded));
          exportMenu.hidden = isExpanded;
          if (isExpanded) {
            exportMenu.setAttribute("hidden", "");
          } else {
            exportMenu.removeAttribute("hidden");
          }
        }
        return true;
      }

      // Lightbox Controls
      if (action === "close-lightbox") {
        e.preventDefault();
        e.stopPropagation();
        reader.closeLightbox?.();
        return true;
      }
      if (action === "lightbox-zoom-in") {
        e.preventDefault();
        const vp = reader.shadowHost?.root?.querySelector("#saq-lightbox-viewport");
        if (vp) {
          const cur = Number(vp.dataset.zoom || 1);
          const next = Math.min(3, cur + 0.25);
          vp.dataset.zoom = String(next);
          vp.style.transform = `scale(${next})`;
        }
        return true;
      }
      if (action === "lightbox-zoom-out") {
        e.preventDefault();
        const vp = reader.shadowHost?.root?.querySelector("#saq-lightbox-viewport");
        if (vp) {
          const cur = Number(vp.dataset.zoom || 1);
          const next = Math.max(0.5, cur - 0.25);
          vp.dataset.zoom = String(next);
          vp.style.transform = `scale(${next})`;
        }
        return true;
      }
      if (action === "lightbox-zoom-reset") {
        e.preventDefault();
        const vp = reader.shadowHost?.root?.querySelector("#saq-lightbox-viewport");
        if (vp) {
          vp.dataset.zoom = "1";
          vp.style.transform = "scale(1)";
        }
        return true;
      }

      // Text Zoom Controls
      if (action === "zoom-in") {
        e.preventDefault();
        applyZoom(currentZoomIndex + 1);
        return true;
      }
      if (action === "zoom-out") {
        e.preventDefault();
        applyZoom(currentZoomIndex - 1);
        return true;
      }
      if (action === "zoom-reset") {
        e.preventDefault();
        applyZoom(2); // 1.0
        return true;
      }

      // Question Selection Actions
      if (action === "select-all-q") {
        e.preventDefault();
        (reader.documentModel?.questions || []).forEach((q, idx) => {
          const qNum = Number(q.number) || (idx + 1);
          selectedQuestions.add(qNum);
          if (q.number !== undefined && q.number !== null) selectedQuestions.add(q.number);
        });
        enhanceAllQuestionBlocks();
        reader.notify?.("All questions selected", "info", 2000);
        return true;
      }

      if (action === "invert-qselect") {
        e.preventDefault();
        (reader.documentModel?.questions || []).forEach((q, idx) => {
          const qNum = Number(q.number) || (idx + 1);
          if (selectedQuestions.has(qNum) || selectedQuestions.has(q.number)) {
            selectedQuestions.delete(qNum);
            if (q.number !== undefined) selectedQuestions.delete(q.number);
          } else {
            selectedQuestions.add(qNum);
            if (q.number !== undefined) selectedQuestions.add(q.number);
          }
        });
        enhanceAllQuestionBlocks();
        reader.notify?.("Question selection inverted", "info", 2000);
        return true;
      }

      if (action === "clear-qselect") {
        e.preventDefault();
        selectedQuestions.clear();
        enhanceAllQuestionBlocks();
        reader.notify?.("All questions deselected", "info", 2000);
        return true;
      }

      // 1-Click Copy AI Prompt
      if (action === "copy-questions" || action === "copy-prompt") {
        e.preventDefault();
        if (exportMenu) {
          exportMenu.hidden = true;
          exportMenu.setAttribute("hidden", "");
          if (splitArrow) splitArrow.setAttribute("aria-expanded", "false");
        }
        copyAiPromptAction(btn);
        return true;
      }

      // 1-Click Copy Markdown
      if (action === "copy-md-clipboard") {
        e.preventDefault();
        if (exportMenu) {
          exportMenu.hidden = true;
          exportMenu.setAttribute("hidden", "");
          if (splitArrow) splitArrow.setAttribute("aria-expanded", "false");
        }
        if (typeof exportAssignmentToMarkdown === "function" && reader.documentModel) {
          const md = exportAssignmentToMarkdown(reader.documentModel);
          if (md) {
            reader.writeClipboardText?.(md).then((ok) => {
              if (ok) {
                reader.notify?.("Markdown copied to clipboard", "success", 3000);
              } else {
                reader.notify?.("Failed to copy Markdown to clipboard", "error", 3000);
              }
            });
          }
        }
        return true;
      }

      // Import Answers Panel
      if (action === "import-answers") {
        e.preventDefault();
        openImport();
        return true;
      }
      if (action === "import-close") {
        e.preventDefault();
        closeImport();
        return true;
      }
      if (action === "import-submit") {
        e.preventDefault();
        importAnswers();
        return true;
      }
      if (action === "import-paste-clipboard") {
        e.preventDefault();
        pasteAndImportFromClipboard();
        return true;
      }
      if (action === "import-clear") {
        e.preventDefault();
        clearAnswers("Answers cleared.");
        return true;
      }

      // Apply Answers Modal Dialog
      if (action === "apply-answers") {
        e.preventDefault();
        openApplyDialog();
        return true;
      }
      if (action === "apply-cancel") {
        e.preventDefault();
        closeApplyDialog();
        return true;
      }
      if (action === "apply-confirm") {
        e.preventDefault();
        confirmApply();
        return true;
      }

      // Download PDF (Atomic PDF Export + Prompt Copy)
      if (action === "print") {
        e.preventDefault();
        if (exportMenu) {
          exportMenu.hidden = true;
          exportMenu.setAttribute("hidden", "");
          if (splitArrow) splitArrow.setAttribute("aria-expanded", "false");
        }
        if (typeof generateAiPrompt === "function" && reader.documentModel) {
          const promptResult = generateAiPrompt(reader.documentModel);
          if (promptResult?.prompt) {
            reader.writeClipboardText?.(promptResult.prompt);
          }
        }
        if (reader.onExportCallback) {
          reader.onExportCallback("pdf");
        } else if (typeof exportPdf === "function" && reader.documentModel) {
          exportPdf(reader.documentModel, {
            onFallback: () => reader.setPdfFallbackMode?.(true),
          }).catch((err) => {
            console.error("[Acadrix] PDF export failed, falling back to window.print():", err);
            reader.setPdfFallbackMode?.(true);
            reader.printFallbackWithTitle?.(reader.documentModel);
          });
        } else {
          reader.printFallbackWithTitle?.(reader.documentModel);
        }
        return true;
      }

      // Download Markdown file
      if (action === "export-md") {
        e.preventDefault();
        if (exportMenu) {
          exportMenu.hidden = true;
          exportMenu.setAttribute("hidden", "");
          if (splitArrow) splitArrow.setAttribute("aria-expanded", "false");
        }
        if (reader.onExportCallback) {
          reader.onExportCallback("markdown");
        } else if (typeof exportAssignmentToMarkdown === "function" && reader.documentModel) {
          const md = exportAssignmentToMarkdown(reader.documentModel);
          if (md) {
            const filename = buildExportFilename(reader.documentModel.metadata || {}, "markdown");
            const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            reader.notify?.("Markdown file downloaded", "success", 3000);
          }
        }
        return true;
      }

      // Download ZIP Bundle
      if (action === "export-bundle") {
        e.preventDefault();
        if (exportMenu) {
          exportMenu.hidden = true;
          exportMenu.setAttribute("hidden", "");
          if (splitArrow) splitArrow.setAttribute("aria-expanded", "false");
        }
        if (reader.onExportCallback) {
          reader.onExportCallback("bundle");
        } else {
          reader.notify?.("Bundle export is available in the Acadrix extension", "info", 3000);
        }
        return true;
      }

      // Single-Question AI Application
      if (action === "apply-single-ai") {
        e.preventDefault();
        const index = Number(btn.dataset.q);
        applySingleAi(index);
        return true;
      }

      // All-Questions AI Application
      if (action === "apply-all-ai") {
        e.preventDefault();
        applyAllAi();
        return true;
      }

      // Clear input button
      if (action === "clear-input") {
        e.preventDefault();
        const index = Number(btn.dataset.q);
        const question = reader.documentModel?.questions?.[index];
        if (question) {
          userSelections.set(question.number, "");
          const block = reader.sheetElement?.querySelector(`#saq-q-${index}`);
          if (block) {
            updateQuestionBlock(block, question, index);
          }
          renderQuestionRail();
          updateReadyBadge();
          syncQuestionToPortal(question, "");
        }
        return true;
      }

      return false;
    },

    handleKeydown(e) {
      if (e.key === "Escape") {
        if (reader.isLightboxOpen?.()) {
          e.preventDefault();
          e.stopPropagation();
          reader.closeLightbox?.();
          return true;
        }
        const exportMenu = reader.sheetElement?.querySelector("#saq-export-menu");
        const splitArrow = reader.sheetElement?.querySelector("[data-act='toggle-export-menu']");
        if (exportMenu && !exportMenu.hasAttribute("hidden") && !exportMenu.hidden) {
          e.preventDefault();
          e.stopPropagation();
          exportMenu.hidden = true;
          exportMenu.setAttribute("hidden", "");
          if (splitArrow) splitArrow.setAttribute("aria-expanded", "false");
          splitArrow?.focus?.();
          return true;
        }
        if (isApplyOpen()) {
          e.preventDefault();
          e.stopPropagation();
          closeApplyDialog();
          return true;
        }
        if (isImportOpen()) {
          e.preventDefault();
          e.stopPropagation();
          closeImport();
          return true;
        }
      }

      // Zoom Keyboard Shortcuts: Ctrl/Cmd + Plus/Minus/0
      if (e.metaKey || e.ctrlKey) {
        if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          applyZoom(currentZoomIndex + 1);
          return true;
        }
        if (e.key === "-" || e.key === "_") {
          e.preventDefault();
          applyZoom(currentZoomIndex - 1);
          return true;
        }
        if (e.key === "0") {
          e.preventDefault();
          applyZoom(2);
          return true;
        }
      }

      // Cmd+Enter / Ctrl+Enter in import textarea validates immediately
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && isImportOpen()) {
        e.preventDefault();
        importAnswers();
        return true;
      }

      // Keyboard navigation for radio/checkbox options inside reader
      const activeEl = reader.shadowHost?.root?.activeElement;
      if (activeEl?.classList?.contains("saq-option")) {
        const role = activeEl.getAttribute("role");
        const container = activeEl.closest(".saq-options");
        if (container) {
          const options = Array.from(container.querySelectorAll(".saq-option"));
          const currentIndex = options.indexOf(activeEl);

          if (role === "radio") {
            if (e.key === "ArrowDown" || e.key === "ArrowRight") {
              e.preventDefault();
              const nextIndex = (currentIndex + 1) % options.length;
              options[nextIndex].focus();
              options[nextIndex].click();
              return true;
            } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
              e.preventDefault();
              const prevIndex = (currentIndex - 1 + options.length) % options.length;
              options[prevIndex].focus();
              options[prevIndex].click();
              return true;
            }
          }
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            activeEl.click();
            return true;
          }
        }
      }

      return false;
    },

    documentChange({ documentModel } = {}) {
      const doc = documentModel || reader.documentModel;
      const nextFingerprint = assignmentFingerprint(doc);

      if (currentFingerprint && currentFingerprint !== nextFingerprint && importedEntries.length) {
        clearAnswers("Imported answers cleared: the assignment changed.");
        reader.notify?.("Imported answers cleared: the assignment changed.", "info", 5000);
      }
      currentFingerprint = nextFingerprint;
      initSelectionsFromDocument(doc);
      enhanceAllQuestionBlocks();
    },

    destroy({ preserveFeatureState = false } = {}) {
      if (reader._readerRebuilding) return;
      for (const timer of inputSyncDebounceTimers.values()) {
        clearTimeout(timer);
      }
      inputSyncDebounceTimers.clear();
      if (portalActivityHandler && typeof document !== "undefined") {
        document.removeEventListener("click", portalActivityHandler, { capture: true });
        document.removeEventListener("change", portalActivityHandler, { capture: true });
        portalActivityHandler = null;
      }
      if (!preserveFeatureState) {
        clearAnswers();
        userSelections.clear();
        selectedQuestions.clear();
        currentFingerprint = null;
      }
    },
  };
}

export function attachReaderImportFeatures() {}
