// All personal (project-less) todos in a drawer. The Home widget shows the
// top few; this is the "see everything" escape valve.
//
// Two modes share the toolbar's SearchInput:
//   • empty input → browse: paginated personal todos rendered via
//     <SortableTodoList/> (drag-reorder + hierarchy), shared with the Home
//     column so they stay in lockstep.
//   • typing → hybrid search via useEntitySearch (the SAME path + #tag
//     typeahead as Home), scoped to personal todos. Todo hits carry the
//     full todo, so results render as full (flat, ranked) TodoRows.
//
// Detail view: clicking a row swaps the drawer body to TodoDetailDrawer
// inline (with onBack=return-to-list); list state survives.

import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Drawer } from '../primitives';
import { Icons } from '../Icons';
import { SortableTodoList } from '../SortableTodoList';
import { TodoRow } from '../TodoRow';
import { SearchInput, type SigilKind } from '../SearchInput';
import { TodoDetailDrawer } from './TodoDetailDrawer';
import { listTodos, updateTodo } from '../../lib/api';
import { toUiTodo } from '../../lib/view';
import { useEntitySearch } from '../../lib/useEntitySearch';
import { useTagSuggestions } from '../../lib/useTagSuggestions';
import { sortPersonalTodos, type TodoSortMode } from '../../lib/todoSort';
import { useTodoExpansion } from '../../lib/useTodoExpansion';
import { useTodoSortMode } from '../../lib/useTodoSortMode';
import { useInView } from '../../lib/useInView';
import { TodoSortDropdown } from '../SortDropdown';
import { matchesTagFilter, type TagFilter } from '../../lib/tagFilter';
import type { ActionDispatch, Todo } from '../../types';

interface Props {
  onClose: () => void;
  onAction: ActionDispatch;
  /** Force-set the sort mode on open (e.g. clicking the "overdue" pill on
   *  Home routes here with `initialSort='due'`). */
  initialSort?: TodoSortMode;
  /** When set, only todos matching this tag filter are shown (browse). */
  initialTagFilter?: TagFilter;
}

const PAGE_SIZE = 20;
const TODO_SIGILS: readonly SigilKind[] = ['tag'];
const NO_MENTIONS: never[] = [];

