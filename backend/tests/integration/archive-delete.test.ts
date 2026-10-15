/**
 * Integration tests for the archive / unarchive / hard-delete lifecycle
 * across projects, content items, and todos.
 *
 * Semantics being enforced:
 *   DELETE /api/v1/<entity>/:id          → soft delete (archive)
 *   DELETE /api/v1/<entity>/:id?hard=true → hard delete
 *   POST   /api/v1/<entity>/:id/restore   → unarchive
 *   GET    /api/v1/<entity>?include_archived=true
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApp } from '../../src/app.js';
import type { ServiceDeps } from '../../src/services/index.js';

function mockDeps(): ServiceDeps {
  return {
    db: {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      pool: {} as any,
      transaction: vi.fn().mockImplementation(async (fn: any) => fn({ query: vi.fn().mockResolvedValue({ rows: [] }) })),
      close: vi.fn(),
    } as any,
    embeddingProvider: {
      embed: vi.fn().mockResolvedValue(new Array(3072).fill(0.1)),
      dimensions: 3072,
    },
    metadataLLM: {
      complete: vi.fn().mockResolvedValue({
        content: '{}',
        tokensUsed: { input: 0, output: 0, total: 0 },
      }),
    },
    mediaMetadataLLM: {
      complete: vi.fn().mockResolvedValue({
        content: JSON.stringify({ title: 'Auto-generated', topics: [], extracted_text: null }),
        tokensUsed: { input: 0, output: 0, total: 0 },
      }),
    },
    ragFastLLM: {

      complete: vi.fn().mockResolvedValue({

        content: 'ok',

        tokensUsed: { input: 0, output: 0, total: 0 },

      }),

    },

    ragDeepLLM: {

      complete: vi.fn().mockResolvedValue({

        content: "Thorough answer",

        tokensUsed: { input: 0, output: 0, total: 0 },

      }),

    },

    queryDepthLLM: {

      complete: vi.fn().mockResolvedValue({

        content: JSON.stringify({ depth: "fast", reason: "test" }),

        tokensUsed: { input: 0, output: 0, total: 0 },

      }),

    },
    blobStorage: {
      upload: vi.fn().mockResolvedValue('https://blob/url'),
      exists: vi.fn().mockResolvedValue(false),
      getUrl: vi.fn().mockReturnValue('https://blob/url'),
      getReadSasUrl: vi.fn((u: string) => u),
    },
    config: { apiKey: 'test-key' } as any,
  };
}

const AUTH = { 'Authorization': 'Bearer test-key' };

describe('Projects archive/restore/hard-delete', () => {
  let deps: ServiceDeps;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    deps = mockDeps();
    app = createApp(deps);
  });

  it('DELETE /projects/:id soft-archives by default (status → archived)', async () => {
    const res = await app.fetch(new Request('http://localhost/api/v1/projects/11111111-1111-1111-1111-111111111111', {
      method: 'DELETE', headers: AUTH,
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, mode: 'archived' });

    // Should have called UPDATE projects SET status = 'archived'
    const calls = vi.mocked(deps.db.query).mock.calls;
    const archiveCall = calls.find((c) => typeof c[0] === 'string' && c[0].includes("status = 'archived'"));
    expect(archiveCall).toBeDefined();
  });

  it('DELETE /projects/:id?hard=true runs scrub-and-delete inside a transaction', async () => {
    // The hard delete runs two SQL statements inside db.transaction.
    // Our transaction mock passes a tx with its own query mock — verify transaction was used.
    const res = await app.fetch(new Request('http://localhost/api/v1/projects/11111111-1111-1111-1111-111111111111?hard=true', {
      method: 'DELETE', headers: AUTH,
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, mode: 'hard' });
    expect(deps.db.transaction).toHaveBeenCalled();
  });

  it('POST /projects/:id/restore unarchives (status → active)', async () => {
    const res = await app.fetch(new Request('http://localhost/api/v1/projects/11111111-1111-1111-1111-111111111111/restore', {
      method: 'POST', headers: AUTH,
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const calls = vi.mocked(deps.db.query).mock.calls;
    const restoreCall = calls.find((c) => typeof c[0] === 'string' && c[0].includes("status = 'active'"));
    expect(restoreCall).toBeDefined();
  });
});

describe('Content items archive/restore/hard-delete', () => {
  let deps: ServiceDeps;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    deps = mockDeps();
    app = createApp(deps);
  });

  it('DELETE /content/:id soft-archives by default (archived → true)', async () => {
    const res = await app.fetch(new Request('http://localhost/api/v1/content/22222222-2222-2222-2222-222222222222', {
      method: 'DELETE', headers: AUTH,
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, mode: 'archived' });

    const calls = vi.mocked(deps.db.query).mock.calls;
    const archiveCall = calls.find((c) => typeof c[0] === 'string' && c[0].includes('archived = true'));
    expect(archiveCall).toBeDefined();
  });

  it('DELETE /content/:id?hard=true runs DELETE FROM content_items', async () => {
    const res = await app.fetch(new Request('http://localhost/api/v1/content/22222222-2222-2222-2222-222222222222?hard=true', {
      method: 'DELETE', headers: AUTH,
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, mode: 'hard' });

    const calls = vi.mocked(deps.db.query).mock.calls;
    const deleteCall = calls.find((c) => typeof c[0] === 'string' && c[0].includes('DELETE FROM content_items'));
    expect(deleteCall).toBeDefined();
  });

  it('POST /content/:id/restore unarchives', async () => {
    const res = await app.fetch(new Request('http://localhost/api/v1/content/22222222-2222-2222-2222-222222222222/restore', {
      method: 'POST', headers: AUTH,
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const calls = vi.mocked(deps.db.query).mock.calls;
    const restoreCall = calls.find((c) => typeof c[0] === 'string' && c[0].includes('archived = false'));
    expect(restoreCall).toBeDefined();
  });

  it('GET /content?include_archived=true passes the filter through', async () => {
    vi.mocked(deps.db.query).mockResolvedValueOnce({ rows: [] } as any);
    const res = await app.fetch(new Request('http://localhost/api/v1/content?include_archived=true', {
      headers: AUTH,
    }));
    expect(res.status).toBe(200);

    // When include_archived is true, the service should NOT add the `archived = false` condition
    const calls = vi.mocked(deps.db.query).mock.calls;
    const selectCall = calls.find((c) => typeof c[0] === 'string' && c[0].includes('FROM content_items'));
    expect(selectCall).toBeDefined();
    expect(selectCall![0]).not.toContain('archived = false');
  });

  it('GET /content (default) excludes archived items', async () => {
    vi.mocked(deps.db.query).mockResolvedValueOnce({ rows: [] } as any);
    const res = await app.fetch(new Request('http://localhost/api/v1/content', { headers: AUTH }));
    expect(res.status).toBe(200);

    const calls = vi.mocked(deps.db.query).mock.calls;
    const selectCall = calls.find((c) => typeof c[0] === 'string' && c[0].includes('FROM content_items'));
    expect(selectCall![0]).toContain('archived = false');
  });
});

describe('Todos archive/restore/hard-delete', () => {
  let deps: ServiceDeps;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    deps = mockDeps();
    app = createApp(deps);
  });

  it('DELETE /todos/:id soft-archives by default', async () => {
    const res = await app.fetch(new Request('http://localhost/api/v1/todos/33333333-3333-3333-3333-333333333333', {
      method: 'DELETE', headers: AUTH,
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, mode: 'archived' });

    const calls = vi.mocked(deps.db.query).mock.calls;
    const archiveCall = calls.find((c) => typeof c[0] === 'string' && c[0].includes('UPDATE todos') && c[0].includes('archived = true'));
    expect(archiveCall).toBeDefined();
  });

  it('DELETE /todos/:id?hard=true deletes the row', async () => {
    const res = await app.fetch(new Request('http://localhost/api/v1/todos/33333333-3333-3333-3333-333333333333?hard=true', {
      method: 'DELETE', headers: AUTH,
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, mode: 'hard' });

    const calls = vi.mocked(deps.db.query).mock.calls;
    const deleteCall = calls.find((c) => typeof c[0] === 'string' && c[0].includes('DELETE FROM todos'));
    expect(deleteCall).toBeDefined();
  });

  it('POST /todos/:id/restore unarchives', async () => {
    const res = await app.fetch(new Request('http://localhost/api/v1/todos/33333333-3333-3333-3333-333333333333/restore', {
      method: 'POST', headers: AUTH,
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const calls = vi.mocked(deps.db.query).mock.calls;
    const restoreCall = calls.find((c) => typeof c[0] === 'string' && c[0].includes('UPDATE todos') && c[0].includes('archived = false'));
    expect(restoreCall).toBeDefined();
  });
});

describe('Search excludes archived items (regression)', () => {
  let deps: ServiceDeps;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    deps = mockDeps();
    app = createApp(deps);
  });

  it('search runs SQL that filters archived content_items', async () => {
    vi.mocked(deps.db.query).mockResolvedValue({ rows: [] } as any);
    const res = await app.fetch(new Request('http://localhost/api/v1/search', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test' }),
    }));
    expect(res.status).toBe(200);

    const calls = vi.mocked(deps.db.query).mock.calls;
    // findSimilarChunks joins content_items and filters ci.archived = false
    const chunkSearch = calls.find((c) => typeof c[0] === 'string' && c[0].includes('FROM chunks'));
    expect(chunkSearch).toBeDefined();
    expect(chunkSearch![0]).toContain('archived = false');

    // findSimilarTodos filters archived = false
    const todoSearch = calls.find((c) => typeof c[0] === 'string' && c[0].includes('FROM todos'));
    expect(todoSearch).toBeDefined();
    expect(todoSearch![0]).toContain('archived = false');
  });
});

describe('Project hard-delete cascade (scrub orphan UUIDs)', () => {
  let deps: ServiceDeps;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    deps = mockDeps();
    app = createApp(deps);
  });

  it('hard-delete runs array_remove on content_items.project_ids inside the transaction', async () => {
    const txQuery = vi.fn().mockResolvedValue({ rows: [] });
    vi.mocked(deps.db.transaction).mockImplementation(async (fn: any) => fn({ query: txQuery }));

    const res = await app.fetch(new Request('http://localhost/api/v1/projects/11111111-1111-1111-1111-111111111111?hard=true', {
      method: 'DELETE', headers: AUTH,
    }));
    expect(res.status).toBe(200);

    // Verify the transaction ran two queries: array_remove + DELETE FROM projects
    const queries = txQuery.mock.calls.map((c) => c[0]);
    const scrubQ = queries.find((q: string) => q.includes('array_remove(project_ids'));
    const deleteQ = queries.find((q: string) => q.includes('DELETE FROM projects'));
    expect(scrubQ).toBeDefined();
    expect(deleteQ).toBeDefined();
  });
});
