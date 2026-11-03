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
}

export interface MeshResponse {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  mesh: ChunkMesh;
  ms: number;
}
