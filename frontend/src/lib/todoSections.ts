// Grouping for the Todos view. Top-level todos are bucketed by their durable
// `section` field; subtasks always follow their parent (they're never sectioned
// independently — section is a root-todo concept, like tags). Completed
// top-level todos are pulled out into a single Done bucket rendered at the very
// bottom of the view.
//
// Section membership lives on each todo (`todo.section`), so it persists per
// scope automatically — listing personal vs a project returns that scope's
// todos with their sections intact. Within-section order rides on
// `manual_order` (the 'manual' sort mode), reordered via /todos/reorder.

import { sortPersonalTodos, type SortedTodo, type TodoSortMode } from './todoSort';
import type { Todo } from '../types';

export interface TodoSection {
  /** Section name, or null for the "Ungrouped" bucket. */
  name: string | null;
  /** Sorted rows (top-level todos in the section + their nested subtasks). */
  rows: SortedTodo[];
  /** Top-level todo ids in render order — the draggable/movable units. */
  topIds: string[];
}

export interface GroupedTodos {
  sections: TodoSection[];
  done: SortedTodo[];
  /** Distinct non-null section names present (alphabetical). */
  sectionNames: string[];
}

/** A flat list of `tops` plus every descendant, depth-first. */
function withDescendants(tops: Todo[], all: Todo[]): Todo[] {
  const byParent = new Map<string, Todo[]>();
  for (const t of all) {
    if (!t.parent_id) continue;
    const arr = byParent.get(t.parent_id);
    if (arr) arr.push(t);
    else byParent.set(t.parent_id, [t]);
  }
  const out: Todo[] = [];
  const visit = (t: Todo) => {
    out.push(t);
    for (const c of byParent.get(t.id) ?? []) visit(c);
  };
  tops.forEach(visit);
  return out;
}

export function groupTodosBySection(
  todos: Todo[],
  opts: {
    mode?: TodoSortMode;
    isExpanded?: (id: string) => boolean;
    /** Freshly-added section names with no todos yet — kept visible so the
     *  user can drop todos into them. */
    extraSections?: string[];
  } = {},
): GroupedTodos {
  const tops = todos.filter((t) => !t.parent_id);
  const openTops = tops.filter((t) => t.status !== 'done');
  const doneTops = tops.filter((t) => t.status === 'done');

  const names = new Set<string>();
  for (const t of openTops) if (t.section) names.add(t.section);
  for (const s of opts.extraSections ?? []) if (s) names.add(s);
  const sectionNames = [...names].sort((a, b) => a.localeCompare(b));

  const buildSection = (name: string | null): TodoSection => {
    const sectionTops = openTops.filter((t) => (t.section ?? null) === name);
    const rows = sortPersonalTodos(withDescendants(sectionTops, todos), {
      mode: opts.mode,
      isExpanded: opts.isExpanded,
    });
    return { name, rows, topIds: rows.filter((r) => r.depth === 0).map((r) => r.todo.id) };
  };

  const sections: TodoSection[] = sectionNames.map((n) => buildSection(n));
  const ungrouped = buildSection(null);
  // Show "Ungrouped" only when it has todos, or when there are no named
  // sections at all (so an unsectioned corpus still renders a single list).
  if (ungrouped.rows.length > 0 || sections.length === 0) sections.push(ungrouped);

  const done = sortPersonalTodos(withDescendants(doneTops, todos), {
    mode: opts.mode,
    isExpanded: opts.isExpanded,
  });

  return { sections, done, sectionNames };
}
