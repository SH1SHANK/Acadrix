/**
 * Centralized Language Normalization and Metadata Registry.
 * 
 * First-class support for the 5 IITM programming languages:
 * 1. Bash / Shell ("bash")
 * 2. SQL ("sql")
 * 3. Python ("python")
 * 4. Java ("java")
 * 5. JavaScript ("javascript")
 * 
 * Language is data, not control flow.
 */

export const SUPPORTED_LANGUAGES = Object.freeze(["bash", "sql", "python", "java", "javascript"]);

export const LanguageErrorCode = Object.freeze({
  LANGUAGE_UNSUPPORTED: "LANGUAGE_UNSUPPORTED",
  LANGUAGE_MISMATCH: "LANGUAGE_MISMATCH",
  LANGUAGE_SYNTAX_INVALID: "LANGUAGE_SYNTAX_INVALID",
});

/**
 * Registry of language metadata for all supported languages.
 */
export const LANGUAGE_REGISTRY = Object.freeze({
  bash: Object.freeze({
    id: "bash",
    canonicalName: "Bash",
    aliases: Object.freeze(["bash", "sh", "shell", "shell script", "zsh", "ksh", "ash"]),
    aceMode: "sh",
    syntaxMode: "bash",
    indentUnit: "    ",
    indentAfter: Object.freeze(["then", "do", "{", "(", "["]),
    autocompleteWords: Object.freeze(["if", "then", "else", "elif", "fi", "for", "in", "while", "until", "do", "done", "case", "esac", "function", "return", "exit", "echo", "printf", "read", "export", "local", "declare"]),
    codeFence: "bash",
    fileExtension: ".sh",
    commentPrefixes: Object.freeze(["#"]),
    responseDetectionHints: Object.freeze([
      /\b(?:echo|printf|cd|ls|mkdir|chmod|grep|awk|sed|curl|wget)\b/,
      /^#!\/(?:usr\/)?bin\/(?:env\s+)?(?:bash|sh)/m,
      /\$\{?[A-Z_][A-Z0-9_]*\}?/,
    ]),
    validateSyntax: (code) => validateBashSyntax(code),
  }),
  sql: Object.freeze({
    id: "sql",
    canonicalName: "SQL",
    aliases: Object.freeze(["sql", "mysql", "pgsql", "postgres", "postgresql", "sqlite", "tsql", "plsql"]),
    aceMode: "sql",
    syntaxMode: "sql",
    indentUnit: "    ",
    indentAfter: Object.freeze(["("]),
    autocompleteWords: Object.freeze(["SELECT", "FROM", "WHERE", "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "INSERT INTO", "VALUES", "UPDATE", "SET", "DELETE", "CREATE TABLE", "ALTER TABLE", "DROP TABLE", "JOIN", "INNER JOIN", "LEFT JOIN", "RIGHT JOIN", "FULL JOIN", "ON", "AS", "DISTINCT", "AND", "OR", "NOT", "IN", "BETWEEN", "LIKE", "IS NULL", "IS NOT NULL", "COUNT", "SUM", "AVG", "MIN", "MAX", "EXISTS", "UNION", "PRIMARY KEY", "FOREIGN KEY", "REFERENCES"]),
    codeFence: "sql",
    fileExtension: ".sql",
    commentPrefixes: Object.freeze(["--", "/*"]),
    responseDetectionHints: Object.freeze([
      /^\s*(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH|EXPLAIN)\b/im,
      /\b(?:FROM|WHERE|JOIN|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT)\b/im,
    ]),
    validateSyntax: (code) => validateSqlSyntax(code),
  }),
  python: Object.freeze({
    id: "python",
    canonicalName: "Python",
    aliases: Object.freeze(["python", "python 3", "python3", "py", "py3"]),
    aceMode: "python",
    syntaxMode: "python",
    indentUnit: "    ",
    indentAfter: Object.freeze([":", "(", "["]),
    autocompleteWords: Object.freeze(["def", "class", "return", "if", "elif", "else", "for", "while", "in", "import", "from", "as", "try", "except", "finally", "with", "pass", "break", "continue", "lambda", "yield", "print", "input", "len", "range", "enumerate", "zip", "int", "str", "float", "list", "dict", "set", "tuple", "bool", "True", "False", "None"]),
    codeFence: "python",
    fileExtension: ".py",
    commentPrefixes: Object.freeze(["#"]),
    responseDetectionHints: Object.freeze([
      /^(?:import\s+[a-zA-Z0-9_.]+|from\s+[a-zA-Z0-9_.]+\s+import)/m,
      /\bdef\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\(/,
      /\bclass\s+[a-zA-Z_][a-zA-Z0-9_]*(?:\(.*\))?:/,
      /:\s*$\n\s+(?:return|if|for|while|pass|print|yield)/m,
    ]),
    validateSyntax: (code) => validatePythonSyntax(code),
  }),
  java: Object.freeze({
    id: "java",
    canonicalName: "Java",
    aliases: Object.freeze(["java"]),
    aceMode: "java",
    syntaxMode: "java",
    indentUnit: "    ",
    indentAfter: Object.freeze(["{", "(", "["]),
    autocompleteWords: Object.freeze(["public", "private", "protected", "class", "interface", "enum", "extends", "implements", "static", "final", "abstract", "void", "int", "double", "float", "long", "short", "byte", "char", "boolean", "String", "new", "return", "if", "else", "for", "while", "do", "switch", "case", "break", "continue", "try", "catch", "finally", "throw", "throws", "import", "package", "this", "super", "null", "true", "false", "System.out.println"]),
    codeFence: "java",
    fileExtension: ".java",
    commentPrefixes: Object.freeze(["//", "/*"]),
    responseDetectionHints: Object.freeze([
      /\b(?:public|private|protected)\s+(?:static\s+)?(?:class|interface|enum|void|int|String|boolean|double|long)\b/,
      /\bSystem\.(?:out|err)\.print(?:ln)?\s*\(/,
      /\bimport\s+java(?:\.[a-zA-Z0-9_]+)+;/,
    ]),
    validateSyntax: (code) => validateJavaSyntax(code),
  }),
  javascript: Object.freeze({
    id: "javascript",
    canonicalName: "JavaScript",
    aliases: Object.freeze(["javascript", "js", "node", "nodejs", "ecmascript", "mjs", "cjs"]),
    aceMode: "javascript",
    syntaxMode: "javascript",
    indentUnit: "    ",
    indentAfter: Object.freeze(["{", "(", "["]),
    autocompleteWords: Object.freeze(["console", "const", "let", "var", "function", "return", "if", "else", "for", "while", "do", "switch", "case", "break", "continue", "default", "try", "catch", "finally", "throw", "class", "extends", "new", "this", "super", "import", "export", "from", "async", "await", "yield", "Array", "Object", "String", "Number", "Boolean", "Promise", "Map", "Set", "JSON", "Math", "null", "undefined", "true", "false"]),
    codeFence: "javascript",
    fileExtension: ".js",
    commentPrefixes: Object.freeze(["//", "/*"]),
    responseDetectionHints: Object.freeze([
      /\b(?:const|let|var)\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*=/,
      /\bfunction\s*[a-zA-Z_$]?[a-zA-Z0-9_$]*\s*\(/,
      /=>\s*(?:\{|[^;{]+;?)/,
      /\bconsole\.(?:log|warn|error|info)\s*\(/,
    ]),
    validateSyntax: (code) => validateJavaScriptSyntax(code),
  }),
});

/**
 * Mapping of all known lowercase aliases to canonical language IDs.
 */
const ALIAS_MAP = new Map();
for (const [id, meta] of Object.entries(LANGUAGE_REGISTRY)) {
  ALIAS_MAP.set(id, id);
  for (const alias of meta.aliases) {
    ALIAS_MAP.set(alias.toLowerCase(), id);
  }
}

/**
 * Normalizes any raw language string, portal value, or dropdown label into a canonical ProgrammingLanguage.
 * Returns null if the language is unsupported.
 * 
 * @param {string} raw
 * @returns {string|null} Canonical language identifier or null
 */
export function normalizeProgrammingLanguage(raw) {
  if (!raw || typeof raw !== "string") return null;
  const clean = raw
    .trim()
    .toLowerCase()
    .replace(/^language-/, "")
    .replace(/^ace\/mode\//, "")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ");

  if (ALIAS_MAP.has(clean)) {
    return ALIAS_MAP.get(clean);
  }

  // Check substring matches for compound dropdown labels (e.g. "Python 3.10", "GNU Bash 5")
  if (clean.includes("python") || clean.includes("py")) return "python";
  if (clean.includes("bash") || clean.includes("shell") || clean.includes("sh")) return "bash";
  if (clean.includes("javascript") || clean.includes("js") || clean.includes("node")) return "javascript";
  if (clean.includes("java") && !clean.includes("script")) return "java";
  if (clean.includes("sql") || clean.includes("postgres") || clean.includes("mysql") || clean.includes("sqlite")) return "sql";

  return null;
}

/**
 * Retrieves the full metadata record for a normalized or raw language.
 * 
 * @param {string} lang
 * @returns {typeof LANGUAGE_REGISTRY[keyof typeof LANGUAGE_REGISTRY] | null}
 */
export function getLanguageMetadata(lang) {
  const normalized = normalizeProgrammingLanguage(lang);
  if (!normalized) return null;
  return LANGUAGE_REGISTRY[normalized] || null;
}

/**
 * Checks if two language identifiers refer to the same canonical language.
 * 
 * @param {string} lang1
 * @param {string} lang2
 * @returns {boolean}
 */
export function isLanguageCompatible(lang1, lang2) {
  const n1 = normalizeProgrammingLanguage(lang1);
  const n2 = normalizeProgrammingLanguage(lang2);
  if (!n1 || !n2) return false;
  return n1 === n2;
}

// ── Lightweight, Conservative Syntax Validators (Zero Execution) ─────────────

/**
 * Helper to check matching brackets/braces/parentheses.
 */
function checkBalancedDelimiters(code, pairs = [["{", "}"], ["(", ")"], ["[", "]"]]) {
  const stack = [];
  const openToClose = new Map(pairs);
  const closeToOpen = new Map(pairs.map(([o, c]) => [c, o]));
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    const next = code[i + 1] || "";
    const prev = code[i - 1] || "";

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingleQuote) {
      if (ch === "'" && prev !== "\\") inSingleQuote = false;
      continue;
    }
    if (inDoubleQuote) {
      if (ch === '"' && prev !== "\\") inDoubleQuote = false;
      continue;
    }
    if (inBacktick) {
      if (ch === "`" && prev !== "\\") inBacktick = false;
      continue;
    }

    // Comment starts
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "#") {
      inLineComment = true;
      continue;
    }
    if (ch === "-" && next === "-") {
      inLineComment = true;
      i++;
      continue;
    }

    // String starts
    if (ch === "'") {
      inSingleQuote = true;
      continue;
    }
    if (ch === '"') {
      inDoubleQuote = true;
      continue;
    }
    if (ch === "`") {
      inBacktick = true;
      continue;
    }

    // Delimiters
    if (openToClose.has(ch)) {
      stack.push(ch);
    } else if (closeToOpen.has(ch)) {
      if (stack.length === 0 || stack[stack.length - 1] !== closeToOpen.get(ch)) {
        return false;
      }
      stack.pop();
    }
  }

  return stack.length === 0;
}

function validateBashSyntax(code) {
  if (typeof code !== "string" || !code.trim()) {
    return { valid: false, warnings: ["Code is empty."] };
  }
  const warnings = [];
  const balanced = checkBalancedDelimiters(code, [["{", "}"], ["(", ")"]]);
  if (!balanced) warnings.push("Unbalanced brackets or parentheses in Bash script.");
  return { valid: warnings.length === 0, warnings };
}

function validateSqlSyntax(code) {
  if (typeof code !== "string" || !code.trim()) {
    return { valid: false, warnings: ["Code is empty."] };
  }
  const warnings = [];
  const balanced = checkBalancedDelimiters(code, [["(", ")"]]);
  if (!balanced) warnings.push("Unbalanced parentheses in SQL query.");
  return { valid: warnings.length === 0, warnings };
}

function validatePythonSyntax(code) {
  if (typeof code !== "string" || !code.trim()) {
    return { valid: false, warnings: ["Code is empty."] };
  }
  const warnings = [];
  const balanced = checkBalancedDelimiters(code, [["(", ")"], ["[", "]"], ["{", "}"]]);
  if (!balanced) warnings.push("Unbalanced parentheses, brackets, or braces in Python code.");
  return { valid: warnings.length === 0, warnings };
}

function validateJavaSyntax(code) {
  if (typeof code !== "string" || !code.trim()) {
    return { valid: false, warnings: ["Code is empty."] };
  }
  const warnings = [];
  const balanced = checkBalancedDelimiters(code, [["{", "}"], ["(", ")"], ["[", "]"]]);
  if (!balanced) warnings.push("Unbalanced braces, parentheses, or brackets in Java code.");
  return { valid: warnings.length === 0, warnings };
}

function validateJavaScriptSyntax(code) {
  if (typeof code !== "string" || !code.trim()) {
    return { valid: false, warnings: ["Code is empty."] };
  }
  const warnings = [];
  const balanced = checkBalancedDelimiters(code, [["{", "}"], ["(", ")"], ["[", "]"]]);
  if (!balanced) warnings.push("Unbalanced braces, parentheses, or brackets in JavaScript code.");
  return { valid: warnings.length === 0, warnings };
}
