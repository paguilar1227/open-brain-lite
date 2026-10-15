import { describe, it, expect, vi } from 'vitest';
vi.mock('../../src/capture/local-file.js', () => ({ extractLocalFile: vi.fn().mockRejectedValue(new Error('transcriber unavailable')) }));
import { reprocessContent } from '../../src/services/content-items.js';
import { mockDb, mockBlobStorage } from '../helpers/mocks.js';
import type { ServiceDeps } from '../../src/services/index.js';
describe('reprocess preserves the old index when local extraction fails', () => {
  it('does not delete searchable chunks before preflight succeeds', async () => {
    const db = mockDb();
    vi.mocked(db.query).mockResolvedValue({ rows: [{ id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', processing_status: 'ready', blob_url: '/api/files/audio.mp3', mime_type: 'audio/mpeg', content: 'Previously indexed transcript', metadata: { filename: 'audio.mp3' }, type: 'document' }] } as any);
    const deps = { db, blobStorage: mockBlobStorage(), config: { llmProvider: 'ollama' } } as ServiceDeps;
    await expect(reprocessContent(deps, 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa')).rejects.toThrow('transcriber unavailable');
    expect(vi.mocked(db.query).mock.calls.some(([sql]) => sql.startsWith('DELETE'))).toBe(false);
    expect(vi.mocked(db.query).mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
  });
});
