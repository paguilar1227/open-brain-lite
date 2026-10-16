/**
 * Integration tests for the REST API endpoints.
 * Exercise the full Hono handler flow with mocked service deps.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApp } from '../../src/app.js';
import type { ServiceDeps } from '../../src/services/index.js';

function mockDeps(): ServiceDeps {
  const deps: ServiceDeps = {
    db: {
      query: vi.fn(),
      pool: {} as any,
      transaction: vi.fn().mockImplementation(async (fn: any) => fn({
        query: vi.fn().mockResolvedValue({ rows: [] }),
      })),
      close: vi.fn(),
    } as any,
    embeddingProvider: {
      embed: vi.fn().mockResolvedValue(new Array(3072).fill(0.1)),
      dimensions: 3072,
    },
    metadataLLM: {
      complete: vi.fn().mockResolvedValue({
        content: JSON.stringify({ title: 'Auto-generated', topics: [], tags: [], extracted_text: null }),
        tokensUsed: { input: 0, output: 0, total: 0 },
      }),
    },
    mediaMetadataLLM: {
      complete: vi.fn().mockResolvedValue({
        content: JSON.stringify({ title: 'Auto-generated', topics: [], tags: [], extracted_text: null }),
        tokensUsed: { input: 0, output: 0, total: 0 },
      }),
    },
    ragFastLLM: {
      complete: vi.fn().mockResolvedValue({
        content: 'Answer with context [1].',
        tokensUsed: { input: 0, output: 0, total: 0 },
      }),
    },
    ragDeepLLM: {
      complete: vi.fn().mockResolvedValue({
        content: 'Thorough answer with context [1].',
        tokensUsed: { input: 0, output: 0, total: 0 },
      }),
    },
    queryDepthLLM: {
      complete: vi.fn().mockResolvedValue({
        content: JSON.stringify({ depth: 'fast', reason: 'test' }),
        tokensUsed: { input: 0, output: 0, total: 0 },
      }),
    },
    blobStorage: {
      upload: vi.fn().mockResolvedValue('https://blob/file'),
      exists: vi.fn().mockResolvedValue(false),
      getUrl: vi.fn().mockReturnValue('https://blob/file'),
      download: vi.fn().mockResolvedValue(Buffer.from('mock-bytes')),
      getReadSasUrl: vi.fn((u: string) => u),
    },
    config: { apiKey: 'test-key' } as any,
  };  vi.mocked(deps.db.transaction).mockImplementation(async (fn: any) => fn({ query: deps.db.query }));
  return deps;
}

const AUTH = { 'Authorization': 'Bearer test-key' };

describe('Auth gate (/api/v1/*)', () => {
  let deps: ServiceDeps;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    deps = mockDeps();
    app = createApp(deps);
  });

  it('rejects request with no auth at all', async () => {
    const res = await app.fetch(new Request('http://localhost/api/v1/projects'));
    expect(res.status).toBe(401);
  });

  it('rejects request with wrong Bearer key', async () => {
    const res = await app.fetch(new Request('http://localhost/api/v1/projects', {
      headers: { 'Authorization': 'Bearer wrong-key' },
    }));
    expect(res.status).toBe(401);
  });

  it('rejects principal headers on /api/v1/* (Bearer-only surface)', async () => {
    // /api/v1/* is Bearer-only. Browser sessions exchange the cookie for a
    // Bearer key via /api/auth/token (see token-exchange tests below) and
    // then call /api/v1/* with that Bearer.
    const res = await app.fetch(new Request('http://localhost/api/v1/projects', {
      headers: {
        'x-ms-client-principal-id': 'a-real-entra-object-id',
        'x-ms-client-principal-name': 'pablo@example.com',
      },
    }));
    expect(res.status).toBe(401);
  });
});

describe('Token exchange (/api/auth/token)', () => {
  let deps: ServiceDeps;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    deps = mockDeps();
    app = createApp(deps);
  });

  it('returns 401 when no Easy Auth principal headers are present', async () => {
    // In production this path is gated by Easy Auth itself: anonymous
    // browsers get redirected to AAD login before hitting our handler.
    // The 401 is a defense-in-depth check for the case where Easy Auth
    // is misconfigured or bypassed.
    const res = await app.fetch(new Request('http://localhost/api/auth/token'));
    expect(res.status).toBe(401);
  });

  it('does not trust spoofable cloud principal headers', async () => {
    const res = await app.fetch(new Request('http://localhost/api/auth/token', {
      headers: {
        'x-ms-client-principal-id': 'a-real-entra-object-id',
        'x-ms-client-principal-name': 'pablo@example.com',
      },
    }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.key).toBeUndefined();

  });

  it('does not accept a cloud principal as local authentication', async () => {
    const res = await app.fetch(new Request('http://localhost/api/auth/token', {
      headers: { 'x-ms-client-principal': 'eyJhbGciOiJIUzI1NiJ9.opaque-base64' },
    }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.key).toBeUndefined();

  });
});

describe('Projects API', () => {
  let deps: ServiceDeps;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    deps = mockDeps();
    app = createApp(deps);
  });

  it('creates a project', async () => {
    vi.mocked(deps.db.query).mockResolvedValueOnce({
      rows: [{ id: 'p1', name: 'Test', description: 'desc', status: 'active', created_at: new Date(), updated_at: new Date() }],
    } as any);

    const res = await app.fetch(new Request('http://localhost/api/v1/projects', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', description: 'desc' }),
    }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.project.id).toBe('p1');
    expect(body.project.name).toBe('Test');
  });

  it('rejects project creation without name', async () => {
    const res = await app.fetch(new Request('http://localhost/api/v1/projects', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'no name' }),
    }));
    expect(res.status).toBe(400);
  });

  it('lists projects', async () => {
    vi.mocked(deps.db.query).mockResolvedValueOnce({
      rows: [
        { id: 'p1', name: 'A', status: 'active', created_at: new Date(), updated_at: new Date() },
        { id: 'p2', name: 'B', status: 'active', created_at: new Date(), updated_at: new Date() },
      ],
    } as any);

    const res = await app.fetch(new Request('http://localhost/api/v1/projects', { headers: AUTH }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toHaveLength(2);
  });

  it('returns 404 for well-formed UUID that does not exist', async () => {
    vi.mocked(deps.db.query).mockResolvedValueOnce({ rows: [] } as any);
    // Use a well-formed UUID so it passes UUID validation and hits the DB lookup.
    const res = await app.fetch(new Request('http://localhost/api/v1/projects/00000000-0000-4000-8000-000000000000', { headers: AUTH }));
    expect(res.status).toBe(404);
  });

  it('returns 400 for malformed UUID (not a raw Postgres error)', async () => {
    const res = await app.fetch(new Request('http://localhost/api/v1/projects/not-a-uuid', { headers: AUTH }));
    expect(res.status).toBe(400);
    const body = await res.json();
    // Zod default uuid() error reads "Invalid uuid". Match case-insensitively
    // so the test survives small message-format drift across zod-openapi
    // versions.
    expect(body.error.toLowerCase()).toContain('invalid uuid');
  });
});

describe('Content items API', () => {
  let deps: ServiceDeps;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    deps = mockDeps();
    app = createApp(deps);
  });

  it('creates a note via JSON (no file)', async () => {
    // Sequence of DB calls for the content-items service:
    // 1. insertContentItem returns the new id
    // 2. insertChunks (via transaction) — handled by transaction mock
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO content_items')) {
        return { rows: [{ id: 'c1' }] } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request('http://localhost/api/v1/content', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'note',
        content: 'Some note content',
        project_ids: ['proj-1'],
      }),
    }));

    // Async ingest contract: 202 + {id, status}. Title surfaces later via
    // GET /content/:id once processing_status flips to 'ready'.
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.id).toBe('c1');
    expect(body.status).toBe('pending');
  });

  it('background tail flips processing_status to ready after POST returns', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      if (sql.includes('INSERT INTO content_items')) return { rows: [{ id: 'c-async-1' }] } as any;
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request('http://localhost/api/v1/content', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'note', content: 'Background tail test' }),
    }));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe('pending');

    // Let the background completion microtasks settle.
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    // The tail must have fired UPDATE … SET processing_status = 'ready'.
    const readyUpdate = queries.find(
      (q) => /UPDATE\s+content_items/i.test(q.sql)
        && /processing_status\s*=\s*\$1/.test(q.sql)
        && q.params[0] === 'ready',
    );
    expect(readyUpdate).toBeDefined();
  });

  it('background tail flips processing_status to failed when the pipeline throws', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      if (sql.includes('INSERT INTO content_items')) return { rows: [{ id: 'c-fail-1' }] } as any;
      return { rows: [] } as any;
    });
    // Force chunk embedding to blow up. extractMetadata swallows LLM errors
    // (returns FALLBACK), but the embedding provider's failure does propagate
    // up through runIngestTail's catch.
    vi.mocked(deps.embeddingProvider.embed).mockRejectedValue(new Error('embedding service down'));

    const res = await app.fetch(new Request('http://localhost/api/v1/content', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'note', content: 'Failure path test' }),
    }));
    expect(res.status).toBe(202);

    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    const failedUpdate = queries.find(
      (q) => /UPDATE\s+content_items/i.test(q.sql)
        && /processing_status\s*=\s*\$1/.test(q.sql)
        && q.params[0] === 'failed',
    );
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate!.params[1]).toContain('embedding service down');
  });

  it('GET /content/:id/status returns the slim polling shape for a known id', async () => {
    const fakeId = '11111111-1111-1111-1111-111111111111';
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      // The status query joins chunks for chunk_count. Match by SELECT shape
      // so a future addition of more columns doesn't silently break the test.
      if (/FROM\s+content_items\s+ci/i.test(sql) && /chunk_count/i.test(sql)) {
        return {
          rows: [{
            id: fakeId,
            type: 'document',
            title: 'Polling fixture',
            processing_status: 'ready',
            processing_error: null,
            ingest_started_at: new Date('2026-04-30T12:00:00Z'),
            ingest_completed_at: new Date('2026-04-30T12:00:08Z'),
            chunk_count: 3,
          }],
        } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(`http://localhost/api/v1/content/${fakeId}/status`, {
      headers: { ...AUTH },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      id: fakeId,
      type: 'document',
      title: 'Polling fixture',
      processing_status: 'ready',
      processing_error: null,
      ingest_started_at: '2026-04-30T12:00:00.000Z',
      ingest_completed_at: '2026-04-30T12:00:08.000Z',
      chunk_count: 3,
    });
    // Slim contract: explicitly NO content body / metadata / blob_url /
    // embedding. Adding any of those silently would defeat the bandwidth
    // win that motivates this endpoint.
    expect(body).not.toHaveProperty('content');
    expect(body).not.toHaveProperty('metadata');
    expect(body).not.toHaveProperty('embedding');
    expect(body).not.toHaveProperty('blob_url');
  });

  it('GET /content/:id/status returns 404 for an unknown id', async () => {
    vi.mocked(deps.db.query).mockResolvedValue({ rows: [] } as any);
    const res = await app.fetch(new Request(
      'http://localhost/api/v1/content/22222222-2222-2222-2222-222222222222/status',
      { headers: { ...AUTH } },
    ));
    expect(res.status).toBe(404);
  });

  it('GET /content/:id/status returns 400 for a non-UUID id', async () => {
    const res = await app.fetch(new Request('http://localhost/api/v1/content/not-a-uuid/status', {
      headers: { ...AUTH },
    }));
    expect(res.status).toBe(400);
  });

  it('POST /content/:id/retry resets a failed row and returns 202 + pending', async () => {
    const fakeId = '33333333-3333-3333-3333-333333333333';
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      // The row lookup. Mark as failed so retry is allowed.
      if (/SELECT \* FROM content_items WHERE id = \$1/i.test(sql)) {
        return {
          rows: [{
            id: fakeId,
            type: 'note',
            title: 'Previously failed',
            content: 'Original text body that survived prelude.',
            blob_url: null,
            mime_type: null,
            file_hash: null,
            project_ids: [],
            tags: [],
            embedding: null,
            metadata: { ingest_trace: {} },
            source_url: null,
            published_at: null,
            archived: false,
            processing_status: 'failed',
            processing_error: 'embedding service down',
            ingest_completed_at: new Date(),
            created_at: new Date(),
            updated_at: new Date(),
          }],
        } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(`http://localhost/api/v1/content/${fakeId}/retry`, {
      method: 'POST',
      headers: { ...AUTH },
    }));

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({ id: fakeId, status: 'pending' });

    // Side effects we care about: chunks deleted + status reset to 'pending'
    // BEFORE the tail re-runs. (The tail then UPDATEs to 'ready' or 'failed',
    // but that's racey w.r.t. the response — we only assert the synchronous
    // pre-tail work here.)
    const chunksDeleted = queries.find(
      (q) => /DELETE\s+FROM\s+chunks/i.test(q.sql) && q.params[0] === fakeId,
    );
    expect(chunksDeleted).toBeDefined();

    const statusReset = queries.find(
      (q) => /UPDATE\s+content_items/i.test(q.sql)
        && /processing_status\s*=\s*'pending'/.test(q.sql)
        && q.params[0] === fakeId,
    );
    expect(statusReset).toBeDefined();
  });

  it('POST /content/:id/retry returns 409 when the row is already ready', async () => {
    const fakeId = '44444444-4444-4444-4444-444444444444';
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/SELECT \* FROM content_items WHERE id = \$1/i.test(sql)) {
        return {
          rows: [{
            id: fakeId, type: 'note', title: 'Healthy', content: 'fine',
            blob_url: null, mime_type: null, file_hash: null,
            project_ids: [], tags: [], embedding: null, metadata: {},
            source_url: null, published_at: null, archived: false,
            processing_status: 'ready', processing_error: null,
            ingest_completed_at: new Date(),
            created_at: new Date(), updated_at: new Date(),
          }],
        } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(`http://localhost/api/v1/content/${fakeId}/retry`, {
      method: 'POST',
      headers: { ...AUTH },
    }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('ALREADY_READY');
  });

  it('POST /content/:id/retry returns 409 when the row is still pending (in-flight)', async () => {
    const fakeId = '55555555-5555-5555-5555-555555555555';
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/SELECT \* FROM content_items WHERE id = \$1/i.test(sql)) {
        return {
          rows: [{
            id: fakeId, type: 'note', title: 'Processing…', content: null,
            blob_url: null, mime_type: null, file_hash: null,
            project_ids: [], tags: [], embedding: null, metadata: {},
            source_url: null, published_at: null, archived: false,
            processing_status: 'pending', processing_error: null,
            ingest_completed_at: null,
            created_at: new Date(), updated_at: new Date(),
          }],
        } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(`http://localhost/api/v1/content/${fakeId}/retry`, {
      method: 'POST',
      headers: { ...AUTH },
    }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('IN_FLIGHT');
  });

  it('POST /content/:id/retry returns 404 for an unknown id', async () => {
    vi.mocked(deps.db.query).mockResolvedValue({ rows: [] } as any);
    const res = await app.fetch(new Request(
      'http://localhost/api/v1/content/66666666-6666-6666-6666-666666666666/retry',
      { method: 'POST', headers: { ...AUTH } },
    ));
    expect(res.status).toBe(404);
  });

  it('POST /content/:id/retry returns 400 for a non-UUID id', async () => {
    const res = await app.fetch(new Request('http://localhost/api/v1/content/not-a-uuid/retry', {
      method: 'POST',
      headers: { ...AUTH },
    }));
    expect(res.status).toBe(400);
  });

  it('PUT /content/:id rejects body in payload — body edits live at /edit-body', async () => {
    // Regression for the silent-desync footgun: PUT used to accept content
    // and inline-rechunk regardless of blob_url. We now refuse.
    const res = await app.fetch(new Request(
      'http://localhost/api/v1/content/11111111-1111-4111-8111-111111111111',
      {
        method: 'PUT',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'New body that should never reach the DB' }),
      },
    ));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/edit-body/);
  });

  it('PUT /content/:id re-files the note into a folder (folder round-trip)', async () => {
    // Regression for the Notes-view bug: editing the folder chip down to a
    // single segment (travel/japan → travel) must persist as a first-class
    // `folder` field, not vanish. The whole point of migration 009.
    const fakeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const row = (folder: string | null) => ({
      id: fakeId, type: 'note', title: 'Tokyo bucket list', content: 'body',
      blob_url: null, mime_type: null, file_hash: null,
      project_ids: [], tags: [], folder, embedding: null, metadata: {},
      source_url: null, published_at: null, archived: false,
      processing_status: 'ready', processing_error: null,
      ingest_completed_at: new Date(), pinned_at: null,
      created_at: new Date(), updated_at: new Date(),
    });
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      if (/UPDATE\s+content_items\s+SET/i.test(sql)) {
        // Echo back the folder param the handler sent so the response reflects it.
        const folderParam = (params ?? []).includes('travel') ? 'travel' : null;
        return { rows: [row(folderParam)] } as any;
      }
      return { rows: [row('travel')] } as any;
    });

    const res = await app.fetch(new Request(
      `http://localhost/api/v1/content/${fakeId}`,
      { method: 'PUT', headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: 'travel' }) },
    ));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.item.folder).toBe('travel');

    const upd = queries.find((q) => /UPDATE\s+content_items\s+SET/i.test(q.sql));
    expect(upd!.sql).toMatch(/folder\s*=\s*\$/);
    expect(upd!.params).toContain('travel');
  });

  it('PUT /content/:id with folder:null unfiles the note', async () => {
    const fakeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      if (/UPDATE\s+content_items\s+SET/i.test(sql)) {
        return { rows: [{
          id: fakeId, type: 'note', title: 'Tokyo', content: 'body',
          blob_url: null, mime_type: null, file_hash: null,
          project_ids: [], tags: [], folder: null, embedding: null, metadata: {},
          source_url: null, published_at: null, archived: false,
          processing_status: 'ready', processing_error: null,
          ingest_completed_at: new Date(), pinned_at: null,
          created_at: new Date(), updated_at: new Date(),
        }] } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(
      `http://localhost/api/v1/content/${fakeId}`,
      { method: 'PUT', headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: null }) },
    ));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.item.folder).toBeNull();

    const upd = queries.find((q) => /UPDATE\s+content_items\s+SET/i.test(q.sql));
    expect(upd!.sql).toMatch(/folder\s*=\s*\$/);
    expect(upd!.params).toContain(null);
  });

  it('POST /content/:id/edit-body returns 202 + pending on a text-only note', async () => {
    const fakeId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      if (/SELECT \* FROM content_items WHERE id = \$1/i.test(sql)) {
        return {
          rows: [{
            id: fakeId, type: 'note', title: 'My note',
            content: 'old body', blob_url: null, mime_type: null, file_hash: null,
            project_ids: [], tags: [], embedding: null, metadata: {},
            source_url: null, published_at: null, archived: false,
            processing_status: 'ready', processing_error: null,
            ingest_completed_at: new Date(),
            created_at: new Date(), updated_at: new Date(),
          }],
        } as any;
      }
      // dbUpdate (UPDATE ... RETURNING *) needs to return at least one row
      // for the body-write step to succeed.
      if (/UPDATE\s+content_items\s+SET/i.test(sql)) {
        return { rows: [{ id: fakeId }] } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(
      `http://localhost/api/v1/content/${fakeId}/edit-body`,
      {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'shiny new markdown body' }),
      },
    ));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({ id: fakeId, status: 'pending' });

    // Pre-tail synchronous side effects we must observe before responding.
    const chunksDeleted = queries.find(
      (q) => /DELETE\s+FROM\s+chunks/i.test(q.sql) && q.params[0] === fakeId,
    );
    expect(chunksDeleted).toBeDefined();
    const statusReset = queries.find(
      (q) => /UPDATE\s+content_items/i.test(q.sql)
        && /processing_status\s*=\s*'pending'/.test(q.sql),
    );
    expect(statusReset).toBeDefined();
  });

  it('POST /content/:id/edit-body returns 409 BODY_IMMUTABLE when blob_url is set', async () => {
    const fakeId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/SELECT \* FROM content_items WHERE id = \$1/i.test(sql)) {
        return {
          rows: [{
            id: fakeId, type: 'document', title: 'My PDF',
            content: 'extracted text from the pdf',
            blob_url: 'https://blob/example.pdf',  // <-- the gate
            mime_type: 'application/pdf', file_hash: 'abc',
            project_ids: [], tags: [], embedding: null, metadata: {},
            source_url: null, published_at: null, archived: false,
            processing_status: 'ready', processing_error: null,
            ingest_completed_at: new Date(),
            created_at: new Date(), updated_at: new Date(),
          }],
        } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(
      `http://localhost/api/v1/content/${fakeId}/edit-body`,
      {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'rewriting the PDF text by hand — DO NOT' }),
      },
    ));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('BODY_IMMUTABLE');
    expect(body.error).toMatch(/archive-and-reupload/i);
  });

  it('POST /content/:id/edit-body returns 409 IN_FLIGHT when row is pending', async () => {
    const fakeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/SELECT \* FROM content_items WHERE id = \$1/i.test(sql)) {
        return {
          rows: [{
            id: fakeId, type: 'note', title: 'Still ingesting',
            content: 'partial', blob_url: null, mime_type: null, file_hash: null,
            project_ids: [], tags: [], embedding: null, metadata: {},
            source_url: null, published_at: null, archived: false,
            processing_status: 'pending', processing_error: null,
            ingest_completed_at: null,
            created_at: new Date(), updated_at: new Date(),
          }],
        } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(
      `http://localhost/api/v1/content/${fakeId}/edit-body`,
      {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'new content' }),
      },
    ));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('IN_FLIGHT');
  });

  it('POST /content/:id/edit-body returns 404 / 400 / empty-content errors', async () => {
    vi.mocked(deps.db.query).mockImplementation(async () => ({ rows: [] } as any));

    const notFound = await app.fetch(new Request(
      'http://localhost/api/v1/content/77777777-7777-7777-7777-777777777777/edit-body',
      { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'x' }) },
    ));
    expect(notFound.status).toBe(404);

    const badUuid = await app.fetch(new Request(
      'http://localhost/api/v1/content/not-a-uuid/edit-body',
      { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'x' }) },
    ));
    expect(badUuid.status).toBe(400);

    const empty = await app.fetch(new Request(
      'http://localhost/api/v1/content/77777777-7777-7777-7777-777777777777/edit-body',
      { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: '' }) },
    ));
    expect(empty.status).toBe(400);
    expect((await empty.json()).error).toMatch(/non-empty/);
  });

  it('POST /content/:id/replace creates a v2 and archives v1 with metadata cross-links', async () => {
    const oldId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    const newRowId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    let insertCount = 0;
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      // The lookup of the old row.
      if (/SELECT \* FROM content_items WHERE id = \$1/i.test(sql) && params?.[0] === oldId) {
        return {
          rows: [{
            id: oldId, type: 'document', title: 'Spec v1',
            content: 'v1 body',
            blob_url: null, mime_type: null, file_hash: null,
            project_ids: ['proj-1'], tags: ['spec'],
            embedding: null, metadata: { ingest_trace: {} },
            source_url: null, published_at: null, archived: false,
            processing_status: 'ready', processing_error: null,
            ingest_completed_at: new Date(),
            created_at: new Date(), updated_at: new Date(),
          }],
        } as any;
      }
      // The early-row insert in the new createContentItem returns the new id.
      if (/INSERT INTO content_items/i.test(sql)) {
        insertCount++;
        return { rows: [{ id: newRowId }] } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(
      `http://localhost/api/v1/content/${oldId}/replace`,
      {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'v2 body — improved' }),
      },
    ));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({ old_id: oldId, new_id: newRowId, status: 'pending' });

    // A new row was inserted (one INSERT into content_items).
    expect(insertCount).toBe(1);

    // The old row was archived. We assert via the UPDATE statement and id param.
    const oldArchive = queries.find(
      (q) => /UPDATE content_items SET archived = true/i.test(q.sql) && q.params[0] === oldId,
    );
    expect(oldArchive).toBeDefined();

    // The new row carried over project_ids and tags from the old. We can
    // see this via the INSERT's parameters. (project_ids is the 8th, tags
    // the 9th — see insertContentItem in src/db/content-items.ts.)
    const insertQ = queries.find((q) => /INSERT INTO content_items/i.test(q.sql));
    expect(insertQ!.params[7]).toEqual(['proj-1']);
    expect(insertQ!.params[8]).toEqual(['spec']);

    // Regression: every metadata UPDATE on the new row must carry the
    // `replaces: oldId` cross-link. Two separate UPDATEs run in the tail —
    // the post-metadata one and the post-graph trace persist — and both
    // overwrite metadata, so both must include the field.
    const newRowMetaUpdates = queries.filter(
      (q) =>
        /UPDATE content_items SET .*metadata = /i.test(q.sql) &&
        q.params[q.params.length - 1] === newRowId,
    );
    expect(newRowMetaUpdates.length).toBeGreaterThanOrEqual(1);
    for (const q of newRowMetaUpdates) {
      const metaParam = q.params.find(
        (p) => typeof p === 'string' && p.startsWith('{') && p.includes('"ingest_trace"'),
      );
      expect(metaParam, `metadata UPDATE missing ingest_trace param: ${q.sql}`).toBeDefined();
      const meta = JSON.parse(metaParam as string);
      expect(meta.replaces).toBe(oldId);
    }

    // The old row got `replaced_by` stamped before being archived.
    const oldRowMetaUpdate = queries.find(
      (q) =>
        /UPDATE content_items SET .*metadata = /i.test(q.sql) &&
        q.params[q.params.length - 1] === oldId,
    );
    expect(oldRowMetaUpdate).toBeDefined();
    const oldMetaParam = oldRowMetaUpdate!.params.find(
      (p) => typeof p === 'string' && p.startsWith('{') && p.includes('"replaced_by"'),
    );
    expect(oldMetaParam).toBeDefined();
    expect(JSON.parse(oldMetaParam as string).replaced_by).toBe(newRowId);
  });

  it('POST /content/:id/replace returns 409 IN_FLIGHT when the old row is still pending', async () => {
    const oldId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/SELECT \* FROM content_items WHERE id = \$1/i.test(sql)) {
        return {
          rows: [{
            id: oldId, type: 'note', title: 'In-flight',
            content: null, blob_url: null, mime_type: null, file_hash: null,
            project_ids: [], tags: [], embedding: null, metadata: {},
            source_url: null, published_at: null, archived: false,
            processing_status: 'pending', processing_error: null,
            ingest_completed_at: null,
            created_at: new Date(), updated_at: new Date(),
          }],
        } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(
      `http://localhost/api/v1/content/${oldId}/replace`,
      {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'v2' }),
      },
    ));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('IN_FLIGHT');
  });

  it('POST /content/:id/replace returns 400 when neither file nor content is provided', async () => {
    const oldId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/SELECT \* FROM content_items WHERE id = \$1/i.test(sql)) {
        return {
          rows: [{
            id: oldId, type: 'note', title: 'X',
            content: 'old', blob_url: null, mime_type: null, file_hash: null,
            project_ids: [], tags: [], embedding: null, metadata: {},
            source_url: null, published_at: null, archived: false,
            processing_status: 'ready', processing_error: null,
            ingest_completed_at: new Date(),
            created_at: new Date(), updated_at: new Date(),
          }],
        } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(
      `http://localhost/api/v1/content/${oldId}/replace`,
      { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
    ));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/file.*content/i);
  });

  it('POST /content/:id/replace returns 404 / 400 errors as appropriate', async () => {
    vi.mocked(deps.db.query).mockImplementation(async () => ({ rows: [] } as any));

    const notFound = await app.fetch(new Request(
      'http://localhost/api/v1/content/77777777-7777-7777-7777-777777777777/replace',
      { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'x' }) },
    ));
    expect(notFound.status).toBe(404);

    const badUuid = await app.fetch(new Request(
      'http://localhost/api/v1/content/not-a-uuid/replace',
      { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'x' }) },
    ));
    expect(badUuid.status).toBe(400);
  });

  it('POST /content/:id/reprocess works on a healthy ready row (the differentiator vs retry)', async () => {
    const fakeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      if (/SELECT \* FROM content_items WHERE id = \$1/i.test(sql)) {
        return {
          rows: [{
            id: fakeId, type: 'note', title: 'Healthy doc',
            content: 'Body content that should re-chunk fine.',
            blob_url: null, mime_type: null, file_hash: null,
            project_ids: [], tags: [], embedding: null, metadata: {},
            source_url: null, published_at: null, archived: false,
            processing_status: 'ready',
            processing_error: null,
            ingest_completed_at: new Date(),
            created_at: new Date(), updated_at: new Date(),
          }],
        } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(`http://localhost/api/v1/content/${fakeId}/reprocess`, {
      method: 'POST',
      headers: { ...AUTH },
    }));

    // Critical: reprocess on 'ready' is the WHOLE POINT (retry would 409 here).
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({ id: fakeId, status: 'pending' });

    // Same pre-tail mechanics as retry: chunks gone, status flipped to pending.
    const chunksDeleted = queries.find(
      (q) => /DELETE\s+FROM\s+chunks/i.test(q.sql) && q.params[0] === fakeId,
    );
    expect(chunksDeleted).toBeDefined();
    const statusReset = queries.find(
      (q) => /UPDATE\s+content_items/i.test(q.sql)
        && /processing_status\s*=\s*'pending'/.test(q.sql)
        && q.params[0] === fakeId,
    );
    expect(statusReset).toBeDefined();
  });

  it('POST /content/:id/reprocess returns 409 when the row is still pending (in-flight)', async () => {
    const fakeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/SELECT \* FROM content_items WHERE id = \$1/i.test(sql)) {
        return {
          rows: [{
            id: fakeId, type: 'note', title: 'Still ingesting',
            content: 'partial', blob_url: null, mime_type: null, file_hash: null,
            project_ids: [], tags: [], embedding: null, metadata: {},
            source_url: null, published_at: null, archived: false,
            processing_status: 'pending', processing_error: null,
            ingest_completed_at: null,
            created_at: new Date(), updated_at: new Date(),
          }],
        } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(`http://localhost/api/v1/content/${fakeId}/reprocess`, {
      method: 'POST',
      headers: { ...AUTH },
    }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('IN_FLIGHT');
  });

  it('POST /content/:id/reprocess returns 404 for unknown ids and 400 for non-UUIDs', async () => {
    // Explicit empty-rows mock so the SELECT returns 0 rows. Default mockDeps
    // mock is { rows: [] } but using mockImplementation here to be defensive
    // against suite-level mock state.
    vi.mocked(deps.db.query).mockImplementation(async () => ({ rows: [] } as any));

    const notFound = await app.fetch(new Request(
      'http://localhost/api/v1/content/77777777-7777-7777-7777-777777777777/reprocess',
      { method: 'POST', headers: { ...AUTH } },
    ));
    expect(notFound.status).toBe(404);

    const badUuid = await app.fetch(new Request(
      'http://localhost/api/v1/content/not-a-uuid/reprocess',
      { method: 'POST', headers: { ...AUTH } },
    ));
    expect(badUuid.status).toBe(400);
  });

  it('GET /content?processing_status=failed forwards a single status filter to the DB', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(
      'http://localhost/api/v1/content?processing_status=failed',
      { headers: { ...AUTH } },
    ));
    expect(res.status).toBe(200);

    const listQ = queries.find((q) => /SELECT \* FROM content_items/i.test(q.sql));
    expect(listQ).toBeDefined();
    expect(listQ!.sql).toMatch(/processing_status\s*=\s*ANY/i);
    expect(listQ!.params).toContainEqual(['failed']);
  });

  it('GET /content?project_id=null filters to rows with no project membership', async () => {
    // Personal-scope filter — mirrors /todos?project_id=null. The wire
    // sentinel 'null' must translate to a SQL predicate that picks rows
    // whose project_ids array is empty (cardinality = 0). Without this,
    // Home would have to load every note and filter client-side.
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(
      'http://localhost/api/v1/content?type=note&project_id=null',
      { headers: { ...AUTH } },
    ));
    expect(res.status).toBe(200);

    const listQ = queries.find((q) => /SELECT \* FROM content_items/i.test(q.sql));
    expect(listQ).toBeDefined();
    expect(listQ!.sql).toMatch(/cardinality\(project_ids\)\s*=\s*0/i);
    // The literal 'null' must NOT show up as a UUID parameter — the handler
    // converts it to a SQL predicate, not a bound param.
    expect(listQ!.params).not.toContain('null');
  });

  it('GET /content?project_id=<uuid> still filters by project membership (regression)', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });

    const projectId = '11111111-1111-1111-1111-111111111111';
    const res = await app.fetch(new Request(
      `http://localhost/api/v1/content?project_id=${projectId}`,
      { headers: { ...AUTH } },
    ));
    expect(res.status).toBe(200);

    const listQ = queries.find((q) => /SELECT \* FROM content_items/i.test(q.sql));
    expect(listQ!.sql).toMatch(/project_ids\s*@>\s*ARRAY/i);
    expect(listQ!.params).toContain(projectId);
  });

  it('GET /content?before=<iso>&limit=N applies keyset pagination', async () => {
    // Infinite-scroll contract: the drawer requests page N by passing
    // the oldest visible row's created_at. The handler must translate
    // that into a `created_at < $param` predicate; combined with
    // ORDER BY created_at DESC + LIMIT N it gives stable keyset paging.
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });

    const cursor = '2026-05-09T00:00:00.000Z';
    const res = await app.fetch(new Request(
      `http://localhost/api/v1/content?type=note&project_id=null&before=${encodeURIComponent(cursor)}&limit=20`,
      { headers: { ...AUTH } },
    ));
    expect(res.status).toBe(200);

    const listQ = queries.find((q) => /SELECT \* FROM content_items/i.test(q.sql));
    expect(listQ).toBeDefined();
    expect(listQ!.sql).toMatch(/created_at\s*<\s*\$/i);
    expect(listQ!.sql).toMatch(/LIMIT 20/i);
    expect(listQ!.params.some((p) => p instanceof Date && p.toISOString() === cursor)).toBe(true);
  });

  it('GET /content?q=<term> forwards a case-insensitive title/content ILIKE filter', async () => {
    // Drawer search box: the wire param `q` becomes an ILIKE on both
    // title and content, wrapped with %…% by the handler so the
    // frontend sends a raw substring (not a SQL pattern).
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(
      'http://localhost/api/v1/content?type=note&q=Lisbon',
      { headers: { ...AUTH } },
    ));
    expect(res.status).toBe(200);

    const listQ = queries.find((q) => /SELECT \* FROM content_items/i.test(q.sql));
    expect(listQ).toBeDefined();
    expect(listQ!.sql).toMatch(/title ILIKE.*OR content ILIKE/i);
    expect(listQ!.params).toContain('%Lisbon%');
  });

  it('GET /content?q=   (whitespace) is treated as no filter', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(
      'http://localhost/api/v1/content?type=note&q=%20%20',
      { headers: { ...AUTH } },
    ));
    expect(res.status).toBe(200);

    const listQ = queries.find((q) => /SELECT \* FROM content_items/i.test(q.sql));
    expect(listQ!.sql).not.toMatch(/ILIKE/i);
  });

  it('GET /content?project_id=not-a-uuid-and-not-null returns 400', async () => {
    // Schema accepts UUID or the literal 'null'; anything else is invalid.
    const res = await app.fetch(new Request(
      'http://localhost/api/v1/content?project_id=garbage',
      { headers: { ...AUTH } },
    ));
    expect(res.status).toBe(400);
  });

  it('GET /content?processing_status=pending,failed forwards both statuses', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(
      'http://localhost/api/v1/content?processing_status=pending,failed',
      { headers: { ...AUTH } },
    ));
    expect(res.status).toBe(200);

    const listQ = queries.find((q) => /SELECT \* FROM content_items/i.test(q.sql));
    expect(listQ!.params).toContainEqual(['pending', 'failed']);
  });

  it('GET /tags aggregates tag rows with by_type counts', async () => {
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/WITH\s+tag_rows/i.test(sql)) {
        return {
          rows: [
            { name: 'reference', total: 5, doc_count: 3, note_count: 2, todo_count: 0 },
            { name: 'urgent',    total: 2, doc_count: 0, note_count: 0, todo_count: 2 },
          ],
        } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request('http://localhost/api/v1/tags', {
      headers: { ...AUTH },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tags).toHaveLength(2);
    expect(body.tags[0]).toEqual({
      name: 'reference',
      total: 5,
      by_type: { document: 3, note: 2, todo: 0 },
    });
    expect(body.tags[1].name).toBe('urgent');
    expect(body.tags[1].by_type.todo).toBe(2);
  });

  it('GET /tags?project_id=<uuid> scopes the SQL via project filter', async () => {
    const projId = '12345678-1234-1234-1234-123456789012';
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(
      `http://localhost/api/v1/tags?project_id=${projId}`,
      { headers: { ...AUTH } },
    ));
    expect(res.status).toBe(200);

    const tagsQ = queries.find((q) => /WITH\s+tag_rows/i.test(q.sql));
    expect(tagsQ).toBeDefined();
    // Both content_items and todos branches need to filter by project_id when scoped.
    expect(tagsQ!.sql).toMatch(/project_ids\s*@>/i);
    expect(tagsQ!.sql).toMatch(/project_id\s*=\s*\$1/i);
    expect(tagsQ!.params).toContain(projId);
  });

  it('PUT /tags/:name renames across content_items + todos in one transaction', async () => {
    const txQueries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.transaction).mockImplementation(async (fn: any) => {
      const txClient = {
        query: vi.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
          txQueries.push({ sql, params: params ?? [] });
          return { rows: [], rowCount: 3 };
        }),
      };
      return fn(txClient);
    });

    const res = await app.fetch(new Request('http://localhost/api/v1/tags/old-tag', {
      method: 'PUT',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'new-tag' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ from: 'old-tag', to: 'new-tag', updated: 6 });

    // Both tables must be hit. Catches a regression where someone forgets
    // one of the two UPDATEs and tags drift between content_items and todos.
    expect(txQueries.find((q) => /UPDATE\s+content_items/i.test(q.sql))).toBeDefined();
    expect(txQueries.find((q) => /UPDATE\s+todos/i.test(q.sql))).toBeDefined();
    // Both UPDATEs must include the dedup CASE so a row with both `from`
    // and `to` ends up with single `to` instead of [to, to].
    expect(txQueries.every((q) => /array_agg\(DISTINCT/i.test(q.sql))).toBe(true);
  });

  it('PUT /tags/:name with from === to is a no-op (no transaction)', async () => {
    const res = await app.fetch(new Request('http://localhost/api/v1/tags/foo', {
      method: 'PUT',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'foo' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.noop).toBe(true);
    expect(body.updated).toBe(0);
    // Critical: the no-op must NOT thrash the DB.
    expect(deps.db.transaction).not.toHaveBeenCalled();
  });

  it('PUT /tags/:name with missing `to` returns 400', async () => {
    const res = await app.fetch(new Request('http://localhost/api/v1/tags/old', {
      method: 'PUT',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
  });

  it('DELETE /tags/:name strips the tag from both tables', async () => {
    const txQueries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.transaction).mockImplementation(async (fn: any) => {
      const txClient = {
        query: vi.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
          txQueries.push({ sql, params: params ?? [] });
          return { rows: [], rowCount: 2 };
        }),
      };
      return fn(txClient);
    });

    const res = await app.fetch(new Request('http://localhost/api/v1/tags/dead-tag', {
      method: 'DELETE',
      headers: { ...AUTH },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ name: 'dead-tag', updated: 4 });

    // Both UPDATEs must use array_remove (NOT array_replace or DELETE FROM).
    // A regression where someone deletes rows instead of stripping the tag
    // would surface here.
    expect(txQueries.every((q) => /array_remove/i.test(q.sql))).toBe(true);
    expect(txQueries.every((q) => /DELETE\s+FROM/i.test(q.sql))).toBe(false);
  });

  it('GET /activity returns chronologically-ordered events with all three kinds', async () => {
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/WITH\s+activity/i.test(sql)) {
        return {
          rows: [
            { at: new Date('2026-05-03T10:00:00Z'), kind: 'comment', entity_type: 'todo_comment', entity_id: 'c1', title: 'Email John', project_ids: [] },
            { at: new Date('2026-05-03T09:30:00Z'), kind: 'edit',    entity_type: 'note',         entity_id: 'n1', title: 'Renamed note', project_ids: ['p1'] },
            { at: new Date('2026-05-03T09:00:00Z'), kind: 'ingest',  entity_type: 'document',     entity_id: 'd1', title: 'New doc',      project_ids: ['p1'] },
          ],
        } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request('http://localhost/api/v1/activity', {
      headers: { ...AUTH },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toHaveLength(3);
    expect(body.events[0].kind).toBe('comment');
    expect(body.events[2].kind).toBe('ingest');
  });

  it('GET /activity?since=&until= forwards bounds as timestamptz params', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(
      'http://localhost/api/v1/activity?since=2026-05-01T00:00:00Z&until=2026-05-04T00:00:00Z',
      { headers: { ...AUTH } },
    ));
    expect(res.status).toBe(200);

    const aQ = queries.find((q) => /WITH\s+activity/i.test(q.sql));
    expect(aQ).toBeDefined();
    expect(aQ!.params[0]).toBeInstanceOf(Date);
    expect(aQ!.params[1]).toBeInstanceOf(Date);
    expect((aQ!.params[0] as Date).toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect((aQ!.params[1] as Date).toISOString()).toBe('2026-05-04T00:00:00.000Z');
  });

  it('GET /activity?kinds=ingest,edit narrows the SQL to those branches only', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(
      'http://localhost/api/v1/activity?kinds=ingest,edit',
      { headers: { ...AUTH } },
    ));
    expect(res.status).toBe(200);

    const aQ = queries.find((q) => /WITH\s+activity/i.test(q.sql));
    expect(aQ).toBeDefined();
    // Both branches should be present, comment branch should NOT.
    // Filtering matters because each UNION ALL branch is a full table scan;
    // emitting unwanted ones inflates cost.
    expect(/'ingest'::text AS kind/.test(aQ!.sql)).toBe(true);
    expect(/'edit'::text AS kind/.test(aQ!.sql)).toBe(true);
    expect(/'comment'::text AS kind/.test(aQ!.sql)).toBe(false);
  });

  it('GET /activity rejects invalid kind values with a 400 listing the allowed set', async () => {
    const res = await app.fetch(new Request(
      'http://localhost/api/v1/activity?kinds=ingest,whatever',
      { headers: { ...AUTH } },
    ));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/whatever/);
    expect(body.error).toMatch(/ingest,\s*edit,\s*comment/);
  });

  it('GET /activity rejects malformed since/until with 400', async () => {
    const res = await app.fetch(new Request(
      'http://localhost/api/v1/activity?since=not-a-date',
      { headers: { ...AUTH } },
    ));
    expect(res.status).toBe(400);
  });

  it('GET /stats returns the full inventory snapshot in a single round-trip', async () => {
    let queryCount = 0;
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/content_counts/i.test(sql) && /todo_counts/i.test(sql) && /project_counts/i.test(sql)) {
        queryCount++;
        return {
          rows: [{
            documents: '12', notes: '8',
            pending: '1', ready: '18', failed: '1',
            last_ingest_at: new Date('2026-05-03T10:00:00Z'),
            last_edit_at: new Date('2026-05-03T11:00:00Z'),
            todos_total: '5', todos_not_started: '2', todos_in_progress: '2', todos_done: '1',
            projects_total: '3', projects_active: '2', projects_archived: '0', projects_completed: '1',
            comments: '4',
            last_comment_at: new Date('2026-05-02T22:00:00Z'),
            chunks: '120',
            top_tags: [{ name: 'reading', count: 5 }, { name: 'work', count: 3 }],
          }],
        } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request('http://localhost/api/v1/stats', { headers: { ...AUTH } }));
    expect(res.status).toBe(200);
    expect(queryCount).toBe(1); // single multi-CTE query
    const body = await res.json();
    expect(body.counts.documents).toBe(12);
    expect(body.counts.notes).toBe(8);
    expect(body.counts.todos).toEqual({ total: 5, not_started: 2, in_progress: 2, done: 1 });
    expect(body.counts.projects).toEqual({ total: 3, active: 2, archived: 0, completed: 1 });
    expect(body.counts.comments).toBe(4);
    expect(body.counts.chunks).toBe(120);
    expect(body.processing).toEqual({ pending: 1, ready: 18, failed: 1 });
    expect(body.freshness.last_ingest_at).toBe('2026-05-03T10:00:00.000Z');
    expect(body.freshness.last_edit_at).toBe('2026-05-03T11:00:00.000Z');
    expect(body.freshness.last_comment_at).toBe('2026-05-02T22:00:00.000Z');
    expect(body.top_tags).toEqual([{ name: 'reading', count: 5 }, { name: 'work', count: 3 }]);
  });

  it('GET /stats?project_id=<uuid> scopes counts via project_ids array containment', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [{}] } as any;
    });

    const pid = '11111111-1111-4111-8111-111111111111';
    const res = await app.fetch(new Request(
      `http://localhost/api/v1/stats?project_id=${pid}`,
      { headers: { ...AUTH } },
    ));
    expect(res.status).toBe(200);

    const sQ = queries.find((q) => /content_counts/i.test(q.sql));
    expect(sQ).toBeDefined();
    expect(sQ!.params).toEqual([pid]);
    // Content/todos/comments/chunks all scoped; projects count is not scoped.
    expect(/project_ids @> ARRAY\[\$1\]::uuid\[\]/.test(sQ!.sql)).toBe(true);
    expect(/project_id = \$1/.test(sQ!.sql)).toBe(true);
  });

  it('GET /stats?project_id=not-a-uuid returns 400', async () => {
    const res = await app.fetch(new Request(
      'http://localhost/api/v1/stats?project_id=not-a-uuid',
      { headers: { ...AUTH } },
    ));
    expect(res.status).toBe(400);
  });

  it('GET /stats handles an empty workspace (zeros, nulls, no NaN)', async () => {
    vi.mocked(deps.db.query).mockResolvedValueOnce({
      rows: [{
        documents: null, notes: null,
        pending: null, ready: null, failed: null,
        last_ingest_at: null, last_edit_at: null,
        todos_total: null, todos_not_started: null, todos_in_progress: null, todos_done: null,
        projects_total: null, projects_active: null, projects_archived: null, projects_completed: null,
        comments: null, last_comment_at: null,
        chunks: null,
        top_tags: [],
      }],
    } as any);

    const res = await app.fetch(new Request('http://localhost/api/v1/stats', { headers: { ...AUTH } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Empty workspace must coerce to 0 / null cleanly — UI dashboards crash on NaN.
    expect(body.counts.documents).toBe(0);
    expect(body.counts.todos.total).toBe(0);
    expect(body.freshness.last_ingest_at).toBeNull();
    expect(body.top_tags).toEqual([]);
  });

  it('POST /content/bulk archive: single SQL, returns counts and missing_ids', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [{ id: '11111111-1111-4111-8111-111111111111' }] } as any;
    });

    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ];
    const res = await app.fetch(new Request('http://localhost/api/v1/content/bulk', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, action: 'archive' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      requested: 2,
      affected: 1,
      missing_ids: ['22222222-2222-4222-8222-222222222222'],
    });

    // One round-trip — bulk ops MUST NOT loop per-id (the whole point of the endpoint).
    expect(queries).toHaveLength(1);
    expect(/UPDATE content_items/i.test(queries[0].sql)).toBe(true);
    expect(/archived = true/.test(queries[0].sql)).toBe(true);
    expect(/id = ANY\(\$1::uuid\[\]\)/.test(queries[0].sql)).toBe(true);
    expect(/RETURNING id/.test(queries[0].sql)).toBe(true);
  });

  it('POST /content/bulk add_tags uses set semantics (DISTINCT on UNION)', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request('http://localhost/api/v1/content/bulk', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: ['11111111-1111-4111-8111-111111111111'],
        action: 'add_tags',
        tags: ['urgent', 'reading'],
      }),
    }));
    expect(res.status).toBe(200);

    expect(queries).toHaveLength(1);
    expect(queries[0].params[1]).toEqual(['urgent', 'reading']);
    // DISTINCT prevents accumulating duplicates if the tag is already present.
    expect(/SELECT DISTINCT/i.test(queries[0].sql)).toBe(true);
    expect(/UNNEST\(tags \|\| \$2::text\[\]\)/.test(queries[0].sql)).toBe(true);
  });

  it('POST /content/bulk remove_tags filters via WHERE NOT IN', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request('http://localhost/api/v1/content/bulk', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: ['11111111-1111-4111-8111-111111111111'],
        action: 'remove_tags',
        tags: ['stale'],
      }),
    }));
    expect(res.status).toBe(200);
    expect(/<>\s*ALL\(\$2::text\[\]\)/.test(queries[0].sql)).toBe(true);
  });

  it('POST /content/bulk set_project_ids accepts empty array (detach)', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });

    // Detaching content from all projects is a legitimate UI action — the user
    // wants the items in the global Inbox. Empty array must be allowed.
    const res = await app.fetch(new Request('http://localhost/api/v1/content/bulk', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: ['11111111-1111-4111-8111-111111111111'],
        action: 'set_project_ids',
        project_ids: [],
      }),
    }));
    expect(res.status).toBe(200);
    expect(queries[0].params[1]).toEqual([]);
  });

  it('POST /content/bulk rejects unknown action with the allowed set listed', async () => {
    const res = await app.fetch(new Request('http://localhost/api/v1/content/bulk', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: ['11111111-1111-4111-8111-111111111111'],
        action: 'evaporate',
      }),
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/evaporate/);
    expect(body.error).toMatch(/archive/);
    expect(body.error).toMatch(/set_project_ids/);
  });

  it('POST /content/bulk rejects empty ids, oversize batch, and bad UUIDs', async () => {
    const empty = await app.fetch(new Request('http://localhost/api/v1/content/bulk', {
      method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [], action: 'archive' }),
    }));
    expect(empty.status).toBe(400);

    const tooMany = Array.from({ length: 101 }, () => '11111111-1111-4111-8111-111111111111');
    const big = await app.fetch(new Request('http://localhost/api/v1/content/bulk', {
      method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: tooMany, action: 'archive' }),
    }));
    expect(big.status).toBe(400);

    const bad = await app.fetch(new Request('http://localhost/api/v1/content/bulk', {
      method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['not-a-uuid'], action: 'archive' }),
    }));
    expect(bad.status).toBe(400);
  });

  it('POST /content/bulk add_tags without tags returns 400', async () => {
    const res = await app.fetch(new Request('http://localhost/api/v1/content/bulk', {
      method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: ['11111111-1111-4111-8111-111111111111'],
        action: 'add_tags',
      }),
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/non-empty tags/);
  });

  it('POST /content/:id/pin sets pinned_at and returns pinned:true', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [{ id: '11111111-1111-4111-8111-111111111111' }] } as any;
    });

    const res = await app.fetch(new Request(
      'http://localhost/api/v1/content/11111111-1111-4111-8111-111111111111/pin',
      { method: 'POST', headers: { ...AUTH } },
    ));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, pinned: true });

    const pinQ = queries.find((q) => /UPDATE content_items.*pinned_at = now\(\)/i.test(q.sql));
    expect(pinQ).toBeDefined();
    expect(pinQ!.params[0]).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('POST /content/:id/unpin clears pinned_at and returns pinned:false', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [{ id: '11111111-1111-4111-8111-111111111111' }] } as any;
    });

    const res = await app.fetch(new Request(
      'http://localhost/api/v1/content/11111111-1111-4111-8111-111111111111/unpin',
      { method: 'POST', headers: { ...AUTH } },
    ));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, pinned: false });

    const unpinQ = queries.find((q) => /UPDATE content_items.*pinned_at = NULL/i.test(q.sql));
    expect(unpinQ).toBeDefined();
  });

  it('POST /content/:id/pin returns 404 when row missing, 400 on bad UUID', async () => {
    vi.mocked(deps.db.query).mockImplementation(async () => ({ rows: [] } as any));

    const notFound = await app.fetch(new Request(
      'http://localhost/api/v1/content/77777777-7777-7777-7777-777777777777/pin',
      { method: 'POST', headers: { ...AUTH } },
    ));
    expect(notFound.status).toBe(404);

    const badUuid = await app.fetch(new Request(
      'http://localhost/api/v1/content/not-a-uuid/pin',
      { method: 'POST', headers: { ...AUTH } },
    ));
    expect(badUuid.status).toBe(400);
  });

  it('GET /content?pinned=true filters by pinned and orders pinned-first', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(
      'http://localhost/api/v1/content?pinned=true',
      { headers: { ...AUTH } },
    ));
    expect(res.status).toBe(200);

    const listQ = queries.find((q) => /SELECT \* FROM content_items/i.test(q.sql));
    expect(listQ).toBeDefined();
    expect(/pinned_at IS NOT NULL/.test(listQ!.sql)).toBe(true);
    // Pinned-first ordering matters: a UI showing the user's starred list
    // expects most-recently-starred at the top.
    expect(/ORDER BY pinned_at DESC/.test(listQ!.sql)).toBe(true);
  });

  it('GET /content?pinned=garbage returns 400', async () => {
    const res = await app.fetch(new Request(
      'http://localhost/api/v1/content?pinned=garbage',
      { headers: { ...AUTH } },
    ));
    expect(res.status).toBe(400);
  });

  it('GET /tags?project_id=not-a-uuid returns 400', async () => {
    const res = await app.fetch(new Request(
      'http://localhost/api/v1/tags?project_id=not-a-uuid',
      { headers: { ...AUTH } },
    ));
    expect(res.status).toBe(400);
  });

  it('GET /content?processing_status=junk returns 400 with a helpful error', async () => {
    const res = await app.fetch(new Request(
      'http://localhost/api/v1/content?processing_status=junk',
      { headers: { ...AUTH } },
    ));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/junk/);
    expect(body.error).toMatch(/pending,\s*ready,\s*failed/);
  });

  it('GET /content with no processing_status param does NOT add the filter', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request('http://localhost/api/v1/content', {
      headers: { ...AUTH },
    }));
    expect(res.status).toBe(200);

    const listQ = queries.find((q) => /SELECT \* FROM content_items/i.test(q.sql));
    // Default = browse everything (so a "currently processing" view is opt-in).
    // Regression here would mean we silently started filtering and breaking
    // the browse-all default the UI relies on.
    expect(listQ!.sql).not.toMatch(/processing_status\s*=\s*ANY/i);
  });

  it('rejects content creation without content or file', async () => {
    const res = await app.fetch(new Request('http://localhost/api/v1/content', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'note' }),
    }));
    expect(res.status).toBe(400);
  });

  it('rejects invalid type', async () => {
    const res = await app.fetch(new Request('http://localhost/api/v1/content', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'invalid', content: 'x' }),
    }));
    expect(res.status).toBe(400);
  });

  it('multipart upload rejects missing type instead of silently defaulting (E2E #2)', async () => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' }), 'sample.pdf');
    // intentionally omit `type` — old behavior silently defaulted to 'note'
    const res = await app.fetch(new Request('http://localhost/api/v1/content', {
      method: 'POST',
      headers: AUTH,
      body: form,
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/type/i);
  });

  it('multipart upload rejects garbage type with 400 (E2E #2)', async () => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' }), 'sample.pdf');
    form.append('type', 'definitely-not-a-real-type');
    const res = await app.fetch(new Request('http://localhost/api/v1/content', {
      method: 'POST',
      headers: AUTH,
      body: form,
    }));
    expect(res.status).toBe(400);
  });
});

describe('Todos API', () => {
  let deps: ServiceDeps;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    deps = mockDeps();
    app = createApp(deps);
  });

  it('creates a todo and returns the full row wrapped under todo', async () => {
    vi.mocked(deps.db.query).mockResolvedValueOnce({
      rows: [{
        id: 't1', content: 'Do the thing', priority: 'P1',
        project_id: null, parent_id: null, section: null,
        status: 'not_started', due_date: null, tags: [], archived: false,
        pinned_at: null, created_at: new Date(), updated_at: new Date(),
      }],
    } as any);
    const res = await app.fetch(new Request('http://localhost/api/v1/todos', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Do the thing', priority: 'P1' }),
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.todo.id).toBe('t1');
    expect(body.todo.content).toBe('Do the thing');
    expect(body.todo.priority).toBe('P1');
    expect(body.todo.embedding).toBeUndefined();
  });

  it('rejects todo without content', async () => {
    const res = await app.fetch(new Request('http://localhost/api/v1/todos', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority: 'P1' }),
    }));
    expect(res.status).toBe(400);
  });

  it('lists todos', async () => {
    // listTodos issues three queries: the list itself, then a batched
    // comment-count lookup, then a batched subtask-count lookup. Mock
    // each by SQL shape so call order doesn't matter (Promise.all in
    // the service runs them concurrently and either may land first).
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/SELECT \* FROM todos\b/i.test(sql)) {
        return {
          rows: [{ id: 't1', content: 'Thing', status: 'not_started', tags: [], embedding: null, archived: false, created_at: new Date(), updated_at: new Date() }],
        } as any;
      }
      if (/FROM todo_comments/i.test(sql)) {
        return { rows: [{ todo_id: 't1', count: 3 }] } as any;
      }
      if (/FROM todos\s+WHERE parent_id = ANY/i.test(sql)) {
        return { rows: [{ parent_id: 't1', count: 2 }] } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request('http://localhost/api/v1/todos', { headers: AUTH }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.todos).toHaveLength(1);
    // embedding should be stripped
    expect(body.todos[0].embedding).toBeUndefined();
    // comment_count + subtask_count attached from the batched decoration queries
    expect(body.todos[0].comment_count).toBe(3);
    expect(body.todos[0].subtask_count).toBe(2);
  });

  it('GET /todos?parent_id=<uuid> filters subtasks of a specific parent', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });

    const parentId = '11111111-1111-4111-8111-111111111111';
    const res = await app.fetch(new Request(
      `http://localhost/api/v1/todos?parent_id=${parentId}`,
      { headers: AUTH },
    ));
    expect(res.status).toBe(200);

    const listQ = queries.find((q) => /SELECT \* FROM todos/i.test(q.sql));
    expect(listQ).toBeDefined();
    expect(/parent_id = \$/.test(listQ!.sql)).toBe(true);
    expect(listQ!.params).toContain(parentId);
  });

  it('GET /todos?parent_id=null returns top-level todos only (IS NULL clause)', async () => {
    // null is a meaningful filter — the UI uses it to render the root of the
    // tree. Distinct from "no parent_id filter" (which returns everything).
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(
      'http://localhost/api/v1/todos?parent_id=null',
      { headers: AUTH },
    ));
    expect(res.status).toBe(200);

    const listQ = queries.find((q) => /SELECT \* FROM todos/i.test(q.sql));
    expect(listQ).toBeDefined();
    expect(/parent_id IS NULL/.test(listQ!.sql)).toBe(true);
  });

  it('GET /todos?parent_id=not-a-uuid returns 400', async () => {
    const res = await app.fetch(new Request(
      'http://localhost/api/v1/todos?parent_id=not-a-uuid',
      { headers: AUTH },
    ));
    expect(res.status).toBe(400);
  });

  it('GET /todos?tags=urgent,bug filters by tag set', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(
      'http://localhost/api/v1/todos?tags=urgent,bug',
      { headers: AUTH },
    ));
    expect(res.status).toBe(200);

    const listQ = queries.find((q) => /SELECT \* FROM todos/i.test(q.sql));
    expect(listQ).toBeDefined();
    expect(/tags @>/.test(listQ!.sql)).toBe(true);
    expect(listQ!.params).toContainEqual(['urgent', 'bug']);
  });

  it('GET /todos?due_before=&due_after= forwards bounds as Date params', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(
      'http://localhost/api/v1/todos?due_before=2026-06-01T00:00:00Z&due_after=2026-05-01T00:00:00Z',
      { headers: AUTH },
    ));
    expect(res.status).toBe(200);

    const listQ = queries.find((q) => /SELECT \* FROM todos/i.test(q.sql));
    expect(listQ).toBeDefined();
    expect(/due_date <=/.test(listQ!.sql)).toBe(true);
    expect(/due_date >=/.test(listQ!.sql)).toBe(true);
    const dateParams = listQ!.params.filter((p): p is Date => p instanceof Date);
    expect(dateParams).toHaveLength(2);
  });

  it('GET /todos?before=<iso>&limit=N applies keyset pagination', async () => {
    // Infinite-scroll contract — symmetric with /content's `before`.
    // Drawer requests page N+1 with the oldest visible row's created_at.
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });

    const cursor = '2026-05-09T00:00:00.000Z';
    const res = await app.fetch(new Request(
      `http://localhost/api/v1/todos?project_id=null&before=${encodeURIComponent(cursor)}&limit=20`,
      { headers: AUTH },
    ));
    expect(res.status).toBe(200);

    const listQ = queries.find((q) => /SELECT \* FROM todos/i.test(q.sql));
    expect(listQ).toBeDefined();
    expect(listQ!.sql).toMatch(/created_at\s*<\s*\$/i);
    expect(listQ!.sql).toMatch(/LIMIT 20/i);
    expect(listQ!.params.some((p) => p instanceof Date && p.toISOString() === cursor)).toBe(true);
  });

  it('GET /todos?q=<term> forwards a case-insensitive content ILIKE filter', async () => {
    // Drawer search on todos matches `content` only (todos have no
    // separate title). Wrapper handles %…% so the frontend sends a
    // raw substring.
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(
      'http://localhost/api/v1/todos?q=Sebastian',
      { headers: AUTH },
    ));
    expect(res.status).toBe(200);

    const listQ = queries.find((q) => /SELECT \* FROM todos/i.test(q.sql));
    expect(listQ).toBeDefined();
    expect(listQ!.sql).toMatch(/content ILIKE/i);
    expect(listQ!.params).toContain('%Sebastian%');
  });

  it('GET /todos rejects malformed due_before/due_after with 400', async () => {
    const res = await app.fetch(new Request(
      'http://localhost/api/v1/todos?due_before=tomorrow',
      { headers: AUTH },
    ));
    expect(res.status).toBe(400);
  });

  it('POST /todos/bulk set_status: single SQL with status param', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [{ id: '11111111-1111-4111-8111-111111111111' }] } as any;
    });

    const res = await app.fetch(new Request('http://localhost/api/v1/todos/bulk', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: ['11111111-1111-4111-8111-111111111111'],
        action: 'set_status',
        status: 'done',
      }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requested).toBe(1);
    expect(body.affected).toBe(1);

    expect(queries).toHaveLength(1);
    expect(/UPDATE todos/i.test(queries[0].sql)).toBe(true);
    expect(/status\s*=\s*\$2/.test(queries[0].sql)).toBe(true);
    expect(queries[0].params[1]).toBe('done');
  });

  it('POST /todos/bulk set_priority null clears the priority', async () => {
    // Distinguish "not provided" from "null". Both must work, but null
    // means "clear" — which is what `has_priority: true` + priority=null
    // signals through to the service layer.
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request('http://localhost/api/v1/todos/bulk', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: ['11111111-1111-4111-8111-111111111111'],
        action: 'set_priority',
        priority: null,
      }),
    }));
    expect(res.status).toBe(200);
    expect(queries[0].params[1]).toBeNull();
  });

  it('POST /todos/bulk set_project_id null detaches to Inbox', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request('http://localhost/api/v1/todos/bulk', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: ['11111111-1111-4111-8111-111111111111'],
        action: 'set_project_id',
        project_id: null,
      }),
    }));
    expect(res.status).toBe(200);
    expect(queries[0].params[1]).toBeNull();
  });

  it('PUT /todos/:id with section=null clears the section (move to Ungrouped)', async () => {
    // Regression: the handler used `body.section ?? undefined`, collapsing a
    // null section-clear into "don't touch" — so a todo could never leave a
    // section. The Todos view's drag-to-Ungrouped depends on this working.
    const id = '66666666-6666-4666-8666-666666666666';
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      if (/^UPDATE\s+todos\b/i.test(sql)) {
        return { rows: [{
          id, content: 'x', project_id: null, section: null, parent_id: null,
          priority: null, status: 'not_started', due_date: null, tags: [],
          archived: false, manual_order: null, pinned_at: null,
          created_at: new Date(), updated_at: new Date(),
        }] } as any;
      }
      return { rows: [] } as any;
    });
    const res = await app.fetch(new Request(`http://localhost/api/v1/todos/${id}`, {
      method: 'PUT',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: null }),
    }));
    expect(res.status).toBe(200);
    const upd = queries.find((q) => /^UPDATE\s+todos\b/i.test(q.sql) && /section\s*=/.test(q.sql));
    expect(upd).toBeDefined();
    expect(upd!.params).toContain(null);
  });

  it('PUT /todos/:id with status=done cascades to non-done descendants', async () => {
    const parent = '22222222-2222-4222-8222-222222222222';
    const child1 = '33333333-3333-4333-8333-333333333333';
    const child2 = '44444444-4444-4444-8444-444444444444';
    const grandchild = '55555555-5555-4555-8555-555555555555';

    // Tree shape. Status is mutable in this map so the recursive
    // updateTodo calls observe the cascade-in-progress state.
    const tree: Record<string, { status: string }> = {
      [parent]: { status: 'in_progress' },
      [child1]: { status: 'done' },         // already done — should be skipped
      [child2]: { status: 'in_progress' },
      [grandchild]: { status: 'not_started' },
    };
    const childrenOf: Record<string, string[]> = {
      [parent]: [child1, child2],
      [child2]: [grandchild],
    };

    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      // getTodoById — returns current status for prevStatus check.
      if (/^SELECT \* FROM todos WHERE id = \$1/i.test(sql)) {
        const id = params?.[0] as string;
        return { rows: tree[id] ? [{ id, status: tree[id].status, archived: false }] : [] } as any;
      }
      // findChildTodos
      if (/^SELECT \* FROM todos WHERE parent_id/i.test(sql)) {
        const pid = params?.[0] as string;
        const ids = childrenOf[pid] ?? [];
        return { rows: ids.map((id) => ({ id, content: id, status: tree[id].status, archived: false })) } as any;
      }
      // dbUpdateTodo — apply patch, return updated row. Status is the
      // first param in the SET clause (see db/todos.ts).
      if (/^UPDATE\s+todos\b/i.test(sql)) {
        const updatedId = params?.[params.length - 1] as string;
        // Pluck status off params if present in the SET clause.
        const sIdx = sql.indexOf('status =');
        if (sIdx !== -1) {
          const m = sql.slice(sIdx).match(/\$(\d+)/);
          if (m) {
            const newStatus = params?.[parseInt(m[1], 10) - 1] as string;
            if (tree[updatedId]) tree[updatedId].status = newStatus;
          }
        }
        return { rows: [{ id: updatedId, status: tree[updatedId]?.status }] } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(`http://localhost/api/v1/todos/${parent}`, {
      method: 'PUT',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    }));
    expect(res.status).toBe(200);

    // After the cascade, every node in the tree should be 'done'
    // (child1 was already done — no redundant write, but state still
    // 'done').
    expect(tree[parent].status).toBe('done');
    expect(tree[child1].status).toBe('done');
    expect(tree[child2].status).toBe('done');
    expect(tree[grandchild].status).toBe('done');

    // child1 was skipped: no UPDATE bound its id.
    const updatedIds = queries
      .filter((q) => /UPDATE\s+todos\b/i.test(q.sql))
      .map((q) => q.params[q.params.length - 1]);
    expect(updatedIds).toContain(parent);
    expect(updatedIds).toContain(child2);
    expect(updatedIds).toContain(grandchild);
    expect(updatedIds).not.toContain(child1);
  });

  it('PUT /todos/:id reopening a done parent cascades to its done descendants', async () => {
    const parent = '66666666-6666-4666-8666-666666666666';
    const child1 = '77777777-7777-4777-8777-777777777777';
    const child2 = '88888888-8888-4888-8888-888888888888';

    // Tree before reopen: parent + child1 + child2 all done. child2
    // happens to be the result of a prior cascade — we don't track
    // that, the model just says "if a descendant is done when a
    // parent reopens, undone it."
    const tree: Record<string, { status: string }> = {
      [parent]: { status: 'done' },
      [child1]: { status: 'done' },
      [child2]: { status: 'done' },
    };
    const childrenOf: Record<string, string[]> = { [parent]: [child1, child2] };

    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/^SELECT \* FROM todos WHERE id = \$1/i.test(sql)) {
        const id = params?.[0] as string;
        return { rows: tree[id] ? [{ id, status: tree[id].status, archived: false }] : [] } as any;
      }
      if (/^SELECT \* FROM todos WHERE parent_id/i.test(sql)) {
        const pid = params?.[0] as string;
        const ids = childrenOf[pid] ?? [];
        return { rows: ids.map((id) => ({ id, content: id, status: tree[id].status, archived: false })) } as any;
      }
      if (/^UPDATE\s+todos\b/i.test(sql)) {
        const updatedId = params?.[params.length - 1] as string;
        const sIdx = sql.indexOf('status =');
        if (sIdx !== -1) {
          const m = sql.slice(sIdx).match(/\$(\d+)/);
          if (m) {
            const newStatus = params?.[parseInt(m[1], 10) - 1] as string;
            if (tree[updatedId]) tree[updatedId].status = newStatus;
          }
        }
        return { rows: [{ id: updatedId, status: tree[updatedId]?.status }] } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(`http://localhost/api/v1/todos/${parent}`, {
      method: 'PUT',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress' }),
    }));
    expect(res.status).toBe(200);

    // Cascade flips done descendants to the parent's new status.
    expect(tree[parent].status).toBe('in_progress');
    expect(tree[child1].status).toBe('in_progress');
    expect(tree[child2].status).toBe('in_progress');
  });

  it('PUT /todos/:id reopen does NOT touch already-non-done descendants', async () => {
    const parent = '99999999-9999-4999-8999-999999999999';
    const childOpen = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    const tree: Record<string, { status: string }> = {
      [parent]: { status: 'done' },
      [childOpen]: { status: 'in_progress' }, // never was done
    };
    const childrenOf: Record<string, string[]> = { [parent]: [childOpen] };
    const updates: string[] = [];

    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/^SELECT \* FROM todos WHERE id = \$1/i.test(sql)) {
        const id = params?.[0] as string;
        return { rows: tree[id] ? [{ id, status: tree[id].status, archived: false }] : [] } as any;
      }
      if (/^SELECT \* FROM todos WHERE parent_id/i.test(sql)) {
        const pid = params?.[0] as string;
        const ids = childrenOf[pid] ?? [];
        return { rows: ids.map((id) => ({ id, content: id, status: tree[id].status, archived: false })) } as any;
      }
      if (/^UPDATE\s+todos\b/i.test(sql)) {
        const updatedId = params?.[params.length - 1] as string;
        updates.push(updatedId);
        const sIdx = sql.indexOf('status =');
        if (sIdx !== -1) {
          const m = sql.slice(sIdx).match(/\$(\d+)/);
          if (m) {
            const newStatus = params?.[parseInt(m[1], 10) - 1] as string;
            if (tree[updatedId]) tree[updatedId].status = newStatus;
          }
        }
        return { rows: [{ id: updatedId, status: tree[updatedId]?.status }] } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(`http://localhost/api/v1/todos/${parent}`, {
      method: 'PUT',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'not_started' }),
    }));
    expect(res.status).toBe(200);
    // Only the parent was updated. The already-non-done child stays
    // put — its progress wasn't claimed by the cascade.
    expect(updates).toEqual([parent]);
    expect(tree[childOpen].status).toBe('in_progress');
  });

  it('POST /todos/reorder persists position 1..N for the named sibling group', async () => {
    const a = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const b = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const c = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const queries: Array<{ sql: string; params: unknown[] }> = [];

    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      // Validation SELECT — return all three as valid top-level rows.
      if (/^SELECT id FROM todos WHERE id = ANY/i.test(sql)) {
        return { rows: [{ id: a }, { id: b }, { id: c }] } as any;
      }
      // The actual UPDATE
      if (/^UPDATE todos AS t/i.test(sql)) {
        return { rows: [], rowCount: 3 } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request('http://localhost/api/v1/todos/reorder', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent_id: null, ids: [c, a, b] }),
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 3, mismatched_ids: [] });

    // Validation query selected on parent_id IS NULL (top-level).
    const validation = queries.find((q) => /WHERE id = ANY.*parent_id IS NULL/i.test(q.sql));
    expect(validation).toBeTruthy();
    // The id array is bound positionally as the new order.
    const update = queries.find((q) => /UPDATE todos AS t/i.test(q.sql));
    expect(update?.params[0]).toEqual([c, a, b]);
  });

  it('POST /todos/reorder rejects ids that do not all share the requested parent', async () => {
    const a = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const b = '11111111-2222-4333-8444-555555555555';
    const parentId = '99999999-aaaa-4bbb-8ccc-dddddddddddd';

    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      // Only `a` is actually a child of `parentId`; `b` is mismatched.
      if (/^SELECT id FROM todos WHERE id = ANY.*parent_id =/i.test(sql)) {
        return { rows: [{ id: a }] } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request('http://localhost/api/v1/todos/reorder', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent_id: parentId, ids: [a, b] }),
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Reorder aborted/);
    expect(body.mismatched_ids).toEqual([b]);
  });

  it('POST /todos rejects subtasks that would exceed the 4-level depth cap', async () => {
    // Parent's depth = 3 (great-grandchild — already at the cap).
    // A new child under it would be depth 4 → reject. The
    // recursive-CTE depth probe is the gate, so the mock returns
    // max(depth)=3 and the create call never reaches embedding /
    // INSERT.
    const greatGrandId = '11111111-1111-4111-8111-111111111111';
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/WITH RECURSIVE chain/i.test(sql)) {
        return { rows: [{ depth: 3, exists: true }] } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request('http://localhost/api/v1/todos', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'too deep', parent_id: greatGrandId }),
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Subtask nesting too deep.*depth 4/);
  });

  it('POST /todos accepts a subtask at the depth cap (parent at depth 2 → child at depth 3)', async () => {
    // Parent at depth 2 → child at depth 3 is allowed (the cap).
    const grandchildId = '22222222-2222-4222-8222-222222222222';
    const newId = '33333333-3333-4333-8333-333333333333';
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/WITH RECURSIVE chain/i.test(sql)) {
        return { rows: [{ depth: 2, exists: true }] } as any;
      }
      if (/^INSERT INTO todos/i.test(sql)) {
        return { rows: [{
          id: newId, content: 'ok', project_id: null, section: null, parent_id: grandchildId,
          priority: null, status: 'not_started', due_date: null, tags: [], archived: false,
          pinned_at: null, manual_order: null, created_at: new Date(), updated_at: new Date(),
        }] } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request('http://localhost/api/v1/todos', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'ok', parent_id: grandchildId }),
    }));
    expect(res.status).toBe(201);
    expect((await res.json()).todo.id).toBe(newId);
  });

  it('PUT /todos/:id rejects re-parenting that would exceed the depth cap', async () => {
    const id = '44444444-4444-4444-8444-444444444444';
    const newParent = '55555555-5555-4555-8555-555555555555';
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/WITH RECURSIVE chain/i.test(sql)) {
        return { rows: [{ depth: 3, exists: true }] } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(`http://localhost/api/v1/todos/${id}`, {
      method: 'PUT',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent_id: newParent }),
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Subtask nesting too deep/);
  });

  it('POST /todos/reorder caps batch size at 500', async () => {
    const ids = Array.from({ length: 501 }, (_, i) =>
      `${(i + 0x10000).toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`,
    );
    const res = await app.fetch(new Request('http://localhost/api/v1/todos/reorder', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent_id: null, ids }),
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/capped at 500/);
  });

  it('PUT /todos/:id status change between two non-done states does NOT cascade', async () => {
    const parent = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const tree: Record<string, { status: string }> = {
      [parent]: { status: 'in_progress' }, // never was done
    };
    const updates: string[] = [];

    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/^SELECT \* FROM todos WHERE id = \$1/i.test(sql)) {
        const id = params?.[0] as string;
        return { rows: tree[id] ? [{ id, status: tree[id].status, archived: false }] : [] } as any;
      }
      if (/^SELECT \* FROM todos WHERE parent_id/i.test(sql)) {
        return { rows: [] } as any;
      }
      if (/^UPDATE\s+todos\b/i.test(sql)) {
        const updatedId = params?.[params.length - 1] as string;
        updates.push(updatedId);
        return { rows: [{ id: updatedId, status: 'not_started' }] } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request(`http://localhost/api/v1/todos/${parent}`, {
      method: 'PUT',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'not_started' }),
    }));
    expect(res.status).toBe(200);
    // No fan-out since neither side of the transition is 'done'.
    expect(updates).toEqual([parent]);
  });

  it('PUT /todos/:id with due_date=null clears the column (does not silently drop)', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      // Return a row so the route reaches serializeTodo.
      return {
        rows: [{
          id, content: 'x', project_id: null, section: null, parent_id: null,
          priority: null, status: 'not_started', due_date: null, tags: [],
          archived: false, pinned_at: null, created_at: new Date(), updated_at: new Date(),
        }],
      } as any;
    });

    const res = await app.fetch(new Request(`http://localhost/api/v1/todos/${id}`, {
      method: 'PUT',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ due_date: null }),
    }));
    expect(res.status).toBe(200);
    // The UPDATE query must include `due_date = $...` with a null bind
    // so the column actually clears. Earlier code shortcut treated null
    // as "don't touch" and silently dropped clear requests.
    const updateQ = queries.find((q) => /UPDATE\s+todos/i.test(q.sql) && /due_date\s*=/.test(q.sql));
    expect(updateQ).toBeTruthy();
    expect(updateQ!.params).toContain(null);
  });

  it('POST /todos/bulk set_due_date accepts ISO 8601 and forwards as Date', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request('http://localhost/api/v1/todos/bulk', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: ['11111111-1111-4111-8111-111111111111'],
        action: 'set_due_date',
        due_date: '2026-06-01T00:00:00Z',
      }),
    }));
    expect(res.status).toBe(200);
    expect(queries[0].params[1]).toBeInstanceOf(Date);
    expect((queries[0].params[1] as Date).toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('POST /todos/bulk rejects bogus status / priority / due_date with 400', async () => {
    const id = '11111111-1111-4111-8111-111111111111';

    const badStatus = await app.fetch(new Request('http://localhost/api/v1/todos/bulk', {
      method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id], action: 'set_status', status: 'imploded' }),
    }));
    expect(badStatus.status).toBe(400);
    expect((await badStatus.json()).error).toMatch(/imploded/);

    const badPriority = await app.fetch(new Request('http://localhost/api/v1/todos/bulk', {
      method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id], action: 'set_priority', priority: 'P9' }),
    }));
    expect(badPriority.status).toBe(400);

    const badDate = await app.fetch(new Request('http://localhost/api/v1/todos/bulk', {
      method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id], action: 'set_due_date', due_date: 'tomorrow' }),
    }));
    expect(badDate.status).toBe(400);
  });

  it('POST /todos/bulk set_priority without priority field returns 400', async () => {
    // Forgetting the priority field is a real mistake — the API distinguishes
    // "missing" from "null" so the service can refuse rather than silently
    // null-out everyone's priority.
    const res = await app.fetch(new Request('http://localhost/api/v1/todos/bulk', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: ['11111111-1111-4111-8111-111111111111'],
        action: 'set_priority',
      }),
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/priority/);
  });

  it('POST /todos/bulk archive uses set semantics for ids and returns missing_ids', async () => {
    vi.mocked(deps.db.query).mockResolvedValueOnce({
      rows: [{ id: '11111111-1111-4111-8111-111111111111' }],
    } as any);

    const res = await app.fetch(new Request('http://localhost/api/v1/todos/bulk', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: [
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
        ],
        action: 'archive',
      }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.affected).toBe(1);
    expect(body.missing_ids).toEqual(['22222222-2222-4222-8222-222222222222']);
  });
});

describe('Search API', () => {
  let deps: ServiceDeps;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    deps = mockDeps();
    app = createApp(deps);
  });

  it('rejects search without query', async () => {
    const res = await app.fetch(new Request('http://localhost/api/v1/search', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
  });

  it('search SQL does NOT use SELECT * or project embedding as a column (payload-size regression)', async () => {
    // Previously findSimilarChunks used SELECT c.*, which included c.embedding
    // (a 3072-dim float array). Ten hits = ~400KB of noise in the response.
    // This test enforces explicit column lists and no wildcard SELECTs.
    // (c.embedding still appears in the cosine-distance expression — that's fine;
    // only the projected result column list matters for payload size.)
    vi.mocked(deps.db.query).mockResolvedValue({ rows: [] } as any);

    await app.fetch(new Request('http://localhost/api/v1/search', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test' }),
    }));

    const calls = vi.mocked(deps.db.query).mock.calls;
    const chunkQuery = calls.find((c) => typeof c[0] === 'string' && c[0].includes('FROM chunks'));
    const todoQuery = calls.find((c) => typeof c[0] === 'string' && c[0].includes('FROM todos'));
    expect(chunkQuery).toBeDefined();
    expect(todoQuery).toBeDefined();

    // No wildcard SELECTs (which would pull in embedding)
    expect(chunkQuery![0]).not.toMatch(/SELECT\s+c\.\*/);
    expect(todoQuery![0]).not.toMatch(/SELECT\s+\*/);

    // Explicit column list should be present (proof the refactor happened, not reverted)
    expect(chunkQuery![0]).toMatch(/SELECT\s+c\.id,\s*c\.content_item_id/);
  });

  it('search response hits do not contain embedding fields', async () => {
    // Mock DB returns a chunk row WITHOUT embedding (matching what the real query returns now).
    // If someone later regresses to SELECT *, the DB mock return type would re-include embedding
    // and the test below would fail. This is the consumer-facing side of the contract.
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (sql.includes('FROM chunks')) {
        return {
          rows: [{
            id: 'ch1', content_item_id: 'ci1', chunk_index: 0, chunk_type: 'text',
            content: 'some chunk text', metadata: {}, created_at: new Date(),
            similarity: 0.7,
            parent_type: 'note', parent_title: 'Test Note',
            parent_project_ids: [], parent_tags: [],
          }],
        } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request('http://localhost/api/v1/search', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hits.length).toBeGreaterThan(0);

    // No hit should contain an 'embedding' field anywhere (chunk or todo subobject)
    for (const hit of body.hits) {
      if (hit.chunk) expect(hit.chunk).not.toHaveProperty('embedding');
      if (hit.todo) expect(hit.todo).not.toHaveProperty('embedding');
    }

    // Stringifying the whole response should not contain the word 'embedding'
    expect(JSON.stringify(body)).not.toContain('embedding');
  });

  it('runs a semantic search and returns hits', async () => {
    // search returns chunks + todos (both empty in this mock)
    vi.mocked(deps.db.query).mockResolvedValue({ rows: [] } as any);

    const res = await app.fetch(new Request('http://localhost/api/v1/search', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.hits)).toBe(true);
  });

  it('POST /search with project_id="null" filters chunks to personal scope', async () => {
    // Personal scope on /search must surface as a SQL predicate that picks
    // chunks whose parent has no project membership (cardinality of
    // parent.project_ids = 0). Without this, "Personal" on Home is a lie —
    // it'd silently match across all projects.
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request('http://localhost/api/v1/search', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test', project_id: 'null', graph: false }),
    }));
    expect(res.status).toBe(200);

    const seedQ = queries.find((q) => /FROM chunks c/i.test(q.sql) && q.sql.includes('embedding <=>'));
    expect(seedQ).toBeDefined();
    expect(seedQ!.sql).toMatch(/cardinality\(ci\.project_ids\)\s*=\s*0/i);
    // The literal 'null' must NOT show up as a UUID-bound param.
    expect(seedQ!.params).not.toContain('null');
  });

  it('POST /search with project_id="not-a-uuid-and-not-null" returns 400', async () => {
    const res = await app.fetch(new Request('http://localhost/api/v1/search', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test', project_id: 'garbage' }),
    }));
    expect(res.status).toBe(400);
  });

  it('extracts query entities via the depth classifier when graph is on (F1)', async () => {
    vi.mocked(deps.db.query).mockResolvedValue({ rows: [] } as any);
    vi.mocked(deps.queryDepthLLM.complete).mockResolvedValueOnce({
      content: JSON.stringify({
        depth: 'fast', reason: 'definitional',
        entities: [{ name: 'pgvector', type: 'tool' }],
      }),
      tokensUsed: { input: 0, output: 0, total: 0 },
    });

    await app.fetch(new Request('http://localhost/api/v1/search', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'what about pgvector' }),
    }));

    // Classifier was called once for entity extraction
    expect(deps.queryDepthLLM.complete).toHaveBeenCalledOnce();
  });

  it.each(['ollama', 'llama.cpp', 'copilot', 'chatgpt'])('local search retrieves scoped hits without waiting for %s completion', async (provider) => {
    deps.config.storageProvider = 'local';
    deps.config.llmProvider = provider as typeof deps.config.llmProvider;
    const projectId = '11111111-1111-4111-8111-111111111111';
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.queryDepthLLM.complete).mockRejectedValue(new Error('Completion is unavailable'));
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: sql.includes('FROM chunks c') ? [{
        id: 'chunk-1', content_item_id: 'note-1', chunk_index: 0, chunk_type: 'text',
        content: 'Project decisions use PostgreSQL.', metadata: {}, created_at: new Date(), similarity: 0.8,
        parent_type: 'note', parent_title: 'Storage', parent_project_ids: [projectId], parent_tags: [],
      }] : [] } as any;
    });

    const res = await app.fetch(new Request('http://localhost/api/v1/search', {
      method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Where are project decisions stored?', project_id: projectId }),
    }));

    expect(res.status).toBe(200);
    expect((await res.json()).hits.some((hit: any) => hit.chunk?.content_item_id === 'note-1')).toBe(true);
    expect(deps.queryDepthLLM.complete).not.toHaveBeenCalled();
    expect(deps.embeddingProvider.embed).toHaveBeenCalled();
    expect(queries.some(q => q.sql.includes('embedding <=>') && q.params.includes(projectId))).toBe(true);
    expect(queries.some(q => q.sql.includes('chunk_entities'))).toBe(true);
  });

  it('skips the classifier when graph is explicitly disabled (F1)', async () => {
    vi.mocked(deps.db.query).mockResolvedValue({ rows: [] } as any);

    await app.fetch(new Request('http://localhost/api/v1/search', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test', graph: false }),
    }));

    expect(deps.queryDepthLLM.complete).not.toHaveBeenCalled();
  });

  // Universal search bar — extended SearchRequest filters. The new
  // fields (content_item_ids + excluded_*) must surface as SQL
  // predicates on the chunk vector-seed query. Without these tests, a
  // schema-only change could "pass" while the SQL silently ignores them.
  it('POST /search with content_item_ids scopes chunks to those parent items', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });
    const id = '11111111-1111-1111-1111-111111111111';
    await app.fetch(new Request('http://localhost/api/v1/search', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test', content_item_ids: [id], graph: false }),
    }));
    const seedQ = queries.find((q) => /FROM chunks c/i.test(q.sql) && q.sql.includes('embedding <=>'));
    expect(seedQ).toBeDefined();
    expect(seedQ!.sql).toMatch(/ci\.id\s*=\s*ANY\(/i);
    expect(seedQ!.params.some((p) => Array.isArray(p) && (p as unknown[]).includes(id))).toBe(true);
  });

  it('POST /search with excluded_tags emits a NOT-overlap predicate', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });
    await app.fetch(new Request('http://localhost/api/v1/search', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test', excluded_tags: ['archive'], graph: false }),
    }));
    const seedQ = queries.find((q) => /FROM chunks c/i.test(q.sql) && q.sql.includes('embedding <=>'));
    expect(seedQ).toBeDefined();
    expect(seedQ!.sql).toMatch(/NOT\s*\(ci\.tags\s*&&/i);
    expect(seedQ!.params.some((p) => Array.isArray(p) && (p as unknown[]).includes('archive'))).toBe(true);
  });

  it('POST /search with excluded_entity_types=["document"] drops document-type chunks', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });
    await app.fetch(new Request('http://localhost/api/v1/search', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test', excluded_entity_types: ['document'], graph: false }),
    }));
    const seedQ = queries.find((q) => /FROM chunks c/i.test(q.sql) && q.sql.includes('embedding <=>'));
    expect(seedQ).toBeDefined();
    expect(seedQ!.sql).toMatch(/NOT\s*\(ci\.type\s*=\s*ANY\(/i);
  });

  it('POST /search with tags=["chore"] STILL hits findSimilarTodos (regression — todos vanished when any tag filter was set)', async () => {
    // Before this fix, the service layer had `searchTodos && !tags` —
    // any tag filter silently dropped todos from search results entirely.
    // Repro: filter by #chore, the todo named "Renew domain" should still
    // be in the candidate set even though semantic similarity may rank it
    // low. We assert on the SQL having a tags-overlap predicate so the
    // todo query at least RAN.
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });
    await app.fetch(new Request('http://localhost/api/v1/search', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'do', tags: ['chore'], graph: false }),
    }));
    const todoQ = queries.find((q) => /FROM todos\b/i.test(q.sql) && q.sql.includes('embedding <=>'));
    expect(todoQ).toBeDefined();
    expect(todoQ!.sql).toMatch(/tags\s*@>/i);
    expect(todoQ!.params.some((p) => Array.isArray(p) && (p as unknown[]).includes('chore'))).toBe(true);
  });

  it('POST /search fires the lexical chunks query alongside vector (3-arm fusion)', async () => {
    // After the lexical-fusion fix, the service runs vector + graph +
    // lexical in parallel. Lexical chunks query has its own signature
    // (ILIKE on title OR content, no embedding compare). Test that the
    // pattern includes the user's query wrapped in % wildcards.
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });
    await app.fetch(new Request('http://localhost/api/v1/search', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'domain', graph: false }),
    }));
    const lexicalChunkQ = queries.find(
      (q) => /FROM chunks c/i.test(q.sql) && /ILIKE \$1/i.test(q.sql) && !q.sql.includes('embedding <=>'),
    );
    expect(lexicalChunkQ).toBeDefined();
    expect(lexicalChunkQ!.params[0]).toBe('%domain%');
  });

  it('POST /search fires the lexical todos query alongside vector', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });
    await app.fetch(new Request('http://localhost/api/v1/search', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'do', graph: false }),
    }));
    const lexicalTodoQ = queries.find(
      (q) => /FROM todos\b/i.test(q.sql) && /content ILIKE \$1/i.test(q.sql) && !q.sql.includes('embedding <=>'),
    );
    expect(lexicalTodoQ).toBeDefined();
    expect(lexicalTodoQ!.params[0]).toBe('%do%');
  });

  it('POST /search with empty query + tags filter returns filter-only listing (regression — predicate-only searches showed 0 results)', async () => {
    // Repro: user typed just `#chore` in the search bar. parseSearchSyntax
    // strips the predicate, leaving text === ''. Old code fell back to the
    // raw `#chore` string and embedded it; the helpers also short-circuited
    // any q < 2 chars to []. Net result: 0 hits even though 4 chore-tagged
    // items existed. Fix: lexical helpers do filter-only listing when query
    // is empty but a filter is set; embedding step is skipped.
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });
    await app.fetch(new Request('http://localhost/api/v1/search', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '', tags: ['chore'], graph: false }),
    }));
    // No vector-similarity queries should fire (embedding step skipped).
    const vectorQ = queries.find((q) => q.sql.includes('embedding <=>'));
    expect(vectorQ).toBeUndefined();
    // Lexical chunks query fires with the tag filter, but WITHOUT an ILIKE
    // predicate (filter-only mode drops it).
    const lexicalChunkQ = queries.find(
      (q) => /FROM chunks c/i.test(q.sql) && !q.sql.includes('embedding <=>'),
    );
    expect(lexicalChunkQ).toBeDefined();
    // ILIKE predicate must be absent from the WHERE clause (it stays in
    // SELECT/ORDER BY as a no-op since $1 is `%%`). Slice WHERE..ORDER BY.
    const chunkWhere = lexicalChunkQ!.sql.slice(
      lexicalChunkQ!.sql.indexOf('WHERE'),
      lexicalChunkQ!.sql.indexOf('ORDER BY'),
    );
    expect(chunkWhere).not.toMatch(/ILIKE/i);
    expect(lexicalChunkQ!.params.some((p) => Array.isArray(p) && (p as unknown[]).includes('chore'))).toBe(true);
    // Lexical todos query also fires with the tag filter, no ILIKE.
    const lexicalTodoQ = queries.find(
      (q) => /FROM todos\b/i.test(q.sql) && !q.sql.includes('embedding <=>'),
    );
    expect(lexicalTodoQ).toBeDefined();
    expect(lexicalTodoQ!.sql).not.toMatch(/ILIKE/i);
    expect(lexicalTodoQ!.params.some((p) => Array.isArray(p) && (p as unknown[]).includes('chore'))).toBe(true);
  });

  it('POST /search skips lexical entirely for queries shorter than 2 chars (noise floor)', async () => {
    // A 1-char query like "a" would match ~everything via ILIKE %a%; the
    // helpers short-circuit to [] in that case so they never even fire SQL.
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });
    await app.fetch(new Request('http://localhost/api/v1/search', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'a', graph: false }),
    }));
    const lexicalQ = queries.find((q) => /ILIKE \$1/i.test(q.sql) && !q.sql.includes('embedding <=>'));
    expect(lexicalQ).toBeUndefined();
  });

  it('POST /search with excluded_entity_types=["todo"] skips the todo fetch entirely', async () => {
    // The todo fetch path is conditionally enabled; with todo excluded
    // we should not call findSimilarTodos. Easy check: no query against
    // the todos table fires.
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [] } as any;
    });
    await app.fetch(new Request('http://localhost/api/v1/search', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test', excluded_entity_types: ['todo'], graph: false }),
    }));
    const todoQ = queries.find((q) => /FROM todos\b/i.test(q.sql) && q.sql.includes('embedding <=>'));
    expect(todoQ).toBeUndefined();
  });
});

