// tests/unit/services/search.test.ts
//
// Regression coverage for F2 (graph expansion bypassing tag filter):
// the graph-expanded fetch SQL must apply the same project/tag/parent_type
// filters as the vector seed path. Otherwise tag-filtered queries leak in
// untagged content via entity edges, scoring it like a top hit because the
// expanded chunk's "similarity" is set to entity confidence (~0.99).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServiceDeps } from '../../../src/services/index.js';
import { mockDb, mockEmbeddingProvider, mockLLMProvider, mockBlobStorage } from '../../helpers/mocks.js';

// We mock the DB-layer chunk/todo helpers so we can drive the function
// through the graph-expansion branch deterministically.
const findSimilarChunksMock = vi.fn();
const findSimilarTodosMock = vi.fn();
const findChunksByLexicalMock = vi.fn();
const findTodosByLexicalMock = vi.fn();
const findChunksByEntitiesMock = vi.fn();
const findEntityByCanonicalMock = vi.fn();
const findEntityByAliasMock = vi.fn();

vi.mock('../../../src/db/chunks.js', () => ({
  findSimilarChunks: (...args: unknown[]) => findSimilarChunksMock(...args),
  findChunksByLexical: (...args: unknown[]) => findChunksByLexicalMock(...args),
}));
vi.mock('../../../src/db/todos.js', () => ({
  findSimilarTodos: (...args: unknown[]) => findSimilarTodosMock(...args),
  findTodosByLexical: (...args: unknown[]) => findTodosByLexicalMock(...args),
}));
vi.mock('../../../src/db/entities.js', () => ({
  findChunksByEntities: (...args: unknown[]) => findChunksByEntitiesMock(...args),
  findEntityByCanonical: (...args: unknown[]) => findEntityByCanonicalMock(...args),
  findEntityByAlias: (...args: unknown[]) => findEntityByAliasMock(...args),
}));

function makeDeps(): ServiceDeps {
  return {
    db: mockDb(),
    embeddingProvider: mockEmbeddingProvider(),
    metadataLLM: mockLLMProvider(),
    mediaMetadataLLM: mockLLMProvider(),
    queryDepthLLM: mockLLMProvider(),
    ragFastLLM: mockLLMProvider(),
    ragDeepLLM: mockLLMProvider(),
    blobStorage: mockBlobStorage(),
    config: { apiKey: 'test' } as any,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default the new lexical paths to empty arrays so existing tests that
  // only care about vector + graph fusion don't have to opt them in.
  findChunksByLexicalMock.mockResolvedValue([]);
  findTodosByLexicalMock.mockResolvedValue([]);
});

