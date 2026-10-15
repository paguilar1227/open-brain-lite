import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { createProject } from '../../src/services/projects.js';
import { consolidateProject, getProjectContext, saveProjectSession, startProjectConsolidation } from '../../src/services/project-memory.js';
import * as content from '../../src/services/content-items.js';
import { createTodo } from '../../src/services/todos.js';
import { findSimilarTodos, findTodosByLexical } from '../../src/db/todos.js';
import { beginContentReindex } from '../../src/db/reindex.js';
import { StubEmbeddingProvider, StubLLMProvider } from '../../src/providers/stub.js';
import { mockBlobStorage } from '../helpers/mocks.js';
import type { DbClient } from '../../src/db/client.js';
import type { ServiceDeps } from '../../src/services/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../src/mcp/server.js';

// Executes real PostgreSQL SQL and pgvector in WASM. Inference is explicitly stubbed.
// Docker, network inference, and browser acceptance are separate live checks.
describe('local PostgreSQL and durable project contract', () => {
  let pg: PGlite;
  let directory: string;
  let deps: ServiceDeps;
  const jobs: Promise<unknown>[] = [];
  const originalCreate = content.createContentItem;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'brain-db-test-'));
    pg = new PGlite(join(directory, 'database'), { extensions: { vector, uuid_ossp } });
    const query = async (sql: string, params?: unknown[]) => {
      const result = await pg.query(sql, params);
      return { ...result, rowCount: result.affectedRows ?? result.rows.length };
    };
    const db = { query, pool: { query }, close: () => pg.close(), transaction: (fn: (client: unknown) => Promise<unknown>) => pg.transaction(tx => fn({ query: async (sql: string, params?: unknown[]) => {
      const result = await tx.query(sql, params); return { ...result, rowCount: result.affectedRows ?? result.rows.length };
    } })) } as unknown as DbClient;
    const migrations = fileURLToPath(new URL('../../../migrations/', import.meta.url));
    for (const filename of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) await pg.exec(await readFile(join(migrations, filename), 'utf8'));
    const llm = new StubLLMProvider();
    deps = { db, embeddingProvider: new StubEmbeddingProvider(), metadataLLM: llm, mediaMetadataLLM: llm, ragFastLLM: llm, ragDeepLLM: llm, queryDepthLLM: llm, blobStorage: mockBlobStorage(), config: { llmProvider: 'stub' } } as ServiceDeps;
    vi.spyOn(content, 'createContentItem').mockImplementation(async (...args) => { const result = await originalCreate(...args); jobs.push(result.completion); return result; });
  });
  afterAll(async () => { await Promise.all(jobs); vi.restoreAllMocks(); await pg?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

  it('saves a session exactly once and returns its project-specific handoff', async () => {
    const project = await createProject(deps, 'Durable project', 'A multi-session companion');
    const input = { session_key: 'session-one', summary: 'Selected local storage', decisions: ['Keep documents on the machine'], next_steps: ['Verify restart'] };
    const saved = await saveProjectSession(deps, project.id, input);
    await Promise.all(jobs);
    const repeated = await saveProjectSession(deps, project.id, { ...input, summary: 'A retry must not create a duplicate' });
    expect(repeated.id).toBe(saved.id);
    const context = await getProjectContext(deps, project.id);
    expect(context.sessions).toHaveLength(1);
    expect(context.sessions[0].summary).toBe(input.summary);
    expect(context.sessions[0].note_id).toBeTruthy();
    const note = await pg.query<{ content: string }>('SELECT content FROM content_items WHERE id = $1', [saved.note_id]);
    expect(note.rows[0].content).toContain('Keep documents on the machine');
  });

  it('rolls back the session and its note together if linking fails, then safely retries', async () => {
    const project = await createProject(deps, 'Interrupted session', null);
    const input = { session_key: 'interrupted', summary: 'Atomic handoff source', decisions: ['Keep both records together'], next_steps: [] };
    await pg.exec(`CREATE FUNCTION fail_session_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected link failure'; END; $$;
      CREATE TRIGGER fail_session_link BEFORE UPDATE ON project_sessions FOR EACH ROW EXECUTE FUNCTION fail_session_link();`);
    try {
      await expect(saveProjectSession(deps, project.id, input)).rejects.toThrow('injected link failure');
    } finally {
      await pg.exec('DROP TRIGGER fail_session_link ON project_sessions; DROP FUNCTION fail_session_link();');
    }
    await Promise.all(jobs);
    expect((await getProjectContext(deps, project.id)).sessions).toHaveLength(0);
    expect((await pg.query('SELECT id FROM content_items WHERE project_ids @> ARRAY[$1]::uuid[]', [project.id])).rows).toHaveLength(0);
    const saved = await saveProjectSession(deps, project.id, input);
    expect(saved.note_id).toBeTruthy();
  });

  it('repairs an earlier unlinked session using the original facts', async () => {
    const project = await createProject(deps, 'Repair old handoff', null);
    await pg.query(`INSERT INTO project_sessions(project_id, session_key, summary, decisions, next_steps)
      VALUES ($1, 'old-session', 'Original durable facts', ARRAY['Original choice'], ARRAY['Original next action'])`, [project.id]);
    const saved = await saveProjectSession(deps, project.id, {
      session_key: 'old-session', summary: 'Different retry body', decisions: [], next_steps: [],
    });
    expect(saved.note_id).toBeTruthy();
    const note = await pg.query<{ content: string }>('SELECT content FROM content_items WHERE id = $1', [saved.note_id]);
    expect(note.rows[0].content).toContain('Original durable facts');
    expect(note.rows[0].content).toContain('Original choice');
    expect(note.rows[0].content).not.toContain('Different retry body');
  });

  it('creates one searchable handoff for concurrent saves of the same session', async () => {
    const project = await createProject(deps, 'Concurrent handoffs', null);
    const input = { session_key: 'same-session', summary: 'Shared session source', decisions: [], next_steps: [] };
    const saved = await Promise.all([saveProjectSession(deps, project.id, input), saveProjectSession(deps, project.id, input)]);
    expect(saved[0].id).toBe(saved[1].id);
    expect(saved[0].note_id).toBe(saved[1].note_id);
    const notes = await pg.query('SELECT id FROM content_items WHERE project_ids @> ARRAY[$1]::uuid[]', [project.id]);
    expect(notes.rows).toHaveLength(1);
  });

  it('commits consolidated memory and its searchable note together', async () => {
    const project = await createProject(deps, 'Atomic consolidated memory', null);
    await pg.exec(`CREATE FUNCTION fail_memory_note() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.folder = 'system/memory' THEN RAISE EXCEPTION 'injected memory note failure'; END IF;
      RETURN NEW; END; $$;
      CREATE TRIGGER fail_memory_note BEFORE INSERT ON content_items FOR EACH ROW EXECUTE FUNCTION fail_memory_note();`);
    try {
      await expect(consolidateProject(deps, project.id)).rejects.toThrow('injected memory note failure');
    } finally {
      await pg.exec('DROP TRIGGER fail_memory_note ON content_items; DROP FUNCTION fail_memory_note();');
    }
    expect((await getProjectContext(deps, project.id)).memory).toBeNull();
    const saved = await consolidateProject(deps, project.id);
    const note = await pg.query<{ content: string }>('SELECT content FROM content_items WHERE id = $1', [saved.note_id]);
    expect(note.rows[0].content).toBe(saved.summary);
  });

  it('returns a consolidation job while the model is pending, deduplicates starts, and retains prior memory', async () => {
    const project = await createProject(deps, 'Slow CPU handoff', null);
    const previous = await consolidateProject(deps, project.id);
    let finish!: (value: { content: string; tokensUsed: { input: number; output: number; total: number } }) => void;
    const answer = new Promise<{ content: string; tokensUsed: { input: number; output: number; total: number } }>(resolve => { finish = resolve; });
    const slow = { ...deps, ragFastLLM: { complete: vi.fn(() => answer) } };
    const job = await startProjectConsolidation(slow, project.id);
    expect(job.status).toBe('running');
    expect(await startProjectConsolidation(slow, project.id)).toMatchObject({ id: job.id, status: 'running' });
    expect((await getProjectContext(slow, project.id)).memory.id).toBe(previous.id);
    finish({ content: '# Finished handoff', tokensUsed: { input: 1, output: 1, total: 2 } });
    await vi.waitFor(async () => expect((await getProjectContext(slow, project.id)).consolidation?.status).toBe('completed'));
    const context = await getProjectContext(slow, project.id);
    expect(context.memory.summary).toBe('# Finished handoff');
    expect(context.consolidation?.memory_id).toBe(context.memory.id);
    expect(slow.ragFastLLM.complete).toHaveBeenCalledTimes(1);
  });

  it('exposes a failed consolidation job without replacing the last durable memory', async () => {
    const project = await createProject(deps, 'Failed CPU handoff', null);
    const previous = await consolidateProject(deps, project.id);
    const failing = { ...deps, ragFastLLM: { complete: vi.fn().mockRejectedValue(new Error('Local model unavailable')) } };
    await startProjectConsolidation(failing, project.id);
    await vi.waitFor(async () => expect((await getProjectContext(failing, project.id)).consolidation?.status).toBe('failed'));
    const context = await getProjectContext(failing, project.id);
    expect(context.consolidation?.error).toBe('Local model unavailable');
    expect(context.memory.id).toBe(previous.id);
  });

  it('commits a session before background indexing finishes', async () => {
    const project = await createProject(deps, 'Slow session indexing', null);
    let finish!: (value: { content: string; tokensUsed: { input: number; output: number; total: number } }) => void;
    const answer = new Promise<{ content: string; tokensUsed: { input: number; output: number; total: number } }>(resolve => { finish = resolve; });
    const slow = { ...deps, metadataLLM: { complete: vi.fn(() => answer) } };
    const session = await saveProjectSession(slow, project.id, {
      session_key: 'slow-index', summary: 'Preserve this handoff', decisions: [], next_steps: ['Continue tomorrow'],
    }, { waitForIndex: false });
    expect((await getProjectContext(slow, project.id)).sessions[0].id).toBe(session.id);
    expect((await pg.query('SELECT content FROM content_items WHERE id = $1', [session.note_id])).rows[0].content).toContain('Continue tomorrow');
    finish({ content: '{"title":"Session handoff","topics":[]}', tokensUsed: { input: 1, output: 1, total: 2 } });
    await vi.waitFor(async () => expect((await pg.query('SELECT processing_status FROM content_items WHERE id = $1', [session.note_id])).rows[0].processing_status).toBe('ready'));
  });

  it('handles an embedding failure while background metadata is still pending', async () => {
    const project = await createProject(deps, 'Embedding fails before metadata', null);
    let finish!: (value: { content: string; tokensUsed: { input: number; output: number; total: number } }) => void;
    const metadata = new Promise<{ content: string; tokensUsed: { input: number; output: number; total: number } }>(resolve => { finish = resolve; });
    const faulty = { ...deps, metadataLLM: { complete: vi.fn(() => metadata) },
      embeddingProvider: { dimensions: 768, embed: vi.fn().mockRejectedValue(new Error('Embedding service unavailable')) } };
    const session = await saveProjectSession(faulty, project.id, {
      session_key: 'failed-index', summary: 'Keep these durable facts', decisions: [], next_steps: [],
    }, { waitForIndex: false });
    try {
      await vi.waitFor(async () => {
        const note = (await pg.query('SELECT processing_status, processing_error, content FROM content_items WHERE id = $1', [session.note_id])).rows[0];
        expect(note.processing_status).toBe('failed');
        expect(note.processing_error).toContain('Embedding service unavailable');
        expect(note.content).toContain('Keep these durable facts');
      });
      expect((await getProjectContext(faulty, project.id)).sessions[0].id).toBe(session.id);
    } finally {
      finish({ content: '{"title":"Delayed metadata","topics":[]}', tokensUsed: { input: 1, output: 1, total: 2 } });
    }
  });

  it('captures through a real MCP client and exposes pending then ready source state', async () => {
    const project = await createProject(deps, 'MCP background capture', null);
    let finish!: (value: any) => void;
    const metadata = new Promise<any>(resolve => { finish = resolve; });
    const slow = { ...deps, metadataLLM: { complete: vi.fn(() => metadata) } };
    const server = createMcpServer(slow);
    const client = new Client({ name: 'capture-regression', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    let captured: Awaited<ReturnType<Client['callTool']>> | undefined;
    const capture = client.callTool({ name: 'create', arguments: { type: 'note', content: 'Keep the original project facts.', project_ids: [project.id] } })
      .then(result => { captured = result; });
    try {
      await vi.waitFor(() => expect(captured).toBeDefined());
      expect(captured?.isError).not.toBe(true);
      const saved = JSON.parse((captured!.content as Array<{ text: string }>)[0].text);
      expect(saved.status).toBe('pending');
      const pending = await client.callTool({ name: 'get', arguments: { id: saved.id } });
      expect(JSON.parse((pending.content as Array<{ text: string }>)[0].text)).toMatchObject({
        content: 'Keep the original project facts.', processing_status: 'pending', project_ids: [project.id],
      });
      finish({ content: '{"title":"Project facts","topics":[]}', tokensUsed: { input: 1, output: 1, total: 2 } });
      await vi.waitFor(async () => {
        const done = await client.callTool({ name: 'get', arguments: { id: saved.id } });
        expect(JSON.parse((done.content as Array<{ text: string }>)[0].text).processing_status).toBe('ready');
      });
    } finally {
      finish({ content: '{"title":"Project facts","topics":[]}', tokensUsed: { input: 1, output: 1, total: 2 } });
      await capture;
      await client.close();
      await server.close();
    }
  });

  it('applies project scope before limiting both lexical and vector todo results', async () => {
    const first = await createProject(deps, 'First scope', null);
    const second = await createProject(deps, 'Second scope', null);
    const target = await createTodo(deps, { content: 'deployment checklist alpha', projectId: first.id });
    await createTodo(deps, { content: 'deployment checklist beta', projectId: second.id });
    const lexical = await findTodosByLexical(deps.db, 'deployment', 1, { projectId: first.id });
    expect(lexical.map(row => row.id)).toEqual([target.id]);
    const embedding = await deps.embeddingProvider.embed('deployment checklist beta');
    const semantic = await findSimilarTodos(deps.db, embedding, -1, 1, { projectId: first.id });
    expect(semantic.map(row => row.id)).toEqual([target.id]);
  });

  it('rolls back the real source/state/index transition when deletion fails', async () => {
    const project = await createProject(deps, 'Recovery scope', null);
    const note = await content.createContentItem(deps, { type: 'note', title: 'Durable note', content: 'Preserve this searchable source during recovery.', projectIds: [project.id] });
    await note.completion;
    await pg.exec(`CREATE FUNCTION fail_retire_index() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected retirement failure'; END; $$;
      CREATE TRIGGER fail_retire_index BEFORE DELETE ON chunks FOR EACH STATEMENT EXECUTE FUNCTION fail_retire_index();`);
    await expect(beginContentReindex(deps.db, note.id, 'new source')).rejects.toThrow('injected retirement failure');
    await pg.exec('DROP TRIGGER fail_retire_index ON chunks; DROP FUNCTION fail_retire_index();');
    const rows = await pg.query<{ content: string; processing_status: string; count: number }>(`SELECT ci.content, ci.processing_status, (SELECT count(*)::int FROM chunks WHERE content_item_id = ci.id) AS count FROM content_items ci WHERE id = $1`, [note.id]);
    expect(rows.rows[0]).toMatchObject({ content: 'Preserve this searchable source during recovery.', processing_status: 'ready' });
    expect(rows.rows[0].count).toBeGreaterThan(0);
  });

  it('retains saved project state after closing and reopening the database', async () => {
    await Promise.all(jobs);
    const before = await pg.query<{ id: string }>("SELECT id FROM projects WHERE name = 'Durable project'");
    await pg.close();
    pg = new PGlite(join(directory, 'database'), { extensions: { vector, uuid_ossp } });
    const context = await getProjectContext(deps, before.rows[0].id);
    expect(context.sessions[0].summary).toBe('Selected local storage');
    expect(context.sessions[0].decisions).toEqual(['Keep documents on the machine']);
  });
});
