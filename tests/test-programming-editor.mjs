#!/usr/bin/env node
import assert from "node:assert/strict";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { LANGUAGE_REGISTRY, SUPPORTED_LANGUAGES } from "../src/bridge/languages.js";
import { ProgrammingCodeEditor, getCodeMirrorLanguageSupport } from "../src/ui/code-editor.js";

const prefixCode = "// protected header";
const initialCode = "return Math.floor(percentage);";
const suffixCode = "// protected runner";
const editor = new ProgrammingCodeEditor({
  language: "javascript",
  starterCode: "starter",
  currentCode: initialCode,
  prefixCode,
  suffixCode,
  hasPrefixCode: true,
  hasSuffixCode: true,
});

assert.equal(editor.getCode(), initialCode, "the initial editable code is currentCode");
assert.equal(editor.getFullCode(), `${prefixCode}\n${initialCode}\n${suffixCode}`, "copy includes both protected regions");
const initialState = editor.createState();
assert.equal(initialState.doc.toString(), editor.getFullCode(), "CodeMirror receives the continuous visible document");
const range = editor.getEditableRange(initialState.doc.length);
assert.equal(initialState.doc.sliceString(range.from, range.to), initialCode, "the editable range maps exactly to workingCode");

const allowedEdit = initialState.update({ changes: { from: range.from, to: range.from, insert: "// local\n" } });
assert.equal(editor.allowTransaction(allowedEdit), true, "edits at the workingCode boundary are allowed");
const protectedPrefixEdit = initialState.update({ changes: { from: 0, to: 1, insert: "!" } });
assert.equal(protectedPrefixEdit.docChanged, false, "CodeMirror rejects prefix edits at the state transaction boundary");
const protectedSuffixEdit = initialState.update({ changes: { from: range.to + 1, to: range.to + 2, insert: "!" } });
assert.equal(protectedSuffixEdit.docChanged, false, "CodeMirror rejects suffix edits at the state transaction boundary");

editor.handleViewUpdate({ docChanged: true, state: { doc: allowedEdit.newDoc } });
assert.equal(editor.getCode(), `// local\n${initialCode}`, "accepted CodeMirror document changes synchronize workingCode");

for (const language of SUPPORTED_LANGUAGES) {
  editor.update({ language });
  const languageState = editor.createState();
  const support = getCodeMirrorLanguageSupport(language);
  assert.ok(support, `${language} has a CodeMirror language extension`);
  assert.ok(LANGUAGE_REGISTRY[language].autocompleteWords.length > 0, `${language} reuses canonical completions`);
  const parsed = ensureSyntaxTree(languageState, languageState.doc.length, 1000) || syntaxTree(languageState);
  assert.ok(parsed.type.name, `${language} has an active parser`);
}

editor.update({ language: "javascript" });
editor.refreshFromPortal({ currentCode: "return 7;", prefixCode, suffixCode });
assert.equal(editor.currentCode, "return 7;", "refresh updates currentCode from the portal snapshot");
assert.equal(editor.getCode(), editor.currentCode, "refresh resets workingCode to the portal snapshot");
editor.setCode("local edit");
assert.equal(editor.isModified(), true, "workingCode tracks local edits separately");
editor.discardChanges();
assert.equal(editor.getCode(), "return 7;", "discard restores workingCode from currentCode");
assert.equal(editor.getFullCode(), `${prefixCode}\nreturn 7;\n${suffixCode}`, "discard retains the protected scaffold");
editor.destroy();
assert.equal(editor.editorView, null, "destroy leaves no mounted EditorView");

console.log("✓ CodeMirror programming editor state, language, and protected-range checks passed");