describe('search() graph-expansion filter parity', () => {
  it('applies the tag filter to graph-expanded chunks (F2 regression)', async () => {
    const deps = makeDeps();

    // Vector seed returns one tagged chunk that has an entity edge.
    findSimilarChunksMock.mockResolvedValue([
      {
        id: 'seed-chunk',
        content_item_id: 'tagged-doc',
        chunk_index: 0,
        chunk_type: 'text',
        content: 'tagged seed content',
        metadata: {},
        created_at: new Date(),
        parent_type: 'document',
        parent_title: 'Tagged doc',
        parent_project_ids: [],
        parent_tags: ['target-tag'],
        parent_source_url: null,
        similarity: 0.8,
      },
    ]);
    findSimilarTodosMock.mockResolvedValue([]);

    // Mock the chunk_entities lookup that seeds graph expansion from the
    // vector chunk's entities. One entity edge.
    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/SELECT DISTINCT entity_id FROM chunk_entities/.test(sql)) {
        return { rows: [{ entity_id: 'ent-1' }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] } as any;
      }
      // Capture the expansion SQL — return one expanded chunk
      if (/FROM chunks c[\s\S]*JOIN content_items ci/.test(sql)) {
        return {
          rows: [{
            id: 'expanded-chunk', content_item_id: 'expanded-doc', chunk_index: 0, chunk_type: 'text',
            content: 'expanded content', metadata: {}, created_at: new Date(),
            parent_type: 'document', parent_title: 'Expanded doc', parent_project_ids: [],
            parent_tags: ['target-tag'], parent_source_url: null,
          }],
          rowCount: 1, command: 'SELECT', oid: 0, fields: [],
        } as any;
      }
      // Entity name lookup
      if (/SELECT id, canonical_name, type FROM entities/.test(sql)) {
        return { rows: [{ id: 'ent-1', canonical_name: 'foo', type: 'tool' }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] } as any;
      }
      return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] } as any;
    });

    // findChunksByEntities returns the expanded edge.
    findChunksByEntitiesMock.mockResolvedValue([
      { chunk_id: 'expanded-chunk', entity_id: 'ent-1', confidence: 0.95 },
    ]);

    const { search } = await import('../../../src/services/search.js');
    await search(deps, 'q', { tags: ['target-tag'], graph: true });

    // The expansion SQL is the one that selects from chunks JOIN content_items.
    const expansionCall = vi.mocked(deps.db.query).mock.calls.find((c) =>
      typeof c[0] === 'string' && /FROM chunks c[\s\S]*JOIN content_items ci/.test(c[0]),
    );
    expect(expansionCall, 'expected the graph-expansion SQL to have been called').toBeDefined();

    const [sql, params] = expansionCall as [string, unknown[]];
    // Must include a tags-array filter on content_items.tags
    expect(sql).toMatch(/ci\.tags\s*@>\s*\$\d+::text\[\]/);
    // The tags array must be in the params
    expect(params).toContainEqual(['target-tag']);
  });

  it('applies the parent_type filter to graph-expanded chunks when entityTypes restricts to one chunk type', async () => {
    const deps = makeDeps();

    findSimilarChunksMock.mockResolvedValue([
      {
        id: 'seed', content_item_id: 'doc1', chunk_index: 0, chunk_type: 'text',
        content: 'x', metadata: {}, created_at: new Date(),
        parent_type: 'document', parent_title: 'd', parent_project_ids: [], parent_tags: [],
        parent_source_url: null, similarity: 0.8,
      },
    ]);
    findSimilarTodosMock.mockResolvedValue([]);

    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/SELECT DISTINCT entity_id FROM chunk_entities/.test(sql)) {
        return { rows: [{ entity_id: 'e1' }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] } as any;
      }
      if (/FROM chunks c[\s\S]*JOIN content_items ci/.test(sql)) {
        return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] } as any;
      }
      return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] } as any;
    });

    findChunksByEntitiesMock.mockResolvedValue([
      { chunk_id: 'expanded', entity_id: 'e1', confidence: 0.9 },
    ]);

    const { search } = await import('../../../src/services/search.js');
    await search(deps, 'q', { entityTypes: ['document'], graph: true });

    const expansionCall = vi.mocked(deps.db.query).mock.calls.find((c) =>
      typeof c[0] === 'string' && /FROM chunks c[\s\S]*JOIN content_items ci/.test(c[0]),
    );
    expect(expansionCall).toBeDefined();
    const [sql, params] = expansionCall as [string, unknown[]];
    // Must constrain ci.type to the single requested type
    expect(sql).toMatch(/ci\.type\s*=\s*\$\d+/);
    expect(params).toContain('document');
  });

  it('does NOT add a parent_type filter when entityTypes is broader than one chunk type', async () => {
    const deps = makeDeps();

    findSimilarChunksMock.mockResolvedValue([
      {
        id: 'seed', content_item_id: 'doc1', chunk_index: 0, chunk_type: 'text',
        content: 'x', metadata: {}, created_at: new Date(),
        parent_type: 'document', parent_title: 'd', parent_project_ids: [], parent_tags: [],
        parent_source_url: null, similarity: 0.8,
      },
    ]);
    findSimilarTodosMock.mockResolvedValue([]);

    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/SELECT DISTINCT entity_id FROM chunk_entities/.test(sql)) {
        return { rows: [{ entity_id: 'e1' }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] } as any;
      }
      if (/FROM chunks c[\s\S]*JOIN content_items ci/.test(sql)) {
        return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] } as any;
      }
      return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] } as any;
    });

    findChunksByEntitiesMock.mockResolvedValue([
      { chunk_id: 'expanded', entity_id: 'e1', confidence: 0.9 },
    ]);

    const { search } = await import('../../../src/services/search.js');
    await search(deps, 'q', { entityTypes: ['document', 'note'], graph: true });

    const expansionCall = vi.mocked(deps.db.query).mock.calls.find((c) =>
      typeof c[0] === 'string' && /FROM chunks c[\s\S]*JOIN content_items ci/.test(c[0]),
    );
    expect(expansionCall).toBeDefined();
    const [sql] = expansionCall as [string, unknown[]];
    // Should not include a single-type equality clause
    expect(sql).not.toMatch(/ci\.type\s*=\s*\$/);
  });

  it('keeps existing project filter on graph-expanded chunks', async () => {
    const deps = makeDeps();

    findSimilarChunksMock.mockResolvedValue([
      {
        id: 'seed', content_item_id: 'doc1', chunk_index: 0, chunk_type: 'text',
        content: 'x', metadata: {}, created_at: new Date(),
        parent_type: 'document', parent_title: 'd', parent_project_ids: ['proj-1'], parent_tags: [],
        parent_source_url: null, similarity: 0.8,
      },
    ]);
    findSimilarTodosMock.mockResolvedValue([]);

    vi.mocked(deps.db.query).mockImplementation(async (sql: string) => {
      if (/SELECT DISTINCT entity_id FROM chunk_entities/.test(sql)) {
        return { rows: [{ entity_id: 'e1' }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] } as any;
      }
      if (/FROM chunks c[\s\S]*JOIN content_items ci/.test(sql)) {
        return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] } as any;
      }
      return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] } as any;
    });

    findChunksByEntitiesMock.mockResolvedValue([
      { chunk_id: 'expanded', entity_id: 'e1', confidence: 0.9 },
    ]);

    const { search } = await import('../../../src/services/search.js');
    await search(deps, 'q', { projectId: 'proj-1', graph: true });

    const expansionCall = vi.mocked(deps.db.query).mock.calls.find((c) =>
      typeof c[0] === 'string' && /FROM chunks c[\s\S]*JOIN content_items ci/.test(c[0]),
    );
    expect(expansionCall).toBeDefined();
    const [sql, params] = expansionCall as [string, unknown[]];
    expect(sql).toMatch(/=\s*ANY\(ci\.project_ids\)/);
    expect(params).toContain('proj-1');
  });
});
