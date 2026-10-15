import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../src/providers/local-http.js', () => ({ postLocalJson: vi.fn() }));
import { postLocalJson } from '../../../src/providers/local-http.js';
import { LlamaCppProvider } from '../../../src/providers/llama.js';
afterEach(() => vi.resetAllMocks());
describe('llama.cpp completion adapter', () => {
  it('uses the local OpenAI-compatible endpoint and preserves token accounting', async () => {
    const fetcher = vi.mocked(postLocalJson).mockResolvedValue({ choices: [{ message: { content: 'Local answer' } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
    const response = await new LlamaCppProvider('http://llama:8080/v1', 'local-model').complete([{ role: 'user', content: 'Summarize' }]);
    expect(fetcher.mock.calls[0][0]).toBe('http://llama:8080/v1/chat/completions');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ reasoning_effort: 'none' });
    expect(response).toMatchObject({ content: 'Local answer', tokensUsed: { total: 5 } });
  });
  it('propagates local runtime failure instead of pretending the call succeeded', async () => {
    vi.mocked(postLocalJson).mockRejectedValue(new Error('llama.cpp: HTTP 503'));
    await expect(new LlamaCppProvider('http://llama:8080/v1', 'local').complete([{ role: 'user', content: 'Summarize' }])).rejects.toThrow('503');
  });
});
