// frontend/src/lib/api.ts
//
// Typed fetch client for the Open Brain REST API. All responses are validated
// against shared Zod schemas (`@open-brain/shared`) — bad data fails loud.
//
// Auth: dual-mode.
//   - Local dev: VITE_OPEN_BRAIN_API_KEY → Bearer header; matches the
//     backend's stub-mode key out of the box.
//   - Production: same Bearer header is sent (with the placeholder fallback,
//     which the backend rejects), but the request also carries the Easy
//     Auth session cookie (`credentials: 'include'`). The backend's
//     `/api/*` middleware accepts EITHER signal, so the placeholder Bearer
//     is harmless and the cookie+principal-header path is what actually
//     authenticates browser calls in prod.

import {
  ActivityListQuerySchema,
  ActivityListResponseSchema,
  ContentGetResponseSchema,
  ContentListQuerySchema,
  ContentListResponseSchema,
  ContentCreateResponseSchema,
  ContentEditBodyRequestSchema,
  ContentUpdateRequestSchema,
  NoteCreateRequestSchema,
  ProjectCountsListResponseSchema,
  ProjectCreateRequestSchema,
  ProjectUpdateRequestSchema,
  ProjectGetResponseSchema,
  ProjectListQuerySchema,
  ProjectListResponseSchema,
  TodoCommentCreateRequestSchema,
  TodoCreateRequestSchema,
  TodoGetResponseSchema,
  TodoUpdateRequestSchema,
  TodoReorderRequestSchema,
  TodoReorderResponseSchema,
  RagRequestSchema,
  RagResponseSchema,
  SearchRequestSchema,
  SearchResponseSchema,
  StatsSchema,
  TagListResponseSchema,
  TagRenameRequestSchema,
  TagRenameResponseSchema,
  type TagRenameResponse,
  TodoCommentListResponseSchema,
  TodoListQuerySchema,
  TodoListResponseSchema,
  type ActivityEvent,
  type ActivityListQuery,
  type ContentCreateResponse,
  type ContentItem,
  type ContentListQuery,
  type ContentUpdateRequest,
  type NoteCreateRequest,
  type Project,
  type ProjectCounts,
  type ProjectCreateRequest,
  type ProjectUpdateRequest,
  type ProjectListQuery,
  type RagRequest,
  type RagResponse,
  type SearchHit,
  type SearchRequest,
  type TodoCommentCreateRequest,
  type TodoCreateRequest,
  type TodoUpdateRequest,
  type TodoReorderRequest,
  type TodoReorderResponse,
  type Stats,
  type Tag,
  type Todo,
  type TodoComment,
  type TodoListQuery,
} from '@open-brain/shared';
import { z } from 'zod';

const BASE = '/api/v1';
const TOKEN_STORAGE_KEY = 'ob.api_key';

// Resolve the Bearer key the UI uses for /api/v1/* calls. Two sources:
//   - Local dev: `VITE_OPEN_BRAIN_API_KEY` from the build env (matches the
//     backend's stub-mode default).
//   - Production: the `/api/auth/token` exchange, which sits behind Easy
//     Auth — the platform has already validated the user's cookie session
//     by the time that endpoint runs, and the response carries the long-
//     lived Bearer key plus the Entra principal id/name. We cache it in
//     localStorage so the next page load skips the round-trip.
//
// `bootAuth()` is called once before React mounts (see main.tsx). If the
// session has expired, the fetch comes back as an opaque redirect and we
// hard-navigate to the AAD login URL with `post_login_redirect_uri` set
// to the current page so the user lands back where they were.
let API_KEY: string =
  import.meta.env.VITE_OPEN_BRAIN_API_KEY ??
  (typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_STORAGE_KEY) ?? '' : '') ??
  '';

// Drop the cached Bearer key and end the session. In prod this kicks
// the user through Easy Auth's /.auth/logout endpoint, which clears the
// Entra cookie and redirects back to the SPA root (where bootAuth will
// re-trigger the AAD login). In dev there's no cookie session — we just
// reload so any in-memory state resets.
export function logout(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  window.location.reload();
}

