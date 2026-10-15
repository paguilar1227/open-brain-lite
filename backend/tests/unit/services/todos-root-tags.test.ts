// @vitest-environment node
// Root-only tags rule: tags live only on root todos. Subtasks (parent_id set)
// never carry tags — they're stripped on create, on re-parent, and on any tag
// edit that lands on a subtask. The UI hides the tag editor for subtasks; this
// is the server-side backstop.
import { describe, it, expect, vi } from 'vitest';
import { createTodo, updateTodo } from '../../../src/services/todos.js';
import { bulkAddTagsTodos } from '../../../src/db/todos.js';
import { mockDb, mockEmbeddingProvider } from '../../helpers/mocks.js';
import type { ServiceDeps } from '../../../src/services/index.js';

type Call = { sql: string; params: unknown[] };

function depsWith(impl: (sql: string, params: unknown[]) => unknown): { deps: ServiceDeps; calls: Call[] } {
  const calls: Call[] = [];
  const db = mockDb();
  (db.query as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return impl(sql, params);
  });
  const deps = { db, embeddingProvider: mockEmbeddingProvider() } as unknown as ServiceDeps;
  return { deps, calls };
}

// INSERT param order: content,$1 project_id,$2 section,$3 parent_id,$4
// priority,$5 due_date,$6 tags,$7 embedding,$8 → tags is index 6.
const TAGS_INSERT_IDX = 6;
const findInsert = (calls: Call[]) => calls.find((c) => /INSERT INTO todos/i.test(c.sql));
const findTagUpdate = (calls: Call[]) =>
  calls.find((c) => /UPDATE todos SET/i.test(c.sql) && /tags\s*=/.test(c.sql));

describe('root-only tags', () => {
  it('createTodo under a parent stores no tags, even if tags were passed', async () => {
    const { deps, calls } = depsWith((sql, params) => {
      if (/WITH RECURSIVE chain/i.test(sql)) return { rows: [{ depth: 0, exists: true }] };
      if (/INSERT INTO todos/i.test(sql)) return { rows: [{ id: 'new', parent_id: params[3] }] };
      return { rows: [] };
    });
    await createTodo(deps, { content: 'a subtask', parentId: 'p1', tags: ['work', 'urgent'] });
    expect(findInsert(calls)!.params[TAGS_INSERT_IDX]).toEqual([]);
  });

  it('createTodo at the root level keeps its tags', async () => {
    const { deps, calls } = depsWith((sql) => {
      if (/INSERT INTO todos/i.test(sql)) return { rows: [{ id: 'new' }] };
      return { rows: [] };
    });
    await createTodo(deps, { content: 'a root todo', tags: ['work'] });
    expect(findInsert(calls)!.params[TAGS_INSERT_IDX]).toEqual(['work']);
  });

  it('updateTodo that re-parents a todo into a subtask clears its tags', async () => {
    const { deps, calls } = depsWith((sql) => {
      if (/WITH RECURSIVE chain/i.test(sql)) return { rows: [{ depth: 0, exists: true }] };
      if (/UPDATE todos SET/i.test(sql)) return { rows: [{ id: 't1' }] };
      return { rows: [] };
    });
    await updateTodo(deps, 't1', { parentId: 'p1' });
    const upd = findTagUpdate(calls);
    expect(upd).toBeDefined();
    expect(upd!.params).toContainEqual([]); // tags coerced to []
  });

  it('updateTodo tag edit on an existing subtask is ignored (coerced to [])', async () => {
    const { deps, calls } = depsWith((sql) => {
      if (/SELECT \* FROM todos WHERE id/i.test(sql)) {
        return { rows: [{ id: 't1', parent_id: 'p1', status: 'not_started' }] };
      }
      if (/UPDATE todos SET/i.test(sql)) return { rows: [{ id: 't1' }] };
      return { rows: [] };
    });
    await updateTodo(deps, 't1', { tags: ['work'] });
    const upd = findTagUpdate(calls);
    expect(upd!.params).toContainEqual([]);
    expect(upd!.params).not.toContainEqual(['work']);
  });

  it('updateTodo tag edit on a root todo is preserved', async () => {
    const { deps, calls } = depsWith((sql) => {
      if (/SELECT \* FROM todos WHERE id/i.test(sql)) {
        return { rows: [{ id: 't1', parent_id: null, status: 'not_started' }] };
      }
      if (/UPDATE todos SET/i.test(sql)) return { rows: [{ id: 't1' }] };
      return { rows: [] };
    });
    await updateTodo(deps, 't1', { tags: ['work', 'reading'] });
    expect(findTagUpdate(calls)!.params).toContainEqual(['work', 'reading']);
  });

  it('bulkAddTagsTodos only tags root todos (parent_id IS NULL guard)', async () => {
    const db = mockDb();
    let captured = '';
    (db.query as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string) => {
      captured = sql;
      return { rows: [] };
    });
    await bulkAddTagsTodos(db, ['some-id'], ['work']);
    expect(captured).toMatch(/parent_id\s+IS\s+NULL/i);
  });
});
