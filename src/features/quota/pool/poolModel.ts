/**
 * Pooled quota math: aggregation of recorded samples, burn rate, and a
 * forward projection of the pool.
 *
 * Pure functions only — no React, no storage, no clock (`now` is always passed
 * in) — so every rule here is directly testable.
 *
 * Units: every value is "percent of one account". A pool of N accounts has a
 * capacity of N * 100, and a burn rate of 3.7 means the pool loses 3.7
 * percentage points of one account per hour.
 */

import { HOUR_MS } from '@/utils/time/durations';

const EPSILON = 1e-6;
/** Safety valve: a degenerate window length must not spin the simulation. */
const MAX_SIMULATION_EVENTS = 4000;

/** One recorded observation of one credential's pool window. */
export interface PoolSample {
  ts: number;
  credentialKey: string;
  /** Remaining percent, 0..100. */
  remainingPct: number;
}

/** A point on a pool series; `v` is pool remaining in percent-of-one-account. */
export interface PoolPoint {
  t: number;
  v: number;
}

/** One account's state for the projection. */
export interface PoolAccount {
  key: string;
  /** Remaining percent, 0..100. */
  remaining: number;
  /** Next reset instant; null when the account never resets. */
  resetAt: number | null;
  /** Window length. A non-positive value means the account resets only once. */
  windowMs: number;
}

export interface PoolStep {
  t: number;
  from: number;
  to: number;
  gain: number;
}

export interface FirstEmpty {
  at: number;
  key: string;
}

const clampPct = (value: number) => Math.min(100, Math.max(0, value));

/**
 * Sum every credential's remaining percent into one pool series.
 *
 * Samples are sample-and-hold: a credential keeps its last observed value
 * until it reports again, and a credential that has not been observed yet is
 * back-filled with its first observation so a late-joining account does not
 * draw a phantom step at its first sample. Consecutive equal values collapse.
 */
export function aggregate(samples: readonly PoolSample[]): PoolPoint[] {
  const valid = samples.filter(
    (sample) =>
      Number.isFinite(sample.ts) &&
      Number.isFinite(sample.remainingPct) &&
      typeof sample.credentialKey === 'string'
  );
  if (valid.length === 0) return [];

  const sorted = [...valid].sort((a, b) => a.ts - b.ts);
  const current = new Map<string, number>();
  sorted.forEach((sample) => {
    if (!current.has(sample.credentialKey)) {
      current.set(sample.credentialKey, clampPct(sample.remainingPct));
    }
  });

  const points: PoolPoint[] = [];
  let index = 0;
  while (index < sorted.length) {
    const ts = sorted[index].ts;
    while (index < sorted.length && sorted[index].ts === ts) {
      current.set(sorted[index].credentialKey, clampPct(sorted[index].remainingPct));
      index += 1;
    }
    let sum = 0;
    current.forEach((value) => {
      sum += value;
    });
    const last = points[points.length - 1];
    if (last && Math.abs(last.v - sum) < EPSILON) continue;
    points.push({ t: ts, v: sum });
  }
  return points;
}

const MIN_BURN_SPAN_MS = 30 * 60_000;

/**
 * Pool burn in percentage points per hour over the trailing `windowHours`.
 *
 * Only downward movement counts: an upward jump is a reset, not negative
 * burn. The divisor is the span the history actually covers inside the window
 * (capped at the window), so a short history is not diluted by time nobody
 * recorded. Returns null unless the samples span at least
 * max(30 min, window / 3), so sparse history never yields a rate.
 */
