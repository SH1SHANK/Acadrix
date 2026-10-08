/**
 * CodeMirror-backed programming editor for the Acadrix Reader.
 * IITM Ace remains the authoritative editor; this instance only edits local workingCode.
 */

import { autocompletion, closeBrackets, closeBracketsKeymap, completeFromList, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab, isolateHistory, redo, undo, redoDepth, undoDepth } from "@codemirror/commands";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { sql } from "@codemirror/lang-sql";
import { HighlightStyle, StreamLanguage, bracketMatching, indentOnInput, indentService, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { Compartment, EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { Decoration, EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { LANGUAGE_REGISTRY, normalizeProgrammingLanguage } from "../bridge/languages.js";
import { readAceEditorData, setAceEditorCode } from "../bridge/ace-bridge.js";

const SHELL_LANGUAGE = StreamLanguage.define(shell);

const LANGUAGE_SUPPORT = Object.freeze({
  javascript: javascript,
  python,
  java,
  sql,
  bash: () => SHELL_LANGUAGE,
});

const ACADRIX_HIGHLIGHTS = HighlightStyle.define([
  { tag: tags.comment, color: "var(--acx-text-muted)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--acx-success)" },
  { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword], color: "var(--acx-accent)" },
  { tag: [tags.number, tags.integer, tags.float], color: "var(--acx-warning)" },
  { tag: [tags.bool, tags.null, tags.atom], color: "var(--acx-info)" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--acx-info)" },
  { tag: [tags.function(tags.variableName), tags.propertyName], color: "var(--acx-accent-hover)" },
]);

const EDITOR_THEME = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--acx-text)",
    backgroundColor: "var(--acx-surface-sunken)",
    font: "var(--acx-text-mono)",
  },
  ".cm-scroller": {
    overflow: "auto",
    maxHeight: "var(--acx-editor-max-height)",
    minHeight: "var(--acx-editor-min-height)",
    fontFamily: "var(--acx-font-mono)",
    fontSize: "var(--acx-editor-font-size)",
    lineHeight: "var(--acx-editor-line-height)",
  },
  ".cm-content": {
    minHeight: "var(--acx-editor-min-height)",
    paddingBlock: "var(--acx-editor-padding-block)",
    caretColor: "var(--acx-text)",
  },
  ".cm-line": {
    paddingInline: "var(--acx-editor-padding-inline)",
  },
  ".cm-gutters": {
    color: "var(--acx-text-muted)",
    backgroundColor: "var(--acx-surface-sunken)",
    borderRight: "var(--acx-border-width) solid var(--acx-border)",
  },
  ".cm-gutterElement": {
    paddingInline: "var(--acx-space-2)",
  },
  ".cm-activeLine, .cm-activeLineGutter": {
    backgroundColor: "var(--acx-accent-subtle)",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-selectionBackground, ::selection": {
    backgroundColor: "var(--acx-accent-subtle) !important",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--acx-text)",
  },
  ".cm-protected": {
    color: "var(--acx-text-muted)",
    backgroundColor: "var(--acx-accent-subtle)",
  },
  ".cm-tooltip": {
    border: "var(--acx-border-width) solid var(--acx-border)",
    borderRadius: "var(--acx-radius-md)",
    backgroundColor: "var(--acx-surface-raised)",
    color: "var(--acx-text)",
    boxShadow: "var(--acx-shadow-2)",
  },
  ".cm-tooltip-autocomplete ul": {
    font: "var(--acx-text-ui)",
    maxHeight: "var(--acx-editor-max-height)",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--acx-accent-subtle)",
    color: "var(--acx-text)",
  },
});

export function getCodeMirrorLanguageSupport(language) {
  const languageId = normalizeProgrammingLanguage(language) || "javascript";
  return LANGUAGE_SUPPORT[languageId]();
}

function languageExtensions(language) {
  const metadata = LANGUAGE_REGISTRY[language] || LANGUAGE_REGISTRY.javascript;
  const words = [...new Set(metadata.autocompleteWords || [])].map((label) => ({ label }));
  const extensions = [
    getCodeMirrorLanguageSupport(language),
    indentUnit.of(metadata.indentUnit || "    "),
    autocompletion({
      activateOnTyping: true,
      override: [completeFromList(words)],
    }),
  ];
  if (language === "bash") {
    const unitWidth = metadata.indentUnit?.length || 4;
    const closers = /^(?:fi|done|esac|else|elif)\b/i;
    extensions.push(indentService.of((context, position) => {
      const currentLine = context.lineAt(position, -1);
      const previousLine = context.lineAt(Math.max(0, currentLine.from - 1), -1);
      const baseIndent = context.lineIndent(previousLine.from);
      if (closers.test(currentLine.text.trimStart())) return Math.max(0, baseIndent - unitWidth);
      const previousText = previousLine.text.trimEnd().toLowerCase();
      const indentAfter = (metadata.indentAfter || []).some((token) => previousText.endsWith(token.toLowerCase()));
      return baseIndent + (indentAfter ? unitWidth : 0);
    }));
  }
  return extensions;
}

