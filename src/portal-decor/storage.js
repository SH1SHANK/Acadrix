/** chrome.storage.local persistence with an in-memory degradation path. */

const PORTAL_DECOR_STORAGE_KEY = "acx:deadlines:v1";
const PORTAL_DECOR_MAX_AGE = 120 * 24 * 60 * 60 * 1000;
const PORTAL_DECOR_STALE_AGE = 24 * 60 * 60 * 1000;
const portalDecorMemory = {};

function portalDecorStorageArea() {
  try { return globalThis.chrome?.storage?.local || null; } catch { return null; }
}

function portalDecorRead(callback) {
  const store = portalDecorStorageArea();
  if (!store?.get) return callback(structuredClone(portalDecorMemory));
  try {
    store.get({ [PORTAL_DECOR_STORAGE_KEY]: {} }, (value) => {
      const data = value?.[PORTAL_DECOR_STORAGE_KEY];
      callback(data && typeof data === "object" ? data : structuredClone(portalDecorMemory));
    });
  } catch { callback(structuredClone(portalDecorMemory)); }
}

function portalDecorWrite(data, callback = () => {}) {
  Object.keys(portalDecorMemory).forEach((key) => delete portalDecorMemory[key]);
  Object.assign(portalDecorMemory, data || {});
  const store = portalDecorStorageArea();
  if (!store?.set) return callback();
  try { store.set({ [PORTAL_DECOR_STORAGE_KEY]: data }, callback); } catch { callback(); }
}

function portalDecorPrune(data, now = Date.now()) {
  const result = {};
  for (const [courseKey, entries] of Object.entries(data || {})) {
    const fresh = Object.entries(entries || {})
      .filter(([, entry]) => now - Number(entry?.capturedAt || 0) <= PORTAL_DECOR_MAX_AGE)
      .sort((a, b) => Number(b[1]?.capturedAt || 0) - Number(a[1]?.capturedAt || 0))
      .slice(0, 500);
    if (fresh.length) result[courseKey] = Object.fromEntries(fresh);
  }
  return result;
}

export function isPortalDecorStale(entry, now = Date.now()) {
  return Boolean(entry?.capturedAt && now - Number(entry.capturedAt) > PORTAL_DECOR_STALE_AGE);
}

export function createPortalDecorStore(now = () => Date.now()) {
  const read = () => new Promise((resolve) => portalDecorRead(resolve));
  const write = (data) => new Promise((resolve) => portalDecorWrite(data, resolve));

  return {
    async getAll() {
      const loaded = await read();
      const data = portalDecorPrune(loaded, now());
      if (JSON.stringify(data) !== JSON.stringify(loaded)) await write(data);
      return data;
    },
    async get(courseKey, key) {
      const data = await this.getAll();
      return data?.[courseKey]?.[key] || null;
    },
    async capture(courseKey, key, incoming) {
      const data = await this.getAll();
      const previous = data[courseKey]?.[key] || {};
      const incomingAt = Number(incoming.capturedAt || now());
      const previousAt = Number(previous.capturedAt || 0);
      const next = { ...previous, ...incoming, capturedAt: incomingAt };
      if (incomingAt < previousAt) {
        next.deadlineIso = previous.deadlineIso;
        next.deadlineRaw = previous.deadlineRaw;
        next.source = previous.source;
      }
      if (incoming.mode === undefined && previous.mode !== undefined) next.mode = previous.mode;
      if (incoming.modeRaw === undefined && previous.modeRaw !== undefined) next.modeRaw = previous.modeRaw;
      if (incoming.source === "grades" && previous.mode !== undefined) {
        next.mode = previous.mode;
        next.modeRaw = previous.modeRaw;
      }
      data[courseKey] ||= {};
      data[courseKey][key] = next;
      await write(portalDecorPrune(data, now()));
      return next;
    },
    async clear() {
      Object.keys(portalDecorMemory).forEach((key) => delete portalDecorMemory[key]);
      const store = portalDecorStorageArea();
      if (!store?.remove) return;
      try { await new Promise((resolve) => store.remove(PORTAL_DECOR_STORAGE_KEY, resolve)); } catch {}
    },
  };
}

export { PORTAL_DECOR_STORAGE_KEY };
