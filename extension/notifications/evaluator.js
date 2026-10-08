/**
 * Acadrix Smart Deadline & Notification System - Deterministic Evaluator
 * Asia/Kolkata timezone calculations and actionability logic.
 * Zero external date libraries, zero DOM dependencies.
 */

import {
  SubmissionStatus,
  DeadlineStatus,
  ActionStatus,
  NotificationCategory,
  DEFAULT_NOTIFICATION_PREFERENCES,
  DeadlineSource,
} from "./types.js";

/**
 * Extracts normalized date/time parts in the Asia/Kolkata timezone.
 *
 * @param {string|number|Date} dateOrIso
 * @returns {{ year: number, month: number, day: number, hours: number, minutes: number, seconds: number } | null}
 */
export function getKolkataDateParts(dateOrIso) {
  if (!dateOrIso) return null;
  const d = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
  if (isNaN(d.getTime())) return null;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(d);
  const result = {};
  for (const { type, value } of parts) {
    if (type !== "literal") {
      result[type] = parseInt(value, 10);
    }
  }

  return {
    year: result.year,
    month: result.month,
    day: result.day,
    hours: result.hour,
    minutes: result.minute,
    seconds: result.second,
  };
}

/**
 * Checks if two dates fall on the same calendar date in Asia/Kolkata.
 *
 * @param {string|number|Date} iso1
 * @param {string|number|Date} iso2
 * @returns {boolean}
 */
export function isSameKolkataDay(iso1, iso2) {
  const p1 = getKolkataDateParts(iso1);
  const p2 = getKolkataDateParts(iso2);
  if (!p1 || !p2) return false;
  return p1.year === p2.year && p1.month === p2.month && p1.day === p2.day;
}

/**
 * Computes calendar day difference between earlier and later in Asia/Kolkata.
 * Returns 0 for same day, 1 for next day, etc.
 *
 * @param {string|number|Date} earlier
 * @param {string|number|Date} later
 * @returns {number|null}
 */
export function getKolkataDayDifference(earlier, later) {
  const p1 = getKolkataDateParts(earlier);
  const p2 = getKolkataDateParts(later);
  if (!p1 || !p2) return null;
  const d1 = Date.UTC(p1.year, p1.month - 1, p1.day);
  const d2 = Date.UTC(p2.year, p2.month - 1, p2.day);
  return Math.round((d2 - d1) / (24 * 3600 * 1000));
}

/**
 * Formats ISO timestamp to "MMM d, h:mm a" in Asia/Kolkata (e.g. "Oct 11, 11:59 PM").
 *
 * @param {string|number|Date} iso
 * @returns {string}
 */
export function formatKolkataDeadline(iso) {
  if (!iso) return "";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (isNaN(d.getTime())) return "";

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return formatter.format(d);
}

/**
 * Deterministically resolves assessment deadline from canonical academic event data.
 * Authoritative source: Supabase public.academic_events.
 *
 * @param {object} event Academic event or assessment record
 * @param {object} [options]
 * @returns {{
 *   deadlineIso: string|null,
 *   deadlineRaw: string|null,
 *   source: "SUPABASE"|"LOCAL"|"UNKNOWN",
 *   verifiedAt: string|null,
 * }}
 */
