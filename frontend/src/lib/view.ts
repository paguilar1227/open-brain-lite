// frontend/src/lib/view.ts
//
// Adapter from API shapes (@open-brain/shared) to the legacy UI shapes
// (frontend/src/types.ts) that components currently consume.
//
// This file is *temporary scaffolding*. As components are migrated to consume
// the shared schemas directly (which is the long-term goal — single source of
// truth on the wire), the adapters here disappear one by one. By the end of
// Phase 3, this whole file should be gone alongside frontend/src/types.ts.

import type {
  ActivityEvent as ApiActivity,
  ContentItem as ApiContent,
  Project as ApiProject,
  ProjectCounts,
  SearchHit as ApiSearchHit,
  Stats as ApiStats,
  Todo as ApiTodo,
} from '@open-brain/shared';
import type {
  ActivityEntityKind as UiActivityKind,
  ActivityEvent as UiActivity,
  DocumentItem as UiDocument,
  Note as UiNote,
  Project as UiProject,
  ProjectAccent,
  RetrievalPath as UiRetrievalPath,
  SearchHit as UiSearchHit,
  Stats as UiStats,
  Todo as UiTodo,
  TodoPriority as UiPriority,
} from '../types';

// Deterministic accent from project name so cards keep the same color across
// renders without storing it server-side.
const ACCENTS: ProjectAccent[] = ['magenta', 'violet', 'indigo', 'cyan', 'neutral'];
function accentFor(name: string): ProjectAccent {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return ACCENTS[Math.abs(h) % ACCENTS.length];
}

export function toUiProject(p: ApiProject, counts?: ProjectCounts): UiProject {
  return {
    id: p.id,
    name: p.name,
    desc: p.description ?? '',
    status: p.status,
    pinned: p.pinned_at !== null,
    accent: accentFor(p.name),
    created_at: p.created_at,
    updated_at: p.updated_at,
    counts: {
      docs: counts?.documents ?? 0,
      notes: counts?.notes ?? 0,
      todos: counts?.todos ?? 0,
      done: counts?.done ?? 0,
    },
  };
}

export function toUiProjects(
  projects: ApiProject[],
  counts: ProjectCounts[] = [],
): UiProject[] {
  const byId = new Map(counts.map((c) => [c.project_id, c]));
  return projects.map((p) => toUiProject(p, byId.get(p.id)));
}

const PRIORITY_MAP = { P1: 'p1', P2: 'p2', P3: 'p3' } as const;

export function toUiTodo(t: ApiTodo): UiTodo {
  return {
    id: t.id,
    title: t.content,
    status: t.status,
    priority: (t.priority ? PRIORITY_MAP[t.priority] : 'p3') as UiPriority,
    parent_id: t.parent_id,
    project_id: t.project_id,
    section: t.section,
    tags: t.tags,
    pinned: t.pinned_at !== null,
    due_at: t.due_date,
    created_at: t.created_at,
    comments: t.comment_count ?? 0,
    manual_order: t.manual_order ?? null,
  };
}

export function toUiActivity(
  e: ApiActivity,
  projectsById: Map<string, ApiProject>,
): UiActivity {
  // entity_type can be 'todo_comment'; collapse to 'todo' for the UI which
  // only knows three kinds. Project name is looked up from the first project
  // id in the array (todos always have <=1; content can have multiple — show
  // the first to keep the row a single line).
  const entity_kind: UiActivityKind =
    e.entity_type === 'document' || e.entity_type === 'note' ? e.entity_type : 'todo';
  const firstId = e.project_ids[0];
  const project = firstId ? projectsById.get(firstId)?.name ?? '—' : 'Inbox';
  return {
    id: e.entity_id + ':' + e.at, // synthetic — the API doesn't expose an event id
    kind: e.kind,
    entity_kind,
    entity_id: e.entity_id,
    title: e.title,
    project,
    project_id: firstId ?? '',
    at: e.at,
  };
}

