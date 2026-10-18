import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ContentBulkRequestSchema, TodoBulkRequestSchema, TodoReorderRequestSchema } from '@open-brain/shared';
import type { ServiceDeps } from '../services/index.js';
import * as sessions from '../services/sessions.js';
import * as projects from '../services/projects.js';
import * as content from '../services/content-items.js';
import * as todos from '../services/todos.js';
import * as comments from '../services/todo-comments.js';
import * as tags from '../services/tags.js';
import { getStats } from '../services/stats.js';
import { ProviderSchema, RuntimeSettingsSchema, getRuntimeSettings, updateRuntimeSettings, getProviderLogin, listNotifications } from '../services/runtime.js';
import { getModelCatalog } from '../providers/model-catalog.js';
import { resolveUploadMime } from '../capture/mime-utils.js';

const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const readOnly = { readOnlyHint: true };
const destructive = { destructiveHint: true, readOnlyHint: false };
const uuid = z.string().uuid();
const kind = z.enum(['content', 'todo', 'project']);
const confirmedId = uuid.describe('Repeat the exact target UUID after the user explicitly confirms permanent deletion.');

function confirm(actual: string, expected: string) {
  if (actual !== expected) throw new Error('Deletion confirmation does not match the target. Nothing was deleted.');
}

export function registerWorkspaceTools(server: McpServer, deps: ServiceDeps) {
  server.tool('delete_session',
    'Permanently delete a session AND all its notes, documents, uploaded files, todos, subtasks, comments and timeline. Ask the user to confirm this scope first. Requires the current exact session name. Use get_session_context to inspect before deletion.',
    { session_id: uuid, confirm_name: z.string().min(1) }, destructive, async ({ session_id, confirm_name }) => {
      const session = await sessions.getSession(deps, session_id);
      if (!session) throw new Error('Session not found');
      confirm(confirm_name, session.name);
      return result(await sessions.deleteSession(deps, session_id));
    });
  server.tool('retry_session_cleanup',
    'Retry queued uploaded-file cleanup after a deleted session returned pending_files greater than zero. Refuses sessions that still exist; this cannot delete a live session. Repeat the deleted session UUID as confirm_id.',
    { session_id: uuid, confirm_id: confirmedId }, destructive, async ({ session_id, confirm_id }) => {
      confirm(confirm_id, session_id);
      if (await sessions.getSession(deps, session_id)) throw new Error('Session still exists. Use delete_session with its confirmed name first.');
      return result(await sessions.deleteSession(deps, session_id));
    });

  server.tool('delete',
    'Permanently delete a content item, a todo (including descendants/comments), or a project. Project deletion also deletes its sessions and their owned artifacts/history; content and todos attached directly to the project are detached to global scope. Ask for explicit confirmation of that scope. Use archive for reversible removal.',
    { kind, id: uuid, confirm_id: confirmedId }, destructive, async ({ kind, id, confirm_id }) => {
      confirm(confirm_id, id);
      const existing = kind === 'content' ? await content.getContentItem(deps, id)
        : kind === 'todo' ? await todos.getTodo(deps, id) : await projects.getProject(deps, id);
      if (!existing) throw new Error(`${kind} not found`);
      if (kind === 'content') await content.deleteContentItemHardById(deps, id);
      else if (kind === 'todo') await todos.deleteTodoHardById(deps, id);
      else await projects.deleteProjectHard(deps, id);
      return result({ ok: true, id, kind });
    });

  server.tool('delete_comment', 'Permanently delete a todo comment after the user confirms its removal.',
    { comment_id: uuid, confirm_id: confirmedId }, destructive, async ({ comment_id, confirm_id }) => {
      confirm(confirm_id, comment_id);
      if (!await comments.getComment(deps, comment_id)) throw new Error('Comment not found');
      await comments.deleteComment(deps, comment_id);
      return result({ ok: true, id: comment_id });
    });

  for (const pinned of [true, false]) {
    server.tool(pinned ? 'pin' : 'unpin', `${pinned ? 'Pin' : 'Unpin'} a document/note, todo or project, just like the workspace UI.`,
      { kind, id: uuid }, { destructiveHint: false, idempotentHint: true }, async ({ kind, id }) => {
        const response = kind === 'content' ? await (pinned ? content.pinContentItem : content.unpinContentItem)(deps, id)
          : kind === 'todo' ? await (pinned ? todos.pinTodo : todos.unpinTodo)(deps, id)
          : await (pinned ? projects.pinProject : projects.unpinProject)(deps, id);
        if (!response.found) throw new Error(`${kind} not found`);
        return result({ ok: true, id, pinned });
      });
  }

  // Same batch ceiling as REST. Destructive batches require confirmation of
  // the exact set, not a boolean that could accidentally authorize other IDs.
  const batchConfirmation = z.array(uuid).optional().describe('For action=delete only: repeat every selected UUID after explicit user confirmation.');
  function confirmBatch(ids: string[], confirmation?: string[]) {
    if (!confirmation || JSON.stringify([...new Set(ids)].sort()) !== JSON.stringify([...new Set(confirmation)].sort())) {
      throw new Error('Permanent deletion requires confirm_ids matching the selected IDs. Nothing was deleted.');
    }
  }
  server.tool('bulk_content', 'Apply one operation to selected documents/notes. Same actions as the UI. Permanent delete requires explicit confirmation of all selected IDs.',
    { ...ContentBulkRequestSchema.shape, ids: z.array(uuid).min(1).max(100), confirm_ids: batchConfirmation }, destructive,
    async ({ confirm_ids, ...input }) => {
      if (input.action === 'delete') confirmBatch(input.ids, confirm_ids);
      return result(await content.bulkContent(deps, input));
    });
  server.tool('bulk_todos', 'Apply one operation to selected todos. Supports tags, project, status, priority, due date, archive, restore and delete. Null clears a nullable value. Permanent delete includes descendants and requires confirmation.',
    { ...TodoBulkRequestSchema.shape, ids: z.array(uuid).min(1).max(100), due_date: z.string().datetime({ offset: true }).nullable().optional(), confirm_ids: batchConfirmation }, destructive,
    async ({ confirm_ids, ...input }) => {
      if (input.action === 'delete') confirmBatch(input.ids, confirm_ids);
      return result(await todos.bulkTodos(deps, { ...input,
        has_priority: input.priority !== undefined, has_project_id: input.project_id !== undefined,
        has_due_date: input.due_date !== undefined, due_date: input.due_date == null ? input.due_date : new Date(input.due_date) }));
    });
  server.tool('reorder_todos', 'Persist the supplied order for sibling todos. parent_id=null selects top-level todos. A mismatched ID aborts the entire reorder.',
    TodoReorderRequestSchema.shape, { destructiveHint: false }, async ({ parent_id, ids }) => result(await todos.reorderTodos(deps, parent_id, ids)));

  const fileShape = {
    file_base64: z.string().min(1).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/).describe('Base64-encoded file bytes, without a data URL prefix. Read from the agent filesystem; no server-local path access.'),
    filename: z.string().min(1), mime_type: z.string().optional(), title: z.string().optional(),
  };
  function file(input: { file_base64: string; filename: string; mime_type?: string }) {
    const data = Buffer.from(input.file_base64, 'base64');
    if (!data.length) throw new Error('File is empty');
    return { data, filename: input.filename, mimeType: resolveUploadMime(input.mime_type ?? '', input.filename) };
  }
  server.tool('upload_file', 'Upload a document from base64 file bytes (PDF, image, audio, video or text). Same pipeline as a UI upload. Supply session_id for ownership or project_ids for direct project membership. Returns after capture; poll get(id) until ready/failed.',
    { ...fileShape, session_id: uuid.optional(), project_ids: z.array(uuid).optional(), tags: z.array(z.string()).optional(), folder: z.string().nullable().optional() },
    async input => {
      const started = await content.createContentItem(deps, { type: 'document', file: file(input), title: input.title,
        sessionId: input.session_id, projectIds: input.project_ids, tags: input.tags, folder: input.folder });
      return result({ id: started.id, status: started.status });
    });
  server.tool('replace_file', 'Replace an uploaded file with a new version. Archives the old version and preserves its tags, folder and session/project ownership. Poll get(new_id) until indexing finishes.',
    { id: uuid, ...fileShape }, async input => {
      const started = await content.replaceContent(deps, input.id, { file: file(input), title: input.title });
      return result({ old_id: started.oldId, new_id: started.newId, status: started.status });
    });
  server.tool('get_content_status', 'Read upload/indexing progress without fetching the whole document.', { id: uuid }, readOnly, async ({ id }) => {
    const status = await content.getContentItemStatus(deps, id);
    if (!status) throw new Error('Content not found');
    return result(status);
  });
  server.tool('delete_tag', 'Remove a tag from every document, note and todo without deleting the artifacts. This affects all scopes. Requires explicit user confirmation of the tag name.',
    { name: z.string().min(1), confirm_name: z.string().min(1) }, destructive, async ({ name, confirm_name }) => {
      confirm(confirm_name, name);
      return result(await tags.deleteTag(deps, name));
    });
  server.tool('get_stats', 'Get the inventory, processing state, freshness and top tags; optionally scoped to a project.',
    { project_id: uuid.optional() }, readOnly, async ({ project_id }) => result(await getStats(deps, project_id)));
  server.tool('list_project_counts', 'Count documents, notes and todos per project, including child-session artifacts.', {}, readOnly,
    async () => result(await projects.listProjectCounts(deps)));
  server.tool('get_settings', 'Read the active completion provider/model and the local embedding model. No credentials are returned. Appearance and notification permission are browser-local preferences, outside MCP.',
    {}, readOnly, async () => result(getRuntimeSettings(deps)));
  server.tool('update_settings', 'Save model settings using the same contract as Settings. Read get_settings first to preserve other choices. Only switch provider/model when requested. Embedding model is read-only because changing it requires reindexing.',
    RuntimeSettingsSchema.shape, async input => result(await updateRuntimeSettings(deps, input)));
  server.tool('list_models', 'Discover models and sign-in availability for a provider. Does not change the selected provider or run inference.',
    { provider: ProviderSchema }, readOnly, async ({ provider }) => result(await getModelCatalog(deps.config, provider)));
  const loginProvider = z.enum(['copilot', 'chatgpt']);
  server.tool('start_provider_login', 'Start the official provider device sign-in when requested. Return the secure URL and code to the user, who must authorize in their browser. Poll provider_login_status. Never request passwords or tokens.',
    { provider: loginProvider }, async ({ provider }) => result(await getProviderLogin(deps).start(provider)));
  server.tool('provider_login_status', 'Read device sign-in progress, shared with the UI and subsequent MCP requests. Returns only status, device URL/code and a safe message, never saved credentials.',
    { provider: loginProvider }, readOnly, async ({ provider }) => result(getProviderLogin(deps).status(provider)));
  server.tool('list_notifications', 'List due, unfinished todo reminders, matching the UI reminder feed. Browser notification permission can only be granted in the user browser.',
    {}, readOnly, async () => result(await listNotifications(deps)));
}
