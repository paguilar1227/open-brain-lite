// Hierarchical sort for personal todos. Used by the Home column (top 6,
// depth-capped, default-collapsed), the personal todos drawer (full
// tree, default-collapsed), and the project todos panel.
//
// Five sort modes:
//   - 'smart'    (default) — band-driven bias: overdue → pinned →
//                            active → done; within band manual / due /
//                            priority / created.
//   - 'due'      — strictly by due_at asc, no-due last; ties by
//                  priority then created desc.
//   - 'priority' — strictly by priority (P1 first); ties by due then
//                  created desc.
//   - 'manual'   — strictly by manual_order asc, NULLS LAST; unranked
//                  rows fall to created desc.
//   - 'recent'   — created desc (newest first).
//
// In every mode except 'smart', status is ignored — done rows
// intermingle with active by the chosen key. The user explicitly
// picked the lens; we don't second-guess it.
//
// Subtasks always emit immediately after their parent regardless of
// mode — the visual hierarchy beats sort score for descendants.
// Grandchildren sit under children sit under top-level rows.
//
// Two knobs control what's actually emitted:
//   - `maxDepth`  — descendants beyond this depth are omitted and
//                   counted into `hiddenDescendants` so the deepest
//                   visible row can render a "+N deeper" hint.
//   - `isExpanded(id)` — when provided AND returns false for a parent,
//                   that parent's subtree is omitted (counted into
//                   `hiddenDescendants` so the chevron can show "(N)").
//                   Default is "always expanded" — caller opts into
//                   collapse semantics.
//
// Orphan children (parent not in the list) get appended at the end at
// depth=0 rather than dropped — happens if a partial filter is applied.

import type { Todo } from '../types';

export type TodoSortMode = 'smart' | 'due' | 'priority' | 'manual' | 'recent' | 'alpha';

export const TODO_SORT_MODES: TodoSortMode[] = ['smart', 'due', 'priority', 'manual', 'recent', 'alpha'];

export const TODO_SORT_LABELS: Record<TodoSortMode, string> = {
  smart: 'Smart',
  due: 'Due date',
  priority: 'Priority',
  manual: 'Manual',
  recent: 'Recently created',
  alpha: 'Alphabetical',
};

export interface SortedTodo {
  todo: Todo;
  depth: number;
  childCount: number;
  hiddenDescendants: number;
}

const PRIORITY_RANK: Record<Todo['priority'], number> = { p1: 0, p2: 1, p3: 2 };
const FAR_FUTURE = Number.MAX_SAFE_INTEGER;

function isOverdueAt(d: string | null): boolean {
  if (!d) return false;
  return new Date(d).getTime() < Date.now();
}

function bandRank(t: Todo): number {
  if (t.status !== 'done' && isOverdueAt(t.due_at)) return 0;
  if (t.pinned && t.status !== 'done') return 1;
  if (t.status === 'done') return 3;
  return 2;
}

function dueMs(t: Todo): number {
  return t.due_at ? new Date(t.due_at).getTime() : FAR_FUTURE;
}
function priorityRank(t: Todo): number {
  return PRIORITY_RANK[t.priority] ?? 9;
}
function manualKey(t: Todo): number {
  // NULLS LAST: unranked rows fall behind anything the user dragged.
  return t.manual_order ?? FAR_FUTURE;
}
function createdDescMs(t: Todo): number {
  return -new Date(t.created_at).getTime();
}

function compareSmart(a: Todo, b: Todo): number {
  const ba = bandRank(a);
  const bb = bandRank(b);
  if (ba !== bb) return ba - bb;
  return (
    manualKey(a) - manualKey(b)
    || dueMs(a) - dueMs(b)
    || priorityRank(a) - priorityRank(b)
    || createdDescMs(a) - createdDescMs(b)
  );
}

