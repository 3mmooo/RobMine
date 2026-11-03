import { AIR, type BlockRegistry, lightB, lightG, lightR, lightSky } from '@robmine/core';
import { BLOCK, dropsFor, ITEM, ITEMS, isItem, RECIPES } from '@robmine/content';
import {
  craft,
  CreatureSystem,
  createSurvival,
  damage,
  eat,
  fallDamage,
  Inventory,
  respawn,
  SURVIVAL,
  type SurvivalState,
  tickSurvival,
} from '@robmine/sim';
import type { FlyCamera } from '../input/FlyCamera.ts';
import type { ChunkManager } from '../world/ChunkManager.ts';
import type { Renderer } from '../render/Renderer.ts';
import type { Hotbar, HotbarSource } from '../ui/Hotbar.ts';
import type { BreakParticles } from '../render/BreakParticles.ts';
import { CreatureRenderer } from '../render/CreatureRenderer.ts';

interface PendingPlace {
  block: number;
  at: number;
}

/**
 * Spielzustand (Phase 3, Solo): Modus Survival/Kreativ, Inventar, Leben/Sättigung,
 * Schattenbrut. Persistenz in localStorage je Seed.
 *
 * Hinweis Architektur: Kreaturen und Survival-Werte laufen in Phase 3 noch im Client
 * (reine Logik aus @robmine/sim); mit dem Multiplayer-Server wandern sie in die Instanz.
 */
export class Game implements HotbarSource {
  creative = false;
  inventory = new Inventory();
  readonly survival: SurvivalState = createSurvival();
  readonly creatures = new CreatureSystem();
  private readonly creatureRenderer: CreatureRenderer;
  private readonly pendingBreaks = new Set<string>();
  private readonly pendingPlaces = new Map<string, PendingPlace>();
  private airborneMaxY: number | null = null;
  private saveTimer = 0;
  private time = 0;
  private readonly storageKey: string;
  private readonly hud: Hud;
  /** Wird beim Wiederaufleben aufgerufen (setzt den Spieler an den Startpunkt). */
  onRespawn: (() => void) | null = null;
  private readonly registry: BlockRegistry;
  private readonly fly: FlyCamera;
  private readonly chunks: ChunkManager;
  private readonly renderer: Renderer;
  private readonly hotbar: Hotbar;
  private readonly particles: BreakParticles;

