/** Pure portal-decor rules. No DOM, browser, storage, or network dependencies. */

const PORTAL_DECOR_MONTHS = Object.freeze({
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
});

function portalDecorPad(value) {
  return String(value).padStart(2, "0");
}

function portalDecorNormalize(value) {
  return String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
}

export function parseDeadline(text) {
  const raw = portalDecorNormalize(text);
  const match = raw.match(/^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),\s*(\d{4})\s+(?:at\s+)?(\d{1,2}):(\d{2})\s*(AM|PM)\s+(IST)$/i);
  if (!match) return { raw, iso: null, tz: null };

  const month = PORTAL_DECOR_MONTHS[match[1].toLowerCase()];
  const day = Number(match[2]);
  const year = Number(match[3]);
  let hour = Number(match[4]);
  const minute = Number(match[5]);
  const meridiem = match[6].toUpperCase();
  if (hour < 1 || hour > 12 || minute > 59) return { raw, iso: null, tz: null };
  if (meridiem === "AM") hour = hour === 12 ? 0 : hour;
  else hour = hour === 12 ? 12 : hour + 12;

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return { raw, iso: null, tz: null };
  return {
    raw,
    iso: `${year}-${portalDecorPad(month)}-${portalDecorPad(day)}T${portalDecorPad(hour)}:${portalDecorPad(minute)}:00+05:30`,
    tz: "IST",
  };
}

export function classifyByTitle(title) {
  const value = String(title ?? "");
  if (/not graded/i.test(value)) return "practice";
  if (/\bGrPA\b|\bGA\b|graded assignment|\bOPPE\b|\bquiz\b/i.test(value)) return "graded";
  if (/\bpractice\b/i.test(value)) return "practice";
  return "unknown";
}

export function classifyByMode(modeText) {
  const value = portalDecorNormalize(modeText);
  if (/^graded$/i.test(value)) return "graded";
  return "unknown";
}

export function effectiveClass(modeText, title) {
  const modeClass = classifyByMode(modeText);
  return modeClass === "unknown" ? classifyByTitle(title) : modeClass;
}

export function assignmentKey(courseKey, week, title) {
  return [courseKey, week, title].map(portalDecorNormalize).join(" ").toLocaleLowerCase();
}

export function relativeText(iso, now = new Date()) {
  if (!iso) return "";
  const due = Date.parse(iso);
  const current = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(due) || !Number.isFinite(current)) return "";
  const diff = due - current;
  if (diff < 0) return "Past due";
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  if (diff < hour) return "Due in under 1 hour";
  if (diff < day) return `Due in ${Math.floor(diff / hour)} hours`;
  return `Due in ${Math.floor(diff / day)} days`;
}

export function portalDecorNormalizeText(value) {
  return portalDecorNormalize(value);
}
