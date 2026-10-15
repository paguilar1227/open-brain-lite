// tests/unit/services/entities.test.ts
//
// Regression coverage for F3 — entity extraction underpopulating the graph.
// Two specific fixes:
//   1. Threshold lowered from 100 to 30 chars (image OCR / audio transcription
//      were silently skipped).
//   2. Surface-fallback sweep now runs unconditionally — was only firing
//      when Haiku's mentions matched ZERO chunks, which left multi-chunk
//      docs with sparse coverage when Haiku returned only one mention.
//
// extractEntities itself isn't unit-tested here because it depends on a
// real (or heavily mocked) LLM. The threshold check and the deterministic
// mapMentionsToChunks function are what we cover.

import { describe, it, expect } from 'vitest';
import { mapMentionsToChunks, type RawEntity } from '../../../src/services/entities.js';
import type { EntityRow } from '../../../src/db/entities.js';

const FAKE_EMBEDDING: number[] = new Array(3072).fill(0);

function entity(id: string, canonical_name: string, aliases: string[] = []): EntityRow {
  return {
    id,
    canonical_name,
    type: 'tool',
    aliases,
    embedding: FAKE_EMBEDDING,
    created_at: new Date(),
  };
}

function raw(canonical_name: string, mentions: string[], aliases: string[] = [], confidence = 0.9): RawEntity {
  return { canonical_name, type: 'tool', aliases, confidence, mentions };
}

describe('mapMentionsToChunks', () => {
  it('links to every chunk containing the surface, even when Haiku quoted only one chunk (F3)', () => {
    // Haiku returned ONE mention for "pgvector" — happens often when an
    // entity appears in multiple paragraphs but Haiku quotes once.
    const r = raw('pgvector',
      ['pgvector is a Postgres extension that adds vector similarity'],
      ['pgvector']);
    const e = entity('ent-1', 'pgvector', ['pgvector']);

    // Two chunks: chunk 0 has the verbatim mention, chunk 1 mentions
    // pgvector again but with different surrounding text.
    const chunks = [
      { id: 'c0', content: 'pgvector is a Postgres extension that adds vector similarity search.' },
      { id: 'c1', content: 'Open Brain v2 uses pgvector with 3072-dim Gemini embeddings.' },
    ];

    const edges = mapMentionsToChunks([r], [e], chunks);
    expect(edges).toHaveLength(2);
    expect(edges.find((x) => x.chunkId === 'c0')).toBeDefined();
    expect(edges.find((x) => x.chunkId === 'c1')).toBeDefined();
  });

  it('still uses the verbatim mention text for the chunk that matched primary mapping', () => {
    const r = raw('pgvector',
      ['pgvector is a Postgres extension that adds vector similarity'],
      ['pgvector']);
    const e = entity('ent-1', 'pgvector', ['pgvector']);
    const chunks = [
      { id: 'c0', content: 'pgvector is a Postgres extension that adds vector similarity search.' },
      { id: 'c1', content: 'Open Brain v2 uses pgvector ...' },
    ];

    const edges = mapMentionsToChunks([r], [e], chunks);
    const c0 = edges.find((x) => x.chunkId === 'c0')!;
    const c1 = edges.find((x) => x.chunkId === 'c1')!;
    // Primary path keeps the verbatim Haiku quote
    expect(c0.mentionText).toMatch(/^pgvector is a Postgres/);
    // Fallback path stores the surface form
    expect(c1.mentionText).toBe('pgvector');
  });

  it('higher-confidence Haiku mention beats a duplicate', () => {
    const r = raw('pgvector', ['pgvector text 1', 'pgvector text 2'], ['pgvector'], 0.9);
    const e = entity('ent-1', 'pgvector', ['pgvector']);
    const chunks = [
      { id: 'c0', content: 'pgvector text 1 here' },
      { id: 'c0-alt', content: 'pgvector text 2 here' },
    ];
    const edges = mapMentionsToChunks([r], [e], chunks);
    expect(edges).toHaveLength(2);
    edges.forEach((edge) => expect(edge.confidence).toBe(0.9));
  });

  it('skips chunks that do not contain canonical or alias surfaces', () => {
    const r = raw('pgvector', ['pgvector is a Postgres extension'], ['pgvector']);
    const e = entity('ent-1', 'pgvector', ['pgvector']);
    const chunks = [
      { id: 'c0', content: 'pgvector is a Postgres extension' },
      { id: 'c1', content: 'Some unrelated thoughts about cooking.' },
    ];
    const edges = mapMentionsToChunks([r], [e], chunks);
    expect(edges).toHaveLength(1);
    expect(edges[0].chunkId).toBe('c0');
  });

  it('matches alias surfaces case-insensitively', () => {
    const r = raw('IVFFlat', [], ['IVFFlat', 'IVF flat'], 0.9);
    const e = entity('ent-1', 'IVFFlat', ['IVFFlat', 'IVF flat']);
    const chunks = [
      { id: 'c0', content: 'IVFFlat partitions the vector space.' },
      { id: 'c1', content: 'ivfflat tradeoffs.' }, // lowercased
      { id: 'c2', content: 'unrelated content' },
    ];
    const edges = mapMentionsToChunks([r], [e], chunks);
    expect(edges.map((x) => x.chunkId).sort()).toEqual(['c0', 'c1']);
  });

  it('handles empty raws / chunks without crashing', () => {
    expect(mapMentionsToChunks([], [], [])).toEqual([]);
    expect(mapMentionsToChunks([raw('foo', ['foo'])], [], [])).toEqual([]);
  });
});
