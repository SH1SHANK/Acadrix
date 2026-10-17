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

let badgeUpdates = 0;
const badgeEditor = new ProgrammingCodeEditor({ currentCode: "base", onStateChange: () => { badgeUpdates++; } });
badgeEditor.element = {};
badgeEditor.badgeElements = { discard: {}, status: {}, undo: {}, redo: {} };
badgeEditor.updateStateBadges();
badgeEditor.updateStateBadges();
assert.equal(badgeUpdates, 1, "unchanged badge state does not notify the Reader repeatedly");
const badgeState = badgeEditor.createState();
const badgeEdit = badgeState.update({ changes: { from: 0, to: 4, insert: "edit" } });
badgeEditor.handleViewUpdate({ docChanged: true, state: { doc: badgeEdit.newDoc } });
badgeEditor.updateStateBadges();
assert.equal(badgeUpdates, 2, "badge updates notify once when modified state changes");

const mergeCases = [
  {
    language: "javascript",
    current: "class Cafe { buyProduct() { return false; } helper() { return 1; } returnProduct() { return false; } }",
    imported: "```javascript\nbuyProduct() { return true; }\n```\n```js\nreturnProduct() { return true; }\n```",
    expected: "class Cafe { buyProduct() { return true; } helper() { return 1; } returnProduct() { return true; } }",
  },
  {
    language: "python",
    current: "class Cafe:\n    def buy_product(self):\n        return False\n    def helper(self):\n        return 1",
    imported: "def buy_product(self):\n    return True",
    expected: "class Cafe:\n    def buy_product(self):\n        return True\n    def helper(self):\n        return 1",
  },
  {
    language: "java",
    current: "class Cafe { boolean buyProduct() { return false; } int helper() { return 1; } }",
    imported: "boolean buyProduct() { return true; }",
    expected: "class Cafe { boolean buyProduct() { return true; } int helper() { return 1; } }",
  },
  {
    language: "sql",
    current: "CREATE FUNCTION price() RETURNS INT RETURN 0; SELECT 1;",
    imported: "CREATE FUNCTION price() RETURNS INT RETURN 10;",
    expected: "CREATE FUNCTION price() RETURNS INT RETURN 10; SELECT 1;",
  },
  {
    language: "bash",
    current: "buy_product() { echo no; }\nhelper() { echo keep; }",
    imported: "buy_product() { echo yes; }",
    expected: "buy_product() { echo yes; }\nhelper() { echo keep; }",
  },
];
for (const { language, current, imported, expected } of mergeCases) {
  const target = new ProgrammingCodeEditor({ language, currentCode: current });
  assert.equal(target.importCode(imported).ok, true, `${language} imports matching definitions`);
  assert.equal(target.getCode(), expected, `${language} preserves surrounding code and replaces the matching definition`);
}

const partial = new ProgrammingCodeEditor({
  language: "javascript",
  currentCode: "function one() { return 1; } function two() { return 2; }",
});
const partialResult = partial.importCode("function one() { return 10; }\nfunction missing() { return 0; }");
assert.equal(partialResult.ok, false, "a partial definition match is rejected");
assert.equal(partial.getCode(), "function one() { return 1; } function two() { return 2; }", "rejected imports leave the buffer unchanged");

const replacement = new ProgrammingCodeEditor({ language: "javascript", currentCode: "function old() {}" });
assert.equal(replacement.importCode("function solve() { return 42; }").mode, "replace", "no matching definitions replaces the full editable buffer");
assert.equal(replacement.getCode(), "function solve() { return 42; }");
assert.equal(replacement.importCode("plain replacement code").mode, "replace", "plain unmatched paste also replaces the full editable buffer");
assert.equal(replacement.getCode(), "plain replacement code");

const protectedImport = new ProgrammingCodeEditor({
  language: "javascript",
  currentCode: "function solve() { return 1; }",
  prefixCode: "// protected header",
  suffixCode: "// protected runner",
});
assert.equal(protectedImport.importCode("// protected header\nfunction solve() { return 2; }\n// protected runner").mode, "merge");
assert.equal(protectedImport.getFullCode(), "// protected header\nfunction solve() { return 2; }\n// protected runner", "import leaves protected scaffold untouched");

const duplicate = new ProgrammingCodeEditor({ language: "javascript", currentCode: "class A { solve() {} } class B { solve() {} }" });
assert.equal(duplicate.importCode("solve() { return 42; }").ok, false, "ambiguous names are rejected");
assert.equal(duplicate.getCode(), "class A { solve() {} } class B { solve() {} }");

for (const [language, incomplete] of [["javascript", "function solve("], ["python", "def solve("], ["java", "int solve("], ["sql", "CREATE FUNCTION solve("], ["bash", "solve() { echo incomplete"]]) {
  const safe = new ProgrammingCodeEditor({ language, currentCode: "existing code" });
  assert.equal(safe.importCode(incomplete).ok, false, `${language} incomplete definition is rejected`);
  assert.equal(safe.getCode(), "existing code", `${language} incomplete definition leaves the buffer unchanged`);
}

editor.destroy();
assert.equal(editor.editorView, null, "destroy leaves no mounted EditorView");

console.log("✓ CodeMirror programming editor state, language, and protected-range checks passed");
