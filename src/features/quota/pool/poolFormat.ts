/** Locale-aware labels for the pool charts. Pure apart from Intl. */

import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/utils/time/durations';

const cache = new Map<string, Intl.DateTimeFormat>();

const formatter = (locale: string, options: Intl.DateTimeFormatOptions) => {
  const key = `${locale}|${JSON.stringify(options)}`;
  let found = cache.get(key);
  if (!found) {
    try {
      found = new Intl.DateTimeFormat(locale, options);
    } catch {
      found = new Intl.DateTimeFormat(undefined, options);
    }
    cache.set(key, found);
  }
  return found;
};

/** "Sun 12:00 PM" */
export function formatWhen(ts: number, locale: string): string {
  const weekday = formatter(locale, { weekday: 'short' }).format(ts);
  const time = formatter(locale, { hour: 'numeric', minute: '2-digit' }).format(ts);
  return `${weekday} ${time}`;
}

/** "Fri 23" — axis tick. */
export function formatDayTick(ts: number, locale: string): string {
  const weekday = formatter(locale, { weekday: 'short' }).format(ts);
  const day = formatter(locale, { day: 'numeric' }).format(ts);
  return `${weekday} ${day}`;
}

/** "Tue" — midnight tick on the session axis. */
export function formatWeekday(ts: number, locale: string): string {
  return formatter(locale, { weekday: 'short' }).format(ts);
}

/** "6 PM" — session axis tick. */
export function formatHourTick(ts: number, locale: string): string {
  return formatter(locale, { hour: 'numeric' }).format(ts);
}

/** "Oct 23" */
export function formatMonthDay(ts: number, locale: string): string {
  return formatter(locale, { month: 'short', day: 'numeric' }).format(ts);
}

/** "15h 49m", "2d 18h", "12m". Sub-minute spans read as "<1m". */
export function formatDuration(ms: number): string {
  if (!(ms > 0)) return '0m';
  if (ms < MINUTE_MS) return '<1m';
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((ms % HOUR_MS) / MINUTE_MS);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** A round axis maximum at or above `value`. */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const fraction = value / base;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * base;
}
