// Todos browser — a dedicated, sectioned list of todos with a scope dropdown
// (Personal / All / project), the same shell idiom as the Notes view.
//
// - Group: top-level todos bucket by their durable `section` field; subtasks
//   nest under their parent; completed top-levels collapse into one Done group
//   at the very bottom (struck through).
// - Arrange: drag a row to reorder it or move it to another section
//   (SectionedTodoList → todo.section + manual_order, both already in the DB).
// - Lens: sort (Smart / Due / Priority / Manual / Recent / Alphabetical) +
//   tag and priority filter chips + the same hybrid SearchInput as Home.
//
// Sort defaults to Manual so a dragged arrangement is what you see.

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Icons } from '../components/Icons';
import { SortDropdown, TodoSortDropdown } from '../components/SortDropdown';
import { SearchInput, type SigilKind } from '../components/SearchInput';
import { TodoRow } from '../components/TodoRow';
import { SectionedTodoList } from '../components/SectionedTodoList';
import { HomeTagFilter } from '../components/HomeTagFilter';
import { listProjects, listTodos, updateTodo } from '../lib/api';
import { toUiProjects, toUiTodo } from '../lib/view';
import { useEntitySearch } from '../lib/useEntitySearch';
import { useTagSuggestions } from '../lib/useTagSuggestions';
import { useTodoExpansion } from '../lib/useTodoExpansion';
import { groupTodosBySection } from '../lib/todoSections';
import { type TodoSortMode } from '../lib/todoSort';
import { matchesTagFilter, EMPTY_FILTER, type TagFilter } from '../lib/tagFilter';
import { cls } from '../lib/util';
import type { ActionDispatch, Todo, TodoPriority } from '../types';

type ScopeMode = 'personal' | 'all' | string;

interface Props {
  onAction: ActionDispatch;
  initialScope?: ScopeMode;
}

const TODO_SIGILS: readonly SigilKind[] = ['tag'];
const NO_MENTIONS: never[] = [];
const PRIORITIES: TodoPriority[] = ['p1', 'p2', 'p3'];

const scopeToProjectId = (scope: ScopeMode): 'null' | string | undefined =>
  scope === 'personal' ? 'null' : scope === 'all' ? undefined : scope;

