// Tags catalog page. Scope toggle defaults to "Personal" — the global
// view shows tags only on items with no project membership. The user
// can flip to "All projects" (entire corpus) or pick a specific
// project. Clicking a tag row routes to /tags/<name>, the filtered
// content view for that tag.
//
// Backend `listTags({ scope, project_id })`:
//   - scope=personal       → personal items only
//   - scope=all (or unset) → all items
//   - project_id=<uuid>    → that project (overrides scope)

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Icons } from '../components/Icons';
import { SortDropdown } from '../components/SortDropdown';
import { listProjects, listTags } from '../lib/api';
import { toUiProjects } from '../lib/view';
import type { ActionDispatch, Route } from '../types';

type ScopeMode = 'personal' | 'all' | string;

interface Props {
  onAction: ActionDispatch;
  onRoute: (r: Route) => void;
}

export function TagsPage({ onAction, onRoute }: Props) {
  const [scope, setScope] = useState<ScopeMode>('personal');

  const projectsQ = useQuery({
    queryKey: ['projects', 'all'],
    queryFn: () => listProjects(),
  });
  const projects = useMemo(
    () => toUiProjects(projectsQ.data ?? [], []).filter((p) => p.status === 'active'),
    [projectsQ.data],
  );

  // Build the SortDropdown options from the scope state. Personal +
  // All are always present; one option per active project follows.
  const scopeModes: readonly ScopeMode[] = useMemo(
    () => ['personal', 'all', ...projects.map((p) => p.id)],
    [projects],
  );
  const scopeLabels: Record<string, string> = useMemo(() => {
    const out: Record<string, string> = {
      personal: 'Personal',
      all: 'All projects',
    };
    for (const p of projects) out[p.id] = p.name;
    return out;
  }, [projects]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['tags', 'page', scope],
    queryFn: () => {
      if (scope === 'personal') return listTags({ scope: 'personal' });
      if (scope === 'all') return listTags({ scope: 'all' });
      return listTags({ project_id: scope });
    },
  });
  const tags = data ?? [];
  const [q, setQ] = useState('');
  const filtered = tags.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()));

  // Scope-aware copy in the header.
  const scopeDescription =
    scope === 'personal'
      ? `${tags.length} tags on personal items (no project membership).`
      : scope === 'all'
        ? `${tags.length} tags across all items.`
        : `${tags.length} tags in ${scopeLabels[scope] || 'this project'}.`;

  if (error) {
    return (
      <div className="page">
        <div className="page-subtle" style={{ color: 'var(--danger)' }}>
          Failed to load tags: {error instanceof Error ? error.message : String(error)}
        </div>
      </div>
    );
  }

  return (
    <div className="page page-narrow">
      <div className="proj-hero">
        <div>
          <h1>Tags</h1>
          <p className="page-subtle">
            {scopeDescription} Renaming a tag updates every entity that uses it. Merging keeps both names searchable.
          </p>
        </div>
        <SortDropdown<ScopeMode>
          id="tags-scope"
          mode={scope}
          modes={scopeModes}
          labels={scopeLabels}
          onChange={setScope}
          label="Scope"
        />
      </div>

      <div className="todo-input-row">
        <div className="field">
          <Icons.Search />
          <input placeholder="Filter tags…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {isLoading ? (
        <div className="page-subtle">Loading tags…</div>
      ) : tags.length === 0 ? (
        <div className="page-subtle">No tags in this scope.</div>
      ) : filtered.length === 0 ? (
        <div className="page-subtle">No tags match "{q}".</div>
      ) : (
        <div className="row-list tags-list">
          {filtered.map((t) => (
            <div
              key={t.name}
              className="tag-row tag-row-clickable"
              role="button"
              tabIndex={0}
              onClick={() => onRoute({ route: 'tags', name: t.name })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onRoute({ route: 'tags', name: t.name });
                }
              }}
            >
              <span className="tag-glyph">#</span>
              <div className="tag-name strong">{t.name}</div>
              <div className="tag-counts">
                <span className="subtle">
                  {t.total} <i>total</i>
                </span>
                <span className="subtle">
                  {t.by_type.document} <i>docs</i>
                </span>
                <span className="subtle">
                  {t.by_type.note} <i>notes</i>
                </span>
                <span className="subtle">
                  {t.by_type.todo} <i>todos</i>
                </span>
              </div>
              <div className="row-flex gap-1 tag-actions" onClick={(e) => e.stopPropagation()}>
                <button className="btn btn-ghost btn-sm" onClick={() => onAction({ kind: 'confirm-rename', payload: t })}>
                  Rename
                </button>
                <button className="btn btn-ghost btn-icon">
                  <Icons.More />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
