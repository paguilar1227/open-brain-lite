import { afterEach, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

afterEach(() => vi.unstubAllEnvs());

it('defaults ChatGPT to a model supported by the signed-in Codex account', () => {
  vi.stubEnv('DATABASE_URL', 'postgres://local/test');
  vi.stubEnv('OPEN_BRAIN_API_KEY', 'local-test-key');
  vi.stubEnv('SETTINGS_PATH', '/nonexistent/open-brain-test-settings.json');
  vi.stubEnv('CHATGPT_MODEL', undefined);
  expect(loadConfig().chatgptModel).toBe('gpt-6-luna');
});

it('loads a local installation without an API key', () => {
  vi.stubEnv('DATABASE_URL', 'postgres://local/test');
  vi.stubEnv('SETTINGS_PATH', '/nonexistent/open-brain-test-settings.json');
  vi.stubEnv('STORAGE_PROVIDER', 'local');
  vi.stubEnv('OPEN_BRAIN_API_KEY', undefined);
  expect(loadConfig().apiKey).toBe('');
});

it('still requires an API key for cloud storage', () => {
  vi.stubEnv('DATABASE_URL', 'postgres://local/test');
  vi.stubEnv('SETTINGS_PATH', '/nonexistent/open-brain-test-settings.json');
  vi.stubEnv('STORAGE_PROVIDER', 'azure');
  vi.stubEnv('OPEN_BRAIN_API_KEY', undefined);
  expect(() => loadConfig()).toThrow('API key is required for cloud storage');
});

it('defaults to Sonnet and enables discovery only without an explicit model choice', () => {
  vi.stubEnv('DATABASE_URL', 'postgres://local/test');
  vi.stubEnv('SETTINGS_PATH', '/nonexistent/open-brain-test-settings.json');
  vi.stubEnv('LLM_PROVIDER', undefined);
  vi.stubEnv('COPILOT_MODEL', undefined);
  expect(loadConfig()).toMatchObject({ llmProvider: 'ollama', copilotModel: 'claude-sonnet-5.5', autoSelectCopilot: true });
  vi.stubEnv('LLM_PROVIDER', 'ollama');
  expect(loadConfig().autoSelectCopilot).toBe(false);
  vi.stubEnv('LLM_PROVIDER', undefined);
  vi.stubEnv('COPILOT_MODEL', 'my-model');
  expect(loadConfig()).toMatchObject({ copilotModel: 'my-model', autoSelectCopilot: false });
});

it('preserves a saved local-provider preference even when Copilot is available', () => {
  const dir = mkdtempSync(join(tmpdir(), 'brain-config-test-'));
  try {
    const path = join(dir, 'settings.json');
    writeFileSync(path, JSON.stringify({ provider: 'ollama', copilotModel: 'my-saved-model' }));
    vi.stubEnv('DATABASE_URL', 'postgres://local/test');
    vi.stubEnv('SETTINGS_PATH', path);
    vi.stubEnv('LLM_PROVIDER', undefined);
    vi.stubEnv('COPILOT_MODEL', undefined);
    expect(loadConfig()).toMatchObject({ llmProvider: 'ollama', copilotModel: 'my-saved-model', autoSelectCopilot: false });
  } finally { rmSync(dir, { recursive: true }); }
});

it.each(['LOCAL_MODEL', 'LLAMA_URL', 'LLAMA_MODEL', 'CHATGPT_MODEL'])('preserves an explicit %s override', name => {
  vi.stubEnv('DATABASE_URL', 'postgres://local/test');
  vi.stubEnv('SETTINGS_PATH', '/nonexistent/open-brain-test-settings.json');
  vi.stubEnv('LLM_PROVIDER', undefined);
  vi.stubEnv('COPILOT_MODEL', undefined);
  vi.stubEnv(name, 'explicit-choice');
  expect(loadConfig().autoSelectCopilot).toBe(false);
});

it('allows the empty Compose defaults without treating them as explicit choices', () => {
  vi.stubEnv('DATABASE_URL', 'postgres://local/test');
  vi.stubEnv('SETTINGS_PATH', '/nonexistent/open-brain-test-settings.json');
  vi.stubEnv('LLM_PROVIDER', '');
  vi.stubEnv('LOCAL_MODEL', '');
  vi.stubEnv('COPILOT_MODEL', '');
  vi.stubEnv('CHATGPT_MODEL', '');
  vi.stubEnv('LLAMA_MODEL', '');
  vi.stubEnv('LLAMA_URL', '');
  expect(loadConfig()).toMatchObject({ autoSelectCopilot: true, llmProvider: 'ollama', localModel: 'qwen3.5:4b', copilotModel: 'claude-sonnet-5.5' });
});
