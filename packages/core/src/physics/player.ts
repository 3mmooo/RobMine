/**
 * Spielerphysik: AABB gegen das Voxelgitter, achsengetrenntes Sweep, Schwerkraft,
 * Sprung, automatische Stufe (1 Block), Schwimmen. Identisch auf Client und Server.
 * Fester Schritt 1/60 s; `stepPlayer` teilt größere dt selbst in Substeps.
 */
export const PLAYER = {
  width: 0.6,
  height: 1.8,
  eyeHeight: 1.62,
  gravity: 32,
  jumpSpeed: 9,
  walkSpeed: 4.3,
  sprintSpeed: 6.0,
  swimSpeed: 2.5,
  swimUpSpeed: 4,
  stepHeight: 1.0,
  terminalSpeed: 60,
  fixedDt: 1 / 60,
} as const;

export interface PlayerState {
  /** Fußpunkt (Mitte der Grundfläche). */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  inWater: boolean;
}

export interface PlayerInput {
  /** Seitlich −1..1 (rechts positiv) und vorwärts −1..1, relativ zu `yaw`. */
  moveX: number;
  moveZ: number;
  yaw: number;
  jump: boolean;
  sprint: boolean;
}

export type BlockQuery = (x: number, y: number, z: number) => boolean;

export function createPlayerState(x: number, y: number, z: number): PlayerState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: false, inWater: false };
}

/** Überlappt die Spieler-Box an (px,py,pz) einen festen Block? */
export function collides(px: number, py: number, pz: number, isSolid: BlockQuery): boolean {
  const hw = PLAYER.width / 2;
  const x0 = Math.floor(px - hw);
  const x1 = Math.floor(px + hw - 1e-6);
  const y0 = Math.floor(py);
  const y1 = Math.floor(py + PLAYER.height - 1e-6);
  const z0 = Math.floor(pz - hw);
  const z1 = Math.floor(pz + hw - 1e-6);
  for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (isSolid(x, y, z)) return true;
  return false;
}

export function stepPlayer(
  s: PlayerState,
  input: PlayerInput,
  dt: number,
  isSolid: BlockQuery,
  isFluid: BlockQuery,
): void {
  let remaining = Math.min(dt, 0.25);
  while (remaining > 1e-6) {
    const h = Math.min(PLAYER.fixedDt, remaining);
    substep(s, input, h, isSolid, isFluid);
    remaining -= h;
  }
}

function substep(
  s: PlayerState,
  input: PlayerInput,
  dt: number,
  isSolid: BlockQuery,
  isFluid: BlockQuery,
): void {
  const hw = PLAYER.width / 2;
  s.inWater = isFluid(Math.floor(s.x), Math.floor(s.y + 0.4), Math.floor(s.z));

  // Wunschgeschwindigkeit horizontal
  const cy = Math.cos(input.yaw);
  const sy = Math.sin(input.yaw);
  const fx = -sy;
  const fz = -cy;
  const rx = cy;
  const rz = -sy;
  let mx = fx * input.moveZ + rx * input.moveX;
  let mz = fz * input.moveZ + rz * input.moveX;
  const len = Math.hypot(mx, mz);
  if (len > 1) {
    mx /= len;
    mz /= len;
  }
  const speed = s.inWater ? PLAYER.swimSpeed : input.sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
  // Weiche Beschleunigung am Boden, träger in der Luft
  const accel = s.onGround || s.inWater ? 18 : 6;
  s.vx += (mx * speed - s.vx) * Math.min(1, accel * dt);
  s.vz += (mz * speed - s.vz) * Math.min(1, accel * dt);

  // Vertikal
  if (s.inWater) {
    s.vy += (input.jump ? PLAYER.swimUpSpeed : -1.5 - s.vy) * Math.min(1, 6 * dt);
    if (input.jump) s.vy = Math.min(s.vy + 20 * dt, PLAYER.swimUpSpeed);
  } else {
    if (input.jump && s.onGround) s.vy = PLAYER.jumpSpeed;
    s.vy -= PLAYER.gravity * dt;
    if (s.vy < -PLAYER.terminalSpeed) s.vy = -PLAYER.terminalSpeed;
  }

  // X
  const nx = s.x + s.vx * dt;
  if (!collides(nx, s.y, s.z, isSolid)) s.x = nx;
  else if (!tryStep(s, nx, s.z, isSolid)) {
    s.x = s.vx > 0 ? Math.floor(nx + hw) - hw - 1e-4 : Math.ceil(nx - hw) + hw + 1e-4;
    if (collides(s.x, s.y, s.z, isSolid)) s.x = s.x - s.vx * dt; // Rückfall
    s.vx = 0;
  }
  // Z
  const nz = s.z + s.vz * dt;
  if (!collides(s.x, s.y, nz, isSolid)) s.z = nz;
  else if (!tryStep(s, s.x, nz, isSolid)) {
    s.z = s.vz > 0 ? Math.floor(nz + hw) - hw - 1e-4 : Math.ceil(nz - hw) + hw + 1e-4;
    if (collides(s.x, s.y, s.z, isSolid)) s.z = s.z - s.vz * dt;
    s.vz = 0;
  }
  // Y
  const ny = s.y + s.vy * dt;
  if (!collides(s.x, ny, s.z, isSolid)) {
    s.y = ny;
    s.onGround = false;
  } else if (s.vy < 0) {
    s.y = Math.ceil(ny) + 1e-4; // auf Blockoberkante
    if (collides(s.x, s.y, s.z, isSolid)) s.y = Math.floor(s.y) + 1 + 1e-4;
    s.vy = 0;
    s.onGround = true;
  } else {
    s.y = Math.floor(ny + PLAYER.height) - PLAYER.height - 1e-4; // Kopf an Blockunterkante
    s.vy = 0;
  }
}

/** Automatische Stufe: passt die Box einen Block höher an die Zielposition? */
function tryStep(s: PlayerState, nx: number, nz: number, isSolid: BlockQuery): boolean {
  if (!s.onGround || s.inWater) return false;
  const up = Math.floor(s.y) + 1 + 1e-4;
  if (up - s.y > PLAYER.stepHeight + 1e-3) return false;
  if (collides(s.x, up, s.z, isSolid) || collides(nx, up, nz, isSolid)) return false;
  s.x = nx;
  s.z = nz;
  s.y = up;
  return true;
}
