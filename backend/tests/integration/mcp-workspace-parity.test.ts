import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SearchRequestSchema } from '@open-brain/shared';
import { createApp } from '../../src/app.js';
import { StubEmbeddingProvider, StubLLMProvider } from '../../src/providers/stub.js';
import { mockBlobStorage } from '../helpers/mocks.js';
import { getProviderLogin } from '../../src/services/runtime.js';
import type { ServiceDeps } from '../../src/services/index.js';
import type { DbClient } from '../../src/db/client.js';

vi.mock('../../src/providers/model-catalog.js', () => ({ getModelCatalog: vi.fn(async () => ({
  status: 'available', models: [{ id: 'test-model', name: 'Test model' }], message: 'Mock catalog',
})) }));

let pg: PGlite, deps: ServiceDeps, app: ReturnType<typeof createApp>, directory: string;
let sequence = 0;
async function rpc(method: string, params: unknown = {}) {
  const response = await app.request('/mcp', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }) });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.error).toBeUndefined();
  return body.result;
}
async function call(name: string, args: Record<string, unknown> = {}) {
  const response = await rpc('tools/call', { name, arguments: args });
  expect(response.isError, response.content?.[0]?.text).not.toBe(true);
  return JSON.parse(response.content[0].text);
}
async function rejected(name: string, args: Record<string, unknown>) {
  const response = await rpc('tools/call', { name, arguments: args });
  expect(response.isError).toBe(true);
  return response.content[0].text;
}
async function ready(id: string) {
  let state = await call('get_content_status', { id });
  while (state.processing_status === 'pending') state = await call('get_content_status', { id });
  expect(state.processing_status).toBe('ready');
}
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'obl-mcp-parity-'));
  pg = new PGlite({ extensions: { vector, uuid_ossp } });
  const query = async (sql: string, params?: unknown[]) => {
    const r = await pg.query(sql, params); return { ...r, rowCount: r.affectedRows ?? r.rows.length };
  };
  const db = { query, pool: { query }, transaction: (fn: any) => pg.transaction(tx => fn({ query: async (sql: string, params?: unknown[]) => {
    const r = await tx.query(sql, params); return { ...r, rowCount: r.affectedRows ?? r.rows.length };
  } })) } as unknown as DbClient;
  for (const name of (await readdir('../migrations')).filter(n => n.endsWith('.sql')).sort()) await pg.exec(await readFile(`../migrations/${name}`, 'utf8'));
  const llm = new StubLLMProvider();
  deps = { db, config: { storageProvider: 'local', llmProvider: 'stub', settingsPath: join(directory, 'settings.json'),
    authDir: join(directory, 'auth'), localModel: 'old-local', embeddingModel: 'embeddinggemma',
    copilotModel: 'old-copilot', chatgptModel: 'old-chatgpt', llamaUrl: 'http://example.invalid/v1', llamaModel: 'old-llama' },
    embeddingProvider: new StubEmbeddingProvider(), metadataLLM: llm, mediaMetadataLLM: llm,
    ragFastLLM: llm, ragDeepLLM: llm, queryDepthLLM: llm,
    blobStorage: { ...mockBlobStorage(), upload: vi.fn(async (name: string) => `https://blob.storage/${name}`), delete: vi.fn().mockResolvedValue(undefined) },
  } as unknown as ServiceDeps;
  app = createApp(deps);
});
afterAll(async () => { await pg?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

describe('MCP workspace parity over the real HTTP transport', () => {
  it('covers every server-backed UI operation and exposes its required fields', async () => {
    // A new API operation must be mapped here so future UI work cannot silently
    // omit the agent interface. Graph diagnostics are developer-only endpoints.
    const routes: Record<string, string> = {
      'GET /projects': 'list_projects', 'POST /projects': 'create_project', 'GET /projects/counts': 'list_project_counts',
      'GET /projects/{id}': 'get', 'PUT /projects/{id}': 'update', 'DELETE /projects/{id}': 'delete',
      'POST /projects/{id}/restore': 'restore', 'POST /projects/{id}/pin': 'pin', 'POST /projects/{id}/unpin': 'unpin',
      'GET /content': 'list', 'POST /content': 'upload_file', 'POST /content/from-url': 'save_from_url',
      'GET /content/{id}': 'get', 'GET /content/{id}/status': 'get_content_status', 'PUT /content/{id}': 'update',
      'DELETE /content/{id}': 'delete', 'POST /content/{id}/restore': 'restore', 'POST /content/{id}/pin': 'pin',
      'POST /content/{id}/unpin': 'unpin', 'POST /content/{id}/retry': 'retry', 'POST /content/{id}/reprocess': 'reprocess',
      'POST /content/{id}/replace': 'replace_file', 'POST /content/{id}/edit-body': 'update', 'POST /content/bulk': 'bulk_content',
      'GET /todos': 'list', 'POST /todos': 'create', 'GET /todos/{id}': 'get', 'PUT /todos/{id}': 'update',
      'DELETE /todos/{id}': 'delete', 'POST /todos/{id}/restore': 'restore', 'POST /todos/{id}/pin': 'pin',
      'POST /todos/{id}/unpin': 'unpin', 'POST /todos/bulk': 'bulk_todos', 'POST /todos/reorder': 'reorder_todos',
      'GET /todos/{id}/comments': 'list_comments', 'POST /todos/{id}/comments': 'add_comment',
      'PUT /todos/{id}/comments/{cid}': 'update_comment', 'DELETE /todos/{id}/comments/{cid}': 'delete_comment',
      'GET /tags': 'list_tags', 'PUT /tags/{name}': 'rename_tag', 'DELETE /tags/{name}': 'delete_tag',
      'GET /activity': 'list_activity', 'GET /stats': 'get_stats', 'POST /search': 'search', 'POST /rag': 'ask', 'POST /find-mentions': 'find_mentions',
      'GET /sessions': 'list_sessions', 'POST /sessions': 'create_session', 'GET /sessions/{id}': 'get',
      'PUT /sessions/{id}': 'update_session', 'DELETE /sessions/{id}': 'delete_session', 'GET /sessions/{id}/context': 'get_session_context',
      'GET /sessions/{id}/timeline': 'session_timeline', 'GET /projects/{id}/timeline': 'project_timeline',
      'GET /projects/{id}/context': 'get_project_context', 'POST /projects/{id}/sessions': 'save_session',
      'POST /projects/{id}/consolidate': 'consolidate_project', 'GET /providers/{provider}/models': 'list_models',
      'POST /providers/{provider}/login': 'start_provider_login', 'GET /providers/{provider}/login': 'provider_login_status',
      'GET /runtime': 'get_settings', 'PUT /runtime': 'update_settings', 'GET /notifications': 'list_notifications',
    };
    const spec = await (await app.request('/api/openapi.json')).json();
    const operations = Object.entries(spec.paths).flatMap(([path, methods]) =>
      path.startsWith('/api/v1/') && !path.includes('/diagnostics/')
        ? Object.keys(methods as object).map(method => `${method.toUpperCase()} ${path.slice('/api/v1'.length)}`) : []);
    const source = await readFile('src/lite-routes.ts', 'utf8');
    for (const match of source.matchAll(/app\.(get|post|put|delete)\('\/api\/v1([^']+)'/g)) {
      operations.push(`${match[1].toUpperCase()} ${match[2].replace(/:([a-z]+)/g, '{$1}')}`);
    }
    const tools = (await rpc('tools/list')).tools;
    for (const operation of operations) {
      expect(routes[operation], `Missing MCP mapping: ${operation}`).toBeDefined();
      expect(tools.some((t: any) => t.name === routes[operation]), operation).toBe(true);
    }
    const fields = tools.find((t: any) => t.name === 'list').inputSchema.properties;
    for (const field of ['session_id', 'project_id', 'tags', 'parent_id', 'priority', 'due_before', 'due_after', 'processing_status', 'pinned', 'include_archived', 'before', 'q']) expect(fields).toHaveProperty(field);
    const searchFields = tools.find((t: any) => t.name === 'search').inputSchema.properties;
    for (const field of Object.keys(SearchRequestSchema.shape)) expect(searchFields).toHaveProperty(field);
    for (const name of ['delete', 'delete_session', 'delete_comment', 'delete_tag', 'bulk_content', 'bulk_todos']) {
      expect(tools.find((t: any) => t.name === name).annotations.destructiveHint).toBe(true);
    }
  });

  it('moves an artifact using only session_id and can detach it again (regression)', async () => {
    const project = await call('create_project', { name: 'MCP ownership' });
    const a = await call('create_session', { name: 'First', project_id: project.id, session_key: 'parity-first' });
    const again = await call('create_session', { name: 'Retry', project_id: project.id, session_key: 'parity-first' });
    expect(again.id).toBe(a.id);
    const b = await call('create_session', { name: 'Standalone' });
    const item = await call('create', { type: 'note', content: 'MCP ownership note', session_id: a.id }); await ready(item.id);
    await call('update', { kind: 'content', id: item.id, session_id: b.id });
    const moved = await call('get', { id: item.id }); expect(moved.session_id).toBe(b.id); expect(moved.project_ids).toEqual([]);
    expect((await call('list', { entity_type: 'note', session_id: a.id }))).toEqual([]);
    expect((await call('get_session_context', { session_id: b.id })).artifacts.some((x: any) => x.id === item.id)).toBe(true);
    await call('update', { kind: 'content', id: item.id, session_id: null });
    expect((await call('get', { id: item.id })).session_id).toBeNull();
    await call('update_session', { session_id: b.id, project_id: project.id, name: 'Moved session' });
    expect((await call('list_sessions', { project_id: project.id })).some((s: any) => s.id === b.id)).toBe(true);
  });

  it('uploads and replaces files with session ownership, preserving tags and history', async () => {
    const project = await call('create_project', { name: 'File parity' });
    const session = await call('create_session', { name: 'Files', project_id: project.id });
    const upload = await call('upload_file', { session_id: session.id, filename: 'agent.txt', file_base64: Buffer.from('Agent source first version').toString('base64'), tags: ['front-end'], folder: 'plans' }); await ready(upload.id);
    const replacement = await call('replace_file', { id: upload.id, filename: 'agent-v2.txt', file_base64: Buffer.from('Agent source second version').toString('base64') }); await ready(replacement.new_id);
    const latest = await call('get', { id: replacement.new_id });
    expect(latest.session_id).toBe(session.id); expect(latest.tags).toEqual(['front-end']); expect(latest.folder).toBe('plans');
    expect((await call('download', { id: replacement.new_id })).download_url).toContain('sig=test');
    const timeline = await call('project_timeline', { project_id: project.id, tags: ['front-end'] });
    expect(timeline.events.some((e: any) => e.entity_id === replacement.new_id && e.session_id === session.id)).toBe(true);
    expect((await call('session_timeline', { session_id: session.id, tags: ['front-end'] })).available_tags).toEqual(['front-end']);
    expect((await rejected('upload_file', { filename: 'bad.txt', file_base64: '***' }))).toContain('validation');
  });

  it('supports pins, archive browsing, substring, processing and cursor filters', async () => {
    const project = await call('create_project', { name: 'Filter parity' });
    const session = await call('create_session', { name: 'Filters', project_id: project.id });
    const first = await call('create', { type: 'note', title: 'Pinned alphabet', content: 'Filters source', session_id: session.id }); await ready(first.id);
    await call('pin', { kind: 'content', id: first.id }); await call('pin', { kind: 'project', id: project.id });
    expect((await call('list_projects', { pinned: true })).some((p: any) => p.id === project.id)).toBe(true);
    const filters = { entity_type: 'note', session_id: session.id, q: 'alphabet', pinned: true, processing_status: ['ready'] };
    expect((await call('list', filters)).map((x: any) => x.id)).toEqual([first.id]);
    await call('archive', { id: first.id }); expect(await call('list', filters)).toEqual([]);
    expect((await call('list', { ...filters, include_archived: true })).map((x: any) => x.id)).toEqual([first.id]);
    await call('restore', { id: first.id }); await call('unpin', { kind: 'content', id: first.id });
    expect(await call('list', filters)).toEqual([]);
    const row = await call('get', { id: first.id });
    expect(await call('list', { entity_type: 'note', session_id: session.id, before: row.created_at })).toEqual([]);
    await call('unpin', { kind: 'project', id: project.id });
  });

  it('handles task hierarchy, ordering, bulk nullable values, comments and reminders', async () => {
    const session = await call('create_session', { name: 'Task parity' });
    const root = await call('create', { type: 'todo', content: 'Root task', session_id: session.id });
    const child = await call('create', { type: 'todo', content: 'First child', parent_id: root.id });
    const other = await call('create', { type: 'todo', content: 'Second child', parent_id: root.id });
    await call('reorder_todos', { parent_id: root.id, ids: [other.id, child.id] });
    expect((await call('get', { id: other.id })).manual_order).toBeLessThan((await call('get', { id: child.id })).manual_order);
    await call('bulk_todos', { ids: [root.id], action: 'set_priority', priority: 'P1' });
    await call('bulk_todos', { ids: [root.id], action: 'set_due_date', due_date: '2020-01-01T00:00:00Z' });
    expect((await call('list', { entity_type: 'todo', session_id: session.id, parent_id: null, priority: 'P1', due_before: '2021-01-01T00:00:00Z' })).map((t: any) => t.id)).toEqual([root.id]);
    expect((await call('list_notifications')).notifications.some((n: any) => n.todo_id === root.id)).toBe(true);
    await call('bulk_todos', { ids: [root.id], action: 'set_priority', priority: null });
    await call('bulk_todos', { ids: [root.id], action: 'set_due_date', due_date: null });
    await call('bulk_todos', { ids: [root.id], action: 'set_status', status: 'done' });
    const cleared = await call('get', { id: root.id }); expect(cleared.priority).toBeNull(); expect(cleared.due_date).toBeNull(); expect(cleared.status).toBe('done');
    const comment = await call('add_comment', { todo_id: root.id, content: 'Agent comment' });
    const commentId = comment.id;
    await call('update_comment', { comment_id: commentId, content: 'Edited comment' });
    expect((await call('list_comments', { todo_id: root.id }))[0].content).toBe('Edited comment');
    await rejected('delete_comment', { comment_id: commentId, confirm_id: randomUUID() });
    await call('delete_comment', { comment_id: commentId, confirm_id: commentId });
    expect(await call('list_comments', { todo_id: root.id })).toEqual([]);
  });

  it('bulk-edits tags and supports personal tag inventory, rename and confirmed removal', async () => {
    const a = await call('create', { type: 'note', content: 'Tagged source A' }); await ready(a.id);
    const b = await call('create', { type: 'note', content: 'Tagged source B' }); await ready(b.id);
    await call('bulk_content', { ids: [a.id, b.id], action: 'add_tags', tags: ['parity-tag'] });
    expect((await call('list_tags', { scope: 'personal' })).find((t: any) => t.name === 'parity-tag').total).toBe(2);
    await call('rename_tag', { from: 'parity-tag', to: 'renamed-parity' });
    await rejected('delete_tag', { name: 'renamed-parity', confirm_name: 'wrong' });
    await call('delete_tag', { name: 'renamed-parity', confirm_name: 'renamed-parity' });
    expect((await call('get', { id: a.id })).tags).toEqual([]);
    await call('bulk_content', { ids: [a.id, b.id], action: 'archive' });
    await call('bulk_content', { ids: [a.id, b.id], action: 'restore' });
    await rejected('bulk_content', { ids: [a.id, b.id], action: 'delete', confirm_ids: [a.id] });
    expect((await call('get', { id: b.id })).id).toBe(b.id);
    await call('bulk_content', { ids: [a.id, b.id], action: 'delete', confirm_ids: [b.id, a.id] });
    expect((await deps.db.query('SELECT id FROM content_items WHERE id=ANY($1::uuid[])', [[a.id, b.id]])).rows).toEqual([]);
  });

  it('requires exact session confirmation, cascades owned artifacts and preserves other sessions', async () => {
    const session = await call('create_session', { name: 'Delete through MCP' });
    const keep = await call('create_session', { name: 'Keep through MCP' });
    const note = await call('create', { type: 'note', content: 'Owned delete source', session_id: session.id }); await ready(note.id);
    const survivor = await call('create', { type: 'note', content: 'Keep source', session_id: keep.id }); await ready(survivor.id);
    const task = await call('create', { type: 'todo', content: 'Owned task', session_id: session.id });
    await call('create', { type: 'todo', content: 'Owned child', parent_id: task.id });
    await call('add_comment', { todo_id: task.id, content: 'Owned comment' });
    await rejected('delete_session', { session_id: session.id, confirm_name: 'wrong name' });
    expect((await call('get', { id: note.id })).id).toBe(note.id);
    await call('delete_session', { session_id: session.id, confirm_name: session.name });
    for (const table of ['content_items', 'todos', 'project_timeline_events']) expect((await deps.db.query(`SELECT id FROM ${table} WHERE session_id=$1`, [session.id])).rows).toEqual([]);
    expect((await call('get', { id: survivor.id })).id).toBe(survivor.id);
    await rejected('delete', { kind: 'content', id: survivor.id, confirm_id: randomUUID() });
    await call('delete', { kind: 'content', id: survivor.id, confirm_id: survivor.id });
  });

  it('shares model settings and login state between stateless MCP calls and REST, without real providers', async () => {
    const before = await call('get_settings');
    const values = { provider: 'copilot', localModel: before.localModel, copilotModel: 'test-model', chatgptModel: before.chatgptModel, llamaUrl: before.llamaUrl, llamaModel: before.llamaModel };
    await call('update_settings', values);
    const ui = await (await app.request('/api/v1/runtime')).json(); expect(ui.copilotModel).toBe('test-model'); expect(ui.embeddingModel).toBe('embeddinggemma');
    expect(JSON.parse(await readFile(deps.config.settingsPath, 'utf8')).provider).toBe('copilot');
    expect((await call('list_models', { provider: 'copilot' })).models[0].id).toBe('test-model');
    const login = getProviderLogin(deps);
    const state = { status: 'running' as const, url: 'https://github.com/login/device', code: 'TEST-CODE' };
    const start = vi.spyOn(login, 'start').mockResolvedValue(state);
    const status = vi.spyOn(login, 'status').mockReturnValue(state);
    try {
      expect(await call('start_provider_login', { provider: 'copilot' })).toEqual(state);
      expect(await call('provider_login_status', { provider: 'copilot' })).toEqual(state);
      expect(await (await app.request('/api/v1/providers/copilot/login')).json()).toEqual(state);
    } finally { start.mockRestore(); status.mockRestore(); }
    // Avoid changing the provider used by later test ingestion.
    deps.config.llmProvider = 'stub';
  });

  it('matches UI search predicates including OR tags, mentions, exclusions and personal scope', async () => {
    const project = await call('create_project', { name: 'Search predicates' });
    const session = await call('create_session', { name: 'Search A', project_id: project.id });
    const sibling = await call('create_session', { name: 'Search B', project_id: project.id });
    const a = await call('create', { type: 'note', content: 'Search source alpha', session_id: session.id, tags: ['parity-red'] }); await ready(a.id);
    const b = await call('create', { type: 'note', content: 'Search source bravo', session_id: sibling.id, tags: ['parity-blue'] }); await ready(b.id);
    const solo = await call('create', { type: 'note', content: 'Search source personal', tags: ['parity-red'] }); await ready(solo.id);
    const ids = (hits: any[]) => [...new Set(hits.map(h => h.chunk?.content_item_id ?? h.todo?.id))].sort();
    const base = { query: '', project_id: project.id, tags: ['parity-red', 'parity-blue'], tag_match: 'any' };
    expect(ids(await call('search', base))).toEqual([a.id, b.id].sort());
    expect(ids(await call('search', { ...base, tag_match: 'all' }))).toEqual([]);
    expect(ids(await call('search', { ...base, session_id: session.id }))).toEqual([a.id]);
    expect(ids(await call('search', { ...base, content_item_ids: [b.id] }))).toEqual([b.id]);
    expect(ids(await call('search', { ...base, excluded_content_item_ids: [a.id] }))).toEqual([b.id]);
    expect(ids(await call('search', { ...base, excluded_tags: ['parity-blue'] }))).toEqual([a.id]);
    expect(ids(await call('search', { ...base, excluded_entity_types: ['note'] }))).toEqual([]);
    expect(ids(await call('search', { query: '', project_id: null, tags: ['parity-red'] }))).toEqual([solo.id]);
  });

  it('returns errors for missing session/context/timeline targets rather than successful empty results', async () => {
    const missing = randomUUID();
    for (const name of ['get_session_context', 'update_session', 'session_timeline', 'delete_session']) {
      expect(await rejected(name, { session_id: missing, confirm_name: 'missing', name: 'new' })).toContain('Session not found');
    }
    expect(await rejected('project_timeline', { project_id: missing })).toContain('Project not found');
  });

  it('exposes counts, todo pinning and confirmed project/todo deletions with the UI cascade semantics', async () => {
    const project = await call('create_project', { name: 'Count and delete' });
    const session = await call('create_session', { name: 'Owned by deleted project', project_id: project.id });
    const task = await call('create', { type: 'todo', content: 'Pinned task', session_id: session.id });
    await call('pin', { kind: 'todo', id: task.id });
    expect((await call('list', { entity_type: 'todo', session_id: session.id, pinned: true })).map((t: any) => t.id)).toEqual([task.id]);
    await call('unpin', { kind: 'todo', id: task.id });
    expect((await call('list_project_counts')).find((p: any) => p.project_id === project.id).todos).toBe(1);
    expect(await call('get_stats', { project_id: project.id })).toBeTruthy();
    const direct = await call('create', { type: 'todo', content: 'Direct project task', project_id: project.id });
    await call('delete', { kind: 'project', id: project.id, confirm_id: project.id });
    expect((await deps.db.query('SELECT id FROM project_sessions WHERE id=$1', [session.id])).rows).toEqual([]);
    expect((await deps.db.query('SELECT id FROM todos WHERE id=$1', [task.id])).rows).toEqual([]);
    expect((await call('get', { id: direct.id })).project_id).toBeNull();
    await rejected('bulk_todos', { ids: [direct.id], action: 'delete', confirm_ids: [] });
    await call('bulk_todos', { ids: [direct.id], action: 'delete', confirm_ids: [direct.id] });
    expect((await deps.db.query('SELECT id FROM todos WHERE id=$1', [direct.id])).rows).toEqual([]);
  });

  it('retries queued file cleanup after session deletion and refuses cleanup of a live session', async () => {
    const session = await call('create_session', { name: 'Cleanup retry' });
    await rejected('retry_session_cleanup', { session_id: session.id, confirm_id: session.id });
    const upload = await call('upload_file', { session_id: session.id, filename: 'cleanup.txt', file_base64: Buffer.from('Cleanup source').toString('base64') }); await ready(upload.id);
    vi.mocked(deps.blobStorage.delete!).mockRejectedValueOnce(new Error('Temporary storage failure'));
    expect((await call('delete_session', { session_id: session.id, confirm_name: session.name })).pending_files).toBe(1);
    await rejected('retry_session_cleanup', { session_id: session.id, confirm_id: randomUUID() });
    expect((await call('retry_session_cleanup', { session_id: session.id, confirm_id: session.id })).pending_files).toBe(0);
    expect((await deps.db.query('SELECT blob_url FROM session_file_cleanup WHERE session_id=$1', [session.id])).rows).toEqual([]);
  });
});
