/**
 * Nachrichten des Binärprotokolls (Phase 0: Verbindungsaufbau + Chunk-Streaming).
 *
 * Rahmen: u8 ver · u16 tick · u8 n · n × ( u8 op · u32 len · payload ), Little Endian.
 * Opcodes < 0x80 Client → Server, ≥ 0x80 Server → Client.
 */
export const PROTOCOL_VERSION = 1;

export const Op = {
  Hello: 0x01,
  BlockAction: 0x03,
  Ping: 0x07,
  ChunkRequest: 0x10,
  Welcome: 0x80,
  ChunkColumn: 0x81,
  BlockUpdate: 0x83,
  Pong: 0x89,
  Kick: 0x8d,
} as const;

export const BlockActionKind = { Break: 0, Place: 1 } as const;

export interface BlockActionMsg {
  op: 'BlockAction';
  kind: number;
  x: number;
  y: number;
  z: number;
  /** Zu setzender Blockwert (bei Break 0). */
  block: number;
}

export interface BlockUpdateMsg {
  op: 'BlockUpdate';
  updates: { x: number; y: number; z: number; block: number }[];
}
export type Op = (typeof Op)[keyof typeof Op];

export interface HelloMsg {
  op: 'Hello';
  protoVer: number;
  token: string;
  clientBuild: string;
}

export interface PingMsg {
  op: 'Ping';
  clientTime: number;
}

export interface ChunkRequestMsg {
  op: 'ChunkRequest';
  cx: number;
  cz: number;
}

export interface WelcomeMsg {
  op: 'Welcome';
  playerId: number;
  worldSeed: number;
  worldgenVersion: number;
  spawn: [number, number, number];
  /** Tageszeit in Sekunden des 24-Minuten-Zyklus (0–1440). */
  timeOfDay: number;
  /** 0 Solo, 1 Lagerfeuer, 2 Scherbe, 3 Hub */
  mode: number;
}

export interface ChunkColumnMsg {
  op: 'ChunkColumn';
  cx: number;
  cz: number;
  /** Bit cy gesetzt = Chunk ist unverändert (Client erzeugt ihn selbst aus dem Seed). */
  pristineMask: number;
  chunks: { cy: number; blob: Uint8Array }[];
}

export interface PongMsg {
  op: 'Pong';
  clientTime: number;
  serverTick: number;
}

export interface KickMsg {
  op: 'Kick';
  reason: string;
}

export type ClientMessage = HelloMsg | PingMsg | ChunkRequestMsg | BlockActionMsg;
export type ServerMessage = WelcomeMsg | ChunkColumnMsg | BlockUpdateMsg | PongMsg | KickMsg;
export type Message = ClientMessage | ServerMessage;

export interface Frame {
  version: number;
  tick: number;
  messages: Message[];
}
