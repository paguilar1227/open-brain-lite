import type { ServiceDeps } from './index.js';
import {
  insertComment, findCommentsByTodoId, getCommentById,
  updateComment as dbUpdateComment, deleteComment as dbDeleteComment,
  countCommentsByTodoIds,
  type TodoCommentRow,
} from '../db/todo-comments.js';

export async function createComment(
  deps: ServiceDeps,
  todoId: string,
  content: string,
): Promise<TodoCommentRow> {
  return insertComment(deps.db, { todoId, content });
}

export async function listComments(deps: ServiceDeps, todoId: string): Promise<TodoCommentRow[]> {
  return findCommentsByTodoId(deps.db, todoId);
}

export async function getComment(deps: ServiceDeps, id: string): Promise<TodoCommentRow | null> {
  return getCommentById(deps.db, id);
}

export async function updateComment(deps: ServiceDeps, id: string, content: string): Promise<void> {
  return dbUpdateComment(deps.db, id, content);
}

export async function deleteComment(deps: ServiceDeps, id: string): Promise<void> {
  return dbDeleteComment(deps.db, id);
}

export async function countComments(deps: ServiceDeps, todoIds: string[]): Promise<Map<string, number>> {
  return countCommentsByTodoIds(deps.db, todoIds);
}