export async function bootAuth(): Promise<void> {
  if (!API_KEY) throw new Error('LOCAL_LOGIN_REQUIRED');
  const response = await fetch('/api/v1/projects', { headers: { Authorization: `Bearer ${API_KEY}` } });
  if (response.status === 401) {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    API_KEY = '';
    throw new Error('LOCAL_LOGIN_REQUIRED');
  }
  if (!response.ok) throw new Error(`Connection failed: HTTP ${response.status}`);
}

export function signIn(apiKey: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, apiKey.trim());
  window.location.reload();
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${API_KEY}`);
  if (init.body && !headers.has('Content-Type') && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' });
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg =
      typeof json === 'object' && json && 'error' in json
        ? String((json as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, json);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(res.status, `Response failed validation: ${parsed.error.message}`, json);
  }
  return parsed.data;
}

// For mutations whose response shape we don't need to validate against —
// pin/unpin/restore/delete return `{ok: true}`-ish envelopes that vary slightly
// across endpoints. The frontend only cares whether the call succeeded.
async function fetchOk(path: string, init: RequestInit = {}): Promise<void> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${API_KEY}`);
  if (init.body && !headers.has('Content-Type') && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' });
  if (!res.ok) {
    const text = await res.text();
    let msg = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text);
      if (typeof j?.error === 'string') msg = j.error;
    } catch { /* leave msg as HTTP code */ }
    throw new ApiError(res.status, msg);
  }
}

