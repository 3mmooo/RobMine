import { ByteReader, ByteWriter } from './bytes.ts';
import { type Frame, type Message, Op, PROTOCOL_VERSION } from './messages.ts';

/** Maximale Rahmengröße (Server-Schutz): 2 MB. */
export const MAX_FRAME_BYTES = 2 * 1024 * 1024;

export function encodeMessage(w: ByteWriter, m: Message): void {
  switch (m.op) {
    case 'Hello':
      w.u8(Op.Hello);
      {
        const at = w.length;
        w.u32(0);
        const start = w.length;
        w.u16(m.protoVer).str(m.token).str(m.clientBuild).str(m.name).str(m.avatar);
        w.patchU32(at, w.length - start);
      }
      break;
    case 'SetAvatar':
      w.u8(Op.SetAvatar);
      {
        const at = w.length;
        w.u32(0);
        const start = w.length;
        w.str(m.avatar);
        w.patchU32(at, w.length - start);
      }
      break;
    case 'Ping':
      w.u8(Op.Ping).u32(4).u32(m.clientTime);
      break;
    case 'PlayerMove':
      w.u8(Op.PlayerMove).u32(20).f32(m.x).f32(m.y).f32(m.z).f32(m.yaw).f32(m.pitch);
      break;
    case 'Chat':
      w.u8(Op.Chat);
      {
        const at = w.length;
        w.u32(0);
        const start = w.length;
        w.str(m.text);
        w.patchU32(at, w.length - start);
      }
      break;
    case 'Players':
      w.u8(Op.Players)
        .u32(2 + m.players.length * 22)
        .u16(m.players.length);
      for (const p of m.players) w.u16(p.id).f32(p.x).f32(p.y).f32(p.z).f32(p.yaw).f32(p.pitch);
      break;
    case 'PlayerJoin':
      w.u8(Op.PlayerJoin);
      {
        const at = w.length;
        w.u32(0);
        const start = w.length;
        w.u16(m.id).str(m.name).str(m.avatar);
        w.patchU32(at, w.length - start);
      }
      break;
    case 'PlayerLeave':
      w.u8(Op.PlayerLeave).u32(2).u16(m.id);
      break;
    case 'ChatMessage':
      w.u8(Op.ChatMessage);
      {
        const at = w.length;
        w.u32(0);
        const start = w.length;
        w.u16(m.from).str(m.name).str(m.text);
        w.patchU32(at, w.length - start);
      }
      break;
    case 'ChunkRequest':
      w.u8(Op.ChunkRequest).u32(8).i32(m.cx).i32(m.cz);
      break;
    case 'BlockAction':
      w.u8(Op.BlockAction).u32(13).u8(m.kind).i32(m.x).i16(m.y).i32(m.z).u16(m.block);
      break;
    case 'BlockUpdate':
      w.u8(Op.BlockUpdate);
      {
        const at = w.length;
        w.u32(0);
        const start = w.length;
        w.u16(m.updates.length);
        for (const u of m.updates) w.i32(u.x).i16(u.y).i32(u.z).u16(u.block);
        w.patchU32(at, w.length - start);
      }
      break;
    case 'Welcome':
      w.u8(Op.Welcome);
      {
        const at = w.length;
        w.u32(0);
        const start = w.length;
        w.u16(m.playerId)
          .u32(m.worldSeed)
          .u16(m.worldgenVersion)
          .f64(m.spawn[0])
          .f64(m.spawn[1])
          .f64(m.spawn[2])
          .u16(m.timeOfDay)
          .u8(m.mode)
          .str(m.world)
          .u8(m.flags)
          .str(m.name);
        w.patchU32(at, w.length - start);
      }
      break;
    case 'ChunkColumn':
      w.u8(Op.ChunkColumn);
      {
        const at = w.length;
        w.u32(0);
        const start = w.length;
        w.i32(m.cx).i32(m.cz).u8(m.pristineMask).u8(m.chunks.length);
        for (const c of m.chunks) w.u8(c.cy).bytes(c.blob);
        w.patchU32(at, w.length - start);
      }
      break;
    case 'Pong':
      w.u8(Op.Pong).u32(8).u32(m.clientTime).u32(m.serverTick);
      break;
    case 'Kick':
      w.u8(Op.Kick);
      {
        const at = w.length;
        w.u32(0);
        const start = w.length;
        w.str(m.reason);
        w.patchU32(at, w.length - start);
      }
      break;
    default: {
      const never: never = m;
      throw new Error(`Unbekannte Nachricht ${String(never)}`);
    }
  }
}

