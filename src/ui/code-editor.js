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
import { HighlightStyle, StreamLanguage, bracketMatching, ensureSyntaxTree, indentOnInput, indentService, indentUnit, syntaxHighlighting, syntaxTree } from "@codemirror/language";
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

function extractImportedSource(text, language) {
  const source = String(text ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!source) return { code: "", fenced: false, error: "No code found to import." };
  const blocks = [];
  const fence = /(?:^|\n)[ \t]*(`{3,}|~{3,})[ \t]*([^\s`~]*)[^\n]*\n([\s\S]*?)\n[ \t]*\1[ \t]*(?=\n|$)/g;
  for (const match of source.matchAll(fence)) blocks.push({ label: match[2].toLowerCase(), code: match[3] });
  if (!blocks.length) return { code: source, fenced: false, error: null };

  const matching = blocks.filter(({ label }) => normalizeProgrammingLanguage(label) === language);
  const unlabeled = blocks.filter(({ label }) => !label);
  if (matching.length || (blocks.length === 1 && unlabeled.length === 1)) {
    return { code: (matching.length ? matching : unlabeled).map(({ code }) => code.trim()).join("\n\n"), fenced: true, error: null };
  }
  return { code: "", fenced: true, error: `No ${LANGUAGE_REGISTRY[language]?.canonicalName || language} code block found.` };
}

function firstDescendant(node, names) {
  if (!node) return null;
  if (names.has(node.name)) return node;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    const match = firstDescendant(child, names);
    if (match) return match;
  }
  return null;
}

function directChild(node, name) {
  for (let child = node?.firstChild; child; child = child.nextSibling) {
    if (child.name === name) return child;
  }
  return null;
}

function parseTreeFor(language, code) {
  const state = EditorState.create({ doc: code, extensions: [getCodeMirrorLanguageSupport(language)] });
  return ensureSyntaxTree(state, code.length, 1000) || syntaxTree(state);
}

function findDefinitions(language, source) {
  if (language === "bash") return findBashDefinitions(source);
  if (language === "sql") return findSqlDefinitions(source);

  let code = source;
  let offset = 0;
  let tree = parseTreeFor(language, code);
  let definitions = collectSyntaxDefinitions(language, code, tree);
  if (!definitions.length && (language === "javascript" || language === "java")) {
    const wrapper = "class __AcadrixImport__ {\n";
    offset = wrapper.length;
    code = wrapper + source + "\n}";
    tree = parseTreeFor(language, code);
    definitions = collectSyntaxDefinitions(language, code, tree, "__AcadrixImport__");
  }
  return definitions.map((definition) => ({ ...definition, from: definition.from - offset, to: definition.to - offset }));
}

