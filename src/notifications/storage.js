/**
 * Acadrix Smart Deadline & Notification System - Storage Layer
 * Manages notification settings, sent-log persistence, and deduplication records.
 */

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_STORAGE_KEY,
  NOTIFICATION_SETTINGS_STORAGE_KEY,
} from "./types.js";

const notificationMemoryStores = {
  [NOTIFICATION_STORAGE_KEY]: {},
  [NOTIFICATION_SETTINGS_STORAGE_KEY]: structuredClone(DEFAULT_NOTIFICATION_PREFERENCES),
};

function getNotificationStorageArea() {
  try {
    return globalThis.chrome?.storage?.local || null;
  } catch {
    return null;
  }
}

function readNotificationKey(key, callback) {
  const store = getNotificationStorageArea();
  if (!store?.get) {
    return callback(structuredClone(notificationMemoryStores[key] || {}));
  }
  try {
    store.get({ [key]: {} }, (value) => {
      const data = value?.[key];
      callback(data && typeof data === "object" ? data : structuredClone(notificationMemoryStores[key] || {}));
    });
  } catch {
    callback(structuredClone(notificationMemoryStores[key] || {}));
  }
}

function writeNotificationKey(key, data, callback = () => {}) {
  notificationMemoryStores[key] = structuredClone(data || {});
  const store = getNotificationStorageArea();
  if (!store?.set) return callback();
  try {
    store.set({ [key]: data }, callback);
  } catch {
    callback();
  }
}

/**
 * Retrieves current notification settings merged with defaults.
 *
 * @returns {Promise<typeof DEFAULT_NOTIFICATION_PREFERENCES>}
 */
export async function getNotificationSettings() {
  const stored = await new Promise((resolve) => readNotificationKey(NOTIFICATION_SETTINGS_STORAGE_KEY, resolve));
  return {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    ...(stored && typeof stored === "object" ? stored : {}),
  };
}

/**
 * Persists updated notification settings.
 *
 * @param {Partial<typeof DEFAULT_NOTIFICATION_PREFERENCES>} preferences
 * @returns {Promise<typeof DEFAULT_NOTIFICATION_PREFERENCES>}
 */
export async function saveNotificationSettings(preferences) {
  const current = await getNotificationSettings();
  const merged = { ...current, ...(preferences || {}) };
  await new Promise((resolve) => writeNotificationKey(NOTIFICATION_SETTINGS_STORAGE_KEY, merged, resolve));
  return merged;
}

/**
 * Retrieves the map of all sent notification deduplication records.
 *
 * @returns {Promise<Record<string, object>>}
 */
export async function getSentNotifications() {
  const data = await new Promise((resolve) => readNotificationKey(NOTIFICATION_STORAGE_KEY, resolve));
  return data && typeof data === "object" ? data : {};
}

/**
 * Records a dispatched notification, pruning entries older than 60 days.
 *
 * @param {object} record
 * @param {string} record.dedupeKey
 * @param {string} [record.category]
 * @param {string} [record.externalAssignmentId]
 * @param {string} [record.courseCode]
 * @param {string} [record.termId]
 * @param {string} [record.title]
 * @param {number|Date} [now]
 * @returns {Promise<object|null>}
 */
export async function recordNotificationSent(record, now = Date.now()) {
  if (!record?.dedupeKey) return null;

  const data = await getSentNotifications();
  const currentTime = typeof now === "function" ? now() : Number(now || Date.now());
  const maxAgeMs = 60 * 24 * 60 * 60 * 1000; // 60 days
  const cutoff = currentTime - maxAgeMs;

  const pruned = {};
  for (const [k, v] of Object.entries(data)) {
    const sentTimestamp = Number(v?.sentAt ? new Date(v.sentAt).getTime() : 0);
    if (sentTimestamp >= cutoff) {
      pruned[k] = v;
    }
  }

  const logEntry = {
    dedupeKey: record.dedupeKey,
    category: record.category || "unknown",
    externalAssignmentId: record.externalAssignmentId || null,
    courseCode: record.courseCode || null,
    termId: record.termId || null,
    title: record.title || "",
    sentAt: new Date(currentTime).toISOString(),
  };

  pruned[record.dedupeKey] = logEntry;
  await new Promise((resolve) => writeNotificationKey(NOTIFICATION_STORAGE_KEY, pruned, resolve));
  return logEntry;
}

/**
 * Resets notification sent history.
 *
 * @returns {Promise<void>}
 */
export async function clearSentNotifications() {
  notificationMemoryStores[NOTIFICATION_STORAGE_KEY] = {};
  const store = getNotificationStorageArea();
  if (store?.remove) {
    try {
      await new Promise((resolve) => store.remove(NOTIFICATION_STORAGE_KEY, resolve));
    } catch {}
  }
}
