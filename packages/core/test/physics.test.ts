import { describe, expect, it } from 'vitest';
import { collides, createPlayerState, PLAYER, stepPlayer } from '../src/physics/player.ts';

// Testwelt: Boden bei y<=10 fest; Wand bei x>=20 (y 11..20); Stufe (1 Block) bei x in [5,6), y=11;
// Wasserbecken bei x in [-20,-10), y 11..15 (Boden darunter).
const isSolid = (x: number, y: number, z: number): boolean => {
  void z;
  if (y <= 10) return true;
  if (x >= 20 && y <= 20) return true;
  if (x >= 5 && x < 6 && y === 11) return true;
  return false;
};
const isFluid = (x: number, y: number): boolean => x >= -20 && x < -10 && y >= 11 && y <= 15;
const idle = { moveX: 0, moveZ: 0, yaw: 0, jump: false, sprint: false };

describe('Spielerphysik', () => {
  it('fällt auf den Boden und bleibt dort stehen', () => {
    const s = createPlayerState(0, 30, 0);
    for (let i = 0; i < 120; i++) stepPlayer(s, idle, 1 / 60, isSolid, isFluid);
    expect(s.onGround).toBe(true);
    expect(s.y).toBeCloseTo(11, 2);
    expect(s.vy).toBe(0);
    expect(collides(s.x, s.y, s.z, isSolid)).toBe(false);
  });

  it('läuft vorwärts und stoppt an der Wand', () => {
    const s = createPlayerState(0, 11.0001, 0);
    // yaw = -π/2 → Blick +x
    const input = { ...idle, moveZ: 1, yaw: -Math.PI / 2, sprint: true };
    for (let i = 0; i < 600; i++) stepPlayer(s, input, 1 / 60, isSolid, isFluid);
    expect(s.x).toBeLessThan(20);
    expect(s.x).toBeGreaterThan(19.5);
    expect(s.vx).toBe(0);
    expect(collides(s.x, s.y, s.z, isSolid)).toBe(false);
  });

  it('steigt automatisch eine Stufe von einem Block hoch', () => {
    const s = createPlayerState(2, 11.0001, 0);
    const input = { ...idle, moveZ: 1, yaw: -Math.PI / 2 };
    for (let i = 0; i < 180; i++) stepPlayer(s, input, 1 / 60, isSolid, isFluid);
    expect(s.x).toBeGreaterThan(6);
    expect(s.y).toBeGreaterThanOrEqual(11);
  });

  it('springt gut einen Block hoch', () => {
    const s = createPlayerState(0, 11.0001, 0);
    for (let i = 0; i < 5; i++) stepPlayer(s, idle, 1 / 60, isSolid, isFluid); // landen
    expect(s.onGround).toBe(true);
    let maxY = s.y;
    for (let i = 0; i < 90; i++) {
      stepPlayer(s, { ...idle, jump: i === 0 }, 1 / 60, isSolid, isFluid);
      maxY = Math.max(maxY, s.y);
    }
    expect(maxY - 11).toBeGreaterThan(1.1);
    expect(maxY - 11).toBeLessThan(1.6);
    expect(s.onGround).toBe(true);
  });

  it('sinkt im Wasser langsam und kann hochschwimmen', () => {
    const s = createPlayerState(-15, 14, 0);
    for (let i = 0; i < 60; i++) stepPlayer(s, idle, 1 / 60, isSolid, isFluid);
    expect(s.inWater).toBe(true);
    expect(s.vy).toBeGreaterThan(-3);
    expect(s.y).toBeGreaterThan(11);
    for (let i = 0; i < 60; i++) stepPlayer(s, { ...idle, jump: true }, 1 / 60, isSolid, isFluid);
    expect(s.y).toBeGreaterThan(14);
  });

  it('PLAYER-Konstanten sind plausibel', () => {
    expect(PLAYER.eyeHeight).toBeLessThan(PLAYER.height);
    expect(PLAYER.sprintSpeed).toBeGreaterThan(PLAYER.walkSpeed);
  });
});
