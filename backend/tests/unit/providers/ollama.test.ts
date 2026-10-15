import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../src/providers/local-http.js', () => ({ postLocalJson: vi.fn() }));
import { postLocalJson } from '../../../src/providers/local-http.js';
import { ensureOllamaModels, OllamaEmbeddingProvider, OllamaLLMProvider } from '../../../src/providers/ollama.js';
afterEach(() => vi.resetAllMocks());
describe('Ollama local providers', () => {
  it('requires an actual model vector with the database dimensionality', async () => {
    const fetcher = vi.mocked(postLocalJson).mockResolvedValue({ embeddings: [[0.2, 0.8]] });
    await expect(new OllamaEmbeddingProvider('http://ollama:11434', 'embeddinggemma').embed('query')).rejects.toThrow('768');
    await expect(new OllamaEmbeddingProvider('http://ollama:11434', 'small', 2).embed('query')).resolves.toEqual([0.2, 0.8]);
    const payload = fetcher.mock.calls[0][1] as { truncate: boolean };
    expect(payload.truncate).toBe(false);
  });
  it('uses the configured model and JSON mode, with thinking disabled', async () => {
    const fetcher = vi.mocked(postLocalJson).mockResolvedValue({ message: { content: '{"title":"Local"}' }, prompt_eval_count: 4, eval_count: 5 });
    const result = await new OllamaLLMProvider('http://ollama:11434', 'qwen3.5:4b').complete([{ role: 'user', content: 'Explain' }], { responseFormat: 'json', systemPrompt: 'JSON only' });
    expect(result.tokensUsed.total).toBe(9);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ model: 'qwen3.5:4b', format: 'json', think: false, stream: false });
  });
  it('reports missing models without returning a fake vector', async () => {
    vi.mocked(postLocalJson).mockRejectedValue(new Error('model not found: HTTP 404'));
    await expect(new OllamaEmbeddingProvider('http://ollama:11434', 'missing').embed('query')).rejects.toThrow('404');
  });
  it('prepares both models on the configured runtime, including a native endpoint', async () => {
    const fetcher = vi.mocked(postLocalJson).mockResolvedValue({ status: 'success' });
    await ensureOllamaModels('http://host.docker.internal:11434/', ['embeddinggemma', 'chosen-local-model']);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'http://host.docker.internal:11434/api/pull', 'http://host.docker.internal:11434/api/pull',
    ]);
    expect(fetcher.mock.calls.map(([, body]) => body)).toEqual([
      { model: 'embeddinggemma', stream: false }, { model: 'chosen-local-model', stream: false },
    ]);
  });
  it('refuses to report ready when model preparation returns an error', async () => {
    vi.mocked(postLocalJson).mockResolvedValue({ error: 'unsupported model' });
    await expect(ensureOllamaModels('http://ollama:11434', ['missing'])).rejects.toThrow('unsupported model');
  });
});
