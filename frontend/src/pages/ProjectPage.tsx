import { useMemo, useState } from 'react';
import { useMutation, useQueries, useQueryClient, useQuery } from '@tanstack/react-query';
import { Icons } from '../components/Icons';
import { Tabs, Tag } from '../components/primitives';
import { OverflowMenu } from '../components/OverflowMenu';
import { ErrorBoundary, PanelErrorFallback } from '../components/ErrorBoundary';
import { ProjectModal } from '../components/modals/ProjectModal';
import { ConfirmModal } from '../components/modals/ConfirmModal';
import {
  archiveProject,
  deleteProject,
  getProject,
  listContent,
  listProjectCounts,
  listProjects,
  listTags,
  pinProject,
  restoreProject,
  unpinProject,
} from '../lib/api';
import { toUiProject } from '../lib/view';
import { cls, fmtRel } from '../lib/util';
import type { ActionDispatch } from '../types';
import { SessionsPage } from './SessionsPage';
import { MemoryTab } from './project/MemoryTab';
import { ChatTab } from './project/ChatTab';
import { DocumentsTab } from './project/DocumentsTab';
import { NotesTab } from './project/NotesTab';
import { TodosTab } from './project/TodosTab';
import { TimelineTab } from './project/TimelineTab';
import { SearchInput, type MentionTarget, type ProjectSuggestion, type TagSuggestion } from '../components/SearchInput';

interface Props {
  projectId: string;
  onAction: ActionDispatch;
  onRoute: (r: import('../types').Route) => void;
}

type TabId = 'sessions' | 'memory' | 'chat' | 'timeline' | 'documents' | 'notes' | 'todos';

