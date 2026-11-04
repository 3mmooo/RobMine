import { normalizeSeed } from '@robmine/core';
import { startServer } from './server.ts';

/**
 * Start:  node apps/server/src/main.ts
 * Umgebung: PORT (8080), SEED (42), DATA_DIR (./data/world), MAX_PLAYERS (16),
 *           ALLOWED_ORIGINS (kommagetrennt, leer = alle),
 *           GUEST_FREE_CHAT (1 = Gäste dürfen frei schreiben, Standard: nur Satzbausteine),
 *           STATIC_DIR (gebauter Client, z. B. apps/client/dist – dann ist alles unter einer URL)
 */
const server = await startServer({
  port: Number(process.env['PORT'] ?? 8080),
  seed: normalizeSeed(process.env['SEED'] ?? '42'),
  dataDir: process.env['DATA_DIR'] ?? './data/world',
  maxPlayers: Number(process.env['MAX_PLAYERS'] ?? 16),
  allowedOrigins: (process.env['ALLOWED_ORIGINS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  guestSafeChat: process.env['GUEST_FREE_CHAT'] !== '1',
  ...(process.env['STATIC_DIR'] ? { staticDir: process.env['STATIC_DIR'] } : {}),
});

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} – speichere und beende …`);
  await server.close();
  process.exit(0);
}
process.on('SIGINT', () => void stop('SIGINT'));
process.on('SIGTERM', () => void stop('SIGTERM'));
