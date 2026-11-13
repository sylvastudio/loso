// Tiny IndexedDB wrapper for the browser-only app. Holds only what must live
// in the browser: the recent-projects index (with each project's folder
// handle), saved templates, the AI setup (+ the key, only if the user chose
// "remember"), each project's chat with Loso, cached transcripts, each
// project's versions (undo history) and a log of tokens the AI used (never
// sent anywhere). Project content itself lives in the user's folder (.loso file).
//
// Versions:
//   3 → 4: + "versions"; − "handles" (a remembered folder nothing read).
//   4 → 5: + "usage".

const DB_NAME = "loso-local";
const DB_VERSION = 5;
export const STORES = ["projects", "templates", "settings", "secrets", "chats", "transcripts", "versions", "usage"] as const;
const RETIRED_STORES = ["handles"];
export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      for (const s of RETIRED_STORES) if (db.objectStoreNames.contains(s)) db.deleteObjectStore(s);
    };
    req.onsuccess = () => {
      // Let a newer version in another tab upgrade instead of hanging it.
      req.result.onversionchange = () => {
        req.result.close();
        dbPromise = null;
      };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("Another Loso tab is open with an older version. Close it and reload."));
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(store, mode).objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      })
  );
}

export const idbGet = <T>(store: StoreName, key: string) =>
  run<T | undefined>(store, "readonly", (s) => s.get(key));
export const idbAll = <T>(store: StoreName) => run<T[]>(store, "readonly", (s) => s.getAll());
export const idbPut = (store: StoreName, key: string, value: unknown) =>
  run<IDBValidKey>(store, "readwrite", (s) => s.put(value, key)).then(() => undefined);
export const idbDelete = (store: StoreName, key: string) =>
  run<undefined>(store, "readwrite", (s) => s.delete(key));
export const idbClear = (store: StoreName) => run<undefined>(store, "readwrite", (s) => s.clear());
