import { expect, test, type Page } from '@playwright/test';

// Eigener Seed, damit die IndexedDB dieses Tests niemanden stört.
const URL = '/?seed=777&det=1&t=600&quality=low&radius=4&cam=12,118,20,-0.65,-0.42';
const GLAS = 13;

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__rm?.ready === true, undefined, {
    timeout: 150_000,
    polling: 250,
  });
}

test.describe('Phase 2 – Bauen', () => {
  test('Block setzen und abbauen wird vom Server bestätigt und überlebt das Neuladen', async ({
    page,
  }) => {
    await page.goto(URL);
    await waitReady(page);

    // Oberfläche unter der Kamera finden (erster fester Block von oben).
    const target = await page.evaluate(() => {
      for (let y = 140; y > 0; y--) if (window.__rm!.getBlock(12, y, 20) !== 0) return y;
      return -1;
    });
    expect(target).toBeGreaterThan(0);

    // Setzen: Glas über der Oberfläche.
    await page.evaluate((y) => window.__rm!.setBlock(12, y + 1, 20, 13), target);
    await page.waitForFunction(
      ([y, id]) => window.__rm!.getBlock(12, y + 1, 20) === id,
      [target, GLAS] as const,
      { timeout: 10_000 },
    );
    // Abbauen: den Oberflächenblock entfernen.
    await page.evaluate((y) => window.__rm!.setBlock(12, y, 20, 0), target);
    await page.waitForFunction((y) => window.__rm!.getBlock(12, y, 20) === 0, target, {
      timeout: 10_000,
    });

    // Speichern ist verzögert (1,5 s) – warten, dann neu laden.
    await page.waitForTimeout(2500);
    await page.reload();
    await waitReady(page);
    const after = await page.evaluate(
      (y) => [window.__rm!.getBlock(12, y + 1, 20), window.__rm!.getBlock(12, y, 20)],
      target,
    );
    expect(after).toEqual([GLAS, 0]);
    expect(await page.evaluate(() => window.__rm!.errors)).toEqual([]);
  });
});
