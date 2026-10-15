// Cmd-K palette. Two query keys: a cached list of active projects (shared
// with sidebar/App), and a debounced search query that fires once the user
// has typed ≥2 chars. The static "Actions" group is purely client-side.
//
// Projects are run through `toUiProjects` so we get the UI's `accent`,
// `pinned`, `desc` shape that the rest of the app already uses.
//
// Result interactions:
//   - Project rows route into the project detail page.
//   - Chunk hits route into the chunk's first project (so the user lands
//     on the surface that owns the document/note). We don't open the
//     reader drawer directly because the palette doesn't have access to
//     the full DocumentItem shape — it has chunk-level data only.
//   - Todo hits open the TodoDetailDrawer through `onAction`, since we
//     have the full Todo on the wire.
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Icons } from './Icons';
import { search } from '../lib/api';
import { useProjects } from '../lib/useProjects';
import { toUiProjects, toUiTodo } from '../lib/view';
import { cls } from '../lib/util';
import type { ActionDispatch, Route, Theme } from '../types';

interface PaletteItem {
  kind: 'project' | 'document' | 'note' | 'todo' | 'action';
  id: string;
  title: string;
  sub: string;
  icon: ReactNode;
  action: () => void;
}

interface PaletteGroup {
  name: string;
  items: PaletteItem[];
}

interface Props {
  onClose: () => void;
  onRoute: (r: Route) => void;
  onAction: ActionDispatch;
  onToggleTheme: () => void;
  theme: Theme;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function CommandPalette({ onClose, onRoute, onAction, onToggleTheme, theme }: Props) {
  const [q, setQ] = useState('');
  const debouncedQ = useDebounced(q.trim(), 180);

  const { data: apiProjects = [] } = useProjects();
  const projects = useMemo(() => toUiProjects(apiProjects), [apiProjects]);

  const { data: hits = [] } = useQuery({
    queryKey: ['search', 'cmdk', debouncedQ],
    queryFn: () => search({ query: debouncedQ, limit: 8 }),
    enabled: debouncedQ.length >= 2,
  });

  const groups: PaletteGroup[] = useMemo(() => {
    const lower = q.toLowerCase();
    const filtProjects = projects.filter(
      (p) => p.status === 'active' && (!q || p.name.toLowerCase().includes(lower) || p.desc.toLowerCase().includes(lower)),
    );
    const projItems: PaletteItem[] = filtProjects.slice(0, 5).map((p) => ({
      kind: 'project',
      id: p.id,
      title: p.name,
      sub: p.desc || `project · ${p.status}`,
      icon: <span className={cls('sb-proj-dot', p.accent)} />,
      action: () => onRoute({ route: 'project', project: p.id }),
    }));

    const docItems: PaletteItem[] = [];
    const noteItems: PaletteItem[] = [];
    const todoItems: PaletteItem[] = [];
    for (const h of hits) {
      if (h.type === 'chunk') {
        const isNote = h.chunk.parent_type === 'note';
        const target = isNote ? noteItems : docItems;
        const projectId = h.chunk.parent_project_ids[0] ?? null;
        target.push({
          kind: isNote ? 'note' : 'document',
          id: h.chunk.id,
          title: h.chunk.parent_title,
          sub: h.chunk.content.replace(/\s+/g, ' ').slice(0, 80) + (h.chunk.content.length > 80 ? '…' : ''),
          icon: isNote ? <Icons.Note size={13} /> : <Icons.Doc size={13} />,
          action: () => projectId ? onRoute({ route: 'project', project: projectId }) : onRoute({ route: 'home' }),
        });
      } else {
        const t = toUiTodo(h.todo);
        todoItems.push({
          kind: 'todo',
          id: t.id,
          title: t.title,
          sub: `todo · ${t.status} · ${t.priority}`,
          icon: <Icons.Check size={13} />,
          action: () => onAction({ kind: 'todo-detail', payload: t }),
        });
      }
    }

    const cmds: PaletteItem[] = [
      { kind: 'action', id: 'new-project', title: 'Create new project', sub: 'open project modal', icon: <Icons.Plus size={13} />, action: () => onAction({ kind: 'new-project' }) },
      { kind: 'action', id: 'upload', title: 'Upload file…', sub: 'in current project', icon: <Icons.Upload size={13} />, action: () => onAction({ kind: 'upload', payload: null }) },
      { kind: 'action', id: 'new-note', title: 'New note', sub: 'in current project', icon: <Icons.Note size={13} />, action: () => onAction({ kind: 'note-edit', payload: null }) },
      { kind: 'action', id: 'open-search', title: 'Search…', sub: 'go to home and focus the search bar', icon: <Icons.Search />, action: () => onRoute({ route: 'home' }) },
      { kind: 'action', id: 'go-home', title: 'Go to Home', sub: 'shortcut · G then H', icon: <Icons.Home size={13} />, action: () => onRoute({ route: 'home' }) },
      { kind: 'action', id: 'go-activity', title: 'Go to Activity', sub: 'shortcut · G then A', icon: <Icons.Activity size={13} />, action: () => onRoute({ route: 'activity' }) },
      { kind: 'action', id: 'go-tags', title: 'Go to Tags', sub: 'shortcut · G then T', icon: <Icons.Tag size={13} />, action: () => onRoute({ route: 'tags' }) },
      { kind: 'action', id: 'toggle-theme', title: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`, sub: 'shortcut · ⌘⇧L', icon: <Icons.Moon size={13} />, action: () => onToggleTheme() },
    ];
    const filt = (xs: PaletteItem[]) =>
      q ? xs.filter((x) => x.title.toLowerCase().includes(lower) || x.sub.toLowerCase().includes(lower)) : xs;

    return [
      { name: 'Projects', items: projItems },
      { name: 'Documents', items: docItems.slice(0, 4) },
      { name: 'Notes', items: noteItems.slice(0, 4) },
      { name: 'Todos', items: todoItems.slice(0, 4) },
      { name: 'Actions', items: filt(cmds) },
    ].filter((g) => g.items.length);
  }, [q, projects, hits, theme, onRoute, onAction, onToggleTheme]);

  return (
    <div
      className="cmdk-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cmdk">
        <div className="cmdk-input">
          <Icons.Search />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search projects, documents, notes, todos, or run a command…"
            autoFocus
          />
          <span className="kbd">esc</span>
        </div>
        <div className="cmdk-results">
          {groups.length === 0 ? (
            <div className="page-subtle" style={{ padding: '12px 16px' }}>
              No matches.
            </div>
          ) : (
            groups.map((g, gi) => (
              <Fragment key={g.name}>
                <div className="cmdk-group-h">{g.name}</div>
                {g.items.map((it, i) => (
                  <div
                    key={it.id}
                    className={cls('cmdk-row', i === 0 && gi === 0 && 'active')}
                    onClick={() => {
                      it.action();
                      onClose();
                    }}
                  >
                    <div className="icb">{it.icon}</div>
                    <div>
                      <div className="nm">{it.title}</div>
                      <div className="sub">{it.sub}</div>
                    </div>
                    <Icons.ChevronRight size={11} style={{ color: 'var(--fg-subtle)' }} />
                  </div>
                ))}
              </Fragment>
            ))
          )}
        </div>
        <div className="cmdk-foot">
          <span>
            <span className="kbd">↑↓</span> navigate
          </span>
          <span>
            <span className="kbd">↵</span> open
          </span>
          <span style={{ marginLeft: 'auto' }}>
            {debouncedQ.length >= 2 ? `${hits.length} results` : 'type to search'}
          </span>
        </div>
      </div>
    </div>
  );
}
