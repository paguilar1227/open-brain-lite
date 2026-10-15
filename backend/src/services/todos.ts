import type { ServiceDeps } from './index.js';
import { MAX_TODO_DEPTH as SHARED_MAX_TODO_DEPTH } from '@open-brain/shared';
import { countCommentsByTodoIds } from '../db/todo-comments.js';
import {
  insertTodo, listTodos as dbListTodos, getTodoById,
  updateTodo as dbUpdateTodo,
  archiveTodo, unarchiveTodo, deleteTodoHard,
  findChildTodos, findSimilarTodos,
  countChildrenByTodoIds,
  getTodoDepth,
  bulkArchiveTodos,
  bulkRestoreTodos,
  bulkDeleteTodosHard,
  bulkAddTagsTodos,
  bulkRemoveTagsTodos,
  bulkSetStatusTodos,
  bulkSetPriorityTodos,
  bulkSetProjectIdTodos,
  bulkSetDueDateTodos,
  pinTodo as dbPinTodo,
  unpinTodo as dbUnpinTodo,
  reorderTodosInGroup,
  type TodoRow, type TodoInsert, type ListTodosFilters, type TodoSearchResult,
  type BulkTodoStatus, type BulkTodoPriority, type BulkTodoResult,
} from '../db/todos.js';

/**
 * Hard cap on todo nesting depth — re-exported from shared so frontend
 * UI gating and backend enforcement use the same number. See the
 * docblock on MAX_TODO_DEPTH in shared/src/schemas.ts.
 */
export const MAX_TODO_DEPTH = SHARED_MAX_TODO_DEPTH;

/** Thrown when a write would exceed MAX_TODO_DEPTH. REST translates
 *  to 400; MCP surfaces the message verbatim. */
export class TodoDepthExceededError extends Error {
  constructor(public readonly attemptedDepth: number) {
    super(
      `Subtask nesting too deep: would land at depth ${attemptedDepth} (max ${MAX_TODO_DEPTH}). ` +
      `Personal todos cap at ${MAX_TODO_DEPTH + 1} levels — split the task or use a sibling instead.`,
    );
    this.name = 'TodoDepthExceededError';
  }
}

async function assertParentDepthAllowed(deps: ServiceDeps, parentId: string): Promise<void> {
  const parentDepth = await getTodoDepth(deps.db, parentId);
  if (parentDepth === null) return; // parent missing — let the FK / not-found path handle it
  if (parentDepth + 1 > MAX_TODO_DEPTH) {
    throw new TodoDepthExceededError(parentDepth + 1);
  }
}

export async function createTodo(
  deps: ServiceDeps,
  input: {
    content: string;
    projectId?: string | null;
    section?: string | null;
    parentId?: string | null;
    priority?: 'P1' | 'P2' | 'P3' | null;
    dueDate?: Date | null;
    tags?: string[];
  },
): Promise<TodoRow> {
  if (input.parentId) {
    await assertParentDepthAllowed(deps, input.parentId);
  }
  const embedding = await deps.embeddingProvider.embed(input.content);
  const todo: TodoInsert = {
    content: input.content,
    projectId: input.projectId ?? null,
    section: input.section ?? null,
    parentId: input.parentId ?? null,
    priority: input.priority ?? null,
    dueDate: input.dueDate ?? null,
    // Root-only tags: a subtask (created under a parent) never carries tags.
    tags: input.parentId ? [] : (input.tags ?? []),
    embedding,
  };
  return insertTodo(deps.db, todo);
}

export async function listTodos(deps: ServiceDeps, filters: ListTodosFilters = {}): Promise<TodoRow[]> {
  const rows = await dbListTodos(deps.db, filters);
  if (rows.length === 0) return rows;
  // Comment + subtask counts each come from a single batched query —
  // keeps the list path O(1) DB roundtrips instead of fanning out per
  // row. Both are decorations, so failing to populate them shouldn't
  // change the row contract; the schema marks each as optional.
  const ids = rows.map((r) => r.id);
  const [commentCounts, childCounts] = await Promise.all([
    countCommentsByTodoIds(deps.db, ids),
    countChildrenByTodoIds(deps.db, ids),
  ]);
  return rows.map((r) => ({
    ...r,
    comment_count: commentCounts.get(r.id) ?? 0,
    subtask_count: childCounts.get(r.id) ?? 0,
  }));
}

