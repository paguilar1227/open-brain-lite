import { beforeEach, expect, it, vi } from 'vitest';
import type { Config } from '../../../src/config.js';
const mock = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), auth: vi.fn(), models: vi.fn(), access: vi.fn() }));
vi.mock('@github/copilot-sdk', () => ({ RuntimeConnection: { forStdio: () => ({ kind: 'stdio' }) }, CopilotClient: class {
  start = mock.start; stop = mock.stop; getAuthStatus = mock.auth; listModels = mock.models;
} }));
vi.mock('node:fs/promises', () => ({ mkdir: vi.fn(), access: mock.access }));
import { getModelCatalog } from '../../../src/providers/model-catalog.js';
const config = () => ({ authDir: '/installation/auth', ollamaUrl: 'http://ollama:11434', llamaUrl: 'http://llama:8080/v1', embeddingModel: 'embeddinggemma', llmProvider: 'copilot', copilotModel: 'saved-model' } as Config);
beforeEach(() => {
  vi.clearAllMocks(); vi.unstubAllGlobals();
  mock.start.mockResolvedValue(undefined); mock.stop.mockResolvedValue(undefined);
  mock.auth.mockResolvedValue({ isAuthenticated: true });
  mock.access.mockResolvedValue(undefined);
  mock.models.mockResolvedValue([{ id: 'enabled', name: 'Enabled model', policy: { state: 'enabled' } }, { id: 'disabled', policy: { state: 'disabled' } }]);
});
it('lists enabled Copilot models without changing the saved selection', async () => {
  const value=config(); const before={...value};
  expect(await getModelCatalog(value,'copilot')).toMatchObject({ status:'available', models:[{id:'enabled',name:'Enabled model'}] });
  expect(value).toEqual(before); expect(mock.stop).toHaveBeenCalled();
});
it('reports sign-in needed and does not fetch a catalog for an unauthenticated account', async () => {
  mock.auth.mockResolvedValue({isAuthenticated:false});
  expect((await getModelCatalog(config(),'copilot')).status).toBe('sign_in_required');
  expect(mock.models).not.toHaveBeenCalled(); expect(mock.stop).toHaveBeenCalled();
});
it('sanitizes discovery failures and still stops the client', async () => {
  mock.models.mockRejectedValue(new Error('private diagnostic'));
  const result=await getModelCatalog(config(),'copilot');
  expect(result.status).toBe('unavailable'); expect(JSON.stringify(result)).not.toContain('private diagnostic');
  expect(mock.stop).toHaveBeenCalled();
});
it('lists local completion models while excluding the configured embedding model', async () => {
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({models:[{name:'embeddinggemma:latest'},{name:'qwen3.5:4b'}]})));
  vi.stubGlobal('fetch',fetch);
  expect((await getModelCatalog(config(),'ollama')).models).toEqual([{id:'qwen3.5:4b',name:'qwen3.5:4b'}]);
  expect(fetch).toHaveBeenCalledWith('http://ollama:11434/api/tags');
});
it('uses the configured llama.cpp endpoint', async () => {
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({data:[{id:'local'}]})));
  vi.stubGlobal('fetch',fetch);
  expect((await getModelCatalog(config(),'llama.cpp')).models).toEqual([{id:'local',name:'local'}]);
  expect(fetch).toHaveBeenCalledWith('http://llama:8080/v1/models');
});
it('distinguishes saved ChatGPT sign-in from available model discovery', async () => {
  expect((await getModelCatalog(config(),'chatgpt')).status).toBe('manual');
  expect(mock.access).toHaveBeenCalledWith('/installation/auth/codex/auth.json');
  mock.access.mockRejectedValue(new Error('missing'));
  expect((await getModelCatalog(config(),'chatgpt')).status).toBe('sign_in_required');
});
