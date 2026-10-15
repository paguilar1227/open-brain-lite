import { describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ copilotOptions: null as any, sessionOptions: null as any, codexOptions: null as any, threadOptions: null as any, stop: vi.fn(), disconnect: vi.fn(), send: vi.fn().mockResolvedValue({ data: { content: 'Subscription answer' } }), run: vi.fn().mockResolvedValue({ finalResponse: 'ChatGPT answer', usage: { input_tokens: 2, output_tokens: 3 } }) }));
vi.mock('@github/copilot-sdk', () => ({ RuntimeConnection: { forStdio: () => ({ kind: 'stdio' }) }, CopilotClient: class {
  constructor(options: unknown) { mock.copilotOptions = options; }
  start = vi.fn(); getAuthStatus = vi.fn().mockResolvedValue({ isAuthenticated: true });
  createSession = vi.fn().mockImplementation(async options => { mock.sessionOptions = options; return { sendAndWait: mock.send, disconnect: mock.disconnect }; });
  stop = mock.stop;
} }));
vi.mock('@openai/codex-sdk', () => ({ Codex: class {
  constructor(options: unknown) { mock.codexOptions = options; }
  startThread(options: unknown) { mock.threadOptions = options; return { run: mock.run }; }
} }));
vi.mock('node:fs/promises', () => ({ mkdir: vi.fn() }));
import { SubscriptionLLMProvider } from '../../../src/providers/subscription.js';
import { mkdir } from 'node:fs/promises';
import type { Config } from '../../../src/config.js';
describe('subscription providers', () => {
  it('uses an isolated Copilot profile with tools denied and no inherited project config', async () => {
    const provider = new SubscriptionLLMProvider({ llmProvider: 'copilot', authDir: '/isolated', copilotModel: 'selected-model' } as Config);
    expect((await provider.complete([{ role: 'user', content: 'Explain the saved decision' }])).content).toBe('Subscription answer');
    expect(mock.copilotOptions).toMatchObject({ mode: 'empty', baseDirectory: '/isolated/copilot' });
    expect(mock.copilotOptions.connection).toMatchObject({ kind: 'stdio' });
    expect(mock.copilotOptions.env).toMatchObject({ PATH: '', COPILOT_DISABLE_KEYTAR: '1' });
    expect(mock.copilotOptions.env.OPEN_BRAIN_API_KEY).toBeUndefined();
    expect(mock.sessionOptions).toMatchObject({ model: 'selected-model', availableTools: [], enableConfigDiscovery: false });
    expect(mock.sessionOptions.onPermissionRequest()).toMatchObject({ kind: 'denied-by-rules' });
    expect(mock.disconnect).toHaveBeenCalled();
    expect(mock.stop).toHaveBeenCalled();
  });
  it('uses ChatGPT credentials from the installation with filesystem writes and tools disabled', async () => {
    const provider = new SubscriptionLLMProvider({ llmProvider: 'chatgpt', authDir: '/isolated', chatgptModel: 'selected-model' } as Config);
    const result = await provider.complete([{ role: 'user', content: 'Explain the saved decision' }]);
    expect(result.content).toBe('ChatGPT answer');
    expect(result.tokensUsed.total).toBe(5);
    expect(mock.codexOptions.env.CODEX_HOME).toBe('/isolated/codex');
    expect(mkdir).toHaveBeenCalledWith('/isolated/codex', { recursive: true });
    expect(mock.codexOptions.env.OPENAI_API_KEY).toBeUndefined();
    expect(mock.codexOptions.config.features.shell_tool).toBe(false);
    expect(mock.threadOptions).toMatchObject({ model: 'selected-model', sandboxMode: 'read-only', networkAccessEnabled: false, approvalPolicy: 'never', webSearchMode: 'disabled' });
  });
  it('never falls back to another provider when the selected provider fails', async () => {
    mock.run.mockRejectedValueOnce(new Error('Sign-in required'));
    const provider = new SubscriptionLLMProvider({ llmProvider: 'chatgpt', authDir: '/isolated', chatgptModel: 'selected-model' } as Config);
    await expect(provider.complete([{ role: 'user', content: 'Summarize' }])).rejects.toThrow('Sign-in required');
  });
});
