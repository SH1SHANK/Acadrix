/**
 * Keyboard Shortcut Resolution Utilities.
 * Maps physical keys (e.code) to consistent modifier strings across platforms.
 */

export const keyName = (e) => {
  const c = e.code || "";
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit[0-9]$/.test(c)) return c.slice(5);
  if (/^Numpad[0-9]$/.test(c)) return "Num" + c.slice(6);
  if (/^F\d{1,2}$/.test(c)) return c;
  const names = {
    Space: "Space",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Escape: "Esc",
  };
  if (names[c]) return names[c];
  const k = e.key || "";
  return k.length === 1 ? k.toUpperCase() : k;
};

export const shortcutFromEvent = (e) => {
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return "";
  const key = keyName(e);
  const parts = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");
  if (!parts.length && !/^F\d{1,2}$/.test(key)) return "";
  parts.push(key);
  return parts.join("+");
};

export const isTypingTarget = (el) =>
  Boolean(el?.closest?.("input, textarea, select, [contenteditable=true], [contenteditable='']"));