export function TodoListDrawer({ onClose, onAction, initialSort, initialTagFilter }: Props) {
  const qc = useQueryClient();
  const { isExpanded, toggle: toggleExpand } = useTodoExpansion();
  const { mode: sortMode, setMode: setSortMode } = useTodoSortMode('inbox');
  const [selected, setSelected] = useState<Todo | null>(null);

  const { query, setQuery, searchActive, rawHits, isFetching: searchFetching, error: searchError } =
    useEntitySearch({ projectId: 'null', entityTypes: ['todo'] });
  const tagSuggestions = useTagSuggestions({ scope: 'personal', type: 'todo' });

  // Todo hits carry the full todo → render full (flat, ranked) rows.
  const todoSearchRows = useMemo(() => {
    const seen = new Set<string>();
    const out: Todo[] = [];
    for (const h of rawHits) {
      if (h.type !== 'todo' || seen.has(h.todo.id)) continue;
      seen.add(h.todo.id);
      out.push(toUiTodo(h.todo));
    }
    return out;
  }, [rawHits]);

  // Apply the caller-requested initial sort once on mount.
  useEffect(() => {
    if (initialSort && initialSort !== sortMode) {
      setSortMode(initialSort);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pages = useInfiniteQuery({
    queryKey: ['todos', 'inbox', 'infinite'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listTodos({
        project_id: 'null',
        limit: PAGE_SIZE,
        ...(pageParam ? { before: pageParam } : {}),
      }),
    getNextPageParam: (lastPage) => {
      if (lastPage.length < PAGE_SIZE) return undefined; // exhausted
      return lastPage[lastPage.length - 1].created_at;
    },
  });

  const todosFlat = useMemo(
    () => (pages.data?.pages ?? []).flat().map(toUiTodo),
    [pages.data],
  );
  const todosFiltered = useMemo(
    () =>
      initialTagFilter && initialTagFilter.tags.length > 0
        ? todosFlat.filter((t) => matchesTagFilter(t, initialTagFilter))
        : todosFlat,
    [todosFlat, initialTagFilter],
  );
  const todos = sortPersonalTodos(todosFiltered, { mode: sortMode, isExpanded });

  const toggle = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Todo['status'] }) =>
      updateTodo(id, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['todos'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  const { ref: sentinelRef, inView } = useInView<HTMLDivElement>();
  useEffect(() => {
    if (inView && pages.hasNextPage && !pages.isFetchingNextPage) {
      pages.fetchNextPage();
    }
  }, [inView, pages.hasNextPage, pages.isFetchingNextPage, pages.fetchNextPage]);

  // Detail view: re-use TodoDetailDrawer with onBack so it renders a back
  // affordance; the list stays mounted so its state survives.
  if (selected) {
    return (
      <TodoDetailDrawer
        key={selected.id}
        todo={selected}
        onClose={onClose}
        onBack={() => setSelected(null)}
        onAction={onAction}
      />
    );
  }

  const title = searchActive
    ? `Todos · ${todoSearchRows.length} found`
    : `Personal todos · ${todos.length}${pages.hasNextPage ? '+' : ''}`;

  return (
    <Drawer title={title} onClose={onClose}>
      <div className="todo-list-drawer-toolbar">
        <div className="search-box">
          <Icons.Search size={13} />
          <SearchInput
            value={query}
            onChange={setQuery}
            onSubmit={() => { /* live search — no submit */ }}
            tags={tagSuggestions}
            mentions={NO_MENTIONS}
            sigils={TODO_SIGILS}
            placeholder="Search todos… try #tag"
          />
        </div>
        <TodoSortDropdown id="inbox-sort" mode={sortMode} onChange={setSortMode} />
      </div>

      {searchActive ? (
        searchError ? (
          <div className="page-subtle search-drawer-error">
            Search failed: {searchError instanceof Error ? searchError.message : String(searchError)}
          </div>
        ) : searchFetching && todoSearchRows.length === 0 ? (
          <div className="page-subtle">Searching…</div>
        ) : todoSearchRows.length === 0 ? (
          <div className="page-subtle">No todos match.</div>
        ) : (
          <div className="todo-list-drawer-rows">
            {todoSearchRows.map((t) => (
              <TodoRow
                key={t.id}
                todo={t}
                onClick={() => setSelected(t)}
                onToggleDone={() =>
                  toggle.mutate({
                    id: t.id,
                    status: t.status === 'done' ? 'not_started' : 'done',
                  })
                }
              />
            ))}
          </div>
        )
      ) : pages.error ? (
        <div className="page-subtle search-drawer-error">
          Failed to load: {pages.error instanceof Error ? pages.error.message : String(pages.error)}
        </div>
      ) : pages.isLoading ? (
        <div className="page-subtle">Loading…</div>
      ) : todos.length === 0 && !pages.hasNextPage ? (
        <div className="page-subtle">
          {initialTagFilter && initialTagFilter.tags.length > 0
            ? `No personal todos with ${initialTagFilter.tags.length === 1 ? 'tag' : 'tags'} ${initialTagFilter.tags.map((t) => `#${t}`).join(initialTagFilter.mode === 'and' ? ' AND ' : ' or ')}.`
            : 'No personal todos yet.'}
        </div>
      ) : (
        <div className="todo-list-drawer-rows">
          {todos.length === 0 && initialTagFilter && initialTagFilter.tags.length > 0 ? (
            <div className="page-subtle">Searching older entries for matches…</div>
          ) : (
            <SortableTodoList
              rows={todos}
              allRows={todos}
              isExpanded={isExpanded}
              onToggleExpand={toggleExpand}
              onClickRow={(t) => setSelected(t)}
              onToggleDone={(t) =>
                toggle.mutate({
                  id: t.id,
                  status: t.status === 'done' ? 'not_started' : 'done',
                })
              }
            />
          )}
          {pages.hasNextPage ? (
            <div ref={sentinelRef} className="todo-list-drawer-sentinel" aria-hidden="true">
              {pages.isFetchingNextPage ? <span className="page-subtle">Loading more…</span> : null}
            </div>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}
