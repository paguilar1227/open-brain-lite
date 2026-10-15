// DnD wrapper for the personal-todos column / drawer. Wraps the
// pre-sorted SortedTodo[] with @dnd-kit so each sibling group (top-
// level + per-parent) is independently reorderable. Drops are
// constrained to the same parent_id; cross-group drags are rejected
// in onDragEnd.
//
// Architecture:
//   - One outer DndContext with a global onDragEnd.
//   - Inner SortableContext per group. Top-level rows live in the
//     outer SortableContext; each parent's expanded children live in
//     a nested SortableContext rendered inside the parent's group.
//   - useSortable picks up the nearest context, so dnd-kit only
//     allows in-place sorts inside a single group.
//   - Persisted via POST /api/v1/todos/reorder. Optimistic update
//     hydrates manual_order locally so the next render shows the new
//     order before the refetch lands.

import { Fragment, useMemo } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TodoRow } from './TodoRow';
import { reorderTodos } from '../lib/api';
import type { SortedTodo } from '../lib/todoSort';
import type { Todo } from '../types';

interface RowProps {
  s: SortedTodo;
  isExpanded: (id: string) => boolean;
  onToggleExpand: (id: string) => void;
  onClickRow: (todo: Todo) => void;
  onToggleDone: (todo: Todo) => void;
}

// One sortable row. Pulls drag handlers from the nearest SortableContext
// (top-level for parent_id=null rows, the inner per-parent context for
// subtasks). The TodoRow only attaches the drag listeners to its grip
// cell so clicking the body still routes to onClick (open detail).
function SortableRow({ s, isExpanded, onToggleExpand, onClickRow, onToggleDone }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: s.todo.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    position: 'relative',
    zIndex: isDragging ? 2 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <TodoRow
        todo={s.todo}
        depth={s.depth}
        childCount={s.childCount}
        expanded={isExpanded(s.todo.id)}
        hiddenDescendants={s.hiddenDescendants}
        dragHandleProps={{ ...attributes, ...listeners }}
        onClick={() => onClickRow(s.todo)}
        onToggleExpand={() => onToggleExpand(s.todo.id)}
        onToggleDone={() => onToggleDone(s.todo)}
      />
    </div>
  );
}

interface ListProps {
  /** Visible subset, in render order. May be sliced (Home column shows
   *  top 6); used only for what to render. */
  rows: SortedTodo[];
  /** Full sorted list (same sort, no slice). On drag, the new manual
   *  order is computed against the FULL sibling group and the entire
   *  group is renumbered 1..N — without this, the slice would leak
   *  manual_order conflicts onto invisible rows. */
  allRows: SortedTodo[];
  isExpanded: (id: string) => boolean;
  onToggleExpand: (id: string) => void;
  onClickRow: (todo: Todo) => void;
  onToggleDone: (todo: Todo) => void;
  /** Query keys to invalidate after a successful reorder. The Home
   *  column and the drawer share `['todos']` but stats/activity may
   *  be affected too — caller decides. */
  invalidateKeys?: string[][];
}

/**
 * Build a `parent_id (null|string) → SortedTodo[]` map preserving the
 * incoming visual order within each group. Top-level rows go under
 * the literal key `__top__`.
 */
function groupByParent(rows: SortedTodo[]): Map<string, SortedTodo[]> {
  const out = new Map<string, SortedTodo[]>();
  for (const r of rows) {
    const key = r.todo.parent_id ?? '__top__';
    const arr = out.get(key);
    if (arr) arr.push(r);
    else out.set(key, [r]);
  }
  return out;
}

