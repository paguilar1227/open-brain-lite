import type { DbClient } from './client.js';

export type ActivityKind = 'ingest' | 'edit' | 'comment';
export type ActivityEntityType = 'document' | 'note' | 'todo' | 'todo_comment';

export interface ActivityRow {
  at: Date;
  kind: ActivityKind;
  entity_type: ActivityEntityType;
  entity_id: string;
  title: string;
  project_ids: string[];
}

export interface ListActivityFilters {
  since?: Date;
  until?: Date;
  /** Restrict to specific kinds. Default: all of them. */
  kinds?: ActivityKind[];
  /** Filter by project membership. Matches content_items.project_ids @> [pid]
   *  and todos.project_id = pid (and todo_comments via the parent todo). */
  project_id?: string;
  /** Default 100, capped at 500 by the route. */
  limit?: number;
}

/**
 * Recent-changes feed across content_items, todos, and todo_comments.
 *
 * V1 sources events from the existing rows' timestamp columns — no event
 * log table. Kinds we emit:
 *   - 'ingest'  for any content_item / todo where created_at falls in the window
 *   - 'edit'    for content_items / todos where updated_at > created_at and
 *               updated_at falls in the window (heuristic: any post-create
 *               change. Doesn't distinguish a retag from an archive)
 *   - 'comment' for todo_comments.created_at in the window
 *
 * Deliberately NOT in V1: 'complete' (would need to know status transitions,
 * not just current status='done') and 'archive' (would need to know when the
 * archived flag flipped). Both need a real event log; if it ever matters,
 * we add an `audit_events` table.
 *
 * Archived rows are excluded from ingest/edit branches so the feed shows
 * "what's live now," not historical noise. Comments are included even on
 * archived todos because seeing the discussion thread context is still
 * useful retrospectively.
 */
export async function listActivity(
  db: DbClient,
  filters: ListActivityFilters = {},
): Promise<ActivityRow[]> {
  const since = filters.since ?? null;
  const until = filters.until ?? null;
  const limit = Math.min(filters.limit ?? 100, 500);
  const projectId = filters.project_id ?? null;
  const kinds = filters.kinds && filters.kinds.length > 0
    ? filters.kinds
    : (['ingest', 'edit', 'comment'] as ActivityKind[]);

  const ciScope = projectId ? `AND project_ids @> ARRAY[$3]::uuid[]` : '';
  const todoScope = projectId ? `AND project_id = $3` : '';
  const commentScope = projectId ? `AND t.project_id = $3` : '';

  // Build branches conditional on kinds, since SQL UNION ALL has to be
  // syntactically present for every branch. Empty kinds was caught above.
  const branches: string[] = [];
  if (kinds.includes('ingest')) {
    branches.push(`
      SELECT created_at AS at, 'ingest'::text AS kind,
             type::text AS entity_type, id AS entity_id, title,
             project_ids
        FROM content_items
       WHERE archived = false
         AND ($1::timestamptz IS NULL OR created_at >= $1)
         AND ($2::timestamptz IS NULL OR created_at <  $2)
         ${ciScope}`);
    branches.push(`
      SELECT created_at AS at, 'ingest'::text AS kind,
             'todo'::text AS entity_type, id AS entity_id, content AS title,
             CASE WHEN project_id IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[project_id] END AS project_ids
        FROM todos
       WHERE archived = false
         AND ($1::timestamptz IS NULL OR created_at >= $1)
         AND ($2::timestamptz IS NULL OR created_at <  $2)
         ${todoScope}`);
  }
  if (kinds.includes('edit')) {
    branches.push(`
      SELECT updated_at AS at, 'edit'::text AS kind,
             type::text AS entity_type, id AS entity_id, title,
             project_ids
        FROM content_items
       WHERE archived = false
         AND updated_at > created_at
         AND ($1::timestamptz IS NULL OR updated_at >= $1)
         AND ($2::timestamptz IS NULL OR updated_at <  $2)
         ${ciScope}`);
    branches.push(`
      SELECT updated_at AS at, 'edit'::text AS kind,
             'todo'::text AS entity_type, id AS entity_id, content AS title,
             CASE WHEN project_id IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[project_id] END AS project_ids
        FROM todos
       WHERE archived = false
         AND updated_at > created_at
         AND ($1::timestamptz IS NULL OR updated_at >= $1)
         AND ($2::timestamptz IS NULL OR updated_at <  $2)
         ${todoScope}`);
  }
  if (kinds.includes('comment')) {
    branches.push(`
      SELECT tc.created_at AS at, 'comment'::text AS kind,
             'todo_comment'::text AS entity_type, tc.todo_id AS entity_id,
             t.content AS title,
             CASE WHEN t.project_id IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[t.project_id] END AS project_ids
        FROM todo_comments tc
        JOIN todos t ON t.id = tc.todo_id
       WHERE ($1::timestamptz IS NULL OR tc.created_at >= $1)
         AND ($2::timestamptz IS NULL OR tc.created_at <  $2)
         ${commentScope}`);
    // entity_id intentionally points at the parent todo (tc.todo_id, not
    // tc.id) — a comment activity event is a navigation target ("take me
    // to the thing this comment is about"), not a comment-detail link.
    // The 'todo_comment' entity_type still tags it as a comment event so
    // consumers can render "Commented on X" rather than "Edited X".
  }

  const params: unknown[] = [since, until];
  if (projectId) params.push(projectId);

  const sql = `
    WITH activity AS (
      ${branches.join('\n      UNION ALL\n')}
    )
    SELECT * FROM activity
     ORDER BY at DESC
     LIMIT ${limit}`;

  const result = await db.query(sql, params);
  return result.rows;
}
