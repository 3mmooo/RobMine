import { AIR, CHUNK_BITS, CHUNK_MASK, type Column, columnGet, columnKey } from '@robmine/core';

/** Spaltenspeicher einer Instanz (Server oder lokale Simulation). */
export class World {
  readonly seed: number;
  private readonly columns = new Map<string, Column>();

  constructor(seed: number) {
    this.seed = seed >>> 0;
  }

  getColumn(cx: number, cz: number): Column | undefined {
    return this.columns.get(columnKey(cx, cz));
  }

  setColumn(col: Column): void {
    this.columns.set(columnKey(col.cx, col.cz), col);
  }

  removeColumn(cx: number, cz: number): boolean {
    return this.columns.delete(columnKey(cx, cz));
  }

  hasColumn(cx: number, cz: number): boolean {
    return this.columns.has(columnKey(cx, cz));
  }

  get columnCount(): number {
    return this.columns.size;
  }

  getBlock(x: number, y: number, z: number): number {
    const col = this.getColumn(x >> CHUNK_BITS, z >> CHUNK_BITS);
    if (!col) return AIR;
    return columnGet(col, x & CHUNK_MASK, y, z & CHUNK_MASK);
  }

  forEachColumn(fn: (col: Column) => void): void {
    for (const col of this.columns.values()) fn(col);
  }
}
