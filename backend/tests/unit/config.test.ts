import { afterEach, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';

afterEach(() => vi.unstubAllEnvs());

it('defaults ChatGPT to a model supported by the signed-in Codex account', () => {
  vi.stubEnv('DATABASE_URL', 'postgres://local/test');
  vi.stubEnv('OPEN_BRAIN_API_KEY', 'local-test-key');
  vi.stubEnv('SETTINGS_PATH', '/nonexistent/open-brain-test-settings.json');
  vi.stubEnv('CHATGPT_MODEL', undefined);
  expect(loadConfig().chatgptModel).toBe('gpt-6-luna');
});
