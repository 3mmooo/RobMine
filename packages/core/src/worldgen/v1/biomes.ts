/**
 * Biom-IDs der Weltgen v1. Phase 0 nutzt Hainland, Perlküste und Sternenmeer;
 * die übrigen IDs sind reserviert, damit sich gespeicherte Welten später nicht ändern.
 */
export const Biome = {
  Hainland: 0,
  Fluesterwald: 1,
  Bluetental: 2,
  Glasduenen: 3,
  Nebelmoor: 4,
  Frostkamm: 5,
  Himmelsgrat: 6,
  Sternenmeer: 7,
  Perlkueste: 8,
  Aschenfeld: 9,
  Wurzelhoehlen: 10,
  Kristallschlund: 11,
  Glutkluft: 12,
  Schwebeinseln: 13,
  Ascheland: 14,
} as const;
export type Biome = (typeof Biome)[keyof typeof Biome];

export const BIOME_NAMES: Record<Biome, string> = {
  [Biome.Hainland]: 'Hainland',
  [Biome.Fluesterwald]: 'Flüsterwald',
  [Biome.Bluetental]: 'Blütental',
  [Biome.Glasduenen]: 'Glasdünen',
  [Biome.Nebelmoor]: 'Nebelmoor',
  [Biome.Frostkamm]: 'Frostkamm',
  [Biome.Himmelsgrat]: 'Himmelsgrat',
  [Biome.Sternenmeer]: 'Sternenmeer',
  [Biome.Perlkueste]: 'Perlküste',
  [Biome.Aschenfeld]: 'Aschenfeld',
  [Biome.Wurzelhoehlen]: 'Wurzelhöhlen',
  [Biome.Kristallschlund]: 'Kristallschlund',
  [Biome.Glutkluft]: 'Glutkluft',
  [Biome.Schwebeinseln]: 'Schwebeinseln',
  [Biome.Ascheland]: 'Ascheland',
};