  constructor(
    registry: BlockRegistry,
    fly: FlyCamera,
    chunks: ChunkManager,
    renderer: Renderer,
    hotbar: Hotbar,
    particles: BreakParticles,
    seed: number,
  ) {
    this.registry = registry;
    this.fly = fly;
    this.chunks = chunks;
    this.renderer = renderer;
    this.hotbar = hotbar;
    this.particles = particles;
    this.creatureRenderer = new CreatureRenderer(renderer.scene);
    this.storageKey = `robmine-player-${seed >>> 0}`;
    this.hud = new Hud(() => this.doRespawn());
    this.load();
    this.applyMode();
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyC' && !e.repeat) {
        this.creative = !this.creative;
        this.applyMode();
        this.save();
      }
    });
    window.addEventListener('beforeunload', () => this.save());
  }

  // --- HotbarSource ---
  isCreative(): boolean {
    return this.creative;
  }
  nearWorkbench(): boolean {
    const p = this.fly.player;
    const px = Math.floor(p.x);
    const py = Math.floor(p.y);
    const pz = Math.floor(p.z);
    for (let y = py - 2; y <= py + 3; y++)
      for (let z = pz - 4; z <= pz + 4; z++)
        for (let x = px - 4; x <= px + 4; x++)
          if ((this.chunks.getBlock(x, y, z) & 0xfff) === BLOCK.Werkbank) return true;
    return false;
  }
  craft(recipeId: string): boolean {
    const r = RECIPES.find((x) => x.id === recipeId);
    if (!r) return false;
    const ok = craft(this.inventory, r, this.nearWorkbench());
    if (ok) {
      this.hotbar.refresh();
      this.save();
    }
    return ok;
  }

  /** Effektives Licht 0–15 an einer Position (Block-RGB oder Himmel × Tageslicht). */
  lightAt(x: number, y: number, z: number): number {
    const v = this.chunks.getLight(x, y, z);
    const block = Math.max(lightR(v), lightG(v), lightB(v));
    const sky = Math.round(lightSky(v) * this.renderer.skyState.daylight);
    return Math.max(block, sky);
  }

  // --- Abbauen / Setzen / Benutzen ---

  /** Abbauzeit in Sekunden (Kreativ: sofort); -1 = unzerstörbar. */
  breakTime(block: number): number {
    const def = this.registry.get(block);
    if (def.hardness < 0) return -1;
    if (this.creative) return 0;
    return Math.max(0.12, def.hardness * 0.9);
  }

  onBreakRequested(x: number, y: number, z: number): void {
    this.pendingBreaks.add(`${x},${y},${z}`);
  }

  /** Darf gesetzt werden? Verbraucht im Survival optimistisch einen Block. */
  tryReservePlace(x: number, y: number, z: number, block: number): boolean {
    if (this.survival.dead) return false;
    if (this.creative) return true;
    if (!this.inventory.remove(block, 1)) return false;
    this.pendingPlaces.set(`${x},${y},${z}`, { block, at: this.time });
    this.hotbar.refresh();
    return true;
  }

  /** Item benutzen (Essen). Liefert true, wenn etwas passiert ist. */
  useItem(id: number): boolean {
    if (!isItem(id)) return false;
    const def = ITEMS[id];
    if (!def || def.food <= 0) return false;
    if (!this.creative && !this.inventory.has(id)) return false;
    if (!eat(this.survival, def.food)) return false;
    if (!this.creative) this.inventory.remove(id, 1);
    this.hotbar.refresh();
    this.save();
    return true;
  }

  /** Bestätigte Blockänderung vom Server – Drops gutschreiben, Reservierungen abschließen. */
  onBlockConfirmed(x: number, y: number, z: number, oldBlock: number, newBlock: number): void {
    const key = `${x},${y},${z}`;
    if (this.pendingBreaks.delete(key) && newBlock === AIR && oldBlock !== AIR && !this.creative) {
      for (const [id, n] of dropsFor(this.registry, oldBlock & 0xfff, Math.random()))
        this.inventory.add(id, n);
      this.hotbar.refresh();
    }
    const place = this.pendingPlaces.get(key);
    if (place && newBlock === place.block) this.pendingPlaces.delete(key);
  }

  /** Angriff auf eine Kreatur (Hand: 4 Schaden). */
  attack(creatureId: number): void {
    const c = this.creatures.creatures.find((k) => k.id === creatureId);
    if (!c) return;
    const p = this.fly.player;
    if (this.creatures.hit(c, 4, p.x, p.z)) {
      this.creatures.creatures.splice(this.creatures.creatures.indexOf(c), 1);
      this.particles.burst(
        Math.floor(c.body.x),
        Math.floor(c.body.y + 0.5),
        Math.floor(c.body.z),
        75,
        58,
        110,
        30,
      );
      if (!this.creative && Math.random() < 0.6) {
        this.inventory.add(ITEM.Schattenstaub, 1);
        this.hotbar.refresh();
      }
    }
  }

  update(dt: number): void {
    this.time += dt;
    const p = this.fly.player;
    const s = this.survival;

    // Nicht bestätigte Platzierungen nach 3 s zurückbuchen.
    for (const [key, pp] of this.pendingPlaces) {
      if (this.time - pp.at < 3) continue;
      this.pendingPlaces.delete(key);
      this.inventory.add(pp.block, 1);
      this.hotbar.refresh();
    }

    if (!this.creative && !s.dead) {
      tickSurvival(s, dt, this.fly.sprinting);
      // Fallschaden
      if (this.fly.walk) {
        if (!p.onGround && !p.inWater) {
          this.airborneMaxY = Math.max(this.airborneMaxY ?? p.y, p.y);
        } else {
          if (this.airborneMaxY !== null && p.onGround && !p.inWater) {
            const dmg = fallDamage(s, this.airborneMaxY - p.y);
            if (dmg > 0 && damage(s, dmg, true)) this.hud.flash();
          }
          this.airborneMaxY = null;
        }
      }
    } else {
      this.airborneMaxY = null;
    }

    // Kreaturen
    const ev = this.creatures.update(
      dt,
      { x: p.x, y: p.y, z: p.z, alive: !s.dead && !this.creative && this.fly.walk },
      {
        isSolid: this.fly.isSolid!,
        isFluid: this.fly.isFluid!,
        lightAt: (x, y, z) => this.lightAt(x, y, z),
        surfaceY: (x, z) =>
          this.chunks.isLoadedAt(x, z) ? this.chunks.surfaceHeight(x, z) : undefined,
      },
      Math.random,
    );
    if (ev.playerDamage > 0 && !this.creative && damage(s, ev.playerDamage)) this.hud.flash();
    for (const d of ev.died) {
      this.particles.burst(
        Math.floor(d.x),
        Math.floor(d.y + 0.5),
        Math.floor(d.z),
        255,
        140,
        60,
        26,
      );
    }
    this.creatureRenderer.update(this.creatures.creatures, dt, this.time);

    if (s.dead) this.hud.showDeath(true);
    this.hud.render(s, this.creative);

    this.saveTimer += dt;
    if (this.saveTimer > 5) {
      this.saveTimer = 0;
      this.save();
    }
  }

  setBreakProgress(p: number): void {
    this.hud.setBreakProgress(p);
  }

  private doRespawn(): void {
    respawn(this.survival);
    this.creatures.clear();
    this.hud.showDeath(false);
    this.onRespawn?.();
    this.save();
  }

  private applyMode(): void {
    this.fly.canFly = this.creative;
    this.creatures.enabled = !this.creative;
    if (this.creative) this.creatures.clear();
    else if (!this.fly.walk) this.fly.setWalk(true);
    this.hud.setMode(this.creative);
    this.hotbar.refresh();
  }

  private save(): void {
    try {
      localStorage.setItem(
        this.storageKey,
        JSON.stringify({
          v: 1,
          creative: this.creative,
          inventory: this.inventory.toJSON(),
          slots: this.hotbar.slots,
          health: this.survival.health,
          hunger: this.survival.hunger,
        }),
      );
    } catch {
      // Speicher voll/gesperrt – Spiel läuft weiter
    }
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const d = JSON.parse(raw) as {
        creative?: boolean;
        inventory?: unknown;
        slots?: unknown;
        health?: number;
        hunger?: number;
      };
      this.creative = !!d.creative;
      this.inventory = Inventory.fromJSON(d.inventory);
      if (
        Array.isArray(d.slots) &&
        d.slots.length === 9 &&
        d.slots.every((n) => typeof n === 'number')
      )
        for (let i = 0; i < 9; i++) this.hotbar.slots[i] = d.slots[i] as number;
      if (typeof d.health === 'number' && d.health > 0)
        this.survival.health = Math.min(SURVIVAL.maxHealth, d.health);
      if (typeof d.hunger === 'number')
        this.survival.hunger = Math.min(SURVIVAL.maxHunger, Math.max(0, d.hunger));
    } catch {
      // kaputte Daten ignorieren
    }
  }
}

