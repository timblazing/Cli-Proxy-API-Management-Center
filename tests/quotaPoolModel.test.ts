import { describe, expect, test } from 'bun:test';
import {
  aggregate,
  burnRate,
  burnSeries,
  poolBurnRate,
  findSteps,
  firstEmpty,
  nextReset,
  poolEmptyAt,
  project,
  valueAt,
  type PoolAccount,
  type PoolPoint,
} from '../src/features/quota/pool/poolModel';

const H = 3_600_000;
const NOW = 1_000 * H;

describe('aggregate', () => {
  test('sums accounts with sample-and-hold', () => {
    const points = aggregate([
      { ts: 0, credentialKey: 'a', remainingPct: 100 },
      { ts: 0, credentialKey: 'b', remainingPct: 80 },
      { ts: H, credentialKey: 'a', remainingPct: 90 },
      { ts: 2 * H, credentialKey: 'b', remainingPct: 70 },
    ]);
    expect(points).toEqual([
      { t: 0, v: 180 },
      { t: H, v: 170 },
      { t: 2 * H, v: 160 },
    ]);
  });

  test('back-fills a late joiner with its first value instead of a phantom step', () => {
    const points = aggregate([
      { ts: 0, credentialKey: 'a', remainingPct: 100 },
      { ts: H, credentialKey: 'b', remainingPct: 50 },
    ]);
    expect(points[0]).toEqual({ t: 0, v: 150 });
    expect(points).toHaveLength(1);
  });

  test('collapses equal consecutive values and ignores junk', () => {
    const points = aggregate([
      { ts: 0, credentialKey: 'a', remainingPct: 40 },
      { ts: H, credentialKey: 'a', remainingPct: 40 },
      { ts: Number.NaN, credentialKey: 'a', remainingPct: 10 },
    ]);
    expect(points).toEqual([{ t: 0, v: 40 }]);
    expect(aggregate([])).toEqual([]);
  });
});

describe('burnRate', () => {
  const series: PoolPoint[] = [
    { t: NOW - 3 * H, v: 300 },
    { t: NOW - 2 * H, v: 297 },
    { t: NOW - H, v: 294 },
    { t: NOW, v: 291 },
  ];

  test('measures percentage points per hour', () => {
    expect(burnRate(series, 3, NOW)).toBeCloseTo(3, 5);
  });

  test('ignores upward jumps from resets', () => {
    const withReset: PoolPoint[] = [
      { t: NOW - 3 * H, v: 300 },
      { t: NOW - 2 * H, v: 297 },
      { t: NOW - H, v: 397 },
      { t: NOW, v: 394 },
    ];
    expect(burnRate(withReset, 3, NOW)).toBeCloseTo(2, 5);
  });

  test('returns null when history is too sparse', () => {
    const tick: PoolPoint[] = [
      { t: NOW - 5 * 60_000, v: 200 },
      { t: NOW, v: 199 },
    ];
    expect(burnRate(tick, 3, NOW)).toBeNull();
    // 1h of history is not enough for a 6h window (needs 2h).
    expect(
      burnRate(
        [
          { t: NOW - H, v: 200 },
          { t: NOW, v: 196 },
        ],
        6,
        NOW
      )
    ).toBeNull();
  });

  test('computes a steady rate from total drop over elapsed time', () => {
    const steady: PoolPoint[] = [
      { t: NOW - 3 * H, v: 200 },
      { t: NOW - 2 * H, v: 198 },
      { t: NOW - H, v: 196 },
      { t: NOW, v: 194 },
    ];
    expect(burnRate(steady, 3, NOW)).toBeCloseTo(2, 5);
  });

  test('is null without enough data', () => {
    expect(burnRate([], 3, NOW)).toBeNull();
    expect(burnRate([{ t: NOW, v: 10 }], 3, NOW)).toBeNull();
    expect(burnRate(series, 0, NOW)).toBeNull();
  });

  test('burnSeries yields a rolling rate on a grid', () => {
    const out = burnSeries(series, 1, NOW - 2 * H, NOW, H);
    expect(out).toHaveLength(3);
    out.forEach((point) => expect(point.v).toBeCloseTo(3, 5));
  });
});

