import { afterEach, expect, it, vi } from 'vitest';
import { scrapeLocal } from '../../../src/providers/local-web.js';

afterEach(() => vi.unstubAllGlobals());

it('keeps paragraph boundaries when importing minified HTML', async () => {
  const first = 'First paragraph describes durable project decisions and local database storage.';
  const second = 'Second paragraph records the next actions for a new agent session.';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`<html><head><title>Project guide</title></head><body><nav>Ignore this menu</nav><article><h1>Project guide</h1><p>${first}</p><p>${second}</p></article></body></html>`)));
  const page = await scrapeLocal('https://example.com/guide');
  expect(page.markdown).toContain(`${first}\n\n${second}`);
  expect(page.markdown).not.toContain('Ignore this menu');
});
