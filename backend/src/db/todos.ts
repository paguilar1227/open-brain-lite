import type { DbClient } from './client.js';

export interface TodoInsert {
  content: string;
  projectId: string | null;
  sessionId?: string | null;
  section: string | null;
  parentId: string | null;
  priority: 'P1' | 'P2' | 'P3' | null;
  dueDate: Date | null;
  tags: string[];
  embedding: number[] | null;
}

export interface TodoRow {
  id: string;
  content: string;
  project_id: string | null;
  session_id?: string | null;
  section: string | null;
  parent_id: string | null;
  status: 'not_started' | 'in_progress' | 'paused' | 'done';
  priority: 'P1' | 'P2' | 'P3' | null;
  due_date: Date | null;
  tags: string[];
  embedding: number[] | null;
  archived: boolean;
  pinned_at: Date | null;
  manual_order: number | null;
  created_at: Date;
  updated_at: Date;
  comment_count?: number;
  subtask_count?: number;
}

export interface ListTodosFilters {
  session_id?: string;
  project_id?: string | null;       // null explicitly = personal (Inbox); undefined = no filter
  status?: string;
  priority?: string;
  parent_id?: string | null;         // null = top-level; undefined = any
  tags?: string[];
  due_before?: Date;
  due_after?: Date;
  pinned?: boolean;                  // true = only pinned, false = only not pinned, undefined = no filter
  include_archived?: boolean;
  limit?: number;
  /** Cursor for keyset pagination. Returns rows strictly older than
   *  this `created_at`. Used by the Inbox / project todos infinite
   *  scroll. Matches `ORDER BY created_at DESC`. */
  before?: Date;
  /** Substring filter — case-insensitive ILIKE against `content`. */
  q?: string;
}