export function toUiStats(s: ApiStats): UiStats {
  // The legacy UI Stats has `freshness.last_edit_ms` as a number of
  // milliseconds-since-edit. Convert from ISO string to ms-ago at adapter time
  // so existing render code (e.g. `Date.now() - last_edit_ms`) keeps working.
  const now = Date.now();
  const msAgo = (iso: string | null): number => {
    if (!iso) return 0;
    const t = new Date(iso).getTime();
    return Number.isFinite(t) ? Math.max(0, now - t) : 0;
  };
  return {
    counts: {
      projects: s.counts.projects.total,
      documents: s.counts.documents,
      notes: s.counts.notes,
      todos: s.counts.todos.total,
      done: s.counts.todos.done,
    },
    freshness: {
      last_ingest_ms: msAgo(s.freshness.last_ingest_at),
      last_edit_ms: msAgo(s.freshness.last_edit_at),
    },
    processing: s.processing,
    top_tags: s.top_tags,
  };
}

export function toUiNote(c: ApiContent): UiNote {
  if (c.type !== 'note') throw new Error(`expected note, got ${c.type}`);
  return {
    id: c.id,
    title: c.title,
    body: c.content ?? '',
    tags: c.tags,
    folder: c.folder,
    processing_status: c.processing_status,
    project_ids: c.project_ids,
    pinned: c.pinned_at !== null,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

// Search hits are a discriminated union on the wire (chunk vs todo).
// The legacy UI shape is flat — title, project name, excerpt, retrieval_path.
// We collapse the union here and look up project names from a passed-in map.
export function toUiSearchHit(
  h: ApiSearchHit,
  projectsById: Map<string, ApiProject>,
): UiSearchHit {
  if (h.type === 'chunk') {
    const firstProject = h.chunk.parent_project_ids[0];
    const projectName = firstProject ? projectsById.get(firstProject)?.name ?? '—' : 'Inbox';
    const path = h.retrieval_path.map((s) => s.step).filter((s) => s === 'vector' || s === 'entity' || s === 'lexical');
    return {
      id: h.chunk.id,
      entity_kind: h.chunk.parent_type,
      entity_id: h.chunk.content_item_id,
      title: h.chunk.parent_title,
      project: projectName,
      excerpt: h.chunk.content,
      tags: h.chunk.parent_tags,
      retrieval_path: (path.length ? path : ['vector']) as UiRetrievalPath[],
      score: h.final_score,
    };
  }
  // todo hit
  const projectName = h.todo.project_id
    ? projectsById.get(h.todo.project_id)?.name ?? '—'
    : 'Inbox';
  const path = h.retrieval_path.map((s) => s.step).filter((s) => s === 'vector' || s === 'entity' || s === 'lexical');
  return {
    id: h.todo.id,
    entity_kind: 'todo',
    entity_id: h.todo.id,
    title: h.todo.content,
    project: projectName,
    excerpt: `${h.todo.status.replace('_', ' ')} · ${h.todo.priority ?? '—'}`,
    tags: h.todo.tags,
    retrieval_path: (path.length ? path : ['vector']) as UiRetrievalPath[],
    score: h.final_score ?? h.similarity ?? 0,
  };
}

export function toUiDocument(c: ApiContent): UiDocument {
  if (c.type !== 'document') throw new Error(`expected document, got ${c.type}`);
  return {
    id: c.id,
    title: c.title,
    type: c.source_url ? 'url' : 'binary',
    mime: c.mime_type ?? '',
    blob_url: c.blob_url,
    download_url: c.download_url,
    source_url: c.source_url,
    size: '',
    tags: c.tags,
    processing_status: c.processing_status,
    processing_error: c.processing_error ?? undefined,
    project_ids: c.project_ids,
    pinned: c.pinned_at !== null,
    published_at: c.published_at,
    created_at: c.created_at,
    file_hash: c.file_hash,
  };
}
