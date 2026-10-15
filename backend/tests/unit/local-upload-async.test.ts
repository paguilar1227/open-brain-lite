import { describe, expect, it, vi } from 'vitest';
const extraction = vi.hoisted(() => ({ release: null as null | ((value: string) => void) }));
vi.mock('../../src/capture/local-file.js', () => ({ extractLocalFile: vi.fn(() => new Promise<string>(resolve => { extraction.release = resolve; })) }));
import { createContentItem } from '../../src/services/content-items.js';
import { mockDb, mockBlobStorage, mockEmbeddingProvider, mockLLMProvider } from '../helpers/mocks.js';
import type { ServiceDeps } from '../../src/services/index.js';
describe('local upload async contract', () => {
  it('returns a durable pending item before slow local transcription finishes', async () => {
    const db = mockDb();
    vi.mocked(db.query).mockImplementation(async (sql: string) => ({ rows: sql.startsWith('INSERT INTO content_items') ? [{ id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' }] : [], rowCount: 1 }) as any);
    const llm = mockLLMProvider({ content: '{"title":"Transcript","topics":[]}' });
    const deps = { db, blobStorage: mockBlobStorage(), embeddingProvider: mockEmbeddingProvider(768), metadataLLM: llm, mediaMetadataLLM: llm, config: { llmProvider: 'ollama' } } as ServiceDeps;
    const result = await createContentItem(deps, { type: 'document', file: { filename: 'memo.mp3', mimeType: 'audio/mpeg', data: Buffer.from('audio bytes') } });
    expect(result.status).toBe('pending');
    expect(result.id).toBe('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa');
    expect(extraction.release).not.toBeNull();
    expect(llm.complete).not.toHaveBeenCalled();
    extraction.release!('This transcript can be searched and retained.');
    expect((await result.completion).status).toBe('ready');
  });
});
