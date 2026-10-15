// shared/src/schemas.ts
//
// Single source of truth for entity shapes that cross the API boundary.
// Both backend (request validation, response types) and frontend (response
// parsing, react-query types) import from here.
//
// Conventions:
//   - Schemas are the canonical artifact. Types are derived via z.infer.
//   - Responses match what the backend ACTUALLY returns today, not what an
//     idealized API would return. (E.g. Stats has nested counts because
//     the existing /api/v1/stats handler returns it that way.)
//   - Where the API differs from how it should look long-term, document
//     here so a future cleanup pass has a starting point.

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const UuidSchema = z.string().uuid();

export const ProjectStatusSchema = z.enum(['active', 'archived', 'completed']);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ContentTypeSchema = z.enum(['document', 'note']);
export type ContentType = z.infer<typeof ContentTypeSchema>;

export const ProcessingStatusSchema = z.enum(['pending', 'ready', 'failed']);
export type ProcessingStatus = z.infer<typeof ProcessingStatusSchema>;

export const TodoStatusSchema = z.enum(['not_started', 'in_progress', 'paused', 'done']);
export type TodoStatus = z.infer<typeof TodoStatusSchema>;

export const PrioritySchema = z.enum(['P1', 'P2', 'P3']);
export type Priority = z.infer<typeof PrioritySchema>;

export const ActivityKindSchema = z.enum(['ingest', 'edit', 'comment']);
export type ActivityKind = z.infer<typeof ActivityKindSchema>;

export const EntityKindSchema = z.enum(['document', 'note', 'todo']);
export type EntityKind = z.infer<typeof EntityKindSchema>;

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

// Projects don't have a separate `archived` boolean — `status: 'archived'`
// represents the archived state. ProjectStatusSchema covers all three cases.
export const ProjectSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  status: ProjectStatusSchema,
  pinned_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type Project = z.infer<typeof ProjectSchema>;

export const ProjectListResponseSchema = z.object({
  projects: z.array(ProjectSchema),
});
export type ProjectListResponse = z.infer<typeof ProjectListResponseSchema>;

export const ProjectGetResponseSchema = z.object({
  project: ProjectSchema,
});
export type ProjectGetResponse = z.infer<typeof ProjectGetResponseSchema>;

export const ProjectCreateRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  status: ProjectStatusSchema.optional(),
});
export type ProjectCreateRequest = z.infer<typeof ProjectCreateRequestSchema>;

export const ProjectUpdateRequestSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  status: ProjectStatusSchema.optional(),
});
export type ProjectUpdateRequest = z.infer<typeof ProjectUpdateRequestSchema>;

export const ProjectListQuerySchema = z.object({
  status: ProjectStatusSchema.optional(),
  pinned: z.coerce.boolean().optional(),
});
export type ProjectListQuery = z.infer<typeof ProjectListQuerySchema>;

// Per-project aggregate counts. Returned by GET /projects/counts so a
// dashboard can render N project cards without N+1 round-trips. Counts are
// over non-archived rows only (matches the live workspace view).
export const ProjectCountsSchema = z.object({
  project_id: UuidSchema,
  documents: z.number().int().nonnegative(),
  notes: z.number().int().nonnegative(),
  todos: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
});
export type ProjectCounts = z.infer<typeof ProjectCountsSchema>;

export const ProjectCountsListResponseSchema = z.object({
  counts: z.array(ProjectCountsSchema),
});
export type ProjectCountsListResponse = z.infer<typeof ProjectCountsListResponseSchema>;

// ---------------------------------------------------------------------------
// Content (documents + notes)
// ---------------------------------------------------------------------------

export const TitleSourceSchema = z.enum(['user', 'ai_generated', 'filename']);
export type TitleSource = z.infer<typeof TitleSourceSchema>;

