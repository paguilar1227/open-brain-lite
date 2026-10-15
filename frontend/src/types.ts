import type { TagFilter } from './lib/tagFilter';
import type { TodoSortMode } from './lib/todoSort';

export type ProjectAccent = 'magenta' | 'violet' | 'indigo' | 'cyan' | 'neutral';
export type ProjectStatus = 'active' | 'archived' | 'completed';

export interface Project {
  id: string;
  name: string;
  desc: string;
  status: ProjectStatus;
  pinned: boolean;
  accent: ProjectAccent;
  created_at: string;
  updated_at: string;
  counts: { docs: number; notes: number; todos: number; done: number };
}

export type ProcessingStatus = 'pending' | 'ready' | 'failed';
export type DocumentType = 'binary' | 'url' | 'note-as-doc';

export interface DocumentItem {
  id: string;
  title: string;
  type: DocumentType;
  mime: string;
  blob_url: string | null;
  download_url: string | null;
  source_url: string | null;
  size: string;
  tags: string[];
  processing_status: ProcessingStatus;
  processing_error?: string;
  project_ids: string[];
  pinned: boolean;
  published_at: string | null;
  created_at: string;
  file_hash: string | null;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  tags: string[];
  folder: string | null;
  processing_status: ProcessingStatus;
  project_ids: string[];
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export type TodoStatus = 'not_started' | 'in_progress' | 'paused' | 'done';
export type TodoPriority = 'p1' | 'p2' | 'p3';

export interface Todo {
  id: string;
  title: string;
  status: TodoStatus;
  priority: TodoPriority;
  parent_id: string | null;
  project_id: string | null;
  section: string | null;
  tags: string[];
  pinned: boolean;
  due_at: string | null;
  created_at: string;
  comments: number;
  manual_order: number | null;
}

export interface TodoComment {
  id: string;
  todo_id: string;
  content: string;
  at: string;
}

export interface TagRow {
  name: string;
  total: number;
  by_type: { document: number; note: number; todo: number };
}

export type ActivityKind = 'ingest' | 'edit' | 'comment';
export type ActivityEntityKind = 'document' | 'note' | 'todo';

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  entity_kind: ActivityEntityKind;
  entity_id: string;
  title: string;
  project: string;
  project_id: string;
  at: string;
}

export interface Stats {
  counts: { projects: number; documents: number; notes: number; todos: number; done: number };
  freshness: { last_ingest_ms: number; last_edit_ms: number };
  processing: { pending: number; ready: number; failed: number };
  top_tags: { name: string; count: number }[];
}

// Mirrors backend RetrievalPathStep.step. `entity` = graph-expanded
// (matched via entity edges from the vector seed). `lexical` = ILIKE
// substring hit. A hit may have multiple paths if it was caught by
// multiple retrieval arms.
export type RetrievalPath = 'vector' | 'entity' | 'lexical';

export interface SearchHit {
  id: string;
  entity_kind: ActivityEntityKind;
  entity_id: string;
  title: string;
  project: string;
  excerpt: string;
  /** Tags on the parent entity — lets result rows show provenance so the
   *  user can confirm a #tag filter actually caught everything. */
  tags: string[];
  retrieval_path: RetrievalPath[];
  score: number;
}

export interface ChatCitation {
  id: string;
  num: number;
  title: string;
  path: string;
  chunk: string;
  score: number;
}

export interface ChatMessageT {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  citations?: ChatCitation[];
  timing?: { retrieval_ms: number; generation_ms: number; chunks: number };
}

export type Theme = 'dark' | 'light';
export type Density = 'regular' | 'compact';
export type SidebarMode = 'expanded' | 'collapsed' | 'hidden';
export type TodoMode = 'hierarchy' | 'flat';

export type Route =
  // q + scope seed the inline search on HomePage when present (and the
  // URL writes ?q= / ?scope= so bookmarks / back-forward replay
  // naturally). Both default to undefined = no search-mode seed.
  | { route: 'home'; q?: string; scope?: 'personal' | 'all' | string }
  | { route: 'projects'; action?: 'new' }
  | { route: 'project'; project: string }
  | { route: 'tags'; name?: string }
  // Notes browser organized by Folders (hierarchical slash-tags). `path`
  // deep-links a selected folder, `scope` the project scope.
  | { route: 'notes'; path?: string; scope?: 'personal' | 'all' | string }
  // Todos browser — a sectioned list with a scope dropdown. `scope` mirrors
  // Notes; sections are stored per todo (todo.section) and scoped naturally.
  | { route: 'todos'; scope?: 'personal' | 'all' | string }
  | { route: 'activity' }
  | { route: 'trash' };

export type RouteName = Route['route'];

export type ModalKind =
  | { kind: 'upload'; payload: Project | null }
  | { kind: 'note-edit'; payload: Note | null; projectId?: string; folder?: string | null }
  | { kind: 'doc-read'; payload: DocumentItem }
  | { kind: 'todo-detail'; payload: Todo }
  | { kind: 'bulk-confirm'; payload: { kind: string; count: number } }
  | { kind: 'confirm-rename'; payload: TagRow }
  | { kind: 'new-project' }
  | { kind: 'settings' }
  // `search` is no longer a modal — it's a route. Callers should
  // navigate via onRoute({ route: 'home', q, scope }). Kept commented
  // for grep-discoverability if you're looking for "where did the
  // search modal go" while reading old code.
  // | { kind: 'search'; payload?: { query?: string; scope?: 'personal' | 'all' | string } }
  | { kind: 'personal-todos'; sort?: TodoSortMode; tagFilter?: TagFilter }
  | { kind: 'personal-notes'; tagFilter?: TagFilter }
  | { kind: 'personal-docs'; tagFilter?: TagFilter };

export type ActionDispatch = (modal: ModalKind) => void;
