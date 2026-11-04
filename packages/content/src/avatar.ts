/**
 * Avatar-Code: 6 Zeichen (Basis 36), je ein Index in die Listen unten –
 * Haut · Frisur · Haarfarbe · Oberteil · Hose · Hut. Kompakt genug fürs Protokoll,
 * ungültige Codes werden auf gültige Werte zurückgesetzt.
 */
export const AVATAR_PARTS = {
  skin: ['#F6D7C3', '#F2C9A0', '#D9A066', '#A86B3C', '#8C5A3C', '#6B4423'],
  hair: ['Keine', 'Kurz', 'Lang', 'Strubbel', 'Zopf'],
  hairColor: [
    '#2B2118',
    '#5A3A22',
    '#A0662F',
    '#E3B45A',
    '#F4E6C8',
    '#C8452F',
    '#6C5CE7',
    '#3FB6A8',
  ],
  shirt: [
    '#3FA7D6',
    '#E4572E',
    '#76B041',
    '#FFC914',
    '#9B5DE5',
    '#F15BB5',
    '#00BBF9',
    '#FF924C',
    '#EDEDED',
    '#2D2D3A',
  ],
  pants: ['#2E4057', '#3D3B30', '#4A3C5C', '#264653', '#7A5C3E', '#5C6B73'],
  hat: ['Keiner', 'Mütze', 'Schirmkappe', 'Laternenhut'],
} as const;

export type AvatarPart = keyof typeof AVATAR_PARTS;
export const AVATAR_ORDER: readonly AvatarPart[] = [
  'skin',
  'hair',
  'hairColor',
  'shirt',
  'pants',
  'hat',
];
export const AVATAR_LABELS: Record<AvatarPart, string> = {
  skin: 'Haut',
  hair: 'Frisur',
  hairColor: 'Haarfarbe',
  shirt: 'Oberteil',
  pants: 'Hose',
  hat: 'Hut',
};

export type Avatar = Record<AvatarPart, number>;

export function decodeAvatar(code: string): Avatar {
  const out = {} as Avatar;
  AVATAR_ORDER.forEach((part, i) => {
    const v = parseInt(code[i] ?? '0', 36);
    const n = AVATAR_PARTS[part].length;
    out[part] = Number.isFinite(v) && v >= 0 && v < n ? v : 0;
  });
  return out;
}

export function encodeAvatar(a: Avatar): string {
  return AVATAR_ORDER.map((p) => (a[p] % AVATAR_PARTS[p].length).toString(36)).join('');
}

/** Bereinigt einen Avatar-Code (Server-Validierung). */
export function normalizeAvatar(code: string): string {
  return encodeAvatar(decodeAvatar(typeof code === 'string' ? code.slice(0, 6) : ''));
}

/** Zufälliger, aber für eine Zahl stabiler Avatar (Gäste ohne Auswahl). */
export function avatarFromNumber(n: number): string {
  let h = (n * 2654435761) >>> 0;
  const a = {} as Avatar;
  for (const p of AVATAR_ORDER) {
    a[p] = h % AVATAR_PARTS[p].length;
    h = Math.floor(h / 7) + 0x9e37;
  }
  return encodeAvatar(a);
}