export function burnRate(
  series: readonly PoolPoint[],
  windowHours: number,
  now: number = series.length > 0 ? series[series.length - 1].t : 0
): number | null {
  if (!(windowHours > 0) || series.length < 2) return null;
  const from = now - windowHours * HOUR_MS;
  const inWindow = series.filter((point) => point.t >= from && point.t <= now);
  // A drop straddling the window start is clipped to the window by
  // interpolating the series value at the boundary.
  const before = [...series].reverse().find((point) => point.t < from);
  const next = inWindow[0];
  const scoped =
    before && next && next.t > before.t
      ? [
          {
            t: from,
            v: before.v + ((next.v - before.v) * (from - before.t)) / (next.t - before.t),
          },
          ...inWindow,
        ]
      : inWindow;
  if (scoped.length < 2) return null;

  // Too little history makes a one-point tick look like a steep burn.
  const minSpanMs = Math.max(MIN_BURN_SPAN_MS, (windowHours * HOUR_MS) / 3);
  if (scoped[scoped.length - 1].t - scoped[0].t < minSpanMs) return null;

  let drained = 0;
  for (let index = 1; index < scoped.length; index += 1) {
    const delta = scoped[index].v - scoped[index - 1].v;
    if (delta < 0) drained += -delta;
  }
  const start = Math.max(from, scoped[0].t);
  const covered = Math.min(windowHours * HOUR_MS, Math.max(now - start, 0));
  if (covered < 60_000) return null;
  return drained / (covered / HOUR_MS);
}

/** Rolling burn rate sampled on a grid, for the drain-rate chart. */
export function burnSeries(
  series: readonly PoolPoint[],
  windowHours: number,
  from: number,
  to: number,
  stepMs: number
): PoolPoint[] {
  if (!(stepMs > 0) || !(to > from) || series.length < 2) return [];
  const out: PoolPoint[] = [];
  const first = series[0].t;
  for (let t = from; t <= to; t += stepMs) {
    if (t < first) continue;
    const v = burnRate(series, windowHours, t);
    if (v !== null) out.push({ t, v });
  }
  return out;
}

interface SimAccount {
  key: string;
  remaining: number;
  nextReset: number;
  windowMs: number;
}

export interface Projection {
  points: PoolPoint[];
  firstEmpty: FirstEmpty | null;
}

const poolTotal = (accounts: readonly SimAccount[]) =>
  accounts.reduce((sum, account) => sum + account.remaining, 0);

/**
 * Project the pool forward from `now` to `until`.
 *
 * Burn (`burnPerHour * factor`) is spent fill-first: the account that resets
 * soonest and still has quota drains first, which matches the hub's routing.
 * Each account clamps at 0 and steps back to 100 at its reset, then again
 * every `windowMs`. A reset step is emitted as two points at the same instant
 * so the chart draws a vertical edge.
 */
export function simulate(
  now: number,
  accounts: readonly PoolAccount[],
  burnPerHour: number,
  factor: number,
  until: number
): Projection {
  const rate = Math.max(0, burnPerHour * factor); // percentage points per hour
  const sim: SimAccount[] = accounts.map((account) => {
    let remaining = clampPct(account.remaining);
    let nextReset = account.resetAt ?? Number.POSITIVE_INFINITY;
    const windowMs = account.windowMs > 0 ? account.windowMs : 0;
    if (Number.isFinite(nextReset) && nextReset <= now) {
      if (windowMs > 0) {
        // A reset that already passed refilled the account; roll to the next.
        nextReset += Math.ceil((now - nextReset + 1) / windowMs) * windowMs;
        remaining = 100;
      } else {
        nextReset = Number.POSITIVE_INFINITY;
      }
    }
    return { key: account.key, remaining, nextReset, windowMs };
  });

  const points: PoolPoint[] = [{ t: now, v: poolTotal(sim) }];
  let firstEmpty: FirstEmpty | null = null;
  const empty = sim.find((account) => account.remaining <= EPSILON);
  if (empty) firstEmpty = { at: now, key: empty.key };

  if (sim.length === 0 || !(until > now)) return { points, firstEmpty };

  let t = now;
  for (let guard = 0; guard < MAX_SIMULATION_EVENTS && t < until; guard += 1) {
    const active = sim
      .filter((account) => account.remaining > EPSILON)
      .sort((a, b) => a.nextReset - b.nextReset)[0];
    const nextResetAt = Math.min(...sim.map((account) => account.nextReset));

    let eventAt = Math.min(nextResetAt, until);
    let drainsToEmpty = false;
    if (active && rate > 0) {
      const emptyAt = t + (active.remaining / rate) * HOUR_MS;
      if (emptyAt < eventAt) {
        eventAt = emptyAt;
        drainsToEmpty = true;
      }
    }

    if (active && rate > 0 && eventAt > t) {
      active.remaining = Math.max(0, active.remaining - (rate * (eventAt - t)) / HOUR_MS);
      if (drainsToEmpty) active.remaining = 0;
    }
    t = eventAt;
    points.push({ t, v: poolTotal(sim) });

    if (drainsToEmpty && active && !firstEmpty) firstEmpty = { at: t, key: active.key };

    if (t >= until) break;
    if (t >= nextResetAt) {
      sim.forEach((account) => {
        if (account.nextReset > t) return;
        account.remaining = 100;
        account.nextReset = account.windowMs > 0 ? t + account.windowMs : Number.POSITIVE_INFINITY;
      });
      points.push({ t, v: poolTotal(sim) });
    }
  }

  // Collapse zero-length duplicates that carry no information.
  const compact: PoolPoint[] = [];
  points.forEach((point) => {
    const last = compact[compact.length - 1];
    const beforeLast = compact[compact.length - 2];
    if (last && last.t === point.t && Math.abs(last.v - point.v) < EPSILON) return;
    if (
      last &&
      beforeLast &&
      last.t !== point.t &&
      Math.abs(beforeLast.v - last.v) < EPSILON &&
      Math.abs(last.v - point.v) < EPSILON
    ) {
      compact[compact.length - 1] = point;
      return;
    }
    compact.push(point);
  });
  return { points: compact, firstEmpty };
}

