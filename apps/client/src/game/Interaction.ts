import { BoxGeometry, EdgesGeometry, LineBasicMaterial, LineSegments, Vector3 } from 'three';
import {
  AIR,
  type BlockHit,
  type BlockRegistry,
  PLAYER,
  raycastBlocks,
  RenderPass,
} from '@robmine/core';
import { BlockActionKind } from '@robmine/protocol';
import type { Renderer } from '../render/Renderer.ts';
import type { FlyCamera } from '../input/FlyCamera.ts';
import type { ChunkManager } from '../world/ChunkManager.ts';
import type { Connection } from '../net/Connection.ts';
import type { Hotbar } from '../ui/Hotbar.ts';
import type { BreakParticles } from '../render/BreakParticles.ts';

const REACH = 6;
const _dir = new Vector3();

/** Block anvisieren (Raycast), hervorheben, abbauen (links) und setzen (rechts). */
export class Interaction {
  hit: BlockHit | null = null;
  readonly highlight: LineSegments;
  private downX = 0;
  private downY = 0;
  private downButton = -1;
  private readonly renderer: Renderer;
  private readonly fly: FlyCamera;
  private readonly chunks: ChunkManager;
  private readonly registry: BlockRegistry;
  private readonly connection: Connection;
  private readonly hotbar: Hotbar;
  private readonly particles: BreakParticles;

  constructor(
    renderer: Renderer,
    fly: FlyCamera,
    chunks: ChunkManager,
    registry: BlockRegistry,
    connection: Connection,
    hotbar: Hotbar,
    particles: BreakParticles,
  ) {
    this.renderer = renderer;
    this.fly = fly;
    this.chunks = chunks;
    this.registry = registry;
    this.connection = connection;
    this.hotbar = hotbar;
    this.particles = particles;
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
      this.downX = e.clientX;
      this.downY = e.clientY;
      this.downButton = e.button;
      // Mit Pointer Lock sofort reagieren; im Drag-Modus erst beim Loslassen (ohne Ziehen).
      if (this.fly.isLocked) this.act(e.button);
    });
    canvas.addEventListener('mouseup', (e) => {
      if (this.fly.isLocked || e.button !== this.downButton) return;
      const moved = Math.hypot(e.clientX - this.downX, e.clientY - this.downY);
      if (moved < 5) this.act(e.button);
    });
  }

  private act(button: number): void {
    if (this.hotbar.isPickerOpen || !this.fly.enabled) return;
    if (button === 0) this.breakBlock();
    else if (button === 2) this.placeBlock();
  }

  update(): void {
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
    if (this.hit) {
      this.highlight.visible = true;
      this.highlight.position.set(this.hit.x + 0.5, this.hit.y + 0.5, this.hit.z + 0.5);
    } else {
      this.highlight.visible = false;
    }
  }

  breakBlock(): void {
    const h = this.hit;
    if (!h) return;
    const block = this.chunks.getBlock(h.x, h.y, h.z) & 0xfff;
    if (block === AIR) return;
    const o = block * 3;
    this.particles.burst(
      h.x,
      h.y,
      h.z,
      this.registry.colorSide[o]!,
      this.registry.colorSide[o + 1]!,
      this.registry.colorSide[o + 2]!,
    );
    this.connection.sendBlockAction(BlockActionKind.Break, h.x, h.y, h.z, 0);
  }

  placeBlock(): void {
    const h = this.hit;
    if (!h) return;
    const x = h.x + h.nx;
    const y = h.y + h.ny;
    const z = h.z + h.nz;
    const current = this.chunks.getBlock(x, y, z) & 0xfff;
    if (current !== AIR && this.registry.pass[current] !== RenderPass.Fluid) return;
    // Nicht in den eigenen Körper bauen.
    if (this.fly.walk && this.registry.solid[this.hotbar.block] === 1) {
      const p = this.fly.player;
      const hw = PLAYER.width / 2;
      const overlapX = x + 1 > p.x - hw && x < p.x + hw;
      const overlapZ = z + 1 > p.z - hw && z < p.z + hw;
      const overlapY = y + 1 > p.y && y < p.y + PLAYER.height;
      if (overlapX && overlapY && overlapZ) return;
    }
    this.connection.sendBlockAction(BlockActionKind.Place, x, y, z, this.hotbar.block);
  }
}
