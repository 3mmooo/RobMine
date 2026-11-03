/**
 * Lichtwert (u16): Bits 0–3 Rot, 4–7 Grün, 8–11 Blau (farbiges Blocklicht),
 * Bits 12–15 Himmelslicht. Jeder Kanal 0–15.
 */
export function packLight(r: number, g: number, b: number, sky: number): number {
  return (r & 15) | ((g & 15) << 4) | ((b & 15) << 8) | ((sky & 15) << 12);
}

export function lightR(v: number): number {
  return v & 15;
}
export function lightG(v: number): number {
  return (v >>> 4) & 15;
}
export function lightB(v: number): number {
  return (v >>> 8) & 15;
}
export function lightSky(v: number): number {
  return (v >>> 12) & 15;
}

export function withSky(v: number, sky: number): number {
  return (v & 0x0fff) | ((sky & 15) << 12);
}

export function withBlockLight(v: number, r: number, g: number, b: number): number {
  return (v & 0xf000) | (r & 15) | ((g & 15) << 4) | ((b & 15) << 8);
}

export const LIGHT_BLOCK_MASK = 0x0fff;
export const LIGHT_SKY_MASK = 0xf000;
