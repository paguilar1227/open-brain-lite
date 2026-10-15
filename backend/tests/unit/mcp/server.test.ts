import { describe, it, expect, vi } from 'vitest';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from '../../../src/mcp/server.js';
import type { ServiceDeps } from '../../../src/services/index.js';

function mockDeps(): ServiceDeps {
  return {
    db: {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      pool: {} as any,
      transaction: vi.fn(),
      close: vi.fn(),
    } as any,
    embeddingProvider: {
      embed: vi.fn().mockResolvedValue(new Array(3072).fill(0.1)),
      dimensions: 3072,
    },
    metadataLLM: {
      complete: vi.fn().mockResolvedValue({
        content: JSON.stringify({ title: 'Auto', topics: [], extracted_text: null }),
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

        content: 'answer',

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
    config: { apiKey: 'test' } as any,
  };
}

async function callMcp(
  deps: ServiceDeps,
  body: unknown,
): Promise<{ status: number; headers: Record<string, string>; body: any }> {
  const server = createMcpServer(deps);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => 'test-session',
    enableJsonResponse: true,
  });
  await server.connect(transport);

  const req = new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
  });

  const res = await transport.handleRequest(req);
  const text = await res.text();
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body: text ? JSON.parse(text) : null,
  };
}

describe('MCP server', () => {
  it('responds to initialize with protocol version and server info', async () => {
    const deps = mockDeps();
    const result = await callMcp(deps, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      },
    });

    expect(result.status).toBe(200);
    expect(result.body.result.serverInfo.name).toBe('open-brain-lite');
    expect(result.body.result.serverInfo.version).toBe('0.1.0');
    expect(result.body.result.instructions).toContain('Personal Knowledge Base');
    expect(result.body.result.capabilities.tools).toBeDefined();
  });

  it('lists all 25 tools on tools/list', async () => {
    const deps = mockDeps();

    // MCP requires initialize before other calls; use stateful session flow
    const server = createMcpServer(deps);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => 'test-session',
      enableJsonResponse: true,
    });
    await server.connect(transport);

    // Step 1: initialize (grab session id from headers)
    const initReq = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } },
      }),
    });
    const initRes = await transport.handleRequest(initReq);
    const sessionId = initRes.headers.get('mcp-session-id')!;
    expect(sessionId).toBeTruthy();

    // Step 2: list tools
    const listReq = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
        'mcp-session-id': sessionId,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    const listRes = await transport.handleRequest(listReq);
    expect(listRes.status).toBe(200);
    const listBody = JSON.parse(await listRes.text());
    const toolNames = listBody.result.tools.map((t: any) => t.name);

    expect(toolNames).toEqual(expect.arrayContaining([
      'list_projects',
      'create_project',
      'list',
      'get',
      'download',
      'create',
      'update',
      'add_comment',
      'list_comments',
      'update_comment',
      'archive',
      'restore',
      'search',
      'find_mentions',
      'list_tags',
      'rename_tag',
      'list_activity',
      'ask',
      'retry',
      'reprocess',
      'replace',
      'save_from_url',
    ]));
    expect(toolNames).toHaveLength(25);
  });

  it('calls create_project and returns the created project', async () => {
    const deps = mockDeps();
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO projects')) {
        return {
          rows: [{
            id: 'proj-1', name: 'Test', description: null,
            status: 'active', created_at: new Date(), updated_at: new Date(),
          }],
        } as any;
      }
      return { rows: [] } as any;
    });

    const server = createMcpServer(deps);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => 'test-session',
      enableJsonResponse: true,
    });
    await server.connect(transport);

    const initReq = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } },
      }),
    });
    const initRes = await transport.handleRequest(initReq);
    const sessionId = initRes.headers.get('mcp-session-id')!;

    const callReq = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
        'mcp-session-id': sessionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'create_project', arguments: { name: 'Test' } },
      }),
    });
    const callRes = await transport.handleRequest(callReq);
    expect(callRes.status).toBe(200);
    const callBody = JSON.parse(await callRes.text());
    const text = callBody.result.content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.id).toBe('proj-1');
    expect(parsed.name).toBe('Test');
  });

  // ---------- update tool ----------

  /**
   * Init + call helper for tool-call tests. Avoids 60 lines of session
   * setup per test. Returns the parsed response body so each test can
   * assert on either the success payload or the JSON-RPC error.
   *
   * Defaults to the 'update' tool for back-compat with the existing tests
   * that called this as `callUpdate`. Pass a `toolName` to target other tools.
   */
  async function callTool(
    deps: ServiceDeps,
    args: Record<string, unknown>,
    toolName: string = 'update',
  ): Promise<{ status: number; body: any; sqlCalls: Array<{ sql: string; params: unknown[] }> }> {
    const sqlCalls: Array<{ sql: string; params: unknown[] }> = [];
    // Capture the existing mock implementation once, then wrap it. Reading
    // it back from the wrapped mock would recurse — careful not to do that.
    const origImpl = vi.mocked(deps.db.query).getMockImplementation();
    vi.mocked(deps.db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      sqlCalls.push({ sql, params: params ?? [] });
      return origImpl ? await origImpl(sql, params) : ({ rows: [] } as any);
    });

    const server = createMcpServer(deps);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => 'test-session',
      enableJsonResponse: true,
    });
    await server.connect(transport);

    const initReq = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } },
      }),
    });
    const initRes = await transport.handleRequest(initReq);
    const sessionId = initRes.headers.get('mcp-session-id')!;

    const callReq = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
        'mcp-session-id': sessionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: toolName, arguments: args },
      }),
    });
    const callRes = await transport.handleRequest(callReq);
    return {
      status: callRes.status,
      body: JSON.parse(await callRes.text()),
      sqlCalls,
    };
  }

  it('update kind=todo flips status and forwards the right SET clauses', async () => {
    const todoId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const deps = mockDeps();
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/UPDATE\s+todos/i.test(sql)) {
        return { rows: [{ id: todoId, content: 'task', status: 'done', priority: 'P1' }] } as any;
      }
      return { rows: [] } as any;
    });

    const { body, sqlCalls } = await callTool(deps, {
      kind: 'todo',
      id: todoId,
      status: 'done',
      priority: 'P1',
    });

    expect(body.result?.isError).not.toBe(true);
    const updateSql = sqlCalls.find((q) => /UPDATE\s+todos/i.test(q.sql));
    expect(updateSql).toBeDefined();
    expect(updateSql!.sql).toMatch(/status\s*=/i);
    expect(updateSql!.sql).toMatch(/priority\s*=/i);
  });

  it('update kind=content updates metadata only (not the body)', async () => {
    const ciId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const deps = mockDeps();
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/UPDATE\s+content_items/i.test(sql)) {
        return { rows: [{
          id: ciId, type: 'note', title: 'Renamed',
          content: null, blob_url: null, mime_type: null, file_hash: null,
          project_ids: ['p1'], tags: ['retagged'],
          embedding: null, metadata: {},
          source_url: null, published_at: null, archived: false,
          processing_status: 'ready', processing_error: null,
          ingest_completed_at: new Date(),
          created_at: new Date(), updated_at: new Date(),
        }] } as any;
      }
      return { rows: [] } as any;
    });

    const { body, sqlCalls } = await callTool(deps, {
      kind: 'content',
      id: ciId,
      title: 'Renamed',
      project_ids: ['p1'],
      tags: ['retagged'],
    });

    expect(body.result?.isError).not.toBe(true);
    const updateSql = sqlCalls.find((q) => /UPDATE\s+content_items/i.test(q.sql));
    expect(updateSql).toBeDefined();
    expect(updateSql!.sql).toMatch(/title\s*=/i);
    expect(updateSql!.sql).toMatch(/project_ids\s*=/i);
    expect(updateSql!.sql).toMatch(/tags\s*=/i);
    // CRITICAL: body content must NOT appear in the UPDATE. If a future
    // change accidentally exposes `content` on the update tool, chunks
    // would silently go stale. Catch that here.
    expect(updateSql!.sql).not.toMatch(/\bcontent\s*=/i);

    // Embedding stripped from response payload.
    const text = body.result.content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed).not.toHaveProperty('embedding');
  });

  it('update kind=content with content edits the body when blob_url is null (text note)', async () => {
    const ciId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    const deps = mockDeps();
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/SELECT \* FROM content_items WHERE id = \$1/i.test(sql)) {
        return { rows: [{
          id: ciId, type: 'note', title: 'My note',
          content: 'old body', blob_url: null, mime_type: null, file_hash: null,
          project_ids: [], tags: [], embedding: null, metadata: {},
          source_url: null, published_at: null, archived: false,
          processing_status: 'ready', processing_error: null,
          ingest_completed_at: new Date(),
          created_at: new Date(), updated_at: new Date(),
        }] } as any;
      }
      if (/UPDATE\s+content_items\s+SET/i.test(sql)) {
        return { rows: [{ id: ciId }] } as any;
      }
      return { rows: [] } as any;
    });

    const { body, sqlCalls } = await callTool(deps, {
      kind: 'content',
      id: ciId,
      content: 'totally new markdown body, much improved',
    });

    expect(body.result?.isError).not.toBe(true);

    // Body-edit branch ran: chunks deleted + status flipped to pending.
    const chunksDeleted = sqlCalls.find((q) => /DELETE\s+FROM\s+chunks/i.test(q.sql));
    expect(chunksDeleted).toBeDefined();
    const statusReset = sqlCalls.find(
      (q) => /UPDATE\s+content_items/i.test(q.sql)
        && /processing_status/i.test(q.sql)
        && q.params[0] === 'pending',
    );
    expect(statusReset).toBeDefined();
  });

  it('update kind=content with content returns BODY_IMMUTABLE when blob_url is set', async () => {
    const ciId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    const deps = mockDeps();
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/SELECT \* FROM content_items WHERE id = \$1/i.test(sql)) {
        return { rows: [{
          id: ciId, type: 'document', title: 'Some PDF',
          content: 'extracted text from pdf',
          blob_url: 'https://blob/file.pdf',
          mime_type: 'application/pdf', file_hash: 'abc',
          project_ids: [], tags: [], embedding: null, metadata: {},
          source_url: null, published_at: null, archived: false,
          processing_status: 'ready', processing_error: null,
          ingest_completed_at: new Date(),
          created_at: new Date(), updated_at: new Date(),
        }] } as any;
      }
      return { rows: [] } as any;
    });

    const { body } = await callTool(deps, {
      kind: 'content',
      id: ciId,
      content: 'rewriting the PDF transcript by hand — DO NOT',
    });

    expect(body.result?.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/BODY_IMMUTABLE/);
    expect(body.result.content[0].text).toMatch(/archive-and-reupload/i);
  });

  it('update kind=project changes name + status', async () => {
    const projId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const deps = mockDeps();
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/UPDATE\s+projects/i.test(sql)) {
        return { rows: [{
          id: projId, name: 'Renamed', description: null, status: 'completed',
          created_at: new Date(), updated_at: new Date(),
        }] } as any;
      }
      return { rows: [] } as any;
    });

    const { body, sqlCalls } = await callTool(deps, {
      kind: 'project',
      id: projId,
      name: 'Renamed',
      status: 'completed',
    });

    expect(body.result?.isError).not.toBe(true);
    const updateSql = sqlCalls.find((q) => /UPDATE\s+projects/i.test(q.sql));
    expect(updateSql).toBeDefined();
    expect(updateSql!.sql).toMatch(/name\s*=/i);
    expect(updateSql!.sql).toMatch(/status\s*=/i);
  });

  it('update rejects todo status that is actually a project status (cross-kind)', async () => {
    const deps = mockDeps();
    const { body, sqlCalls } = await callTool(deps, {
      kind: 'todo',
      id: '11111111-1111-1111-1111-111111111111',
      status: 'completed',  // valid for project, NOT for todo
    });

    expect(body.result?.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/Invalid todo status/i);
    // Must short-circuit before hitting the DB.
    expect(sqlCalls.find((q) => /UPDATE\s+todos/i.test(q.sql))).toBeUndefined();
  });

  it('update rejects status field on kind=content with a clear error', async () => {
    const deps = mockDeps();
    const { body, sqlCalls } = await callTool(deps, {
      kind: 'content',
      id: '22222222-2222-2222-2222-222222222222',
      status: 'done',  // valid enum value, but `status` isn't a content field
    });

    expect(body.result?.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/not a content field/i);
    expect(sqlCalls.find((q) => /UPDATE\s+content_items/i.test(q.sql))).toBeUndefined();
  });

  it('update rejects a non-UUID id', async () => {
    const deps = mockDeps();
    const { body, sqlCalls } = await callTool(deps, {
      kind: 'todo',
      id: 'not-a-uuid',
      status: 'done',
    });

    expect(body.result?.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/Invalid UUID/i);
    expect(sqlCalls.length).toBe(0);
  });

  it('update returns error when the row does not exist', async () => {
    const deps = mockDeps();
    // The DB UPDATE returns no rows → service returns null → tool returns error
    vi.mocked(deps.db.query).mockResolvedValue({ rows: [] } as any);

    const { body } = await callTool(deps, {
      kind: 'project',
      id: '33333333-3333-3333-3333-333333333333',
      name: 'X',
    });

    expect(body.result?.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/No project found/i);
  });

  // ---------- comment tools ----------

  it('add_comment forwards todo_id + content to insertComment', async () => {
    const todoId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    const deps = mockDeps();
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/INSERT INTO todo_comments/i.test(sql)) {
        return { rows: [{ id: 'c-1' }] } as any;
      }
      return { rows: [] } as any;
    });

    const { body, sqlCalls } = await callTool(deps, {
      todo_id: todoId,
      content: 'Triage note: blocked on Sarah',
    }, 'add_comment');

    expect(body.result?.isError).not.toBe(true);
    const insertSql = sqlCalls.find((q) => /INSERT INTO todo_comments/i.test(q.sql));
    expect(insertSql).toBeDefined();
    expect(insertSql!.params).toContain(todoId);
    expect(insertSql!.params).toContain('Triage note: blocked on Sarah');

    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed).toEqual({ id: 'c-1', todo_id: todoId });
  });

  it('list_comments returns the comment rows verbatim', async () => {
    const todoId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    const deps = mockDeps();
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/FROM\s+todo_comments/i.test(sql)) {
        return {
          rows: [
            { id: 'c-1', todo_id: todoId, content: 'first', created_at: new Date(), updated_at: new Date() },
            { id: 'c-2', todo_id: todoId, content: 'second', created_at: new Date(), updated_at: new Date() },
          ],
        } as any;
      }
      return { rows: [] } as any;
    });

    const { body } = await callTool(deps, { todo_id: todoId }, 'list_comments');
    expect(body.result?.isError).not.toBe(true);

    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].content).toBe('first');
    expect(parsed[1].content).toBe('second');
  });

  it('update_comment 404s on unknown id BEFORE issuing the UPDATE', async () => {
    const deps = mockDeps();
    vi.mocked(deps.db.query).mockResolvedValue({ rows: [] } as any);  // getComment returns nothing

    const { body, sqlCalls } = await callTool(deps, {
      comment_id: '11111111-1111-1111-1111-111111111111',
      content: 'fix typo',
    }, 'update_comment');

    expect(body.result?.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/No comment found/i);
    // Critical: must not silently UPDATE 0 rows. The lookup must run, and
    // the UPDATE must NOT.
    expect(sqlCalls.find((q) => /UPDATE\s+todo_comments/i.test(q.sql))).toBeUndefined();
  });

  it('update_comment writes the new content when the id exists', async () => {
    const cid = '22222222-2222-2222-2222-222222222222';
    const deps = mockDeps();
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      // First call (getComment) returns the row; subsequent UPDATE returns no rows.
      if (/SELECT.*FROM\s+todo_comments\s+WHERE\s+id/i.test(sql)) {
        return {
          rows: [{ id: cid, todo_id: 't1', content: 'old', created_at: new Date(), updated_at: new Date() }],
        } as any;
      }
      return { rows: [] } as any;
    });

    const { body, sqlCalls } = await callTool(deps, {
      comment_id: cid,
      content: 'updated content',
    }, 'update_comment');

    expect(body.result?.isError).not.toBe(true);
    const updateSql = sqlCalls.find((q) => /UPDATE\s+todo_comments/i.test(q.sql));
    expect(updateSql).toBeDefined();
    expect(updateSql!.params).toContain('updated content');
    expect(updateSql!.params).toContain(cid);
  });

  it('comment tools reject non-UUID ids', async () => {
    const deps = mockDeps();
    const r1 = await callTool(deps, { todo_id: 'bad', content: 'x' }, 'add_comment');
    expect(r1.body.result?.isError).toBe(true);

    const r2 = await callTool(deps, { todo_id: 'bad' }, 'list_comments');
    expect(r2.body.result?.isError).toBe(true);

    const r3 = await callTool(deps, { comment_id: 'bad', content: 'x' }, 'update_comment');
    expect(r3.body.result?.isError).toBe(true);
  });

  // ---------- archive / restore ----------

  it('archive auto-detects content kind and issues UPDATE archived=true', async () => {
    const ciId = '77777777-7777-7777-7777-777777777777';
    const deps = mockDeps();
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      // First the kind probe (getContentItem) returns the row with archived=false.
      if (/SELECT \* FROM content_items WHERE id = \$1/i.test(sql)) {
        return {
          rows: [{
            id: ciId, type: 'note', title: 'temp', content: 'x',
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

    const { body, sqlCalls } = await callTool(deps, { id: ciId }, 'archive');
    expect(body.result?.isError).not.toBe(true);

    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed).toEqual({ id: ciId, kind: 'content', archived: true, already: false });

    const archiveSql = sqlCalls.find(
      (q) => /UPDATE\s+content_items/i.test(q.sql)
        && /archived\s*=\s*true/i.test(q.sql),
    );
    expect(archiveSql).toBeDefined();
  });

  it('archive on an already-archived row is a no-op (already=true) and skips the UPDATE', async () => {
    const ciId = '88888888-8888-8888-8888-888888888888';
    const deps = mockDeps();
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/SELECT \* FROM content_items WHERE id = \$1/i.test(sql)) {
        return {
          rows: [{
            id: ciId, type: 'note', title: 'temp', content: null,
            blob_url: null, mime_type: null, file_hash: null,
            project_ids: [], tags: [], embedding: null, metadata: {},
            source_url: null, published_at: null, archived: true,  // already archived
            processing_status: 'ready', processing_error: null,
            ingest_completed_at: new Date(),
            created_at: new Date(), updated_at: new Date(),
          }],
        } as any;
      }
      return { rows: [] } as any;
    });

    const { body, sqlCalls } = await callTool(deps, { id: ciId }, 'archive');
    expect(body.result?.isError).not.toBe(true);

    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.already).toBe(true);
    // The UPDATE must NOT fire — the row is already archived.
    expect(sqlCalls.find(
      (q) => /UPDATE\s+content_items/i.test(q.sql) && /archived\s*=\s*true/i.test(q.sql),
    )).toBeUndefined();
  });

  it('restore auto-detects content kind and flips archived back to false', async () => {
    const ciId = '99999999-9999-9999-9999-999999999999';
    const deps = mockDeps();
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/SELECT \* FROM content_items WHERE id = \$1/i.test(sql)) {
        return {
          rows: [{
            id: ciId, type: 'document', title: 'archived-doc', content: 'x',
            blob_url: null, mime_type: null, file_hash: null,
            project_ids: [], tags: [], embedding: null, metadata: {},
            source_url: null, published_at: null, archived: true,
            processing_status: 'ready', processing_error: null,
            ingest_completed_at: new Date(),
            created_at: new Date(), updated_at: new Date(),
          }],
        } as any;
      }
      return { rows: [] } as any;
    });

    const { body, sqlCalls } = await callTool(deps, { id: ciId }, 'restore');
    expect(body.result?.isError).not.toBe(true);

    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed).toEqual({ id: ciId, kind: 'content', archived: false, already: false });

    expect(sqlCalls.find(
      (q) => /UPDATE\s+content_items/i.test(q.sql) && /archived\s*=\s*false/i.test(q.sql),
    )).toBeDefined();
  });

  it('archive returns error on unknown id (probes all three kinds)', async () => {
    const deps = mockDeps();
    vi.mocked(deps.db.query).mockResolvedValue({ rows: [] } as any);

    const { body, sqlCalls } = await callTool(deps, {
      id: '00000000-0000-0000-0000-000000000000',
    }, 'archive');

    expect(body.result?.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/No entity found/i);
    // Should have probed all three kinds before giving up.
    expect(sqlCalls.length).toBeGreaterThanOrEqual(3);
  });

  it('archive + restore reject non-UUID ids', async () => {
    const deps = mockDeps();
    const r1 = await callTool(deps, { id: 'bad' }, 'archive');
    expect(r1.body.result?.isError).toBe(true);
    expect(r1.sqlCalls.length).toBe(0);

    const r2 = await callTool(deps, { id: 'bad' }, 'restore');
    expect(r2.body.result?.isError).toBe(true);
    expect(r2.sqlCalls.length).toBe(0);
  });

  // ---------- create todo: subtasks + sections ----------

  // ---------- ask (RAG) ----------

  it('ask returns the synthesized answer + citations from ragQuery', async () => {
    const deps = mockDeps();
    // ragQuery does its own search + LLM call — exercise the integration end-to-end
    // by stubbing the DB to return a realistic chunk and mocking the fast-path LLM.
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      // chunk vector search (the search service's main query)
      if (/chunks\s+c/i.test(sql) && /similarity/i.test(sql)) {
        return {
          rows: [{
            id: 'chunk-1',
            content_item_id: 'ci-1',
            chunk_index: 0,
            content: 'Open Brain is a single-user knowledge base.',
            similarity: 0.92,
            ci_title: 'Open Brain Overview',
            ci_type: 'note',
            ci_source_url: null,
            ci_tags: [],
            ci_project_ids: [],
          }],
        } as any;
      }
      return { rows: [] } as any;
    });
    vi.mocked(deps.ragFastLLM.complete).mockResolvedValue({
      content: 'Open Brain is a personal KB [1].',
      tokensUsed: { input: 0, output: 0, total: 0 },
    });

    const { body } = await callTool(deps, {
      question: 'What is Open Brain?',
      depth: 'fast',
    }, 'ask');

    expect(body.result?.isError).not.toBe(true);
    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.answer).toBe('Open Brain is a personal KB [1].');
    expect(parsed.citations).toBeDefined();
    expect(parsed.meta.depth_used).toBe('fast');
    // Forced fast must skip the classifier (timing == 0).
    expect(parsed.meta.timings_ms.classify).toBe(0);
  });

  it('ask forwards depth=thorough to the deep RAG path', async () => {
    const deps = mockDeps();
    // Provide a chunk so ragQuery doesn't short-circuit (no chunks = no LLM call).
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/chunks\s+c/i.test(sql) && /similarity/i.test(sql)) {
        return {
          rows: [{
            id: 'chunk-1', content_item_id: 'ci-1', chunk_index: 0,
            content: 'X is faster than Y.', similarity: 0.91,
            ci_title: 'X vs Y', ci_type: 'note',
            ci_source_url: null, ci_tags: [], ci_project_ids: [],
          }],
        } as any;
      }
      return { rows: [] } as any;
    });
    vi.mocked(deps.ragDeepLLM.complete).mockResolvedValue({
      content: 'Thorough comparison [1].',
      tokensUsed: { input: 0, output: 0, total: 0 },
    });

    await callTool(deps, {
      question: 'Compare X and Y across my notes',
      depth: 'thorough',
    }, 'ask');

    expect(deps.ragDeepLLM.complete).toHaveBeenCalled();
    // And the fast LLM must NOT have been called when depth is forced thorough.
    expect(deps.ragFastLLM.complete).not.toHaveBeenCalled();
  });

  it('ask reports an LLM failure as an error response (not a silent empty answer)', async () => {
    const deps = mockDeps();
    // Provide a chunk so the synthesis LLM is actually called (otherwise
    // ragQuery short-circuits on 0 chunks and never throws).
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/chunks\s+c/i.test(sql) && /similarity/i.test(sql)) {
        return {
          rows: [{
            id: 'chunk-1', content_item_id: 'ci-1', chunk_index: 0,
            content: 'something', similarity: 0.9,
            ci_title: 't', ci_type: 'note',
            ci_source_url: null, ci_tags: [], ci_project_ids: [],
          }],
        } as any;
      }
      return { rows: [] } as any;
    });
    vi.mocked(deps.ragFastLLM.complete).mockRejectedValue(new Error('LLM 500'));

    const { body } = await callTool(deps, {
      question: 'anything',
      depth: 'fast',
    }, 'ask');

    expect(body.result?.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/LLM 500/);
  });

  it('create type=todo with parent_id + section forwards both to insertTodo', async () => {
    const parentId = 'aaaa1111-1111-1111-1111-111111111111';
    const deps = mockDeps();
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/INSERT INTO todos/i.test(sql)) {
        return { rows: [{ id: 'child-todo-1' }] } as any;
      }
      return { rows: [] } as any;
    });

    const { body, sqlCalls } = await callTool(deps, {
      type: 'todo',
      content: 'Subtask under parent',
      parent_id: parentId,
      section: 'Backlog',
    }, 'create');

    expect(body.result?.isError).not.toBe(true);
    const insertSql = sqlCalls.find((q) => /INSERT INTO todos/i.test(q.sql));
    expect(insertSql).toBeDefined();
    // Both fields must reach the DB. Without them the AI couldn't build
    // hierarchies (regression of the original MCP gap).
    expect(insertSql!.params).toContain(parentId);
    expect(insertSql!.params).toContain('Backlog');
  });

  it('download returns file metadata + a signed download URL for a file-backed item', async () => {
    const docId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const deps = mockDeps();
    deps.blobStorage = {
      ...deps.blobStorage,
      getReadSasUrl: vi.fn((u: string) => `${u}?sig=read`),
      getDownloadSasUrl: vi.fn((u: string) => `${u}?sig=dl&rscd=attachment`),
      getSize: vi.fn().mockResolvedValue(4_283_910),
    } as any;
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/SELECT \* FROM content_items WHERE id/i.test(sql)) {
        return { rows: [{
          id: docId, type: 'document', title: 'Q3 Report',
          blob_url: 'https://acct.blob.core.windows.net/c/q3.pdf',
          mime_type: 'application/pdf', content: 'extracted text',
          project_ids: [], tags: [], embedding: [0.1, 0.2],
          archived: false, processing_status: 'ready',
          created_at: new Date(), updated_at: new Date(),
        }] } as any;
      }
      return { rows: [] } as any;
    });

    const { body } = await callTool(deps, { id: docId }, 'download');
    expect(body.result?.isError).not.toBe(true);
    const meta = JSON.parse(body.result.content[0].text);
    expect(meta.file_type).toBe('application/pdf');
    expect(meta.filename).toBe('Q3 Report.pdf');     // ext derived from mime
    expect(meta.size_bytes).toBe(4_283_910);
    expect(meta.size).toMatch(/MB/);                  // human-readable
    expect(meta.download_url).toContain('sig=dl');    // signed, attachment
    expect(meta.download_url).toContain('rscd=attachment');
    expect(meta.blob_url).toContain('sig=read');      // signed, inline preview
    // The model gets metadata + URL — NOT the bytes or the embedding.
    expect(meta).not.toHaveProperty('embedding');
    expect(meta).not.toHaveProperty('content');
  });

  it('download on a text-only item returns no file and points at get', async () => {
    const noteId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    const deps = mockDeps();
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/SELECT \* FROM content_items WHERE id/i.test(sql)) {
        return { rows: [{
          id: noteId, type: 'note', title: 'My note',
          blob_url: null, mime_type: null, content: 'note body',
          project_ids: [], tags: [], archived: false, processing_status: 'ready',
          created_at: new Date(), updated_at: new Date(),
        }] } as any;
      }
      return { rows: [] } as any;
    });

    const { body } = await callTool(deps, { id: noteId }, 'download');
    expect(body.result?.isError).not.toBe(true);
    const meta = JSON.parse(body.result.content[0].text);
    expect(meta.file).toBeNull();
    expect(meta.note).toMatch(/get/i);
    expect(meta).not.toHaveProperty('download_url');
  });

  it('download rejects an invalid UUID', async () => {
    const deps = mockDeps();
    const { body } = await callTool(deps, { id: 'not-a-uuid' }, 'download');
    expect(body.result?.isError).toBe(true);
  });
});
