import { describe, it, expect, vi } from 'vitest';
import { extractLocalFile } from '../../src/capture/local-file.js';
vi.mock('../../src/capture/local-media.js', () => ({ extractLocalMedia: vi.fn().mockResolvedValue({ text: 'A real transcript' }) }));
import { createContentItem } from '../../src/services/content-items.js';
import { mockDb, mockBlobStorage, mockEmbeddingProvider, mockLLMProvider } from '../helpers/mocks.js';
import type { ServiceDeps } from '../../src/services/index.js';

describe('local-first source preservation', () => {
  it('decodes text and Markdown as text, not a fake image', async () => {
    for (const filename of ['memo.txt', 'memo.md']) {
      expect(await extractLocalFile({ filename, mimeType: 'text/plain', data: Buffer.from('Retain this original source.') })).toBe('Retain this original source.');
    }
  });
  it('uses the local transcriber for audio, rather than embedding a title', async () => {
    await expect(extractLocalFile({ filename: 'memo.mp3', mimeType: 'audio/mpeg', data: Buffer.from('fixture') })).resolves.toBe('A real transcript');
  });
  it('persists the original note before any model can complete', async () => {
    const db = mockDb();
    const source = 'Durable even if the app restarts while the model runs.';
    vi.mocked(db.query).mockImplementation(async (sql: string) => ({ rows: sql.startsWith('INSERT INTO content_items') ? [{ id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' }] : [], rowCount: 1 }) as any);
    const llm = mockLLMProvider();
    llm.complete = vi.fn().mockRejectedValue(new Error('offline'));
    const embedding = mockEmbeddingProvider(768);
    embedding.embed = vi.fn().mockRejectedValue(new Error('offline'));
    const deps = { db, blobStorage: mockBlobStorage(), embeddingProvider: embedding, metadataLLM: llm, mediaMetadataLLM: llm, config: { llmProvider: 'ollama' } } as ServiceDeps;
    const result = await createContentItem(deps, { type: 'note', content: source });
    await result.completion;
    const insert = vi.mocked(db.query).mock.calls.find(([sql]) => sql.startsWith('INSERT INTO content_items'))!;
    expect(insert[1]?.[3]).toBe(source);
  });
});
