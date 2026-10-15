import type { DbClient } from './client.js';

export type ChunkType = 'text' | 'image' | 'audio_segment' | 'video_keyframe';

export interface ChunkInsert {
  contentItemId: string;
  chunkIndex: number;
  chunkType: ChunkType;
  content: string | null;
  embedding: number[];
  metadata: Record<string, unknown>;
}

export interface ChunkRow {
  id: string;
  content_item_id: string;
  chunk_index: number;
  chunk_type: ChunkType;
  content: string | null;
  embedding: number[];
  metadata: Record<string, unknown>;
  created_at: Date;
}

export async function insertChunk(db: DbClient, chunk: ChunkInsert): Promise<{ id: string }> {
  const result = await db.query(
    `INSERT INTO chunks (content_item_id, chunk_index, chunk_type, content, embedding, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      chunk.contentItemId, chunk.chunkIndex, chunk.chunkType, chunk.content,
      JSON.stringify(chunk.embedding), JSON.stringify(chunk.metadata),
    ],
  );
  return result.rows[0];
}

export async function insertChunks(db: DbClient, chunks: ChunkInsert[]): Promise<void> {
  if (chunks.length === 0) return;
  // Insert in a transaction for atomicity
  await db.transaction(async (tx) => {
    for (const chunk of chunks) {
      await tx.query(
        `INSERT INTO chunks (content_item_id, chunk_index, chunk_type, content, embedding, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          chunk.contentItemId, chunk.chunkIndex, chunk.chunkType, chunk.content,
          JSON.stringify(chunk.embedding), JSON.stringify(chunk.metadata),
        ],
      );
    }
  });
}

export async function getChunksByContentItem(
  db: DbClient,
  contentItemId: string,
): Promise<ChunkRow[]> {
  const result = await db.query(
    `SELECT * FROM chunks WHERE content_item_id = $1 ORDER BY chunk_index ASC`,
    [contentItemId],
  );
  return result.rows;
}

export async function deleteChunksByContentItem(db: DbClient, contentItemId: string): Promise<void> {
  await db.query(`DELETE FROM chunks WHERE content_item_id = $1`, [contentItemId]);
}

/**
 * Semantic chunk search result. Deliberately omits the raw embedding vector —
 * consumers (MCP/REST) don't need it and including a 3072-dim float array per hit
 * bloats response payloads by ~40KB each. Use the dedicated chunk fetch if you
 * need the raw vector for something internal.
 */
export interface ChunkSearchResult {
  id: string;
  content_item_id: string;
  chunk_index: number;
  chunk_type: ChunkType;
  content: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  similarity: number;
  parent_type: string;
  parent_title: string;
  parent_project_ids: string[];
  parent_tags: string[];
  parent_source_url: string | null;
}

/**
 * Lexical (ILIKE substring) chunk search — the literal counterpart to
 * findSimilarChunks. Matches the query against the parent title OR the
 * chunk text. Title matches sort first (more relevant for "do" → "domain"
 * style searches), recency as tiebreaker.
 *
 * Filter parity with findSimilarChunks: same project/tags/parentType/
 * contentItemIds/exclusion predicates. Lexical results are fused with
 * vector results in services/search.ts via RRF — items caught by both
 * arms rise to the top.
 *
 * Escapes % and _ in the query so user input "100%" doesn't blow up
 * the pattern. Returns [] for queries <2 chars to avoid noise floods.
 */