/** HUD: Leben, Sättigung, Modus, Abbau-Fortschritt, Treffer-Blitz, Todesbildschirm. */
class Hud {
  private readonly bars: HTMLElement;
  private readonly health: HTMLElement;
  private readonly hunger: HTMLElement;
  private readonly mode: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly progressFill: HTMLElement;
  private readonly flashEl: HTMLElement;
  private readonly death: HTMLElement;
  private lastKey = '';

  constructor(onRespawn: () => void) {
    const overlay = document.getElementById('overlay') ?? document.body;
    this.bars = el('div', 'vitals');
    this.health = el('div', 'vital health');
    this.hunger = el('div', 'vital hunger');
    this.bars.append(this.health, this.hunger);
    this.mode = el('div', 'mode-badge');
    this.progress = el('div', 'break-progress hidden');
    this.progressFill = el('div', 'fill');
    this.progress.appendChild(this.progressFill);
    this.flashEl = el('div', 'hurt-flash');
    this.death = el('div', 'death hidden');
    this.death.innerHTML =
      '<div class="death-card"><h2>Dein Licht ist erloschen</h2><p>Dein Inventar bleibt erhalten.</p></div>';
    const btn = document.createElement('button');
    btn.textContent = 'Wiederaufleben';
    btn.addEventListener('click', onRespawn);
    this.death.querySelector('.death-card')!.appendChild(btn);
    overlay.append(this.flashEl, this.bars, this.mode, this.progress, this.death);
  }

  render(s: SurvivalState, creative: boolean): void {
    const key = `${s.health}|${s.hunger}|${creative}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.bars.classList.toggle('hidden', creative);
    this.health.innerHTML = icons(s.health, SURVIVAL.maxHealth, '♥');
    this.hunger.innerHTML = icons(s.hunger, SURVIVAL.maxHunger, '●');
  }

  setMode(creative: boolean): void {
    this.mode.textContent = creative ? 'Kreativ · C wechselt' : 'Survival · C wechselt';
    this.lastKey = '';
  }

  setBreakProgress(p: number): void {
    this.progress.classList.toggle('hidden', p <= 0);
    this.progressFill.style.width = `${Math.min(100, p * 100).toFixed(0)}%`;
  }

  flash(): void {
    this.flashEl.classList.remove('on');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('on');
  }

  showDeath(show: boolean): void {
    this.death.classList.toggle('hidden', !show);
    if (show && document.pointerLockElement) document.exitPointerLock();
  }
}

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

function icons(value: number, max: number, glyph: string): string {
  let out = '';
  for (let i = 0; i < max / 2; i++) {
    const v = value - i * 2;
    const cls = v >= 2 ? 'full' : v === 1 ? 'half' : 'empty';
    out += `<span class="${cls}">${glyph}</span>`;
  }
  return out;
}
