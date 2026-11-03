import type { ChunkMesh } from '@robmine/core';

/** Serialisierte Spalte (Transfer Worker → Main). */
export interface ColumnPayload {
  cx: number;
  cz: number;
  height: Uint8Array;
  biome: Uint8Array;
  chunks: {
    uniformBlock: number;
    uniformLight: number;
    blocks: Uint16Array | null;
    light: Uint16Array | null;
  }[];
}

export interface GenRequest {
  seed: number;
  cx: number;
  cz: number;
  /** Bit cy gesetzt = Chunk unverändert (aus dem Seed erzeugen); sonst Blob aus `chunks`. */
  pristineMask: number;
  /** Veränderte Chunks vom Server (RMC1-Blobs), werden im Worker dekodiert. */
  chunks: { cy: number; blob: Uint8Array }[];
}

export interface GenResponse {
  column: ColumnPayload;
  /** Millisekunden für Weltgen + Licht im Worker. */
  ms: number;
  genMs: number;
  lightMs: number;
}

export interface MeshRequest {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  blocks: Uint16Array; // 34³
  light: Uint16Array; // 34³
  /** Oberflächenhöhe je (x,z) der Spalte (Wassertiefe). */
  height: Uint8Array;
  /** Welt-y der untersten Lage des Chunks. */
  baseY: number;
}

export interface MeshResponse {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  mesh: ChunkMesh;
  ms: number;
}