describe('project', () => {
  const acct = (key: string, remaining: number, resetInH: number | null, windowH = 168) =>
    ({
      key,
      remaining,
      resetAt: resetInH === null ? null : NOW + resetInH * H,
      windowMs: windowH * H,
    }) satisfies PoolAccount;

  test('drains the soonest-resetting account first and clamps at zero', () => {
    const accounts = [acct('late', 100, 100), acct('soon', 50, 10)];
    const points = project(NOW, accounts, 10, 1, NOW + 8 * H);
    // 'soon' (50) drains at 10/h: empty after 5h, then 'late' takes the burn.
    expect(valueAt(points, NOW + 5 * H)).toBeCloseTo(100, 4);
    expect(valueAt(points, NOW + 8 * H)).toBeCloseTo(70, 4);
  });

  test('steps accounts back to 100 at reset, then every window', () => {
    const accounts = [acct('a', 20, 2, 5)];
    const points = project(NOW, accounts, 5, 1, NOW + 13 * H);
    const steps = findSteps(points);
    expect(steps.map((step) => step.t)).toEqual([NOW + 2 * H, NOW + 7 * H, NOW + 12 * H]);
    expect(steps.map((step) => Math.round(step.gain))).toEqual([90, 25, 25]);
  });

  test('applies the future-usage factor', () => {
    const accounts = [acct('a', 100, null)];
    const same = project(NOW, accounts, 4, 1, NOW + 10 * H);
    const heavy = project(NOW, accounts, 4, 1.5, NOW + 10 * H);
    const light = project(NOW, accounts, 4, 0.5, NOW + 10 * H);
    expect(valueAt(same, NOW + 10 * H)).toBeCloseTo(60, 4);
    expect(valueAt(heavy, NOW + 10 * H)).toBeCloseTo(40, 4);
    expect(valueAt(light, NOW + 10 * H)).toBeCloseTo(80, 4);
  });

  test('rolls a reset that already passed forward', () => {
    const accounts = [acct('a', 10, -1, 24)];
    const points = project(NOW, accounts, 0, 1, NOW + H);
    expect(points[0].v).toBe(100);
  });

  test('never-resetting account stays empty', () => {
    const points = project(NOW, [acct('a', 5, null)], 10, 1, NOW + 5 * H);
    expect(valueAt(points, NOW + 5 * H)).toBe(0);
    expect(poolEmptyAt(points)).toBe(NOW + 0.5 * H);
  });

  test('empty account list yields a single point', () => {
    expect(project(NOW, [], 5, 1, NOW + H)).toEqual([{ t: NOW, v: 0 }]);
  });
});

describe('helpers', () => {
  const accounts: PoolAccount[] = [
    { key: 'a', remaining: 30, resetAt: NOW + 20 * H, windowMs: 168 * H },
    { key: 'b', remaining: 100, resetAt: NOW + 40 * H, windowMs: 168 * H },
  ];

  test('firstEmpty names the first account to run dry', () => {
    const hit = firstEmpty(NOW, accounts, 6, 1, NOW + 100 * H);
    expect(hit?.key).toBe('a');
    expect(hit?.at).toBe(NOW + 5 * H);
  });

  test('firstEmpty is now when an account is already empty', () => {
    const hit = firstEmpty(NOW, [{ ...accounts[0], remaining: 0 }], 0, 1, NOW + H);
    expect(hit).toEqual({ at: NOW, key: 'a' });
  });

  test('poolEmptyAt is null when the pool never empties', () => {
    const points = project(NOW, accounts, 1, 1, NOW + 100 * H);
    expect(poolEmptyAt(points)).toBeNull();
  });

  test('nextReset reports the capacity actually added', () => {
    const points = project(NOW, accounts, 1, 1, NOW + 100 * H);
    const step = nextReset(points, NOW);
    expect(step?.t).toBe(NOW + 20 * H);
    expect(step?.gain).toBeCloseTo(90, 4);
  });
});

describe('poolBurnRate', () => {
  test('a reset on one account does not cancel drain on another', () => {
    const samples = [
      { ts: NOW - 1 * H, credentialKey: 'a', remainingPct: 100 },
      { ts: NOW - 1 * H, credentialKey: 'b', remainingPct: 0 },
      { ts: NOW, credentialKey: 'a', remainingPct: 80 },
      { ts: NOW, credentialKey: 'b', remainingPct: 100 },
    ];
    expect(poolBurnRate(samples, 1, NOW)).toBeCloseTo(20, 5);
  });

  test('unchanged observations keep their timing for the trailing window', () => {
    const samples = [
      { ts: NOW - 4 * H, credentialKey: 'a', remainingPct: 100 },
      { ts: NOW - 1 * H, credentialKey: 'a', remainingPct: 100 },
      { ts: NOW, credentialKey: 'a', remainingPct: 90 },
    ];
    expect(poolBurnRate(samples, 1, NOW)).toBeCloseTo(10, 5);
  });

  test('sparse history yields null', () => {
    const samples = [
      { ts: NOW - 5 * 60_000, credentialKey: 'a', remainingPct: 66 },
      { ts: NOW, credentialKey: 'a', remainingPct: 65 },
    ];
    expect(poolBurnRate(samples, 3, NOW)).toBeNull();
  });
});