export function resolveDeadline(event, options = {}) {
  if (!event) {
    return {
      deadlineIso: null,
      deadlineRaw: null,
      source: DeadlineSource.UNKNOWN,
      verifiedAt: null,
    };
  }

  const rawIso =
    event.deadlineIso ||
    event.endTime ||
    event.end_time ||
    event.dueDate ||
    (event.eventDate ? `${event.eventDate}T18:29:00.000Z` : null);

  if (rawIso && !isNaN(new Date(rawIso).getTime())) {
    return {
      deadlineIso: new Date(rawIso).toISOString(),
      deadlineRaw: event.timeStr || event.time_str || event.dueDateText || event.deadlineRaw || null,
      source: DeadlineSource.SUPABASE,
      verifiedAt: event.fetchedAt || event.deadlineVerifiedAt || new Date().toISOString(),
    };
  }
  // 2. Fallback matching against provided Supabase records
  if (Array.isArray(options.supabaseRecords) && options.supabaseRecords.length > 0) {
    const termId = event.termId;
    const courseCode = event.courseCode;
    const extId = event.externalAssignmentId || event.assignmentId || event.id;
    const canonicalId = event.canonicalAssessmentId;

    const matched = options.supabaseRecords.find((rec) => {
      if (!rec) return false;
      const recTerm = rec.termId || rec.term_id;
      const recCourse = rec.courseCode || rec.course_code;
      if (termId && recTerm && String(termId).toLowerCase() !== String(recTerm).toLowerCase()) {
        return false;
      }
      if (courseCode && recCourse && String(courseCode).toLowerCase() !== String(recCourse).toLowerCase()) {
        return false;
      }
      const recExtId = rec.externalAssignmentId || rec.external_assignment_id || rec.id;
      const recCanonId = rec.canonicalAssessmentId || rec.canonical_assessment_id;
      if (extId && recExtId && String(extId) === String(recExtId)) return true;
      if (canonicalId && recCanonId && String(canonicalId) === String(recCanonId)) return true;
      return false;
    });

    if (matched) {
      const matchIso = matched.dueDate || matched.due_date || matched.deadlineIso || matched.end_time;
      if (matchIso && !isNaN(new Date(matchIso).getTime())) {
        return {
          deadlineIso: new Date(matchIso).toISOString(),
          deadlineRaw: matched.dueDateText || matched.timeStr || null,
          source: DeadlineSource.SUPABASE,
          verifiedAt: new Date().toISOString(),
        };
      }
    }
  }

  return {
    deadlineIso: null,
    deadlineRaw: null,
    source: DeadlineSource.UNKNOWN,
    verifiedAt: null,
  };
}

/**
 * Evaluates deadline urgency and actionability.
 *
 * @param {object} params
 * @param {string|null} params.deadlineIso
 * @param {string} [params.submissionStatus]
 * @param {Date|number|string} [params.now]
 * @returns {{
 *   deadlineStatus: string,
 *   actionStatus: string,
 *   diffMs: number|null,
 *   isOverdue: boolean,
 *   isDueToday: boolean,
 *   isDueTomorrow: boolean,
 *   formattedKolkataDeadline: string,
 * }}
 */
