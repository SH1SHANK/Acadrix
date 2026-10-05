/**
 * Acadrix Smart Deadline & Notification System - Domain Types & Constants
 */

export const SubmissionStatus = Object.freeze({
  SUBMITTED: "SUBMITTED",
  NOT_SUBMITTED: "NOT_SUBMITTED",
  COMPLETED: "COMPLETED",
  ATTEMPTED: "ATTEMPTED",
  PENDING: "PENDING",
  UNKNOWN: "UNKNOWN",
});

export const DeadlineStatus = Object.freeze({
  NO_DEADLINE: "NO_DEADLINE",
  UPCOMING: "UPCOMING",
  DUE_SOON: "DUE_SOON",
  DUE_TOMORROW: "DUE_TOMORROW",
  DUE_TODAY: "DUE_TODAY",
  DUE_HOURS: "DUE_HOURS",
  OVERDUE: "OVERDUE",
  COMPLETED: "COMPLETED",
});

export const DeadlineSource = Object.freeze({
  PORTAL: "PORTAL",
  LOCAL: "LOCAL",
  SUPABASE: "SUPABASE",
  UNKNOWN: "UNKNOWN",
});

export const ActionStatus = Object.freeze({
  NO_ACTION_REQUIRED: "NO_ACTION_REQUIRED",
  ACTION_REQUIRED: "ACTION_REQUIRED",
  STATUS_UNKNOWN: "STATUS_UNKNOWN",
});

export const NotificationCategory = Object.freeze({
  WINDOW_3_DAYS: "3_days",
  WINDOW_24_HOURS: "24h",
  WINDOW_6_HOURS: "6h",
  WINDOW_DUE_TODAY: "due_today",
  WINDOW_OVERDUE: "overdue",
  EVENT_SUBMITTED: "submitted",
  EVENT_DEADLINE_CHANGED: "deadline_changed",
});

export const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
  enabled: true,
  notify3Days: true,
  notify24Hours: true,
  notify6Hours: true,
  notifyDueToday: true,
  notifyOverdue: true,
  notifySubmitted: false, // Default off to avoid unnecessary noise
  notifyDeadlineChanged: true,
});

export const NOTIFICATION_STORAGE_KEY = "acx:notifications:v1";
export const NOTIFICATION_SETTINGS_STORAGE_KEY = "acx:notification-settings:v1";
export const ALARM_PREFIX = "acx:notify:";