export async function insertTodo(db: DbClient, todo: TodoInsert): Promise<TodoRow> {
  const result = await db.query(
    `INSERT INTO todos (content, project_id, section, parent_id, priority, due_date, tags, embedding, session_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      todo.content, todo.projectId, todo.section, todo.parentId,
      todo.priority, todo.dueDate, todo.tags,
      todo.embedding ? JSON.stringify(todo.embedding) : null, todo.sessionId ?? null,
    ],
  );
  return result.rows[0];
}

export async function listTodos(
  db: DbClient,
  filters: ListTodosFilters = {},
): Promise<TodoRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (!filters.include_archived) conditions.push('archived = false');

  if (filters.session_id) { conditions.push(`session_id = $${i++}`); params.push(filters.session_id); }
  if (filters.project_id === null) {
    conditions.push('project_id IS NULL');
  } else if (filters.project_id !== undefined) {
    conditions.push(`project_id = $${i++}`);
    params.push(filters.project_id);
  }

  if (filters.status) {
    conditions.push(`status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.priority) {
    conditions.push(`priority = $${i++}`);
    params.push(filters.priority);
  }
  if (filters.parent_id === null) {
    conditions.push('parent_id IS NULL');
  } else if (filters.parent_id !== undefined) {
    conditions.push(`parent_id = $${i++}`);
    params.push(filters.parent_id);
  }
  if (filters.tags && filters.tags.length > 0) {
    conditions.push(`tags @> $${i++}`);
    params.push(filters.tags);
  }
  if (filters.due_before) {
    conditions.push(`due_date <= $${i++}`);
    params.push(filters.due_before);
  }
  if (filters.due_after) {
    conditions.push(`due_date >= $${i++}`);
    params.push(filters.due_after);
  }
  if (filters.pinned === true) conditions.push('pinned_at IS NOT NULL');
  else if (filters.pinned === false) conditions.push('pinned_at IS NULL');
  if (filters.before) {
    conditions.push(`created_at < $${i++}`);
    params.push(filters.before);
  }
  if (filters.q && filters.q.trim()) {
    conditions.push(`content ILIKE $${i++}`);
    params.push(`%${filters.q.trim()}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit ? `LIMIT ${filters.limit}` : '';

  // When filtering for pinned items, sort pinned-first by recency.
  const orderBy = filters.pinned === true
    ? 'ORDER BY pinned_at DESC'
    : 'ORDER BY created_at DESC';

  const result = await db.query(
    `SELECT * FROM todos ${where} ${orderBy} ${limit}`,
    params,
  );
  return result.rows;
}

export async function pinTodo(db: DbClient, id: string): Promise<{ found: boolean }> {
  const r = await db.query(
    `UPDATE todos SET pinned_at = now(), updated_at = now() WHERE id = $1 RETURNING id`,
    [id],
  );
  return { found: r.rows.length > 0 };
}

export async function unpinTodo(db: DbClient, id: string): Promise<{ found: boolean }> {
  const r = await db.query(
    `UPDATE todos SET pinned_at = NULL, updated_at = now() WHERE id = $1 RETURNING id`,
    [id],
  );
  return { found: r.rows.length > 0 };
}

export async function getTodoById(db: DbClient, id: string): Promise<TodoRow | null> {
  const result = await db.query(`SELECT * FROM todos WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function updateTodo(
  db: DbClient,
  id: string,
  patch: Partial<Omit<TodoInsert, 'embedding'>> & { status?: string; embedding?: number[] | null },
): Promise<TodoRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (patch.content !== undefined) { sets.push(`content = $${i++}`); params.push(patch.content); }
  if (patch.sessionId !== undefined) { sets.push(`session_id = $${i++}`); params.push(patch.sessionId); }
  if (patch.projectId !== undefined) { sets.push(`project_id = $${i++}`); params.push(patch.projectId); }
  if (patch.section !== undefined) { sets.push(`section = $${i++}`); params.push(patch.section); }
  if (patch.parentId !== undefined) { sets.push(`parent_id = $${i++}`); params.push(patch.parentId); }
  if (patch.priority !== undefined) { sets.push(`priority = $${i++}`); params.push(patch.priority); }
  if (patch.dueDate !== undefined) { sets.push(`due_date = $${i++}`); params.push(patch.dueDate); }
  if (patch.tags !== undefined) { sets.push(`tags = $${i++}`); params.push(patch.tags); }
  if (patch.status !== undefined) { sets.push(`status = $${i++}`); params.push(patch.status); }
  if (patch.embedding !== undefined) {
    sets.push(`embedding = $${i++}`);
    params.push(patch.embedding ? JSON.stringify(patch.embedding) : null);
  }

  if (sets.length === 0) return getTodoById(db, id);

  sets.push(`updated_at = now()`);
  params.push(id);

  const result = await db.query(
    `UPDATE todos SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    params,
  );
  return result.rows[0] ?? null;
}

export async function archiveTodo(db: DbClient, id: string): Promise<void> {
  await db.query(`UPDATE todos SET archived = true, updated_at = now() WHERE id = $1`, [id]);
}

export async function unarchiveTodo(db: DbClient, id: string): Promise<void> {
  await db.query(`UPDATE todos SET archived = false, updated_at = now() WHERE id = $1`, [id]);
}

export async function deleteTodoHard(db: DbClient, id: string): Promise<void> {
  await db.query(`DELETE FROM todos WHERE id = $1`, [id]);
}

export type BulkTodoStatus = 'not_started' | 'in_progress' | 'paused' | 'done';
export type BulkTodoPriority = 'P1' | 'P2' | 'P3' | null;

export interface BulkTodoResult {
  requested: number;
  affected: number;
  missing_ids: string[];
}

/**
 * Bulk operations on todos. Same single-SQL pattern as bulk content ops.
 * Distinct from content-bulk in three ways:
 *   - Todos use single project_id (nullable), not project_ids[]
 *   - Status / priority / due_date are first-class set-by-bulk operations
 *     (UI workflows: "mark all done", "snooze to next week", etc.)
 *   - Sub-task hierarchy is NOT touched in bulk; archiving a parent does
 *     not cascade to children. Caller must include children explicitly if
 *     they want them archived.
 */
export async function bulkArchiveTodos(db: DbClient, ids: string[]): Promise<BulkTodoResult> {
  return runTodoBulk(db, ids,
    `UPDATE todos SET archived = true,  updated_at = now() WHERE id = ANY($1::uuid[]) RETURNING id`);
}

export async function bulkRestoreTodos(db: DbClient, ids: string[]): Promise<BulkTodoResult> {
  return runTodoBulk(db, ids,
    `UPDATE todos SET archived = false, updated_at = now() WHERE id = ANY($1::uuid[]) RETURNING id`);
}

export async function bulkDeleteTodosHard(db: DbClient, ids: string[]): Promise<BulkTodoResult> {
  return runTodoBulk(db, ids,
    `DELETE FROM todos WHERE id = ANY($1::uuid[]) RETURNING id`);
}

export async function bulkAddTagsTodos(
  db: DbClient,
  ids: string[],
  tags: string[],
): Promise<BulkTodoResult> {
  // Root-only tags: bulk add never tags subtasks (parent_id IS NULL guard), so
  // a subtask id in the batch is simply left untouched.
  const sql = `
    UPDATE todos
       SET tags = ARRAY(SELECT DISTINCT t FROM UNNEST(tags || $2::text[]) AS t ORDER BY t),
           updated_at = now()
     WHERE id = ANY($1::uuid[]) AND parent_id IS NULL
     RETURNING id`;
  return runTodoBulk(db, ids, sql, [tags]);
}

export async function bulkRemoveTagsTodos(
  db: DbClient,
  ids: string[],
  tags: string[],
): Promise<BulkTodoResult> {
  const sql = `
    UPDATE todos
       SET tags = ARRAY(
             SELECT t FROM UNNEST(tags) AS t
             WHERE t <> ALL($2::text[])
             ORDER BY t),
           updated_at = now()
     WHERE id = ANY($1::uuid[])
     RETURNING id`;
  return runTodoBulk(db, ids, sql, [tags]);
}

export async function bulkSetStatusTodos(
  db: DbClient,
  ids: string[],
  status: BulkTodoStatus,
): Promise<BulkTodoResult> {
  const sql = `
    UPDATE todos
       SET status = $2,
           updated_at = now()
     WHERE id = ANY($1::uuid[])
     RETURNING id`;
  return runTodoBulk(db, ids, sql, [status]);
}

export async function bulkSetPriorityTodos(
  db: DbClient,
  ids: string[],
  priority: BulkTodoPriority,
): Promise<BulkTodoResult> {
  const sql = `
    UPDATE todos
       SET priority = $2,
           updated_at = now()
     WHERE id = ANY($1::uuid[])
     RETURNING id`;
  return runTodoBulk(db, ids, sql, [priority]);
}

export async function bulkSetProjectIdTodos(
  db: DbClient,
  ids: string[],
  projectId: string | null,
): Promise<BulkTodoResult> {
  const sql = `
    UPDATE todos
       SET project_id = $2,
           updated_at = now()
     WHERE id = ANY($1::uuid[])
     RETURNING id`;
  return runTodoBulk(db, ids, sql, [projectId]);
}

export async function bulkSetDueDateTodos(
  db: DbClient,
  ids: string[],
  dueDate: Date | null,
): Promise<BulkTodoResult> {
  const sql = `
    UPDATE todos
       SET due_date = $2,
           updated_at = now()
     WHERE id = ANY($1::uuid[])
     RETURNING id`;
  return runTodoBulk(db, ids, sql, [dueDate]);
}

async function runTodoBulk(
  db: DbClient,
  ids: string[],
  sql: string,
  extraParams: unknown[] = [],
): Promise<BulkTodoResult> {
  if (ids.length === 0) return { requested: 0, affected: 0, missing_ids: [] };
  const result = await db.query(sql, [ids, ...extraParams]);
  const affectedIds = new Set(result.rows.map((r: { id: string }) => r.id));
  const missing = ids.filter((id) => !affectedIds.has(id));
  return { requested: ids.length, affected: affectedIds.size, missing_ids: missing };
}

export async function findChildTodos(db: DbClient, parentId: string): Promise<TodoRow[]> {
  const result = await db.query(
    `SELECT * FROM todos WHERE parent_id = $1 AND archived = false ORDER BY created_at ASC`,
    [parentId],
  );
  return result.rows;
}

/**
 * Count direct (non-archived) children for each todo id, returned as a
 * map. Symmetric with countCommentsByTodoIds — the service layer uses
 * this to decorate list responses with `subtask_count` so the UI can
 * show "this row has its own subtasks" indicators without N extra
 * round-trips per drawer open.
 */
export async function countChildrenByTodoIds(
  db: DbClient,
  parentIds: string[],
): Promise<Map<string, number>> {
  if (parentIds.length === 0) return new Map();
  const result = await db.query(
    `SELECT parent_id, count(*)::int AS count
       FROM todos
      WHERE parent_id = ANY($1) AND archived = false
      GROUP BY parent_id`,
    [parentIds],
  );
  const map = new Map<string, number>();
  for (const row of result.rows) map.set(row.parent_id, row.count);
  return map;
}

/**
 * Depth of a todo measured by ancestor count: a top-level todo has
 * depth 0, a direct child has depth 1, a grandchild has depth 2, etc.
 *
 * Returns null when the id doesn't exist. Caps the recursive walk at
 * 16 levels — guards against pathological cycles even though the FK
 * shape doesn't formally allow them.
 */
export async function getTodoDepth(db: DbClient, id: string): Promise<number | null> {
  const result = await db.query(
    `WITH RECURSIVE chain AS (
       SELECT id, parent_id, 0 AS depth
         FROM todos
        WHERE id = $1
       UNION ALL
       SELECT t.id, t.parent_id, c.depth + 1
         FROM todos t
         JOIN chain c ON c.parent_id = t.id
        WHERE c.depth < 16
     )
     SELECT MAX(depth) AS depth, (COUNT(*) > 0) AS exists FROM chain`,
    [id],
  );
  const row = result.rows[0] as { depth: number | null; exists: boolean } | undefined;
  if (!row?.exists) return null;
  return row.depth ?? 0;
}

/**
 * Apply a manual ordering to a group of sibling todos. The group is
 * identified by `parentId` (NULL = top-level personal todos). Each
 * id in `ids` gets `manual_order` set to its position 0..N-1 in the
 * provided order. The query verifies all targets share the same
 * `parent_id` so a caller can't accidentally renumber across groups.
 *
 * Uses `WITH ORDINALITY` so the position-to-id mapping is a single SQL
 * UPDATE rather than N round-trips.
 */
export async function reorderTodosInGroup(
  db: DbClient,
  parentId: string | null,
  ids: string[],
): Promise<{ updated: number; mismatched_ids: string[] }> {
  if (ids.length === 0) return { updated: 0, mismatched_ids: [] };

  // First, verify every id is a non-archived todo whose parent matches
  // the requested group. Reject if any are off — partial reorders
  // silently dropping bad ids would be the wrong default.
  const checkSql = parentId === null
    ? `SELECT id FROM todos WHERE id = ANY($1::uuid[]) AND archived = false AND parent_id IS NULL`
    : `SELECT id FROM todos WHERE id = ANY($1::uuid[]) AND archived = false AND parent_id = $2`;
  const checkParams: unknown[] = parentId === null ? [ids] : [ids, parentId];
  const check = await db.query(checkSql, checkParams);
  const validIds = new Set(check.rows.map((r: { id: string }) => r.id));
  const mismatched = ids.filter((id) => !validIds.has(id));
  if (mismatched.length > 0) {
    return { updated: 0, mismatched_ids: mismatched };
  }

  const updateRes = await db.query(
    `UPDATE todos AS t
        SET manual_order = src.pos
       FROM (SELECT * FROM unnest($1::uuid[]) WITH ORDINALITY AS u(id, pos)) AS src
      WHERE t.id = src.id`,
    [ids],
  );
  return { updated: updateRes.rowCount ?? 0, mismatched_ids: [] };
}

/**
 * Semantic todo search result. Omits the raw embedding vector to keep
 * response payloads small (3072-dim floats × N hits is expensive).
 */
export type TodoSearchResult = Omit<TodoRow, 'embedding'> & { similarity: number };

/**
 * Lexical (ILIKE substring) todo search — counterpart to findSimilarTodos.
 * Matches the query against todo content. Title-priority concept doesn't
 * apply to todos (they're title-less; content is the title). Recency
 * tiebreaker matches the chunks helper for consistency.
 */
export async function findTodosByLexical(
  db: DbClient,
  query: string,
  limit: number = 10,
  opts: {
    sessionId?: string;
    projectId?: string | null;
    tags?: string[];
    /** Combine multiple tags: 'all' = AND (@>, default), 'any' = OR (&&). */
    tagMatch?: 'all' | 'any';
    excludedTags?: string[];
    /** When true, an empty query is treated as "list everything matching the
     *  other filters" rather than triggering the noise-floor short-circuit.
     *  Caller (search service) sets this when it has external signals — like
     *  entity_types restriction or project scope — that the helper opts
     *  don't directly carry. */
    allowEmptyQuery?: boolean;
  } = {},
): Promise<TodoSearchResult[]> {
  const q = query.trim();
  const hasText = q.length >= 2;
  // Noise floor: 1-char queries with no caller-asserted signal would match
  // ~everything via ILIKE %a%. Short-circuit. Filter-only mode (empty query
  // + tags) is fine.
  const hasOwnFilter = !!opts.tags?.length || !!opts.excludedTags?.length || opts.projectId !== undefined || opts.sessionId !== undefined;
  if (!hasText && !hasOwnFilter && !opts.allowEmptyQuery) return [];
  const escaped = hasText
    ? q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
    : '';
  const pattern = `%${escaped}%`;

  // Build conditions + params together; only include pattern when used so
  // Postgres doesn't choke on an unreferenced typeless parameter.
  const conditions = ['archived = false'];
  const params: unknown[] = [];
  if (hasText) {
    params.push(pattern);
    conditions.push(`content ILIKE $${params.length}`);
  }
  if (opts.tags && opts.tags.length > 0) {
    params.push(opts.tags);
    // @> = AND (contains all); && = OR (overlaps any).
    conditions.push(
      `tags ${opts.tagMatch === 'any' ? '&&' : '@>'} $${params.length}::text[]`,
    );
  }
  if (opts.excludedTags && opts.excludedTags.length > 0) {
    params.push(opts.excludedTags);
    conditions.push(`NOT (tags && $${params.length}::text[])`);
  }
  if (opts.sessionId) { params.push(opts.sessionId); conditions.push(`session_id = $${params.length}`); }
  if (opts.projectId === null) conditions.push('project_id IS NULL');
  else if (opts.projectId !== undefined) {
    params.push(opts.projectId);
    conditions.push(`project_id = $${params.length}::uuid`);
  }
  params.push(limit);
  const limitParam = params.length;
  const result = await db.query(
    `SELECT id, content, project_id, session_id, section, parent_id, status, priority,
            due_date, tags, archived, created_at, updated_at,
            -- Synthetic similarity for downstream compat — see chunks.ts.
            -- Cast to ::float so the pg NUMERIC default (string in JS)
            -- doesn't break the Zod number validation on retrieval_path.
            1.0::float AS similarity
     FROM todos
     WHERE ${conditions.join(' AND ')}
     ORDER BY updated_at DESC
     LIMIT $${limitParam}`,
    params,
  );
  return result.rows;
}

export async function findSimilarTodos(
  db: DbClient,
  embedding: number[],
  threshold: number,
  limit: number = 10,
  opts: {
    sessionId?: string;
    projectId?: string | null;
    tags?: string[];
    /** Combine multiple tags: 'all' = AND (@>, default), 'any' = OR (&&). */
    tagMatch?: 'all' | 'any';
    excludedTags?: string[];
  } = {},
): Promise<TodoSearchResult[]> {
  // Explicit column list — must NOT include the embedding vector.
  const conditions = [
    'archived = false',
    'embedding IS NOT NULL',
    '1 - (embedding <=> $1::vector) > $2',
  ];
  const params: unknown[] = [JSON.stringify(embedding), threshold, limit];
  let i = 4;
  if (opts.tags && opts.tags.length > 0) {
    // @> = AND (contains all); && = OR (overlaps any).
    conditions.push(`tags ${opts.tagMatch === 'any' ? '&&' : '@>'} $${i++}::text[]`);
    params.push(opts.tags);
  }
  if (opts.excludedTags && opts.excludedTags.length > 0) {
    conditions.push(`NOT (tags && $${i++}::text[])`);
    params.push(opts.excludedTags);
  }
  if (opts.sessionId) { conditions.push(`session_id = $${i++}`); params.push(opts.sessionId); }
  if (opts.projectId === null) conditions.push('project_id IS NULL');
  else if (opts.projectId !== undefined) {
    conditions.push(`project_id = $${i++}::uuid`);
    params.push(opts.projectId);
  }
  const result = await db.query(
    `SELECT id, content, project_id, session_id, section, parent_id, status, priority,
            due_date, tags, archived, created_at, updated_at,
            1 - (embedding <=> $1::vector) AS similarity
     FROM todos
     WHERE ${conditions.join(' AND ')}
     ORDER BY similarity DESC
     LIMIT $3`,
    params,
  );
  return result.rows;
}