function compareByDue(a: Todo, b: Todo): number {
  return (
    dueMs(a) - dueMs(b)
    || priorityRank(a) - priorityRank(b)
    || createdDescMs(a) - createdDescMs(b)
  );
}

function compareByPriority(a: Todo, b: Todo): number {
  return (
    priorityRank(a) - priorityRank(b)
    || dueMs(a) - dueMs(b)
    || createdDescMs(a) - createdDescMs(b)
  );
}

function compareByManual(a: Todo, b: Todo): number {
  return manualKey(a) - manualKey(b) || createdDescMs(a) - createdDescMs(b);
}

function compareByCreated(a: Todo, b: Todo): number {
  return createdDescMs(a) - createdDescMs(b);
}

function compareByAlpha(a: Todo, b: Todo): number {
  return a.title.localeCompare(b.title) || createdDescMs(a) - createdDescMs(b);
}

/** Comparator factory — exported so flat-render surfaces (project
 *  TodosTab) can apply the same ordering without going through the
 *  hierarchical emit path. */
export function compareForMode(mode: TodoSortMode): (a: Todo, b: Todo) => number {
  switch (mode) {
    case 'smart': return compareSmart;
    case 'due': return compareByDue;
    case 'priority': return compareByPriority;
    case 'manual': return compareByManual;
    case 'recent': return compareByCreated;
    case 'alpha': return compareByAlpha;
  }
}

export interface SortOptions {
  mode?: TodoSortMode;
  maxDepth?: number;
  isExpanded?: (id: string) => boolean;
}

export function sortPersonalTodos(
  todos: Todo[],
  opts: SortOptions = {},
): SortedTodo[] {
  const { mode = 'smart', maxDepth = Infinity, isExpanded } = opts;
  const compare = compareForMode(mode);
  const byParent = new Map<string, Todo[]>();
  const tops: Todo[] = [];
  for (const t of todos) {
    if (t.parent_id) {
      const cs = byParent.get(t.parent_id);
      if (cs) cs.push(t);
      else byParent.set(t.parent_id, [t]);
    } else {
      tops.push(t);
    }
  }
  tops.sort(compare);
  for (const cs of byParent.values()) cs.sort(compare);

  const out: SortedTodo[] = [];
  const seenChildren = new Set<string>();

  const countDescendants = (id: string): number => {
    let n = 0;
    const cs = byParent.get(id);
    if (!cs) return 0;
    for (const c of cs) n += 1 + countDescendants(c.id);
    return n;
  };

  const markSubtreeSeen = (id: string) => {
    const k = byParent.get(id);
    if (!k) return;
    for (const x of k) {
      seenChildren.add(x.id);
      markSubtreeSeen(x.id);
    }
  };

  const emit = (t: Todo, depth: number) => {
    if (depth > maxDepth) return;
    const cs = byParent.get(t.id);
    const childCount = cs?.length ?? 0;
    const collapsed = !!isExpanded && childCount > 0 && !isExpanded(t.id);
    const atCap = depth === maxDepth && childCount > 0;
    let hidden = 0;
    if (collapsed || atCap) hidden = countDescendants(t.id);
    // At maxDepth, suppress childCount so the row renders the deeper
    // hint instead of an inert chevron — expansion here can't reveal
    // anything on this surface, so showing a chevron would mislead.
    const reportedChildCount = atCap ? 0 : childCount;
    out.push({ todo: t, depth, childCount: reportedChildCount, hiddenDescendants: hidden });

    if (collapsed || atCap) {
      markSubtreeSeen(t.id);
      return;
    }
    if (cs) {
      for (const c of cs) {
        seenChildren.add(c.id);
        emit(c, depth + 1);
      }
    }
  };

  for (const t of tops) emit(t, 0);

  for (const cs of byParent.values()) {
    for (const c of cs) {
      if (!seenChildren.has(c.id)) {
        out.push({ todo: c, depth: 0, childCount: 0, hiddenDescendants: 0 });
      }
    }
  }
  return out;
}
