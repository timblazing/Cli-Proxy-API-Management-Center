/**
 * Everything one pool card needs, derived from live accounts + recorded
 * history. Pure: the caller supplies `now`.
 */

import { HOUR_MS } from '@/utils/time/durations';
import type { HistorySample } from './historyStore';
import {
  aggregate,
  burnRate,
  burnSeries,
  nextReset,
  poolEmptyAt,
  simulate,
  type PoolAccount,
  type PoolPoint,
  type PoolStep,
  type PoolSample,
} from './poolModel';

export const RANGE_DAYS = 14;
export const RANGE_DAYS_BACK = 3;
export const RANGE_SHIFT_DAYS = 7;

export type BurnHours = 1 | 3 | 6;
export type FutureFactor = 0.5 | 1 | 1.5;

export interface PoolRange {
  from: number;
  to: number;
}

const startOfDayMs = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const addDays = (ms: number, days: number) => {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
};

/**
 * Visible range: three days back from today's midnight, fourteen days wide,
 * shifted by whole weeks. Date arithmetic keeps DST days aligned.
 */
export function poolRange(now: number, offsetWeeks: number): PoolRange {
  const from = addDays(startOfDayMs(now), -RANGE_DAYS_BACK + offsetWeeks * RANGE_SHIFT_DAYS);
  return { from, to: addDays(from, RANGE_DAYS) };
}

/** Local midnights inside the range, for day ticks. */
export function dayTicks(range: PoolRange): number[] {
  const ticks: number[] = [];
  for (let t = range.from; t < range.to; t = addDays(t, 1)) ticks.push(t);
  return ticks;
}

export interface PoolAccountLike extends PoolAccount {
  label: string;
  windowId: string;
}

export interface PoolViewInput {
  now: number;
  accounts: readonly PoolAccountLike[];
  samples: readonly HistorySample[];
  burnHours: BurnHours;
  factor: FutureFactor;
  range: PoolRange;
}

export interface PoolView {
  capacity: number;
  current: number;
  /** Percentage points per hour, or null while history is too sparse. */
  burn: number | null;
  recorded: PoolPoint[];
  projected: PoolPoint[];
  burnRecorded: PoolPoint[];
  burnProjected: PoolPoint[];
  poolEmpty: number | null;
  firstEmpty: { at: number; label: string } | null;
  nextReset: PoolStep | null;
  /** Where the projection ends; the default range end or the shifted one. */
  projectedUntil: number;
}

export function buildPoolView(input: PoolViewInput): PoolView {
  const { now, accounts, samples, burnHours, factor, range } = input;
  const capacity = accounts.length * 100;
  const current = accounts.reduce((sum, account) => sum + account.remaining, 0);

  const seriesIds = new Set(accounts.map((account) => `${account.key}\u0000${account.windowId}`));
  const poolSamples: PoolSample[] = samples
    .filter(
      (sample) =>
        sample.ts <= now && seriesIds.has(`${sample.credentialKey}\u0000${sample.windowId}`)
    )
    .map((sample) => ({
      ts: sample.ts,
      credentialKey: sample.credentialKey,
      remainingPct: sample.remainingPct,
    }));
  const history = aggregate(poolSamples).filter((point) => point.t < now);
  const recorded: PoolPoint[] = [...history, { t: now, v: current }];

  const burn = burnRate(recorded, burnHours, now);

  // Stats read the same projection regardless of which window the user pages to.
  const defaultEnd = poolRange(now, 0).to;
  const projectedUntil = Math.max(range.to, defaultEnd);
  const { points: projectedFull, firstEmpty } = simulate(
    now,
    accounts,
    burn ?? 0,
    factor,
    projectedUntil
  );
  const projected = projectedFull;

  const labelFor = (key: string) => accounts.find((account) => account.key === key)?.label ?? key;

  const step = Math.max(HOUR_MS, Math.round((range.to - range.from) / 240));
  const burnStart = Math.max(range.from, recorded[0].t);
  const burnRecorded = burnSeries(recorded, burnHours, burnStart, now, step);
  // The recorded line must end exactly at "now" so the projection joins it with no gap.
  if (burn !== null && burnRecorded[burnRecorded.length - 1]?.t !== now) {
    burnRecorded.push({ t: now, v: burn });
  }
  const projectedBurn = (burn ?? 0) * factor;

  return {
    capacity,
    current,
    burn,
    recorded,
    projected,
    burnRecorded,
    burnProjected:
      burn === null
        ? []
        : [
            { t: now, v: projectedBurn },
            { t: projectedUntil, v: projectedBurn },
          ],
    poolEmpty: poolEmptyAt(projected),
    firstEmpty: firstEmpty ? { at: firstEmpty.at, label: labelFor(firstEmpty.key) } : null,
    nextReset: nextReset(projected, now),
    projectedUntil,
  };
}
