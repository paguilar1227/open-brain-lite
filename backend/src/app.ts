import { addLiteRoutes } from './lite-routes.js';
import { LocalFileStorage } from './storage/local.js';
import { Hono } from 'hono';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
  ActivityListQuerySchema,
  ActivityListResponseSchema,
  BulkResponseSchema,
  ContentBulkRequestSchema,
  ContentCreateRequestSchema,
  ContentTypeSchema,
  ContentEditBodyRequestSchema,
  ContentGetResponseSchema,
  ContentIngestAckSchema,
  ContentItemSchema,
  ContentListQuerySchema,
  ContentListResponseSchema,
  ContentReplaceAckSchema,
  ContentReplaceRequestSchema,
  ContentStatusResponseSchema,
  ContentUpdateRequestSchema,
  DiagnosticsBackfillRequestSchema,
  DiagnosticsBackfillResponseSchema,
  DiagnosticsEdgesResponseSchema,
  DiagnosticsEntitiesQuerySchema,
  DiagnosticsEntitiesResponseSchema,
  ErrorResponseSchema,
  FindMentionsRequestSchema,
  FindMentionsResponseSchema,
  HardDeleteQuerySchema,
  IdParamSchema,
  CommentIdParamSchema,
  OkResponseSchema,
  ProjectCountsListResponseSchema,
  ProjectCreateRequestSchema,
  ProjectGetResponseSchema,
  ProjectListQuerySchema,
  ProjectListResponseSchema,
  ProjectResponseSchema,
  ProjectUpdateRequestSchema,
  RagRequestSchema,
  RagResponseSchema,
  SearchRequestSchema,
  SearchResponseSchema,
  StatsQuerySchema,
  StatsSchema,
  TagDeleteResponseSchema,
  TagListQuerySchema,
  TagListResponseSchema,
  TagNameParamSchema,
  TagRenameRequestSchema,
  TagRenameResponseSchema,
  TodoBulkRequestSchema,
  TodoReorderRequestSchema,
  TodoReorderResponseSchema,
  TodoCommentCreateRequestSchema,
  TodoCommentListResponseSchema,
  TodoCommentResponseSchema,
  TodoCreateRequestSchema,
  TodoGetResponseSchema,
  TodoListQuerySchema,
  TodoListResponseSchema,
  TodoResponseSchema,
  TodoUpdateRequestSchema,
  UrlIngestAckSchema,
  UrlIngestRequestSchema,
} from '@open-brain/shared';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { ServiceDeps } from './services/index.js';
import type { BlobStorage } from './storage/blob.js';
import { createMcpServer } from './mcp/server.js';
import { resolveUploadMime } from './capture/mime-utils.js';
import { downloadFilename } from './util/file-meta.js';
import * as projectsSvc from './services/projects.js';
import * as contentSvc from './services/content-items.js';
import * as todosSvc from './services/todos.js';
import * as commentsSvc from './services/todo-comments.js';
import * as searchSvc from './services/search.js';
import * as ragSvc from './services/rag.js';
import * as tagsSvc from './services/tags.js';
import * as activitySvc from './services/activity.js';
import type { ActivityKind } from './services/activity.js';
import * as statsSvc from './services/stats.js';
import { classifyQueryDepth } from './services/query-depth.js';
import * as urlIngestSvc from './services/url-ingest.js';
import { swaggerUiHandler } from './openapi.js';

