import { describe, it, expect, vi } from 'vitest';
import { findSimilarTodos, findTodosByLexical } from '../../../src/db/todos.js';
import type { DbClient } from '../../../src/db/client.js';
describe('project search filters before LIMIT', () => {
  for (const kind of ['lexical', 'vector'] as const) {
    it(`${kind} scopes the SQL query instead of dropping global top hits`, async () => {
      const query = vi.fn().mockResolvedValue({ rows: [] });
      const db = { query } as unknown as DbClient;
      const projectId = '44444444-4444-4444-8444-444444444444';
      if (kind === 'lexical') await findTodosByLexical(db, 'deployment', 1, { projectId });
      else await findSimilarTodos(db, [0.1], -1, 1, { projectId });
      const [sql, values] = query.mock.calls[0];
      expect(sql).toMatch(/WHERE[^]*project_id = \$\d+::uuid[^]*LIMIT/);
      expect(values).toContain(projectId);
    });
    it(`${kind} supports personal scope separately from global`, async () => {
      const query = vi.fn().mockResolvedValue({ rows: [] });
      const db = { query } as unknown as DbClient;
      if (kind === 'lexical') await findTodosByLexical(db, '', 1, { projectId: null });
      else await findSimilarTodos(db, [0.1], -1, 1, { projectId: null });
      expect(query.mock.calls[0][0]).toContain('project_id IS NULL');
    });
  }
});
