import { BLOCK_STATE_SHIFT, BLOCK_TYPE_MASK, MAX_BLOCK_TYPES } from './constants.ts';

export const AIR = 0;

export type RGB = readonly [number, number, number];

/** Render-Pass eines Blocktyps. */
export const RenderPass = {
  None: 0,
  Opaque: 1,
  Cutout: 2,
  Fluid: 3,
} as const;
export type RenderPass = (typeof RenderPass)[keyof typeof RenderPass];

export interface BlockDef {
  /** Typ-ID 0–4095. */
  id: number;
  /** Technischer Name (ASCII, eindeutig). */
  name: string;
  /** Anzeigename (Deutsch). */
  label: string;
  colorTop: RGB;
  colorSide: RGB;
  colorBottom: RGB;
  /** Abbauzeit mit der Hand in Sekunden; -1 = unzerstörbar. */
  hardness: number;
  /** Blockiert Licht vollständig und verdeckt Nachbarflächen. */
  opaque: boolean;
  /** Kollision. */
  solid: boolean;
  /** Alpha-Test-Pass (Blätter, Gras). */
  cutout: boolean;
  /** Flüssigkeit (eigener Pass, abgesenkte Oberfläche). */
  fluid: boolean;
  /** Lichtemission RGB 0–15. */
  light: RGB;
  /** Lichtverlust je durchquertem Block (nur nicht-opake Blöcke). */
  attenuation: number;
  /** Material-Muster-ID 0–63 für den Fragment-Shader. */
  pattern: number;
}

export type BlockInput = Omit<
  BlockDef,
  | 'colorTop'
  | 'colorBottom'
  | 'hardness'
  | 'opaque'
  | 'solid'
  | 'cutout'
  | 'fluid'
  | 'light'
  | 'attenuation'
  | 'pattern'
> & {
  colorTop?: RGB;
  colorBottom?: RGB;
  hardness?: number;
  opaque?: boolean;
  solid?: boolean;
  cutout?: boolean;
  fluid?: boolean;
  light?: RGB;
  attenuation?: number;
  pattern?: number;
};

export function blockType(value: number): number {
  return value & BLOCK_TYPE_MASK;
}

export function blockState(value: number): number {
  return value >>> BLOCK_STATE_SHIFT;
}

export function makeBlock(type: number, state = 0): number {
  return (type & BLOCK_TYPE_MASK) | ((state & 0xf) << BLOCK_STATE_SHIFT);
}

/**
 * Registry aller Blocktypen. Hält zusätzlich flache Typed-Array-Tabellen,
 * damit Hot-Paths (Meshing, Licht) ohne Objektzugriffe auskommen.
 */
export class BlockRegistry {
  readonly defs: (BlockDef | undefined)[] = [];
  private readonly byName = new Map<string, BlockDef>();

  readonly opaque = new Uint8Array(MAX_BLOCK_TYPES);
  readonly solid = new Uint8Array(MAX_BLOCK_TYPES);
  readonly pass = new Uint8Array(MAX_BLOCK_TYPES);
  readonly attenuation = new Uint8Array(MAX_BLOCK_TYPES);
  readonly pattern = new Uint8Array(MAX_BLOCK_TYPES);
  /** Emission RGB als 3 Bytes je Typ. */
  readonly light = new Uint8Array(MAX_BLOCK_TYPES * 3);
  /** Farben als 3 Bytes je Typ und Seite. */
  readonly colorTop = new Uint8Array(MAX_BLOCK_TYPES * 3);
  readonly colorSide = new Uint8Array(MAX_BLOCK_TYPES * 3);
  readonly colorBottom = new Uint8Array(MAX_BLOCK_TYPES * 3);

  constructor() {
    this.register({
      id: AIR,
      name: 'air',
      label: 'Luft',
      colorSide: [0, 0, 0],
      opaque: false,
      solid: false,
      hardness: -1,
    });
  }

  register(input: BlockInput): BlockDef {
    const id = input.id;
    if (!Number.isInteger(id) || id < 0 || id >= MAX_BLOCK_TYPES) {
      throw new Error(`Ungültige Block-ID ${id} für ${input.name}`);
    }
    if (this.defs[id])
      throw new Error(`Block-ID ${id} ist bereits belegt (${this.defs[id]!.name})`);
    if (this.byName.has(input.name)) throw new Error(`Blockname ${input.name} ist bereits belegt`);

    const def: BlockDef = {
      id,
      name: input.name,
      label: input.label,
      colorTop: input.colorTop ?? input.colorSide,
      colorSide: input.colorSide,
      colorBottom: input.colorBottom ?? input.colorSide,
      hardness: input.hardness ?? 1,
      opaque: input.opaque ?? true,
      solid: input.solid ?? true,
      cutout: input.cutout ?? false,
      fluid: input.fluid ?? false,
      light: input.light ?? [0, 0, 0],
      attenuation: input.attenuation ?? 0,
      pattern: input.pattern ?? 0,
    };

    this.defs[id] = def;
    this.byName.set(def.name, def);

    this.opaque[id] = def.opaque ? 1 : 0;
    this.solid[id] = def.solid ? 1 : 0;
    this.pass[id] =
      id === AIR
        ? RenderPass.None
        : def.fluid
          ? RenderPass.Fluid
          : def.cutout
            ? RenderPass.Cutout
            : RenderPass.Opaque;
    this.attenuation[id] = def.attenuation;
    this.pattern[id] = def.pattern & 63;
    const o = id * 3;
    this.light[o] = def.light[0];
    this.light[o + 1] = def.light[1];
    this.light[o + 2] = def.light[2];
    for (let i = 0; i < 3; i++) {
      this.colorTop[o + i] = def.colorTop[i]!;
      this.colorSide[o + i] = def.colorSide[i]!;
      this.colorBottom[o + i] = def.colorBottom[i]!;
    }
    return def;
  }

  get(id: number): BlockDef {
    const def = this.defs[id];
    if (!def) throw new Error(`Unbekannter Block ${id}`);
    return def;
  }

  byNameOrThrow(name: string): BlockDef {
    const def = this.byName.get(name);
    if (!def) throw new Error(`Unbekannter Block ${name}`);
    return def;
  }

  has(id: number): boolean {
    return this.defs[id] !== undefined;
  }

  isEmissive(id: number): boolean {
    const o = id * 3;
    return (this.light[o] | this.light[o + 1] | this.light[o + 2]) !== 0;
  }

  get count(): number {
    return this.byName.size;
  }
}
