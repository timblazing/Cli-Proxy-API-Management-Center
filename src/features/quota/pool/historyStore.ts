/**
 * Browser-side quota history.
 *
 * The backend keeps no quota history, so the Quota page records the pool
 * window of every credential each time a quota load succeeds. Samples live in
 * IndexedDB (a month of 10-minute loads is too much for localStorage), keyed
 * by the connected hub base URL so one browser can watch several hubs.
 *
 * Storage is best-effort: every access is wrapped, an unavailable database
 * falls back to an in-memory map for the session, and callers must work with
 * empty history. Only quota percentages and reset times are stored — never
 * keys, tokens, or account secrets. Nothing is cleared on logout.
 */

import { DAY_MS } from '@/utils/time/durations';

export interface HistorySample {
  ts: number;
  provider: string;
  credentialKey: string;
  windowId: string;
  remainingPct: number;
  resetAt: number | null;
}

export const HISTORY_RETENTION_MS = 30 * DAY_MS;
/** Samples of the same series closer than this are dropped. */
export const HISTORY_DEDUPE_MS = 60_000;

const DB_NAME = 'cpamc-quota-history';
const DB_VERSION = 1;
const STORE = 'samples';
const SEP = '\u0000';

export const seriesKey = (sample: Pick<HistorySample, 'provider' | 'credentialKey' | 'windowId'>) =>
  [sample.provider, sample.credentialKey, sample.windowId].join(SEP);

/** Whether `next` should be recorded given the previous sample of its series. */
export function shouldRecordSample(previousTs: number | null, nextTs: number): boolean {
  if (previousTs === null) return true;
  return nextTs - previousTs >= HISTORY_DEDUPE_MS;
}

/** Drop samples outside the retention window. */
export function pruneSamples<T extends { ts: number }>(samples: readonly T[], now: number): T[] {
  const cutoff = now - HISTORY_RETENTION_MS;
  return samples.filter((sample) => sample.ts >= cutoff);
}

/* ------------------------------ memory fallback ----------------------------- */

const memory = new Map<string, HistorySample[]>();

const memoryAppend = (hub: string, samples: readonly HistorySample[]) => {
  const list = memory.get(hub) ?? [];
  samples.forEach((sample) => {
    const key = seriesKey(sample);
    let previousTs: number | null = null;
    for (let index = list.length - 1; index >= 0; index -= 1) {
      if (seriesKey(list[index]) === key) {
        previousTs = list[index].ts;
        break;
      }
    }
    if (shouldRecordSample(previousTs, sample.ts)) list.push(sample);
  });
  memory.set(hub, list);
};

/* -------------------------------- IndexedDB -------------------------------- */

const prunedHubs = new Set<string>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

const openDb = (): Promise<IDBDatabase | null> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          // Primary key: hub, series, ts — one row per observation, ordered per series.
          const store = db.createObjectStore(STORE, { keyPath: ['hub', 'series', 'ts'] });
          store.createIndex('byHubTs', ['hub', 'ts']);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
};

const promisify = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const txDone = (tx: IDBTransaction): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

type StoredRow = HistorySample & { hub: string; series: string };

/** Append samples for a hub, deduping per series and pruning old rows. */
export async function appendSamples(hub: string, samples: readonly HistorySample[]): Promise<void> {
  if (!hub || samples.length === 0) return;
  const db = await openDb();
  if (!db) {
    memoryAppend(hub, samples);
    return;
  }
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const sample of samples) {
      const series = seriesKey(sample);
      const range = IDBKeyRange.bound([hub, series, 0], [hub, series, Number.MAX_SAFE_INTEGER]);
      const cursor = await promisify(store.openCursor(range, 'prev'));
      const previousTs = cursor ? (cursor.value as StoredRow).ts : null;
      if (!shouldRecordSample(previousTs, sample.ts)) continue;
      store.put({ ...sample, hub, series } satisfies StoredRow);
    }
    if (!prunedHubs.has(hub)) {
      prunedHubs.add(hub);
      const cutoff = Date.now() - HISTORY_RETENTION_MS;
      const stale = IDBKeyRange.bound([hub, 0], [hub, cutoff], false, true);
      // IDBIndex.getAllKeys yields the primary keys of the matching rows.
      const primary = await promisify(store.index('byHubTs').getAllKeys(stale));
      primary.forEach((key) => store.delete(key));
    }
    await txDone(tx);
  } catch {
    memoryAppend(hub, samples);
  }
}

/** Every sample of a hub within the retention window, oldest first. */
export async function loadHistory(hub: string, now: number = Date.now()): Promise<HistorySample[]> {
  if (!hub) return [];
  const fromMemory = pruneSamples(memory.get(hub) ?? [], now);
  const db = await openDb();
  if (!db) return fromMemory;
  try {
    const tx = db.transaction(STORE, 'readonly');
    const index = tx.objectStore(STORE).index('byHubTs');
    const range = IDBKeyRange.bound(
      [hub, now - HISTORY_RETENTION_MS],
      [hub, Number.MAX_SAFE_INTEGER]
    );
    const rows = (await promisify(index.getAll(range))) as StoredRow[];
    const stored = rows.map(
      ({ ts, provider, credentialKey, windowId, remainingPct, resetAt }): HistorySample => ({
        ts,
        provider,
        credentialKey,
        windowId,
        remainingPct,
        resetAt,
      })
    );
    return [...stored, ...fromMemory].sort((a, b) => a.ts - b.ts);
  } catch {
    return fromMemory;
  }
}
