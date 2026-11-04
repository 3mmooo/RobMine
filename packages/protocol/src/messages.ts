/**
 * Nachrichten des Binärprotokolls (Phase 0: Verbindungsaufbau + Chunk-Streaming).
 *
 * Rahmen: u8 ver · u16 tick · u8 n · n × ( u8 op · u32 len · payload ), Little Endian.
 * Opcodes < 0x80 Client → Server, ≥ 0x80 Server → Client.
 */
export const PROTOCOL_VERSION = 3;

export const Op = {
  Hello: 0x01,
  PlayerMove: 0x02,
  BlockAction: 0x03,
  Chat: 0x05,
  SetAvatar: 0x06,
  Ping: 0x07,
  ChunkRequest: 0x10,
  Welcome: 0x80,
  ChunkColumn: 0x81,
  BlockUpdate: 0x83,
  Players: 0x84,
  PlayerJoin: 0x85,
  PlayerLeave: 0x86,
  ChatMessage: 0x87,
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
  /** Anzeigename (wird vom Server bereinigt; mit gültigem Konto-Token zählt der Kontoname). */
  name: string;
  /** Avatar-Code (siehe @robmine/content avatar.ts). */
  avatar: string;
}

/** Avatar geändert (C→S); der Server verteilt ihn als PlayerJoin neu. */
export interface SetAvatarMsg {
  op: 'SetAvatar';
  avatar: string;
}

/** Eigene Position/Blickrichtung (C→S, ~15 Hz). y = Fußpunkt. */
export interface PlayerMoveMsg {
  op: 'PlayerMove';
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface ChatMsg {
  op: 'Chat';
  text: string;
}

export interface PlayerSnapshot {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

/** Positionen der anderen Spieler in Reichweite (S→C, 20 Hz). */
export interface PlayersMsg {
  op: 'Players';
  players: PlayerSnapshot[];
}

export interface PlayerJoinMsg {
  op: 'PlayerJoin';
  id: number;
  name: string;
  avatar: string;
}

export interface PlayerLeaveMsg {
  op: 'PlayerLeave';
  id: number;
}

export interface ChatMessageMsg {
  op: 'ChatMessage';
  /** 0 = System. */
  from: number;
  name: string;
  text: string;
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
  /** Welt-ID: 'welt' (Dämmerlande) oder 'hafen' (Laternenhafen). */
  world: string;
  /** Bit 0 Sicherer Chat (nur Satzbausteine), Bit 1 angemeldet, Bit 2 Bauen erlaubt. */
  flags: number;
  /** Endgültiger Anzeigename. */
  name: string;
}

export const WelcomeFlag = { SafeChat: 1, LoggedIn: 2, CanBuild: 4 } as const;

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

export type ClientMessage =
  HelloMsg | PingMsg | ChunkRequestMsg | BlockActionMsg | PlayerMoveMsg | ChatMsg | SetAvatarMsg;
export type ServerMessage =
  | WelcomeMsg
  | ChunkColumnMsg
  | BlockUpdateMsg
  | PongMsg
  | KickMsg
  | PlayersMsg
  | PlayerJoinMsg
  | PlayerLeaveMsg
  | ChatMessageMsg;
export type Message = ClientMessage | ServerMessage;

export interface Frame {
  version: number;
  tick: number;
  messages: Message[];
}