export async function getTodo(deps: ServiceDeps, id: string): Promise<TodoRow | null> {
  const row = await getTodoById(deps.db, id);
  if (!row) return null;
  // Single-row lookup of the same decorations the list path returns.
  // Cheap (two single-key counts) and lets every consumer treat list
  // and detail responses uniformly.
  const [commentCounts, childCounts] = await Promise.all([
    countCommentsByTodoIds(deps.db, [id]),
    countChildrenByTodoIds(deps.db, [id]),
  ]);
  return {
    ...row,
    comment_count: commentCounts.get(id) ?? 0,
    subtask_count: childCounts.get(id) ?? 0,
  };
}

export async function updateTodo(
  deps: ServiceDeps,
  id: string,
  patch: {
    content?: string;
    projectId?: string | null;
    section?: string | null;
    parentId?: string | null;
    status?: string;
    priority?: 'P1' | 'P2' | 'P3' | null;
    dueDate?: Date | null;
    tags?: string[];
  },
): Promise<TodoRow | null> {
  // Re-parenting must respect the depth cap. Reject before any other
  // work so the embedding call doesn't run for an ultimately-failed
  // update. patch.parentId === null clears the parent (always safe).
  if (patch.parentId !== undefined && patch.parentId !== null) {
    await assertParentDepthAllowed(deps, patch.parentId);
  }
  // Root-only tags: tags live only on root todos. Re-parenting a tagged root
  // into a subtask clears its tags, and tag edits on an existing subtask are
  // dropped. (The UI hides the tag editor on subtasks; this is the backstop.)
  let tags = patch.tags;
  if (patch.parentId !== undefined && patch.parentId !== null) {
    tags = []; // becoming a subtask → drop any tags
  } else if (patch.tags !== undefined && patch.parentId === undefined) {
    const cur = await getTodoById(deps.db, id);
    if (cur?.parent_id) tags = []; // tag edit on an existing subtask → ignore
  }

  let embedding: number[] | null | undefined;
  if (patch.content !== undefined) {
    embedding = await deps.embeddingProvider.embed(patch.content);
  }
  // Peek at the previous status so we can detect transitions in/out of
  // 'done' and cascade in either direction. Skipping the SELECT when
  // status isn't changing keeps the no-op path single-roundtrip.
  let prevStatus: string | undefined;
  if (patch.status !== undefined) {
    const cur = await getTodoById(deps.db, id);
    prevStatus = cur?.status;
  }
  const result = await dbUpdateTodo(deps.db, id, { ...patch, tags, embedding });

  // Cascade is symmetric:
  //   done   ← (any non-done) → mark non-done descendants done
  //   any    ← (done)         → flip done descendants to the parent's
  //                              new status so the subtree no longer
  //                              reads as finished.
  // The cost of bidirectional cascade is that descendants don't
  // remember their pre-cascade status — reopening a parent doesn't
  // restore "this child was originally not_started, that one was
  // in_progress." The user accepts that tradeoff in exchange for
  // "toggle the parent → the subtree follows."
  if (patch.status !== undefined) {
    const becameDone = patch.status === 'done' && prevStatus !== 'done';
    const becameOpen = patch.status !== 'done' && prevStatus === 'done';
    if (becameDone) {
      const children = await findChildTodos(deps.db, id);
      for (const child of children) {
        if (child.status !== 'done') {
          await updateTodo(deps, child.id, { status: 'done' });
        }
      }
    } else if (becameOpen) {
      const children = await findChildTodos(deps.db, id);
      for (const child of children) {
        if (child.status === 'done') {
          await updateTodo(deps, child.id, { status: patch.status });
        }
      }
    }
  }
  return result;
}

export async function archiveTodoById(deps: ServiceDeps, id: string): Promise<void> {
  await archiveTodo(deps.db, id);
}

export async function unarchiveTodoById(deps: ServiceDeps, id: string): Promise<void> {
  await unarchiveTodo(deps.db, id);
}

