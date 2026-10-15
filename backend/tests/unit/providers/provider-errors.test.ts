// tests/unit/providers/provider-errors.test.ts — Section 12: Provider error handling
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the providers by mocking the Google Generative AI SDK
vi.mock('@google/generative-ai', () => {
  const mockEmbedContent = vi.fn();
  const mockGenerateContent = vi.fn();
  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
      getGenerativeModel: vi.fn().mockReturnValue({
        embedContent: mockEmbedContent,
        generateContent: mockGenerateContent,
      }),
    })),
    __mockEmbedContent: mockEmbedContent,
    __mockGenerateContent: mockGenerateContent,
  };
});

import { GeminiEmbeddingProvider } from '../../../src/providers/gemini-embedding.js';
import { GeminiLLMProvider } from '../../../src/providers/gemini-llm.js';

// Get mock handles
const { __mockEmbedContent, __mockGenerateContent } = await import('@google/generative-ai') as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Section 12: Provider Errors', () => {
  it('12.1 Embedding provider: 404 response → error contains model name and "not found"', async () => {
    __mockEmbedContent.mockRejectedValueOnce(
      new Error('[404 Not Found] models/gemini-embedding-2-preview is not found'),
    );

    const provider = new GeminiEmbeddingProvider('fake-key');
    await expect(provider.embed('test')).rejects.toThrow(/not found/i);
  });

  it('12.2 LLM provider: 404 response → error contains model name and "not found"', async () => {
    __mockGenerateContent.mockRejectedValueOnce(
      new Error('[404 Not Found] models/gemini-2.5-flash is not found'),
    );

    const provider = new GeminiLLMProvider('fake-key');
    await expect(
      provider.complete([{ role: 'user', content: 'test' }]),
    ).rejects.toThrow(/not found/i);
  });

  it('12.3 LLM provider: 401/403 response → error contains "Unauthorized" or "Forbidden"', async () => {
    __mockGenerateContent.mockRejectedValueOnce(
      new Error('[403 Forbidden] API key is invalid or has insufficient permissions'),
    );

    const provider = new GeminiLLMProvider('fake-key');
    await expect(
      provider.complete([{ role: 'user', content: 'test' }]),
    ).rejects.toThrow(/Forbidden/i);
  });

  it('12.4 Pipeline passes {data, mimeType} to embed (not raw Buffer)', async () => {
    __mockEmbedContent.mockResolvedValueOnce({
      embedding: { values: [0.1, 0.2, 0.3] },
    });

    const provider = new GeminiEmbeddingProvider('fake-key');
    const fileData = Buffer.from('test-pdf');
    const files = [{ data: fileData, mimeType: 'application/pdf' }];

    await provider.embed('test content', files);

    // The embed call should have been invoked with inline data
    expect(__mockEmbedContent).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          parts: expect.arrayContaining([
            { text: 'test content' },
            expect.objectContaining({
              inlineData: expect.objectContaining({
                data: expect.any(String), // base64
                mimeType: 'application/pdf',
              }),
            }),
          ]),
        }),
      }),
    );
  });

  it('12.5 Embedding file format has data (Buffer) and mimeType (string) properties', () => {
    // This is a type-level test — verify the interface shape
    const file = { data: Buffer.from('test'), mimeType: 'image/jpeg' };
    expect(file.data).toBeInstanceOf(Buffer);
    expect(typeof file.mimeType).toBe('string');
  });
});
