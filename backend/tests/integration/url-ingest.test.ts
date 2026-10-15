/**
 * Integration tests for URL ingestion — dispatcher, per-type handlers,
 * dedup, and source_url surfacing.
 *
 * Mocks:
 *   - Supadata client (YouTube transcripts)
 *   - xAI and Firecrawl providers (mocked at module level via vi.mock)
 *   - fetch (for HEAD content-type detection + binary downloads)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock providers BEFORE importing anything that uses them
vi.mock('../../src/providers/supadata.js', () => ({
  SupadataClient: vi.fn().mockImplementation(() => ({
    fetchYouTubeTranscript: vi.fn(),
  })),
}));

vi.mock('../../src/providers/firecrawl.js', () => ({
  FirecrawlClient: vi.fn().mockImplementation(() => ({
    scrape: vi.fn(),
  })),
}));

vi.mock('../../src/providers/xai.js', () => ({
  XaiClient: vi.fn().mockImplementation(() => ({
    fetchXThread: vi.fn(),
  })),
}));

import { createApp } from '../../src/app.js';
import type { ServiceDeps } from '../../src/services/index.js';
import { SupadataClient } from '../../src/providers/supadata.js';
import { FirecrawlClient } from '../../src/providers/firecrawl.js';
import { XaiClient } from '../../src/providers/xai.js';

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
        content: JSON.stringify({ title: 'Auto-generated title', topics: [], extracted_text: null }),
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
      upload: vi.fn().mockResolvedValue('https://blob/file'),
      exists: vi.fn().mockResolvedValue(false),
      getUrl: vi.fn().mockReturnValue('https://blob/file'),
      getReadSasUrl: vi.fn((u: string) => u),
    },
    config: {
      llmProvider: 'real',
      apiKey: 'test-key',
      xaiApiKey: 'xai-test',
      firecrawlApiKey: 'fc-test',
      supadataApiKey: 'sd-test',
    } as any,
  };
}

const AUTH = { 'Authorization': 'Bearer test-key', 'Content-Type': 'application/json' };

describe('POST /api/v1/content/from-url', () => {
  let deps: ServiceDeps;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = mockDeps();
    app = createApp(deps);
  });

  it('rejects missing url', async () => {
    const res = await app.fetch(new Request('http://localhost/api/v1/content/from-url', {
      method: 'POST', headers: AUTH, body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
    // Wire shape after OpenAPIHono adoption: defaultHook prefixes the field
    // path. Match substring ("url" + "required") so the test survives small
    // message-format changes across zod-openapi versions.
    const body = await res.json();
    expect(body.error.toLowerCase()).toContain('url');
    expect(body.error.toLowerCase()).toContain('required');
  });

  it('dedups — returns existing item when source_url already saved', async () => {
    // First DB call is findByUrl — return an existing row
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (sql.includes('source_url = $1')) {
        return {
          rows: [{
            id: 'existing-1',
            type: 'document',
            title: 'Already saved',
            source_url: 'https://youtu.be/dQw4w9WgXcQ',
          }],
        } as any;
      }
      return { rows: [] } as any;
    });

    const supadataFetch = vi.fn();
    vi.mocked(SupadataClient).mockImplementation(() => ({ fetchYouTubeTranscript: supadataFetch }) as any);

    const res = await app.fetch(new Request('http://localhost/api/v1/content/from-url', {
      method: 'POST', headers: AUTH,
      body: JSON.stringify({ url: 'https://youtu.be/dQw4w9WgXcQ' }),
    }));

    expect(res.status).toBe(200); // 200 on dedup (no creation), 201 on new
    const body = await res.json();
    expect(body.deduped).toBe(true);
    expect(body.id).toBe('existing-1');
    expect(body.title).toBe('Already saved');
    // Supadata should NOT be hit on dedup path
    expect(supadataFetch).not.toHaveBeenCalled();
  });

  it('ingests YouTube — single Supadata call, no fallback chain', async () => {
    const supadataFetch = vi.fn().mockResolvedValue({
      content: 'We are no strangers to love',
      lang: 'en',
      availableLangs: ['en', 'es'],
    });
    vi.mocked(SupadataClient).mockImplementation(() => ({ fetchYouTubeTranscript: supadataFetch }) as any);

    // Mocks for the createContentItem DB calls (insert chunks, insert content_item)
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO content_items')) return { rows: [{ id: 'new-ci' }] } as any;
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request('http://localhost/api/v1/content/from-url', {
      method: 'POST', headers: AUTH,
      body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
    }));

    // Async ingest contract: 202 + {id, status:'pending', ...}. The actual
    // chunkCount/title materialize after the background tail completes.
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.id).toBe('new-ci');
    expect(body.source_url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(body.url_type).toBe('youtube');
    expect(body.deduped).toBe(false);
    expect(body.status).toBe('pending');

    // Single Supadata call — no fallback ladder behind it
    expect(supadataFetch).toHaveBeenCalledTimes(1);
    expect(supadataFetch).toHaveBeenCalledWith(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      { lang: 'en' },
    );

    // Verify source_url was passed through to insertContentItem
    const insertCall = vi.mocked(deps.db.query).mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO content_items'),
    );
    expect(insertCall).toBeDefined();
    const params = insertCall![1] as any[];
    // source_url is param $13 (1-indexed) → index 12 (0-indexed) after the
    // migration-009 `folder` column ($10) shifted the trailing params by one.
    expect(params[12]).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('ingests X thread — uses xAI Agent Tools (x_search)', async () => {
    const fetchXThread = vi.fn().mockResolvedValue({
      title: 'First post…',
      content: '@user: hello world\n@other: reply',
    });
    vi.mocked(XaiClient).mockImplementation(() => ({ fetchXThread }) as any);

    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO content_items')) return { rows: [{ id: 'x-ci' }] } as any;
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request('http://localhost/api/v1/content/from-url', {
      method: 'POST', headers: AUTH,
      body: JSON.stringify({ url: 'https://x.com/user/status/1234567890' }),
    }));

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.url_type).toBe('x');
    expect(body.source_url).toBe('https://x.com/user/status/1234567890');
    expect(body.status).toBe('pending');
    expect(fetchXThread).toHaveBeenCalledWith('https://x.com/user/status/1234567890');
  });

  it('ingests HTML — uses Firecrawl markdown', async () => {
    // Content must exceed MIN_HTML_CONTENT_CHARS (300) or the pipeline rejects it as a
    // suspected placeholder/error page. Use a real-feeling body.
    const longBody = '# Blog Post\n\n' + 'This is the content of a real blog post. '.repeat(15);
    const firecrawlScrape = vi.fn().mockResolvedValue({ title: 'Blog Post', markdown: longBody });
    vi.mocked(FirecrawlClient).mockImplementation(() => ({ scrape: firecrawlScrape }) as any);

    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO content_items')) return { rows: [{ id: 'html-ci' }] } as any;
      return { rows: [] } as any;
    });

    // Stub global fetch for the HEAD content-type check (return text/html)
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
    );

    const res = await app.fetch(new Request('http://localhost/api/v1/content/from-url', {
      method: 'POST', headers: AUTH,
      body: JSON.stringify({ url: 'https://example.com/article' }),
    }));

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.url_type).toBe('html');
    expect(body.status).toBe('pending');
    expect(firecrawlScrape).toHaveBeenCalledWith('https://example.com/article');

    globalFetch.mockRestore();
  });

  it('rejects HTML with placeholder-length body as likely 404 page', async () => {
    const placeholderBody = '# Example Domain\n\nThis domain is for examples.';
    const firecrawlScrape = vi.fn().mockResolvedValue({ title: 'Example Domain', markdown: placeholderBody });
    vi.mocked(FirecrawlClient).mockImplementation(() => ({ scrape: firecrawlScrape }) as any);

    const globalFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
    );

    const res = await app.fetch(new Request('http://localhost/api/v1/content/from-url', {
      method: 'POST', headers: AUTH,
      body: JSON.stringify({ url: 'https://example.com/placeholder' }),
    }));

    expect(res.status).toBe(400);
    const body = await res.json();
    // Either the "short content" or "error title pattern" guard catches it.
    expect(body.error).toMatch(/placeholder|error|short|Example Domain/i);

    globalFetch.mockRestore();
  });

  it('dedup merges new project_ids into existing content_item', async () => {
    // Prime findByUrl to return an existing item with project_ids: []
    let updateCalled: any = null;
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: any[]) => {
      if (sql.includes('source_url = $1')) {
        return {
          rows: [{
            id: 'existing-1',
            type: 'document',
            title: 'Already saved',
            source_url: 'https://youtu.be/abc123',
            project_ids: [],      // previously saved without a project
            tags: [],
          }],
        } as any;
      }
      if (sql.includes('UPDATE content_items')) {
        updateCalled = params;
        return { rows: [{ id: 'existing-1' }] } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request('http://localhost/api/v1/content/from-url', {
      method: 'POST', headers: AUTH,
      body: JSON.stringify({
        url: 'https://youtu.be/abc123',
        project_ids: ['proj-xyz'],
        tags: ['reference'],
      }),
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deduped).toBe(true);
    // UPDATE must have run to merge the new project_id + tag
    expect(updateCalled).not.toBeNull();
    expect(updateCalled).toEqual(expect.arrayContaining([['proj-xyz']]));
    expect(updateCalled).toEqual(expect.arrayContaining([['reference']]));
  });

  it('dedup returns correct url_type (not always "html")', async () => {
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (sql.includes('source_url = $1')) {
        return {
          rows: [{
            id: 'existing-yt',
            type: 'document',
            title: 'YT video',
            source_url: 'https://youtu.be/abc123',
            project_ids: ['proj-abc'],
            tags: [],
          }],
        } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request('http://localhost/api/v1/content/from-url', {
      method: 'POST', headers: AUTH,
      body: JSON.stringify({ url: 'https://youtu.be/abc123', project_ids: ['proj-abc'] }),
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deduped).toBe(true);
    expect(body.url_type).toBe('youtube'); // regression: was always 'html'
  });

  it('surfaces Supadata errors without retry — fail loudly, no fallback by design', async () => {
    const supadataFetch = vi.fn().mockRejectedValue(
      new Error('Supadata: HTTP 404 not-found — Video not found (245ms, url: https://youtu.be/xxxxxxxxxxx)'),
    );
    vi.mocked(SupadataClient).mockImplementation(() => ({ fetchYouTubeTranscript: supadataFetch }) as any);

    // Track the other clients to assert they weren't called
    const firecrawlScrape = vi.fn();
    vi.mocked(FirecrawlClient).mockImplementation(() => ({ scrape: firecrawlScrape }) as any);
    const xaiThread = vi.fn();
    vi.mocked(XaiClient).mockImplementation(() => ({ fetchXThread: xaiThread }) as any);

    const res = await app.fetch(new Request('http://localhost/api/v1/content/from-url', {
      method: 'POST', headers: AUTH,
      body: JSON.stringify({ url: 'https://youtu.be/xxxxxxxxxxx' }),
    }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Supadata');
    expect(supadataFetch).toHaveBeenCalledTimes(1);
    // No fallback fetchers were ever consulted
    expect(firecrawlScrape).not.toHaveBeenCalled();
    expect(xaiThread).not.toHaveBeenCalled();
  });
});

describe('source_url surfacing in search', () => {
  let deps: ServiceDeps;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = mockDeps();
    app = createApp(deps);
  });

  it('chunk search SQL selects ci.source_url AS parent_source_url', async () => {
    vi.mocked(deps.db.query).mockResolvedValue({ rows: [] } as any);
    await app.fetch(new Request('http://localhost/api/v1/search', {
      method: 'POST', headers: AUTH, body: JSON.stringify({ query: 'test' }),
    }));

    const calls = vi.mocked(deps.db.query).mock.calls;
    const chunkQ = calls.find((c) => typeof c[0] === 'string' && c[0].includes('FROM chunks'));
    expect(chunkQ).toBeDefined();
    expect(chunkQ![0]).toContain('ci.source_url AS parent_source_url');
  });

  it('search hit exposes parent_source_url when the parent item has one', async () => {
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (sql.includes('FROM chunks')) {
        return {
          rows: [{
            id: 'chunk-1', content_item_id: 'ci-1', chunk_index: 0, chunk_type: 'text',
            content: 'Rickrolled', metadata: {}, created_at: new Date(),
            similarity: 0.9,
            parent_type: 'document', parent_title: 'Rick Astley',
            parent_project_ids: [], parent_tags: [],
            parent_source_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          }],
        } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request('http://localhost/api/v1/search', {
      method: 'POST', headers: AUTH, body: JSON.stringify({ query: 'rick' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hits[0].chunk.parent_source_url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('RAG citation includes source_url when present', async () => {
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (sql.includes('FROM chunks')) {
        return {
          rows: [{
            id: 'chunk-1', content_item_id: 'ci-1', chunk_index: 0, chunk_type: 'text',
            content: 'some content', metadata: {}, created_at: new Date(),
            similarity: 0.9,
            parent_type: 'document', parent_title: 'Source doc',
            parent_project_ids: [], parent_tags: [],
            parent_source_url: 'https://example.com/source',
          }],
        } as any;
      }
      return { rows: [] } as any;
    });

    const res = await app.fetch(new Request('http://localhost/api/v1/rag', {
      method: 'POST', headers: AUTH, body: JSON.stringify({ question: 'what?' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.citations).toHaveLength(1);
    expect(body.citations[0].source_url).toBe('https://example.com/source');
  });
});