export function TodosPage({ onAction, initialScope }: Props) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<ScopeMode>(initialScope ?? 'personal');
  const [sortMode, setSortMode] = useState<TodoSortMode>('manual');
  // Tag filter reuses the Home dashboard's HomeTagFilter (chip row + overflow
  // popover + AND/OR + Clear). Priority stays as its own chip group below.
  const [tagFilter, setTagFilter] = useState<TagFilter>(EMPTY_FILTER);
  const [prioSel, setPrioSel] = useState<Set<TodoPriority>>(() => new Set());
  const [extraSections, setExtraSections] = useState<string[]>([]);
  const [addingSection, setAddingSection] = useState(false);
  const [sectionDraft, setSectionDraft] = useState('');
  const [doneOpen, setDoneOpen] = useState(false);
  const { isExpanded, toggle: toggleExpand } = useTodoExpansion();

  // --- scope dropdown (Personal / All / each active project) ---
  const projectsQ = useQuery({ queryKey: ['projects', 'all'], queryFn: () => listProjects() });
  const projects = useMemo(
    () => toUiProjects(projectsQ.data ?? [], []).filter((p) => p.status === 'active'),
    [projectsQ.data],
  );
  const scopeModes: readonly ScopeMode[] = useMemo(
    () => ['personal', 'all', ...projects.map((p) => p.id)],
    [projects],
  );
  const scopeLabels = useMemo(() => {
    const out: Record<string, string> = { personal: 'Personal', all: 'All projects' };
    for (const p of projects) out[p.id] = p.name;
    return out;
  }, [projects]);

  const projectId = scopeToProjectId(scope);

  // --- all todos in scope ---
  const todosQ = useQuery({
    queryKey: ['todos', 'todos-view', scope],
    queryFn: () => listTodos(projectId === undefined ? {} : { project_id: projectId }),
  });
  const allTodos: Todo[] = useMemo(() => (todosQ.data ?? []).map(toUiTodo), [todosQ.data]);

  // --- search (hybrid) — flat results, bypasses sections ---
  const { query, setQuery, searchActive, rawHits } = useEntitySearch({ projectId, entityTypes: ['todo'] });
  const tagSuggestions = useTagSuggestions(
    scope === 'personal' ? { scope: 'personal', type: 'todo' }
      : scope === 'all' ? { type: 'todo' }
        : { project_id: scope, type: 'todo' },
  );
  const searchRows = useMemo(() => {
    const seen = new Set<string>();
    const out: Todo[] = [];
    for (const h of rawHits) {
      if (h.type !== 'todo' || seen.has(h.todo.id)) continue;
      seen.add(h.todo.id);
      out.push(toUiTodo(h.todo));
    }
    return out;
  }, [rawHits]);

  // --- filters apply to a todo's ROOT (tags/priority are root-only); a
  //     subtask is kept iff its top-level ancestor is kept. ---
  const byId = useMemo(() => new Map(allTodos.map((t) => [t.id, t])), [allTodos]);
  const rootOf = (t: Todo): Todo => {
    let cur = t;
    while (cur.parent_id && byId.get(cur.parent_id)) cur = byId.get(cur.parent_id)!;
    return cur;
  };
  const filtered = useMemo(() => {
    if (tagFilter.tags.length === 0 && prioSel.size === 0) return allTodos;
    return allTodos.filter((t) => {
      const root = rootOf(t);
      return matchesTagFilter(root, tagFilter) && (prioSel.size === 0 || prioSel.has(root.priority));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTodos, tagFilter, prioSel]);

  const grouped = useMemo(
    () => groupTodosBySection(filtered, { mode: sortMode, isExpanded, extraSections }),
    [filtered, sortMode, isExpanded, extraSections],
  );

  // Tag options for HomeTagFilter — distinct ROOT tags in scope with usage
  // counts (filters apply to a todo's root, so subtask-only tags are excluded).
  const tagOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of allTodos) if (!t.parent_id) for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, total]) => ({ name, total }));
  }, [allTodos]);

  const toggleDone = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Todo['status'] }) => updateTodo(id, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['todos'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  const openTodo = (t: Todo) => onAction({ kind: 'todo-detail', payload: t });
  const onToggleDone = (t: Todo) =>
    toggleDone.mutate({ id: t.id, status: t.status === 'done' ? 'not_started' : 'done' });

  const commitSection = () => {
    const name = sectionDraft.trim();
    setAddingSection(false);
    setSectionDraft('');
    if (!name) return;
    setExtraSections((s) => (s.includes(name) ? s : [...s, name]));
  };

  const toggleSet = <T,>(set: Set<T>, v: T): Set<T> => {
    const n = new Set(set);
    n.has(v) ? n.delete(v) : n.add(v);
    return n;
  };

  const openCount = grouped.sections.reduce((n, s) => n + s.topIds.length, 0);

  return (
    <div className="todos-view">
      <div className="notes-view-head">
        <div>
          <h1>Todos</h1>
          <p className="page-subtle">{openCount} open · {grouped.done.length} done</p>
        </div>
        <SortDropdown<ScopeMode>
          id="todos-scope"
          mode={scope}
          modes={scopeModes}
          labels={scopeLabels}
          onChange={(s) => { setScope(s); setExtraSections([]); }}
          label="Scope"
        />
      </div>

      <div className="todos-toolbar">
        <div className="search-box">
          <Icons.Search size={13} />
          <SearchInput
            value={query}
            onChange={setQuery}
            onSubmit={() => { /* live */ }}
            tags={tagSuggestions}
            mentions={NO_MENTIONS}
            sigils={TODO_SIGILS}
            placeholder="Search todos… try #tag"
          />
        </div>
        <TodoSortDropdown id="todos-sort" mode={sortMode} onChange={setSortMode} />
        {addingSection ? (
          <input
            className="folder-field-input todos-section-input"
            autoFocus
            placeholder="Section name"
            value={sectionDraft}
            onChange={(e) => setSectionDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitSection(); }
              if (e.key === 'Escape') { setAddingSection(false); setSectionDraft(''); }
            }}
            onBlur={commitSection}
          />
        ) : (
          <button className="btn btn-ghost btn-sm" onClick={() => setAddingSection(true)}>
            <Icons.Plus size={12} /> Add section
          </button>
        )}
      </div>

      {allTodos.length > 0 && (
        <div className="todos-filters">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              type="button"
              className={cls('filter-chip', prioSel.has(p) && 'active')}
              onClick={() => setPrioSel((s) => toggleSet(s, p))}
            >
              {p.toUpperCase()}
            </button>
          ))}
          {prioSel.size > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPrioSel(new Set())}>
              Clear priority
            </button>
          )}
        </div>
      )}

      {(tagOptions.length > 0 || tagFilter.tags.length > 0) && (
        <div className="view-tagbar">
          <HomeTagFilter options={tagOptions} filter={tagFilter} onChange={setTagFilter} />
        </div>
      )}

      <div className="todos-body">
        {todosQ.isLoading ? (
          <div className="page-subtle">Loading…</div>
        ) : searchActive ? (
          searchRows.length === 0 ? (
            <div className="page-subtle">No todos match.</div>
          ) : (
            <div className="todos-search-rows">
              {searchRows.map((t) => (
                <TodoRow key={t.id} todo={t} onClick={() => openTodo(t)} onToggleDone={() => onToggleDone(t)} />
              ))}
            </div>
          )
        ) : allTodos.length === 0 ? (
          <div className="page-subtle">No todos in this scope yet.</div>
        ) : (
          <>
            <SectionedTodoList
              sections={grouped.sections}
              isExpanded={isExpanded}
              onToggleExpand={toggleExpand}
              onClickRow={openTodo}
              onToggleDone={onToggleDone}
              invalidateKeys={[['todos'], ['stats']]}
            />
            {grouped.done.length > 0 && (
              <section className="todos-section todos-done">
                <button
                  className="todos-section-head todos-done-head"
                  onClick={() => setDoneOpen((v) => !v)}
                  aria-expanded={doneOpen}
                >
                  <Icons.Check size={12} />
                  <span className="todos-section-name">Done</span>
                  <span className="ct">{grouped.done.filter((r) => r.depth === 0).length}</span>
                  <Icons.ChevronRight size={12} className={cls('todos-done-chev', doneOpen && 'open')} />
                </button>
                {doneOpen && (
                  <div className="todos-section-body">
                    {grouped.done.map((r) => (
                      <TodoRow
                        key={r.todo.id}
                        todo={r.todo}
                        depth={r.depth}
                        onClick={() => openTodo(r.todo)}
                        onToggleDone={() => onToggleDone(r.todo)}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
