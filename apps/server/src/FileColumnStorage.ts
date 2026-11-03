import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ColumnStorage } from '@robmine/sim';

/**
 * Speichert veränderte Spalten als Dateien `<dir>/c_<cx>_<cz>.bin`
 * (u8 n · n × (u32 len · Blob)). Atomar über temporäre Datei + rename.
 * Keine native Abhängigkeit – SQLite folgt, wenn es Konten gibt.
 */
export class FileColumnStorage implements ColumnStorage {
  private readonly dir: string;
  private ready: Promise<void>;

  constructor(dir: string) {
    this.dir = dir;
    this.ready = mkdir(dir, { recursive: true }).then(() => undefined);
  }

  private file(cx: number, cz: number): string {
    return join(this.dir, `c_${cx}_${cz}.bin`);
  }

  async load(cx: number, cz: number): Promise<Uint8Array[] | null> {
    await this.ready;
    let buf: Buffer;
    try {
      buf = await readFile(this.file(cx, cz));
    } catch {
      return null;
    }
    const blobs: Uint8Array[] = [];
    let o = 0;
    const n = buf[o++] ?? 0;
    for (let i = 0; i < n; i++) {
      const len = buf.readUInt32LE(o);
      o += 4;
      blobs.push(new Uint8Array(buf.subarray(o, o + len)));
      o += len;
    }
    return blobs;
  }

  async save(cx: number, cz: number, blobs: Uint8Array[]): Promise<void> {
    await this.ready;
    const size = 1 + blobs.reduce((s, b) => s + 4 + b.length, 0);
    const out = Buffer.alloc(size);
    let o = 0;
    out[o++] = blobs.length;
    for (const b of blobs) {
      out.writeUInt32LE(b.length, o);
      o += 4;
      out.set(b, o);
      o += b.length;
    }
    const target = this.file(cx, cz);
    const tmp = `${target}.tmp`;
    await writeFile(tmp, out);
    await rename(tmp, target);
  }

  async keys(): Promise<[number, number][]> {
    await this.ready;
    const files = await readdir(this.dir);
    const out: [number, number][] = [];
    for (const f of files) {
      const m = /^c_(-?\d+)_(-?\d+)\.bin$/.exec(f);
      if (m) out.push([Number(m[1]), Number(m[2])]);
    }
    return out;
  }
}
