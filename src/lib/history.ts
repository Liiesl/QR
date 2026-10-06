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

export function isURL(text: string): boolean {
  try {
    const u = new URL(text);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