export function decodeMessage(r: ByteReader): Message {
  const op = r.u8();
  const len = r.u32();
  const end = r.offset + len;
  let msg: Message;
  switch (op) {
    case Op.Hello:
      msg = {
        op: 'Hello',
        protoVer: r.u16(),
        token: r.str(),
        clientBuild: r.str(),
        name: r.str(),
        avatar: r.str(),
      };
      break;
    case Op.SetAvatar:
      msg = { op: 'SetAvatar', avatar: r.str() };
      break;
    case Op.Ping:
      msg = { op: 'Ping', clientTime: r.u32() };
      break;
    case Op.PlayerMove:
      msg = { op: 'PlayerMove', x: r.f32(), y: r.f32(), z: r.f32(), yaw: r.f32(), pitch: r.f32() };
      break;
    case Op.Chat:
      msg = { op: 'Chat', text: r.str() };
      break;
    case Op.Players: {
      const n = r.u16();
      const players = [];
      for (let i = 0; i < n; i++)
        players.push({
          id: r.u16(),
          x: r.f32(),
          y: r.f32(),
          z: r.f32(),
          yaw: r.f32(),
          pitch: r.f32(),
        });
      msg = { op: 'Players', players };
      break;
    }
    case Op.PlayerJoin:
      msg = { op: 'PlayerJoin', id: r.u16(), name: r.str(), avatar: r.str() };
      break;
    case Op.PlayerLeave:
      msg = { op: 'PlayerLeave', id: r.u16() };
      break;
    case Op.ChatMessage:
      msg = { op: 'ChatMessage', from: r.u16(), name: r.str(), text: r.str() };
      break;
    case Op.ChunkRequest:
      msg = { op: 'ChunkRequest', cx: r.i32(), cz: r.i32() };
      break;
    case Op.BlockAction:
      msg = { op: 'BlockAction', kind: r.u8(), x: r.i32(), y: r.i16(), z: r.i32(), block: r.u16() };
      break;
    case Op.BlockUpdate: {
      const n = r.u16();
      const updates: { x: number; y: number; z: number; block: number }[] = [];
      for (let i = 0; i < n; i++)
        updates.push({ x: r.i32(), y: r.i16(), z: r.i32(), block: r.u16() });
      msg = { op: 'BlockUpdate', updates };
      break;
    }
    case Op.Welcome:
      msg = {
        op: 'Welcome',
        playerId: r.u16(),
        worldSeed: r.u32(),
        worldgenVersion: r.u16(),
        spawn: [r.f64(), r.f64(), r.f64()],
        timeOfDay: r.u16(),
        mode: r.u8(),
        world: r.str(),
        flags: r.u8(),
        name: r.str(),
      };
      break;
    case Op.ChunkColumn: {
      const cx = r.i32();
      const cz = r.i32();
      const pristineMask = r.u8();
      const n = r.u8();
      const chunks: { cy: number; blob: Uint8Array }[] = [];
      for (let i = 0; i < n; i++) chunks.push({ cy: r.u8(), blob: r.bytes() });
      msg = { op: 'ChunkColumn', cx, cz, pristineMask, chunks };
      break;
    }
    case Op.Pong:
      msg = { op: 'Pong', clientTime: r.u32(), serverTick: r.u32() };
      break;
    case Op.Kick:
      msg = { op: 'Kick', reason: r.str() };
      break;
    default:
      throw new Error(`Unbekannter Opcode 0x${op.toString(16)}`);
  }
  if (r.offset !== end) throw new Error(`Längenfehler bei Opcode 0x${op.toString(16)}`);
  return msg;
}

export function encodeFrame(tick: number, messages: readonly Message[]): Uint8Array {
  if (messages.length > 255) throw new Error('Zu viele Nachrichten in einem Rahmen');
  const w = new ByteWriter(512);
  w.u8(PROTOCOL_VERSION)
    .u16(tick & 0xffff)
    .u8(messages.length);
  for (const m of messages) encodeMessage(w, m);
  return w.toUint8Array();
}

/** Sender-seitiges Byte-Budget je Rahmen (Empfänger erlaubt MAX_FRAME_BYTES). */
export const FRAME_BYTE_BUDGET = 1024 * 1024;

/**
 * Teilt Nachrichten in Rahmen auf: höchstens 255 Nachrichten und – sobald mindestens eine
 * Nachricht drin ist – höchstens `maxBytes` je Rahmen. Eine einzelne übergroße Nachricht
 * bekommt einen eigenen Rahmen.
 */
export function encodeFrames(
  tick: number,
  messages: readonly Message[],
  maxBytes = FRAME_BYTE_BUDGET,
): Uint8Array[] {
  const frames: Uint8Array[] = [];
  let w: ByteWriter | null = null;
  let count = 0;
  const finish = (): void => {
    if (!w || count === 0) return;
    const out = w.toUint8Array();
    out[3] = count;
    frames.push(out);
    w = null;
    count = 0;
  };
  for (const m of messages) {
    const tmp = new ByteWriter(256);
    encodeMessage(tmp, m);
    const bytes = tmp.toUint8Array();
    if (w && (count >= 255 || w.length + bytes.length > maxBytes)) finish();
    if (!w)
      w = new ByteWriter(512)
        .u8(PROTOCOL_VERSION)
        .u16(tick & 0xffff)
        .u8(0);
    w.raw(bytes);
    count++;
  }
  finish();
  return frames;
}

export function decodeFrame(data: Uint8Array): Frame {
  if (data.length > MAX_FRAME_BYTES) throw new Error('Rahmen zu groß');
  const r = new ByteReader(data);
  const version = r.u8();
  if (version !== PROTOCOL_VERSION)
    throw new Error(`Protokollversion ${version} wird nicht unterstützt`);
  const tick = r.u16();
  const n = r.u8();
  const messages: Message[] = [];
  for (let i = 0; i < n; i++) messages.push(decodeMessage(r));
  if (r.remaining !== 0) throw new Error('Rahmen enthält überzählige Bytes');
  return { version, tick, messages };
}
