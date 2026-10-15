import { afterEach, describe, expect, it, vi } from 'vitest';
import { OllamaEmbeddingProvider, OllamaLLMProvider } from '../../../src/providers/ollama.js';
afterEach(() => vi.unstubAllGlobals());
describe('Ollama local providers', () => {
  it('requires an actual model vector with the database dimensionality', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ embeddings: [[0.2, 0.8]] })));
    vi.stubGlobal('fetch', fetcher);
    await expect(new OllamaEmbeddingProvider('http://ollama:11434', 'embeddinggemma').embed('query')).rejects.toThrow('768');
    await expect(new OllamaEmbeddingProvider('http://ollama:11434', 'small', 2).embed('query')).resolves.toEqual([0.2, 0.8]);
    const payload = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(payload.truncate).toBe(false);
  });
  it('uses the configured model and JSON mode, with thinking disabled', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: '{"title":"Local"}' }, prompt_eval_count: 4, eval_count: 5 })));
    vi.stubGlobal('fetch', fetcher);
    const result = await new OllamaLLMProvider('http://ollama:11434', 'qwen3.5:4b').complete([{ role: 'user', content: 'Explain' }], { responseFormat: 'json', systemPrompt: 'JSON only' });
    expect(result.tokensUsed.total).toBe(9);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ model: 'qwen3.5:4b', format: 'json', think: false, stream: false });
  });
  it('reports missing models without returning a fake vector', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('model not found', { status: 404 })));
    await expect(new OllamaEmbeddingProvider('http://ollama:11434', 'missing').embed('query')).rejects.toThrow('404');
  });
});
