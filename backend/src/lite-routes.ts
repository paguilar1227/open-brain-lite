import * as sessions from './services/sessions.js';
import { z } from 'zod';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { ServiceDeps } from './services/index.js';
import { startProjectConsolidation, getProjectContext, saveProjectSession } from './services/project-memory.js';
import { getProviderLogin, getRuntimeSettings, updateRuntimeSettings, listNotifications } from './services/runtime.js';
import { SessionCreateSchema, SessionUpdateSchema, TimelineQuerySchema } from '@open-brain/shared';
import { listProjectTimeline, listSessionTimeline } from './db/timeline.js';
import { getModelCatalog } from './providers/model-catalog.js';

export const SessionInput = z.object({ session_key: z.string().min(1), summary: z.string().min(1), decisions: z.array(z.string()).default([]), next_steps: z.array(z.string()).default([]) });
const projectId = z.string().uuid();
export function addLiteRoutes(app: OpenAPIHono, deps: ServiceDeps) {
  app.get('/api/v1/projects/:id/timeline', async c => {
    const id = projectId.safeParse(c.req.param('id'));
    const query = TimelineQuerySchema.safeParse({ ...c.req.query(), tags: c.req.queries('tag') ?? [] });
    if (!id.success || !query.success) return c.json({ error: 'Invalid timeline query' }, 400);
    const project = await deps.db.query('SELECT id FROM projects WHERE id=$1', [id.data]);
    if (!project.rows.length) return c.json({ error: 'Project not found' }, 404);
    return c.json(await listProjectTimeline(deps.db, id.data, query.data));
  });
  app.get('/api/v1/sessions', async c => {
    const scope=z.union([z.string().uuid(),z.literal('null')]).optional().parse(c.req.query('project_id'));
    return c.json({sessions:await sessions.listSessions(deps,scope==='null'?null:scope)});
  });
  app.post('/api/v1/sessions', async c => c.json({session:await sessions.createSession(deps,SessionCreateSchema.parse(await c.req.json()))},201));
  app.get('/api/v1/sessions/:id', async c => {
    const session=await sessions.getSession(deps,projectId.parse(c.req.param('id')));
    return session ? c.json({session}) : c.json({error:'Session not found'},404);
  });
  app.put('/api/v1/sessions/:id', async c => {
    const session=await sessions.updateSession(deps,projectId.parse(c.req.param('id')),SessionUpdateSchema.parse(await c.req.json()));
    return session ? c.json({session}) : c.json({error:'Session not found'},404);
  });
  app.delete('/api/v1/sessions/:id',async c => c.json(await sessions.deleteSession(deps,projectId.parse(c.req.param('id')))));
  app.get('/api/v1/sessions/:id/context',async c => {
    const context=await sessions.getSessionContext(deps,projectId.parse(c.req.param('id')));
    return context ? c.json(context) : c.json({error:'Session not found'},404);
  });
  app.get('/api/v1/sessions/:id/timeline',async c => {
    const id=projectId.parse(c.req.param('id'));
    if (!await sessions.getSession(deps,id)) return c.json({error:'Session not found'},404);
    const query=TimelineQuerySchema.parse({...c.req.query(),tags:c.req.queries('tag')??[]});
    return c.json(await listSessionTimeline(deps.db,id,query));
  });
  const login = getProviderLogin(deps);
  app.get('/api/v1/providers/:provider/models', async c => {
    const provider = z.enum(['ollama', 'llama.cpp', 'copilot', 'chatgpt']).safeParse(c.req.param('provider'));
    if (!provider.success) return c.json({ error: 'Unknown model provider' }, 400);
    return c.json(await getModelCatalog(deps.config, provider.data));
  });
  app.post('/api/v1/providers/:provider/login', async c => c.json(await login.start(z.enum(['copilot', 'chatgpt']).parse(c.req.param('provider')))));
  app.get('/api/v1/providers/:provider/login', c => c.json(login.status(z.enum(['copilot', 'chatgpt']).parse(c.req.param('provider')))));
  app.get('/api/v1/runtime', c => c.json(getRuntimeSettings(deps)));
  app.put('/api/v1/runtime', async c => {
    return c.json(await updateRuntimeSettings(deps, await c.req.json()));
  });
  app.get('/api/v1/projects/:id/context', async c => c.json(await getProjectContext(deps, projectId.parse(c.req.param('id')))));
  app.post('/api/v1/projects/:id/sessions', async c => c.json(await saveProjectSession(deps, projectId.parse(c.req.param('id')), SessionInput.parse(await c.req.json()), { waitForIndex: false })));
  app.post('/api/v1/projects/:id/consolidate', async c => c.json(await startProjectConsolidation(deps, projectId.parse(c.req.param('id'))), 202));
  app.get('/api/v1/notifications', async c => c.json(await listNotifications(deps)));
}
