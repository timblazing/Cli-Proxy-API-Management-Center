/**
 * Bridges quota-store state to the pool model: for each credential, the
 * longest rolling limit (Claude 7-day, Codex weekly, ...) as remaining percent
 * plus its reset instant. Reuses buildTimelineLane so provider-specific window
 * shapes stay in one place.
 */

import { getQuotaCacheKey } from '@/utils/quota/identity';
import type { QuotaFileEntry } from '../logic';
import type { QuotaCardState } from '../providers';
import { buildTimelineLane } from '../quotaTimelineModel';
import type { QuotaProviderType } from '../providers/types';
import { HOUR_MS } from '@/utils/time/durations';
import type { PoolAccount } from './poolModel';

export interface PoolAccountInfo extends PoolAccount {
  /** Short label for the credential, email when known. */
  label: string;
  provider: QuotaProviderType;
  windowId: string;
}

/** A credential's pool window, or null when its quota is not loaded. */
export function buildPoolAccount(
  entry: QuotaFileEntry,
  quota: QuotaCardState | undefined
): PoolAccountInfo | null {
  const lane = buildTimelineLane({
    name: entry.file.name,
    displayName: entry.file.name,
    provider: entry.type,
    quota,
  });
  if (lane.remaining === null) return null;
  const periodHours = lane.periodHours ?? 0;
  return {
    key: getQuotaCacheKey(entry.file),
    remaining: lane.remaining,
    resetAt: lane.anchorMs,
    windowMs: periodHours > 0 ? periodHours * HOUR_MS : 0,
    label: entry.file.email?.trim() || entry.file.name,
    provider: entry.type,
    windowId: `${periodHours}h`,
  };
}

export function buildPoolAccounts(
  entries: readonly QuotaFileEntry[],
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined
): Map<QuotaProviderType, PoolAccountInfo[]> {
  const byProvider = new Map<QuotaProviderType, PoolAccountInfo[]>();
  entries.forEach((entry) => {
    const account = buildPoolAccount(entry, quotaFor(entry));
    if (!account) return;
    const list = byProvider.get(entry.type) ?? [];
    list.push(account);
    byProvider.set(entry.type, list);
  });
  return byProvider;
}
