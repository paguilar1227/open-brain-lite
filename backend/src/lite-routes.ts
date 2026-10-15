import { ProviderLogin } from './providers/login.js';
import { z } from 'zod';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { ServiceDeps } from './services/index.js';
import { consolidateProject, getProjectContext, saveProjectSession } from './services/project-memory.js';
import { saveRuntimeConfig } from './config.js';

export const SessionInput = z.object({ session_key: z.string().min(1), summary: z.string().min(1), decisions: z.array(z.string()).default([]), next_steps: z.array(z.string()).default([]) });
const projectId = z.string().uuid();
export function addLiteRoutes(app: OpenAPIHono, deps: ServiceDeps) {
  const login = new ProviderLogin(deps.config);
  app.post('/api/v1/providers/:provider/login', async c => c.json(await login.start(z.enum(['copilot', 'chatgpt']).parse(c.req.param('provider')))));
  app.get('/api/v1/providers/:provider/login', c => c.json(login.status(z.enum(['copilot', 'chatgpt']).parse(c.req.param('provider')))));
  app.get('/api/v1/runtime', c => c.json({ provider: deps.config.llmProvider, localModel: deps.config.localModel, embeddingModel: deps.config.embeddingModel, copilotModel: deps.config.copilotModel, chatgptModel: deps.config.chatgptModel, llamaUrl: deps.config.llamaUrl, llamaModel: deps.config.llamaModel, localData: true }));
  app.put('/api/v1/runtime', async c => {
    const body = z.object({ provider: z.enum(['ollama', 'llama.cpp', 'copilot', 'chatgpt']), llamaUrl: z.string().url(), llamaModel: z.string().min(1), localModel: z.string().min(1), copilotModel: z.string().min(1), chatgptModel: z.string().min(1) }).parse(await c.req.json());
    await saveRuntimeConfig(deps.config, body);
    return c.json({ ok: true });
  });
  app.get('/api/v1/projects/:id/context', async c => c.json(await getProjectContext(deps, projectId.parse(c.req.param('id')))));
  app.post('/api/v1/projects/:id/sessions', async c => c.json(await saveProjectSession(deps, projectId.parse(c.req.param('id')), SessionInput.parse(await c.req.json()))));
  app.post('/api/v1/projects/:id/consolidate', async c => c.json(await consolidateProject(deps, projectId.parse(c.req.param('id')))));
  app.get('/api/v1/notifications', async c => {
    const result = await deps.db.query(`SELECT id, content, due_date, project_id FROM todos
      WHERE archived = false AND status <> 'done' AND due_date <= now() ORDER BY due_date`);
    return c.json({ notifications: result.rows.map(row => ({ id: `${row.id}:${new Date(row.due_date).toISOString()}`, title: 'Todo due', body: row.content, project_id: row.project_id, todo_id: row.id })) });
  });
}
