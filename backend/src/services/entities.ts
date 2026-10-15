// src/services/entities.ts
//
// Entity extraction and resolution. Runs once per document at ingest time.
// Feeds the chunk_entities graph that retrieval expands over.
//
// Why per-document, not per-chunk: per-chunk extraction would be N Haiku
// calls per document (241 for a big arXiv PDF). Per-document is one call
// over the whole text; chunk-level edges are built deterministically by
// substring-mapping mention spans to the chunk they live in.

import type { ServiceDeps } from './index.js';
import {
  findEntityByCanonical, findEntityByAlias, findEntityByEmbedding,
  insertEntity, mergeEntityAliases, insertChunkEntities,
  type EntityType, type EntityRow,
} from '../db/entities.js';
import type { ChunkRow } from '../db/chunks.js';
import { mapConcurrent } from '../util/concurrency.js';

const ENTITY_RESOLVE_CONCURRENCY = 6;

export interface RawEntity {
  canonical_name: string;
  type: EntityType;
  aliases: string[];
  confidence: number;
  mentions: string[];   // verbatim text spans from the source content
}

const ENTITIES_PROMPT = `Extract distinct entities from the provided text for a personal knowledge base.

Return a JSON array. Each entity has:
- canonical_name: the most formal / complete surface form (max 80 chars)
- type: one of "person" | "org" | "concept" | "tool" | "paper"
- aliases: other surface forms that appeared in the text (case variants, abbreviations, alternate names). Max 8. Empty array if none.
- confidence: 0-1, how sure you are this is a real, distinct entity explicitly in the text
- mentions: 1-5 verbatim text spans (10-200 chars each) that reference this entity, copied exactly from the input

Rules:
- Only extract entities EXPLICITLY present. Do NOT infer entities from context.
- Empty array is a valid response. Prefer returning empty over guessing.
- Prefer broad, durable entities over ephemera: "pgvector", "HNSW", "RAG" yes; "the first chunk", "Figure 2" no.
- Collapse obvious duplicates: if the same thing appears as "GPT-5.4" and "GPT 5.4" and "gpt-5-4", return one entity with all as aliases.
- Type taxonomy:
  - person: real named people
  - org: companies, universities, research labs
  - concept: abstract ideas, techniques, methods (RAG, DDD, multi-hop retrieval, MVCC)
  - tool: concrete products, libraries, databases, models (pgvector, Haiku 4.5, Neo4j, Firecrawl)
  - paper: named academic papers or reports ("Attention Is All You Need")

Return ONLY the JSON array. No preamble, no markdown fences.`;

/**
 * Extract entities from a document's text via Haiku. Returns raw entities;
 * resolution against the existing entities table happens in the resolve step.
 */
/**
 * Below this length we don't bother calling Haiku — the few cents per call
 * adds up across the corpus and content this short rarely names entities.
 * Lower than the previous 100-char threshold so OCR'd images and short
 * audio transcriptions still get processed (they were silently skipped).
 */
const MIN_CONTENT_FOR_EXTRACTION = 30;

