import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Icons } from '../components/Icons';
import { FilterChip } from '../components/primitives';
import { ProjectCard } from '../components/ProjectCard';
import { listProjectCounts, listProjects } from '../lib/api';
import { toUiProjects } from '../lib/view';
import { cls, fmtRel } from '../lib/util';
import type { ActionDispatch, Route } from '../types';

interface Props {
  onRoute: (r: Route) => void;
  onAction: ActionDispatch;
}

export function ProjectsPage({ onRoute, onAction }: Props) {
  const [filter, setFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [view, setView] = useState<'grid' | 'list'>('grid');

  const [projectsQ, countsQ] = useQueries({
    queries: [
      { queryKey: ['projects', 'all'], queryFn: () => listProjects() },
      { queryKey: ['project-counts'], queryFn: () => listProjectCounts() },
    ],
  });

  const all = useMemo(
    () => toUiProjects(projectsQ.data ?? [], countsQ.data ?? []),
    [projectsQ.data, countsQ.data],
  );
  const projects = all.filter((p) => filter === 'all' || p.status === filter);
  const activeCount = all.filter((p) => p.status === 'active').length;
  const archivedCount = all.filter((p) => p.status === 'archived').length;

  const error = projectsQ.error || countsQ.error;
  if (error) {
    return (
      <div className="page">
        <div className="page-subtle" style={{ color: 'var(--danger)' }}>
          Failed to load projects: {error instanceof Error ? error.message : String(error)}
        </div>
      </div>
    );
  }

  if (projectsQ.isLoading || countsQ.isLoading) {
    return (
      <div className="page">
        <div className="page-subtle">Loading…</div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="proj-hero">
        <div>
          <h1>Projects</h1>
          <p className="page-subtle">
            {activeCount} active workspaces. Drag-pin from any project menu, or archive when done — archived projects keep their citations
            but won't appear in default chat scope.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => onAction({ kind: 'new-project' })}>
          <Icons.Plus /> New project
        </button>
      </div>

      <div className="filter-bar">
        <FilterChip active={filter === 'active'} onClick={() => setFilter('active')}>
          Active <span style={{ marginLeft: 4 }}>{activeCount}</span>
        </FilterChip>
        <FilterChip active={filter === 'archived'} onClick={() => setFilter('archived')}>
          Archived <span style={{ marginLeft: 4 }}>{archivedCount}</span>
        </FilterChip>
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
          All
        </FilterChip>
        <div style={{ marginLeft: 'auto' }} className="seg-toggle">
          <button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')}>Grid</button>
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>List</button>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="page-subtle">
          {filter === 'archived' ? 'No archived projects.' : 'No projects yet — create one to get started.'}
        </div>
      ) : view === 'grid' ? (
        <div className="proj-grid">
          {projects.map((p, i) => (
            <ProjectCard
              key={p.id}
              p={p}
              size={i < 2 ? 'lg' : 'md'}
              onOpen={() => onRoute({ route: 'project', project: p.id })}
            />
          ))}
        </div>
      ) : (
        <div className="row-list">
          {projects.map((p) => (
            <div
              key={p.id}
              className="row project-row"
              onClick={() => onRoute({ route: 'project', project: p.id })}
            >
              <span className={cls('sb-proj-dot', p.accent)}></span>
              <div className="project-row-main">
                <div className="strong">{p.name}</div>
                <div className="subtle project-row-desc">{p.desc}</div>
              </div>
              <span className="subtle project-row-count">{p.counts.docs} docs</span>
              <span className="subtle project-row-count">{p.counts.notes} notes</span>
              <span className="subtle project-row-count">
                {p.counts.done}/{p.counts.todos}
              </span>
              <span className="subtle project-row-count">{fmtRel(p.updated_at)}</span>
              <button className="btn btn-ghost btn-icon" onClick={e => e.stopPropagation()}>
                <Icons.More />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
