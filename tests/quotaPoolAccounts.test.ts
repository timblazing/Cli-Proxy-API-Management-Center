import { describe, expect, test } from 'bun:test';
import type { QuotaFileEntry } from '../src/features/quota/logic';
import type { QuotaCardState } from '../src/features/quota/providers';
import { buildPoolAccount, buildPoolAccounts } from '../src/features/quota/pool/poolAccounts';
import {
  buildPoolView,
  sessionRange,
  sessionTicks,
  weeklyTicks,
} from '../src/features/quota/pool/poolView';

const H = 3_600_000;
const NOW = new Date(2026, 10, 2, 13, 30).getTime(); // Mon 2 Nov, 1:30 PM local

const entry = {
  type: 'claude',
  file: { name: 'claude-a.json', email: 'a@example.com' },
} as never as QuotaFileEntry;

const claude = (windows: Array<Record<string, unknown>>) =>
  ({ status: 'success', windows }) as never as QuotaCardState;

const fiveHour = {
  id: 'five-hour',
  label: '5-hour',
  usedPercent: 84,
  resetAtMs: NOW + 2 * H,
  periodHours: 5,
};
const sevenDay = {
  id: 'seven-day',
  label: '7-day',
  usedPercent: 39,
  resetAtMs: NOW + 50 * H,
  periodHours: 168,
};

describe('pool accounts per window', () => {
  test('weekly keeps the longest window and the `${hours}h` window id', () => {
    const account = buildPoolAccount(entry, claude([fiveHour, sevenDay]), 'weekly');
    expect(account?.windowId).toBe('168h');
    expect(account?.remaining).toBe(61);
  });

  test('session is picked from the five-hour window', () => {
    const account = buildPoolAccount(entry, claude([fiveHour, sevenDay]), 'session');
    expect(account?.windowId).toBe('5h');
    expect(account?.remaining).toBe(16);
    expect(account?.windowMs).toBe(5 * H);
    expect(account?.resetAt).toBe(NOW + 2 * H);
  });

  test('a credential with only a weekly window yields no session account', () => {
    const quota = claude([sevenDay]);
    expect(buildPoolAccount(entry, quota, 'session')).toBeNull();
    const sets = buildPoolAccounts([entry], () => quota);
    expect(sets.weekly.get('claude')).toHaveLength(1);
    expect(sets.session.get('claude')).toBeUndefined();
  });

  test('buildPoolAccounts fills both sets when both windows exist', () => {
    const sets = buildPoolAccounts([entry], () => claude([fiveHour, sevenDay]));
    expect(sets.weekly.get('claude')?.[0].windowId).toBe('168h');
    expect(sets.session.get('claude')?.[0].windowId).toBe('5h');
  });
});

describe('session range and ticks', () => {
  test('spans 12h back to 24h ahead', () => {
    const range = sessionRange(NOW);
    expect(range).toEqual({ from: NOW - 12 * H, to: NOW + 24 * H });
  });

  test('ticks sit on 6-hour local clock boundaries and label midnight as a weekday', () => {
    const range = sessionRange(NOW);
    const ticks = sessionTicks(range, 'en-US');
    expect(ticks.length).toBeGreaterThanOrEqual(6);
    ticks.forEach((tick) => {
      const d = new Date(tick.t);
      expect(d.getHours() % 6).toBe(0);
      expect(d.getMinutes()).toBe(0);
      expect(tick.t).toBeGreaterThanOrEqual(range.from);
      expect(tick.t).toBeLessThanOrEqual(range.to);
    });
    const midnight = ticks.find((tick) => new Date(tick.t).getHours() === 0);
    expect(midnight?.label).toBe('Tue');
    const evening = ticks.find((tick) => new Date(tick.t).getHours() === 18);
    expect(evening?.label).toBe('6 PM');
  });

  test('weekly ticks are one per day', () => {
    const ticks = weeklyTicks(
      { from: new Date(2026, 9, 30).getTime(), to: new Date(2026, 10, 13).getTime() },
      'en-US'
    );
    expect(ticks).toHaveLength(14);
    expect(ticks[0].label).toBe('Fri 30');
  });
});

describe('buildPoolView with a session range', () => {
  test('projects 5h resets up to the caller-supplied end', () => {
    const account = buildPoolAccount(entry, claude([fiveHour, sevenDay]), 'session');
    if (!account) throw new Error('expected a session account');
    const range = sessionRange(NOW);
    const view = buildPoolView({
      now: NOW,
      accounts: [account],
      samples: [],
      burnHours: 3,
      factor: 1,
      range,
      projectUntil: range.to,
    });
    expect(view.projectedUntil).toBe(range.to);
    expect(view.current).toBe(16);
    // 16% now; the window resets 2h out and refills to 100.
    expect(view.nextReset?.t).toBe(NOW + 2 * H);
    expect(view.nextReset?.gain).toBe(84);
    // With no recorded burn the pool holds at full after the reset.
    expect(view.projected[view.projected.length - 1]).toEqual({ t: range.to, v: 100 });
  });
});
