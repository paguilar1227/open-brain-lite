import type { DbClient } from './client.js';

export interface ProjectInsert {
  name: string;
  description: string | null;
}

export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'archived' | 'completed';
  pinned_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export async function insertProject(db: DbClient, project: ProjectInsert): Promise<ProjectRow> {
  const result = await db.query(
    `INSERT INTO projects (name, description) VALUES ($1, $2) RETURNING *`,
    [project.name, project.description],
  );
  return result.rows[0];
}

export async function listProjects(
  db: DbClient,
  status?: string,
  pinned?: boolean,
): Promise<ProjectRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (status) { conditions.push(`status = $${i++}`); params.push(status); }
  if (pinned === true) conditions.push('pinned_at IS NOT NULL');
  else if (pinned === false) conditions.push('pinned_at IS NULL');

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderBy = pinned === true
    ? 'ORDER BY pinned_at DESC'
    : 'ORDER BY created_at DESC';
  const result = await db.query(
    `SELECT * FROM projects ${where} ${orderBy}`,
    params,
  );
  return result.rows;
}

export async function pinProject(db: DbClient, id: string): Promise<{ found: boolean }> {
  const r = await db.query(
    `UPDATE projects SET pinned_at = now(), updated_at = now() WHERE id = $1 RETURNING id`,
    [id],
  );
  return { found: r.rows.length > 0 };
}

export async function unpinProject(db: DbClient, id: string): Promise<{ found: boolean }> {
  const r = await db.query(
    `UPDATE projects SET pinned_at = NULL, updated_at = now() WHERE id = $1 RETURNING id`,
    [id],
  );
  return { found: r.rows.length > 0 };
}

export async function getProjectById(db: DbClient, id: string): Promise<ProjectRow | null> {
  const result = await db.query(`SELECT * FROM projects WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function updateProject(
  db: DbClient,
  id: string,
  patch: Partial<ProjectInsert> & { status?: string },
): Promise<ProjectRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (patch.name !== undefined) { sets.push(`name = $${i++}`); params.push(patch.name); }
  if (patch.description !== undefined) { sets.push(`description = $${i++}`); params.push(patch.description); }
  if (patch.status !== undefined) { sets.push(`status = $${i++}`); params.push(patch.status); }
  if (sets.length === 0) return getProjectById(db, id);
  sets.push(`updated_at = now()`);
  params.push(id);
  const result = await db.query(
    `UPDATE projects SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    params,
  );
  return result.rows[0] ?? null;
}

export async function archiveProject(db: DbClient, id: string): Promise<void> {
  await db.query(
    `UPDATE projects SET status = 'archived', updated_at = now() WHERE id = $1`,
    [id],
  );
}

export async function unarchiveProject(db: DbClient, id: string): Promise<void> {
  await db.query(
    `UPDATE projects SET status = 'active', updated_at = now() WHERE id = $1`,
    [id],
  );
}

export interface ProjectCounts {
  project_id: string;
  documents: number;
  notes: number;
  todos: number;
  done: number;
}

/**
 * Per-project content + todo counts. Single round-trip aggregating across
 * content_items (split by type) and todos (with done filter). Excludes
 * archived rows so the numbers match what the live workspace shows.
 */
export async function getProjectCounts(db: DbClient): Promise<ProjectCounts[]> {
  const result = await db.query(
    `WITH content_per AS (
       SELECT pid AS project_id,
              COUNT(*) FILTER (WHERE type = 'document')::bigint AS documents,
              COUNT(*) FILTER (WHERE type = 'note')::bigint     AS notes
       FROM (
         SELECT id, type, UNNEST(project_ids) AS pid
         FROM content_items WHERE archived = false
       ) e
       GROUP BY pid
     ),
     todo_per AS (
       SELECT project_id,
              COUNT(*)::bigint AS todos,
              COUNT(*) FILTER (WHERE status = 'done')::bigint AS done
       FROM todos
       WHERE archived = false AND project_id IS NOT NULL
       GROUP BY project_id
     )
     SELECT p.id AS project_id,
            COALESCE(c.documents, 0)::bigint AS documents,
            COALESCE(c.notes,     0)::bigint AS notes,
            COALESCE(t.todos,     0)::bigint AS todos,
            COALESCE(t.done,      0)::bigint AS done
     FROM projects p
     LEFT JOIN content_per c ON c.project_id = p.id
     LEFT JOIN todo_per    t ON t.project_id = p.id`,
    [],
  );
  return result.rows.map((r: { project_id: string; documents: string | number; notes: string | number; todos: string | number; done: string | number }) => ({
    project_id: r.project_id,
    documents: Number(r.documents),
    notes: Number(r.notes),
    todos: Number(r.todos),
    done: Number(r.done),
  }));
}

/**
 * Hard delete: removes project UUID from every content_items.project_ids[],
 * then deletes the project row. todos.project_id auto-nulls via FK cascade.
 * Run both statements in a single transaction so there's no window where
 * the project is deleted but stale UUIDs remain in arrays.
 */
export async function deleteProjectHard(db: DbClient, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE content_items
       SET project_ids = array_remove(project_ids, $1::uuid),
           updated_at = now()
       WHERE project_ids @> ARRAY[$1]::uuid[]`,
      [id],
    );
    await tx.query(`DELETE FROM projects WHERE id = $1`, [id]);
  });
}