export async function findChunksByLexical(
  db: DbClient,
  query: string,
  limit: number = 10,
  opts: {
    projectId?: string | null;
    parentType?: 'document' | 'note';
    tags?: string[];
    /** Combine multiple tags: 'all' = AND (@>, default), 'any' = OR (&&). */
    tagMatch?: 'all' | 'any';
    contentItemIds?: string[];
    excludedTags?: string[];
    excludedContentItemIds?: string[];
    excludedParentTypes?: Array<'document' | 'note'>;
  } = {},
): Promise<ChunkSearchResult[]> {
  const q = query.trim();
  const hasText = q.length >= 2;
  // Filter-only mode (no free text) needs at least one structural filter to
  // avoid returning the entire corpus.
  const hasAnyFilter =
    !!opts.tags?.length || !!opts.contentItemIds?.length ||
    !!opts.excludedTags?.length || !!opts.excludedContentItemIds?.length ||
    !!opts.excludedParentTypes?.length || !!opts.parentType ||
    opts.projectId !== undefined;
  if (!hasText && !hasAnyFilter) return [];
  // Escape ILIKE metachars in user input so '100%' searches literally for '100%'.
  // When hasText is false, the pattern is `%%` which trivially matches; the
  // WHERE clause below skips the ILIKE predicate so the matcher does nothing.
  const escaped = hasText
    ? q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
    : '';
  const pattern = `%${escaped}%`;

  const conditions = [
    'ci.archived = false',
    "ci.processing_status = 'ready'",
  ];
  if (hasText) {
    conditions.push('(ci.title ILIKE $1 OR c.content ILIKE $1)');
  }
  const params: unknown[] = [pattern, limit];
  let i = 3;
  if (opts.projectId === null) {
    conditions.push('cardinality(ci.project_ids) = 0');
  } else if (opts.projectId !== undefined) {
    conditions.push(`ci.project_ids @> ARRAY[$${i++}]::uuid[]`);
    params.push(opts.projectId);
  }
  if (opts.parentType) {
    conditions.push(`ci.type = $${i++}`);
    params.push(opts.parentType);
  }
  if (opts.tags && opts.tags.length > 0) {
    // @> = "contains all" (AND); && = "overlaps" (any tag → OR).
    conditions.push(
      opts.tagMatch === 'any' ? `ci.tags && $${i++}::text[]` : `ci.tags @> $${i++}`,
    );
    params.push(opts.tags);
  }
  if (opts.contentItemIds && opts.contentItemIds.length > 0) {
    conditions.push(`ci.id = ANY($${i++}::uuid[])`);
    params.push(opts.contentItemIds);
  }
  if (opts.excludedTags && opts.excludedTags.length > 0) {
    conditions.push(`NOT (ci.tags && $${i++}::text[])`);
    params.push(opts.excludedTags);
  }
  if (opts.excludedContentItemIds && opts.excludedContentItemIds.length > 0) {
    conditions.push(`NOT (ci.id = ANY($${i++}::uuid[]))`);
    params.push(opts.excludedContentItemIds);
  }
  if (opts.excludedParentTypes && opts.excludedParentTypes.length > 0) {
    conditions.push(`NOT (ci.type = ANY($${i++}::text[]))`);
    params.push(opts.excludedParentTypes);
  }

  const result = await db.query(
    `SELECT c.id, c.content_item_id, c.chunk_index, c.chunk_type,
            c.content, c.metadata, c.created_at,
            -- Synthetic similarity for downstream compat: title matches
            -- get 1.0, content-only matches get 0.5. Lexical doesn't have
            -- a real similarity; this is just a stable tiebreaker. Cast
            -- to ::float because Postgres returns NUMERIC as a JS string
            -- (precision-preservation default in node-postgres) and the
            -- downstream RetrievalStepSchema validates score as number.
            (CASE WHEN ci.title ILIKE $1 THEN 1.0 ELSE 0.5 END)::float AS similarity,
            ci.type AS parent_type,
            ci.title AS parent_title,
            ci.project_ids AS parent_project_ids,
            ci.tags AS parent_tags,
            ci.source_url AS parent_source_url
     FROM chunks c
     JOIN content_items ci ON ci.id = c.content_item_id
     WHERE ${conditions.join(' AND ')}
     -- Title matches first (most-relevant for short queries like "do"),
     -- then recency so fresh content surfaces over stale matches.
     ORDER BY (ci.title ILIKE $1) DESC, ci.updated_at DESC
     LIMIT $2`,
    params,
  );
  return result.rows;
}

export async function findSimilarChunks(
  db: DbClient,
  embedding: number[],
  threshold: number,
  limit: number = 10,
  // projectId modes mirror /content list:
  //   string  → chunks whose parent's project_ids contains this UUID
  //   null    → chunks whose parent has no project membership (personal)
  //   undef   → no filter (global)
  opts: {
    projectId?: string | null;
    parentType?: 'document' | 'note';
    tags?: string[];
    /** Combine multiple tags: 'all' = AND (@>, default), 'any' = OR (&&). */
    tagMatch?: 'all' | 'any';
    contentItemIds?: string[];
    excludedTags?: string[];
    excludedContentItemIds?: string[];
    excludedParentTypes?: Array<'document' | 'note'>;
  } = {},
): Promise<ChunkSearchResult[]> {
  const conditions = [
    'ci.archived = false',
    "ci.processing_status = 'ready'",
    '1 - (c.embedding <=> $1::vector) > $2',
  ];
  const params: unknown[] = [JSON.stringify(embedding), threshold, limit];
  let i = 4;

  if (opts.projectId === null) {
    conditions.push('cardinality(ci.project_ids) = 0');
  } else if (opts.projectId !== undefined) {
    conditions.push(`ci.project_ids @> ARRAY[$${i++}]::uuid[]`);
    params.push(opts.projectId);
  }
  if (opts.parentType) {
    conditions.push(`ci.type = $${i++}`);
    params.push(opts.parentType);
  }
  if (opts.tags && opts.tags.length > 0) {
    // @> = "contains all" (AND); && = "overlaps" (any tag → OR).
    conditions.push(
      opts.tagMatch === 'any' ? `ci.tags && $${i++}::text[]` : `ci.tags @> $${i++}`,
    );
    params.push(opts.tags);
  }
  if (opts.contentItemIds && opts.contentItemIds.length > 0) {
    conditions.push(`ci.id = ANY($${i++}::uuid[])`);
    params.push(opts.contentItemIds);
  }
  if (opts.excludedTags && opts.excludedTags.length > 0) {
    conditions.push(`NOT (ci.tags && $${i++}::text[])`);
    params.push(opts.excludedTags);
  }
  if (opts.excludedContentItemIds && opts.excludedContentItemIds.length > 0) {
    conditions.push(`NOT (ci.id = ANY($${i++}::uuid[]))`);
    params.push(opts.excludedContentItemIds);
  }
  if (opts.excludedParentTypes && opts.excludedParentTypes.length > 0) {
    conditions.push(`NOT (ci.type = ANY($${i++}::text[]))`);
    params.push(opts.excludedParentTypes);
  }

  // Explicit column list — must NOT include c.embedding (huge and not useful to consumers).
  const result = await db.query(
    `SELECT c.id, c.content_item_id, c.chunk_index, c.chunk_type,
            c.content, c.metadata, c.created_at,
            1 - (c.embedding <=> $1::vector) AS similarity,
            ci.type AS parent_type,
            ci.title AS parent_title,
            ci.project_ids AS parent_project_ids,
            ci.tags AS parent_tags,
            ci.source_url AS parent_source_url
     FROM chunks c
     JOIN content_items ci ON ci.id = c.content_item_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY similarity DESC
     LIMIT $3`,
    params,
  );
  return result.rows;
}
