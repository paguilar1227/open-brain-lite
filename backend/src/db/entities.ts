// src/db/entities.ts
//
// Graph-layer DB access: entities registry and chunk→entity mention edges.

import type { DbClient } from './client.js';

export type EntityType = 'person' | 'org' | 'concept' | 'tool' | 'paper';

export interface EntityRow {
  id: string;
  canonical_name: string;
  type: EntityType;
  aliases: string[];
  embedding: number[];
  created_at: Date;
}

export interface ChunkEntityInsert {
  chunkId: string;
  entityId: string;
  confidence: number;
  mentionText: string | null;
}

/**
 * Look up an entity by exact (canonical_name, type). Case-sensitive match
 * against the stored canonical_name. Use before falling back to alias /
 * embedding similarity matching.
 */
export async function findEntityByCanonical(
  db: DbClient,
  canonicalName: string,
  type: EntityType,
): Promise<EntityRow | null> {
  const res = await db.query(
    `SELECT * FROM entities WHERE canonical_name = $1 AND type = $2 LIMIT 1`,
    [canonicalName, type],
  );
  return res.rows[0] ?? null;
}

/**
 * Find an entity that lists `surface` (case-insensitive) in its aliases.
 * Type-scoped so "Python" (concept) and "Python" (snake, if we ever had
 * it) don't collide.
 */
export async function findEntityByAlias(
  db: DbClient,
  surface: string,
  type: EntityType,
): Promise<EntityRow | null> {
  const res = await db.query(
    `SELECT * FROM entities
      WHERE type = $1
        AND EXISTS (
          SELECT 1 FROM unnest(aliases) a WHERE lower(a) = lower($2)
        )
      LIMIT 1`,
    [type, surface],
  );
  return res.rows[0] ?? null;
}

/**
 * Find the closest existing entity to a candidate embedding within the same
 * type. Returns the match + similarity if cosine ≥ threshold; null otherwise.
 */
export async function findEntityByEmbedding(
  db: DbClient,
  embedding: number[],
  type: EntityType,
  threshold = 0.92,
): Promise<{ entity: EntityRow; similarity: number } | null> {
  const res = await db.query(
    `SELECT *, 1 - (embedding <=> $1::vector) AS similarity
       FROM entities
      WHERE type = $2
      ORDER BY embedding <=> $1::vector
      LIMIT 1`,
    [JSON.stringify(embedding), type],
  );
  const row = res.rows[0];
  if (!row) return null;
  const similarity: number = Number(row.similarity);
  if (similarity < threshold) return null;
  const { similarity: _drop, ...entity } = row;
  return { entity: entity as EntityRow, similarity };
}

export async function insertEntity(
  db: DbClient,
  entity: {
    canonicalName: string;
    type: EntityType;
    aliases: string[];
    embedding: number[];
  },
): Promise<EntityRow> {
  const res = await db.query(
    `INSERT INTO entities (canonical_name, type, aliases, embedding)
     VALUES ($1, $2, $3, $4::vector)
     RETURNING *`,
    [entity.canonicalName, entity.type, entity.aliases, JSON.stringify(entity.embedding)],
  );
  return res.rows[0];
}

/**
 * Merge new aliases into an existing entity. Deduplicates case-insensitively.
 */
export async function mergeEntityAliases(
  db: DbClient,
  entityId: string,
  newAliases: string[],
): Promise<void> {
  if (newAliases.length === 0) return;
  await db.query(
    `UPDATE entities
        SET aliases = (
          SELECT ARRAY(
            SELECT DISTINCT unnest(aliases || $2::text[]) ORDER BY 1
          )
        )
      WHERE id = $1`,
    [entityId, newAliases],
  );
}

export async function insertChunkEntities(
  db: DbClient,
  rows: ChunkEntityInsert[],
): Promise<void> {
  if (rows.length === 0) return;
  await db.transaction(async (tx) => {
    for (const r of rows) {
      // ON CONFLICT ignores — duplicate (chunk, entity) pairs are fine, the
      // first insert wins. In practice we dedupe in the extractor, but this
      // is a belt-and-suspenders guard.
      await tx.query(
        `INSERT INTO chunk_entities (chunk_id, entity_id, confidence, mention_text)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (chunk_id, entity_id) DO NOTHING`,
        [r.chunkId, r.entityId, r.confidence, r.mentionText],
      );
    }
  });
}

/**
 * For a list of entity IDs, return all chunk IDs that mention any of them
 * (with the entity they matched). Used for graph expansion during retrieval.
 */
export interface ChunkEntityHit {
  chunk_id: string;
  entity_id: string;
  confidence: number;
  mention_text: string | null;
}

export async function findChunksByEntities(
  db: DbClient,
  entityIds: string[],
  excludeChunkIds: string[] = [],
): Promise<ChunkEntityHit[]> {
  if (entityIds.length === 0) return [];
  // Branch by whether we have an exclude list to avoid nullable-array
  // parameter quirks in pg's prepared-statement handling.
  if (excludeChunkIds.length === 0) {
    const res = await db.query(
      `SELECT chunk_id, entity_id, confidence, mention_text
         FROM chunk_entities
        WHERE entity_id = ANY($1::uuid[])`,
      [entityIds],
    );
    return res.rows;
  }
  const res = await db.query(
    `SELECT chunk_id, entity_id, confidence, mention_text
       FROM chunk_entities
      WHERE entity_id = ANY($1::uuid[])
        AND NOT (chunk_id = ANY($2::uuid[]))`,
    [entityIds, excludeChunkIds],
  );
  return res.rows;
}
