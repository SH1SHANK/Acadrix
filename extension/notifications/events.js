/**
 * Canonical Academic Event Repository for Acadrix.
 * 
 * Retrieves course-independent weekly assignment deadlines from the
 * authoritative Supabase public.academic_events table.
 * 
 * Enforces Sections 1, 2, 7-10, 13, 18, 21, 23 of the Academic Data Architecture:
 * - Single source of truth: public.academic_events
 * - Zero IITM portal deadline or grade scraping
 * - Zero submission status inference (submissionStatus is strictly UNKNOWN)
 * - Deterministic event and deadline categorization
 * - Resilient offline caching with explicit state (UP_TO_DATE, STALE, UNAVAILABLE, EMPTY)
 * - Deterministic sorting and identity: `${termId}:${eventId}`
 */

export const DEFAULT_SUPABASE_URL = "https://aocrcrdmwmdtthrwypii.supabase.co";
export const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvY3JjcmRtd21kdHRocnd5cGlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0ODg5OTYsImV4cCI6MjEwNjA2NDk5Nn0.LTTbBscGie1nfUTnjAjvuuJ2tjW0F4znDl9C5C8bAp8";

export const ACADEMIC_EVENTS_CACHE_KEY = "acx:events:v2";
export const DEFAULT_TERM_ID = "2026-09";

export const RepositoryState = Object.freeze({
  UP_TO_DATE: "UP_TO_DATE",
  STALE: "STALE",
  UNAVAILABLE: "UNAVAILABLE",
  EMPTY: "EMPTY",
  LOADING: "LOADING",
});

export const EventImportance = Object.freeze({
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
});

export const DeadlineCategory = Object.freeze({
  ASSIGNMENT: "assignment",
  BPT: "bpt_deadline",
  PROJECT: "project_submission",
  CUTOFF: "eligibility_close",
  MILESTONE: "academic_milestone",
  EXAM: "exam",
});

function isWeeklyAssignmentDeadline(row) {
  if (!row || typeof row !== "object") return false;
  const courseCode = row.course_code ?? row.courseCode;
  const eventType = String(row.event_type ?? row.eventType ?? "").toLowerCase();
  const id = String(row.id ?? "");
  return courseCode == null && eventType === "assignment" && id.startsWith("assignment_weekly_");
}

/**
 * Checks whether an academic event record constitutes a time-sensitive deadline.
 * Evaluates semantic database flags rather than brittle title matching (§9).
 *
 * @param {object} row Raw or normalized event object
 * @returns {boolean}
 */
export function isAcademicDeadline(row) {
  if (!row || typeof row !== "object") return false;

  // 1. Explicit hard cutoff flag from database
  if (row.is_hard_cutoff || row.isHardCutoff) return true;

  // 2. Explicit cutoff type classification
  if (row.cutoff_type || row.cutoffType) return true;

  // 3. Known deadline event types
  const type = (row.event_type || row.eventType || "").toLowerCase();
  if (
    type === "assignment" ||
    type === "bpt_deadline" ||
    type === "project_submission" ||
    type === "eligibility_close"
  ) {
    return true;
  }

  // 4. Milestone events with explicit cutoff/deadline identifiers
  const id = (row.id || "").toLowerCase();
  if (id.includes("deadline") || id.includes("cutoff") || id.includes("_due")) {
    return true;
  }

  return false;
}

/**
 * Resolves the authoritative ISO deadline timestamp for an academic event.
 * Follows the stored timestamp hierarchy: end_time > start_time > event_date.
 *
 * @param {object} row
 * @returns {string|null}
 */