function hasIncompleteDefinition(language, source) {
  if (language === "bash") {
    const starts = [...source.matchAll(/^[ \t]*(?:function[ \t]+)?[A-Za-z_][A-Za-z0-9_]*[ \t]*\([ \t]*\)[ \t]*\{/gm)];
    return starts.length > findBashDefinitions(source).length;
  }
  const declaration = language === "python" ? /^\s*def\s+\w+\s*\(/m
    : language === "sql" ? /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\b/i
    : language === "javascript" ? /\bfunction\s+[$\w]+\s*\(|^\s*class\s+[$\w]+|^\s*[$\w]+\s*\(/m
    : /^\s*(?:(?:public|private|protected|static|final|abstract|synchronized)\s+)*[\w<>\[\]]+\s+\w+\s*\(/m;
  if (!declaration.test(source)) return false;
  const hasError = (code) => {
    const tree = parseTreeFor(language, code);
    let found = false;
    tree.iterate({ enter(cursor) { if (cursor.type.isError) found = true; } });
    return found;
  };
  if (!hasError(source)) return false;
  if (language === "javascript" || language === "java") {
    const wrapped = `class __AcadrixImport__ {\n${source}\n}`;
    return hasError(wrapped);
  }
  return true;
}

function collectSyntaxDefinitions(language, code, tree, syntheticClass = null) {
  const definitions = [];
  const scope = [];
  const classTypes = new Set(["ClassDeclaration", "ClassDefinition"]);
  const definitionTypes = language === "python"
    ? new Set(["FunctionDefinition"])
    : language === "java"
    ? new Set(["MethodDeclaration"])
    : new Set(["MethodDeclaration", "FunctionDeclaration"]);
  tree.iterate({
    enter(cursor) {
      if (classTypes.has(cursor.name)) {
        const nameNode = firstDescendant(cursor.node.firstChild?.nextSibling, new Set(["VariableDefinition", "Definition", "VariableName"]));
        scope.push(nameNode ? code.slice(nameNode.from, nameNode.to) : "");
      }
      if (!definitionTypes.has(cursor.name)) return;
      const nameNode = language === "python"
        ? firstDescendant(cursor.node, new Set(["VariableName"]))
        : language === "java"
        ? directChild(cursor.node, "Definition")
        : cursor.name === "MethodDeclaration"
        ? directChild(cursor.node, "PropertyDefinition")
        : directChild(cursor.node, "VariableDefinition");
      if (!nameNode) return;
      const name = code.slice(nameNode.from, nameNode.to).trim();
      if (!/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(name)) return;
      const owners = scope.filter(Boolean).filter((name) => name !== syntheticClass);
      definitions.push({ name, owners, from: cursor.from, to: cursor.to });
    },
    leave(cursor) {
      if (classTypes.has(cursor.name)) scope.pop();
    },
  });
  return definitions;
}

function findSqlDefinitions(code) {
  const tree = parseTreeFor("sql", code);
  const definitions = [];
  tree.iterate({
    enter(cursor) {
      if (cursor.name !== "Statement") return;
      const statement = code.slice(cursor.from, cursor.to);
      const match = /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+(?:[\w"]+\.)?"?([\w$]+)"?/i.exec(statement);
      if (match) definitions.push({ name: match[1], owners: [], from: cursor.from, to: cursor.to });
    },
  });
  return definitions;
}

function findBashDefinitions(code) {
  const definitions = [];
  const signature = /^[ \t]*(?:function[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*\([ \t]*\)[ \t]*\{/gm;
  for (const match of code.matchAll(signature)) {
    const open = match.index + match[0].lastIndexOf("{");
    const close = findShellBlockEnd(code, open);
    if (close < 0) continue;
    definitions.push({ name: match[1], owners: [], from: match.index, to: close + 1 });
  }
  return definitions;
}

function findShellBlockEnd(code, open) {
  let depth = 0;
  let quote = "";
  for (let i = open; i < code.length; i++) {
    const char = code[i];
    if (quote) {
      if (char === "\\") { i++; continue; }
      if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"' || char === "`") { quote = char; continue; }
    if (char === "#") {
      while (i < code.length && code[i] !== "\n") i++;
      continue;
    }
    if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return i;
  }
  return -1;
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
    this.badgeElements = null;
    this.badgeState = null;
    this.languageCompartment = new Compartment();
  }

  render() {
    const container = document.createElement("section");
    this.badgeState = null;
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
    this.badgeElements = {
      discard: container.querySelector("[data-editor-act='discard']"),
      status: container.querySelector("[data-editor-status]"),
      undo: container.querySelector("[data-editor-act='undo']"),
      redo: container.querySelector("[data-editor-act='redo']"),
    };
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

  importCode(input) {
    const extracted = extractImportedSource(input, this.language);
    if (extracted.error) {
      this.notifyStatus(extracted.error, "warning");
      return { ok: false, error: extracted.error };
    }

    let code = extracted.code;
    if (this.prefixCode && this.suffixCode) {
      const prefixAt = code.indexOf(this.prefixCode);
      const suffixAt = code.lastIndexOf(this.suffixCode);
      if (prefixAt >= 0 && suffixAt > prefixAt) code = code.slice(prefixAt + this.prefixCode.length, suffixAt).trim();
    }
    if (!code.trim()) {
      const error = "No editable code found to import.";
      this.notifyStatus(error, "warning");
      return { ok: false, error };
    }

    if (hasIncompleteDefinition(this.language, code)) {
      const error = "An imported function or method is incomplete; no code was changed.";
      this.notifyStatus(error, "warning");
      return { ok: false, error };
    }

    const imported = findDefinitions(this.language, code);
    if (imported.length) {
      const current = findDefinitions(this.language, this.getCode());
      const changes = [];
      let unmatched = false;
      const seen = new Set();
      for (const definition of imported) {
        const key = `${definition.owners.join(".")}::${definition.name}`;
        if (seen.has(key)) {
          const error = `The import contains more than one definition named ${definition.name}.`;
          this.notifyStatus(error, "warning");
          return { ok: false, error };
        }
        seen.add(key);
        let candidates = current.filter((candidate) => candidate.name === definition.name);
        if (definition.owners.length) {
          candidates = candidates.filter((candidate) => candidate.owners.join(".") === definition.owners.join("."));
        }
        if (candidates.length > 1) {
          const error = `More than one existing definition is named ${definition.name}; the import was not applied.`;
          this.notifyStatus(error, "warning");
          return { ok: false, error };
        }
        if (!candidates.length) {
          unmatched = true;
          continue;
        }
        const target = candidates[0];
        const targetLineStart = this.getCode().lastIndexOf("\n", target.from - 1) + 1;
        const inputLineStart = code.lastIndexOf("\n", definition.from - 1) + 1;
        const targetIndent = this.getCode().slice(targetLineStart, target.from);
        const inputIndent = code.slice(inputLineStart, definition.from);
        const indent = (value) => /^\s*$/.test(value) ? value : "";
        const baseIndent = indent(targetIndent);
        const snippetIndent = indent(inputIndent);
        let replacement = code.slice(definition.from, definition.to).split("\n").map((line, index) => {
          if (index === 0) return line;
          const relative = snippetIndent && line.startsWith(snippetIndent) ? line.slice(snippetIndent.length) : line;
          return baseIndent + relative;
        }).join("\n");
        if (this.getCode().slice(target.from, target.to).endsWith("\n") && !replacement.endsWith("\n")) replacement += "\n";
        changes.push({ from: target.from, to: target.to, insert: replacement });
      }

      if (changes.length && unmatched) {
        const error = "Some imported functions do not match existing definitions; no code was changed.";
        this.notifyStatus(error, "warning");
        return { ok: false, error };
      }
      if (changes.length) {
        this.applyImportedChanges(changes);
        return { ok: true, mode: "merge", count: changes.length };
      }
    }

    this.applyImportedChanges([{ from: 0, to: this.getCode().length, insert: code }]);
    return { ok: true, mode: "replace" };
  }

  applyImportedChanges(changes) {
    if (!this.editorView) {
      let code = this.getCode();
      for (const change of [...changes].sort((a, b) => b.from - a.from)) {
        code = code.slice(0, change.from) + change.insert + code.slice(change.to);
      }
      this.workingCode = code;
      this.applyState = "idle";
      this.updateStateBadges();
      return;
    }
    const range = this.getEditableRange();
    const ordered = [...changes].sort((a, b) => a.from - b.from);
    const last = ordered.at(-1);
    this.editorView.dispatch({
      changes: ordered.map(({ from, to, insert }) => ({ from: range.from + from, to: range.from + to, insert })),
      selection: EditorSelection.cursor(range.from + last.from + last.insert.length),
      userEvent: "input.paste",
      annotations: isolateHistory.of("full"),
    });
    this.editorView.focus();
  }

  undo() {
    if (this.editorView) undo(this.editorView);
  }

  redo() {
    if (this.editorView) redo(this.editorView);
  }

  handlePaste(event, view) {
    const clipboardText = event.clipboardData?.getData("text/plain");
    if (!clipboardText) return false;
    const result = this.importCode(clipboardText);
    if (!result.ok) {
      event.preventDefault();
      return true;
    }
    event.preventDefault();
    return true;
  }

  updateStateBadges() {
    if (!this.element) return;
    const modified = this.workingCode !== this.currentCode;
    const label = this.applyState === "applying" ? "Updating…"
      : this.applyState === "error" ? "Update failed"
      : this.applyState === "updated" ? "Updated"
      : modified ? "Modified" : "In Sync";
    const undoDisabled = !this.editorView || undoDepth(this.editorView.state) === 0 || this.isApplying;
    const redoDisabled = !this.editorView || redoDepth(this.editorView.state) === 0 || this.isApplying;
    const state = { status: label, modified, applying: this.isApplying, failed: this.applyState === "error", undoDisabled, redoDisabled };
    const previous = this.badgeState;
    this.badgeState = state;
    if (!previous || previous.modified !== modified || previous.applying !== state.applying) {
      if (this.badgeElements?.discard) this.badgeElements.discard.disabled = !modified || this.isApplying;
    }
    if (!previous || previous.status !== label) {
      if (this.badgeElements?.status) this.badgeElements.status.textContent = label;
    }
    if (!previous || previous.undoDisabled !== undoDisabled) {
      if (this.badgeElements?.undo) this.badgeElements.undo.disabled = undoDisabled;
    }
    if (!previous || previous.redoDisabled !== redoDisabled) {
      if (this.badgeElements?.redo) this.badgeElements.redo.disabled = redoDisabled;
    }
    if (!previous || previous.status !== label || previous.modified !== modified || previous.applying !== state.applying || previous.failed !== state.failed) {
      this.onStateChange?.({ status: label, modified, applying: state.applying, failed: state.failed });
    }
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
        this.notifyStatus(res?.error || "The portal editor did not confirm the code update. Refresh and try again.", "error");
      }
    } catch (error) {
      this.applyState = "error";
      this.notifyStatus(error?.message || "Unable to update assignment. Refresh the portal page and try again.", "error");
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
