/**
 * Snapshot: lädt eine Client-URL im echten Chromium (headless, SwiftShader), sammelt Konsole,
 * Fehler und Statistik (window.__rm) und speichert einen Screenshot.
 *
 *   node tools/src/snapshot.ts [url] [--wait 60000] [--out tools/out/snapshot.png] [--width 1280] [--height 720]
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from '@playwright/test';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const positional = process.argv
  .slice(2)
  .filter((a, i, all) => !a.startsWith('--') && !(all[i - 1] ?? '').startsWith('--'));
const url =
  positional[0] ??
  'http://127.0.0.1:4173/?seed=42&det=1&t=600&quality=low&radius=6&cam=12,92,20,-0.65,-0.28&debug=1';
const waitMs = Number(arg('wait', '90000'));
const out = arg('out', 'tools/out/snapshot.png');
const width = Number(arg('width', '1280'));
const height = Number(arg('height', '720'));

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width, height } });
page.on('console', (m) => {
  const limit = m.type() === 'error' ? 20_000 : 600;
  console.log(`[console.${m.type()}] ${m.text().slice(0, limit)}`);
});
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) =>
  console.log(`[requestfailed] ${r.url()} ${r.failure()?.errorText ?? ''}`),
);

await page.goto(url);
const t0 = Date.now();
let last = '';
let ready = false;
while (Date.now() - t0 < waitMs) {
  await page.waitForTimeout(1500);
  const s = await page.evaluate(() => {
    const api = (
      window as unknown as {
        __rm?: {
          ready: boolean;
          frames: number;
          errors: string[];
          stats: () => Record<string, unknown>;
        };
      }
    ).__rm;
    if (!api) return 'kein window.__rm';
    const st = api.stats();
    return JSON.stringify({
      ready: api.ready,
      frames: api.frames,
      errors: api.errors,
      fps: Number((st['fps'] as number).toFixed(1)),
      drawCalls: st['drawCalls'],
      triangles: st['triangles'],
      geometries: st['geometries'],
      chunks: st['chunks'],
    });
  });
  if (s !== last) {
    console.log(`[t+${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
    last = s;
  }
  if (s.includes('"ready":true')) {
    ready = true;
    break;
  }
}
await page.waitForTimeout(800);
mkdirSync(dirname(out), { recursive: true });
await page.screenshot({ path: out });
console.log(`${ready ? 'bereit' : 'NICHT bereit (Timeout)'} – Screenshot: ${out}`);
await browser.close();
process.exit(ready ? 0 : 2);
