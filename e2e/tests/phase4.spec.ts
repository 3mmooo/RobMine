import { expect, test, type Page } from '@playwright/test';
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PORT = 18765;
let server: ChildProcess;
let dataDir: string;

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'robmine-e2e-'));
  server = spawn(
    process.execPath,
    [resolve(import.meta.dirname, '../../apps/server/src/main.ts')],
    {
      env: { ...process.env, PORT: String(PORT), SEED: '42', DATA_DIR: dataDir },
      stdio: 'ignore',
    },
  );
  // Auf den Gesundheitscheck warten.
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (res.ok) return;
    } catch {
      // startet noch
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server startet nicht');
});

test.afterAll(() => {
  server?.kill('SIGTERM');
  rmSync(dataDir, { recursive: true, force: true });
});

const url = (name: string, world = 'welt'): string =>
  `/?server=ws://127.0.0.1:${PORT}/ws&name=${name}&quality=low&radius=3&t=600&world=${world}`;

async function spawned(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__rm?.ready === true, undefined, {
    timeout: 150_000,
    polling: 250,
  });
}

test('Phase 4 – zwei Spieler sehen sich und bauen gemeinsam', async ({ browser }) => {
  const a = await browser.newPage();
  const b = await browser.newPage();
  await a.goto(url('Anna'));
  await b.goto(url('Ben'));
  await spawned(a);
  await spawned(b);

  // Jeder sieht ein Namensschild des anderen.
  await expect(a.locator('.name-label', { hasText: 'Ben' })).toHaveCount(1, { timeout: 20_000 });
  await expect(b.locator('.name-label', { hasText: 'Anna' })).toHaveCount(1, { timeout: 20_000 });

  // Anna setzt einen Block über dem Spawn → Ben sieht ihn.
  const y = await a.evaluate(() => {
    for (let yy = 160; yy > 0; yy--) if (window.__rm!.getBlock(8, yy, 8) !== 0) return yy + 1;
    return -1;
  });
  expect(y).toBeGreaterThan(0);
  await a.evaluate((yy) => window.__rm!.setBlock(8, yy, 8, 13), y);
  await b.waitForFunction((yy) => window.__rm!.getBlock(8, yy, 8) === 13, y, { timeout: 10_000 });

  // Gäste haben sicheren Chat: Satzbaustein anklicken → kommt beim anderen an.
  await a.keyboard.press('KeyT');
  await a.locator('.chat-phrases button', { hasText: 'Lass uns zusammen bauen!' }).click();
  await expect(b.locator('.chat-line', { hasText: 'Lass uns zusammen bauen!' })).toHaveCount(1, {
    timeout: 10_000,
  });

  await a.close();
  await b.close();
});

test('Phase 5 – Laternenhafen: Treffpunkt, Konto, Portal in die Dämmerlande', async ({
  browser,
}) => {
  // Konto per API anlegen (wie das Konto-Fenster es tut).
  const reg = await fetch(`http://127.0.0.1:${PORT}/api/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Lumi', password: 'geheim123', birthYear: 1990 }),
  });
  const { token } = (await reg.json()) as { token: string };
  expect(token).toBeTruthy();

  const a = await browser.newPage();
  await a.addInitScript((t) => localStorage.setItem('robmine-token', t), token);
  await a.goto(`/?server=ws://127.0.0.1:${PORT}/ws&name=Egal&quality=low&radius=3`);
  await spawned(a);
  // Kontoname statt URL-Name, freier Chat für Erwachsene.
  await expect(a.locator('.chat-line', { hasText: 'verbunden als Lumi' })).toHaveCount(1);
  // Laternenhafen: Portallicht im Norden des Platzes.
  expect(await a.evaluate(() => window.__rm!.getBlock(0, 72, -13))).toBe(25);
  // Ins Portal → Dämmerlande.
  await a.evaluate(() => window.__rm!.teleport(0.5, 72.7, -12.5));
  await a.waitForURL(/world=welt/, { timeout: 20_000 });
  await spawned(a);
  await a.close();
});
