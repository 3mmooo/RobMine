import { BoxGeometry, EdgesGeometry, LineBasicMaterial, LineSegments, Vector3 } from 'three';
import {
  AIR,
  type BlockHit,
  type BlockRegistry,
  PLAYER,
  raycastBlocks,
  RenderPass,
} from '@robmine/core';
import { isItem } from '@robmine/content';
import { BlockActionKind } from '@robmine/protocol';
import type { Renderer } from '../render/Renderer.ts';
import type { FlyCamera } from '../input/FlyCamera.ts';
import type { ChunkManager } from '../world/ChunkManager.ts';
import type { Connection } from '../net/Connection.ts';
import type { Hotbar } from '../ui/Hotbar.ts';
import type { BreakParticles } from '../render/BreakParticles.ts';
import type { Game } from './Game.ts';

const REACH = 6;
const ATTACK_REACH = 3.5;
const _dir = new Vector3();

interface Breaking {
  x: number;
  y: number;
  z: number;
  progress: number;
  time: number;
}

/**
 * Anvisieren (Raycast), Hervorheben, Abbauen (Linksklick halten; Kreativ sofort), Setzen
 * bzw. Benutzen (Rechtsklick), Angreifen von Kreaturen (Linksklick).
 */
export class Interaction {
  hit: BlockHit | null = null;
  readonly highlight: LineSegments;
  private downX = 0;
  private downY = 0;
  private downButton = -1;
  private holding = false;
  private breaking: Breaking | null = null;
  private readonly renderer: Renderer;
  private readonly fly: FlyCamera;
  private readonly chunks: ChunkManager;
  private readonly registry: BlockRegistry;
  private readonly connection: Connection;
  private readonly hotbar: Hotbar;
  private readonly particles: BreakParticles;
  private readonly game: Game;