/** Projected pool points; see {@link simulate}. */
export function project(
  now: number,
  accounts: readonly PoolAccount[],
  burnPerHour: number,
  factor: number,
  until: number
): PoolPoint[] {
  return simulate(now, accounts, burnPerHour, factor, until).points;
}

/** First instant the whole pool is empty, or null when it never gets there. */
export function poolEmptyAt(points: readonly PoolPoint[]): number | null {
  const hit = points.find((point) => point.v <= EPSILON);
  return hit ? hit.t : null;
}

/** First instant any single account runs dry, with which account. */
export function firstEmpty(
  now: number,
  accounts: readonly PoolAccount[],
  burnPerHour: number,
  factor: number,
  until: number
): FirstEmpty | null {
  return simulate(now, accounts, burnPerHour, factor, until).firstEmpty;
}

/** Upward jumps (two points at the same instant, or any rise) as labelled steps. */
export function findSteps(points: readonly PoolPoint[]): PoolStep[] {
  const steps: PoolStep[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if (point.t === previous.t && point.v - previous.v > EPSILON) {
      steps.push({ t: point.t, from: previous.v, to: point.v, gain: point.v - previous.v });
    }
  }
  return steps;
}

/** Recorded series has no same-instant pairs: any rise between samples is a step. */
export function findRecordedSteps(points: readonly PoolPoint[], minGain = 5): PoolStep[] {
  const steps: PoolStep[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const gain = points[index].v - points[index - 1].v;
    if (gain >= minGain) {
      steps.push({ t: points[index].t, from: points[index - 1].v, to: points[index].v, gain });
    }
  }
  return steps;
}

/** The next reset step after `now`, with the capacity it adds. */
export function nextReset(points: readonly PoolPoint[], now: number): PoolStep | null {
  return findSteps(points).find((step) => step.t > now) ?? null;
}

/** Value of a series at `t`, interpolated; the later point wins at a vertical edge. */
export function valueAt(points: readonly PoolPoint[], t: number): number | null {
  if (points.length === 0) return null;
  if (t < points[0].t || t > points[points.length - 1].t) return null;
  let result = points[0].v;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (point.t <= t) {
      result = point.v;
      const next = points[index + 1];
      if (next && next.t > point.t && t < next.t) {
        const ratio = (t - point.t) / (next.t - point.t);
        result = point.v + (next.v - point.v) * ratio;
      }
    } else {
      break;
    }
  }
  return result;
}