describe('RAG API', () => {
  let deps: ServiceDeps;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    deps = mockDeps();
    app = createApp(deps);
  });

  it('rejects RAG without question', async () => {
    const res = await app.fetch(new Request('http://localhost/api/v1/rag', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
  });

  it('returns an answer with empty citations when there are no chunks', async () => {
    vi.mocked(deps.db.query).mockResolvedValue({ rows: [] } as any);

    const res = await app.fetch(new Request('http://localhost/api/v1/rag', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'What?' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.answer).toBeTruthy();
    expect(body.citations).toEqual([]);
    expect(body.used_chunks).toBe(0);
  });

  it('auto-routes to thorough when caller opts in via depth=auto and the classifier says so', async () => {
    vi.mocked(deps.db.query).mockResolvedValue({ rows: [] } as any);
    // Override the depth classifier to return thorough
    vi.mocked(deps.queryDepthLLM.complete).mockResolvedValueOnce({
      content: JSON.stringify({ depth: 'thorough', reason: 'comparison query' }),
      tokensUsed: { input: 0, output: 0, total: 0 },
    });

    const res = await app.fetch(new Request('http://localhost/api/v1/rag', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      // depth: 'auto' opts into the classifier path. Default is now 'fast'
      // so without this the test would route to fast and bypass the classifier.
      body: JSON.stringify({ question: 'Compare X and Y.', depth: 'auto' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta).toBeDefined();
    expect(body.meta.depth_used).toBe('thorough');
    expect(body.meta.depth_reason).toContain('comparison');
  });

  it('defaults to fast when depth is not specified (post-baseline-2026-04-25)', async () => {
    vi.mocked(deps.db.query).mockResolvedValue({ rows: [] } as any);

    const res = await app.fetch(new Request('http://localhost/api/v1/rag', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Anything' }),  // no depth field
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.depth_used).toBe('fast');
    // With default 'fast', the classifier is skipped (no entity extraction
    // either — that's tied to the auto/thorough paths).
    expect(deps.queryDepthLLM.complete).not.toHaveBeenCalled();
  });

  it('honors caller force of depth=fast and skips the classifier', async () => {
    vi.mocked(deps.db.query).mockResolvedValue({ rows: [] } as any);

    const res = await app.fetch(new Request('http://localhost/api/v1/rag', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Anything', depth: 'fast' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.depth_used).toBe('fast');
    expect(body.meta.depth_reason).toContain('caller forced');
    // Classifier should not have been called when depth is explicitly set
    expect(deps.queryDepthLLM.complete).not.toHaveBeenCalled();
  });

  it('honors caller force of depth=thorough', async () => {
    vi.mocked(deps.db.query).mockResolvedValue({ rows: [] } as any);

    const res = await app.fetch(new Request('http://localhost/api/v1/rag', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Anything', depth: 'thorough' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.depth_used).toBe('thorough');
    expect(body.meta.depth_reason).toContain('caller forced');
  });
});
