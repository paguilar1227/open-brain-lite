import { beforeEach, expect, it, vi } from 'vitest';
import type { Config } from '../../../src/config.js';

const mock = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), auth: vi.fn(), models: vi.fn(), options: null as any }));
vi.mock('@github/copilot-sdk', () => ({ RuntimeConnection: { forStdio: () => ({ kind: 'stdio' }) }, CopilotClient: class {
  constructor(options: unknown) { mock.options = options; }
  start = mock.start; stop = mock.stop; getAuthStatus = mock.auth; listModels = mock.models;
} }));
vi.mock('node:fs/promises', () => ({ mkdir: vi.fn(), writeFile: vi.fn(), rename: vi.fn() }));
import { trySelectCopilotDefault } from '../../../src/providers/subscription.js';
import { saveRuntimeConfig } from '../../../src/config.js';

const config = () => ({ autoSelectCopilot: true, storageProvider: 'local', authDir: '/installation/auth', llmProvider: 'ollama', copilotModel: 'claude-sonnet-5.5', settingsPath: '/installation/settings.json' } as Config);
beforeEach(() => {
  vi.clearAllMocks();
  mock.start.mockResolvedValue(undefined); mock.stop.mockResolvedValue(undefined);
  mock.auth.mockResolvedValue({ isAuthenticated: true });
  mock.models.mockResolvedValue([{ id: 'claude-sonnet-5.5', policy: { state: 'enabled' } }]);
});

it('selects authenticated, enabled Sonnet using only the installation profile', async () => {
  const current = config();
  expect(await trySelectCopilotDefault(current)).toBe(true);
  expect(current).toMatchObject({ llmProvider: 'copilot', copilotModel: 'claude-sonnet-5.5' });
  expect(mock.options).toMatchObject({ baseDirectory: '/installation/auth/copilot', env: { HOME: '/installation/auth/copilot', PATH: '' } });
  expect(mock.stop).toHaveBeenCalled();
});

it('keeps Ollama when Copilot has not been authorized', async () => {
  mock.auth.mockResolvedValue({ isAuthenticated: false });
  const current = config();
  expect(await trySelectCopilotDefault(current)).toBe(false);
  expect(current.llmProvider).toBe('ollama');
  expect(mock.models).not.toHaveBeenCalled();
});

it.each([{ models: [] }, { models: [{ id: 'other-model' }] }, { models: [{ id: 'claude-sonnet-5.5', policy: { state: 'disabled' } }] }])('keeps Ollama if Sonnet is missing or disabled: $models', async ({ models }) => {
  mock.models.mockResolvedValue(models);
  const current = config();
  expect(await trySelectCopilotDefault(current)).toBe(false);
  expect(current.llmProvider).toBe('ollama');
});

it('does not replace an explicit selection or probe cloud mode', async () => {
  for (const current of [{ ...config(), autoSelectCopilot: false }, { ...config(), storageProvider: 'azure' }]) {
    expect(await trySelectCopilotDefault(current as Config)).toBe(false);
    expect(current.llmProvider).toBe('ollama');
  }
  expect(mock.start).not.toHaveBeenCalled();
});

it('keeps the local default when discovery fails and closes the SDK', async () => {
  mock.models.mockRejectedValue(new Error('service unavailable'));
  const current = config();
  expect(await trySelectCopilotDefault(current)).toBe(false);
  expect(current.llmProvider).toBe('ollama');
  expect(mock.stop).toHaveBeenCalled();
});

it('a user save during discovery wins and disables automatic selection', async () => {
  const current = config();
  mock.models.mockImplementation(async () => {
    await saveRuntimeConfig(current, { provider: 'chatgpt', localModel: 'qwen3.5:4b', llamaUrl: 'http://localhost:8080/v1', llamaModel: 'local-model', copilotModel: 'gpt-5-mini', chatgptModel: 'gpt-6-luna' });
    return [{ id: 'claude-sonnet-5.5', policy: { state: 'enabled' } }];
  });
  expect(await trySelectCopilotDefault(current)).toBe(false);
  expect(current).toMatchObject({ autoSelectCopilot: false, llmProvider: 'chatgpt', copilotModel: 'gpt-5-mini' });
});
