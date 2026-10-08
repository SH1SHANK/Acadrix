/**
 * High-Performance, Zero-Dependency Academic Code Tokenizer.
 * 
 * Tokenizes academic programming languages (Python, Java, C, C++, SQL, JavaScript, Plaintext)
 * strictly adhering to Acadrix DESIGN.md §7:
 * - Keyword: --acx-accent (#2F4BDB)
 * - String: --acx-success (#1A7F4B)
 * - Comment: --acx-text-subtle (#6B707B)
 * - Number: --acx-warning (#9A6700)
 * - Operator/Punctuation: --acx-text-muted (#5B606B)
 * - Plain / Identifier: --acx-text (#16181D)
 * 
 * Preserves exact whitespace, tabs, and indentation across all lines.
 */

export const CODE_COLORS = Object.freeze({
  KEYWORD: "#2F4BDB",
  STRING: "#1A7F4B",
  COMMENT: "#6B707B",
  NUMBER: "#9A6700",
  OPERATOR: "#5B606B",
  DEFAULT: "#16181D",
});

const PYTHON_KEYWORDS = new Set([
  "and", "as", "assert", "async", "await", "break", "class", "continue",
  "def", "del", "elif", "else", "except", "finally", "for", "from",
  "global", "if", "import", "in", "is", "lambda", "nonlocal", "not",
  "or", "pass", "raise", "return", "try", "while", "with", "yield",
  "self", "cls", "True", "False", "None"
]);

const JAVA_CPP_KEYWORDS = new Set([
  "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char",
  "class", "const", "continue", "default", "do", "double", "else", "enum",
  "extends", "final", "finally", "float", "for", "goto", "if", "implements",
  "import", "instanceof", "int", "interface", "long", "native", "new",
  "package", "private", "protected", "public", "return", "short", "static",
  "strictfp", "super", "switch", "synchronized", "this", "throw", "throws",
  "transient", "try", "void", "volatile", "while", "true", "false", "null",
  "struct", "typedef", "sizeof", "include", "template", "typename", "namespace",
  "using", "auto", "virtual", "override"
]);

const SQL_KEYWORDS = new Set([
  "select", "from", "where", "insert", "into", "update", "delete", "create",
  "drop", "alter", "table", "index", "view", "join", "inner", "left", "right",
  "full", "outer", "cross", "on", "group", "by", "order", "having", "asc",
  "desc", "limit", "offset", "union", "all", "distinct", "as", "and", "or",
  "not", "in", "between", "like", "is", "null", "primary", "key", "foreign",
  "references", "check", "default", "values", "set", "case", "when", "then",
  "else", "end", "exists", "count", "sum", "avg", "min", "max", "cast"
]);

const JS_KEYWORDS = new Set([
  "async", "await", "break", "case", "catch", "class", "const", "continue",
  "debugger", "default", "delete", "do", "else", "export", "extends",
  "finally", "for", "function", "if", "import", "in", "instanceof", "let",
  "new", "return", "super", "switch", "this", "throw", "try", "typeof",
  "var", "void", "while", "with", "yield", "true", "false", "null", "undefined"
]);

/**
 * Tokenizes raw code into structured lines of styled tokens.
 * 
 * @param {string} rawCode Code source
 * @param {string} [language="text"] Language identifier
 * @returns {Array<Array<{ text: string, color: string, bold?: boolean }>>}
 */
