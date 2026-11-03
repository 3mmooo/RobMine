import {
  clamp,
  fbm2,
  lerp,
  type Noise2,
  type Noise3,
  noise2,
  noise3,
  ridged2,
  smoothstep,
} from '../../math/noise.ts';
import { splitSeed } from '../../math/rng.ts';
import { SEA_LEVEL } from '../../voxel/constants.ts';
import { Biome } from './biomes.ts';

/**
 * Terrain-Formen der Weltgen v1.
 *
 * Höhe je Spalte aus Klimafeldern:
 *   Kontinentalität (λ 2048 m) → Land/Meer und Grundhöhe
 *   Erosion         (λ 1024 m) → flach vs. zerklüftet
 *   Grate           (λ 256 m)  → Gebirgskämme (ridged)
 *   Detail          (λ 64 m)   → Hügel-Feinheit
 *
 * Höhlen aus 3D-Noise (Spaghetti + Käse), ausgewertet auf einem 9×9×9-Gitter
 * je Chunk und trilinear interpoliert.
 */
export interface ClimateSample {
  continent: number; // [-1, 1]
  erosion: number; // [-1, 1]
  ridges: number; // [0, 1]
  temperature: number; // [-1, 1]
  humidity: number; // [-1, 1]
}

export class Terrain {
  readonly seed: number;
  private readonly nContinent: Noise2;
  private readonly nErosion: Noise2;
  private readonly nRidges: Noise2;
  private readonly nDetail: Noise2;
  private readonly nTemp: Noise2;
  private readonly nHumid: Noise2;
  private readonly nWarpX: Noise2;
  private readonly nWarpZ: Noise2;
  readonly nCaveA: Noise3;
  readonly nCaveB: Noise3;
  readonly nCaveC: Noise3;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.nContinent = noise2(splitSeed(seed, 1));
    this.nErosion = noise2(splitSeed(seed, 2));
    this.nRidges = noise2(splitSeed(seed, 3));
    this.nDetail = noise2(splitSeed(seed, 4));
    this.nTemp = noise2(splitSeed(seed, 5));
    this.nHumid = noise2(splitSeed(seed, 6));
    this.nWarpX = noise2(splitSeed(seed, 7));
    this.nWarpZ = noise2(splitSeed(seed, 8));
    this.nCaveA = noise3(splitSeed(seed, 9));
    this.nCaveB = noise3(splitSeed(seed, 10));
    this.nCaveC = noise3(splitSeed(seed, 11));
  }

  climate(x: number, z: number): ClimateSample {
    // Domain-Warp (λ 256 m, ±24 m) gegen "Noise-Look".
    const wx = x + this.nWarpX(x / 256, z / 256) * 24;
    const wz = z + this.nWarpZ(x / 256 + 31.7, z / 256 - 17.3) * 24;
    return {
      continent: fbm2(this.nContinent, wx / 2048, wz / 2048, 4),
      erosion: fbm2(this.nErosion, wx / 1024, wz / 1024, 3),
      ridges: ridged2(this.nRidges, wx / 256, wz / 256, 3),
      temperature: fbm2(this.nTemp, wx / 1536, wz / 1536, 2),
      humidity: fbm2(this.nHumid, wx / 1200, wz / 1200, 2),
    };
  }

  /** Oberflächenhöhe (y des obersten festen Blocks) an Weltkoordinate (x, z). */
  heightAt(x: number, z: number): number {
    const c = this.climate(x, z);
    return this.heightFromClimate(x, z, c);
  }

  heightFromClimate(x: number, z: number, c: ClimateSample): number {
    const detail = fbm2(this.nDetail, x / 64, z / 64, 3);
    // Land-Anteil: < -0.3 tiefes Meer, > 0.05 sicher Land.
    const land = smoothstep(-0.3, 0.05, c.continent);
    // Grundhöhe: Meeresboden ~ y 34, Küste ~ 62, Inland ~ 72.
    const base = lerp(34, 72, land) + Math.max(0, c.continent) * 10;
    // Erosion: -1 zerklüftet, +1 flach.
    const flat = smoothstep(-0.6, 0.6, c.erosion);
    const mountain = (1 - flat) * (1 - flat) * land;
    const ridgeHeight = c.ridges * 95;
    const hills = detail * (4 + 10 * (1 - flat)) * land;
    const h = base + mountain * ridgeHeight + hills + (1 - land) * detail * 3;
    return clamp(Math.round(h), 1, 250);
  }

  /** Oberflächen-Biom nach Höhe und Klima (Phase 0: drei Biome). */
  biomeAt(height: number, c: ClimateSample): Biome {
    if (height < SEA_LEVEL - 2) return Biome.Sternenmeer;
    if (height <= SEA_LEVEL + 2) return Biome.Perlkueste;
    void c;
    return Biome.Hainland;
  }
}

/** Käse-/Spaghetti-Höhlentest aus drei interpolierten Noise-Werten. */
export function isCave(a: number, b: number, cheese: number, y: number): boolean {
  if (y < 6) return false;
  if (Math.abs(a) < 0.075 && Math.abs(b) < 0.075) return true; // Spaghetti
  return y < 48 && cheese > 0.62; // Käse
}