export const ContentItemSchema = z.object({
  id: UuidSchema,
  type: ContentTypeSchema,
  title: z.string(),
  title_source: TitleSourceSchema,
  content: z.string().nullable(),
  blob_url: z.string().nullable(),
  download_url: z.string().nullable(),
  source_url: z.string().nullable(),
  mime_type: z.string().nullable(),
  file_hash: z.string().nullable(),
  project_ids: z.array(UuidSchema),
  tags: z.array(z.string()),
  // Single hierarchical folder path (e.g. "cooking/italian"), or null when
  // unfiled. First-class field — distinct from flat tags — so a single-segment
  // path is a valid top-level folder. Drives the Notes view folder tree.
  folder: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  processing_status: ProcessingStatusSchema,
  processing_error: z.string().nullable(),
  archived: z.boolean(),
  pinned_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
  ingest_completed_at: z.string().datetime({ offset: true }).nullable(),
  published_at: z.string().datetime({ offset: true }).nullable(),
});
export type ContentItem = z.infer<typeof ContentItemSchema>;

export const ContentListResponseSchema = z.object({
  items: z.array(ContentItemSchema),
});
export type ContentListResponse = z.infer<typeof ContentListResponseSchema>;

// POST /content returns the async ingest envelope, NOT the full item.
export const ContentCreateResponseSchema = z.object({
  id: UuidSchema,
  status: ProcessingStatusSchema,
});
export type ContentCreateResponse = z.infer<typeof ContentCreateResponseSchema>;

// GET /content/:id returns a single item under `item`.
export const ContentGetResponseSchema = z.object({
  item: ContentItemSchema,
});
export type ContentGetResponse = z.infer<typeof ContentGetResponseSchema>;

// JSON body for note creation. Document uploads use multipart and aren't
// covered here — they need a separate non-JSON path.
export const NoteCreateRequestSchema = z.object({
  type: z.literal('note'),
  title: z.string().min(1),
  content: z.string().min(1),
  project_ids: z.array(UuidSchema).default([]),
  tags: z.array(z.string()).default([]),
  // Optional folder path the note is filed under at creation. null/omitted =
  // unfiled. Normalized server-side is unnecessary — callers pass a clean path.
  folder: z.string().nullable().optional(),
});
export type NoteCreateRequest = z.infer<typeof NoteCreateRequestSchema>;

export const ContentUpdateRequestSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().optional(),
  project_ids: z.array(UuidSchema).optional(),
  tags: z.array(z.string()).optional(),
  // Re-file the note into a folder, or pass null to unfile it (move to root /
  // All Notes). Omit to leave the folder unchanged.
  folder: z.string().nullable().optional(),
});
export type ContentUpdateRequest = z.infer<typeof ContentUpdateRequestSchema>;

// Query for GET /content. Several params take string forms that don't map
// cleanly to z.coerce — `processing_status` accepts a comma-separated list
// like "pending,failed", and `pinned` accepts true/1/false/0. We accept the
// raw strings here and let the handler do the multi-valued parsing so this
// schema doubles as accurate OpenAPI documentation.
export const ContentListQuerySchema = z.object({
  type: ContentTypeSchema.optional(),
  // Either a UUID (rows whose project_ids array contains this UUID) or the
  // literal string 'null' (rows with no project membership at all). Mirrors
  // the contract on /todos so personal-scope queries are uniform across
  // entity types.
  project_id: z.union([UuidSchema, z.literal('null')]).optional(),
  tags: z.string().optional(),
  processing_status: z.string().optional(),
  pinned: z.string().optional(),
  include_archived: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().optional(),
  /** Keyset pagination cursor — ISO timestamp; returns rows strictly
   *  older than this `created_at`. Pair with `limit` for infinite
   *  scroll. Independent of `pinned` ordering (which uses pinned_at). */
  before: z.string().datetime({ offset: true }).optional(),
  /** Substring filter — case-insensitive match against title OR content.
   *  Empty / whitespace-only is treated as "no filter" by the handler. */
  q: z.string().optional(),
});
export type ContentListQuery = z.infer<typeof ContentListQuerySchema>;

export const ContentStatusResponseSchema = z.object({
  id: UuidSchema,
  processing_status: ProcessingStatusSchema,
  processing_error: z.string().nullable(),
  ingest_completed_at: z.string().datetime({ offset: true }).nullable(),
});
export type ContentStatusResponse = z.infer<typeof ContentStatusResponseSchema>;

// `url` validation custom-messaged so the on-the-wire error matches the
// pre-OpenAPIHono shape; project_ids accept any string for the same reason
// content/POST does (handler / service layer enforces UUID semantics).
export const UrlIngestRequestSchema = z.object({
  url: z.string({ required_error: 'url is required' }).min(1, 'url is required'),
  project_ids: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  title: z.string().optional(),
});
export type UrlIngestRequest = z.infer<typeof UrlIngestRequestSchema>;

