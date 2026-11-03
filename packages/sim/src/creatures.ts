import {
  type BlockQuery,
  createPlayerState,
  PLAYER,
  type PlayerState,
  stepPlayer,
} from '@robmine/core';

/** Schattenbrut „Huscher": 12 LP, schnell, Nahkampf 2, verbrennt im Licht. */
export const HUSCHER = {
  maxHealth: 12,
  attack: 2,
  attackRange: 1.4,
  attackCooldown: 1.0,
  chaseRange: 28,
  speedFactor: 1.15,
  /** Effektive Lichtstufe, ab der sie brennen (Lichtbrand). */
  burnLight: 11,
  burnDps: 3,
  /** Spawnen nur bei effektivem Licht darunter. */
  spawnMaxLight: 4,
  maxCount: 8,
  spawnInterval: 2.5,
  spawnMinDist: 18,
  spawnMaxDist: 34,
  despawnDist: 72,
} as const;

export interface Creature {
  id: number;
  body: PlayerState;
  yaw: number;
  health: number;
  attackTimer: number;
  burning: boolean;
  /** Zeit seit letztem Treffer (für Rot-Aufblitzen). */
  hurtFlash: number;
}

export interface CreatureWorld {
  isSolid: BlockQuery;
  isFluid: BlockQuery;
  /** Effektives Licht 0–15 (max aus Blocklicht und Himmelslicht × Tageslicht). */
  lightAt(x: number, y: number, z: number): number;
  /** Oberfläche (oberster fester Block) oder undefined, wenn nicht geladen. */
  surfaceY(x: number, z: number): number | undefined;
}

export interface CreatureEvents {
  /** Schaden an den Spieler in diesem Schritt. */
  playerDamage: number;
  /** Gestorbene Kreaturen (Position für Effekte/Drops). */
  died: { x: number; y: number; z: number; burned: boolean }[];
}

export class CreatureSystem {
  readonly creatures: Creature[] = [];
  private nextId = 1;
  private spawnTimer = 0;
  enabled = true;

  update(
    dt: number,
    player: { x: number; y: number; z: number; alive: boolean },
    world: CreatureWorld,
    rng: () => number,
  ): CreatureEvents {
    const events: CreatureEvents = { playerDamage: 0, died: [] };
    if (!this.enabled) return events;

    this.spawnTimer += dt;
    if (this.spawnTimer >= HUSCHER.spawnInterval) {
      this.spawnTimer = 0;
      if (this.creatures.length < HUSCHER.maxCount) this.trySpawn(player, world, rng);
    }

    for (let i = this.creatures.length - 1; i >= 0; i--) {
      const c = this.creatures[i]!;
      const b = c.body;
      const dx = player.x - b.x;
      const dz = player.z - b.z;
      const dy = player.y - b.y;
      const dist = Math.hypot(dx, dz);
      if (dist > HUSCHER.despawnDist) {
        this.creatures.splice(i, 1);
        continue;
      }
      c.attackTimer = Math.max(0, c.attackTimer - dt);
      c.hurtFlash = Math.max(0, c.hurtFlash - dt);

      // Verfolgen
      let moveZ = 0;
      let jump = false;
      if (player.alive && dist < HUSCHER.chaseRange && dist > 0.8) {
        c.yaw = Math.atan2(-dx, -dz);
        moveZ = 1;
        // Springen, wenn vorne ein Block im Weg ist.
        const fx = Math.floor(b.x - Math.sin(c.yaw) * 0.8);
        const fz = Math.floor(b.z - Math.cos(c.yaw) * 0.8);
        if (b.onGround && world.isSolid(fx, Math.floor(b.y + 0.2), fz)) jump = true;
      }
      stepPlayer(
        b,
        { moveX: 0, moveZ: moveZ * HUSCHER.speedFactor, yaw: c.yaw, jump, sprint: false },
        dt,
        world.isSolid,
        world.isFluid,
      );

      // Angriff
      if (
        player.alive &&
        dist < HUSCHER.attackRange &&
        Math.abs(dy) < PLAYER.height &&
        c.attackTimer === 0
      ) {
        events.playerDamage += HUSCHER.attack;
        c.attackTimer = HUSCHER.attackCooldown;
      }

      // Lichtbrand
      const light = world.lightAt(Math.floor(b.x), Math.floor(b.y + 1), Math.floor(b.z));
      c.burning = light >= HUSCHER.burnLight;
      if (c.burning) c.health -= HUSCHER.burnDps * dt;

      if (c.health <= 0 || b.y < -16) {
        events.died.push({ x: b.x, y: b.y, z: b.z, burned: c.burning });
        this.creatures.splice(i, 1);
      }
    }
    return events;
  }

  private trySpawn(
    player: { x: number; y: number; z: number },
    world: CreatureWorld,
    rng: () => number,
  ): void {
    for (let attempt = 0; attempt < 6; attempt++) {
      const ang = rng() * Math.PI * 2;
      const d = HUSCHER.spawnMinDist + rng() * (HUSCHER.spawnMaxDist - HUSCHER.spawnMinDist);
      const x = Math.floor(player.x + Math.cos(ang) * d);
      const z = Math.floor(player.z + Math.sin(ang) * d);
      const sy = world.surfaceY(x, z);
      if (sy === undefined) continue;
      const y = sy + 1;
      if (world.isFluid(x, sy, z) || world.isFluid(x, y, z)) continue;
      if (world.isSolid(x, y, z) || world.isSolid(x, y + 1, z)) continue;
      if (world.lightAt(x, y, z) >= HUSCHER.spawnMaxLight) continue;
      this.spawnAt(x + 0.5, y + 0.01, z + 0.5);
      return;
    }
  }

  spawnAt(x: number, y: number, z: number): Creature {
    const c: Creature = {
      id: this.nextId++,
      body: createPlayerState(x, y, z),
      yaw: 0,
      health: HUSCHER.maxHealth,
      attackTimer: 0,
      burning: false,
      hurtFlash: 0,
    };
    this.creatures.push(c);
    return c;
  }

  /** Strahl gegen die Körper aller Kreaturen; liefert die nächste unter `maxDist`. */
  raycast(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
  ): { creature: Creature; dist: number } | null {
    let best: { creature: Creature; dist: number } | null = null;
    const hw = PLAYER.width / 2 + 0.1;
    for (const c of this.creatures) {
      const b = c.body;
      const t = rayAabb(
        ox,
        oy,
        oz,
        dx,
        dy,
        dz,
        b.x - hw,
        b.y,
        b.z - hw,
        b.x + hw,
        b.y + PLAYER.height,
        b.z + hw,
      );
      if (t !== null && t <= maxDist && (!best || t < best.dist)) best = { creature: c, dist: t };
    }
    return best;
  }

  /** Treffer durch den Spieler mit Rückstoß. Liefert true, wenn die Kreatur stirbt. */
  hit(c: Creature, amount: number, fromX: number, fromZ: number): boolean {
    c.health -= amount;
    c.hurtFlash = 0.25;
    const dx = c.body.x - fromX;
    const dz = c.body.z - fromZ;
    const len = Math.hypot(dx, dz) || 1;
    c.body.vx = (dx / len) * 7;
    c.body.vz = (dz / len) * 7;
    c.body.vy = 5;
    c.body.onGround = false;
    return c.health <= 0;
  }

  clear(): void {
    this.creatures.length = 0;
  }
}

function rayAabb(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): number | null {
  let tmin = 0;
  let tmax = Infinity;
  const axes: [number, number, number, number][] = [
    [ox, dx, x0, x1],
    [oy, dy, y0, y1],
    [oz, dz, z0, z1],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}
