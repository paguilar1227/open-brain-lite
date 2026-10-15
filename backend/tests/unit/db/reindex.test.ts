import { describe, expect, it } from 'vitest';
import { beginContentReindex } from '../../../src/db/reindex.js';
import type { DbClient } from '../../../src/db/client.js';
function store(failAfterDelete: boolean) {
  const state = { status: 'ready', content: 'old source', chunks: ['old index'] };
  const db = { transaction: async (action: (tx: unknown) => Promise<void>) => {
    const before = structuredClone(state);
    try {
      await action({ query: async (sql: string, params: unknown[]) => {
        if (sql.startsWith('UPDATE')) { state.status = 'pending'; if (params.length > 1) state.content = String(params[1]); }
        if (sql.startsWith('DELETE')) { state.chunks = []; if (failAfterDelete) throw new Error('injected database failure'); }
        return { rowCount: 1, rows: [{ id: params[0] }] };
      } });
    } catch (error) { Object.assign(state, before); throw error; }
  } } as unknown as DbClient;
  return { state, db };
}
describe('atomic reindex transition', () => {
  for (const newContent of [undefined, 'edited source']) {
    it(`rolls back pending state and index retirement on failure (${newContent ? 'body edit' : 'reprocess'})`, async () => {
      const { state, db } = store(true);
      await expect(beginContentReindex(db, 'id', newContent)).rejects.toThrow('injected database failure');
      expect(state).toEqual({ status: 'ready', content: 'old source', chunks: ['old index'] });
    });
    it(`commits a recoverable pending state (${newContent ? 'body edit' : 'reprocess'})`, async () => {
      const { state, db } = store(false);
      await beginContentReindex(db, 'id', newContent);
      expect(state).toEqual({ status: 'pending', content: newContent ?? 'old source', chunks: [] });
    });
  }
});
