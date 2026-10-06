/** Shared payload stashed by the SW share-target handler (offline-safe, IndexedDB). */

export interface PendingShare {
  files: Blob[];
  title: string;
  text: string;
  url: string;
  timestamp: number;
}

const DB_NAME = 'qr-share-target';
const STORE = 'payloads';
const KEY = 'pending';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getPendingShare(): Promise<PendingShare | null> {
  try {
    const db = await openDB();
    try {
      const value = await new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const store = tx.objectStore(STORE);
        const req = store.get(KEY);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      if (!value || typeof value !== 'object') return null;
      const v = value as Partial<PendingShare>;
      return {
        files: Array.isArray(v.files) ? (v.files as Blob[]) : [],
        title: typeof v.title === 'string' ? v.title : '',
        text: typeof v.text === 'string' ? v.text : '',
        url: typeof v.url === 'string' ? v.url : '',
        timestamp: typeof v.timestamp === 'number' ? v.timestamp : 0
      };
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function clearPendingShare(): Promise<void> {
  try {
    const db = await openDB();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const req = store.delete(KEY);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // ignore — share is best-effort
  }
}

export async function consumePendingShare(): Promise<PendingShare | null> {
  const pending = await getPendingShare();
  if (pending) await clearPendingShare();
  return pending;
}
