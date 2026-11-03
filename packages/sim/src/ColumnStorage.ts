/** Persistenz veränderter Spalten (8 RMC1-Blobs je Spalte). */
export interface ColumnStorage {
  load(cx: number, cz: number): Promise<Uint8Array[] | null>;
  save(cx: number, cz: number, blobs: Uint8Array[]): Promise<void>;
  /** Alle gespeicherten Spalten-Schlüssel (cx, cz). */
  keys(): Promise<[number, number][]>;
}

/** Speicher nur im Arbeitsspeicher (Tests, Server-Fallback). */
export class MemoryColumnStorage implements ColumnStorage {
  readonly map = new Map<string, Uint8Array[]>();
  load(cx: number, cz: number): Promise<Uint8Array[] | null> {
    return Promise.resolve(this.map.get(`${cx},${cz}`) ?? null);
  }
  save(cx: number, cz: number, blobs: Uint8Array[]): Promise<void> {
    this.map.set(`${cx},${cz}`, blobs);
    return Promise.resolve();
  }
  keys(): Promise<[number, number][]> {
    return Promise.resolve(
      Array.from(this.map.keys()).map((k) => k.split(',').map(Number) as [number, number]),
    );
  }
}
