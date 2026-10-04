/** Extension-only Reader feature: in-memory AI answer-key import and badges. */

import { ICONS } from "./icons.js";
import { parseAnswerKey } from "../bridge/parser.js";
import { assignmentFingerprint } from "../bridge/protocol.js";

function makeBadge(entry) {
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
    const value = Array.isArray(entry.answer) ? entry.answer.join(", ") : String(entry.answer ?? "");
    badge.textContent = `AI: ${value}`;
  }
  return badge;
}

export function createReaderImportFeature(reader) {
  let currentFingerprint = null;
  let importedEntries = [];

  const panel = () => reader.sheetElement?.querySelector("#saq-import-panel");
  const trigger = () => reader.sheetElement?.querySelector("[data-act='import-answers']");

  const isOpen = () => {
    const node = panel();
    return Boolean(node && !node.hasAttribute("hidden"));
  };

  const applyBadges = () => {
    const sheet = reader.sheetElement;
    if (!sheet) return;
    sheet.querySelectorAll("[data-acx-ai-answer]").forEach((node) => node.remove());
    if (!importedEntries.length) return;

    const byNumber = new Map(importedEntries.map((entry) => [entry.number, entry]));
    sheet.querySelectorAll(".saq-block").forEach((block) => {
      const index = Number(block.dataset.q);
      const question = reader.documentModel?.questions?.[index];
      const entry = byNumber.get(question?.number);
      const header = block.querySelector(".saq-qheader");
      if (entry && header) header.appendChild(makeBadge(entry));
    });
  };

  const renderIssues = (result) => {
    const node = panel();
    if (!node) return;
    const results = node.querySelector("[data-import-results]");
    const issues = node.querySelector("[data-import-issues]");
    const replaced = node.querySelector("[data-import-replaced]");
    const clear = node.querySelector("[data-act='import-clear']");
    if (!results || !issues || !replaced) return;

    results.textContent = result.fatal || `${result.entries.filter((entry) => entry.status === "answered").length} answered, ${result.entries.filter((entry) => entry.status === "missing").length} missing, ${result.entries.filter((entry) => entry.status === "invalid").length} invalid`;
    results.dataset.tone = result.fatal ? "error" : "info";
    issues.replaceChildren();
    for (const item of result.issues || []) {
      const row = document.createElement("li");
      row.textContent = `Q${item.number}: ${item.reason}`;
      issues.appendChild(row);
    }
    replaced.textContent = result.replaced?.length ? `Replaced: ${result.replaced.map((number) => `Q${number}`).join(", ")}` : "";
    if (clear) clear.hidden = !importedEntries.length;
  };

  const clearAnswers = (message = "") => {
    importedEntries = [];
    applyBadges();
    const node = panel();
    if (node) {
      node.querySelector("[data-import-results]").textContent = message;
      node.querySelector("[data-import-issues]").replaceChildren();
      node.querySelector("[data-import-replaced]").textContent = "";
      node.querySelector("[data-act='import-clear']").hidden = true;
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => clearAnswers());
  }

  const open = () => {
    const node = panel();
    if (!node) return;
    node.removeAttribute("hidden");
    trigger()?.setAttribute("aria-expanded", "true");
    const textarea = node.querySelector("textarea");
    textarea?.focus?.({ preventScroll: true });
  };

  const close = ({ restoreFocus = true } = {}) => {
    const node = panel();
    if (!node || node.hasAttribute("hidden")) return;
    node.setAttribute("hidden", "");
    trigger()?.setAttribute("aria-expanded", "false");
    if (restoreFocus) trigger()?.focus?.({ preventScroll: true });
  };

  const importAnswers = () => {
    const node = panel();
    const textarea = node?.querySelector("textarea");
    if (!node || !textarea) return;
    const result = parseAnswerKey(textarea.value, reader.documentModel, {
      existing: importedEntries.length ? { fp: currentFingerprint, entries: importedEntries } : null,
    });
    if (result.ok) {
      importedEntries = result.entries;
      currentFingerprint = assignmentFingerprint(reader.documentModel);
      applyBadges();
    }
    renderIssues(result);
  };

  reader._readerImportFeature = { isOpen, close, clear: clearAnswers };

  return {
    renderHeaderActions({ sheet }) {
      const actions = sheet.querySelector(".saq-export-group");
      const header = sheet.querySelector(".saq-header");
      if (!actions || !header) return;

      actions.innerHTML =
        `<button type="button" class="saq-btn saq-btn-export" data-act="import-answers" aria-label="Import AI answers" aria-expanded="false" aria-controls="saq-import-panel" title="Import AI answers">Import AI</button>` +
        actions.innerHTML;
      const container = document.createElement("div");
      container.innerHTML = `
        <aside id="saq-import-panel" class="saq-import-panel" role="dialog" aria-modal="false" aria-labelledby="saq-import-title" hidden>
          <header class="saq-ai-popover-head">
            <span id="saq-import-title" class="saq-ai-popover-title">Import AI answers</span>
            <button type="button" class="saq-btn saq-icon saq-ai-close" data-act="import-close" aria-label="Close Import AI answers" title="Close (Esc)">${ICONS.close}</button>
          </header>
          <section class="saq-import-body">
            <label class="saq-import-label" for="saq-import-text">Paste the JSON answer key</label>
            <textarea id="saq-import-text" class="saq-import-textarea" spellcheck="false" autocomplete="off"></textarea>
            <div class="saq-import-actions">
              <button type="button" class="saq-btn saq-btn-primary" data-act="import-submit">Import</button>
              <button type="button" class="saq-btn saq-btn-secondary" data-act="import-clear" hidden>Clear answers</button>
            </div>
            <output class="saq-import-results" data-import-results role="status" aria-live="polite" aria-atomic="true"></output>
            <ul class="saq-import-issues" data-import-issues></ul>
            <p class="saq-import-replaced" data-import-replaced></p>
          </section>
        </aside>`;
      const importPanel = container.firstElementChild || container.children?.[0];
      if (importPanel) header.parentNode.appendChild(importPanel);
      if (importedEntries.length) applyBadges();
    },

    handleActionClick(e) {
      const btn = e.target.closest?.("[data-act]");
      if (!btn) {
        if (isOpen() && !panel()?.contains(e.target)) close({ restoreFocus: false });
        return false;
      }
      const action = btn.dataset.act;
      if (action === "import-answers") {
        e.preventDefault();
        open();
        return true;
      }
      if (action === "import-close") {
        e.preventDefault();
        close();
        return true;
      }
      if (action === "import-submit") {
        e.preventDefault();
        importAnswers();
        return true;
      }
      if (action === "import-clear") {
        e.preventDefault();
        clearAnswers("Answers cleared.");
        return true;
      }
      return false;
    },

    handleKeydown(e) {
      if (e.key !== "Escape" || !isOpen()) return false;
      e.preventDefault();
      e.stopPropagation();
      close();
      return true;
    },

    documentChange({ documentModel } = {}) {
      const nextFingerprint = assignmentFingerprint(documentModel || reader.documentModel);
      if (currentFingerprint && currentFingerprint !== nextFingerprint && importedEntries.length) {
        clearAnswers("Imported answers cleared: the assignment changed.");
        reader.notify?.("Imported answers cleared: the assignment changed.", "info", 5000);
      }
      currentFingerprint = nextFingerprint;
      applyBadges();
    },

    destroy({ preserveFeatureState = false } = {}) {
      if (reader._readerRebuilding) return;
      if (!preserveFeatureState) {
        clearAnswers();
        currentFingerprint = null;
      }
    },
  };
}

export function attachReaderImportFeatures() {}
