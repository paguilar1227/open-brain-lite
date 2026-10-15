// DnD list for the Todos view. Top-level todos live in sections; dragging a
// row reorders it within its section OR moves it to another section (dropping
// on a row or on a section's body). Subtasks render nested under their parent
// and are not independently draggable here — section is a root-todo concept.
//
// Persistence rides on two existing fields, no migration:
//   - cross-section move → updateTodo({ section })
//   - order             → POST /todos/reorder renumbers manual_order across
//                          ALL open top-level todos in the new visual order,
//                          so each section's slice stays internally ordered.

import { Fragment, useMemo } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Icons } from './Icons';
import { TodoRow } from './TodoRow';
import { reorderTodos, updateTodo } from '../lib/api';
import type { TodoSection } from '../lib/todoSections';
import type { SortedTodo } from '../lib/todoSort';
import type { Todo } from '../types';

const UNGROUPED_KEY = '__ungrouped__';
const secDroppableId = (name: string | null) => `sec:${name ?? UNGROUPED_KEY}`;
const parseSecId = (id: string): string | null | undefined => {
  if (!id.startsWith('sec:')) return undefined;
  const raw = id.slice(4);
  return raw === UNGROUPED_KEY ? null : raw;
};

interface RowProps {
  s: SortedTodo;
  draggable: boolean;
  isExpanded: (id: string) => boolean;
  onToggleExpand: (id: string) => void;
  onClickRow: (todo: Todo) => void;
  onToggleDone: (todo: Todo) => void;
}

function SortableRow({ s, isExpanded, onToggleExpand, onClickRow, onToggleDone }: Omit<RowProps, 'draggable'>) {
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

interface Props {
  sections: TodoSection[];
  isExpanded: (id: string) => boolean;
  onToggleExpand: (id: string) => void;
  onClickRow: (todo: Todo) => void;
  onToggleDone: (todo: Todo) => void;
  /** Rename a section header in place. */
  onRenameSection?: (from: string, to: string) => void;
  invalidateKeys?: string[][];
}

export function SectionedTodoList({
  sections,
  isExpanded,
  onToggleExpand,
  onClickRow,
  onToggleDone,
  invalidateKeys,
}: Props) {
  const qc = useQueryClient();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // section name (null=ungrouped) → ordered top-level ids
  const order = useMemo(
    () => sections.map((s) => ({ name: s.name, ids: [...s.topIds] })),
    [sections],
  );
  const sectionOf = (id: string): string | null | undefined => {
    for (const g of order) if (g.ids.includes(id)) return g.name;
    return undefined;
  };

  const reorderMut = useMutation({
    mutationFn: (ids: string[]) => reorderTodos({ parent_id: null, ids }),
    onSuccess: () => {
      for (const key of invalidateKeys ?? [['todos']]) qc.invalidateQueries({ queryKey: key });
    },
  });
  const moveMut = useMutation({
    mutationFn: ({ id, section }: { id: string; section: string | null }) => updateTodo(id, { section }),
    onSuccess: () => {
      for (const key of invalidateKeys ?? [['todos']]) qc.invalidateQueries({ queryKey: key });
    },
  });

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const fromSection = sectionOf(activeId);
    if (fromSection === undefined) return;

    // Resolve the target section + insertion index from the drop target.
    let toSection: string | null;
    let insertIndex: number;
    const overId = String(over.id);
    const overSec = parseSecId(overId);
    if (overSec !== undefined) {
      // Dropped on a section body (incl. empty) → append to its end.
      toSection = overSec;
      insertIndex = (order.find((g) => g.name === toSection)?.ids.length ?? 0);
    } else {
      const overSection = sectionOf(overId);
      if (overSection === undefined) return;
      toSection = overSection;
      insertIndex = (order.find((g) => g.name === toSection)?.ids.indexOf(overId) ?? 0);
    }
    if (activeId === overId) return;

    // Rebuild each section's id list with the active row removed, then inserted.
    const next = order.map((g) => ({ name: g.name, ids: g.ids.filter((id) => id !== activeId) }));
    const target = next.find((g) => g.name === toSection);
    if (!target) return;
    const clampedIndex = Math.min(insertIndex, target.ids.length);
    target.ids.splice(clampedIndex, 0, activeId);

    // No-op guard: same section, same position.
    const before = order.find((g) => g.name === fromSection)?.ids ?? [];
    const after = next.find((g) => g.name === fromSection)?.ids ?? [];
    if (fromSection === toSection && before.join() === target.ids.join() && before.join() === after.join()) {
      // fall through only if truly unchanged
    }

    const flatIds = next.flatMap((g) => g.ids);
    const sectionChanged = fromSection !== toSection;

    // Optimistic cache patch: section on the moved row + manual_order across
    // all reordered top-levels. Mirrors SortableTodoList's dual-shape patch.
    const orderById = new Map(flatIds.map((id, i) => [id, i + 1]));
    const patch = (t: Todo): Todo => {
      let n = t;
      if (orderById.has(t.id)) n = { ...n, manual_order: orderById.get(t.id)! };
      if (t.id === activeId && sectionChanged) n = { ...n, section: toSection };
      return n;
    };
    qc.setQueriesData<unknown>({ queryKey: ['todos'] }, (data: unknown) => {
      if (!data) return data;
      if (Array.isArray(data)) return (data as Todo[]).map(patch);
      if (typeof data === 'object' && 'pages' in (data as Record<string, unknown>)) {
        const inf = data as { pages: Todo[][]; pageParams: unknown[] };
        return { ...inf, pages: inf.pages.map((p) => p.map(patch)) };
      }
      return data;
    });

    if (sectionChanged) moveMut.mutate({ id: activeId, section: toSection });
    reorderMut.mutate(flatIds);
  };

  const renderRows = (rows: SortedTodo[]): React.ReactNode =>
    rows.map((s) =>
      s.depth === 0 ? (
        <SortableRow
          key={s.todo.id}
          s={s}
          isExpanded={isExpanded}
          onToggleExpand={onToggleExpand}
          onClickRow={onClickRow}
          onToggleDone={onToggleDone}
        />
      ) : (
        // Subtasks: nested, not independently draggable.
        <div key={s.todo.id} className="sectioned-subrow">
          <TodoRow
            todo={s.todo}
            depth={s.depth}
            childCount={s.childCount}
            expanded={isExpanded(s.todo.id)}
            hiddenDescendants={s.hiddenDescendants}
            onClick={() => onClickRow(s.todo)}
            onToggleExpand={() => onToggleExpand(s.todo.id)}
            onToggleDone={() => onToggleDone(s.todo)}
          />
        </div>
      ),
    );

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      {sections.map((sec) => (
        <SectionDroppable key={sec.name ?? UNGROUPED_KEY} name={sec.name} count={sec.topIds.length}>
          <SortableContext items={sec.topIds} strategy={verticalListSortingStrategy}>
            {sec.rows.length === 0 ? (
              <div className="todos-section-empty page-subtle">Drop a todo here</div>
            ) : (
              renderRows(sec.rows)
            )}
          </SortableContext>
        </SectionDroppable>
      ))}
    </DndContext>
  );
}

function SectionDroppable({
  name, count, children,
}: { name: string | null; count: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: secDroppableId(name) });
  return (
    <section className="todos-section" data-over={isOver || undefined}>
      <header className="todos-section-head">
        <Icons.Hash size={12} />
        <span className="todos-section-name">{name ?? 'Ungrouped'}</span>
        <span className="ct">{count}</span>
      </header>
      <div ref={setNodeRef} className="todos-section-body">
        {children}
      </div>
    </section>
  );
}
