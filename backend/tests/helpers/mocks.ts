// tests/helpers/mocks.ts
import { vi } from 'vitest';
import type { DbClient } from '../../src/db/client.js';
import type { EmbeddingProvider, LLMProvider, LLMResponse } from '../../src/providers/types.js';
import type { BlobStorage } from '../../src/storage/blob.js';

export function mockDb(): DbClient {
  return {
    pool: {} as any,
    query: vi.fn(),
    transaction: vi.fn(),
    close: vi.fn(),
  };
}

export function mockEmbeddingProvider(dims = 3072): EmbeddingProvider {
  return {
    embed: vi.fn().mockResolvedValue(new Array(dims).fill(0.1)),
    dimensions: dims,
  };
}

export function mockLLMProvider(defaultResponse?: Partial<LLMResponse>): LLMProvider {
  const response: LLMResponse = {
    content: defaultResponse?.content ?? '{}',
    tokensUsed: defaultResponse?.tokensUsed ?? { input: 100, output: 50, total: 150 },
  };
  return { complete: vi.fn().mockResolvedValue(response) };
}

export function mockBlobStorage(): BlobStorage {
  return {
    upload: vi.fn().mockResolvedValue('https://blob.storage/file'),
    exists: vi.fn().mockResolvedValue(false),
    getUrl: vi.fn().mockReturnValue('https://blob.storage/file'),
    download: vi.fn().mockResolvedValue(Buffer.from('mock-bytes')),
    getSize: vi.fn().mockResolvedValue(2048),
    getReadSasUrl: vi.fn((url: string) => url),  // pass-through in tests
    // Pass-through with a fake SAS marker so tests can assert the URL was
    // signed. Query-safe: append with & when the URL already has a query (and
    // tolerate bare blob names, which `new URL()` would reject).
    getDownloadSasUrl: vi.fn((url: string) =>
      url ? `${url}${url.includes('?') ? '&' : '?'}sig=test&rscd=attachment` : url),
  };
}