  constructor(
    renderer: Renderer,
    fly: FlyCamera,
    chunks: ChunkManager,
    registry: BlockRegistry,
    connection: Connection,
    hotbar: Hotbar,
    particles: BreakParticles,
    game: Game,
  ) {
    this.renderer = renderer;
    this.fly = fly;
    this.chunks = chunks;
    this.registry = registry;
    this.connection = connection;
    this.hotbar = hotbar;
    this.particles = particles;
    this.game = game;
    this.highlight = new LineSegments(
      new EdgesGeometry(new BoxGeometry(1.004, 1.004, 1.004)),
      new LineBasicMaterial({ color: 0x1b1f3b, transparent: true, opacity: 0.7 }),
    );
    this.highlight.visible = false;
    this.highlight.renderOrder = 20;
    renderer.scene.add(this.highlight);

    const canvas = renderer.canvas;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      if (this.blocked()) return;
      this.downX = e.clientX;
      this.downY = e.clientY;
      this.downButton = e.button;
      if (e.button === 0) {
        if (this.tryAttack()) return;
        this.holding = true;
        // Kreativ mit Pointer Lock: sofort abbauen.
        if (this.game.creative && this.fly.isLocked) {
          this.holding = false;
          this.breakNow();
        }
      } else if (e.button === 2 && this.fly.isLocked) {
        this.use();
      }
    });
    canvas.addEventListener('mousemove', (e) => {
      // Im Drag-Modus ist Ziehen Umsehen, nicht Abbauen.
      if (this.holding && !this.fly.isLocked) {
        if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > 6) this.stopHolding();
      }
    });
    window.addEventListener('mouseup', (e) => {
      const wasHolding = this.holding;
      if (e.button === 0) this.stopHolding();
      if (this.fly.isLocked || e.button !== this.downButton || this.blocked()) return;
      const moved = Math.hypot(e.clientX - this.downX, e.clientY - this.downY);
      if (moved >= 6) return;
      // Drag-Modus: Klick ohne Ziehen
      if (e.button === 0 && this.game.creative && wasHolding) this.breakNow();
      else if (e.button === 2) this.use();
    });
  }

  private blocked(): boolean {
    return this.hotbar.isPickerOpen || !this.fly.enabled || this.game.survival.dead;
  }

  private stopHolding(): void {
    this.holding = false;
    this.breaking = null;
    this.game.setBreakProgress(0);
  }

  update(dt: number): void {
    const cam = this.renderer.camera;
    cam.getWorldDirection(_dir);
    this.hit = raycastBlocks(
      cam.position.x,
      cam.position.y,
      cam.position.z,
      _dir.x,
      _dir.y,
      _dir.z,
      REACH,
      (x, y, z) => {
        const b = this.chunks.getBlock(x, y, z) & 0xfff;
        return b !== AIR && this.registry.pass[b] !== RenderPass.Fluid;
      },
    );
    const h = this.hit;
    this.highlight.visible = !!h;
    if (h) this.highlight.position.set(h.x + 0.5, h.y + 0.5, h.z + 0.5);

    // Halten zum Abbauen (Survival)
    if (!this.holding || this.game.creative || !h) {
      if (this.breaking) {
        this.breaking = null;
        this.game.setBreakProgress(0);
      }
      return;
    }
    const b = this.breaking;
    if (!b || b.x !== h.x || b.y !== h.y || b.z !== h.z) {
      const block = this.chunks.getBlock(h.x, h.y, h.z) & 0xfff;
      const time = this.game.breakTime(block);
      if (time < 0) {
        this.breaking = null;
        this.game.setBreakProgress(0);
        return;
      }
      this.breaking = { x: h.x, y: h.y, z: h.z, progress: 0, time };
      return;
    }
    b.progress += dt;
    this.game.setBreakProgress(b.progress / b.time);
    if (b.progress >= b.time) {
      this.breakNow();
      this.breaking = null;
      this.game.setBreakProgress(0);
    }
  }

  /** Kreatur im Fadenkreuz und näher als der Block? Dann angreifen. */
  private tryAttack(): boolean {
    const cam = this.renderer.camera;
    cam.getWorldDirection(_dir);
    const target = this.game.creatures.raycast(
      cam.position.x,
      cam.position.y,
      cam.position.z,
      _dir.x,
      _dir.y,
      _dir.z,
      ATTACK_REACH,
    );
    if (!target) return false;
    if (this.hit && this.hit.dist < target.dist) return false;
    this.game.attack(target.creature.id);
    return true;
  }

  private breakNow(): void {
    const h = this.hit;
    if (!h) return;
    const block = this.chunks.getBlock(h.x, h.y, h.z) & 0xfff;
    if (block === AIR || this.game.breakTime(block) < 0) return;
    const o = block * 3;
    this.particles.burst(
      h.x,
      h.y,
      h.z,
      this.registry.colorSide[o]!,
      this.registry.colorSide[o + 1]!,
      this.registry.colorSide[o + 2]!,
    );
    this.game.onBreakRequested(h.x, h.y, h.z);
    this.connection.sendBlockAction(BlockActionKind.Break, h.x, h.y, h.z, 0);
  }

  /** Rechtsklick: Item benutzen (Essen) oder Block setzen. */
  private use(): void {
    const selected = this.hotbar.block;
    if (isItem(selected)) {
      this.game.useItem(selected);
      return;
    }
    const h = this.hit;
    if (!h) return;
    const x = h.x + h.nx;
    const y = h.y + h.ny;
    const z = h.z + h.nz;
    const current = this.chunks.getBlock(x, y, z) & 0xfff;
    if (current !== AIR && this.registry.pass[current] !== RenderPass.Fluid) return;
    // Nicht in den eigenen Körper bauen.
    if (this.fly.walk && this.registry.solid[selected] === 1) {
      const p = this.fly.player;
      const hw = PLAYER.width / 2;
      const overlapX = x + 1 > p.x - hw && x < p.x + hw;
      const overlapZ = z + 1 > p.z - hw && z < p.z + hw;
      const overlapY = y + 1 > p.y && y < p.y + PLAYER.height;
      if (overlapX && overlapY && overlapZ) return;
    }
    if (!this.game.tryReservePlace(x, y, z, selected)) return;
    this.connection.sendBlockAction(BlockActionKind.Place, x, y, z, selected);
  }
}
