/**
 * Regression tests for migration 004 (processing_status / processing_error).
 *
 * What we're protecting:
 *   - Existing rows continue to be retrievable. The migration defaults
 *     processing_status to 'ready', so legacy rows must still surface in
 *     vector search and graph-expansion. These tests assert the SQL queries
 *     filter on processing_status='ready' so a migration regression would
 *     show up here, not in production.
 *   - Legacy callers of insertContentItem (without processingStatus) get
 *     'ready' by default — no behavior change for synchronous paths.
 *   - The new updateProcessingStatus helper writes the right SQL.
 */

import { describe, it, expect, vi } from 'vitest';
import type { DbClient } from '../../../src/db/client.js';
import {
  insertContentItem,
  updateProcessingStatus,
  findSimilarContentItems,
} from '../../../src/db/content-items.js';
import { findSimilarChunks } from '../../../src/db/chunks.js';

function mockDb(): { db: DbClient; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn().mockResolvedValue({ rows: [{ id: 'mock-id' }] });
  return {
    db: { pool: {} as any, query, transaction: vi.fn(), close: vi.fn() },
    query,
  };
}

describe('migration 004 — processing_status retrieval invariants', () => {
  it('findSimilarContentItems filters processing_status=ready (so legacy rows still surface)', async () => {
    const { db, query } = mockDb();
    await findSimilarContentItems(db, new Array(3072).fill(0.1), 0.5, 10);

    expect(query).toHaveBeenCalledTimes(1);
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toMatch(/processing_status\s*=\s*'ready'/);
    expect(sql).toMatch(/archived\s*=\s*false/);
  });

  it('findSimilarChunks joins content_items and filters by processing_status=ready', async () => {
    const { db, query } = mockDb();
    await findSimilarChunks(db, new Array(3072).fill(0.1), 0.5, 10);

    const sql = query.mock.calls[0][0] as string;
    expect(sql).toMatch(/JOIN\s+content_items/i);
    expect(sql).toMatch(/ci\.processing_status\s*=\s*'ready'/);
    expect(sql).toMatch(/ci\.archived\s*=\s*false/);
  });

  it('insertContentItem defaults to processing_status=ready when caller omits it', async () => {
    const { db, query } = mockDb();
    await insertContentItem(db, {
      type: 'note',
      title: 'legacy caller',
      titleSource: 'user',
      content: 'hello',
      blobUrl: null,
      mimeType: null,
      fileHash: null,
      projectIds: [],
      tags: [],
      embedding: null,
      metadata: {},
      sourceUrl: null,
      publishedAt: null,
      // no processingStatus → must default to 'ready'
    });

    const params = query.mock.calls[0][1] as unknown[];
    // INSERT param order after migration-009 `folder` ($10): ..., source_url
    // ($13), published_at ($14), processing_status ($15) → index 14.
    expect(params[14]).toBe('ready');
  });

  it('insertContentItem accepts processing_status=pending for the new async path', async () => {
    const { db, query } = mockDb();
    await insertContentItem(db, {
      type: 'document',
      title: 'Processing…',
      titleSource: 'filename',
      content: null,
      blobUrl: null,
      mimeType: null,
      fileHash: null,
      projectIds: [],
      tags: [],
      embedding: null,
      metadata: {},
      sourceUrl: 'https://example.com',
      publishedAt: null,
      processingStatus: 'pending',
    });

    const params = query.mock.calls[0][1] as unknown[];
    expect(params[14]).toBe('pending');
  });

  it('updateProcessingStatus emits an UPDATE that sets status + error + updated_at', async () => {
    const { db, query } = mockDb();
    await updateProcessingStatus(db, 'ci-1', 'failed', 'embedding service down');

    const sql = query.mock.calls[0][0] as string;
    const params = query.mock.calls[0][1] as unknown[];
    expect(sql).toMatch(/UPDATE\s+content_items/i);
    expect(sql).toMatch(/processing_status\s*=\s*\$1/);
    expect(sql).toMatch(/processing_error\s*=\s*\$2/);
    expect(sql).toMatch(/updated_at\s*=\s*now\(\)/);
    expect(params).toEqual(['failed', 'embedding service down', 'ci-1']);
  });

  it('updateProcessingStatus(ready) writes a null error', async () => {
    const { db, query } = mockDb();
    await updateProcessingStatus(db, 'ci-1', 'ready');
    const params = query.mock.calls[0][1] as unknown[];
    expect(params).toEqual(['ready', null, 'ci-1']);
  });

  it('updateProcessingStatus stamps ingest_completed_at on terminal states (and clears it on pending)', async () => {
    const { db, query } = mockDb();
    await updateProcessingStatus(db, 'ci-1', 'ready');

    const sql = query.mock.calls[0][0] as string;
    // CASE WHEN $1 IN ('ready','failed') THEN now() ELSE NULL END — assert
    // both branches are present in the SQL so a future regression that only
    // sets it on 'ready' (forgetting 'failed') or never clears it on
    // 'pending' will trip here.
    expect(sql).toMatch(/ingest_completed_at\s*=\s*CASE\s+WHEN/i);
    expect(sql).toMatch(/\$1\s+IN\s*\(\s*'ready'\s*,\s*'failed'\s*\)/i);
    expect(sql).toMatch(/THEN\s+now\(\)/i);
    expect(sql).toMatch(/ELSE\s+NULL/i);
  });
});
