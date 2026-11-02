import { describe, expect, test } from 'bun:test';
import {
  HISTORY_DEDUPE_MS,
  HISTORY_RETENTION_MS,
  pruneSamples,
  shouldRecordSample,
} from '../src/features/quota/pool/historyStore';
import { RANGE_DAYS, dayTicks, poolRange } from '../src/features/quota/pool/poolView';
import { maskEmailsInText, splitEmailSegments } from '../src/features/quota/components/maskEmail';

describe('history store helpers', () => {
  test('dedupes samples closer than 60s', () => {
    expect(shouldRecordSample(null, 1000)).toBe(true);
    expect(shouldRecordSample(1000, 1000 + HISTORY_DEDUPE_MS - 1)).toBe(false);
    expect(shouldRecordSample(1000, 1000 + HISTORY_DEDUPE_MS)).toBe(true);
  });

  test('drops samples older than 30 days', () => {
    const now = 100 * 24 * 3600_000;
    const kept = pruneSamples(
      [{ ts: now - HISTORY_RETENTION_MS - 1 }, { ts: now - HISTORY_RETENTION_MS }, { ts: now }],
      now
    );
    expect(kept.map((s) => s.ts)).toEqual([now - HISTORY_RETENTION_MS, now]);
  });
});

describe('pool range', () => {
  test('spans 14 days starting 3 days back and shifts by weeks', () => {
    const now = new Date(2026, 9, 26, 15, 0).getTime();
    const range = poolRange(now, 0);
    expect(new Date(range.from).getDate()).toBe(23);
    expect(dayTicks(range)).toHaveLength(RANGE_DAYS);
    const next = poolRange(now, 1);
    expect(new Date(next.from).getDate()).toBe(30);
    expect(new Date(poolRange(now, -1).from).getDate()).toBe(16);
  });
});

describe('splitEmailSegments', () => {
  test('marks the email part only', () => {
    const parts = splitEmailSegments('claude-a@example.com (pro)');
    expect(parts.filter((p) => p.email).map((p) => p.text)).toEqual(['a@example.com']);
    expect(parts.map((p) => p.text).join('')).toBe('claude-a@example.com (pro)');
  });

  test('uses the known email when provided', () => {
    const parts = splitEmailSegments('Work: me@x.io', 'me@x.io');
    expect(parts).toEqual([
      { text: 'Work: ', email: false },
      { text: 'me@x.io', email: true },
    ]);
  });
});

describe('maskEmailsInText', () => {
  test('keeps text when emails are shown', () => {
    expect(maskEmailsInText('claude-a@example.com', true)).toBe('claude-a@example.com');
  });

  test('keeps the prefix and first 3 chars of the email, then an ellipsis', () => {
    expect(maskEmailsInText('claude-blasingame@gmail.com (pro)', false)).toBe('claude-bla… (pro)');
  });
});

describe('masking repeated emails', () => {
  test('masks every occurrence of the known email and other addresses', () => {
    const text = 'devin-user@example.com.json · user@example.com · other@test.io';
    const masked = maskEmailsInText(text, false, 'user@example.com');
    expect(masked).not.toContain('user@example.com');
    expect(masked).not.toContain('other@test.io');
    expect(masked).toBe('devin-use….json · use… · oth…');
  });
});
