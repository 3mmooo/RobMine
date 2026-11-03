/** Inventar als Zählwerk je Block-/Item-ID (Phase 3: ohne Slot-Raster). */
export class Inventory {
  readonly counts = new Map<number, number>();
  static readonly MAX_STACK = 999;

  count(id: number): number {
    return this.counts.get(id) ?? 0;
  }

  add(id: number, n = 1): void {
    if (n <= 0) return;
    this.counts.set(id, Math.min(Inventory.MAX_STACK, this.count(id) + n));
  }

  /** Entfernt n Stück; false (und keine Änderung), wenn nicht genug da ist. */
  remove(id: number, n = 1): boolean {
    const have = this.count(id);
    if (have < n) return false;
    if (have === n) this.counts.delete(id);
    else this.counts.set(id, have - n);
    return true;
  }

  has(id: number, n = 1): boolean {
    return this.count(id) >= n;
  }

  /** IDs mit Bestand > 0, sortiert. */
  ids(): number[] {
    return Array.from(this.counts.keys()).sort((a, b) => a - b);
  }

  toJSON(): [number, number][] {
    return Array.from(this.counts.entries());
  }

  static fromJSON(data: unknown): Inventory {
    const inv = new Inventory();
    if (Array.isArray(data)) {
      for (const e of data) {
        if (Array.isArray(e) && typeof e[0] === 'number' && typeof e[1] === 'number' && e[1] > 0)
          inv.add(e[0], e[1]);
      }
    }
    return inv;
  }
}

export interface CraftRecipe {
  out: number;
  count: number;
  inputs: readonly (readonly [number, number])[];
  workbench: boolean;
}

export function canCraft(inv: Inventory, r: CraftRecipe, nearWorkbench: boolean): boolean {
  if (r.workbench && !nearWorkbench) return false;
  return r.inputs.every(([id, n]) => inv.has(id, n));
}

/** Führt ein Rezept aus (atomar). */
export function craft(inv: Inventory, r: CraftRecipe, nearWorkbench: boolean): boolean {
  if (!canCraft(inv, r, nearWorkbench)) return false;
  for (const [id, n] of r.inputs) inv.remove(id, n);
  inv.add(r.out, r.count);
  return true;
}