function toQueryString(params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v.join(','))}`);
    } else {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

// ---------------- Stats ----------------

export async function getStats(projectId?: string): Promise<Stats> {
  const qs = toQueryString({ project_id: projectId });
  return request(`/stats${qs}`, StatsSchema);
}

// ---------------- Projects ----------------

export async function listProjects(query: ProjectListQuery = {}): Promise<Project[]> {
  const parsed = ProjectListQuerySchema.parse(query);
  const qs = toQueryString(parsed);
  const data = await request(`/projects${qs}`, ProjectListResponseSchema);
  return data.projects;
}

export async function listProjectCounts(): Promise<ProjectCounts[]> {
  const data = await request('/projects/counts', ProjectCountsListResponseSchema);
  return data.counts;
}

export async function getProject(id: string): Promise<Project> {
  const data = await request(`/projects/${id}`, ProjectGetResponseSchema);
  return data.project;
}

export async function createProject(req: ProjectCreateRequest): Promise<Project> {
  const body = JSON.stringify(ProjectCreateRequestSchema.parse(req));
  const data = await request('/projects', ProjectGetResponseSchema, { method: 'POST', body });
  return data.project;
}

export async function updateProject(id: string, req: ProjectUpdateRequest): Promise<Project> {
  const body = JSON.stringify(ProjectUpdateRequestSchema.parse(req));
  const data = await request(`/projects/${id}`, ProjectGetResponseSchema, { method: 'PUT', body });
  return data.project;
}
// Soft delete (archive) is `archiveProject` (DELETE with no flag). This is the
// HARD delete — `?hard=true` permanently removes the project and its content.
export async function deleteProject(id: string): Promise<void> {
  await fetchOk(`/projects/${id}?hard=true`, { method: 'DELETE' });
}
export async function archiveProject(id: string): Promise<void> {
  await fetchOk(`/projects/${id}`, { method: 'DELETE' });
}
export async function restoreProject(id: string): Promise<void> {
  await fetchOk(`/projects/${id}/restore`, { method: 'POST' });
}
export async function pinProject(id: string): Promise<void> {
  await fetchOk(`/projects/${id}/pin`, { method: 'POST' });
}
export async function unpinProject(id: string): Promise<void> {
  await fetchOk(`/projects/${id}/unpin`, { method: 'POST' });
}

// ---------------- Todos ----------------

export async function listTodos(query: TodoListQuery = {}): Promise<Todo[]> {
  const parsed = TodoListQuerySchema.parse(query);
  const qs = toQueryString(parsed);
  const data = await request(`/todos${qs}`, TodoListResponseSchema);
  return data.todos;
}

export async function getTodo(id: string): Promise<Todo> {
  const data = await request(`/todos/${id}`, TodoGetResponseSchema);
  return data.todo;
}

export async function createTodo(req: TodoCreateRequest): Promise<Todo> {
  const body = JSON.stringify(TodoCreateRequestSchema.parse(req));
  const data = await request('/todos', TodoGetResponseSchema, { method: 'POST', body });
  return data.todo;
}

export async function updateTodo(id: string, patch: TodoUpdateRequest): Promise<Todo> {
  const body = JSON.stringify(TodoUpdateRequestSchema.parse(patch));
  const data = await request(`/todos/${id}`, TodoGetResponseSchema, { method: 'PUT', body });
  return data.todo;
}

export async function archiveTodo(id: string): Promise<void> {
  await fetchOk(`/todos/${id}`, { method: 'DELETE' });
}
export async function restoreTodo(id: string): Promise<void> {
  await fetchOk(`/todos/${id}/restore`, { method: 'POST' });
}
export async function pinTodo(id: string): Promise<void> {
  await fetchOk(`/todos/${id}/pin`, { method: 'POST' });
}
export async function unpinTodo(id: string): Promise<void> {
  await fetchOk(`/todos/${id}/unpin`, { method: 'POST' });
}

// Persist a manual ordering for a sibling group of todos. The `ids`
// array IS the new order — position 1..N becomes manual_order.
export async function reorderTodos(req: TodoReorderRequest): Promise<TodoReorderResponse> {
  return request('/todos/reorder', TodoReorderResponseSchema, {
    method: 'POST',
    body: JSON.stringify(TodoReorderRequestSchema.parse(req)),
  });
}

export async function listTodoComments(todoId: string): Promise<TodoComment[]> {
  const data = await request(`/todos/${todoId}/comments`, TodoCommentListResponseSchema);
  return data.comments;
}

export async function createComment(
  todoId: string,
  req: TodoCommentCreateRequest,
): Promise<void> {
  const body = JSON.stringify(TodoCommentCreateRequestSchema.parse(req));
  await fetchOk(`/todos/${todoId}/comments`, { method: 'POST', body });
}

export async function updateComment(
  todoId: string,
  commentId: string,
  content: string,
): Promise<void> {
  // Reuses the create request schema — backend accepts `{ content }` for
  // both POST and PUT. Validate locally so we send the same shape.
  const body = JSON.stringify(TodoCommentCreateRequestSchema.parse({ content }));
  await fetchOk(`/todos/${todoId}/comments/${commentId}`, { method: 'PUT', body });
}

export async function deleteComment(
  todoId: string,
  commentId: string,
): Promise<void> {
  await fetchOk(`/todos/${todoId}/comments/${commentId}`, { method: 'DELETE' });
}

// ---------------- Content ----------------

export async function getContent(id: string): Promise<ContentItem> {
  const data = await request(`/content/${id}`, ContentGetResponseSchema);
  return data.item;
}

export async function listContent(query: ContentListQuery = {}): Promise<ContentItem[]> {
  const parsed = ContentListQuerySchema.parse(query);
  const qs = toQueryString(parsed);
  const data = await request(`/content${qs}`, ContentListResponseSchema);
  return data.items;
}

export async function createNote(req: NoteCreateRequest): Promise<ContentCreateResponse> {
  const body = JSON.stringify(NoteCreateRequestSchema.parse(req));
  return request('/content', ContentCreateResponseSchema, { method: 'POST', body });
}

// PUT /content/:id handles metadata diffs only (title / projects / tags).
// Body edits go through POST /content/:id/edit-body, which re-chunks +
// re-embeds and is gated by the body-immutability rule for blob-backed rows.
export async function updateContent(id: string, patch: ContentUpdateRequest): Promise<ContentItem> {
  const body = JSON.stringify(ContentUpdateRequestSchema.parse(patch));
  const data = await request(`/content/${id}`, ContentGetResponseSchema, { method: 'PUT', body });
  return data.item;
}

export async function editContentBody(id: string, content: string): Promise<ContentCreateResponse> {
  const body = JSON.stringify(ContentEditBodyRequestSchema.parse({ content }));
  return request(`/content/${id}/edit-body`, ContentCreateResponseSchema, { method: 'POST', body });
}

export async function archiveContent(id: string): Promise<void> {
  await fetchOk(`/content/${id}`, { method: 'DELETE' });
}
export async function restoreContent(id: string): Promise<void> {
  await fetchOk(`/content/${id}/restore`, { method: 'POST' });
}
export async function pinContent(id: string): Promise<void> {
  await fetchOk(`/content/${id}/pin`, { method: 'POST' });
}
export async function unpinContent(id: string): Promise<void> {
  await fetchOk(`/content/${id}/unpin`, { method: 'POST' });
}
export async function retryContent(id: string): Promise<void> {
  await fetchOk(`/content/${id}/retry`, { method: 'POST' });
}
export async function reprocessContent(id: string): Promise<void> {
  await fetchOk(`/content/${id}/reprocess`, { method: 'POST' });
}

// File upload uses multipart/form-data — the browser sets the boundary itself,
// so we deliberately omit Content-Type. The response shape matches createNote
// (id + processing_status), regardless of whether the row landed sync ready or
// async pending.
export async function uploadFile(opts: {
  file: File;
  projectIds?: string[];
  tags?: string[];
  title?: string;
}): Promise<ContentCreateResponse> {
  const fd = new FormData();
  fd.set('type', 'document');
  fd.set('file', opts.file);
  if (opts.title) fd.set('title', opts.title);
  if (opts.projectIds && opts.projectIds.length > 0) fd.set('project_ids', opts.projectIds.join(','));
  if (opts.tags && opts.tags.length > 0) fd.set('tags', opts.tags.join(','));
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${API_KEY}`);
  const res = await fetch(`${BASE}/content`, { method: 'POST', body: fd, headers, credentials: 'include' });
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = typeof json === 'object' && json && 'error' in json
      ? String((json as { error: unknown }).error)
      : `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, json);
  }
  const parsed = ContentCreateResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(res.status, `Response failed validation: ${parsed.error.message}`, json);
  }
  return parsed.data;
}

export async function saveFromUrl(opts: {
  url: string;
  projectIds?: string[];
  tags?: string[];
  title?: string;
}): Promise<ContentCreateResponse> {
  const body = JSON.stringify({
    url: opts.url,
    project_ids: opts.projectIds,
    tags: opts.tags,
    title: opts.title,
  });
  return request('/content/from-url', ContentCreateResponseSchema, { method: 'POST', body });
}

// ---------------- Search / RAG ----------------

export async function search(req: SearchRequest): Promise<SearchHit[]> {
  const body = JSON.stringify(SearchRequestSchema.parse(req));
  const data = await request('/search', SearchResponseSchema, { method: 'POST', body });
  return data.hits;
}

export async function rag(req: RagRequest): Promise<RagResponse> {
  const body = JSON.stringify(RagRequestSchema.parse(req));
  return request('/rag', RagResponseSchema, { method: 'POST', body });
}

// ---------------- Tags ----------------

export async function listTags(opts: { project_id?: string; scope?: 'personal' | 'all' } = {}): Promise<Tag[]> {
  const qs = toQueryString(opts);
  const data = await request(`/tags${qs}`, TagListResponseSchema);
  return data.tags;
}

// Rename a tag corpus-wide. The backend implicitly merges if `to`
// already exists on a row; the response carries the affected row
// count. Empty / unchanged `to` short-circuits to noop on the server.
export async function renameTag(from: string, to: string): Promise<TagRenameResponse> {
  const body = JSON.stringify(TagRenameRequestSchema.parse({ to }));
  return request(`/tags/${encodeURIComponent(from)}`, TagRenameResponseSchema, {
    method: 'PUT',
    body,
  });
}

// ---------------- Activity ----------------

export async function listActivity(query: ActivityListQuery = {}): Promise<ActivityEvent[]> {
  const parsed = ActivityListQuerySchema.parse(query);
  const qs = toQueryString(parsed);
  const data = await request(`/activity${qs}`, ActivityListResponseSchema);
  return data.events;
}

export async function liteRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${API_KEY}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${BASE}${path}`, { ...init, headers });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`);
  return json as T;
}