export async function extractEntities(
  deps: ServiceDeps,
  content: string,
): Promise<RawEntity[]> {
  if (!content || content.trim().length < MIN_CONTENT_FOR_EXTRACTION) {
    return [];
  }

  // Cap input to avoid blowing through the Haiku context budget. 50K chars
  // covers most documents; arXiv papers routinely fit. For the tail case of
  // longer inputs we just lose entities from the tail — acceptable tradeoff
  // vs running two calls per doc.
  const capped = content.slice(0, 50_000);

  try {
    const res = await deps.metadataLLM.complete(
      [{ role: 'user', content: capped }],
      {
        systemPrompt: ENTITIES_PROMPT,
        responseFormat: 'json',
        maxTokens: 4096,
      },
    );

    const parsed = JSON.parse(res.content);
    // Tolerate either a bare array or { entities: [...] } wrapping.
    const arr: unknown[] = Array.isArray(parsed) ? parsed : (parsed.entities ?? []);

    const entities: RawEntity[] = [];
    for (const raw of arr) {
      if (!raw || typeof raw !== 'object') continue;
      const e = raw as Record<string, unknown>;
      if (typeof e.canonical_name !== 'string' || !e.canonical_name.trim()) continue;
      if (typeof e.type !== 'string') continue;
      const type = e.type.toLowerCase();
      if (!['person', 'org', 'concept', 'tool', 'paper'].includes(type)) continue;

      entities.push({
        canonical_name: e.canonical_name.trim().slice(0, 80),
        type: type as EntityType,
        aliases: Array.isArray(e.aliases)
          ? (e.aliases as unknown[]).filter((a) => typeof a === 'string' && (a as string).trim())
              .map((a) => (a as string).trim().slice(0, 80))
              .slice(0, 8)
          : [],
        confidence: typeof e.confidence === 'number'
          ? Math.max(0, Math.min(1, e.confidence))
          : 0.5,
        mentions: Array.isArray(e.mentions)
          ? (e.mentions as unknown[]).filter((m) => typeof m === 'string' && (m as string).trim())
              .map((m) => (m as string).trim().slice(0, 500))
              .slice(0, 5)
          : [],
      });
    }

    console.log(`[entities] extracted ${entities.length} entities from ${capped.length} chars`);
    return entities;
  } catch (err) {
    console.error(`[entities] extraction failed:`, err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Resolve a raw entity against the existing table. Insert if new, merge
 * aliases if matched. Returns the resolved entity row.
 *
 * Resolution order:
 *   1. exact (canonical_name, type) match
 *   2. any alias match (case-insensitive) within same type
 *   3. embedding cosine ≥ 0.92 within same type
 *   4. insert new
 */
export async function resolveEntity(
  deps: ServiceDeps,
  raw: RawEntity,
): Promise<EntityRow> {
  // Step 1: exact canonical match
  const exact = await findEntityByCanonical(deps.db, raw.canonical_name, raw.type);
  if (exact) {
    await mergeEntityAliases(deps.db, exact.id, raw.aliases);
    return exact;
  }

  // Step 2: alias match (include canonical_name as a surface form)
  for (const surface of [raw.canonical_name, ...raw.aliases]) {
    const aliased = await findEntityByAlias(deps.db, surface, raw.type);
    if (aliased) {
      await mergeEntityAliases(deps.db, aliased.id, [raw.canonical_name, ...raw.aliases]);
      return aliased;
    }
  }

  // Step 3: embedding similarity — embed a composite key that includes the
  // type so "Python" (concept) and "Python" (person) don't collide.
  const embedding = await deps.embeddingProvider.embed(`${raw.canonical_name} (${raw.type})`);
  const similar = await findEntityByEmbedding(deps.db, embedding, raw.type, 0.92);
  if (similar) {
    await mergeEntityAliases(deps.db, similar.entity.id, [raw.canonical_name, ...raw.aliases]);
    return similar.entity;
  }

  // Step 4: new entity. Catch the (canonical_name, type) unique-constraint
  // race — concurrent resolves of the same canonical can both pass steps 1-3,
  // but only one insert wins. The loser re-fetches via the now-existing row.
  try {
    return await insertEntity(deps.db, {
      canonicalName: raw.canonical_name,
      type: raw.type,
      aliases: Array.from(new Set([raw.canonical_name, ...raw.aliases])),
      embedding,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const existing = await findEntityByCanonical(deps.db, raw.canonical_name, raw.type);
      if (existing) {
        await mergeEntityAliases(deps.db, existing.id, raw.aliases);
        return existing;
      }
    }
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === '23505'
  );
}

/**
 * Map Haiku's verbatim mention spans to chunks via substring search.
 * For each entity, find which chunks contain which mentions; emit one
 * chunk_entities row per (chunk, entity), highest-confidence mention wins.
 */
export function mapMentionsToChunks(
  raws: RawEntity[],
  resolvedEntities: Array<EntityRow | null>,
  chunks: Array<{ id: string; content: string | null }>,
): Array<{ chunkId: string; entityId: string; confidence: number; mentionText: string | null }> {
  const edges = new Map<string, { chunkId: string; entityId: string; confidence: number; mentionText: string | null }>();

  for (let i = 0; i < raws.length; i++) {
    const raw = raws[i];
    const entity = resolvedEntities[i];
    if (!entity) continue;

    // For each mention span, find the first chunk it appears in.
    for (const mention of raw.mentions) {
      const needle = mention.length > 80 ? mention.slice(0, 80) : mention;
      for (const chunk of chunks) {
        if (!chunk.content) continue;
        if (chunk.content.includes(needle)) {
          const key = `${chunk.id}:${entity.id}`;
          const existing = edges.get(key);
          if (!existing || raw.confidence > existing.confidence) {
            edges.set(key, {
              chunkId: chunk.id,
              entityId: entity.id,
              confidence: raw.confidence,
              mentionText: mention,
            });
          }
        }
      }
    }

    // Always run the surface-name sweep AFTER the primary mention loop.
    // Haiku returns at most 5 mentions per entity (often just 1), but the
    // entity may appear in multiple chunks. Without this sweep, only the
    // chunk(s) containing Haiku's quoted mentions get linked — multi-chunk
    // documents end up with sparse coverage. The sweep adds edges to any
    // chunk that contains the canonical name or an alias, only if no edge
    // for (chunk, entity) was created by the primary mapping (so we don't
    // overwrite a high-confidence verbatim mention with a generic surface
    // hit).
    {
      const surfaces = [raw.canonical_name, ...raw.aliases];
      for (const chunk of chunks) {
        if (!chunk.content) continue;
        const matched = surfaces.find((s) => chunk.content!.toLowerCase().includes(s.toLowerCase()));
        if (matched) {
          const key = `${chunk.id}:${entity.id}`;
          if (!edges.has(key)) {
            edges.set(key, {
              chunkId: chunk.id,
              entityId: entity.id,
              confidence: raw.confidence,
              mentionText: matched,
            });
          }
        }
      }
    }
  }

  return Array.from(edges.values());
}

/**
 * Orchestrator: extract → resolve → map → persist. Called from
 * createContentItem after chunks have been inserted.
 */
export async function buildGraphEdges(
  deps: ServiceDeps,
  fullText: string,
  chunks: ChunkRow[],
): Promise<{ entityCount: number; edgeCount: number }> {
  const raw = await extractEntities(deps, fullText);
  if (raw.length === 0) return { entityCount: 0, edgeCount: 0 };

  // Resolve in parallel with bounded concurrency. Failures are swallowed
  // per-entity (matching prior behavior); resolved[i] is null on failure so
  // mapMentionsToChunks can keep array indices aligned with `raw`.
  const resolved: Array<EntityRow | null> = await mapConcurrent(
    raw,
    ENTITY_RESOLVE_CONCURRENCY,
    async (r) => {
      try {
        return await resolveEntity(deps, r);
      } catch (err) {
        console.warn(`[entities] resolve failed for "${r.canonical_name}":`, err instanceof Error ? err.message : err);
        return null;
      }
    },
  );
  const successCount = resolved.filter((e): e is EntityRow => e !== null).length;

  const edges = mapMentionsToChunks(raw, resolved, chunks);
  if (edges.length > 0) {
    await insertChunkEntities(deps.db, edges);
  }

  console.log(`[entities] resolved ${successCount}/${raw.length}, inserted ${edges.length} edges`);
  return { entityCount: successCount, edgeCount: edges.length };
}