export function SortableTodoList({
  rows,
  allRows,
  isExpanded,
  onToggleExpand,
  onClickRow,
  onToggleDone,
  invalidateKeys,
}: ListProps) {
  const qc = useQueryClient();
  const sensors = useSensors(
    // 6px move threshold — accidental drag-on-click is the most common
    // false positive on touchpads / trackpads.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Visible groups drive rendering + per-group sortable contexts.
  // Full-list groups drive what gets sent to /reorder so invisible
  // siblings get renumbered alongside the moved ones (no manual_order
  // conflicts between visible and clipped rows).
  const groups = useMemo(() => groupByParent(rows), [rows]);
  const allGroups = useMemo(() => groupByParent(allRows), [allRows]);
  const topLevel = groups.get('__top__') ?? [];

  const reorderMut = useMutation({
    mutationFn: (req: { parent_id: string | null; ids: string[] }) => reorderTodos(req),
    onSuccess: () => {
      for (const key of invalidateKeys ?? [['todos']]) {
        qc.invalidateQueries({ queryKey: key });
      }
    },
  });

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const activeRow = rows.find((r) => r.todo.id === active.id);
    const overRow = rows.find((r) => r.todo.id === over.id);
    if (!activeRow || !overRow) return;
    const activeParent = activeRow.todo.parent_id ?? null;
    const overParent = overRow.todo.parent_id ?? null;
    // Reject cross-group drops — keeps subtasks inside their parent
    // and top-level rows out of someone's child list.
    if (activeParent !== overParent) return;

    const groupKey = activeParent ?? '__top__';
    const fullGroup = allGroups.get(groupKey) ?? [];
    const oldIndex = fullGroup.findIndex((r) => r.todo.id === active.id);
    const newIndex = fullGroup.findIndex((r) => r.todo.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const newIds = arrayMove(fullGroup.map((r) => r.todo.id), oldIndex, newIndex);

    // Optimistic: stamp manual_order on the cached todos so the next
    // render reflects the drag without waiting for the refetch. The
    // backend's sort tiebreaker matches the array index 1..N.
    //
    // Cache shapes touched by this prefix: regular useQuery hits store
    // `Todo[]`; useInfiniteQuery hits store `{ pages: Todo[][],
    // pageParams: ... }`. Patch each shape in place so the drawer's
    // infinite-query (TodoListDrawer) and the home column (plain query)
    // both reflect the new order without one of them blowing up.
    const orderById = new Map(newIds.map((id, i) => [id, i + 1]));
    const patchTodo = (t: Todo) =>
      orderById.has(t.id) ? { ...t, manual_order: orderById.get(t.id)! } : t;
    qc.setQueriesData<unknown>({ queryKey: ['todos'] }, (data: unknown) => {
      if (!data) return data;
      if (Array.isArray(data)) {
        return (data as Todo[]).map(patchTodo);
      }
      if (typeof data === 'object' && 'pages' in (data as Record<string, unknown>)) {
        const inf = data as { pages: Todo[][]; pageParams: unknown[] };
        return { ...inf, pages: inf.pages.map((page) => page.map(patchTodo)) };
      }
      return data;
    });

    reorderMut.mutate({ parent_id: activeParent, ids: newIds });
  };

  // Recursive render: each row gets a sortable wrapper, and if it has
  // children (in `groups`), those children are rendered inside their
  // own SortableContext nested below. Recursion terminates at leaves
  // (no entry in `groups`). useSortable picks up the nearest context,
  // so dnd-kit only allows in-place sorts inside a single sibling
  // group at any depth.
  const renderRow = (s: SortedTodo): React.ReactNode => {
    const childRows = groups.get(s.todo.id) ?? [];
    return (
      <Fragment key={s.todo.id}>
        <SortableRow
          s={s}
          isExpanded={isExpanded}
          onToggleExpand={onToggleExpand}
          onClickRow={onClickRow}
          onToggleDone={onToggleDone}
        />
        {childRows.length > 0 ? (
          <SortableContext
            items={childRows.map((c) => c.todo.id)}
            strategy={verticalListSortingStrategy}
          >
            {childRows.map(renderRow)}
          </SortableContext>
        ) : null}
      </Fragment>
    );
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext
        items={topLevel.map((r) => r.todo.id)}
        strategy={verticalListSortingStrategy}
      >
        {topLevel.map(renderRow)}
      </SortableContext>
    </DndContext>
  );
}