export function evaluateDeadline({
  deadlineIso,
  submissionStatus = SubmissionStatus.UNKNOWN,
  deadlineSource = DeadlineSource.UNKNOWN,
  deadlineVerifiedAt = null,
  now = new Date(),
}) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();

  // Invariant: If submitted or completed, no action is required
  if (
    submissionStatus === SubmissionStatus.SUBMITTED ||
    submissionStatus === SubmissionStatus.COMPLETED
  ) {
    return {
      deadlineStatus: DeadlineStatus.COMPLETED,
      actionStatus: ActionStatus.NO_ACTION_REQUIRED,
      diffMs: deadlineIso ? new Date(deadlineIso).getTime() - nowMs : null,
      isOverdue: false,
      isDueToday: false,
      isDueTomorrow: false,
      formattedKolkataDeadline: deadlineIso ? formatKolkataDeadline(deadlineIso) : "",
      deadlineSource: deadlineSource || DeadlineSource.UNKNOWN,
      deadlineVerifiedAt: deadlineVerifiedAt || null,
    };
  }
  if (!deadlineIso || isNaN(new Date(deadlineIso).getTime())) {
    return {
      deadlineStatus: DeadlineStatus.NO_DEADLINE,
      actionStatus: ActionStatus.NO_ACTION_REQUIRED,
      diffMs: null,
      isOverdue: false,
      isDueToday: false,
      isDueTomorrow: false,
      formattedKolkataDeadline: "",
      deadlineSource: DeadlineSource.UNKNOWN,
      deadlineVerifiedAt: null,
    };
  }
  const deadlineDate = new Date(deadlineIso);
  const deadlineMs = deadlineDate.getTime();
  const diffMs = deadlineMs - nowMs;
  const isOverdue = diffMs < 0;

  const dayDiff = getKolkataDayDifference(nowDate, deadlineDate);
  const isDueToday = dayDiff === 0 && !isOverdue;
  const isDueTomorrow = dayDiff === 1 && !isOverdue;

  let deadlineStatus = DeadlineStatus.UPCOMING;
  if (isOverdue) {
    deadlineStatus = DeadlineStatus.OVERDUE;
  } else if (diffMs <= 6 * 3600 * 1000) {
    deadlineStatus = DeadlineStatus.DUE_HOURS;
  } else if (isDueToday) {
    deadlineStatus = DeadlineStatus.DUE_TODAY;
  } else if (isDueTomorrow || diffMs <= 24 * 3600 * 1000) {
    deadlineStatus = DeadlineStatus.DUE_TOMORROW;
  } else if (diffMs <= 72 * 3600 * 1000) {
    deadlineStatus = DeadlineStatus.DUE_SOON;
  } else {
    deadlineStatus = DeadlineStatus.UPCOMING;
  }

  let actionStatus = ActionStatus.NO_ACTION_REQUIRED;
  if (submissionStatus === SubmissionStatus.NOT_SUBMITTED) {
    actionStatus = ActionStatus.ACTION_REQUIRED;
  } else if (submissionStatus === SubmissionStatus.UNKNOWN) {
    actionStatus = ActionStatus.STATUS_UNKNOWN;
  }

  return {
    deadlineStatus,
    actionStatus,
    diffMs,
    isOverdue,
    isDueToday,
    isDueTomorrow,
    formattedKolkataDeadline: formatKolkataDeadline(deadlineDate),
    deadlineSource: deadlineSource || DeadlineSource.UNKNOWN,
    deadlineVerifiedAt: deadlineVerifiedAt || null,
  };
}

/**
 * Creates deterministic notification deduplication key.
 *
 * @param {object} params
 * @param {string} [params.termId]
 * @param {string} [params.courseCode]
 * @param {string} params.externalAssignmentId
 * @param {string} params.category
 * @param {string} [params.deadlineVersion]
 * @returns {string}
 */
export function createNotificationDedupeKey({
  termId = "default",
  courseCode = "default",
  externalAssignmentId,
  category,
  deadlineVersion = "default",
}) {
  return `${termId}|${courseCode}|${externalAssignmentId}|${category}|${deadlineVersion}`;
}

/**
 * Evaluates whether an assignment qualifies for an actionable notification.
 *
 * @param {object} params
 * @param {object} params.assignment
 * @param {object|Map} [params.sentNotificationsMap]
 * @param {object} [params.preferences]
 * @param {Date|number|string} [params.now]
 * @returns {object|null} Notification descriptor or null if suppressed
 */
