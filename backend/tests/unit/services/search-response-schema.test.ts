// tests/unit/services/search-response-schema.test.ts
//
// Regression: a lexical/graph-only search hit (no vector match) carries NO
// numeric vector signal — `similarity`, `vector_score`, AND the vector
// step's `retrieval_path[].score` all come back `null`. Several schema
// fields declared these as `z.number()` / `.optional()` (undefined) rather
// than `.nullable()`, so the frontend's SearchResponseSchema.parse() threw a
// ZodError and the whole search surface errored out. Surfaced when wiring the
// notes/docs drawers onto the real hybrid search (similarity first, then
// retrieval_path.score). This fixture pins the full lexical-only shape so the
// next sibling field can't regress silently.

import { describe, it, expect } from 'vitest';
import { ChunkHitSchema } from '@open-brain/shared';

// A lexical/graph-only chunk hit: every vector-derived numeric is null.
const lexicalOnlyHit = {
  type: 'chunk' as const,
  similarity: null,
  vector_score: null,
  final_score: 0.0317,
  retrieval_path: [
    { step: 'vector', score: null },       // no vector contribution → null
    { step: 'lexical', score: 1 },
    { step: 'entity', confidence: null },  // entity step, no confidence → null
  ],
  chunk: {
    id: '11111111-1111-1111-1111-111111111111',
    content_item_id: '22222222-2222-2222-2222-222222222222',
    chunk_index: 0,
    chunk_type: 'text',
    content: 'a matched chunk',
    created_at: '2026-05-01T00:00:00.000Z',
    similarity: null,
    parent_type: 'note' as const,
    parent_title: 'A note',
    parent_project_ids: [],
    parent_tags: [],
    parent_source_url: null,
  },
};

describe('search hit schema — nullable numeric signals on lexical/graph hits', () => {
  it('accepts a hit with null similarity and null vector_score', () => {
    expect(() => ChunkHitSchema.parse(lexicalOnlyHit)).not.toThrow();
  });

  it('accepts retrieval steps with null score and null confidence', () => {
    const parsed = ChunkHitSchema.parse(lexicalOnlyHit);
    expect(parsed.retrieval_path[0].score).toBeNull();
    expect(parsed.retrieval_path[2].confidence).toBeNull();
  });

  it('still accepts a fully vector-scored hit', () => {
    const vectorHit = {
      ...lexicalOnlyHit,
      similarity: 0.87,
      vector_score: 0.87,
      retrieval_path: [{ step: 'vector', score: 0.87 }],
    };
    expect(ChunkHitSchema.parse(vectorHit).similarity).toBe(0.87);
  });
});
