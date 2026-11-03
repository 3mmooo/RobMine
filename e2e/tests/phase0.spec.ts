import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const SCREENSHOT = resolve(import.meta.dirname, '../screenshots/phase0-hainland.png');
// Deterministische Szene: Seed 42, 10:00 Uhr, feste Kamera, Stufe Niedrig (SwiftShader), Radius 6.
const DET_URL = '/?seed=42&det=1&t=600&quality=low&radius=6&cam=12,118,20,-0.65,-0.42&debug=1';

interface RmStats {
  drawCalls: number;
  triangles: number;
  geometries: number;
  chunks: Record<string, number>;
}

async function waitReady(page: Page, timeoutMs = 150_000): Promise<void> {
  await page.waitForFunction(() => window.__rm?.ready === true, undefined, {
    timeout: timeoutMs,
    polling: 250,
  });
}

async function stats(page: Page): Promise<RmStats> {
  return page.evaluate(() => window.__rm!.stats() as unknown as RmStats);
}

test.describe('Phase 0 – Hainland', () => {
  test('lädt, mesht ≥ 150 Chunks, rendert ohne Fehler und hält die Budgets', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.goto(DET_URL);
    await waitReady(page);

    const s = await stats(page);
    expect(s.chunks['chunksMeshed']).toBeGreaterThanOrEqual(150);
    expect(s.chunks['columnsLoaded']).toBeGreaterThanOrEqual(100);
    expect(s.chunks['overflow']).toBe(0);
    expect(s.chunks['retries']).toBe(0);
    // Plausibilitäts-Grenzen (im Worker gemessen; die harten Budgets prüft `pnpm bench` ohne
    // CPU-Konkurrenz durch SwiftShader und sechs parallele Worker).
    expect(s.chunks['genMsAvg']! / 8).toBeLessThanOrEqual(5);
    expect(s.chunks['meshMsAvg']).toBeLessThanOrEqual(12);
    // Draw Calls: Batch-Seiten + Himmel (+ Schattenpässe bei Mittel/Hoch) – hier ohne Schatten
    expect(s.drawCalls).toBeLessThanOrEqual(20);
    expect(s.triangles).toBeGreaterThan(50_000);

    mkdirSync(dirname(SCREENSHOT), { recursive: true });
    await page.waitForTimeout(500);
    const png = await page.screenshot({ path: SCREENSHOT, fullPage: false });

    // Pixel-Stichprobe: mindestens 30 % der Pixel sind nicht Himmelsfarbe.
    const nonSky = await page.evaluate(() => {
      const canvas = document.getElementById('game') as HTMLCanvasElement;
      const probe = document.createElement('canvas');
      probe.width = 160;
      probe.height = 90;
      const ctx = probe.getContext('2d')!;
      window.__rm!.renderOnce();
      ctx.drawImage(canvas, 0, 0, probe.width, probe.height);
      const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      for (let x = 0; x < probe.width; x++) {
        sr += data[x * 4]!;
        sg += data[x * 4 + 1]!;
        sb += data[x * 4 + 2]!;
      }
      sr /= probe.width;
      sg /= probe.width;
      sb /= probe.width;
      let non = 0;
      const total = probe.width * probe.height;
      for (let i = 0; i < total; i++) {
        const dr = data[i * 4]! - sr;
        const dg = data[i * 4 + 1]! - sg;
        const db = data[i * 4 + 2]! - sb;
        if (dr * dr + dg * dg + db * db > 40 * 40) non++;
      }
      return non / total;
    });
    expect(png.length).toBeGreaterThan(10_000);
    expect(nonSky).toBeGreaterThanOrEqual(0.3);

    const api = await page.evaluate(() => ({
      errors: window.__rm!.errors,
      frames: window.__rm!.frames,
    }));
    expect(api.frames).toBeGreaterThan(10);
    expect(api.errors).toEqual([]);
    expect(consoleErrors.filter((e) => !e.includes('WEBGL_debug_renderer_info'))).toEqual([]);
  });

  test('Teleport während des Ladens und zurück lässt keine Geometrien oder Chunks liegen (Leak-Check)', async ({
    page,
  }) => {
    await page.goto('/?seed=42&det=1&t=600&quality=low&radius=5&cam=12,118,20,-0.65,-0.42');
    // Sofort nach dem Start (mitten im Laden) weit weg teleportieren …
    await page.waitForFunction(() => window.__rm !== undefined, undefined, { timeout: 60_000 });
    await page.evaluate(() => window.__rm!.teleport(12 + 600, 118, 20));
    await waitReady(page);
    const far = await stats(page);
    expect(far.chunks['chunksVisible']).toBeGreaterThan(0);

    // … und zurück: Referenzwerte am Ursprung.
    await page.evaluate(() => window.__rm!.teleport(12, 118, 20));
    await waitReady(page);
    const before = await stats(page);

    await page.evaluate(() => window.__rm!.teleport(12 + 600, 118, 20));
    await waitReady(page);
    await page.evaluate(() => window.__rm!.teleport(12, 118, 20));
    await waitReady(page);
    const after = await stats(page);

    // BatchedMesh-Seiten halten konstante GPU-Puffer; Geometrien dürfen nicht wachsen.
    expect(after.geometries).toBeLessThanOrEqual(before.geometries + 2);
    expect(after.chunks['chunksVisible']).toBe(before.chunks['chunksVisible']);
    expect(after.chunks['overflow']).toBe(0);
  });
});