export function tokenizeCode(rawCode, language = "text") {
  if (typeof rawCode !== "string") return [];
  const normalizedLang = (language || "text").toLowerCase().trim();

  // Normalize Windows newlines
  const text = rawCode.replace(/\r\n/g, "\n");
  const rawLines = text.split("\n");

  let keywordSet = null;
  let isCaseInsensitiveKeywords = false;
  let lineCommentChar = null;
  let blockCommentStart = null;
  let blockCommentEnd = null;

  if (normalizedLang.includes("py")) {
    keywordSet = PYTHON_KEYWORDS;
    lineCommentChar = "#";
  } else if (
    normalizedLang.includes("java") ||
    normalizedLang.includes("c++") ||
    normalizedLang.includes("cpp") ||
    normalizedLang.includes("c") ||
    normalizedLang.includes("cs")
  ) {
    keywordSet = JAVA_CPP_KEYWORDS;
    lineCommentChar = "//";
    blockCommentStart = "/*";
    blockCommentEnd = "*/";
  } else if (normalizedLang.includes("sql")) {
    keywordSet = SQL_KEYWORDS;
    isCaseInsensitiveKeywords = true;
    lineCommentChar = "--";
    blockCommentStart = "/*";
    blockCommentEnd = "*/";
  } else if (
    normalizedLang.includes("js") ||
    normalizedLang.includes("ts") ||
    normalizedLang.includes("javascript") ||
    normalizedLang.includes("typescript")
  ) {
    keywordSet = JS_KEYWORDS;
    lineCommentChar = "//";
    blockCommentStart = "/*";
    blockCommentEnd = "*/";
  }

  // Tokenize line by line, preserving state across lines for multi-line comments/strings
  let inBlockComment = false;
  let inMultiLineString = null; // '"""' | "'''"

  const result = [];

  for (const line of rawLines) {
    const tokens = [];
    let i = 0;
    const len = line.length;

    while (i < len) {
      // 1. Block comment continuation
      if (inBlockComment) {
        const endIdx = line.indexOf(blockCommentEnd, i);
        if (endIdx === -1) {
          tokens.push({ text: line.slice(i), color: CODE_COLORS.COMMENT });
          i = len;
        } else {
          tokens.push({ text: line.slice(i, endIdx + blockCommentEnd.length), color: CODE_COLORS.COMMENT });
          i = endIdx + blockCommentEnd.length;
          inBlockComment = false;
        }
        continue;
      }

      // 2. Python triple-quote string continuation
      if (inMultiLineString) {
        const endIdx = line.indexOf(inMultiLineString, i);
        if (endIdx === -1) {
          tokens.push({ text: line.slice(i), color: CODE_COLORS.STRING });
          i = len;
        } else {
          tokens.push({ text: line.slice(i, endIdx + inMultiLineString.length), color: CODE_COLORS.STRING });
          i = endIdx + inMultiLineString.length;
          inMultiLineString = null;
        }
        continue;
      }

      // 3. Whitespace & Indentation preservation
      if (/\s/.test(line[i])) {
        let ws = "";
        while (i < len && /\s/.test(line[i])) {
          ws += line[i];
          i += 1;
        }
        tokens.push({ text: ws, color: CODE_COLORS.DEFAULT });
        continue;
      }

      // 4. Line Comment
      if (lineCommentChar && line.startsWith(lineCommentChar, i)) {
        tokens.push({ text: line.slice(i), color: CODE_COLORS.COMMENT });
        i = len;
        continue;
      }

      // 5. Block Comment Start
      if (blockCommentStart && line.startsWith(blockCommentStart, i)) {
        const endIdx = line.indexOf(blockCommentEnd, i + blockCommentStart.length);
        if (endIdx === -1) {
          tokens.push({ text: line.slice(i), color: CODE_COLORS.COMMENT });
          inBlockComment = true;
          i = len;
        } else {
          tokens.push({ text: line.slice(i, endIdx + blockCommentEnd.length), color: CODE_COLORS.COMMENT });
          i = endIdx + blockCommentEnd.length;
        }
        continue;
      }

      // 6. Python Triple Quote String Start
      if (line.startsWith('"""', i) || line.startsWith("'''", i)) {
        const quote = line.slice(i, i + 3);
        const endIdx = line.indexOf(quote, i + 3);
        if (endIdx === -1) {
          tokens.push({ text: line.slice(i), color: CODE_COLORS.STRING });
          inMultiLineString = quote;
          i = len;
        } else {
          tokens.push({ text: line.slice(i, endIdx + 3), color: CODE_COLORS.STRING });
          i = endIdx + 3;
        }
        continue;
      }

      // 7. Single or Double Quoted String
      if (line[i] === '"' || line[i] === "'" || line[i] === "`") {
        const quote = line[i];
        let str = quote;
        i += 1;
        let escaped = false;
        while (i < len) {
          const ch = line[i];
          str += ch;
          i += 1;
          if (escaped) {
            escaped = false;
          } else if (ch === "\\") {
            escaped = true;
          } else if (ch === quote) {
            break;
          }
        }
        tokens.push({ text: str, color: CODE_COLORS.STRING });
        continue;
      }

      // 8. Numbers (Hex, Binary, Dec, Float)
      if (/\d/.test(line[i]) || (line[i] === "." && i + 1 < len && /\d/.test(line[i + 1]))) {
        let num = "";
        if (line[i] === "0" && i + 1 < len && /[xXbBoO]/.test(line[i + 1])) {
          num += line[i] + line[i + 1];
          i += 2;
          while (i < len && /[0-9a-fA-F_]/.test(line[i])) {
            num += line[i];
            i += 1;
          }
        } else {
          while (i < len && /[0-9._eE+-]/.test(line[i])) {
            // Guard: stop sign if not part of exponential notation
            if ((line[i] === "+" || line[i] === "-") && !/[eE]/.test(num.slice(-1))) {
              break;
            }
            num += line[i];
            i += 1;
          }
        }
        tokens.push({ text: num, color: CODE_COLORS.NUMBER });
        continue;
      }

      // 9. Identifiers & Keywords
      if (/[a-zA-Z_$]/.test(line[i])) {
        let word = "";
        while (i < len && /[a-zA-Z0-9_$]/.test(line[i])) {
          word += line[i];
          i += 1;
        }

        const lookupWord = isCaseInsensitiveKeywords ? word.toLowerCase() : word;
        if (keywordSet && keywordSet.has(lookupWord)) {
          tokens.push({ text: word, color: CODE_COLORS.KEYWORD, bold: true });
        } else {
          tokens.push({ text: word, color: CODE_COLORS.DEFAULT });
        }
        continue;
      }

      // 10. Operators & Punctuation
      let op = line[i];
      i += 1;
      tokens.push({ text: op, color: CODE_COLORS.OPERATOR });
    }

    result.push(tokens);
  }

  return result;
}
