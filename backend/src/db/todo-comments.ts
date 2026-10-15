import type { DbClient } from './client.js';

export interface TodoCommentInsert {
  content: string;
  todoId: string;
}

export interface TodoCommentRow {
  id: string;
  todo_id: string;
  content: string;
  created_at: Date;
  updated_at: Date;
}

export async function insertComment(
  db: DbClient,
  comment: TodoCommentInsert,
): Promise<TodoCommentRow> {
  const result = await db.query(
    `INSERT INTO todo_comments (content, todo_id) VALUES ($1, $2) RETURNING *`,
    [comment.content, comment.todoId],
  );
  return result.rows[0];
}

export async function findCommentsByTodoId(db: DbClient, todoId: string): Promise<TodoCommentRow[]> {
  const result = await db.query(
    `SELECT * FROM todo_comments WHERE todo_id = $1 ORDER BY created_at ASC`,
    [todoId],
  );
  return result.rows;
}

export async function getCommentById(db: DbClient, id: string): Promise<TodoCommentRow | null> {
  const result = await db.query(`SELECT * FROM todo_comments WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function updateComment(db: DbClient, id: string, content: string): Promise<void> {
  await db.query(
    `UPDATE todo_comments SET content = $1, updated_at = now() WHERE id = $2`,
    [content, id],
  );
}

export async function deleteComment(db: DbClient, id: string): Promise<void> {
  await db.query(`DELETE FROM todo_comments WHERE id = $1`, [id]);
}

export async function countCommentsByTodoIds(
  db: DbClient,
  todoIds: string[],
): Promise<Map<string, number>> {
  if (todoIds.length === 0) return new Map();
  const result = await db.query(
    `SELECT todo_id, count(*)::int as count FROM todo_comments
     WHERE todo_id = ANY($1) GROUP BY todo_id`,
    [todoIds],
  );
  const map = new Map<string, number>();
  for (const row of result.rows) map.set(row.todo_id, row.count);
  return map;
}