// ---------------------------------------------------------------------------
// Todo + comments
// ---------------------------------------------------------------------------

// `pinned_at` and `comment_count` are optional because the search response
// embeds a slimmer todo (omits pinned_at) while listTodos returns the full
// row. similarity is added when a todo appears as a search result.
export const TodoSchema = z.object({
  id: UuidSchema,
  content: z.string(),
  project_id: UuidSchema.nullable(),
  parent_id: UuidSchema.nullable(),
  section: z.string().nullable(),
  status: TodoStatusSchema,
  priority: PrioritySchema.nullable(),
  due_date: z.string().nullable(),
  tags: z.array(z.string()),
  archived: z.boolean(),
  pinned_at: z.string().datetime({ offset: true }).nullable().optional(),
  manual_order: z.number().int().nullable().optional(),
  comment_count: z.number().int().nonnegative().optional(),
  subtask_count: z.number().int().nonnegative().optional(),
  similarity: z.number().optional(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type Todo = z.infer<typeof TodoSchema>;

export const TodoListResponseSchema = z.object({
  todos: z.array(TodoSchema),
});
export type TodoListResponse = z.infer<typeof TodoListResponseSchema>;

export const TodoGetResponseSchema = z.object({
  todo: TodoSchema,
});
export type TodoGetResponse = z.infer<typeof TodoGetResponseSchema>;

export const TodoCreateRequestSchema = z.object({
  content: z.string().min(1),
  project_id: UuidSchema.nullable().optional(),
  parent_id: UuidSchema.nullable().optional(),
  section: z.string().nullable().optional(),
  priority: PrioritySchema.optional(),
  due_date: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
export type TodoCreateRequest = z.infer<typeof TodoCreateRequestSchema>;

export const TodoUpdateRequestSchema = z.object({
  content: z.string().min(1).optional(),
  project_id: UuidSchema.nullable().optional(),
  parent_id: UuidSchema.nullable().optional(),
  section: z.string().nullable().optional(),
  status: TodoStatusSchema.optional(),
  priority: PrioritySchema.nullable().optional(),
  due_date: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
});
export type TodoUpdateRequest = z.infer<typeof TodoUpdateRequestSchema>;

// `project_id` accepts a UUID or the literal "null" (inbox); `parent_id`
// the same. `tags`, `pinned`, `due_before`, `due_after`, `limit` are
// validated by the handler so the schema reflects the wire surface.
export const TodoListQuerySchema = z.object({
  project_id: z.string().optional(),
  parent_id: z.string().optional(),
  status: TodoStatusSchema.optional(),
  priority: PrioritySchema.optional(),
  tags: z.string().optional(),
  due_before: z.string().optional(),
  due_after: z.string().optional(),
  pinned: z.string().optional(),
  include_archived: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().optional(),
  /** Keyset pagination cursor — ISO timestamp; returns rows strictly
   *  older than this `created_at`. Pair with `limit` for infinite
   *  scroll. */
  before: z.string().datetime({ offset: true }).optional(),
  /** Substring filter — case-insensitive match against `content`.
   *  Empty / whitespace-only is treated as "no filter" by the handler. */
  q: z.string().optional(),
});
export type TodoListQuery = z.infer<typeof TodoListQuerySchema>;

export const TodoCommentSchema = z.object({
  id: UuidSchema,
  todo_id: UuidSchema,
  content: z.string(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type TodoComment = z.infer<typeof TodoCommentSchema>;

export const TodoCommentListResponseSchema = z.object({
  comments: z.array(TodoCommentSchema),
});
export type TodoCommentListResponse = z.infer<typeof TodoCommentListResponseSchema>;

export const TodoCommentCreateRequestSchema = z.object({
  content: z.string().min(1),
});
export type TodoCommentCreateRequest = z.infer<typeof TodoCommentCreateRequestSchema>;

// ---------------------------------------------------------------------------
// Search / RAG
// ---------------------------------------------------------------------------

// One step in the retrieval pipeline. Vector and rrf steps carry a numeric
// score; graph/entity steps carry the seed entity that pulled the chunk in
// (with the confidence as the relevance signal). Both shapes share `step`.
export const RetrievalStepSchema = z.object({
  step: z.string(), // 'vector' | 'entity' | 'rrf' — kept open for graph evolution
  // Nullable, not just optional: a step that didn't contribute a numeric
  // signal (e.g. the `vector` step on a lexical-only hit) comes back as
  // `null`, not absent. Same reason similarity/vector_score are nullable.
  score: z.number().nullable().optional(),
  entity: z.object({
    canonical_name: z.string(),
    type: z.string(),
  }).optional(),
  confidence: z.number().nullable().optional(),
});
export type RetrievalStep = z.infer<typeof RetrievalStepSchema>;

// Search returns a discriminated union: chunk hits (from documents/notes) and
// todo hits. They have very different shapes so we keep them as a union and
// let the consumer narrow on `.type`.
const ChunkBaseSchema = z.object({
  id: UuidSchema,
  content_item_id: UuidSchema,
  chunk_index: z.number().int(),
  chunk_type: z.string(),
  content: z.string(),
  metadata: z.record(z.unknown()).nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
  // Nullable: hits from the lexical/graph arms with no vector match carry
  // no cosine similarity (mirrors vector_score, which is already nullable).
  similarity: z.number().nullable(),
  parent_type: ContentTypeSchema,
  parent_title: z.string(),
  parent_project_ids: z.array(UuidSchema),
  parent_tags: z.array(z.string()),
  parent_source_url: z.string().nullable(),
});

export const ChunkHitSchema = z.object({
  type: z.literal('chunk'),
  // Nullable: hits from the lexical/graph arms with no vector match carry
  // no cosine similarity (mirrors vector_score, which is already nullable).
  similarity: z.number().nullable(),
  final_score: z.number(),
  vector_score: z.number().nullable().optional(),
  retrieval_path: z.array(RetrievalStepSchema),
  chunk: ChunkBaseSchema,
});

export const TodoHitSchema = z.object({
  type: z.literal('todo'),
  // Nullable: hits from the lexical/graph arms with no vector match carry
  // no cosine similarity (mirrors vector_score, which is already nullable).
  similarity: z.number().nullable(),
  final_score: z.number().optional(),
  vector_score: z.number().nullable().optional(),
  retrieval_path: z.array(RetrievalStepSchema),
  todo: TodoSchema,
});

export const SearchHitSchema = z.discriminatedUnion('type', [ChunkHitSchema, TodoHitSchema]);
export type SearchHit = z.infer<typeof SearchHitSchema>;

export const SearchRequestSchema = z.object({
  // Empty string is allowed: callers may send predicate-only requests
  // (e.g. just tag/project filters with no free text), in which case the
  // backend takes the filter-only listing path and skips embedding +
  // vector + graph arms.
  query: z.string(),
  // UUID = scope to a specific project. 'null' literal = personal scope:
  // chunks whose parent content_item has no project_ids and todos whose
  // project_id IS NULL. Omitted = global (all projects + personal).
  project_id: z.union([UuidSchema, z.literal('null')]).optional(),
  entity_types: z.array(EntityKindSchema).optional(),
  tags: z.array(z.string()).optional(),
  /** How to combine multiple `tags`: 'all' = the item must carry every tag
   *  (AND — the default, and back-compat), 'any' = the item carries at least
   *  one (OR). Mirrors the Home tag-filter AND/OR toggle. No effect with
   *  fewer than 2 tags. */
  tag_match: z.enum(['all', 'any']).optional(),
  /** Restrict results to chunks/todos belonging to these specific content
   *  items. Drives the `@<name>` mention predicate in the universal
   *  search bar — the frontend resolves @-titles to content_item UUIDs
   *  before submitting. */
  content_item_ids: z.array(UuidSchema).optional(),
  /** Exclusion filters (driven by `-#tag`, `-in:type`, `-@name`
   *  predicates in the universal search bar). Each list is applied as
   *  a NOT-matches predicate on its respective field. */
  excluded_tags: z.array(z.string()).optional(),
  excluded_entity_types: z.array(EntityKindSchema).optional(),
  excluded_content_item_ids: z.array(UuidSchema).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  threshold: z.number().min(0).max(1).optional(),
  graph: z.boolean().optional(),
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;

export const SearchResponseSchema = z.object({
  hits: z.array(SearchHitSchema),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

export const RagCitationSchema = z.object({
  id: UuidSchema,
  content_item_id: UuidSchema,
  title: z.string(),
  excerpt: z.string(),
  source_url: z.string().nullable().optional(),
});
export type RagCitation = z.infer<typeof RagCitationSchema>;

export const RagRequestSchema = z.object({
  question: z.string().min(1),
  project_id: UuidSchema.optional(),
  depth: z.enum(['auto', 'fast', 'thorough']).optional(),
  max_chunks: z.number().int().min(1).max(20).optional(),
  entity_types: z.array(EntityKindSchema).optional(),
  tags: z.array(z.string()).optional(),
  reasoning_effort: z.enum(['low', 'medium', 'high']).optional(),
});
export type RagRequest = z.infer<typeof RagRequestSchema>;

export const RagResponseSchema = z.object({
  answer: z.string(),
  citations: z.array(RagCitationSchema),
  used_chunks: z.number().int().nonnegative(),
  meta: z.object({
    depth_used: z.enum(['fast', 'thorough']).nullable().optional(),
    depth_reason: z.string().nullable().optional(),
    timings_ms: z.record(z.number()).optional(),
  }),
});
export type RagResponse = z.infer<typeof RagResponseSchema>;

export const FindMentionsRequestSchema = z.object({
  entity: z.string().min(1),
  type: z.enum(['person', 'org', 'concept', 'tool', 'paper']).optional(),
  project_id: UuidSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export type FindMentionsRequest = z.infer<typeof FindMentionsRequestSchema>;

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

// /tags response shape: each tag has total + per-entity-type breakdown.
// Stats top_tags returns the slimmer shape (name + count); aliased so both
// callers can find what they expect.
export const TagSchema = z.object({
  name: z.string(),
  total: z.number().int().nonnegative(),
  by_type: z.object({
    document: z.number().int().nonnegative(),
    note: z.number().int().nonnegative(),
    todo: z.number().int().nonnegative(),
  }),
});
export type Tag = z.infer<typeof TagSchema>;

export const TagSummarySchema = z.object({
  name: z.string(),
  count: z.number().int().nonnegative(),
});
export type TagSummary = z.infer<typeof TagSummarySchema>;

export const TagListResponseSchema = z.object({
  tags: z.array(TagSchema),
});
export type TagListResponse = z.infer<typeof TagListResponseSchema>;

export const TagRenameRequestSchema = z.object({
  to: z.string().min(1),
});
export type TagRenameRequest = z.infer<typeof TagRenameRequestSchema>;

export const TagRenameResponseSchema = z.object({
  from: z.string(),
  to: z.string(),
  updated: z.number().int().nonnegative(),
  noop: z.boolean().optional(),
});
export type TagRenameResponse = z.infer<typeof TagRenameResponseSchema>;

export const TagDeleteResponseSchema = z.object({
  name: z.string(),
  updated: z.number().int().nonnegative(),
});
export type TagDeleteResponse = z.infer<typeof TagDeleteResponseSchema>;

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

// Activity events can reference a comment too, so entity_type is wider than
// the regular EntityKind enum. project_ids is an array because content_items
// can be in multiple projects (todos always have a single project_id but the
// activity stream returns it wrapped in an array for uniformity).
export const ActivityEntityTypeSchema = z.enum(['document', 'note', 'todo', 'todo_comment']);
export type ActivityEntityType = z.infer<typeof ActivityEntityTypeSchema>;

export const ActivityEventSchema = z.object({
  at: z.string().datetime({ offset: true }),
  kind: ActivityKindSchema,
  entity_type: ActivityEntityTypeSchema,
  entity_id: UuidSchema,
  title: z.string(),
  project_ids: z.array(UuidSchema),
});
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

export const ActivityListResponseSchema = z.object({
  events: z.array(ActivityEventSchema),
});
export type ActivityListResponse = z.infer<typeof ActivityListResponseSchema>;

export const ActivityListQuerySchema = z.object({
  since: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional(),
  kinds: z.string().optional(),
  project_id: UuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
export type ActivityListQuery = z.infer<typeof ActivityListQuerySchema>;

// ---------------------------------------------------------------------------
// Stats — note the nested shape that the existing /api/v1/stats handler
// returns. Frontend will display flatter, but the API contract is nested.
// ---------------------------------------------------------------------------

// Freshness fields are ISO timestamp strings (or null). The frontend converts
// to relative-time strings via util fmtRel() at render time, not on the wire.
export const StatsSchema = z.object({
  counts: z.object({
    documents: z.number().int().nonnegative(),
    notes: z.number().int().nonnegative(),
    chunks: z.number().int().nonnegative(),
    comments: z.number().int().nonnegative(),
    todos: z.object({
      total: z.number().int().nonnegative(),
      not_started: z.number().int().nonnegative(),
      in_progress: z.number().int().nonnegative(),
      done: z.number().int().nonnegative(),
    }),
    projects: z.object({
      total: z.number().int().nonnegative(),
      active: z.number().int().nonnegative(),
      archived: z.number().int().nonnegative(),
      completed: z.number().int().nonnegative(),
    }),
  }),
  processing: z.object({
    pending: z.number().int().nonnegative(),
    ready: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  freshness: z.object({
    last_ingest_at: z.string().datetime({ offset: true }).nullable(),
    last_edit_at: z.string().datetime({ offset: true }).nullable(),
    last_comment_at: z.string().datetime({ offset: true }).nullable(),
  }),
  top_tags: z.array(TagSummarySchema),
});
export type Stats = z.infer<typeof StatsSchema>;

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------

// Per-entity action sets are kept distinct because the wire shape differs:
// `set_project_ids` is content-only (multi-project), `set_project_id` is
// todo-only (single project), `set_status`/`set_priority`/`set_due_date`
// are todo-only.
export const ContentBulkActionSchema = z.enum([
  'archive', 'restore', 'delete', 'add_tags', 'remove_tags', 'set_project_ids',
]);
export type ContentBulkAction = z.infer<typeof ContentBulkActionSchema>;

export const TodoBulkActionSchema = z.enum([
  'archive', 'restore', 'delete', 'add_tags', 'remove_tags',
  'set_status', 'set_priority', 'set_project_id', 'set_due_date',
]);
export type TodoBulkAction = z.infer<typeof TodoBulkActionSchema>;

// Wire validation here is intentionally loose — the handler does richer
// per-action validation (e.g. set_project_ids requires project_ids to be
// present, set_project_id allows null). Keeping the schema permissive lets
// the handler emit the existing precise error messages and lets old test
// fixtures keep working.
export const ContentBulkRequestSchema = z.object({
  ids: z.array(UuidSchema).min(1),
  action: ContentBulkActionSchema,
  tags: z.array(z.string()).optional(),
  project_ids: z.array(UuidSchema).optional(),
});
export type ContentBulkRequest = z.infer<typeof ContentBulkRequestSchema>;

export const TodoBulkRequestSchema = z.object({
  ids: z.array(UuidSchema).min(1),
  action: TodoBulkActionSchema,
  tags: z.array(z.string()).optional(),
  status: TodoStatusSchema.optional(),
  priority: PrioritySchema.nullable().optional(),
  project_id: UuidSchema.nullable().optional(),
  due_date: z.string().nullable().optional(),
});
export type TodoBulkRequest = z.infer<typeof TodoBulkRequestSchema>;

export const BulkResponseSchema = z.object({
  requested: z.number().int().nonnegative(),
  affected: z.number().int().nonnegative(),
  missing_ids: z.array(UuidSchema),
});
export type BulkResponse = z.infer<typeof BulkResponseSchema>;

// Manual reorder for a sibling group of todos.
//   - parent_id null   → top-level personal todos
//   - parent_id UUID   → children of that todo
// `ids` IS the new order; position 1..N becomes manual_order.
export const TodoReorderRequestSchema = z.object({
  parent_id: UuidSchema.nullable(),
  ids: z.array(UuidSchema).min(1),
});
export type TodoReorderRequest = z.infer<typeof TodoReorderRequestSchema>;

export const TodoReorderResponseSchema = z.object({
  updated: z.number().int().nonnegative(),
  mismatched_ids: z.array(UuidSchema),
});
export type TodoReorderResponse = z.infer<typeof TodoReorderResponseSchema>;

/**
 * Hard cap on todo nesting depth, measured in ancestors:
 *   depth 0 = top-level   (root)
 *   depth 1 = subtask
 *   depth 2 = grandchild
 *   depth 3 = great-grandchild (deepest allowed)
 * 4 levels total. Frontend mirrors this constant for UI gating;
 * backend enforces it on every parent_id-changing path. Source of
 * truth is the backend.
 */
export const MAX_TODO_DEPTH = 3;

// ---------------------------------------------------------------------------
// Health / errors
// ---------------------------------------------------------------------------

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  service: z.string(),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ErrorResponseSchema = z.object({
  error: z.string(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// ---------------------------------------------------------------------------
// Shared route plumbing (params, common acks)
// ---------------------------------------------------------------------------

// Generic ack envelope returned by archive/restore/pin/unpin/comment-delete.
// `mode` is set by the soft/hard delete branches; everything else just sets ok.
// `ok` is typed as `boolean` rather than `z.literal(true)` to keep call-site
// `c.json({ ok: true, ... })` ergonomic — TS literal narrowing through the
// json helper is brittle and noise-heavy with `as const` everywhere.
export const OkResponseSchema = z.object({
  ok: z.boolean(),
  mode: z.enum(['hard', 'archived']).optional(),
  pinned: z.boolean().optional(),
});
export type OkResponse = z.infer<typeof OkResponseSchema>;

// /:id path param — used by everything that operates on a single record.
export const IdParamSchema = z.object({
  id: UuidSchema,
});

// /:id/comments/:cid for comment-targeted ops.
export const CommentIdParamSchema = z.object({
  id: UuidSchema,
  cid: UuidSchema,
});

// /:name path param for /tags/:name.
export const TagNameParamSchema = z.object({
  name: z.string().min(1),
});

// `?hard=true` query for soft-vs-hard delete on archive endpoints.
export const HardDeleteQuerySchema = z.object({
  hard: z.coerce.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Wrapped response shapes (project/content/todo single + counts envelopes)
// ---------------------------------------------------------------------------

export const ProjectResponseSchema = z.object({ project: ProjectSchema });
export type ProjectResponse = z.infer<typeof ProjectResponseSchema>;

export const TodoResponseSchema = z.object({ todo: TodoSchema });
export type TodoResponse = z.infer<typeof TodoResponseSchema>;

export const ContentItemResponseSchema = z.object({ item: ContentItemSchema });
export type ContentItemResponse = z.infer<typeof ContentItemResponseSchema>;

export const TodoCommentResponseSchema = z.object({ comment: TodoCommentSchema });
export type TodoCommentResponse = z.infer<typeof TodoCommentResponseSchema>;

// ---------------------------------------------------------------------------
// Content-specific request bodies that aren't already declared above
// ---------------------------------------------------------------------------

// JSON body for POST /content — the multipart variant validates via parseBody
// and isn't covered by this schema. Discriminated on `type`.
// project_ids is intentionally `z.string().array()` rather than uuid-typed —
// service-level validation handles the UUID format and test fixtures use
// short ids; surfacing schema rejection here before the handler runs would
// regress existing tests + clients.
export const ContentCreateRequestSchema = z.object({
  type: ContentTypeSchema,
  content: z.string().optional(),
  title: z.string().optional(),
  project_ids: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});
export type ContentCreateRequest = z.infer<typeof ContentCreateRequestSchema>;

// POST /content/:id/replace — text-only replacement; binary lands at REST.
// content is optional at schema level; handler enforces "file or content".
export const ContentReplaceRequestSchema = z.object({
  content: z.string().min(1).optional(),
});
export type ContentReplaceRequest = z.infer<typeof ContentReplaceRequestSchema>;

// POST /content/:id/edit-body — re-chunks + re-embeds.
// Custom min(1) message keeps the existing wire error shape: callers (and
// tests) match on /non-empty/ so we keep that phrasing.
export const ContentEditBodyRequestSchema = z.object({
  content: z.string().min(1, 'content is required and must be a non-empty string'),
});
export type ContentEditBodyRequest = z.infer<typeof ContentEditBodyRequestSchema>;

// ---------------------------------------------------------------------------
// Stats query — narrow project scope is optional.
// ---------------------------------------------------------------------------

export const StatsQuerySchema = z.object({
  project_id: UuidSchema.optional(),
});

// ---------------------------------------------------------------------------
// Tag query — list scope.
// ---------------------------------------------------------------------------

export const TagListQuerySchema = z.object({
  project_id: UuidSchema.optional(),
  // Scope filter for the tag inventory. 'personal' = only tags on
  // entities with no project membership; 'all' = no scope filter
  // (default). If `project_id` is set it takes precedence over scope.
  scope: z.enum(['personal', 'all']).optional(),
});

// ---------------------------------------------------------------------------
// Diagnostics — entity-graph inspection responses.
// ---------------------------------------------------------------------------

export const EntityRowSchema = z.object({
  id: UuidSchema,
  canonical_name: z.string(),
  type: z.string(),
  aliases: z.array(z.string()),
  mention_count: z.number().int().nonnegative(),
  created_at: z.string().datetime({ offset: true }),
});
export type EntityRow = z.infer<typeof EntityRowSchema>;

export const DiagnosticsEntitiesQuerySchema = z.object({
  project_id: UuidSchema.optional(),
  type: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const DiagnosticsEntitiesResponseSchema = z.object({
  entities: z.array(EntityRowSchema),
});
export type DiagnosticsEntitiesResponse = z.infer<typeof DiagnosticsEntitiesResponseSchema>;

export const DiagnosticsBackfillRequestSchema = z.object({
  content_item_id: UuidSchema.optional(),
});
export type DiagnosticsBackfillRequest = z.infer<typeof DiagnosticsBackfillRequestSchema>;

export const DiagnosticsBackfillResultSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  entity_count: z.number().int().nonnegative(),
  edge_count: z.number().int().nonnegative(),
  error: z.string().optional(),
});

export const DiagnosticsBackfillResponseSchema = z.object({
  processed: z.number().int().nonnegative(),
  results: z.array(DiagnosticsBackfillResultSchema),
});
export type DiagnosticsBackfillResponse = z.infer<typeof DiagnosticsBackfillResponseSchema>;

export const DiagnosticsEdgeRowSchema = z.object({
  chunk_id: UuidSchema,
  chunk_index: z.number().int(),
  entity_id: UuidSchema,
  canonical_name: z.string(),
  type: z.string(),
  confidence: z.number(),
  mention_text: z.string().nullable(),
});
export type DiagnosticsEdgeRow = z.infer<typeof DiagnosticsEdgeRowSchema>;

export const DiagnosticsEdgesResponseSchema = z.object({
  content_item_id: UuidSchema,
  edge_count: z.number().int().nonnegative(),
  edges: z.array(DiagnosticsEdgeRowSchema),
});
export type DiagnosticsEdgesResponse = z.infer<typeof DiagnosticsEdgesResponseSchema>;

// ---------------------------------------------------------------------------
// Find mentions — chunk + parent-context envelope.
// ---------------------------------------------------------------------------

export const MentionHitSchema = z.object({
  chunk_id: UuidSchema,
  content_item_id: UuidSchema,
  parent_type: ContentTypeSchema,
  parent_title: z.string(),
  parent_project_ids: z.array(UuidSchema),
  parent_tags: z.array(z.string()),
  parent_source_url: z.string().nullable(),
  excerpt: z.string(),
  confidence: z.number(),
});
export type MentionHit = z.infer<typeof MentionHitSchema>;

export const FindMentionsResponseSchema = z.object({
  hits: z.array(MentionHitSchema),
});
export type FindMentionsResponse = z.infer<typeof FindMentionsResponseSchema>;

// ---------------------------------------------------------------------------
// Async-ingest response shapes (POST /content + /content/from-url, retry,
// reprocess, edit-body, replace) — they all return a tiny ack envelope.
// ---------------------------------------------------------------------------

export const ContentIngestAckSchema = z.object({
  id: UuidSchema,
  status: ProcessingStatusSchema,
});
export type ContentIngestAck = z.infer<typeof ContentIngestAckSchema>;

export const UrlIngestAckSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  type: ContentTypeSchema,
  source_url: z.string(),
  deduped: z.boolean(),
  url_type: z.string(),
  status: ProcessingStatusSchema,
});
export type UrlIngestAck = z.infer<typeof UrlIngestAckSchema>;

export const ContentReplaceAckSchema = z.object({
  old_id: UuidSchema,
  new_id: UuidSchema,
  status: ProcessingStatusSchema,
});
export type ContentReplaceAck = z.infer<typeof ContentReplaceAckSchema>;
