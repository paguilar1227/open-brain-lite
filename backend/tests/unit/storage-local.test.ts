import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { LocalFileStorage } from '../../src/storage/local.js';
describe('local file storage', () => {
  it('survives a new instance and verifies tamper-proof download links', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brain-storage-test-'));
    try {
      const storage = new LocalFileStorage(root, 'test-key');
      const url = await storage.upload('example.txt', Buffer.from('durable document'), 'text/plain');
      const reopened = new LocalFileStorage(root, 'test-key');
      expect((await reopened.download(url)).toString()).toBe('durable document');
      const signed = new URL(storage.getDownloadSasUrl(url, 'my note.txt'), 'http://test');
      const p = signed.searchParams;
      expect(storage.verify('example.txt', p.get('expires')!, p.get('filename')!, p.get('sig')!)).toBe(true);
      expect(storage.verify('another.txt', p.get('expires')!, p.get('filename')!, p.get('sig')!)).toBe(false);
      expect(storage.verify('example.txt', '1', '', p.get('sig')!)).toBe(false);
      await expect(storage.download('../outside.txt')).rejects.toThrow('escapes');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
