/**
 * Bridges quota-store state to the pool model: for each credential, the
 * longest rolling limit (Claude 7-day, Codex weekly, ...) and the 5-hour session
 * limit as remaining percent plus their reset instants. Reuses buildTimelineLane so provider-specific window
 * shapes stay in one place.
 */

import { getQuotaCacheKey } from '@/utils/quota/identity';
import type { QuotaFileEntry } from '../logic';
import type { QuotaCardState } from '../providers';
import { buildTimelineLane } from '../quotaTimelineModel';
import type { QuotaProviderType } from '../providers/types';
import { HOUR_MS } from '@/utils/time/durations';
import type { PoolAccount } from './poolModel';
import type { PoolWindowKind } from './poolView';

/** Longest period that still counts as the session (5-hour) window. */
export const SESSION_MAX_HOURS = 5;

export interface PoolAccountInfo extends PoolAccount {
  /** Short label for the credential, email when known. */
  label: string;
  provider: QuotaProviderType;
  windowId: string;
}

/**
 * A credential's pool window, or null when its quota is not loaded.
 *
 * `weekly` is the longest window (windowId keeps the `${periodHours}h` format
 * so recorded history keeps matching). `session` is the 5-hour window; the lane
 * picker falls back to the shortest window when none fits, so a fallback longer
 * than the session bound is rejected.
 */
export function buildPoolAccount(
  entry: QuotaFileEntry,
  quota: QuotaCardState | undefined,
  kind: PoolWindowKind = 'weekly'
): PoolAccountInfo | null {
  const lane = buildTimelineLane({
    name: entry.file.name,
    displayName: entry.file.name,
    provider: entry.type,
    quota,
    maxPeriodHours: kind === 'session' ? SESSION_MAX_HOURS : undefined,
  });
  if (lane.remaining === null) return null;
  const periodHours = lane.periodHours ?? 0;
  if (kind === 'session' && !(periodHours > 0 && periodHours <= SESSION_MAX_HOURS)) return null;
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

export type PoolAccountSets = Record<PoolWindowKind, Map<QuotaProviderType, PoolAccountInfo[]>>;

export function buildPoolAccounts(
  entries: readonly QuotaFileEntry[],
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined
): PoolAccountSets {
  const sets: PoolAccountSets = { weekly: new Map(), session: new Map() };
  entries.forEach((entry) => {
    const quota = quotaFor(entry);
    (['weekly', 'session'] as const).forEach((kind) => {
      const account = buildPoolAccount(entry, quota, kind);
      if (!account) return;
      const list = sets[kind].get(entry.type) ?? [];
      list.push(account);
      sets[kind].set(entry.type, list);
    });
  });
  return sets;
}
