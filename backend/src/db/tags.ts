import type { DbClient } from './client.js';

export interface TagRow {
  name: string;
  total: number;
  by_type: {
    document: number;
    note: number;
    todo: number;
  };
}

export interface ListTagsFilters {
  /** Restrict to tags appearing on items in this project (matches both
   *  content_items.project_ids @> [pid] and todos.project_id = pid).
   *  Takes precedence over `scope` when set. */
  project_id?: string;
  /** Coarse scope filter: 'personal' = only items with no project
   *  membership (content_items.project_ids = '{}' / todos.project_id
   *  IS NULL); 'all' (default) = no scope filter. */
  scope?: 'personal' | 'all';
}

/**
 * Aggregate tag usage across content_items + todos. Output sorts by total
 * desc then name asc, so the heaviest-used tags surface first.
 *
 * Tags don't have their own table — they're denormalized text[] columns
 * on each row. We unnest both arrays and group, which is fine at the
 * single-user scale we run at. If the corpus ever grew large enough that
 * full-table unnest matters, a materialized tag-counts view would be the
 * upgrade path.
 *
 * Archived rows are excluded — listing tags on dead items would be noise.
 */
export async function listTags(
  db: DbClient,
  filters: ListTagsFilters = {},
): Promise<TagRow[]> {
  const params: unknown[] = [];
  let ciScope = '';
  let todoScope = '';
  if (filters.project_id) {
    // Specific project — narrowest filter. Takes precedence over scope.
    ciScope = `AND project_ids @> ARRAY[$1]::uuid[]`;
    todoScope = `AND project_id = $1`;
    params.push(filters.project_id);
  } else if (filters.scope === 'personal') {
    // Personal scope — only items with no project membership. Empty
    // array literal in pg syntax. No parameter binding needed.
    ciScope = `AND project_ids = '{}'`;
    todoScope = `AND project_id IS NULL`;
  }
  // scope === 'all' or undefined: no scope filter (current default).

  const result = await db.query(
    `WITH tag_rows AS (
       SELECT unnest(tags) AS name, type AS kind
         FROM content_items
        WHERE archived = false ${ciScope}
       UNION ALL
       SELECT unnest(tags) AS name, 'todo'::text AS kind
         FROM todos
        WHERE archived = false ${todoScope}
     )
     SELECT name,
            count(*)::int AS total,
            count(*) FILTER (WHERE kind = 'document')::int AS doc_count,
            count(*) FILTER (WHERE kind = 'note')::int     AS note_count,
            count(*) FILTER (WHERE kind = 'todo')::int     AS todo_count
       FROM tag_rows
      GROUP BY name
      ORDER BY total DESC, name ASC`,
    params,
  );

  return result.rows.map((r: { name: string; total: number; doc_count: number; note_count: number; todo_count: number }) => ({
    name: r.name,
    total: r.total,
    by_type: {
      document: r.doc_count,
      note: r.note_count,
      todo: r.todo_count,
    },
  }));
}

/**
 * Rename a tag across content_items.tags and todos.tags atomically.
 *
 * Merge semantics: if a row already had both `from` and `to`, the result
 * deduplicates — the row keeps a single `to` instead of `[to, to]`. This
 * is what the user wants when rename is being used to consolidate parallel
 * labels (e.g. "meeting-notes" + "meetings" → "meeting-notes").
 *
 * Returns the total number of affected rows across both tables.
 */
export async function renameTag(
  db: DbClient,
  from: string,
  to: string,
): Promise<{ updated: number }> {
  return db.transaction(async (client) => {
    const r1 = await client.query(
      `UPDATE content_items
          SET tags = (
            SELECT COALESCE(array_agg(DISTINCT CASE WHEN t = $1 THEN $2 ELSE t END), ARRAY[]::text[])
              FROM unnest(tags) AS t
          ),
              updated_at = now()
        WHERE tags @> ARRAY[$1]`,
      [from, to],
    );
    const r2 = await client.query(
      `UPDATE todos
          SET tags = (
            SELECT COALESCE(array_agg(DISTINCT CASE WHEN t = $1 THEN $2 ELSE t END), ARRAY[]::text[])
              FROM unnest(tags) AS t
          ),
              updated_at = now()
        WHERE tags @> ARRAY[$1]`,
      [from, to],
    );
    return { updated: (r1.rowCount ?? 0) + (r2.rowCount ?? 0) };
  });
}

/**
 * Strip a tag from every row that has it. Does NOT delete the rows
 * themselves — only the tag is removed. Returns the number of affected rows.
 */
export async function deleteTag(
  db: DbClient,
  name: string,
): Promise<{ updated: number }> {
  return db.transaction(async (client) => {
    const r1 = await client.query(
      `UPDATE content_items
          SET tags = array_remove(tags, $1),
              updated_at = now()
        WHERE tags @> ARRAY[$1]`,
      [name],
    );
    const r2 = await client.query(
      `UPDATE todos
          SET tags = array_remove(tags, $1),
              updated_at = now()
        WHERE tags @> ARRAY[$1]`,
      [name],
    );
    return { updated: (r1.rowCount ?? 0) + (r2.rowCount ?? 0) };
  });
}
