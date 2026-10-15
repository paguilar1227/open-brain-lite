// tests/unit/providers/gemini-embedding.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@google/generative-ai', () => {
  const mockEmbedContent = vi.fn();
  return {
    GoogleGenerativeAI: vi.fn(() => ({
      getGenerativeModel: vi.fn(() => ({
        embedContent: mockEmbedContent,
      })),
    })),
    __mockEmbedContent: mockEmbedContent,
  };
});

describe('GeminiEmbeddingProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a 3072-dimension vector for text input', async () => {
    const { __mockEmbedContent } = await import('@google/generative-ai') as any;
    const mockVector = new Array(3072).fill(0.1);
    __mockEmbedContent.mockResolvedValueOnce({
      embedding: { values: mockVector },
    });

    const { GeminiEmbeddingProvider } = await import('../../../src/providers/gemini-embedding.js');
    const provider = new GeminiEmbeddingProvider('test-key');

    const result = await provider.embed('I love TypeScript');
    expect(result).toHaveLength(3072);
    expect(provider.dimensions).toBe(3072);
  });

  it('passes file buffers as inline data parts', async () => {
    const { __mockEmbedContent } = await import('@google/generative-ai') as any;
    __mockEmbedContent.mockResolvedValueOnce({
      embedding: { values: new Array(3072).fill(0.2) },
    });

    const { GeminiEmbeddingProvider } = await import('../../../src/providers/gemini-embedding.js');
    const provider = new GeminiEmbeddingProvider('test-key');

    const fileBuffer = Buffer.from('fake image data');
    await provider.embed('Photo of my desk', [{ data: fileBuffer, mimeType: 'image/jpeg' }]);

    expect(__mockEmbedContent).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          parts: expect.arrayContaining([
            expect.objectContaining({ text: 'Photo of my desk' }),
          ]),
        }),
      }),
    );
  });
});
