import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { createProject } from '../../src/services/projects.js';
import { getProjectContext, saveProjectSession } from '../../src/services/project-memory.js';
import * as content from '../../src/services/content-items.js';
import { createTodo } from '../../src/services/todos.js';
import { findSimilarTodos, findTodosByLexical } from '../../src/db/todos.js';
import { beginContentReindex } from '../../src/db/reindex.js';
import { StubEmbeddingProvider, StubLLMProvider } from '../../src/providers/stub.js';
import { mockBlobStorage } from '../helpers/mocks.js';
import type { DbClient } from '../../src/db/client.js';
import type { ServiceDeps } from '../../src/services/index.js';

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
