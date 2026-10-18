import { z } from 'zod';
import type { ServiceDeps } from './index.js';
import { saveRuntimeConfig } from '../config.js';
import { ProviderLogin } from '../providers/login.js';

export const ProviderSchema = z.enum(['ollama', 'llama.cpp', 'copilot', 'chatgpt']);
export const RuntimeSettingsSchema = z.object({
  provider: ProviderSchema,
  llamaUrl: z.string().url(),
  llamaModel: z.string().min(1),
  localModel: z.string().min(1),
  copilotModel: z.string().min(1),
  chatgptModel: z.string().min(1),
});

export function getRuntimeSettings(deps: ServiceDeps) {
  const c = deps.config;
  return { provider: c.llmProvider, localModel: c.localModel, embeddingModel: c.embeddingModel,
    copilotModel: c.copilotModel, chatgptModel: c.chatgptModel, llamaUrl: c.llamaUrl,
    llamaModel: c.llamaModel, localData: true };
}

export async function updateRuntimeSettings(deps: ServiceDeps, input: unknown) {
  await saveRuntimeConfig(deps.config, RuntimeSettingsSchema.parse(input));
  return { ok: true };
}

// HTTP MCP creates a server per request. Login state must outlive those servers
// and be shared with the web UI, without exposing CLI processes or credentials.
const logins = new WeakMap<ServiceDeps['config'], ProviderLogin>();
export function getProviderLogin(deps: ServiceDeps) {
  let login = logins.get(deps.config);
  if (!login) { login = new ProviderLogin(deps.config); logins.set(deps.config, login); }
  return login;
}

export async function listNotifications(deps: ServiceDeps) {
  const result = await deps.db.query(`SELECT id, content, due_date, project_id FROM todos
    WHERE archived = false AND status <> 'done' AND due_date <= now() ORDER BY due_date`);
  return { notifications: result.rows.map(row => ({ id: `${row.id}:${new Date(row.due_date).toISOString()}`,
    title: 'Todo due', body: row.content, project_id: row.project_id, todo_id: row.id })) };
}
