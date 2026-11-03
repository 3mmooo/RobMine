import type { BlockRegistry } from '@robmine/core';
import { describe, RECIPES } from '@robmine/content';
import { canCraft, type Inventory } from '@robmine/sim';

export interface HotbarSource {
  isCreative(): boolean;
  readonly inventory: Inventory;
  nearWorkbench(): boolean;
  /** Rezept ausführen; liefert true bei Erfolg. */
  craft(recipeId: string): boolean;
}

/**
 * Hotbar mit 9 Slots + Menü (E):
 *  - Kreativ: alle setzbaren Blöcke, unbegrenzt.
 *  - Survival: Inventar mit Anzahl + Rezepte (Werkbank in der Nähe für manche).
 */
export class Hotbar {
  readonly slots: number[];
  selected = 0;
  private readonly el: HTMLElement;
  private readonly picker: HTMLElement;
  private pickerOpen = false;
  private readonly registry: BlockRegistry;
  private readonly placeable: number[];
  private source: HotbarSource | null = null;
  onChange: (() => void) | null = null;

  constructor(registry: BlockRegistry, defaults: number[], placeable: number[]) {
    this.registry = registry;
    this.placeable = placeable;
    this.slots = defaults.slice(0, 9);
    while (this.slots.length < 9) this.slots.push(defaults[0] ?? 1);
    const overlay = document.getElementById('overlay') ?? document.body;
    this.el = document.createElement('div');
    this.el.className = 'hotbar';
    overlay.appendChild(this.el);
    this.picker = document.createElement('div');
    this.picker.className = 'picker hidden';
    overlay.appendChild(this.picker);

    window.addEventListener('keydown', (e) => {
      if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5));
        if (n >= 1 && n <= 9) this.select(n - 1);
      } else if (e.code === 'KeyE') {
        this.togglePicker();
      } else if (e.code === 'Escape' && this.pickerOpen) {
        this.togglePicker(false);
      }
    });
    window.addEventListener('wheel', (e) => {
      if (this.pickerOpen) return;
      this.select((this.selected + (e.deltaY > 0 ? 1 : 8)) % 9);
    });
    this.render();
  }

  setSource(source: HotbarSource): void {
    this.source = source;
    this.refresh();
  }

  get block(): number {
    return this.slots[this.selected]!;
  }

  get isPickerOpen(): boolean {
    return this.pickerOpen;
  }

  select(i: number): void {
    this.selected = ((i % 9) + 9) % 9;
    this.render();
    this.onChange?.();
  }

  togglePicker(force?: boolean): void {
    this.pickerOpen = force ?? !this.pickerOpen;
    this.picker.classList.toggle('hidden', !this.pickerOpen);
    if (this.pickerOpen) {
      this.renderPicker();
      if (document.pointerLockElement) document.exitPointerLock();
    }
  }

  /** Anzeige nach Inventar-/Modusänderung aktualisieren. */
  refresh(): void {
    this.render();
    if (this.pickerOpen) this.renderPicker();
  }

  private assign(id: number): void {
    this.slots[this.selected] = id;
    this.refresh();
    this.onChange?.();
  }

  private render(): void {
    const creative = this.source?.isCreative() ?? true;
    const inv = this.source?.inventory;
    this.el.innerHTML = this.slots
      .map((id, i) => {
        const d = describe(this.registry, id);
        const n = creative || !inv ? -1 : inv.count(id);
        const empty = n === 0;
        return `<div class="slot${i === this.selected ? ' active' : ''}${empty ? ' empty' : ''}" title="${d.label}"><span class="swatch" style="background:${d.rgb}"></span><span class="num">${i + 1}</span>${n > 0 ? `<span class="count">${n}</span>` : ''}</div>`;
      })
      .join('');
  }

  private renderPicker(): void {
    const creative = this.source?.isCreative() ?? true;
    this.picker.innerHTML = '';
    const title = (text: string): void => {
      const h = document.createElement('div');
      h.className = 'picker-title';
      h.textContent = text;
      this.picker.appendChild(h);
    };
    const item = (id: number, count: number): void => {
      const d = describe(this.registry, id);
      const btn = document.createElement('button');
      btn.className = 'picker-item';
      btn.title = `${d.label} → Slot ${this.selected + 1}`;
      btn.innerHTML = `<span class="swatch" style="background:${d.rgb}"></span><span>${d.label}${count >= 0 ? ` ×${count}` : ''}</span>`;
      btn.addEventListener('click', () => this.assign(id));
      this.picker.appendChild(btn);
    };

    if (creative || !this.source) {
      title('Kreativ – Block für den aktiven Slot wählen');
      for (const id of this.placeable) item(id, -1);
      return;
    }
    const inv = this.source.inventory;
    title('Inventar – Klick legt in den aktiven Slot');
    const ids = inv.ids();
    if (ids.length === 0) {
      const p = document.createElement('div');
      p.className = 'picker-note';
      p.textContent = 'Noch leer – bau einen Hain-Stamm ab (Linksklick halten).';
      this.picker.appendChild(p);
    }
    for (const id of ids) item(id, inv.count(id));

    const bench = this.source.nearWorkbench();
    title(
      bench
        ? 'Herstellen (Werkbank in der Nähe)'
        : 'Herstellen (für ★ eine Werkbank in der Nähe aufstellen)',
    );
    for (const r of RECIPES) {
      const out = describe(this.registry, r.out);
      const ok = canCraft(inv, r, bench);
      const btn = document.createElement('button');
      btn.className = `picker-item recipe${ok ? '' : ' disabled'}`;
      const ins = r.inputs
        .map(([id, n]) => `${n}× ${describe(this.registry, id).label}`)
        .join(' + ');
      btn.innerHTML = `<span class="swatch" style="background:${out.rgb}"></span><span>${r.workbench ? '★ ' : ''}${r.count}× ${out.label}<small>${ins}</small></span>`;
      btn.disabled = !ok;
      btn.addEventListener('click', () => {
        if (this.source?.craft(r.id)) this.refresh();
      });
      this.picker.appendChild(btn);
    }
  }
}
