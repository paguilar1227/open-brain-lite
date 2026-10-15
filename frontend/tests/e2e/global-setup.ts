// frontend/tests/e2e/global-setup.ts
//
// Runs once before any spec. Brings the local stack to a known state:
//
//   1. docker compose up -d --wait   — Postgres + Azurite healthy
//   2. wait for backend /health      — backend is started by `webServer`
//   3. seed-local.ts                  — idempotent (bails if projects exist)
//
// The backend AND frontend are started via Playwright's `webServer` array;
// this file just ensures their dependencies are healthy and the DB is seeded.

import { execSync } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

const ROOT = new URL('../../..', import.meta.url).pathname;
const BACKEND_HEALTH = 'http://localhost:3001/health';

async function waitForHealth(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // backend not up yet
    }
    await wait(500);
  }
  throw new Error(`Backend never became healthy at ${url} after ${timeoutMs}ms`);
}

async function globalSetup() {
  // 1. Compose: idempotent, --wait blocks until containers are healthy.
  execSync('docker compose up -d --wait', { cwd: ROOT, stdio: 'inherit' });

  // 2. Backend: started by webServer in playwright.config. We must not call
  //    seed-local before /health responds, otherwise the seed POST hits a
  //    closed port. webServer's `url` check would gate this for us, but
  //    globalSetup runs BEFORE webServer in current Playwright, so poll here.
  await waitForHealth(BACKEND_HEALTH);

  // 3. Seed: idempotent — bails if any project already exists.
  execSync('npm run seed:local --silent', { cwd: ROOT, stdio: 'inherit' });
}

export default globalSetup;
