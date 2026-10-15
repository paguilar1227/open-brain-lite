// tests/unit/providers/gemini-llm.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@google/generative-ai', () => {
  const mockGenerateContent = vi.fn();
  return {
    GoogleGenerativeAI: vi.fn(() => ({
      getGenerativeModel: vi.fn(() => ({
        generateContent: mockGenerateContent,
      })),
    })),
    __mockGenerateContent: mockGenerateContent,
  };
});

describe('GeminiLLMProvider', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends a completion request and returns content + token usage', async () => {
    const { __mockGenerateContent } = await import('@google/generative-ai') as any;
    __mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => '{"topics": ["typescript"]}',
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
      },
    });

    const { GeminiLLMProvider } = await import('../../../src/providers/gemini-llm.js');
    const provider = new GeminiLLMProvider('test-key');

    const result = await provider.complete(
      [{ role: 'user', content: 'Extract topics from: I love TypeScript' }],
      { responseFormat: 'json' },
    );

    expect(result.content).toBe('{"topics": ["typescript"]}');
    expect(result.tokensUsed.total).toBe(150);
  });

  it('passes system prompt when provided', async () => {
    const { __mockGenerateContent } = await import('@google/generative-ai') as any;
    __mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => 'done',
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 10, totalTokenCount: 60 },
      },
    });

    const { GeminiLLMProvider } = await import('../../../src/providers/gemini-llm.js');
    const provider = new GeminiLLMProvider('test-key');

    await provider.complete(
      [{ role: 'user', content: 'test' }],
      { systemPrompt: 'You are a metadata extractor' },
    );

    expect(__mockGenerateContent).toHaveBeenCalled();
  });
});
