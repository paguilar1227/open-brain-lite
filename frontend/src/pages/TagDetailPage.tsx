// /tags/<name> — every entity carrying a given tag, scope-aware.
// Mirrors the scope toggle on /tags so Personal / All / per-project
// filtering is consistent across both views. Three sections (notes,
// documents, todos) stack vertically; each row opens the appropriate
// modal or drawer when clicked.

import { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Icons } from '../components/Icons';
import { NoteRow } from '../components/NoteRow';
import { Priority, Tag } from '../components/primitives';
import { SortDropdown } from '../components/SortDropdown';
import { listContent, listProjects, listTodos } from '../lib/api';
import { toUiDocument, toUiNote, toUiProjects, toUiTodo } from '../lib/view';
import { cls, fmtRel, isOverdue } from '../lib/util';
import type { ActionDispatch, Route, Todo } from '../types';

type ScopeMode = 'personal' | 'all' | string;

interface Props {
  name: string;
  onAction: ActionDispatch;
  onRoute: (r: Route) => void;
}

export function TagDetailPage({ name, onAction, onRoute }: Props) {
  const [scope, setScope] = useState<ScopeMode>('personal');

  // Project list for the scope dropdown (active projects only).
  const projectsQ = useQuery({
    queryKey: ['projects', 'all'],
    queryFn: () => listProjects(),
  });
  const projects = useMemo(
    () => toUiProjects(projectsQ.data ?? [], []).filter((p) => p.status === 'active'),
    [projectsQ.data],
  );
  const scopeModes: readonly ScopeMode[] = useMemo(
    () => ['personal', 'all', ...projects.map((p) => p.id)],
    [projects],
  );
  const scopeLabels: Record<string, string> = useMemo(() => {
    const out: Record<string, string> = { personal: 'Personal', all: 'All projects' };
    for (const p of projects) out[p.id] = p.name;
    return out;
  }, [projects]);

  // Three parallel list queries, one per entity type. Each gets the
  // tag filter, plus a project-or-scope filter that mirrors what
  // /tags would apply. The list endpoints accept either project_id
  // (UUID or 'null' sentinel) or no filter ("all").
  const projectFilter =
    scope === 'personal' ? 'null'
      : scope === 'all' ? undefined
        : scope; // specific project UUID

  const queries = useQueries({
    queries: [
      {
        queryKey: ['tag-detail', name, scope, 'note'],
        queryFn: () =>
          listContent({ type: 'note', tags: name, ...(projectFilter ? { project_id: projectFilter } : {}) }),
      },
      {
        queryKey: ['tag-detail', name, scope, 'document'],
        queryFn: () =>
          listContent({ type: 'document', tags: name, ...(projectFilter ? { project_id: projectFilter } : {}) }),
      },
      {
        queryKey: ['tag-detail', name, scope, 'todo'],
        queryFn: () =>
          listTodos({ tags: name, ...(projectFilter ? { project_id: projectFilter } : {}) }),
      },
    ],
  });
  const [notesQ, docsQ, todosQ] = queries;

  const notes = (notesQ.data ?? []).map(toUiNote);
  const documents = (docsQ.data ?? []).map(toUiDocument);
  const todos = (todosQ.data ?? []).map(toUiTodo);

  const total = notes.length + documents.length + todos.length;
  const isLoading = queries.some((q) => q.isLoading);
  const error = queries.find((q) => q.error)?.error;

  const renderTodoRow = (t: Todo) => (
    <div
      key={t.id}
      className={cls('tag-detail-row', t.status === 'done' && 'done')}
      role="button"
      tabIndex={0}
      onClick={() => onAction({ kind: 'todo-detail', payload: t })}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onAction({ kind: 'todo-detail', payload: t });
        }
      }}
    >
      <span className="nm">{t.title}</span>
      {t.due_at ? (
        <span className={isOverdue(t.due_at) && t.status !== 'done' ? 'due-overdue' : 'due-soon'}>
          due {fmtRel(t.due_at)}
        </span>
      ) : null}
      <Priority p={t.priority} />
      <span className="subtle">{fmtRel(t.created_at)}</span>
    </div>
  );

  if (error) {
    return (
      <div className="page">
        <div className="page-subtle" style={{ color: 'var(--danger)' }}>
          Failed to load tag: {error instanceof Error ? error.message : String(error)}
        </div>
      </div>
    );
  }

  return (
    <div className="page page-narrow">
      <div className="proj-hero">
        <div>
          <div className="row-flex gap-2" style={{ alignItems: 'baseline' }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => onRoute({ route: 'tags' })}
              aria-label="Back to tags"
            >
              <Icons.ChevronLeft size={11} /> Tags
            </button>
          </div>
          <h1 style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="tag-glyph" style={{ fontSize: '0.6em', opacity: 0.6 }}>#</span>
            {name}
          </h1>
          <p className="page-subtle">
            {isLoading ? 'Loading…' : `${total} item${total === 1 ? '' : 's'} carry this tag in scope.`}
          </p>
        </div>
        <SortDropdown<ScopeMode>
          id="tag-detail-scope"
          mode={scope}
          modes={scopeModes}
          labels={scopeLabels}
          onChange={setScope}
          label="Scope"
        />
      </div>

      {isLoading ? null : total === 0 ? (
        <div className="page-subtle">Nothing tagged <Tag>{name}</Tag> in this scope.</div>
      ) : (
        <>
          {notes.length > 0 ? (
            <section className="tag-detail-section">
              <h2 className="tag-detail-section-h">Notes <span className="ct">{notes.length}</span></h2>
              <div className="tag-detail-list">
                {notes.map((n) => (
                  <NoteRow
                    key={n.id}
                    note={n}
                    folder={n.folder}
                    onClick={() => onAction({ kind: 'note-edit', payload: n })}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {documents.length > 0 ? (
            <section className="tag-detail-section">
              <h2 className="tag-detail-section-h">Documents <span className="ct">{documents.length}</span></h2>
              <div className="tag-detail-list">
                {documents.map((d) => (
                  <div
                    key={d.id}
                    className="tag-detail-row"
                    role="button"
                    tabIndex={0}
                    onClick={() => onAction({ kind: 'doc-read', payload: d })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onAction({ kind: 'doc-read', payload: d });
                      }
                    }}
                  >
                    <span className="nm">{d.title}</span>
                    <span className="subtle">{fmtRel(d.created_at)}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {todos.length > 0 ? (
            <section className="tag-detail-section">
              <h2 className="tag-detail-section-h">Todos <span className="ct">{todos.length}</span></h2>
              <div className="tag-detail-list">{todos.map(renderTodoRow)}</div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
