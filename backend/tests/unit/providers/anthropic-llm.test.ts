// tests/unit/providers/anthropic-llm.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => ({
    messages: { create: mockCreate },
  })),
}));

describe('AnthropicLLMProvider', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends messages and returns content + token usage', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"facts": []}' }],
      usage: { input_tokens: 200, output_tokens: 100 },
    });

    const { AnthropicLLMProvider } = await import('../../../src/providers/anthropic-llm.js');
    const provider = new AnthropicLLMProvider('test-key');

    const result = await provider.complete(
      [{ role: 'user', content: 'Analyze these captures' }],
      { systemPrompt: 'You are a profile consolidator', responseFormat: 'json' },
    );

    expect(result.content).toBe('{"facts": []}');
    expect(result.tokensUsed.input).toBe(200);
    expect(result.tokensUsed.output).toBe(100);
    expect(result.tokensUsed.total).toBe(300);
  });

  it('uses claude-opus-4-6 as default model', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'done' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const { AnthropicLLMProvider } = await import('../../../src/providers/anthropic-llm.js');
    const provider = new AnthropicLLMProvider('test-key');

    await provider.complete([{ role: 'user', content: 'test' }]);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-opus-4-6' }),
    );
  });
});
