import type { HistoryItem } from './types.ts';

const KEY = 'pocket-qr-history';
const MAX = 20;

export function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (i): i is HistoryItem =>
        typeof i === 'object' && i !== null && typeof (i as HistoryItem).text === 'string'
    );
  } catch {
    return [];
  }
}

export function saveHistory(text: string, kind: string): HistoryItem[] {
  const items = loadHistory().filter((i) => i.text !== text);
  items.unshift({ text, kind, time: Date.now() });
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX)));
  } catch {
    // private mode — keep in memory only
  }
  return items.slice(0, MAX);
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function deleteHistoryItem(text: string): HistoryItem[] {
  const items = loadHistory().filter((i) => i.text !== text);
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX)));
  } catch {
    // private mode — keep in memory only
  }
  return items.slice(0, MAX);
}

const REL_DIVISORS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];

export function relativeTime(ts: number, now = Date.now()): string {
  const delta = Math.round((ts - now) / 1000);
  if (Math.abs(delta) < 45) return 'just now';
  try {
    const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    for (const [unit, secs] of REL_DIVISORS) {
      if (Math.abs(delta) >= secs || unit === 'minute') {
        return fmt.format(Math.round(delta / secs), unit);
      }
    }
  } catch {
    // fall through
  }
  return new Date(ts).toLocaleString();
}

export function isURL(text: string): boolean {
  try {
    const u = new URL(text);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
