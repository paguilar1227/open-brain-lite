import type { DbClient } from './client.js';

export type ContentType = 'document' | 'note';
export type TitleSource = 'user' | 'ai_generated' | 'filename';
export type ProcessingStatus = 'pending' | 'ready' | 'failed';

export interface ContentItemInsert {
  type: ContentType;
  title: string;
  titleSource: TitleSource;
  content: string | null;
  blobUrl: string | null;
  mimeType: string | null;
  fileHash: string | null;
  projectIds: string[];
  tags: string[];
  folder?: string | null;             // single hierarchical folder path, or null when unfiled
  embedding: number[] | null;
  metadata: Record<string, unknown>;
  sourceUrl: string | null;
  publishedAt: string | null;         // ISO-8601 content publication date, or null
  processingStatus?: ProcessingStatus; // defaults to 'ready' for legacy callers
}

export interface ContentItemRow {
  id: string;
  type: ContentType;
  title: string;
  title_source: TitleSource;
  content: string | null;
  blob_url: string | null;
  mime_type: string | null;
  file_hash: string | null;
  project_ids: string[];
  tags: string[];
  folder: string | null;
  embedding: number[] | null;
  metadata: Record<string, unknown>;
  source_url: string | null;
  published_at: Date | null;
  archived: boolean;
  processing_status: ProcessingStatus;
  processing_error: string | null;
  ingest_completed_at: Date | null;
  pinned_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Slim shape returned by the polling endpoint. Avoids dragging the full
 * row (with content body and metadata) over the wire on every poll tick.
 */
export interface ContentItemStatus {
  id: string;
  type: ContentType;
  title: string;
  processing_status: ProcessingStatus;
  processing_error: string | null;
  ingest_started_at: Date;
  ingest_completed_at: Date | null;
  chunk_count: number;
}

export interface ListContentItemsFilters {
  type?: ContentType;
  // Three modes: a UUID matches rows whose project_ids array contains it;
  // `null` matches rows with no project membership at all (personal scope —
  // mirrors the equivalent on todos.project_id); `undefined` does no filter.
  project_id?: string | null;
  tags?: string[];                   // AND semantics: all tags must be present
  processing_status?: ProcessingStatus[]; // OR semantics: row must match any
  pinned?: boolean;                  // true = only pinned, false = only not pinned, undefined = no filter
  include_archived?: boolean;
  limit?: number;
  /** Cursor for keyset pagination. Returns rows strictly older than
   *  this `created_at`. The frontend reads it from the last row of the
   *  previous page; matches the default `ORDER BY created_at DESC`. */
  before?: Date;
  /** Substring filter — case-insensitive ILIKE against title OR content.
   *  Used by the drawer search boxes. Plain substring is intentional;
   *  semantic search lives on a separate endpoint. */
  q?: string;
}

export async function insertContentItem(
  db: DbClient,
  item: ContentItemInsert,
): Promise<{ id: string }> {
  const result = await db.query(
    `INSERT INTO content_items
       (type, title, title_source, content, blob_url, mime_type, file_hash,
        project_ids, tags, folder, embedding, metadata, source_url, published_at,
        processing_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING id`,
    [
      item.type, item.title, item.titleSource, item.content, item.blobUrl,
      item.mimeType, item.fileHash, item.projectIds, item.tags,
      item.folder ?? null,
      item.embedding ? JSON.stringify(item.embedding) : null,
      JSON.stringify(item.metadata),
      item.sourceUrl,
      item.publishedAt,
      item.processingStatus ?? 'ready',
    ],
  );
  return result.rows[0];
}

/**
 * Flip a row's processing_status (and optionally store an error string).
 * Called from the async tail of createContentItem when chunking/embedding/
 * graph work completes (or fails).
 *
 * Also stamps ingest_completed_at: now() on terminal states (ready/failed)
 * and back to NULL on 'pending' so retry paths reset the clock cleanly.
 */
export async function updateProcessingStatus(
  db: DbClient,
  id: string,
  status: ProcessingStatus,
  error: string | null = null,
): Promise<void> {
  await db.query(
    `UPDATE content_items
        SET processing_status   = $1,
            processing_error    = $2,
            ingest_completed_at = CASE WHEN $1 IN ('ready', 'failed') THEN now() ELSE NULL END,
            updated_at          = now()
      WHERE id = $3`,
    [status, error, id],
  );
}

/**
 * Slim status query for the polling endpoint. One row + a chunk count,
 * no content body / metadata / embeddings — keeps poll bandwidth low even
 * for multi-MB PDF rows.
 */
export async function getContentItemStatus(
  db: DbClient,
  id: string,
): Promise<ContentItemStatus | null> {
  const result = await db.query(
    `SELECT ci.id, ci.type, ci.title,
            ci.processing_status, ci.processing_error,
            ci.created_at AS ingest_started_at,
            ci.ingest_completed_at,
            (SELECT count(*)::int FROM chunks c WHERE c.content_item_id = ci.id) AS chunk_count
       FROM content_items ci
      WHERE ci.id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function listContentItems(
  db: DbClient,
  filters: ListContentItemsFilters = {},
): Promise<ContentItemRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (!filters.include_archived) conditions.push('archived = false');
  if (filters.type) { conditions.push(`type = $${i++}`); params.push(filters.type); }
  if (filters.project_id === null) {
    // Personal scope — rows with no project membership. project_ids is a
    // NOT NULL array column, so "no project" means an empty array. Index
    // hint: cardinality(project_ids) = 0 stays sargable on the array.
    conditions.push('cardinality(project_ids) = 0');
  } else if (filters.project_id !== undefined) {
    conditions.push(`project_ids @> ARRAY[$${i++}]::uuid[]`);
    params.push(filters.project_id);
  }
  if (filters.tags && filters.tags.length > 0) { conditions.push(`tags @> $${i++}`); params.push(filters.tags); }
  if (filters.processing_status && filters.processing_status.length > 0) {
    conditions.push(`processing_status = ANY($${i++}::text[])`);
    params.push(filters.processing_status);
  }
  if (filters.pinned === true) conditions.push('pinned_at IS NOT NULL');
  else if (filters.pinned === false) conditions.push('pinned_at IS NULL');
  if (filters.before) {
    conditions.push(`created_at < $${i++}`);
    params.push(filters.before);
  }
  if (filters.q && filters.q.trim()) {
    conditions.push(`(title ILIKE $${i} OR content ILIKE $${i})`);
    params.push(`%${filters.q.trim()}%`);
    i++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit ? `LIMIT ${filters.limit}` : '';

  // Pinned-first ordering when filtering pins (most-recently-pinned wins);
  // otherwise default chronological browse.
  const orderBy = filters.pinned === true
    ? 'ORDER BY pinned_at DESC'
    : 'ORDER BY created_at DESC';

  const result = await db.query(
    `SELECT * FROM content_items ${where} ${orderBy} ${limit}`,
    params,
  );
  return result.rows;
}

export async function pinContentItem(db: DbClient, id: string): Promise<{ found: boolean }> {
  const r = await db.query(
    `UPDATE content_items SET pinned_at = now(), updated_at = now() WHERE id = $1 RETURNING id`,
    [id],
  );
  return { found: r.rows.length > 0 };
}

export async function unpinContentItem(db: DbClient, id: string): Promise<{ found: boolean }> {
  const r = await db.query(
    `UPDATE content_items SET pinned_at = NULL, updated_at = now() WHERE id = $1 RETURNING id`,
    [id],
  );
  return { found: r.rows.length > 0 };
}

export async function getContentItemById(db: DbClient, id: string): Promise<ContentItemRow | null> {
  const result = await db.query(`SELECT * FROM content_items WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function findByFileHash(db: DbClient, hash: string): Promise<ContentItemRow | null> {
  // Note: dedup intentionally finds rows in any processing_status — a 'pending'
  // row from an in-flight ingest should still match so the second caller polls
  // the same id rather than starting a duplicate pipeline.
  const result = await db.query(
    `SELECT * FROM content_items WHERE file_hash = $1 AND archived = false LIMIT 1`,
    [hash],
  );
  return result.rows[0] ?? null;
}

/** Dedup lookup for URL-sourced content. Matches rows in any processing_status. */
export async function findByUrl(db: DbClient, url: string): Promise<ContentItemRow | null> {
  const result = await db.query(
    `SELECT * FROM content_items WHERE source_url = $1 AND archived = false LIMIT 1`,
    [url],
  );
  return result.rows[0] ?? null;
}

export async function updateContentItem(
  db: DbClient,
  id: string,
  patch: Partial<ContentItemInsert>,
): Promise<ContentItemRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  const map: Record<string, string> = {
    title: 'title', titleSource: 'title_source', content: 'content',
    blobUrl: 'blob_url', mimeType: 'mime_type', fileHash: 'file_hash',
    projectIds: 'project_ids', tags: 'tags', folder: 'folder', sourceUrl: 'source_url',
    publishedAt: 'published_at',
  };

  for (const [key, col] of Object.entries(map)) {
    if ((patch as any)[key] !== undefined) {
      sets.push(`${col} = $${i++}`);
      params.push((patch as any)[key]);
    }
  }

  if (patch.embedding !== undefined) {
    sets.push(`embedding = $${i++}`);
    params.push(patch.embedding ? JSON.stringify(patch.embedding) : null);
  }
  if (patch.metadata !== undefined) {
    sets.push(`metadata = $${i++}`);
    params.push(JSON.stringify(patch.metadata));
  }

  if (sets.length === 0) return getContentItemById(db, id);
  sets.push('updated_at = now()');
  params.push(id);

  const result = await db.query(
    `UPDATE content_items SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    params,
  );
  return result.rows[0] ?? null;
}

export async function archiveContentItem(db: DbClient, id: string): Promise<void> {
  await db.query(
    `UPDATE content_items SET archived = true, updated_at = now() WHERE id = $1`,
    [id],
  );
}

export async function unarchiveContentItem(db: DbClient, id: string): Promise<void> {
  await db.query(
    `UPDATE content_items SET archived = false, updated_at = now() WHERE id = $1`,
    [id],
  );
}

export async function deleteContentItemHard(db: DbClient, id: string): Promise<void> {
  await db.query(`DELETE FROM content_items WHERE id = $1`, [id]);
}

export interface BulkContentResult {
  requested: number;
  affected: number;
  missing_ids: string[];
}

/**
 * Bulk operations on content_items. Each variant is a single SQL UPDATE
 * (or DELETE) keyed by `id = ANY($ids)` so the whole batch is one round-trip.
 *
 * `missing_ids` is computed from the difference between requested ids and
 * the ids actually returned by RETURNING — this catches both genuinely
 * non-existent rows and (for archive/restore) rows already in the target
 * state are still considered "affected" because RETURNING fires on every
 * matched row regardless of whether the column actually changed.
 *
 * Tag add/remove use set semantics (DISTINCT, EXCEPT) so the column never
 * accumulates duplicates. set_project_ids replaces wholesale — partial
 * project-membership edits should be done one row at a time via the
 * single-item update path.
 */
export async function bulkArchiveContentItems(
  db: DbClient,
  ids: string[],
): Promise<BulkContentResult> {
  return runBulk(db, ids,
    `UPDATE content_items SET archived = true,  updated_at = now() WHERE id = ANY($1::uuid[]) RETURNING id`);
}

export async function bulkRestoreContentItems(
  db: DbClient,
  ids: string[],
): Promise<BulkContentResult> {
  return runBulk(db, ids,
    `UPDATE content_items SET archived = false, updated_at = now() WHERE id = ANY($1::uuid[]) RETURNING id`);
}

export async function bulkDeleteContentItemsHard(
  db: DbClient,
  ids: string[],
): Promise<BulkContentResult> {
  return runBulk(db, ids,
    `DELETE FROM content_items WHERE id = ANY($1::uuid[]) RETURNING id`);
}

export async function bulkAddTagsContentItems(
  db: DbClient,
  ids: string[],
  tags: string[],
): Promise<BulkContentResult> {
  // ARRAY(SELECT DISTINCT ... ORDER BY) keeps tags as a stable set; no dupes.
  const sql = `
    UPDATE content_items
       SET tags = ARRAY(SELECT DISTINCT t FROM UNNEST(tags || $2::text[]) AS t ORDER BY t),
           updated_at = now()
     WHERE id = ANY($1::uuid[])
     RETURNING id`;
  return runBulk(db, ids, sql, [tags]);
}

export async function bulkRemoveTagsContentItems(
  db: DbClient,
  ids: string[],
  tags: string[],
): Promise<BulkContentResult> {
  const sql = `
    UPDATE content_items
       SET tags = ARRAY(
             SELECT t FROM UNNEST(tags) AS t
             WHERE t <> ALL($2::text[])
             ORDER BY t),
           updated_at = now()
     WHERE id = ANY($1::uuid[])
     RETURNING id`;
  return runBulk(db, ids, sql, [tags]);
}

export async function bulkSetProjectIdsContentItems(
  db: DbClient,
  ids: string[],
  projectIds: string[],
): Promise<BulkContentResult> {
  const sql = `
    UPDATE content_items
       SET project_ids = $2::uuid[],
           updated_at = now()
     WHERE id = ANY($1::uuid[])
     RETURNING id`;
  return runBulk(db, ids, sql, [projectIds]);
}

async function runBulk(
  db: DbClient,
  ids: string[],
  sql: string,
  extraParams: unknown[] = [],
): Promise<BulkContentResult> {
  if (ids.length === 0) return { requested: 0, affected: 0, missing_ids: [] };
  const result = await db.query(sql, [ids, ...extraParams]);
  const affectedIds = new Set(result.rows.map((r: { id: string }) => r.id));
  const missing = ids.filter((id) => !affectedIds.has(id));
  return { requested: ids.length, affected: affectedIds.size, missing_ids: missing };
}

/**
 * Semantic search against content_items.embedding (whole-item level).
 * For chunk-level search, use chunks module.
 *
 * Omits the raw embedding vector from results to keep payloads small.
 */
export type ContentItemSearchResult = Omit<ContentItemRow, 'embedding'> & { similarity: number };

export async function findSimilarContentItems(
  db: DbClient,
  embedding: number[],
  threshold: number,
  limit: number = 10,
  projectId?: string,
): Promise<ContentItemSearchResult[]> {
  const conditions = [
    'archived = false',
    "processing_status = 'ready'",   // hide pending/failed from search results
    'embedding IS NOT NULL',
  ];
  const params: unknown[] = [JSON.stringify(embedding), threshold, limit];
  if (projectId) {
    conditions.push(`project_ids @> ARRAY[$4]::uuid[]`);
    params.push(projectId);
  }
  // Explicit column list — must NOT include the embedding vector.
  const result = await db.query(
    `SELECT id, type, title, title_source, content, blob_url, mime_type,
            file_hash, project_ids, tags, folder, metadata, source_url, archived,
            processing_status, processing_error, ingest_completed_at,
            created_at, updated_at,
            1 - (embedding <=> $1::vector) AS similarity
     FROM content_items
     WHERE ${conditions.join(' AND ')}
       AND 1 - (embedding <=> $1::vector) > $2
     ORDER BY similarity DESC
     LIMIT $3`,
    params,
  );
  return result.rows;
}
