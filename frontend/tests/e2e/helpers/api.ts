// frontend/tests/e2e/helpers/api.ts
//
// Direct REST helpers used by workflow specs for arrange/teardown — bypassing
// the UI keeps tests fast and avoids cascading UI failures during setup.
// Mirrors a slice of frontend/src/lib/api.ts but uses Node fetch and accepts
// the loose JSON shapes returned by the backend (we don't run Zod here).

const BASE = process.env.OPEN_BRAIN_BASE_URL ?? process.env.BASE_URL ?? 'http://127.0.0.1:3210';
export function installationKey(): string {
  return process.env.OPEN_BRAIN_API_KEY ?? ''; // Optional for authenticated deployments.
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(installationKey() ? { Authorization: `Bearer ${installationKey()}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'archived' | 'completed';
  pinned_at: string | null;
}

export interface Todo {
  id: string;
  content: string;
  status: 'not_started' | 'in_progress' | 'paused' | 'done';
  priority: 'p1' | 'p2' | 'p3' | null;
  project_id: string | null;
  archived: boolean;
  tags?: string[];
}

export interface ContentItem {
  id: string;
  type: 'document' | 'note';
  title: string;
  content: string | null;
  project_ids: string[];
  archived: boolean;
  processing_status: 'pending' | 'ready' | 'failed';
  tags?: string[];
}

export async function listProjects(): Promise<Project[]> {
  const data = await api<{ projects: Project[] }>('GET', '/api/v1/projects');
  return data.projects;
}

export async function findProjectByName(name: string): Promise<Project | undefined> {
  const all = await listProjects();
  return all.find((p) => p.name === name);
}

export async function listTodos(query: { project_id?: string } = {}): Promise<Todo[]> {
  const qs = query.project_id ? `?project_id=${encodeURIComponent(query.project_id)}` : '';
  const data = await api<{ todos: Todo[] }>('GET', `/api/v1/todos${qs}`);
  return data.todos;
}

export async function listContent(query: { project_id?: string; type?: string } = {}): Promise<ContentItem[]> {
  const parts: string[] = [];
  if (query.project_id) parts.push(`project_id=${encodeURIComponent(query.project_id)}`);
  if (query.type) parts.push(`type=${encodeURIComponent(query.type)}`);
  const qs = parts.length ? `?${parts.join('&')}` : '';
  const data = await api<{ items: ContentItem[] }>('GET', `/api/v1/content${qs}`);
  return data.items;
}

export async function createProject(name: string, description?: string): Promise<Project> {
  const data = await api<{ project: Project }>('POST', '/api/v1/projects', { name, description });
  return data.project;
}

export async function pinProject(id: string): Promise<void> {
  await api('POST', `/api/v1/projects/${id}/pin`);
}

export async function unpinProject(id: string): Promise<void> {
  await api('POST', `/api/v1/projects/${id}/unpin`);
}

export async function createTodo(
  content: string,
  projectId?: string | null,
  extras: { due_date?: string | null; parent_id?: string | null; tags?: string[] } = {},
): Promise<Todo> {
  const body: Record<string, unknown> = { content, project_id: projectId ?? null };
  if (extras.due_date !== undefined) body.due_date = extras.due_date;
  if (extras.parent_id !== undefined) body.parent_id = extras.parent_id;
  if (extras.tags !== undefined) body.tags = extras.tags;
  const data = await api<{ todo: Todo }>('POST', '/api/v1/todos', body);
  return data.todo;
}

export async function createNote(
  title: string,
  content: string,
  opts: { projectIds?: string[]; tags?: string[] } = {},
): Promise<{ id: string }> {
  const body = {
    type: 'note',
    title,
    content,
    project_ids: opts.projectIds ?? [],
    tags: opts.tags ?? [],
  };
  return api<{ id: string }>('POST', '/api/v1/content', body);
}

/**
 * Personal document (no project) — used by the tag-filtering specs to
 * seed an AC-3 doc fixture so document filtering is asserted alongside
 * todos/notes. Docs require multipart (`POST /api/v1/content` with a
 * `file` part) — there's no inline JSON path for type=document. The
 * Home docs query (`listContent({type:'document', project_id:'null'})`)
 * does NOT filter on processing_status, so the row is filterable
 * immediately after this 202 returns, even while embeddings process
 * in the background.
 */
export async function createDoc(
  title: string,
  content: string,
  opts: { projectIds?: string[]; tags?: string[] } = {},
): Promise<{ id: string }> {
  const form = new FormData();
  form.append('type', 'document');
  form.append('title', title);
  // Multipart handler parses these as comma-separated strings, NOT JSON
  // (see backend/src/app.ts: `body.tags?.split(',').filter(Boolean)`).
  // Sending `JSON.stringify(['a'])` here would result in tags=['["a"]'].
  if (opts.projectIds?.length) form.append('project_ids', opts.projectIds.join(','));
  if (opts.tags?.length) form.append('tags', opts.tags.join(','));
  form.append('file', new Blob([content], { type: 'text/plain' }), `${title}.txt`);
  const res = await fetch(`${BASE}/api/v1/content`, {
    method: 'POST',
    headers: { ...(installationKey() ? { Authorization: `Bearer ${installationKey()}` } : {}) },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST /api/v1/content (multipart) → ${res.status} ${text}`);
  return text ? (JSON.parse(text) as { id: string }) : (undefined as unknown as { id: string });
}

export async function updateTodo(
  id: string,
  patch: Partial<Pick<Todo, 'status' | 'priority' | 'content' | 'project_id' | 'parent_id' | 'due_date' | 'tags'>>,
): Promise<Todo> {
  const data = await api<{ todo: Todo }>('PUT', `/api/v1/todos/${id}`, patch);
  return data.todo;
}

export async function deleteProject(id: string): Promise<void> {
  await api('DELETE', `/api/v1/projects/${id}?hard=true`);
}

export async function deleteTodo(id: string): Promise<void> {
  await api('DELETE', `/api/v1/todos/${id}?hard=true`);
}

export async function deleteContent(id: string): Promise<void> {
  await api('DELETE', `/api/v1/content/${id}?hard=true`);
}