export function createApp(deps: ServiceDeps) {
  // defaultHook: any Zod failure (request body, query, params) emits a flat
  // `{error: string}` so it matches the shape every other 400 in this app
  // returns. Without this, OpenAPIHono returns a verbose ZodError object
  // that breaks ad-hoc clients and the integration tests.
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        const issues = result.error.issues;
        const first = issues[0];
        const path = first?.path?.length ? first.path.join('.') : 'request';
        const message = first?.message ?? 'Invalid request';
        return c.json({ error: `Invalid ${path}: ${message}` }, 400);
      }
    },
  });

  app.use('*', cors({ origin: '*' }));

  // ----- auth -----
  // /api/v1/* and /api/openapi.json + /api/docs use Bearer (Authorization
  // header or `?key=`). All non-browser callers (MCP, CLI, scripts, the
  // OpenAPI/Swagger viewer with `?key=`) hit this surface.
  //
  // /api/auth/* is intentionally NOT covered by this middleware — those
  // endpoints sit in front of Easy Auth and read the
  // `x-ms-client-principal-*` headers Easy Auth injects on authenticated
  // browser requests. Easy Auth's `excludedPaths` covers `/api/v1/*` and
  // `/api/openapi.json` + `/api/docs` so Bearer callers aren't redirected
  // to login, but `/api/auth/*` is gated so the principal headers are
  // actually injected when a valid session cookie is present.
  app.use('/api/v1/*', async (c, next) => {
    const key = c.req.header('Authorization')?.replace('Bearer ', '') ?? c.req.query('key');
    if (key !== deps.config.apiKey) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  });
  app.use('/api/openapi.json', async (c, next) => {
    const key = c.req.header('Authorization')?.replace('Bearer ', '') ?? c.req.query('key');
    if (key !== deps.config.apiKey) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  });
  app.use('/api/docs', async (c, next) => {
    const key = c.req.header('Authorization')?.replace('Bearer ', '') ?? c.req.query('key');
    if (key !== deps.config.apiKey) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  });
  // /mcp uses the same Bearer / ?key= contract as /api/v1/*. The endpoint
  // is wired up with `app.all('/mcp', ...)` further down; this middleware
  // gates it before the handler ever spins up an MCP server. Match-by-path
  // here means we don't accidentally protect the entire app with `*`.
  app.use('/mcp', async (c, next) => {
    const key = c.req.header('Authorization')?.replace('Bearer ', '') ?? c.req.query('key');
    if (key !== deps.config.apiKey) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  });

  // /api/auth/token: the React UI calls this on boot to exchange its Easy
  // Auth session cookie for the long-lived Bearer key the rest of the
  // /api/v1 surface expects. Easy Auth gates this endpoint (it isn't in
  // excludedPaths), so by the time the request reaches us the platform has
  // already validated the cookie and injected the principal headers.
  // Anonymous browser sessions get a 302 to the AAD login flow before
  // ever reaching this code.
  //
  // Note: this returns the same long-lived key today — option 3 phase 1.
  // Phase 2 will derive a short-lived per-session token (see task #122).
  app.get('/api/auth/token', (c) => {
    return c.json({ error: 'Enter the API key from your local installation' }, 401);

  });

  app.get('/api/files/:name', async (c) => {
    const storage = deps.blobStorage;
    if (!(storage instanceof LocalFileStorage)) return c.json({ error: 'Not found' }, 404);
    const name = c.req.param('name');
    const filename = c.req.query('filename') ?? '';
    const authorized = c.req.header('Authorization') === `Bearer ${deps.config.apiKey}`
      || storage.verify(name, c.req.query('expires') ?? '', filename, c.req.query('sig') ?? '');
    if (!authorized) return c.json({ error: 'Unauthorized' }, 401);
    try {
      const data = await storage.download(name);
      c.header('Content-Type', await storage.getContentType(name));
      c.header('X-Content-Type-Options', 'nosniff');
      c.header('Content-Security-Policy', "sandbox; default-src 'none'");
      if (filename) c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      return c.body(new Uint8Array(data));
    } catch { return c.json({ error: 'File not found' }, 404); }
  });

  addLiteRoutes(app, deps);

  // ----- health -----
  app.get('/health', (c) => c.json({ ok: true, service: 'open-brain-lite', version: '0.1.0' }));

  // ----- OpenAPI spec + Swagger UI (auth-gated by /api/* middleware above) -----
  // The spec is auto-generated from each `app.openapi(...)` route's Zod
  // schemas — no hand-rolled JSON to drift from the actual handlers.
  app.doc31('/api/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'Open Brain API',
      version: '2.0.0',
      description:
        'Personal knowledge base + productivity tool. Single user (Pablo). ' +
        'Hybrid semantic + entity-graph search across documents, notes, and todos. ' +
        'Auth: `Authorization: Bearer <key>` or `?key=<key>` query param.',
    },
    servers: [
      { url: '/', description: 'Current host' },
    ],
  });
  app.get('/api/docs', () => swaggerUiHandler());

  // ==========================================================================
  // PROJECTS
  // ==========================================================================
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/projects',
      tags: ['Projects'],
      summary: 'List projects (optional status / pinned filters)',
      request: { query: ProjectListQuerySchema },
      responses: {
        200: {
          description: 'Project list',
          content: { 'application/json': { schema: ProjectListResponseSchema } },
        },
        400: {
          description: 'Invalid query parameter',
          content: { 'application/json': { schema: ErrorResponseSchema } },
        },
        401: {
          description: 'Unauthorized',
          content: { 'application/json': { schema: ErrorResponseSchema } },
        },
      },
    }),
    async (c) => {
      const { status, pinned } = c.req.valid('query');
      const rows = await projectsSvc.listProjects(deps, status, pinned);
      // Coerce Date columns to ISO strings so the response matches the wire
      // schema (Postgres returns JS Date objects; JSON.stringify would do this
      // anyway, but doing it explicitly keeps the openapi parser happy).
      const projects = rows.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        status: p.status,
        pinned_at: p.pinned_at ? p.pinned_at.toISOString() : null,
        created_at: p.created_at.toISOString(),
        updated_at: p.updated_at.toISOString(),
      }));
      return c.json({ projects }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/projects',
      tags: ['Projects'],
      summary: 'Create a project',
      request: {
        body: { content: { 'application/json': { schema: ProjectCreateRequestSchema } } },
      },
      responses: {
        201: {
          description: 'Project created',
          content: { 'application/json': { schema: ProjectResponseSchema } },
        },
        400: { description: 'Invalid body', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const project = await projectsSvc.createProject(deps, body.name, body.description ?? null);
      return c.json({ project: serializeProject(project) }, 201);
    },
  );

  // /projects/counts must come BEFORE /projects/:id so the param route
  // doesn't shadow the static "counts" path. First route written in the
  // OpenAPIHono+Zod style — input/output validation + auto-OpenAPI emission.
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/projects/counts',
      tags: ['Projects'],
      summary: 'Per-project doc/note/todo counts (one row per project)',
      responses: {
        200: {
          description: 'Project counts',
          content: { 'application/json': { schema: ProjectCountsListResponseSchema } },
        },
        401: {
          description: 'Unauthorized',
          content: { 'application/json': { schema: ErrorResponseSchema } },
        },
      },
    }),
    async (c) => {
      const counts = await projectsSvc.listProjectCounts(deps);
      return c.json({ counts }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/projects/{id}',
      tags: ['Projects'],
      summary: 'Get a project by id',
      request: { params: IdParamSchema },
      responses: {
        200: { description: 'Project', content: { 'application/json': { schema: ProjectGetResponseSchema } } },
        400: { description: 'Invalid id', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const project = await projectsSvc.getProject(deps, id);
      if (!project) return c.json({ error: 'Not found' }, 404);
      return c.json({ project: serializeProject(project) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/api/v1/projects/{id}',
      tags: ['Projects'],
      summary: 'Update a project',
      request: {
        params: IdParamSchema,
        body: { content: { 'application/json': { schema: ProjectUpdateRequestSchema } } },
      },
      responses: {
        200: { description: 'Updated project', content: { 'application/json': { schema: ProjectGetResponseSchema } } },
        400: { description: 'Invalid body', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const project = await projectsSvc.updateProject(deps, id, body);
      if (!project) return c.json({ error: 'Not found' }, 404);
      return c.json({ project: serializeProject(project) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/api/v1/projects/{id}',
      tags: ['Projects'],
      summary: 'Archive (default) or hard-delete a project',
      request: { params: IdParamSchema, query: HardDeleteQuerySchema },
      responses: {
        200: { description: 'Deleted', content: { 'application/json': { schema: OkResponseSchema } } },
        400: { description: 'Invalid id', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const { hard } = c.req.valid('query');
      if (hard) {
        await projectsSvc.deleteProjectHard(deps, id);
        return c.json({ ok: true, mode: 'hard' as const }, 200);
      }
      await projectsSvc.archiveProject(deps, id);
      return c.json({ ok: true, mode: 'archived' as const }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/projects/{id}/restore',
      tags: ['Projects'],
      summary: 'Restore an archived project',
      request: { params: IdParamSchema },
      responses: {
        200: { description: 'Restored', content: { 'application/json': { schema: OkResponseSchema } } },
        400: { description: 'Invalid id', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      await projectsSvc.unarchiveProject(deps, id);
      return c.json({ ok: true }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/projects/{id}/pin',
      tags: ['Projects'],
      summary: 'Pin a project',
      request: { params: IdParamSchema },
      responses: {
        200: { description: 'Pinned', content: { 'application/json': { schema: OkResponseSchema } } },
        400: { description: 'Invalid id', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const r = await projectsSvc.pinProject(deps, id);
      if (!r.found) return c.json({ error: 'Not found' }, 404);
      return c.json({ ok: true }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/projects/{id}/unpin',
      tags: ['Projects'],
      summary: 'Unpin a project',
      request: { params: IdParamSchema },
      responses: {
        200: { description: 'Unpinned', content: { 'application/json': { schema: OkResponseSchema } } },
        400: { description: 'Invalid id', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const r = await projectsSvc.unpinProject(deps, id);
      if (!r.found) return c.json({ error: 'Not found' }, 404);
      return c.json({ ok: true }, 200);
    },
  );

  // ==========================================================================
  // CONTENT ITEMS (documents + notes)
  // ==========================================================================
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/content',
      tags: ['Content'],
      summary: 'List content items',
      request: { query: ContentListQuerySchema },
      responses: {
        200: { description: 'Content items', content: { 'application/json': { schema: ContentListResponseSchema } } },
        400: { description: 'Invalid query', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const q = c.req.valid('query');
      const tags = q.tags?.split(',').filter(Boolean);

      let processing_status: Array<'pending' | 'ready' | 'failed'> | undefined;
      if (q.processing_status) {
        const values = q.processing_status.split(',').map((s) => s.trim()).filter(Boolean);
        const allowed = new Set(['pending', 'ready', 'failed']);
        const bad = values.filter((v) => !allowed.has(v));
        if (bad.length > 0) {
          return c.json({
            error: `Invalid processing_status value(s): ${bad.join(', ')}. Allowed: pending, ready, failed.`,
          }, 400);
        }
        processing_status = values as Array<'pending' | 'ready' | 'failed'>;
      }

      const pinned = parsePinned(q.pinned);
      if (pinned === 'invalid') {
        return c.json({ error: `Invalid pinned: "${q.pinned}". Expected true/false.` }, 400);
      }

      // Translate the wire-level 'null' sentinel into the internal `null`
      // the db filter understands — same shape as /todos uses for
      // project-less rows.
      const items = await contentSvc.listContentItems(deps, {
        type: q.type,
        project_id: q.project_id === 'null' ? null : q.project_id,
        tags,
        processing_status,
        pinned,
        limit: q.limit,
        include_archived: q.include_archived,
        before: q.before ? new Date(q.before) : undefined,
        q: q.q,
      });
      return c.json({ items: items.map((it) => serializeContentItem(it as never, deps.blobStorage)) }, 200);
    },
  );

  // POST /content accepts both JSON and multipart/form-data. The multipart
  // shape is documented for OpenAPI consumers; the handler does its own
  // dual-mode parsing because Zod can't validate File objects from parseBody.
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/content',
      tags: ['Content'],
      summary: 'Create a content item (JSON note or multipart upload)',
      request: {
        body: {
          content: {
            'application/json': { schema: ContentCreateRequestSchema },
            'multipart/form-data': {
              schema: z.object({
                type: ContentTypeSchema,
                content: z.string().optional(),
                title: z.string().optional(),
                project_ids: z.string().optional(),
                tags: z.string().optional(),
                file: z.unknown().optional(),
              }),
            },
          },
        },
      },
      responses: {
        200: { description: 'Created (already ready)', content: { 'application/json': { schema: ContentIngestAckSchema } } },
        202: { description: 'Accepted (processing)', content: { 'application/json': { schema: ContentIngestAckSchema } } },
        400: { description: 'Invalid body', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const contentType = c.req.header('Content-Type') ?? '';
      let type: 'document' | 'note';
      let content: string | undefined;
      let title: string | undefined;
      let projectIds: string[] | undefined;
      let tags: string[] | undefined;
      let folder: string | null | undefined;
      let file: { data: Buffer; mimeType: string; filename: string } | undefined;

      if (contentType.includes('multipart/form-data')) {
        const body = await c.req.parseBody();
        type = body.type as 'document' | 'note';
        content = typeof body.content === 'string' ? body.content : undefined;
        title = typeof body.title === 'string' ? body.title : undefined;
        const pids = typeof body.project_ids === 'string' ? body.project_ids : undefined;
        projectIds = pids ? pids.split(',').filter(Boolean) : undefined;
        const tgs = typeof body.tags === 'string' ? body.tags : undefined;
        tags = tgs ? tgs.split(',').filter(Boolean) : undefined;
        folder = typeof body.folder === 'string' && body.folder.trim() ? body.folder : undefined;
        const uploaded = body.file as File | undefined;
        if (uploaded && uploaded.size > 0) {
          file = {
            data: Buffer.from(await uploaded.arrayBuffer()),
            mimeType: resolveUploadMime(uploaded.type, uploaded.name),
            filename: uploaded.name,
          };
        }
      } else {
        const body = await c.req.json<{
          type: 'document' | 'note';
          content?: string;
          title?: string;
          project_ids?: string[];
          tags?: string[];
          folder?: string | null;
        }>();
        type = body.type;
        content = body.content;
        title = body.title;
        projectIds = body.project_ids;
        tags = body.tags;
        folder = body.folder ?? undefined;
      }

      if (!type || (type !== 'document' && type !== 'note')) {
        return c.json({ error: 'type must be "document" or "note"' }, 400);
      }
      if (!content && !file) {
        return c.json({ error: 'Must provide content or file' }, 400);
      }

      const started = await contentSvc.createContentItem(deps, {
        type, content, title, projectIds, tags, folder, file,
      });
      return c.json(
        { id: started.id, status: started.status },
        started.status === 'ready' ? 200 : 202,
      );
    },
  );

  // Ingest from URL — fetches & chunks a URL (YouTube, X, PDF, HTML, media).
  // Mounted before /content/:id so routing doesn't treat "from-url" as an id.
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/content/from-url',
      tags: ['Content'],
      summary: 'Ingest content from a URL',
      request: { body: { content: { 'application/json': { schema: UrlIngestRequestSchema } } } },
      responses: {
        200: { description: 'Deduped or already ready', content: { 'application/json': { schema: UrlIngestAckSchema } } },
        202: { description: 'Accepted', content: { 'application/json': { schema: UrlIngestAckSchema } } },
        400: { description: 'Invalid URL or unfetchable', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      try {
        const result = await urlIngestSvc.ingestFromUrl(deps, body.url, {
          projectIds: body.project_ids,
          tags: body.tags,
          title: body.title,
        });
        const httpStatus = result.deduped || result.status === 'ready' ? 200 : 202;
        return c.json({
          id: result.id,
          title: result.title,
          type: result.type,
          source_url: result.source_url,
          deduped: result.deduped,
          url_type: result.url_type,
          status: result.status,
        }, httpStatus);
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
      }
    },
  );

  // Slim polling endpoint for async ingest. Returns just the status fields
  // and a chunk count — no content body, metadata, or embeddings.
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/content/{id}/status',
      tags: ['Content'],
      summary: 'Get ingest status (poll until ready/failed)',
      request: { params: IdParamSchema },
      responses: {
        200: { description: 'Status', content: { 'application/json': { schema: ContentStatusResponseSchema } } },
        400: { description: 'Invalid id', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const status = await contentSvc.getContentItemStatus(deps, id);
      if (!status) return c.json({ error: 'Not found' }, 404);
      return c.json(status, 200);
    },
  );

  // Retry a failed ingest in place. State conflicts (ready/pending) → 409.
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/content/{id}/retry',
      tags: ['Content'],
      summary: 'Retry a failed ingest',
      request: { params: IdParamSchema },
      responses: {
        202: { description: 'Retrying', content: { 'application/json': { schema: ContentIngestAckSchema } } },
        400: { description: 'Invalid id', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
        409: { description: 'State conflict (ready/pending)', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      try {
        const result = await contentSvc.retryContentIngest(deps, id);
        return c.json({ id: result.id, status: result.status }, 202);
      } catch (err) {
        if (err instanceof contentSvc.RetryStateError) {
          if (err.code === 'NOT_FOUND') return c.json({ error: err.message }, 404);
          return c.json({ error: err.message, code: err.code }, 409);
        }
        throw err;
      }
    },
  );

  // Reprocess a healthy or previously failed content item.
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/content/{id}/reprocess',
      tags: ['Content'],
      summary: 'Regenerate chunks/embeddings/metadata',
      request: { params: IdParamSchema },
      responses: {
        202: { description: 'Reprocessing', content: { 'application/json': { schema: ContentIngestAckSchema } } },
        400: { description: 'Invalid id', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
        409: { description: 'State conflict (pending)', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      try {
        const result = await contentSvc.reprocessContent(deps, id);
        return c.json({ id: result.id, status: result.status }, 202);
      } catch (err) {
        if (err instanceof contentSvc.ReprocessStateError) {
          if (err.code === 'NOT_FOUND') return c.json({ error: err.message }, 404);
          return c.json({ error: err.message, code: err.code }, 409);
        }
        throw err;
      }
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/content/{id}',
      tags: ['Content'],
      summary: 'Get a content item',
      request: { params: IdParamSchema },
      responses: {
        200: { description: 'Content item', content: { 'application/json': { schema: ContentGetResponseSchema } } },
        400: { description: 'Invalid id', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const item = await contentSvc.getContentItem(deps, id);
      if (!item) return c.json({ error: 'Not found' }, 404);
      return c.json({ item: serializeContentItem(item as never, deps.blobStorage) }, 200);
    },
  );

  // Metadata-only update. Body edits live at POST /content/:id/edit-body.
  app.openapi(
    createRoute({
      method: 'put',
      path: '/api/v1/content/{id}',
      tags: ['Content'],
      summary: 'Update content metadata (title, projects, tags)',
      request: {
        params: IdParamSchema,
        body: { content: { 'application/json': { schema: ContentUpdateRequestSchema } } },
      },
      responses: {
        200: { description: 'Updated', content: { 'application/json': { schema: ContentGetResponseSchema } } },
        400: { description: 'Invalid body', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const body = await c.req.json<{
        title?: string;
        content?: string;
        project_ids?: string[];
        tags?: string[];
        folder?: string | null;
      }>();
      if (body.content !== undefined) {
        return c.json({
          error: 'Body edits are not allowed on PUT /content/:id. Use POST /content/:id/edit-body instead (async, gated by body-immutability rule).',
        }, 400);
      }
      const item = await contentSvc.updateContentItem(deps, id, {
        title: body.title,
        projectIds: body.project_ids,
        tags: body.tags,
        folder: body.folder,
      });
      if (!item) return c.json({ error: 'Not found' }, 404);
      return c.json({ item: serializeContentItem(item as never, deps.blobStorage) }, 200);
    },
  );

  // Archive-and-reupload: the canonical "v2" path for blob-backed content.
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/content/{id}/replace',
      tags: ['Content'],
      summary: 'Replace content body via archive-and-reupload',
      request: {
        params: IdParamSchema,
        body: {
          content: {
            'application/json': { schema: ContentReplaceRequestSchema.extend({ title: z.string().optional() }) },
            'multipart/form-data': {
              schema: z.object({
                title: z.string().optional(),
                content: z.string().optional(),
                file: z.unknown().optional(),
              }),
            },
          },
        },
      },
      responses: {
        202: { description: 'Replacement queued', content: { 'application/json': { schema: ContentReplaceAckSchema } } },
        400: { description: 'Invalid', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
        409: { description: 'State conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const contentType = c.req.header('Content-Type') ?? '';

      let file: { data: Buffer; mimeType: string; filename: string } | undefined;
      let textContent: string | undefined;
      let title: string | undefined;

      if (contentType.includes('multipart/form-data')) {
        const body = await c.req.parseBody();
        title = typeof body.title === 'string' ? body.title : undefined;
        textContent = typeof body.content === 'string' ? body.content : undefined;
        const uploaded = body.file as File | undefined;
        if (uploaded && uploaded.size > 0) {
          file = {
            data: Buffer.from(await uploaded.arrayBuffer()),
            mimeType: resolveUploadMime(uploaded.type, uploaded.name),
            filename: uploaded.name,
          };
        }
      } else {
        const body = await c.req
          .json<{ content?: string; title?: string }>()
          .catch(() => ({} as { content?: string; title?: string }));
        textContent = body.content;
        title = body.title;
      }

      try {
        const result = await contentSvc.replaceContent(deps, id, { file, content: textContent, title });
        return c.json({ old_id: result.oldId, new_id: result.newId, status: result.status }, 202);
      } catch (err) {
        if (err instanceof contentSvc.ReplaceContentError) {
          if (err.code === 'NOT_FOUND') return c.json({ error: err.message }, 404);
          if (err.code === 'BAD_INPUT') return c.json({ error: err.message }, 400);
          return c.json({ error: err.message, code: err.code }, 409);
        }
        throw err;
      }
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/content/{id}/edit-body',
      tags: ['Content'],
      summary: 'Async edit a note body (re-chunk + re-embed)',
      request: {
        params: IdParamSchema,
        body: { content: { 'application/json': { schema: ContentEditBodyRequestSchema } } },
      },
      responses: {
        202: { description: 'Edit queued', content: { 'application/json': { schema: ContentIngestAckSchema } } },
        400: { description: 'Invalid', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
        409: { description: 'State conflict (blob-backed row)', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      try {
        const result = await contentSvc.editContentBody(deps, id, body.content);
        return c.json({ id: result.id, status: result.status }, 202);
      } catch (err) {
        if (err instanceof contentSvc.EditBodyError) {
          if (err.code === 'NOT_FOUND') return c.json({ error: err.message }, 404);
          return c.json({ error: err.message, code: err.code }, 409);
        }
        throw err;
      }
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/api/v1/content/{id}',
      tags: ['Content'],
      summary: 'Archive (default) or hard-delete a content item',
      request: { params: IdParamSchema, query: HardDeleteQuerySchema },
      responses: {
        200: { description: 'Deleted', content: { 'application/json': { schema: OkResponseSchema } } },
        400: { description: 'Invalid id', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const { hard } = c.req.valid('query');
      if (hard) {
        await contentSvc.deleteContentItemHardById(deps, id);
        return c.json({ ok: true, mode: 'hard' as const }, 200);
      }
      await contentSvc.archiveContentItemById(deps, id);
      return c.json({ ok: true, mode: 'archived' as const }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/content/{id}/restore',
      tags: ['Content'],
      summary: 'Unarchive a content item',
      request: { params: IdParamSchema },
      responses: {
        200: { description: 'Restored', content: { 'application/json': { schema: OkResponseSchema } } },
        400: { description: 'Invalid id', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      await contentSvc.unarchiveContentItemById(deps, id);
      return c.json({ ok: true }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/content/{id}/pin',
      tags: ['Content'],
      summary: 'Pin a content item',
      request: { params: IdParamSchema },
      responses: {
        200: { description: 'Pinned', content: { 'application/json': { schema: OkResponseSchema } } },
        400: { description: 'Invalid id', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const r = await contentSvc.pinContentItem(deps, id);
      if (!r.found) return c.json({ error: 'Not found' }, 404);
      return c.json({ ok: true, pinned: true }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/content/{id}/unpin',
      tags: ['Content'],
      summary: 'Unpin a content item',
      request: { params: IdParamSchema },
      responses: {
        200: { description: 'Unpinned', content: { 'application/json': { schema: OkResponseSchema } } },
        400: { description: 'Invalid id', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const r = await contentSvc.unpinContentItem(deps, id);
      if (!r.found) return c.json({ error: 'Not found' }, 404);
      return c.json({ ok: true, pinned: false }, 200);
    },
  );

  // Bulk ops on content_items. Schema-level validation handles the easy
  // cases; the handler keeps the action-aware checks (set_project_ids needs
  // a project_ids array; size cap; UUID-in-array validation).
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/content/bulk',
      tags: ['Content'],
      summary: 'Bulk operations on content items',
      request: { body: { content: { 'application/json': { schema: ContentBulkRequestSchema } } } },
      responses: {
        200: { description: 'Bulk result', content: { 'application/json': { schema: BulkResponseSchema } } },
        400: { description: 'Invalid', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      if (body.ids.length > 100) {
        return c.json({ error: 'bulk batch capped at 100 ids per request' }, 400);
      }
      try {
        const result = await contentSvc.bulkContent(deps, {
          ids: body.ids,
          action: body.action,
          tags: body.tags,
          project_ids: body.project_ids,
        });
        return c.json(result, 200);
      } catch (err) {
        if (err instanceof contentSvc.BulkContentValidationError) {
          return c.json({ error: err.message }, 400);
        }
        throw err;
      }
    },
  );

  // ==========================================================================
  // TODOS
  // ==========================================================================
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/todos',
      tags: ['Todos'],
      summary: 'List todos',
      request: { query: TodoListQuerySchema },
      responses: {
        200: { description: 'Todos', content: { 'application/json': { schema: TodoListResponseSchema } } },
        400: { description: 'Invalid query', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const q = c.req.valid('query');

      const pinned = parsePinned(q.pinned);
      if (pinned === 'invalid') {
        return c.json({ error: `Invalid pinned: "${q.pinned}". Expected true/false.` }, 400);
      }

      // parent_id "null" means top-level only, distinct from "no filter".
      let parent_id: string | null | undefined;
      if (q.parent_id === 'null') parent_id = null;
      else if (q.parent_id !== undefined) {
        if (!isValidUuid(q.parent_id)) {
          return c.json({ error: `Invalid parent_id: "${q.parent_id}". Expected UUID or "null".` }, 400);
        }
        parent_id = q.parent_id;
      }

      const tags = q.tags?.split(',').map((t) => t.trim()).filter(Boolean);

      let due_before: Date | undefined;
      let due_after: Date | undefined;
      if (q.due_before) {
        const d = new Date(q.due_before);
        if (isNaN(d.getTime())) return c.json({ error: `Invalid due_before: "${q.due_before}". Expected ISO 8601.` }, 400);
        due_before = d;
      }
      if (q.due_after) {
        const d = new Date(q.due_after);
        if (isNaN(d.getTime())) return c.json({ error: `Invalid due_after: "${q.due_after}". Expected ISO 8601.` }, 400);
        due_after = d;
      }

      const todos = await todosSvc.listTodos(deps, {
        project_id: q.project_id === 'null' ? null : q.project_id ?? undefined,
        parent_id,
        status: q.status,
        priority: q.priority,
        tags,
        due_before,
        due_after,
        pinned,
        limit: q.limit,
        include_archived: q.include_archived,
        before: q.before ? new Date(q.before) : undefined,
        q: q.q,
      });
      return c.json({ todos: todos.map((t) => serializeTodo(t)) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/todos',
      tags: ['Todos'],
      summary: 'Create a todo',
      request: { body: { content: { 'application/json': { schema: TodoCreateRequestSchema } } } },
      responses: {
        201: { description: 'Created', content: { 'application/json': { schema: TodoGetResponseSchema } } },
        400: { description: 'Invalid body', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      try {
        const todo = await todosSvc.createTodo(deps, {
          content: body.content,
          projectId: body.project_id ?? null,
          section: body.section ?? null,
          parentId: body.parent_id ?? null,
          priority: body.priority ?? null,
          dueDate: body.due_date ? new Date(body.due_date) : null,
          tags: body.tags,
        });
        return c.json({ todo: serializeTodo(todo) }, 201);
      } catch (err) {
        if (err instanceof todosSvc.TodoDepthExceededError) {
          return c.json({ error: err.message }, 400);
        }
        throw err;
      }
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/todos/{id}',
      tags: ['Todos'],
      summary: 'Get a todo',
      request: { params: IdParamSchema },
      responses: {
        200: { description: 'Todo', content: { 'application/json': { schema: TodoGetResponseSchema } } },
        400: { description: 'Invalid id', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const todo = await todosSvc.getTodo(deps, id);
      if (!todo) return c.json({ error: 'Not found' }, 404);
      return c.json({ todo: serializeTodo(todo) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/api/v1/todos/{id}',
      tags: ['Todos'],
      summary: 'Update a todo',
      request: {
        params: IdParamSchema,
        body: { content: { 'application/json': { schema: TodoUpdateRequestSchema } } },
      },
      responses: {
        200: { description: 'Updated', content: { 'application/json': { schema: TodoGetResponseSchema } } },
        400: { description: 'Invalid', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      try {
        const todo = await todosSvc.updateTodo(deps, id, {
          content: body.content,
          projectId: body.project_id === null ? null : body.project_id,
          // Distinguish "clear to Ungrouped" (null) from "don't touch"
          // (undefined) — `?? undefined` collapsed null and silently dropped
          // section-clear requests (same footgun as due_date below).
          section: body.section === undefined ? undefined : body.section,
          parentId: body.parent_id === null ? null : body.parent_id,
          status: body.status,
          priority: body.priority,
          // Distinguish "clear" (null) from "don't touch" (undefined). The
          // earlier shortcut `body.due_date ? ... : undefined` collapsed
          // null into undefined and silently dropped clear requests.
          dueDate: body.due_date === undefined
            ? undefined
            : body.due_date === null
              ? null
              : new Date(body.due_date),
          tags: body.tags,
        });
        if (!todo) return c.json({ error: 'Not found' }, 404);
        return c.json({ todo: serializeTodo(todo) }, 200);
      } catch (err) {
        if (err instanceof todosSvc.TodoDepthExceededError) {
          return c.json({ error: err.message }, 400);
        }
        throw err;
      }
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/api/v1/todos/{id}',
      tags: ['Todos'],
      summary: 'Archive (default) or hard-delete a todo',
      request: { params: IdParamSchema, query: HardDeleteQuerySchema },
      responses: {
        200: { description: 'Deleted', content: { 'application/json': { schema: OkResponseSchema } } },
        400: { description: 'Invalid id', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const { hard } = c.req.valid('query');
      if (hard) {
        await todosSvc.deleteTodoHardById(deps, id);
        return c.json({ ok: true, mode: 'hard' as const }, 200);
      }
      await todosSvc.archiveTodoById(deps, id);
      return c.json({ ok: true, mode: 'archived' as const }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/todos/{id}/restore',
      tags: ['Todos'],
      summary: 'Unarchive a todo',
      request: { params: IdParamSchema },
      responses: {
        200: { description: 'Restored', content: { 'application/json': { schema: OkResponseSchema } } },
        400: { description: 'Invalid id', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      await todosSvc.unarchiveTodoById(deps, id);
      return c.json({ ok: true }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/todos/{id}/pin',
      tags: ['Todos'],
      summary: 'Pin a todo',
      request: { params: IdParamSchema },
      responses: {
        200: { description: 'Pinned', content: { 'application/json': { schema: OkResponseSchema } } },
        400: { description: 'Invalid id', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const r = await todosSvc.pinTodo(deps, id);
      if (!r.found) return c.json({ error: 'Not found' }, 404);
      return c.json({ ok: true, pinned: true }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/todos/{id}/unpin',
      tags: ['Todos'],
      summary: 'Unpin a todo',
      request: { params: IdParamSchema },
      responses: {
        200: { description: 'Unpinned', content: { 'application/json': { schema: OkResponseSchema } } },
        400: { description: 'Invalid id', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const r = await todosSvc.unpinTodo(deps, id);
      if (!r.found) return c.json({ error: 'Not found' }, 404);
      return c.json({ ok: true, pinned: false }, 200);
    },
  );

  // Bulk ops on todos. Schema covers shape + action enum; handler keeps the
  // size cap and the due_date precondition (set_due_date with no due_date
  // field is a different signal than due_date=null).
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/todos/bulk',
      tags: ['Todos'],
      summary: 'Bulk operations on todos',
      request: { body: { content: { 'application/json': { schema: TodoBulkRequestSchema } } } },
      responses: {
        200: { description: 'Bulk result', content: { 'application/json': { schema: BulkResponseSchema } } },
        400: { description: 'Invalid', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      if (body.ids.length > 100) {
        return c.json({ error: 'bulk batch capped at 100 ids per request' }, 400);
      }

      let dueDate: Date | null | undefined = undefined;
      let hasDueDate = false;
      if (body.due_date !== undefined) {
        hasDueDate = true;
        if (body.due_date === null) {
          dueDate = null;
        } else {
          const d = new Date(body.due_date);
          if (isNaN(d.getTime())) {
            return c.json({ error: `Invalid due_date: "${body.due_date}". Expected ISO 8601 or null.` }, 400);
          }
          dueDate = d;
        }
      }

      try {
        const result = await todosSvc.bulkTodos(deps, {
          ids: body.ids,
          action: body.action,
          tags: body.tags,
          status: body.status,
          priority: body.priority ?? null,
          has_priority: body.priority !== undefined,
          project_id: body.project_id ?? null,
          has_project_id: body.project_id !== undefined,
          due_date: dueDate ?? null,
          has_due_date: hasDueDate,
        });
        return c.json(result, 200);
      } catch (err) {
        if (err instanceof todosSvc.BulkTodoValidationError) {
          return c.json({ error: err.message }, 400);
        }
        throw err;
      }
    },
  );

  // Manual reorder for a sibling group. The `ids` array IS the new
  // order — position 1..N becomes manual_order so subsequent listings
  // can sort the group by user intent. parent_id null = top-level
  // personal todos; UUID = children of that todo. Mismatched ids
  // (wrong parent / archived / not found) abort the whole reorder.
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/todos/reorder',
      tags: ['Todos'],
      summary: 'Persist a manual ordering for a sibling group of todos',
      request: { body: { content: { 'application/json': { schema: TodoReorderRequestSchema } } } },
      responses: {
        200: { description: 'Reorder result', content: { 'application/json': { schema: TodoReorderResponseSchema } } },
        400: { description: 'Invalid', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      if (body.ids.length > 500) {
        return c.json({ error: 'reorder batch capped at 500 ids per request' }, 400);
      }
      const result = await todosSvc.reorderTodos(deps, body.parent_id, body.ids);
      if (result.mismatched_ids.length > 0) {
        return c.json({
          error: `Reorder aborted: ${result.mismatched_ids.length} id(s) don't belong to this group or are archived/missing.`,
          ...result,
        }, 400);
      }
      return c.json(result, 200);
    },
  );

  // ==========================================================================
  // TODO COMMENTS
  // ==========================================================================
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/todos/{id}/comments',
      tags: ['Comments'],
      summary: 'List comments on a todo',
      request: { params: IdParamSchema },
      responses: {
        200: { description: 'Comments', content: { 'application/json': { schema: TodoCommentListResponseSchema } } },
        400: { description: 'Invalid id', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const comments = await commentsSvc.listComments(deps, id);
      return c.json({ comments: comments.map(serializeComment) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/todos/{id}/comments',
      tags: ['Comments'],
      summary: 'Add a comment to a todo',
      request: {
        params: IdParamSchema,
        body: { content: { 'application/json': { schema: TodoCommentCreateRequestSchema } } },
      },
      responses: {
        201: { description: 'Created', content: { 'application/json': { schema: TodoCommentResponseSchema } } },
        400: { description: 'Invalid', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const comment = await commentsSvc.createComment(deps, id, body.content);
      return c.json({ comment: serializeComment(comment) }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/api/v1/todos/{id}/comments/{cid}',
      tags: ['Comments'],
      summary: 'Update a comment',
      request: {
        params: CommentIdParamSchema,
        body: { content: { 'application/json': { schema: TodoCommentCreateRequestSchema } } },
      },
      responses: {
        200: { description: 'Updated', content: { 'application/json': { schema: OkResponseSchema } } },
        400: { description: 'Invalid', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { cid } = c.req.valid('param');
      const body = c.req.valid('json');
      await commentsSvc.updateComment(deps, cid, body.content);
      return c.json({ ok: true }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/api/v1/todos/{id}/comments/{cid}',
      tags: ['Comments'],
      summary: 'Delete a comment',
      request: { params: CommentIdParamSchema },
      responses: {
        200: { description: 'Deleted', content: { 'application/json': { schema: OkResponseSchema } } },
        400: { description: 'Invalid id', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { cid } = c.req.valid('param');
      await commentsSvc.deleteComment(deps, cid);
      return c.json({ ok: true }, 200);
    },
  );

  // ==========================================================================
  // SEARCH + RAG
  // ==========================================================================
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/search',
      tags: ['Search'],
      summary: 'Hybrid vector + graph search',
      request: { body: { content: { 'application/json': { schema: SearchRequestSchema } } } },
      responses: {
        200: { description: 'Search hits', content: { 'application/json': { schema: SearchResponseSchema } } },
        400: { description: 'Invalid', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const body = c.req.valid('json');

      // Cloud mode may seed graph expansion by classifying the query. Local
      // search uses entities from retrieved chunks: waiting for completion
      // here can exceed client deadlines on CPU and is not needed for retrieval.
      const graphEnabled = body.graph !== false;
      let queryEntities: Array<{ name: string; type: 'person' | 'org' | 'concept' | 'tool' | 'paper' }> = [];
      if (graphEnabled && deps.config.storageProvider !== 'local') {
        const classification = await classifyQueryDepth(deps, body.query);
        queryEntities = classification.entities;
      }

      // Translate the wire-level 'null' sentinel into the internal `null`
      // the search service understands — same shape as /content list uses.
      const hits = await searchSvc.search(deps, body.query, {
        projectId: body.project_id === 'null' ? null : body.project_id,
        entityTypes: body.entity_types,
        tags: body.tags,
        tagMatch: body.tag_match,
        contentItemIds: body.content_item_ids,
        excludedTags: body.excluded_tags,
        excludedEntityTypes: body.excluded_entity_types,
        excludedContentItemIds: body.excluded_content_item_ids,
        limit: body.limit ?? 10,
        threshold: body.threshold,
        graph: body.graph,
        queryEntities,
      });
      return c.json({ hits } as never, 200);
    },
  );

  // ==========================================================================
  // TAGS — aggregate view over content_items.tags + todos.tags
  // ==========================================================================
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/tags',
      tags: ['Tags'],
      summary: 'List tags with usage counts',
      request: { query: TagListQuerySchema },
      responses: {
        200: { description: 'Tags', content: { 'application/json': { schema: TagListResponseSchema } } },
        400: { description: 'Invalid query', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { project_id, scope } = c.req.valid('query');
      const tags = await tagsSvc.listTags(deps, { project_id, scope });
      return c.json({ tags }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/api/v1/tags/{name}',
      tags: ['Tags'],
      summary: 'Rename or merge a tag',
      request: {
        params: TagNameParamSchema,
        body: { content: { 'application/json': { schema: TagRenameRequestSchema } } },
      },
      responses: {
        200: { description: 'Renamed', content: { 'application/json': { schema: TagRenameResponseSchema } } },
        400: { description: 'Invalid', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { name: from } = c.req.valid('param');
      const { to } = c.req.valid('json');
      if (to === from) {
        return c.json({ from, to, updated: 0, noop: true }, 200);
      }
      const result = await tagsSvc.renameTag(deps, from, to);
      return c.json({ from, to, updated: result.updated }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/api/v1/tags/{name}',
      tags: ['Tags'],
      summary: 'Strip a tag from every row that has it',
      request: { params: TagNameParamSchema },
      responses: {
        200: { description: 'Deleted', content: { 'application/json': { schema: TagDeleteResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { name } = c.req.valid('param');
      const result = await tagsSvc.deleteTag(deps, name);
      return c.json({ name, updated: result.updated }, 200);
    },
  );

  // ==========================================================================
  // ACTIVITY — recent-changes feed across content_items + todos + comments
  // ==========================================================================
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/activity',
      tags: ['Activity'],
      summary: 'Recent-changes feed (ingest / edit / comment)',
      request: { query: ActivityListQuerySchema },
      responses: {
        200: { description: 'Activity events', content: { 'application/json': { schema: ActivityListResponseSchema } } },
        400: { description: 'Invalid query', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const q = c.req.valid('query');

      let since: Date | undefined;
      let until: Date | undefined;
      if (q.since) {
        const d = new Date(q.since);
        if (isNaN(d.getTime())) return c.json({ error: `Invalid since: "${q.since}". Expected ISO 8601.` }, 400);
        since = d;
      }
      if (q.until) {
        const d = new Date(q.until);
        if (isNaN(d.getTime())) return c.json({ error: `Invalid until: "${q.until}". Expected ISO 8601.` }, 400);
        until = d;
      }

      let kinds: ActivityKind[] | undefined;
      if (q.kinds) {
        const allowed = new Set<ActivityKind>(['ingest', 'edit', 'comment']);
        const values = q.kinds.split(',').map((s) => s.trim()).filter(Boolean);
        const bad = values.filter((v) => !allowed.has(v as ActivityKind));
        if (bad.length > 0) {
          return c.json({
            error: `Invalid kinds value(s): ${bad.join(', ')}. Allowed: ingest, edit, comment.`,
          }, 400);
        }
        kinds = values as ActivityKind[];
      }

      const limit = q.limit !== undefined ? Math.min(q.limit, 500) : undefined;

      const rows = await activitySvc.listActivity(deps, {
        since, until, project_id: q.project_id, kinds, limit,
      });
      return c.json({ events: rows } as never, 200);
    },
  );

  // ==========================================================================
  // STATS — inventory snapshot for dashboards
  // ==========================================================================
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/stats',
      tags: ['Stats'],
      summary: 'Inventory snapshot (counts, processing, freshness, top tags)',
      request: { query: StatsQuerySchema },
      responses: {
        200: { description: 'Stats', content: { 'application/json': { schema: StatsSchema } } },
        400: { description: 'Invalid query', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { project_id } = c.req.valid('query');
      const stats = await statsSvc.getStats(deps, project_id);
      return c.json(stats as never, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/find-mentions',
      tags: ['Search'],
      summary: 'Find chunks mentioning an entity by canonical name or alias',
      request: { body: { content: { 'application/json': { schema: FindMentionsRequestSchema } } } },
      responses: {
        200: { description: 'Mention hits', content: { 'application/json': { schema: FindMentionsResponseSchema } } },
        400: { description: 'Invalid', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const result = await searchSvc.findMentions(deps, body.entity, {
        type: body.type,
        projectId: body.project_id,
        limit: body.limit ?? 20,
      });
      return c.json(result as never, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/rag',
      tags: ['RAG'],
      summary: 'RAG synthesis (auto / fast / thorough depth)',
      request: { body: { content: { 'application/json': { schema: RagRequestSchema } } } },
      responses: {
        200: { description: 'Answer', content: { 'application/json': { schema: RagResponseSchema } } },
        400: { description: 'Invalid', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const result = await ragSvc.ragQuery(deps, body.question, {
        projectId: body.project_id,
        tags: body.tags,
        entityTypes: body.entity_types,
        maxChunks: body.max_chunks ?? 6,
        depth: body.depth ?? 'fast',
        reasoningEffort: body.reasoning_effort,
      });
      return c.json(result as never, 200);
    },
  );

  // ==========================================================================
  // Diagnostics — read-only introspection of the entity graph layer.
  // ==========================================================================
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/diagnostics/entities',
      tags: ['Diagnostics'],
      summary: 'List entities with edge counts',
      request: { query: DiagnosticsEntitiesQuerySchema },
      responses: {
        200: { description: 'Entities', content: { 'application/json': { schema: DiagnosticsEntitiesResponseSchema } } },
        400: { description: 'Invalid query', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { limit } = c.req.valid('query');
      const result = await deps.db.query(
        `SELECT e.id, e.canonical_name, e.type, e.aliases,
                array_length(e.aliases, 1) AS alias_count,
                (SELECT count(*)::int FROM chunk_entities ce WHERE ce.entity_id = e.id) AS edge_count,
                (SELECT count(DISTINCT c.content_item_id)::int
                   FROM chunk_entities ce
                   JOIN chunks c ON c.id = ce.chunk_id
                  WHERE ce.entity_id = e.id) AS doc_count
           FROM entities e
          ORDER BY edge_count DESC, e.canonical_name ASC
          LIMIT $1`,
        [limit ?? 100],
      );
      return c.json({ entities: result.rows }, 200);
    },
  );

  // POST /api/v1/diagnostics/backfill-entities — re-run entity extraction.
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/diagnostics/backfill-entities',
      tags: ['Diagnostics'],
      summary: 'Re-extract entities for a content item or the whole corpus',
      request: {
        body: {
          content: { 'application/json': { schema: DiagnosticsBackfillRequestSchema } },
          required: false,
        },
      },
      responses: {
        200: { description: 'Backfill report', content: { 'application/json': { schema: DiagnosticsBackfillResponseSchema } } },
        400: { description: 'Invalid', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { buildGraphEdges } = await import('./services/entities.js');
      const { getChunksByContentItem } = await import('./db/chunks.js');

      let body: { content_item_id?: string } = {};
      try { body = await c.req.json(); } catch { /* empty body OK */ }

      const targetId = body.content_item_id;
      const itemQuery = targetId
        ? `SELECT id, title, content FROM content_items WHERE id = $1 AND archived = false`
        : `SELECT id, title, content FROM content_items WHERE archived = false AND content IS NOT NULL ORDER BY created_at ASC`;
      const items = await deps.db.query(itemQuery, targetId ? [targetId] : []);

      const results: Array<{ id: string; title: string; entity_count: number; edge_count: number; error?: string }> = [];
      for (const row of items.rows) {
        try {
          const chunks = await getChunksByContentItem(deps.db, row.id);
          if (chunks.length === 0) {
            results.push({ id: row.id, title: row.title, entity_count: 0, edge_count: 0, error: 'no chunks' });
            continue;
          }
          const r = await buildGraphEdges(deps, row.content ?? '', chunks);
          results.push({ id: row.id, title: row.title, entity_count: r.entityCount, edge_count: r.edgeCount });
        } catch (err) {
          results.push({
            id: row.id, title: row.title, entity_count: 0, edge_count: 0,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return c.json({ processed: results.length, results }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/diagnostics/content/{id}/edges',
      tags: ['Diagnostics'],
      summary: 'List chunk-entity edges for one content item',
      request: { params: IdParamSchema },
      responses: {
        200: { description: 'Edges', content: { 'application/json': { schema: DiagnosticsEdgesResponseSchema } } },
        400: { description: 'Invalid id', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const result = await deps.db.query(
        `SELECT c.id AS chunk_id, c.chunk_index,
                e.id AS entity_id, e.canonical_name, e.type,
                ce.confidence, ce.mention_text
           FROM chunks c
           JOIN chunk_entities ce ON ce.chunk_id = c.id
           JOIN entities e ON e.id = ce.entity_id
          WHERE c.content_item_id = $1
          ORDER BY c.chunk_index ASC, ce.confidence DESC`,
        [id],
      );
      return c.json({
        content_item_id: id,
        edge_count: result.rows.length,
        edges: result.rows,
      }, 200);
    },
  );

  // ==========================================================================
  // MCP endpoint — stateless mode (sessionIdGenerator: undefined).
  // Each request gets a fresh server + transport. No session persistence,
  // no "server already initialized" issues, no session-id header dance.
  // Correct for simple per-request tool calls like what Claude.ai MCP uses.
  // ==========================================================================
  app.all('/mcp', async (c) => {
    console.log(`[mcp] ${c.req.method} incoming`);
    try {
      const server = createMcpServer(deps);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,   // stateless: no session tracking
        enableJsonResponse: true,
      });
      await server.connect(transport);
      const response = await transport.handleRequest(c.req.raw);
      console.log(`[mcp] responding with status ${response.status}`);
      return response;
    } catch (err) {
      console.error(`[mcp] handler crashed:`, err);
      return c.json({ error: 'MCP handler error', detail: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  // ==========================================================================
  // Static web UI (served last, after API + MCP so they take precedence)
  // ==========================================================================
  app.use('/*', serveStatic({ root: './frontend/dist' }));
  app.get('*', serveStatic({ path: './frontend/dist/index.html' }));

  return app;
}

// ---------------------------------------------------------------------------
// Wire serializers — convert pg Date columns to ISO strings so OpenAPI
// response validation (z.string().datetime) accepts them. Without these the
// `app.openapi(...)` response check would reject Date objects since they're
// not strings on the wire — even though JSON.stringify would coerce them.
// ---------------------------------------------------------------------------

function isoOrNull(d: Date | string | null | undefined): string | null {
  if (d === null || d === undefined) return null;
  return d instanceof Date ? d.toISOString() : d;
}

function isoNonNull(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : d;
}

function serializeProject(p: {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'archived' | 'completed';
  pinned_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    status: p.status,
    pinned_at: isoOrNull(p.pinned_at),
    created_at: isoNonNull(p.created_at),
    updated_at: isoNonNull(p.updated_at),
  };
}

function serializeTodo<T extends {
  embedding?: unknown;
  pinned_at?: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  due_date?: Date | string | null;
}>(t: T) {
  const { embedding: _embedding, ...rest } = t;
  const due = rest.due_date;
  return {
    ...rest,
    pinned_at: rest.pinned_at !== undefined ? isoOrNull(rest.pinned_at) : null,
    created_at: isoNonNull(rest.created_at),
    updated_at: isoNonNull(rest.updated_at),
    // due_date is a `timestamptz` column — preserve the full ISO so the
    // UI can render time-of-day (and so notification scheduling has the
    // resolution it needs). Defensive against either Date-from-pg or
    // already-stringified shape.
    due_date: due === null || due === undefined
      ? null
      : due instanceof Date ? due.toISOString() : due,
  };
}

function serializeContentItem(
  it: { embedding?: unknown } & Record<string, unknown>,
  blobStorage: BlobStorage,
): z.infer<typeof ContentItemSchema> {
  const { embedding: _e, ...rest } = it as Record<string, unknown>;
  const rawBlob = rest.blob_url as string | null | undefined;
  const blob_url = rawBlob ? blobStorage.getReadSasUrl(rawBlob) : null;
  // Pick a filename for the Content-Disposition override on the download SAS.
  // Title is what the user sees in the UI; falls back to "document" so the
  // browser never offers a UUID as a save name. Extension comes from mime so
  // a PDF saved from "My Doc" lands as "My Doc.pdf" instead of extensionless.
  const download_url = rawBlob
    ? blobStorage.getDownloadSasUrl(rawBlob, downloadFilename(rest))
    : null;
  return {
    ...rest,
    blob_url,
    download_url,
    pinned_at: rest.pinned_at !== undefined && rest.pinned_at !== null
      ? isoOrNull(rest.pinned_at as Date | string | null)
      : null,
    created_at: isoNonNull(rest.created_at as Date | string),
    updated_at: isoNonNull(rest.updated_at as Date | string),
    ingest_completed_at: isoOrNull(rest.ingest_completed_at as Date | string | null | undefined),
    published_at: isoOrNull(rest.published_at as Date | string | null | undefined),
  } as unknown as z.infer<typeof ContentItemSchema>;
}


function serializeComment(c: {
  id: string;
  todo_id: string;
  content: string;
  created_at: Date | string;
  updated_at: Date | string;
}) {
  return {
    id: c.id,
    todo_id: c.todo_id,
    content: c.content,
    created_at: isoNonNull(c.created_at),
    updated_at: isoNonNull(c.updated_at),
  };
}

// `parent_id` accepts a UUID OR the literal "null" — the OpenAPI schema
// declares it as a plain string, so the handler still has to validate the
// uuid case manually.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(s: string): boolean {
  return UUID_RE.test(s);
}

/**
 * Parse a `?pinned=` query string param into a tri-state:
 *   undefined → no filter (param wasn't sent at all)
 *   true / false → strict boolean
 *   'invalid' sentinel → caller should 400 with the original raw value
 */
function parsePinned(raw: string | undefined): boolean | undefined | 'invalid' {
  if (raw === undefined) return undefined;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return 'invalid';
}