/** Hard delete a todo. Subtasks cascade via FK. */
export async function deleteTodoHardById(deps: ServiceDeps, id: string): Promise<void> {
  await deleteTodoHard(deps.db, id);
}

export async function pinTodo(deps: ServiceDeps, id: string): Promise<{ found: boolean }> {
  return dbPinTodo(deps.db, id);
}

export async function unpinTodo(deps: ServiceDeps, id: string): Promise<{ found: boolean }> {
  return dbUnpinTodo(deps.db, id);
}

/**
 * Persist a manual ordering for a sibling group of todos. The group
 * is identified by `parentId` (null = top-level personal); the `ids`
 * array IS the new order, position 1..N becoming `manual_order`.
 *
 * Mismatched ids (wrong parent / archived / not found) cause the
 * whole reorder to abort — partial application would be confusing
 * and leaves the client UI in disagreement with the backend.
 */
export async function reorderTodos(
  deps: ServiceDeps,
  parentId: string | null,
  ids: string[],
): Promise<{ updated: number; mismatched_ids: string[] }> {
  return reorderTodosInGroup(deps.db, parentId, ids);
}

export async function searchTodos(
  deps: ServiceDeps,
  query: string,
  limit: number = 10,
): Promise<TodoSearchResult[]> {
  const embedding = await deps.embeddingProvider.embed(query);
  return findSimilarTodos(deps.db, embedding, 0.3, limit);
}

export type BulkTodoAction =
  | 'archive'
  | 'restore'
  | 'delete'
  | 'add_tags'
  | 'remove_tags'
  | 'set_status'
  | 'set_priority'
  | 'set_project_id'
  | 'set_due_date';

export interface BulkTodoRequest {
  ids: string[];
  action: BulkTodoAction;
  tags?: string[];
  status?: BulkTodoStatus;
  /** P1/P2/P3 to set, or null to clear. Distinguish "not provided" from "clear". */
  priority?: BulkTodoPriority;
  has_priority?: boolean;
  /** UUID to assign, or null to detach to Inbox. Distinguish "not provided" from "clear". */
  project_id?: string | null;
  has_project_id?: boolean;
  /** ISO 8601 string to set, or null to clear. */
  due_date?: Date | null;
  has_due_date?: boolean;
}

export class BulkTodoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BulkTodoValidationError';
  }
}

export async function bulkTodos(
  deps: ServiceDeps,
  req: BulkTodoRequest,
): Promise<BulkTodoResult> {
  switch (req.action) {
    case 'archive':
      return bulkArchiveTodos(deps.db, req.ids);
    case 'restore':
      return bulkRestoreTodos(deps.db, req.ids);
    case 'delete':
      return bulkDeleteTodosHard(deps.db, req.ids);
    case 'add_tags':
      if (!req.tags || req.tags.length === 0) {
        throw new BulkTodoValidationError('action="add_tags" requires non-empty tags array');
      }
      return bulkAddTagsTodos(deps.db, req.ids, req.tags);
    case 'remove_tags':
      if (!req.tags || req.tags.length === 0) {
        throw new BulkTodoValidationError('action="remove_tags" requires non-empty tags array');
      }
      return bulkRemoveTagsTodos(deps.db, req.ids, req.tags);
    case 'set_status':
      if (!req.status) {
        throw new BulkTodoValidationError('action="set_status" requires a status value');
      }
      return bulkSetStatusTodos(deps.db, req.ids, req.status);
    case 'set_priority':
      if (!req.has_priority) {
        throw new BulkTodoValidationError(
          'action="set_priority" requires a priority field (P1/P2/P3 or null to clear)',
        );
      }
      return bulkSetPriorityTodos(deps.db, req.ids, req.priority ?? null);
    case 'set_project_id':
      if (!req.has_project_id) {
        throw new BulkTodoValidationError(
          'action="set_project_id" requires a project_id field (UUID or null to detach)',
        );
      }
      return bulkSetProjectIdTodos(deps.db, req.ids, req.project_id ?? null);
    case 'set_due_date':
      if (!req.has_due_date) {
        throw new BulkTodoValidationError(
          'action="set_due_date" requires a due_date field (ISO 8601 or null to clear)',
        );
      }
      return bulkSetDueDateTodos(deps.db, req.ids, req.due_date ?? null);
  }
}
