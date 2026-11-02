import { useCallback, useEffect, useRef, useState } from 'react';
import type { QuotaFileEntry } from '../logic';
import type { QuotaCardState } from '../providers';
import { buildPoolAccount } from './poolAccounts';
import { appendSamples, loadHistory, type HistorySample } from './historyStore';

/** Loads the hub's recorded samples; `reload` re-reads after new samples land. */
export function useQuotaHistory(hub: string) {
  const [samples, setSamples] = useState<HistorySample[]>([]);
  const hubRef = useRef(hub);
  useEffect(() => {
    hubRef.current = hub;
  }, [hub]);

  const reload = useCallback(async () => {
    const requested = hubRef.current;
    const loaded = await loadHistory(requested);
    if (requested === hubRef.current) setSamples(loaded);
  }, []);

  useEffect(() => {
    setSamples([]);
    void reload();
  }, [hub, reload]);

  return { samples, reload };
}

/**
 * Records one sample per credential each time its quota state is replaced by a
 * successful load. Keyed on state identity so manual card refreshes are
 * recorded too; the store dedupes loads closer than a minute.
 */
export function useQuotaHistoryRecorder(
  hub: string,
  entries: readonly QuotaFileEntry[],
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined,
  onRecorded: () => void
) {
  const seen = useRef(new WeakMap<object, true>());

  useEffect(() => {
    if (!hub) return;
    const ts = Date.now();
    const fresh: HistorySample[] = [];
    entries.forEach((entry) => {
      const quota = quotaFor(entry);
      if (!quota || quota.status !== 'success' || seen.current.has(quota)) return;
      seen.current.set(quota, true);
      const account = buildPoolAccount(entry, quota);
      if (!account) return;
      fresh.push({
        ts,
        provider: entry.type,
        credentialKey: account.key,
        windowId: account.windowId,
        remainingPct: account.remaining,
        resetAt: account.resetAt,
      });
    });
    if (fresh.length === 0) return;
    void appendSamples(hub, fresh).then(onRecorded);
  }, [hub, entries, quotaFor, onRecorded]);
}