export function resolveEventDeadlineIso(row) {
  if (!row || typeof row !== "object") return null;

  const endTime = row.end_time || row.endTime;
  if (endTime) {
    const d = new Date(endTime);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  const startTime = row.start_time || row.startTime;
  const isCutoff = Boolean(row.is_hard_cutoff || row.isHardCutoff || row.cutoff_type || row.cutoffType);
  if (isCutoff && startTime) {
    const d = new Date(startTime);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  const eventDate = row.event_date || row.eventDate;
  if (eventDate && /^\d{4}-\d{2}-\d{2}$/.test(String(eventDate).slice(0, 10))) {
    // 23:59 IST anchor (18:29 UTC)
    return `${String(eventDate).slice(0, 10)}T18:29:00.000Z`;
  }

  return null;
}

/**
 * Normalizes a raw Supabase academic_events row into the canonical extension representation (§8).
 *
 * @param {object} row Raw database row from public.academic_events
 * @returns {object} Normalized canonical academic event
 */
export function normalizeAcademicEvent(row) {
  if (!row || typeof row !== "object") {
    throw new TypeError("normalizeAcademicEvent requires a valid event row object");
  }

  const termId = String(row.term_id || row.termId || DEFAULT_TERM_ID).trim();
  const id = String(row.id || "").trim();
  const eventIdentity = `${termId}:${id}`;

  const isDeadline = isAcademicDeadline(row);
  const deadlineIso = resolveEventDeadlineIso(row);

  return {
    identity: eventIdentity,
    id,
    termId,
    courseCode: row.course_code ? String(row.course_code).trim() : null,
    title: String(row.title || "Academic Event").trim(),
    eventType: String(row.event_type || row.eventType || "academic_milestone").trim(),
    subType: row.sub_type ? String(row.sub_type).trim() : null,
    startTime: row.start_time ? new Date(row.start_time).toISOString() : null,
    endTime: row.end_time ? new Date(row.end_time).toISOString() : null,
    eventDate: row.event_date ? String(row.event_date).slice(0, 10) : "",
    timeStr: row.time_str ? String(row.time_str).trim() : null,
    importance: String(row.importance || "medium").toLowerCase().trim(),
    isHardCutoff: Boolean(row.is_hard_cutoff ?? row.isHardCutoff),
    cutoffType: row.cutoff_type ? String(row.cutoff_type).trim() : null,
    description: String(row.description || "").trim(),
    source: "SUPABASE",
    isDeadline,
    deadlineIso,
    // Strictly UNKNOWN: no false submission inferences (§13)
    submissionStatus: "UNKNOWN",
  };
}

/**
 * Storage adapter helper for browser extension storage (chrome.storage.local).
 */
function getStorageArea() {
  try {
    return globalThis.chrome?.storage?.local || null;
  } catch {
    return null;
  }
}

async function readCache(key = ACADEMIC_EVENTS_CACHE_KEY) {
  const store = getStorageArea();
  if (!store?.get) return null;
  return new Promise((resolve) => {
    try {
      store.get({ [key]: null }, (res) => resolve(res?.[key] || null));
    } catch {
      resolve(null);
    }
  });
}

async function writeCache(data, key = ACADEMIC_EVENTS_CACHE_KEY) {
  const store = getStorageArea();
  if (!store?.set) return;
  return new Promise((resolve) => {
    try {
      store.set({ [key]: data }, () => resolve());
    } catch {
      resolve();
    }
  });
}

/**
 * Single Authoritative Data Access Layer for Academic Events.
 */
export class AcademicEventRepository {
  constructor({
    supabaseUrl = DEFAULT_SUPABASE_URL,
    apiKey = DEFAULT_SUPABASE_ANON_KEY,
    fetchFn = typeof globalThis !== "undefined" ? globalThis.fetch : null,
    cacheKey = ACADEMIC_EVENTS_CACHE_KEY,
    defaultTermId = DEFAULT_TERM_ID,
  } = {}) {
    this.supabaseUrl = (supabaseUrl || DEFAULT_SUPABASE_URL).replace(/\/+$/, "");
    this.apiKey = apiKey || DEFAULT_SUPABASE_ANON_KEY;
    this.fetchFn = fetchFn || (typeof globalThis !== "undefined" ? globalThis.fetch.bind(globalThis) : null);
    this.cacheKey = cacheKey || ACADEMIC_EVENTS_CACHE_KEY;
    this.defaultTermId = defaultTermId || DEFAULT_TERM_ID;
  }

  /**
   * Fetches only course-independent weekly assignment deadlines for a term, using local caching.
   *
   * @param {object} [options]
   * @param {string} [options.termId] Target term (default: 2026-09)
   * @param {boolean} [options.forceRefresh=false]
   * @param {Function} [options.fetchFn]
   * @returns {Promise<{ events: Array<object>, state: string, fetchedAt: string|null, error: string|null }>}
   */
  async getAcademicEvents({
    termId = this.defaultTermId,
    forceRefresh = false,
    fetchFn = this.fetchFn,
  } = {}) {
    const cached = await readCache(this.cacheKey);

    // If cache is fresh and not forced, return cached data
    if (
      !forceRefresh &&
      cached &&
      cached.termId === termId &&
      Array.isArray(cached.events) &&
      cached.events.some(isWeeklyAssignmentDeadline)
    ) {
      return {
        events: cached.events.filter(isWeeklyAssignmentDeadline),
        state: RepositoryState.UP_TO_DATE,
        fetchedAt: cached.fetchedAt || null,
        error: null,
      };
    }

    // Attempt live fetch from Supabase public.academic_events via REST API
    if (typeof fetchFn === "function") {
      try {
        const queryParams = new URLSearchParams({
          select: "*",
          order: "event_date.asc,start_time.asc",
        });
        if (termId) {
          queryParams.set("term_id", `eq.${termId}`);
        }
        queryParams.set("course_code", "is.null");
        queryParams.set("event_type", "eq.assignment");
        queryParams.set("id", "like.assignment_weekly_%");

        const endpoint = `${this.supabaseUrl}/rest/v1/academic_events?${queryParams.toString()}`;
        const resp = await fetchFn(endpoint, {
          method: "GET",
          headers: {
            apikey: this.apiKey,
            Authorization: `Bearer ${this.apiKey}`,
            Accept: "application/json",
          },
        });

        if (resp.ok) {
          const rawRows = await resp.json();
          if (Array.isArray(rawRows)) {
            const normalized = rawRows
              .filter(isWeeklyAssignmentDeadline)
              .map((r) => normalizeAcademicEvent(r));
            const nowIso = new Date().toISOString();
            const cachePayload = {
              fetchedAt: nowIso,
              termId,
              events: normalized,
              source: "SUPABASE",
            };

            await writeCache(cachePayload, this.cacheKey);

            return {
              events: normalized,
              state: normalized.length === 0 ? RepositoryState.EMPTY : RepositoryState.UP_TO_DATE,
              fetchedAt: nowIso,
              error: null,
            };
          }
        }
      } catch (err) {
        console.warn("[AcademicEventRepository] Network fetch error, checking local cache:", err.message);
      }
    }

    // Offline / Network Failure Fallback (§18)
    if (cached && Array.isArray(cached.events)) {
      const cachedWeeklyEvents = cached.events.filter(isWeeklyAssignmentDeadline);
      if (cachedWeeklyEvents.length > 0) {
        return {
          events: cachedWeeklyEvents,
          state: RepositoryState.STALE,
          fetchedAt: cached.fetchedAt || null,
          error: "Supabase unavailable; serving stale cached events.",
        };
      }
    }

    return {
      events: [],
      state: RepositoryState.UNAVAILABLE,
      fetchedAt: null,
      error: "Supabase unavailable and no local academic events cache exists.",
    };
  }

  /**
   * Returns upcoming academic events sorted deterministically (§21).
   *
   * Sorting Precedence:
   * 1. Overdue hard cutoffs
   * 2. Today's hard cutoffs
   * 3. Tomorrow's deadlines
   * 4. Near-term deadlines
   * 5. Important upcoming events
   * 6. Other upcoming events
   * (Within group: earliest timestamp first).
   *
   * @param {object} [options]
   * @returns {Promise<{ events: Array<object>, state: string, fetchedAt: string|null, error: string|null }>}
   */
  async getUpcomingAcademicEvents(options = {}) {
    const result = await this.getAcademicEvents(options);
    if (!result.events || result.events.length === 0) {
      return result;
    }

    const now = options.now ? new Date(options.now) : new Date();
    const sorted = sortAcademicEvents(result.events, now);

    return {
      ...result,
      events: sorted,
    };
  }

  /**
   * Returns upcoming time-sensitive deadlines only (§9, §10).
   *
   * @param {object} [options]
   * @returns {Promise<{ events: Array<object>, state: string, fetchedAt: string|null, error: string|null }>}
   */
  async getUpcomingDeadlines(options = {}) {
    const result = await this.getUpcomingAcademicEvents(options);
    const deadlines = result.events.filter((e) => e.isDeadline && e.deadlineIso);

    return {
      ...result,
      events: deadlines,
    };
  }

  /**
   * Retrieves a single canonical academic event by its ID.
   *
   * @param {string} eventId
   * @param {object} [options]
   * @returns {Promise<object|null>}
   */
  async getAcademicEvent(eventId, options = {}) {
    if (!eventId) return null;
    const { events } = await this.getAcademicEvents(options);
    return events.find((e) => e.id === eventId || e.identity === eventId) || null;
  }
}

/**
 * Deterministically sorts academic events according to Section 21 of the Specification.
 *
 * @param {Array<object>} events Normalized academic events
 * @param {Date} [now]
 * @returns {Array<object>}
 */
export function sortAcademicEvents(events, now = new Date()) {
  if (!Array.isArray(events)) return [];

  const nowMs = now.getTime();

  const getTier = (ev) => {
    const deadlineMs = ev.deadlineIso ? new Date(ev.deadlineIso).getTime() : null;
    if (!deadlineMs || isNaN(deadlineMs)) {
      return ev.importance === EventImportance.CRITICAL || ev.importance === EventImportance.HIGH ? 5 : 6;
    }

    const diffMs = deadlineMs - nowMs;
    const isOverdue = diffMs < 0;

    // 1. Overdue hard cutoffs
    if (isOverdue && ev.isHardCutoff) return 1;

    // 2. Overdue standard deadlines
    if (isOverdue) return 2;

    // Calendar day comparison in IST
    const dayDiff = getKolkataDayDiff(now, new Date(deadlineMs));

    // 3. Today's cutoffs / deadlines
    if (dayDiff === 0) return 3;

    // 4. Tomorrow's deadlines (or <= 24 hours)
    if (dayDiff === 1 || diffMs <= 24 * 3600 * 1000) return 4;

    // 5. Near-term deadlines (<= 7 days)
    if (diffMs <= 7 * 24 * 3600 * 1000 && ev.isDeadline) return 5;

    // 6. Important upcoming events
    if (ev.importance === EventImportance.CRITICAL || ev.importance === EventImportance.HIGH) return 6;

    // 7. Other upcoming events
    return 7;
  };

  const decorated = events.map((ev) => ({
    event: ev,
    tier: getTier(ev),
    timeMs: ev.deadlineIso ? new Date(ev.deadlineIso).getTime() : (ev.eventDate ? new Date(ev.eventDate).getTime() : Infinity),
  }));

  decorated.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
    return a.event.title.localeCompare(b.event.title);
  });

  return decorated.map((d) => d.event);
}

function getKolkataDayDiff(d1, d2) {
  try {
    const f = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const s1 = f.format(d1);
    const s2 = f.format(d2);
    const t1 = new Date(`${s1}T12:00:00+05:30`).getTime();
    const t2 = new Date(`${s2}T12:00:00+05:30`).getTime();
    return Math.round((t2 - t1) / 86400000);
  } catch {
    return Math.round((d2.getTime() - d1.getTime()) / 86400000);
  }
}
