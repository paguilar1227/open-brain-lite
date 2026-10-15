import type { DbClient } from './client.js';

export interface StatsCounts {
  documents: number;
  notes: number;
  todos: { total: number; not_started: number; in_progress: number; done: number };
  projects: { total: number; active: number; archived: number; completed: number };
  comments: number;
  chunks: number;
}

export interface StatsProcessing {
  pending: number;
  ready: number;
  failed: number;
}

export interface StatsFreshness {
  last_ingest_at: Date | null;
  last_edit_at: Date | null;
  last_comment_at: Date | null;
}

export interface StatsTagBucket {
  name: string;
  count: number;
}

export interface Stats {
  counts: StatsCounts;
  processing: StatsProcessing;
  freshness: StatsFreshness;
  top_tags: StatsTagBucket[];
}

/**
 * Inventory snapshot. One round-trip, all aggregates resolved server-side
 * via a single multi-CTE query so totals stay consistent across counts.
 *
 * When `projectId` is set, every count is scoped to that project's membership
 * (content_items.project_ids @> [pid]; todos.project_id = pid; comments via
 * the parent todo). The `projects` count itself ignores the scope filter
 * because it's the inventory of all projects, not just the scoped one.
 *
 * Archived rows are excluded everywhere — stats describe the live workspace.
 */
export async function getStats(
  db: DbClient,
  projectId?: string,
): Promise<Stats> {
  const ciScope = projectId ? `AND project_ids @> ARRAY[$1]::uuid[]` : '';
  const todoScope = projectId ? `AND project_id = $1` : '';
  const commentScope = projectId ? `AND t.project_id = $1` : '';
  const chunkScope = projectId
    ? `AND ci.project_ids @> ARRAY[$1]::uuid[]`
    : '';
  const params = projectId ? [projectId] : [];

  const sql = `
    WITH content_counts AS (
      SELECT
        COUNT(*) FILTER (WHERE type = 'document')::bigint AS documents,
        COUNT(*) FILTER (WHERE type = 'note')::bigint     AS notes,
        COUNT(*) FILTER (WHERE processing_status = 'pending')::bigint AS pending,
        COUNT(*) FILTER (WHERE processing_status = 'ready')::bigint   AS ready,
        COUNT(*) FILTER (WHERE processing_status = 'failed')::bigint  AS failed,
        MAX(created_at) AS last_ingest_at,
        MAX(CASE WHEN updated_at > created_at THEN updated_at END) AS last_edit_at
      FROM content_items
      WHERE archived = false ${ciScope}
    ),
    todo_counts AS (
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE status = 'not_started')::bigint AS not_started,
        COUNT(*) FILTER (WHERE status = 'in_progress')::bigint AS in_progress,
        COUNT(*) FILTER (WHERE status = 'done')::bigint        AS done
      FROM todos
      WHERE archived = false ${todoScope}
    ),
    project_counts AS (
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE status = 'active')::bigint    AS active,
        COUNT(*) FILTER (WHERE status = 'archived')::bigint  AS archived,
        COUNT(*) FILTER (WHERE status = 'completed')::bigint AS completed
      FROM projects
    ),
    comment_counts AS (
      SELECT
        COUNT(*)::bigint AS total,
        MAX(tc.created_at) AS last_comment_at
      FROM todo_comments tc
      JOIN todos t ON t.id = tc.todo_id
      WHERE t.archived = false ${commentScope}
    ),
    chunk_counts AS (
      SELECT COUNT(*)::bigint AS total
      FROM chunks c
      JOIN content_items ci ON ci.id = c.content_item_id
      WHERE ci.archived = false ${chunkScope}
    ),
    tag_buckets AS (
      SELECT tag, COUNT(*)::bigint AS count
      FROM (
        SELECT UNNEST(tags) AS tag FROM content_items
         WHERE archived = false ${ciScope}
        UNION ALL
        SELECT UNNEST(tags) AS tag FROM todos
         WHERE archived = false ${todoScope}
      ) tag_rows
      GROUP BY tag
      ORDER BY count DESC, tag ASC
      LIMIT 20
    )
    SELECT
      (SELECT documents FROM content_counts)        AS documents,
      (SELECT notes FROM content_counts)            AS notes,
      (SELECT pending FROM content_counts)          AS pending,
      (SELECT ready FROM content_counts)            AS ready,
      (SELECT failed FROM content_counts)           AS failed,
      (SELECT last_ingest_at FROM content_counts)   AS last_ingest_at,
      (SELECT last_edit_at FROM content_counts)     AS last_edit_at,
      (SELECT total FROM todo_counts)               AS todos_total,
      (SELECT not_started FROM todo_counts)         AS todos_not_started,
      (SELECT in_progress FROM todo_counts)         AS todos_in_progress,
      (SELECT done FROM todo_counts)                AS todos_done,
      (SELECT total FROM project_counts)            AS projects_total,
      (SELECT active FROM project_counts)           AS projects_active,
      (SELECT archived FROM project_counts)         AS projects_archived,
      (SELECT completed FROM project_counts)        AS projects_completed,
      (SELECT total FROM comment_counts)            AS comments,
      (SELECT last_comment_at FROM comment_counts)  AS last_comment_at,
      (SELECT total FROM chunk_counts)              AS chunks,
      (SELECT COALESCE(json_agg(json_build_object('name', tag, 'count', count) ORDER BY count DESC, tag ASC), '[]'::json)
         FROM tag_buckets)                          AS top_tags`;

  const result = await db.query(sql, params);
  const r = result.rows[0] ?? {};
  return {
    counts: {
      documents: Number(r.documents ?? 0),
      notes: Number(r.notes ?? 0),
      todos: {
        total: Number(r.todos_total ?? 0),
        not_started: Number(r.todos_not_started ?? 0),
        in_progress: Number(r.todos_in_progress ?? 0),
        done: Number(r.todos_done ?? 0),
      },
      projects: {
        total: Number(r.projects_total ?? 0),
        active: Number(r.projects_active ?? 0),
        archived: Number(r.projects_archived ?? 0),
        completed: Number(r.projects_completed ?? 0),
      },
      comments: Number(r.comments ?? 0),
      chunks: Number(r.chunks ?? 0),
    },
    processing: {
      pending: Number(r.pending ?? 0),
      ready: Number(r.ready ?? 0),
      failed: Number(r.failed ?? 0),
    },
    freshness: {
      last_ingest_at: r.last_ingest_at ?? null,
      last_edit_at: r.last_edit_at ?? null,
      last_comment_at: r.last_comment_at ?? null,
    },
    top_tags: Array.isArray(r.top_tags) ? r.top_tags.map((t: { name: string; count: number | string }) => ({
      name: t.name,
      count: Number(t.count),
    })) : [],
  };
}