export function determineActionableNotification({
  assignment,
  sentNotificationsMap = {},
  preferences = DEFAULT_NOTIFICATION_PREFERENCES,
  now = new Date(),
}) {
  if (!assignment || preferences?.enabled === false) {
    return null;
  }

  const submissionStatus = assignment.submissionStatus || SubmissionStatus.UNKNOWN;

  // Invariant: strictly suppress deadline alerts for submitted/completed assignments
  if (
    submissionStatus === SubmissionStatus.SUBMITTED ||
    submissionStatus === SubmissionStatus.COMPLETED
  ) {
    return null;
  }

  const deadlineIso = assignment.dueDate || assignment.deadlineIso;
  if (!deadlineIso || isNaN(new Date(deadlineIso).getTime())) {
    return null;
  }

  const nowDate = now instanceof Date ? now : new Date(now);
  const deadlineDate = new Date(deadlineIso);
  const diffMs = deadlineDate.getTime() - nowDate.getTime();
  const isOverdue = diffMs < 0;
  const dayDiff = getKolkataDayDifference(nowDate, deadlineDate);
  const isDueToday = dayDiff === 0 && !isOverdue;

  let category = null;

  if (isOverdue) {
    // Only notify overdue if enabled in preferences and explicitly unsubmitted
    if (preferences.notifyOverdue !== false && submissionStatus === SubmissionStatus.NOT_SUBMITTED) {
      category = NotificationCategory.WINDOW_OVERDUE;
    } else {
      return null;
    }
  } else {
    // Future deadline windows in order of urgency
    if (diffMs <= 6 * 3600 * 1000 && preferences.notify6Hours !== false) {
      category = NotificationCategory.WINDOW_6_HOURS;
    } else if (isDueToday && preferences.notifyDueToday !== false) {
      category = NotificationCategory.WINDOW_DUE_TODAY;
    } else if (diffMs <= 24 * 3600 * 1000 && preferences.notify24Hours !== false) {
      category = NotificationCategory.WINDOW_24_HOURS;
    } else if (diffMs <= 72 * 3600 * 1000 && preferences.notify3Days !== false) {
      category = NotificationCategory.WINDOW_3_DAYS;
    } else {
      return null;
    }
  }

  const termId = assignment.termId || "default";
  const courseCode = assignment.courseCode || "";
  const externalAssignmentId = assignment.externalAssignmentId || assignment.assignmentId || assignment.id || "unknown";
  const deadlineVersion = deadlineIso;

  const dedupeKey = createNotificationDedupeKey({
    termId,
    courseCode,
    externalAssignmentId,
    category,
    deadlineVersion,
  });

  // Check deduplication map
  const isAlreadySent =
    sentNotificationsMap instanceof Map
      ? sentNotificationsMap.has(dedupeKey)
      : Boolean(sentNotificationsMap?.[dedupeKey]);

  if (isAlreadySent) {
    return null;
  }

  const title = assignment.title || "Assignment";
  const formattedTime = formatKolkataDeadline(deadlineDate);
  const coursePrefix = courseCode ? `${courseCode} · ` : "";

  let notifTitle = "";
  let notifBody = "";

  const statusNote =
    submissionStatus === SubmissionStatus.UNKNOWN
      ? " Submission status could not be verified."
      : (submissionStatus === SubmissionStatus.NOT_SUBMITTED ? " Not submitted." : "");

  switch (category) {
    case NotificationCategory.WINDOW_6_HOURS:
      notifTitle = "Assignment Due Soon";
      notifBody = `${coursePrefix}${title} is due in less than 6 hours (${formattedTime}).${statusNote}`;
      break;

    case NotificationCategory.WINDOW_24_HOURS:
      notifTitle = "Assignment Due Tomorrow";
      notifBody = `${coursePrefix}${title} is due tomorrow at ${formattedTime}.${statusNote}`;
      break;
    case NotificationCategory.WINDOW_DUE_TODAY:
      notifTitle = "Assignment Due Today";
      notifBody = `${coursePrefix}${title} is due today at ${formattedTime}.`;
      break;

    case NotificationCategory.WINDOW_3_DAYS:
      notifTitle = "Upcoming Assignment Due";
      notifBody = `${coursePrefix}${title} is due in 3 days on ${formattedTime}.`;
      break;

    case NotificationCategory.WINDOW_OVERDUE:
      notifTitle = "Assignment Overdue";
      notifBody = `${coursePrefix}${title} passed its deadline (${formattedTime}).`;
      break;
    default:
      return null;
  }

  return {
    dedupeKey,
    category,
    title: notifTitle,
    body: notifBody,
    termId,
    courseCode,
    externalAssignmentId,
    deadlineIso,
    deadlineSource: assignment.deadlineSource || DeadlineSource.UNKNOWN,
    deadlineVerifiedAt: assignment.deadlineVerifiedAt || null,
    submissionStatus,
  };
}