export function ProjectPage({ projectId, onAction, onRoute }: Props) {
  const [tab, setTab] = useState<TabId>('chat');
  const [searchDraft, setSearchDraft] = useState('');
  const qc = useQueryClient();
  const [projectQ, countsQ] = useQueries({
    queries: [
      { queryKey: ['project', projectId], queryFn: () => getProject(projectId) },
      { queryKey: ['project-counts'], queryFn: () => listProjectCounts() },
    ],
  });

  // Universal search data sources. Fetched globally (not project-scoped)
  // so the @-typeahead can surface docs/notes from any project — useful
  // when the user wants to mention an item that lives elsewhere to add
  // it to the active search. The submitted search is THIS project's
  // scope by default; the user can override via the drawer's scope chips
  // or via a `project:<name>` DSL predicate.
  const { data: allProjects } = useQuery({ queryKey: ['projects', 'all'], queryFn: () => listProjects() });
  const { data: tagsApi } = useQuery({ queryKey: ['tags', 'all'], queryFn: () => listTags() });
  const { data: docsApi } = useQuery({
    queryKey: ['content', 'documents', 'all'],
    queryFn: () => listContent({ type: 'document' }),
  });
  const { data: notesApi } = useQuery({
    queryKey: ['content', 'notes', 'all'],
    queryFn: () => listContent({ type: 'note' }),
  });
  const projectSuggestions = useMemo<ProjectSuggestion[]>(
    () => (allProjects ?? [])
      .filter((p) => p.status === 'active')
      .map((p) => ({ id: p.id, name: p.name })),
    [allProjects],
  );
  const tagSuggestions = useMemo<TagSuggestion[]>(
    () => (tagsApi ?? [])
      .filter((t) => t.total > 0)
      .sort((a, b) => b.total - a.total)
      .map((t) => ({ name: t.name, total: t.total })),
    [tagsApi],
  );
  const mentionTargets = useMemo<MentionTarget[]>(() => {
    const docs: MentionTarget[] = (docsApi ?? []).map((d) => ({ id: d.id, title: d.title, kind: 'document' }));
    const notes: MentionTarget[] = (notesApi ?? []).map((n) => ({ id: n.id, title: n.title, kind: 'note' }));
    return [...docs, ...notes].sort((a, b) => a.title.localeCompare(b.title));
  }, [docsApi, notesApi]);

  const submitProjectSearch = () => {
    if (!searchDraft.trim()) return;
    // Navigate to home with the query + scope; HomePage's inline search
    // takes over from there. URL is the source of truth so back-button
    // returns to this project page cleanly.
    onRoute({ route: 'home', q: searchDraft.trim(), scope: projectId });
  };

  const myCounts = countsQ.data?.find((c) => c.project_id === projectId);
  const project = useMemo(
    () => (projectQ.data ? toUiProject(projectQ.data, myCounts) : null),
    [projectQ.data, myCounts],
  );

  const togglePin = useMutation({
    mutationFn: () =>
      project?.pinned ? unpinProject(projectId) : pinProject(projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  // Archive (soft, restorable) or restore, depending on current status.
  const archiveMut = useMutation({
    mutationFn: () =>
      project?.status === 'archived' ? restoreProject(projectId) : archiveProject(projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['project-counts'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
    },
  });
  // Hard delete — permanent. On success the project is gone, so leave the page.
  const deleteMut = useMutation({
    mutationFn: () => deleteProject(projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['project-counts'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      onRoute({ route: 'projects' });
    },
  });

  // Which dialog (if any) is open for project edit / delete. The ⋯ menu's own
  // open/close + outside-click handling lives in <OverflowMenu>.
  const [dialog, setDialog] = useState<null | 'edit' | 'delete'>(null);

  if (projectQ.error || countsQ.error) {
    const err = projectQ.error || countsQ.error;
    return (
      <div className="page">
        <div className="page-subtle" style={{ color: 'var(--danger)' }}>
          Failed to load project: {err instanceof Error ? err.message : String(err)}
        </div>
      </div>
    );
  }

  if (projectQ.isLoading || !project) {
    return (
      <div className="page">
        <div className="page-subtle">Loading project…</div>
      </div>
    );
  }

  const tabs = [
    { id: 'sessions', label: 'Sessions' },
    { id: 'memory', label: 'Memory' },
    { id: 'chat', label: 'Chat', icon: <Icons.Chat />, count: 0 },
    { id: 'timeline', label: 'Timeline', icon: <Icons.Activity /> },
    { id: 'documents', label: 'Documents', icon: <Icons.Doc />, count: project.counts.docs },
    { id: 'notes', label: 'Notes', icon: <Icons.Note />, count: project.counts.notes },
    { id: 'todos', label: 'Todos', icon: <Icons.Check />, count: project.counts.todos },
  ];

  const isArchived = project.status === 'archived';

  return (
    <div className="page" style={{ paddingBottom: tab === 'chat' ? 0 : 56 }}>
      <div className="proj-hero">
        <div>
          <div className="row-flex gap-2 proj-eyebrow-row">
            <span className={cls('sb-proj-dot', project.accent, 'proj-dot-lg')}></span>
            <span className="subtle eyebrow">
              {isArchived ? 'Archived project' : 'Active project'} · created {fmtRel(project.created_at)}
            </span>
            {project.pinned ? (
              <Tag>
                <Icons.Pin size={10} />
                pinned
              </Tag>
            ) : null}
          </div>
          <h1>{project.name}</h1>
          <p className="desc">{project.desc}</p>
        </div>
        <div className="row-flex gap-2">
          <button
            className="btn"
            onClick={() => togglePin.mutate()}
            disabled={togglePin.isPending}
          >
            <Icons.Pin /> {togglePin.isPending ? '…' : project.pinned ? 'Unpin' : 'Pin'}
          </button>
          <OverflowMenu title="More project actions">
            {(close) => (
              <>
                <button role="menuitem" onClick={() => { close(); setDialog('edit'); }}>
                  <Icons.Pencil size={13} /> Edit project
                </button>
                <button
                  role="menuitem"
                  disabled={archiveMut.isPending}
                  onClick={() => { close(); archiveMut.mutate(); }}
                >
                  <Icons.ArchiveBox size={13} /> {isArchived ? 'Restore' : 'Archive'}
                </button>
                <div className="overflow-menu-sep" />
                <button
                  role="menuitem"
                  className="danger"
                  onClick={() => { close(); setDialog('delete'); }}
                >
                  <Icons.Trash size={13} /> Delete project…
                </button>
              </>
            )}
          </OverflowMenu>
          <button className="btn btn-primary" onClick={() => onAction({ kind: 'upload', payload: project })}>
            <Icons.Upload /> Add
          </button>
        </div>
      </div>

      <div className="proj-search-row">
        <div className="home-search-box">
          <Icons.Search />
          <SearchInput
            value={searchDraft}
            onChange={setSearchDraft}
            onSubmit={submitProjectSearch}
            tags={tagSuggestions}
            mentions={mentionTargets}
            projects={projectSuggestions}
            placeholder={`Search inside ${project.name}… try #tag, in:todo, @docname, -#exclude`}
          />
        </div>
      </div>

      <div className="tabs-row">
        <Tabs value={tab} onChange={id => setTab(id as TabId)} items={tabs} />
        <div className="proj-stats-strip">
          <span>
            <span className="v">{project.counts.docs}</span> docs
          </span>
          <span>
            <span className="v">{project.counts.notes}</span> notes
          </span>
          <span>
            <span className="v">
              {project.counts.done}/{project.counts.todos}
            </span>{' '}
            done
          </span>
          <span>
            last edit <span className="v">{fmtRel(project.updated_at)}</span>
          </span>
        </div>
      </div>

      <ErrorBoundary
        label={`project-tab:${tab}`}
        resetKeys={[tab, project.id]}
        fallback={(error, reset) => (
          <PanelErrorFallback error={error} reset={reset} title="This tab ran into a problem" />
        )}
      >
        {tab === 'sessions' && <SessionsPage projectId={projectId} onRoute={onRoute} />}
        {tab === 'memory' && <MemoryTab projectId={projectId} />}
        {tab === 'chat' && <ChatTab project={project} />}
        {tab === 'timeline' && <TimelineTab projectId={projectId} />}
        {tab === 'documents' && <DocumentsTab project={project} onAction={onAction} />}
        {tab === 'notes' && <NotesTab project={project} onAction={onAction} />}
        {tab === 'todos' && <TodosTab project={project} onAction={onAction} />}
      </ErrorBoundary>

      {dialog === 'edit' ? (
        <ProjectModal project={project} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'delete' ? (
        <ConfirmModal
          title={`Delete "${project.name}"?`}
          message="This permanently deletes the project and all of its documents, notes, and todos. This can't be undone — to keep it recoverable, Archive instead."
          confirmLabel="Delete forever"
          requireType={project.name}
          danger
          onClose={() => setDialog(null)}
          onConfirm={() => { setDialog(null); deleteMut.mutate(); }}
        />
      ) : null}
    </div>
  );
}
