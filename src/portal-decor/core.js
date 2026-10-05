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

export function portalDecorNormalize(value) {
  return String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
}

export function portalDecorNormalizeText(value) {
  return portalDecorNormalize(value);
}

/**
 * Derives normalized academic term ID (e.g. "2026-09") from IITM header text.
 * Matches patterns like "Sep 2026 - MAD II", "September 2026", "2026-09", etc.
 * @param {string} courseKeyText
 * @returns {string} e.g. "2026-09"
 */
export function parseTermId(courseKeyText) {
  const raw = portalDecorNormalize(courseKeyText);
  if (!raw) return "2026-09";

  // Check for ISO-like term format e.g. "2026-09"
  const isoMatch = raw.match(/\b(20\d{2})[-_/](0[1-9]|1[0-2])\b/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}`;
  }

  // Check for Month Year format e.g. "Sep 2026", "September 2026", "2026 Sep"
  const monthYearMatch = raw.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s*(20\d{2})\b/i) ||
    raw.match(/\b(20\d{2})\s*(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b/i);

  if (monthYearMatch) {
    const isFirstMonth = PORTAL_DECOR_MONTHS[monthYearMatch[1].toLowerCase()] !== undefined;
    const monthStr = isFirstMonth ? monthYearMatch[1] : monthYearMatch[2];
    const yearStr = isFirstMonth ? monthYearMatch[2] : monthYearMatch[1];
    const monthNum = PORTAL_DECOR_MONTHS[monthStr.toLowerCase()];
    if (monthNum) {
      return `${yearStr}-${portalDecorPad(monthNum)}`;
    }
  }

  return "2026-09";
}

/**
 * Derives normalized CourseCode (e.g. "CS2006") from IITM header text and context.
 * @param {string} courseKeyText
 * @param {string} [titleText]
 * @returns {string} e.g. "CS2006", "CS2005", "SE2001", "MS2001", "CS2006P"
 */
export function parseCourseCode(courseKeyText, titleText = "") {
  const raw = `${portalDecorNormalize(courseKeyText)} ${portalDecorNormalize(titleText)}`.toUpperCase();

  // 1. Explicit course code matching
  if (/\bCS2006P\b/.test(raw) || /\bMAD[-_ ]?2[-_ ]?PROJECT\b/.test(raw) || /\bMAD[-_ ]?II[-_ ]?PROJECT\b/.test(raw)) {
    return "CS2006P";
  }
  if (/\bCS2006\b/.test(raw) || /\bMAD[-_ ]?II\b/.test(raw) || /\bMAD[-_ ]?2\b/.test(raw) || /\bAPPLICATION DEVELOPMENT[-_ ]?(?:II|2)\b/.test(raw)) {
    return "CS2006";
  }
  if (/\bCS2005\b/.test(raw) || /\bJAVA\b/.test(raw) || /\bPROGRAMMING CONCEPTS USING JAVA\b/.test(raw)) {
    return "CS2005";
  }
  if (/\bSE2001\b/.test(raw) || /\bSYSTEM COMMANDS\b/.test(raw)) {
    return "SE2001";
  }
  if (/\bMS2001\b/.test(raw) || /\bBDM\b/.test(raw) || /\bBUSINESS DATA MANAGEMENT\b/.test(raw)) {
    return "MS2001";
  }

  // 2. Generic code extractor pattern e.g. "CS1001", "MA2001"
  const genericMatch = raw.match(/\b([A-Z]{2}\d{4}[A-Z]?)\b/);
  if (genericMatch) {
    return genericMatch[1];
  }

  return "UNKNOWN_COURSE";
}

/**
 * Constructs a deterministic external assignment ID.
 * Prefers stable portal DOM attributes / link IDs, falling back to normalized composite hash.
 * @param {string} termId
 * @param {string} courseCode
 * @param {string} module
 * @param {string} title
 * @param {Element|null} [linkEl]
 * @returns {string}
 */
export function createExternalAssignmentId(termId, courseCode, module, title, linkEl = null) {
  // 1. Check for explicit data attributes on link element
  if (linkEl) {
    const dataId = linkEl.getAttribute?.("data-assignment-id") ||
      linkEl.getAttribute?.("data-id") ||
      linkEl.getAttribute?.("data-assessment-id");
    if (dataId && typeof dataId === "string" && dataId.trim().length > 0) {
      return portalDecorNormalize(dataId);
    }

    // 2. Check for route / link href parameters
    const href = linkEl.getAttribute?.("href") || "";
    const routeMatch = href.match(/\/(?:assignment|assessment|exam|quiz)\/([a-zA-Z0-9_-]+)/i);
    if (routeMatch && routeMatch[1]) {
      return portalDecorNormalize(routeMatch[1]);
    }
  }

  // 3. Deterministic composite fallback
  const cleanTerm = portalDecorNormalize(termId).replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
  const cleanCourse = portalDecorNormalize(courseCode).replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
  const cleanModule = portalDecorNormalize(module).replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
  const cleanTitle = portalDecorNormalize(title).replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();

  const combined = `${cleanTerm}_${cleanCourse}_${cleanModule}_${cleanTitle}`
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

  return combined || "assignment_unknown";
}

export function parseDeadline(text) {
  let raw = portalDecorNormalize(text);
  if (!raw) return { raw: "", iso: null, tz: null };

  // If already an ISO string format e.g. "2026-10-11T23:59:00+05:30" or "2026-10-11T18:29:00.000Z"
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    return { raw, iso: raw, tz: "IST" };
  }

  // Strip leading prefixes like "Due:", "Deadline:", "Submission closes:"
  const cleaned = raw.replace(/^(?:due|deadline|submission closes|closes|ends)\s*:\s*/i, "").trim();

  // Pattern 1: Month Day, Year [at/comma] Hour:Minute[:Second] AM/PM [IST]
  // e.g. "Oct 11, 2026 at 11:59 PM IST", "Oct 11, 2026 11:59 PM IST", "Dec 31, 2026 11:59 PM IST", "Dec 31 2026 11:59 PM IST"
  let match = cleaned.match(
    /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s*(\d{4})[, ]\s*(?:at\s+)?(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)(?:\s+(IST))?$/i
  );

  let monthStr, dayNum, yearNum, hourNum, minNum, meridiemStr;

  if (match) {
    monthStr = match[1];
    dayNum = Number(match[2]);
    yearNum = Number(match[3]);
    hourNum = Number(match[4]);
    minNum = Number(match[5]);
    meridiemStr = match[6].toUpperCase();
  } else {
    // Pattern 2: Day Month Year [at/comma] Hour:Minute[:Second] AM/PM [IST]
    // e.g. "11 Oct 2026 11:59 PM IST", "11 Oct, 2026 at 11:59 PM IST"
    match = cleaned.match(
      /^(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?),?\s*(\d{4})[, ]\s*(?:at\s+)?(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)(?:\s+(IST))?$/i
    );
    if (match) {
      dayNum = Number(match[1]);
      monthStr = match[2];
      yearNum = Number(match[3]);
      hourNum = Number(match[4]);
      minNum = Number(match[5]);
      meridiemStr = match[6].toUpperCase();
    }
  }

  if (!match) return { raw, iso: null, tz: null };

  const month = PORTAL_DECOR_MONTHS[monthStr.toLowerCase()];
  if (!month) return { raw, iso: null, tz: null };

  let hour = hourNum;
  const minute = minNum;
  if (hour < 1 || hour > 12 || minute > 59) return { raw, iso: null, tz: null };
  if (meridiemStr === "AM") hour = hour === 12 ? 0 : hour;
  else hour = hour === 12 ? 12 : hour + 12;

  const daysInMonth = new Date(Date.UTC(yearNum, month, 0)).getUTCDate();
  if (dayNum < 1 || dayNum > daysInMonth) return { raw, iso: null, tz: null };
  return {
    raw,
    iso: `${yearNum}-${portalDecorPad(month)}-${portalDecorPad(dayNum)}T${portalDecorPad(hour)}:${portalDecorPad(minute)}:00+05:30`,
    tz: "IST",
  };
}

export function classifyByTitle(title) {
  const value = String(title ?? "");
  if (/not graded/i.test(value)) return "practice";
  if (/\b(?:GrPA|GA|graded\s+assignment|graded\s+programming|OPPE|quiz|end\s*term|mid\s*term|bpt)\b/i.test(value)) return "graded";
  if (/\b(?:ppa|aq|practice|activity\s+questions?|activity|weekly\s+activity|self\s+assessment)\b/i.test(value)) return "practice";
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

/**
 * Parses numerical score, percentage, fraction, or pending state.
 * Guaranteed: "-" or missing returns score = null (never 0).
 * @param {string} text
 * @returns {{ score: number | null, raw: string }}
 */
export function parseScore(text) {
  const raw = portalDecorNormalize(text);
  if (!raw || raw === "-" || raw === "N/A" || raw === "null" || raw === "undefined") {
    return { score: null, raw: raw || "" };
  }
  const cleaned = raw.replace(/^(?:Your Score|Peer Average|Median Score)\s*:\s*/i, "").trim();
  if (!cleaned || cleaned === "-" || cleaned === "N/A") {
    return { score: null, raw: cleaned || raw };
  }

  // Fraction score e.g. "100 / 100", "95/100", "45 / 50"
  const fractionMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (fractionMatch) {
    const num = Number(fractionMatch[1]);
    const den = Number(fractionMatch[2]);
    if (Number.isFinite(num) && Number.isFinite(den) && den > 0) {
      const calculated = (num / den) * 100;
      return { score: Math.round(calculated * 100) / 100, raw: cleaned };
    }
  }

  // Percentage or pure number e.g. "94%", "100", "0", "82.5"
  const numMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*%?$/);
  if (numMatch) {
    const val = Number(numMatch[1]);
    if (Number.isFinite(val) && val >= 0 && val <= 100) {
      return { score: val, raw: cleaned };
    }
  }

  return { score: null, raw: cleaned };
}

export function deriveGradeStatus(yourScore, evaluationStatus, deadlineIso, now = new Date()) {
  if (yourScore !== null && Number.isFinite(yourScore)) {
    return "GRADED";
  }
  const evalStatus = String(evaluationStatus ?? "").toLowerCase();
  if (evalStatus.includes("evaluation pending")) {
    return "PENDING";
  }
  if (evalStatus.includes("due date pending")) {
    return "UNRELEASED";
  }
  if (deadlineIso) {
    const due = new Date(deadlineIso).getTime();
    const curr = now instanceof Date ? now.getTime() : new Date(now).getTime();
    if (Number.isFinite(due) && due < curr) {
      return "PENDING";
    }
  }
  return "UNRELEASED";
}

/**
 * Derives submission status based on available authoritative portal evidence.
 * Supports both object argument and positional arguments.
 *
 * @param {object|number|null} optionsOrScore
 * @param {string} [evaluationStatusArg]
 * @param {string|null} [deadlineIsoArg]
 * @param {Date|number} [nowArg]
 * @returns {"SUBMITTED"|"NOT_SUBMITTED"|"PENDING"|"UNKNOWN"}
 */
export function deriveSubmissionStatus(optionsOrScore, evaluationStatusArg = "", deadlineIsoArg = null, nowArg = new Date()) {
  let yourScore = null;
  let evaluationStatus = "";
  let deadlineIso = null;
  let now = new Date();
  let isReview = false;
  let isSubmittedText = false;

  if (optionsOrScore !== null && typeof optionsOrScore === "object" && !(optionsOrScore instanceof Date)) {
    yourScore = optionsOrScore.yourScore ?? null;
    evaluationStatus = optionsOrScore.evaluationStatus ?? "";
    deadlineIso = optionsOrScore.deadlineIso ?? null;
    now = optionsOrScore.now ?? new Date();
    isReview = Boolean(optionsOrScore.isReview);
    isSubmittedText = Boolean(optionsOrScore.isSubmittedText);
  } else {
    yourScore = optionsOrScore ?? null;
    evaluationStatus = evaluationStatusArg ?? "";
    deadlineIso = deadlineIsoArg ?? null;
    now = nowArg ?? new Date();
  }

  // 1. Explicit in-page submitted text or review mode indicator
  if (isSubmittedText || isReview) {
    return "SUBMITTED";
  }

  // 2. Authoritative numerical score proves submission
  if (yourScore !== null && Number.isFinite(yourScore)) {
    return "SUBMITTED";
  }

  const evalLower = String(evaluationStatus ?? "").toLowerCase();

  // 3. Explicit evaluated status proves submission
  if (evalLower.includes("evaluated")) {
    return "SUBMITTED";
  }

  // 4. Evaluation pending implies submitted and awaiting evaluation
  if (evalLower.includes("evaluation pending")) {
    return "PENDING";
  }

  // 5. Due date pending with no score implies not yet submitted
  if (evalLower.includes("due date pending")) {
    return "NOT_SUBMITTED";
  }

  // 6. Insufficient evidence
  return "UNKNOWN";
}

export function parseAssignmentType(subtitleText) {
  const val = portalDecorNormalize(subtitleText);
  if (/programming assignment/i.test(val) || /\b(?:grpa|ppa)\b/i.test(val)) return "Programming Assignment";
  if (/practice assignment/i.test(val)) return "Practice Assignment";
  if (/graded assignment/i.test(val) || /\bga\b/i.test(val)) return "Graded Assignment";
  if (/activity question/i.test(val) || /\baq\b/i.test(val) || /\bactivity\b/i.test(val)) return "Activity Question";
  if (/quiz/i.test(val)) return "Quiz";
  if (/assignment/i.test(val)) return "Assignment";
  return "Assignment";
}