function composeDocument(prefixCode, workingCode, suffixCode) {
  const parts = [];
  if (prefixCode !== null && prefixCode !== undefined) parts.push(String(prefixCode));
  parts.push(String(workingCode ?? ""));
  if (suffixCode !== null && suffixCode !== undefined) parts.push(String(suffixCode));
  return parts.join("\n");
}

function matchingFencedCode(text, language) {
  const source = String(text ?? "").replace(/\r\n?/g, "\n");
  const match = source.match(/^\s*(`{3,}|~{3,})\s*([^\s`~]+)[^\n]*\n([\s\S]*?)\n\s*\1\s*$/);
  if (!match || /^[ \t]*(`{3,}|~{3,})/m.test(match[3]) || normalizeProgrammingLanguage(match[2]) !== language) return null;
  return match[3];
}

export class ProgrammingCodeEditor {
  constructor(options = {}) {
    this.language = normalizeProgrammingLanguage(options.language) || "javascript";
    this.prefixCode = options.prefixCode ?? null;
    this.starterCode = options.starterCode ?? "";
    this.currentCode = options.currentCode ?? this.starterCode;
    this.workingCode = this.currentCode;
    this.suffixCode = options.suffixCode ?? null;
    this.hasPrefixCode = Boolean(options.hasPrefixCode);
    this.hasSuffixCode = Boolean(options.hasSuffixCode);
    this.editorIdentity = options.editorIdentity ?? null;
    this.questionIdentity = options.questionIdentity ?? null;
    this.onApply = options.onApply || null;
    this.onStatus = options.onStatus || null;
    this.onStateChange = options.onStateChange || null;
    this.applyState = "idle";
    this.isApplying = false;
    this.element = null;
    this.editorHost = null;
    this.editorView = null;
    this.languageCompartment = new Compartment();
  }

  render() {
    const container = document.createElement("section");
    container.className = "saq-code-editor-root";
    const languageName = LANGUAGE_REGISTRY[this.language]?.canonicalName || this.language;
    container.innerHTML = `
      <header class="saq-code-editor-header">
        <div class="saq-code-editor-heading">
          <strong class="saq-code-editor-title">${languageName}</strong>
          <span class="saq-editor-language-hint">Assignment editor</span>
        </div>
        <div class="saq-code-editor-tools" role="group" aria-label="Editor history">
          <button type="button" class="saq-btn saq-btn-xs saq-btn-secondary" data-editor-act="undo" aria-label="Undo" aria-keyshortcuts="Control+Z Meta+Z" title="Undo">Undo</button>
          <button type="button" class="saq-btn saq-btn-xs saq-btn-secondary" data-editor-act="redo" aria-label="Redo" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z" title="Redo">Redo</button>
        </div>
      </header>
      <p class="saq-editor-help">Edit the assignment code below. Protected assignment scaffold remains read-only.</p>
      <div class="saq-continuous-editor-stage" role="group" aria-label="Assignment code">
        <div class="saq-cm-host"></div>
      </div>
      <footer class="saq-code-editor-footer">
        <span class="saq-editor-footer-status" data-editor-status>${this.isModified() ? "Modified" : "In Sync"}</span>
        <div class="saq-editor-footer-actions">
          <button type="button" class="saq-btn saq-btn-secondary saq-btn-sm" data-editor-act="discard" ${this.isModified() ? "" : "disabled"} title="Revert to the latest assignment code">Discard Changes</button>
        </div>
      </footer>`;
    this.element = container;
    this.editorHost = container.querySelector(".saq-cm-host");
    container.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-editor-act]");
      if (!button || button.disabled || this.isApplying) return;
      event.preventDefault();
      if (button.dataset.editorAct === "undo") this.undo();
      else if (button.dataset.editorAct === "redo") this.redo();
      else if (button.dataset.editorAct === "discard") this.discardChanges();
    });
    return container;
  }

  createState() {
    const initialDoc = composeDocument(this.prefixCode, this.workingCode, this.suffixCode);
    const end = this.getEditableRange(initialDoc.length).to;
    return EditorState.create({
      doc: initialDoc,
      selection: EditorSelection.cursor(end),
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        bracketMatching(),
        indentOnInput(),
        closeBrackets(),
        history(),
        syntaxHighlighting(ACADRIX_HIGHLIGHTS, { fallback: true }),
        EDITOR_THEME,
        EditorView.contentAttributes.of({
          "aria-label": "Assignment code editor",
          "spellcheck": "false",
          "autocorrect": "off",
          "autocapitalize": "off",
        }),
        EditorState.changeFilter.of((transaction) => this.allowTransaction(transaction)),
        EditorView.decorations.of((view) => this.protectedDecorations(view.state.doc.length)),
        this.languageCompartment.of(languageExtensions(this.language)),
        keymap.of([
          ...closeBracketsKeymap,
          ...completionKeymap,
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.domEventHandlers({
          paste: (event, view) => this.handlePaste(event, view),
        }),
        EditorView.updateListener.of((update) => this.handleViewUpdate(update)),
      ],
    });
  }

  mount(root = this.element?.getRootNode?.()) {
    if (this.editorView) return this.editorView;
    if (!this.element || !this.editorHost) throw new Error("Render the programming editor before mounting it.");
    this.editorView = new EditorView({
      state: this.createState(),
      parent: this.editorHost,
      root: root?.host ? root : undefined,
    });
    this.updateStateBadges();
    return this.editorView;
  }

  getEditableRange(documentLength = this.editorView?.state.doc.length ?? composeDocument(this.prefixCode, this.workingCode, this.suffixCode).length) {
    const prefixLength = this.prefixCode === null || this.prefixCode === undefined ? 0 : String(this.prefixCode).length + 1;
    const suffixLength = this.suffixCode === null || this.suffixCode === undefined ? 0 : String(this.suffixCode).length + 1;
    return { from: prefixLength, to: Math.max(prefixLength, documentLength - suffixLength) };
  }

  allowTransaction(transaction) {
    if (!transaction.docChanged) return true;
    const { from, to } = this.getEditableRange(transaction.startState.doc.length);
    let allowed = true;
    transaction.changes.iterChanges((fromA, toA) => {
      if (fromA < from || toA > to) allowed = false;
    });
    return allowed;
  }

  protectedDecorations(documentLength) {
    const ranges = [];
    const start = this.getEditableRange(documentLength).from;
    const end = this.getEditableRange(documentLength).to;
    if (this.prefixCode && start > 1) ranges.push(Decoration.mark({ class: "cm-protected" }).range(0, start - 1));
    if (this.suffixCode && end < documentLength) ranges.push(Decoration.mark({ class: "cm-protected" }).range(end + 1, documentLength));
    return Decoration.set(ranges, true);
  }

  handleViewUpdate(update) {
    if (update.docChanged) {
      const { from, to } = this.getEditableRange(update.state.doc.length);
      this.workingCode = update.state.doc.sliceString(from, to);
      this.applyState = "idle";
      this.updateStateBadges();
    }
  }

  update(options = {}) {
    const codeChanged = ["prefixCode", "suffixCode", "workingCode", "currentCode", "starterCode"].some((key) => Object.hasOwn(options, key));
    if (Object.hasOwn(options, "language")) this.language = normalizeProgrammingLanguage(options.language) || this.language;
    if (Object.hasOwn(options, "starterCode")) this.starterCode = options.starterCode ?? "";
    if (Object.hasOwn(options, "currentCode")) this.currentCode = options.currentCode ?? "";
    if (Object.hasOwn(options, "prefixCode")) this.prefixCode = options.prefixCode ?? null;
    if (Object.hasOwn(options, "suffixCode")) this.suffixCode = options.suffixCode ?? null;
    if (Object.hasOwn(options, "hasPrefixCode")) this.hasPrefixCode = Boolean(options.hasPrefixCode);
    if (Object.hasOwn(options, "hasSuffixCode")) this.hasSuffixCode = Boolean(options.hasSuffixCode);
    this.workingCode = Object.hasOwn(options, "workingCode")
      ? String(options.workingCode ?? "")
      : Object.hasOwn(options, "currentCode")
      ? this.currentCode
      : this.workingCode;
    this.applyState = "idle";

    if (this.editorView) {
      if (codeChanged) {
        const state = this.createState();
        this.editorView.setState(state);
      } else if (Object.hasOwn(options, "language")) {
        this.editorView.dispatch({
          effects: this.languageCompartment.reconfigure(languageExtensions(this.language)),
        });
      }
    }
    if (this.element) {
      const title = this.element.querySelector(".saq-code-editor-title");
      if (title) title.textContent = LANGUAGE_REGISTRY[this.language]?.canonicalName || this.language;
    }
    this.updateStateBadges();
    return this;
  }

  refreshFromPortal(snapshot = {}) {
    return this.update({
      ...snapshot,
      currentCode: snapshot.currentCode ?? "",
      workingCode: snapshot.currentCode ?? "",
    });
  }

  isModified() {
    return this.workingCode !== this.currentCode;
  }

  getFullCode() {
    return composeDocument(this.prefixCode, this.workingCode, this.suffixCode);
  }

  getCode() {
    if (!this.editorView) return this.workingCode;
    const { from, to } = this.getEditableRange(this.editorView.state.doc.length);
    return this.editorView.state.doc.sliceString(from, to);
  }

  setCode(code) {
    const nextCode = String(code ?? "");
    this.applyState = "idle";
    if (!this.editorView) {
      this.workingCode = nextCode;
      this.updateStateBadges();
      return;
    }
    const { from, to } = this.getEditableRange();
    this.editorView.dispatch({
      changes: { from, to, insert: nextCode },
      selection: EditorSelection.cursor(from + nextCode.length),
      annotations: Transaction.addToHistory.of(false),
    });
  }

  undo() {
    if (this.editorView) undo(this.editorView);
  }

  redo() {
    if (this.editorView) redo(this.editorView);
  }

  handlePaste(event, view) {
    const clipboardText = event.clipboardData?.getData("text/plain");
    const fencedCode = matchingFencedCode(clipboardText, this.language);
    if (fencedCode === null) return false;
    event.preventDefault();
    const { from, to } = this.getEditableRange(view.state.doc.length);
    const selection = view.state.selection.main;
    const changeFrom = selection.empty ? from : selection.from;
    const changeTo = selection.empty ? to : selection.to;
    view.dispatch({
      changes: { from: changeFrom, to: changeTo, insert: fencedCode },
      selection: EditorSelection.cursor(changeFrom + fencedCode.length),
      userEvent: "input.paste",
      annotations: isolateHistory.of("full"),
    });
    return true;
  }

  updateStateBadges() {
    if (!this.element) return;
    const modified = this.isModified();
    const discard = this.element.querySelector("[data-editor-act='discard']");
    const status = this.element.querySelector("[data-editor-status]");
    const label = this.applyState === "applying" ? "Updating…"
      : this.applyState === "error" ? "Update failed"
      : this.applyState === "updated" ? "Updated"
      : modified ? "Modified" : "In Sync";
    if (discard) discard.disabled = !modified || this.isApplying;
    if (status) status.textContent = label;
    const undoButton = this.element.querySelector("[data-editor-act='undo']");
    const redoButton = this.element.querySelector("[data-editor-act='redo']");
    if (undoButton) undoButton.disabled = !this.editorView || undoDepth(this.editorView.state) === 0 || this.isApplying;
    if (redoButton) redoButton.disabled = !this.editorView || redoDepth(this.editorView.state) === 0 || this.isApplying;
    this.onStateChange?.({ status: label, modified, applying: this.isApplying, failed: this.applyState === "error" });
  }

  discardChanges() {
    this.applyState = "idle";
    this.setCode(this.currentCode);
    this.notifyStatus("Changes discarded. Restored portal code.", "info");
  }

  async applyChanges() {
    if (!this.isModified() || this.isApplying) return;
    this.applyState = "applying";
    this.isApplying = true;
    this.updateStateBadges();

    try {
      const live = readAceEditorData();
      const sameEditor = !this.editorIdentity || live?.editorIdentity === this.editorIdentity;
      const sameQuestion = this.questionIdentity === null || this.questionIdentity === undefined ||
        String(live?.questionIdentity) === String(this.questionIdentity);
      const sameScaffold =
        (!this.hasPrefixCode || live?.prefixCode === this.prefixCode) &&
        (!this.hasSuffixCode || live?.suffixCode === this.suffixCode);
      const sameCurrentCode = live?.currentCode === this.currentCode;

      if (!sameEditor || !sameQuestion || !sameScaffold || !sameCurrentCode) {
        throw new Error("The assignment editor changed since this Reader was opened. Refresh before applying.");
      }

      const res = await setAceEditorCode(null, this.workingCode, {
        expectedEditorIdentity: this.editorIdentity,
        expectedQuestionIdentity: this.questionIdentity,
      });
      if (res && res.ok) {
        this.currentCode = this.workingCode;
        this.applyState = "updated";
        this.notifyStatus("Updated", "success");
        this.onApply?.(this.workingCode);
      } else {
        this.applyState = "error";
        this.notifyStatus("Unable to update assignment. Refresh the portal page and try again.", "error");
      }
    } catch {
      this.applyState = "error";
      this.notifyStatus("Unable to update assignment. Refresh the portal page and try again.", "error");
    } finally {
      this.isApplying = false;
      this.updateStateBadges();
    }
  }

  notifyStatus(message, tone = "info") {
    this.onStatus?.(message, tone);
  }

  destroy() {
    this.editorView?.destroy();
    this.editorView = null;
    this.editorHost = null;
    this.element?.remove();
    this.element = null;
  }
}
