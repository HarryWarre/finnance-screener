import type { Alert, AlertEvent, Security, StoredSeries, WatchlistItem } from './types';

const DB_NAME = 'terminal_db';
const DB_VERSION = 1;

type StoreName = 'securities' | 'series' | 'watchlist' | 'alerts' | 'alert_events';

export type TerminalDb = IDBDatabase;

function openDb(): Promise<TerminalDb> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains('securities')) {
        db.createObjectStore('securities', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('series')) {
        db.createObjectStore('series', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('watchlist')) {
        db.createObjectStore('watchlist', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('alerts')) {
        db.createObjectStore('alerts', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('alert_events')) {
        const store = db.createObjectStore('alert_events', { keyPath: 'id' });
        store.createIndex('by_firedAt', 'firedAt', { unique: false });
        store.createIndex('by_alertId', 'alertId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withTx<T>(
  mode: IDBTransactionMode,
  stores: StoreName[],
  fn: (tx: IDBTransaction) => Promise<T>
) {
  const db = await openDb();
  const tx = db.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  const out = await fn(tx);
  await done;
  return out;
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function dbPutSecurity(item: Security) {
  return withTx('readwrite', ['securities'], async (tx) => {
    const store = tx.objectStore('securities');
    await reqToPromise(store.put(item));
  });
}

export async function dbGetSecurity(id: string) {
  return withTx('readonly', ['securities'], async (tx) => {
    const store = tx.objectStore('securities');
    return reqToPromise<Security | undefined>(store.get(id));
  });
}

export async function dbListSecurities() {
  return withTx('readonly', ['securities'], async (tx) => {
    const store = tx.objectStore('securities');
    return reqToPromise<Security[]>(store.getAll());
  });
}

export async function dbPutSeries(series: StoredSeries) {
  return withTx('readwrite', ['series'], async (tx) => {
    const store = tx.objectStore('series');
    await reqToPromise(store.put(series));
  });
}

export async function dbGetSeries(id: string) {
  return withTx('readonly', ['series'], async (tx) => {
    const store = tx.objectStore('series');
    return reqToPromise<StoredSeries | undefined>(store.get(id));
  });
}

export async function dbDeleteSeries(id: string) {
  return withTx('readwrite', ['series'], async (tx) => {
    const store = tx.objectStore('series');
    await reqToPromise(store.delete(id));
  });
}

export async function dbListSeriesBySecurity(securityId: string) {
  return withTx('readonly', ['series'], async (tx) => {
    const store = tx.objectStore('series');
    const all = await reqToPromise<StoredSeries[]>(store.getAll());
    return all.filter(s => s.key.securityId === securityId);
  });
}

export async function dbPutWatchlistItem(item: WatchlistItem) {
  return withTx('readwrite', ['watchlist'], async (tx) => {
    const store = tx.objectStore('watchlist');
    await reqToPromise(store.put(item));
  });
}

export async function dbDeleteWatchlistItem(id: string) {
  return withTx('readwrite', ['watchlist'], async (tx) => {
    const store = tx.objectStore('watchlist');
    await reqToPromise(store.delete(id));
  });
}

export async function dbListWatchlist() {
  return withTx('readonly', ['watchlist'], async (tx) => {
    const store = tx.objectStore('watchlist');
    return reqToPromise<WatchlistItem[]>(store.getAll());
  });
}

export async function dbPutAlert(item: Alert) {
  return withTx('readwrite', ['alerts'], async (tx) => {
    const store = tx.objectStore('alerts');
    await reqToPromise(store.put(item));
  });
}

export async function dbDeleteAlert(id: string) {
  return withTx('readwrite', ['alerts'], async (tx) => {
    const store = tx.objectStore('alerts');
    await reqToPromise(store.delete(id));
  });
}

export async function dbListAlerts() {
  return withTx('readonly', ['alerts'], async (tx) => {
    const store = tx.objectStore('alerts');
    return reqToPromise<Alert[]>(store.getAll());
  });
}

export async function dbPutAlertEvent(item: AlertEvent) {
  return withTx('readwrite', ['alert_events'], async (tx) => {
    const store = tx.objectStore('alert_events');
    await reqToPromise(store.put(item));
  });
}

export async function dbListAlertEvents(limit = 50) {
  return withTx('readonly', ['alert_events'], async (tx) => {
    const store = tx.objectStore('alert_events');
    const idx = store.index('by_firedAt');
    const out: AlertEvent[] = [];
    return new Promise<AlertEvent[]>((resolve, reject) => {
      const req = idx.openCursor(null, 'prev');
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve(out);
        out.push(cursor.value as AlertEvent);
        if (out.length >= limit) return resolve(out);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  });
}

