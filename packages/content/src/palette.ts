import type { RGB } from '@robmine/core';

/**
 * Farbwelt „Dämmerung & Laterne" – alle Farb-Tokens des Spiels an einem Ort.
 * Blöcke haben mittlere Sättigung; Kontrast kommt aus Licht, Schatten und AO.
 */
export const PALETTE = {
  // Himmel & Licht
  skyMorning: '#FFB88C',
  skyNoonZenith: '#4A8FE0',
  skyNoonHorizon: '#DCEFFF',
  skyEvening: '#FF7E6B',
  skyEveningUpper: '#5B4B8A',
  skyNight: '#1B1F3B',
  sunNoon: '#FFE9C4',
  sunEvening: '#FF9A5C',
  shadowAmbient: '#6E7FB8',
  moonLight: '#9FB4FF',
  lanternAmber: '#FFB347',
  glimmerCyan: '#7CF5FF',

  // Blöcke
  grassTop: '#79C877',
  grassSide: '#5FA862',
  dirt: '#8C6A45',
  stone: '#9AA3AD',
  stoneDark: '#6F7781',
  sand: '#F2DDA4',
  gravel: '#A7A9A3',
  water: '#3FA7D6',
  waterDeep: '#1F5F8B',
  log: '#9B6B43',
  logEnd: '#C49A6C',
  leaves: '#55B05C',
  forestGrassTop: '#4E9A52',
  forestGrassSide: '#3F7F45',
  blossomGrassTop: '#9BD47A',
  blossomGrassSide: '#78B65E',
  blossomLeaves: '#F2A0C8',
  needleLeaves: '#3E7D5A',
  moorGrassTop: '#7A8B4A',
  moorGrassSide: '#5F6E3A',
  ash: '#5E5A5C',
  basalt: '#3A363C',
  snow: '#F4F9FF',
  ice: '#BFE8FF',
  bedrock: '#2E3138',
  torch: '#FFB347',
  torchWood: '#8A5A3B',
  glass: '#DCEFF5',
  ambrit: '#F2C14E',
  crystal: '#B693FF',

  // UI
  paper: '#F6EEDC',
  glassDark: 'rgba(20,24,40,.6)',
  accent: '#FFB347',
} as const;

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function hexToUnit(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  return [r / 255, g / 255, b / 255];
}
