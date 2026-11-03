import type { ColumnStorage } from '@robmine/sim';

const STORE = 'columns';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB-Fehler'));
  });
}

/** Persistenz veränderter Spalten in IndexedDB (läuft auch im Worker). */
export class IndexedDbColumnStorage implements ColumnStorage {
  private readonly db: Promise<IDBDatabase>;

  constructor(dbName: string) {
    this.db = new Promise((resolve, reject) => {
      const open = indexedDB.open(dbName, 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE);
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () =>
        reject(open.error ?? new Error('IndexedDB konnte nicht geöffnet werden'));
    });
  }

  async load(cx: number, cz: number): Promise<Uint8Array[] | null> {
    const db = await this.db;
    const tx = db.transaction(STORE, 'readonly');
    const value = await request<Uint8Array[] | undefined>(tx.objectStore(STORE).get(`${cx},${cz}`));
    return value ?? null;
  }

  async save(cx: number, cz: number, blobs: Uint8Array[]): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(STORE, 'readwrite');
    await request(tx.objectStore(STORE).put(blobs, `${cx},${cz}`));
  }

  async keys(): Promise<[number, number][]> {
    const db = await this.db;
    const tx = db.transaction(STORE, 'readonly');
    const keys = await request<IDBValidKey[]>(tx.objectStore(STORE).getAllKeys());
    return keys.map((k) => String(k).split(',').map(Number) as [number, number]);
  }
}
