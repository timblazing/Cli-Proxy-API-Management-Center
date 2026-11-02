/**
 * Everything one pool card needs, derived from live accounts + recorded
 * history. Pure: the caller supplies `now`.
 */

import { HOUR_MS } from '@/utils/time/durations';
import type { HistorySample } from './historyStore';
import { formatDayTick, formatHourTick, formatWeekday } from './poolFormat';
import {
  aggregate,
  poolBurnRate,
  poolBurnSeries,
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

/** Session (5-hour) view: twelve hours back, twenty-four ahead. */
export const SESSION_BACK_HOURS = 12;
export const SESSION_AHEAD_HOURS = 24;
export const SESSION_TICK_HOURS = 6;

/** Which rolling window a pool panel tracks. */
export type PoolWindowKind = 'session' | 'weekly';

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

/** Session range around `now`: 12 hours back, 24 hours ahead. */
export function sessionRange(now: number): PoolRange {
  return { from: now - SESSION_BACK_HOURS * HOUR_MS, to: now + SESSION_AHEAD_HOURS * HOUR_MS };
}

export interface PoolTick {
  t: number;
  label: string;
}

/**
 * Local clock hours 0/6/12/18 inside the range, so ticks stay aligned to the
 * wall clock (and DST) rather than to `now`. Midnight reads as a weekday.
 */
export function sessionTicks(range: PoolRange, locale: string): PoolTick[] {
  const ticks: PoolTick[] = [];
  const day = new Date(range.from);
  day.setHours(0, 0, 0, 0);
  for (let guard = 0; guard < 8 && day.getTime() < range.to; guard += 1) {
    for (let hour = 0; hour < 24; hour += SESSION_TICK_HOURS) {
      const at = new Date(day);
      at.setHours(hour, 0, 0, 0);
      const t = at.getTime();
      if (t < range.from || t > range.to) continue;
      ticks.push({ t, label: hour === 0 ? formatWeekday(t, locale) : formatHourTick(t, locale) });
    }
    day.setDate(day.getDate() + 1);
  }
  return ticks;
}

/** Day ticks with "Fri 23" labels for the weekly view. */
export function weeklyTicks(range: PoolRange, locale: string): PoolTick[] {
  return dayTicks(range).map((t) => ({ t, label: formatDayTick(t, locale) }));
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
  /** Visible range; also bounds the burn-rate series. */
  range: PoolRange;
  /** Where the projection ends. Chosen by the caller. */
  projectUntil: number;
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
  /** Where the projection ends. */
  projectedUntil: number;
}

export function buildPoolView(input: PoolViewInput): PoolView {
  const { now, accounts, samples, burnHours, factor, range, projectUntil } = input;
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

  // Burn is measured per credential so one account's reset cannot cancel another's drain.
  const burnSamples: PoolSample[] = [
    ...poolSamples.filter((sample) => sample.ts < now),
    ...accounts.map((account) => ({
      ts: now,
      credentialKey: account.key,
      remainingPct: account.remaining,
    })),
  ];
  const burn = poolBurnRate(burnSamples, burnHours, now);

  const projectedUntil = projectUntil;
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
  const burnRecorded = poolBurnSeries(burnSamples, burnHours, burnStart, now, step);
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
